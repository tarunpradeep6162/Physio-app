import type { DB, ID } from '../data/models';
import { getProtocol } from '../engine/protocols/registry';
import { buildEvidence, type EvidenceItem } from './evidence';
import { currentAnswers, organiseHistory } from './intake';
import { pathwayFor } from './pathways';
import { evaluate, STATE_LABEL } from './reasoning';
import { levelFromResponses } from './safety';

/**
 * Structured consultation draft (Phase 7).
 *
 * A fixed-schema draft that organises what is already known for the clinician: an intake summary,
 * observations, safety flags, contradictions, missing data, follow-up questions and suggested
 * tests. Every statement cites evidence ids from the evidence graph; a validator (below) drops any
 * finding that does not, and rejects diagnostic, probabilistic, severity or strength claims and
 * prompt-injection text. The draft is ALWAYS "AI draft — awaiting clinician review": it cannot be
 * approved, shown to a patient or written into a report by itself (see Phase 8).
 *
 * The built-in generator is deterministic (no model). A language-model generator can plug in behind
 * the same schema and validator on the server (see modelDraft.ts); none is active in this build.
 */

export const DRAFT_SCHEMA_VERSION = 'dl-consult-draft-1.0.0';
export const RULE_GENERATOR = { kind: 'rules' as const, id: 'dl-draft-rules', version: '1.0.0' };

export interface DraftFinding {
  text: string;
  /** Evidence item ids (from buildEvidence) that support this statement. Required. */
  evidence: string[];
}

export type DraftSection = 'summary' | 'observations' | 'safetyFlags' | 'contradictions' | 'considerations';

export interface ConsultationDraft {
  schema: typeof DRAFT_SCHEMA_VERSION;
  assessmentId: ID;
  generatedAt: string;
  generator: { kind: 'rules' | 'model'; id: string; version: string; model?: string; promptVersion?: string };
  status: 'ai_draft_awaiting_review';
  /** Completeness of the information, not confidence in any condition. */
  uncertainty: 'high' | 'moderate' | 'low';
  uncertaintyReasons: string[];
  sections: Record<DraftSection, DraftFinding[]> & {
    missingData: string[];
    followUpQuestions: string[];
    suggestedTests: string[];
  };
}

/** Items of the assessment's current test plan, with protocol titles. */
function latestPlanItems(db: DB, assessmentId: ID) {
  const plan = db.testPlans.filter((p) => p.assessmentId === assessmentId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  return (plan?.items ?? []).map((i) => ({ ...i, title: getProtocol(i.protocolId, i.protocolVersion).title }));
}

// ---------------------------------------------------------------------------------------------
// Deterministic generator
// ---------------------------------------------------------------------------------------------
export function buildRuleDraft(db: DB, assessmentId: ID, now = new Date().toISOString()): ConsultationDraft {
  const a = db.assessments.find((x) => x.id === assessmentId)!;
  const pathway = pathwayFor(a);
  const evidence = buildEvidence(db, assessmentId);
  const byId = new Map(evidence.map((e) => [e.id, e]));
  const answers = currentAnswers(db.intakeAnswers.filter((r) => r.assessmentId === assessmentId));
  const regions = db.painRegions.filter((r) => r.assessmentId === assessmentId);
  const safetyRows = db.safetyResponses.filter((r) => r.assessmentId === assessmentId);
  const level = safetyRows.length ? levelFromResponses(safetyRows) : a.safetyLevel;
  const cite = (ids: string[]) => ids.filter((id) => byId.has(id));

  // Summary — the patient's own answers, organised; each line cites the answers it came from.
  const summary: DraftFinding[] = organiseHistory(answers, regions, pathway.history).map((l) => ({
    text: l.text,
    evidence: cite(l.sources.flatMap((s) => (s === 'symptom_map' ? regions.map((r) => `map:${r.id}`) : [`ans:${s}`]))),
  }));

  // Observations — valid camera estimates and algorithmic observations only.
  const observations: DraftFinding[] = evidence
    .filter((e) => (e.category === 'camera_estimated' || e.category === 'algorithmic') && e.validity !== 'invalid')
    .map((e) => ({ text: `${e.category === 'algorithmic' ? 'Algorithmic observation' : 'Camera estimate'}: ${e.label} — ${e.value}`, evidence: [e.id] }));

  const safetyFlags: DraftFinding[] = evidence.filter((e) => e.source.kind === 'safety' && level && level !== 'clear').map((e) => ({ text: `Safety screen: ${e.value}`, evidence: [e.id] }));

  // Contradictions — deterministic internal-consistency checks on what the patient reported.
  const contradictions: DraftFinding[] = [];
  if (typeof answers.nprs_now === 'number' && typeof answers.nprs_worst === 'number' && answers.nprs_now > answers.nprs_worst)
    contradictions.push({ text: `Pain now (${answers.nprs_now}/10) is higher than the reported worst in 24 hours (${answers.nprs_worst}/10) — clarify with the patient.`, evidence: cite(['ans:nprs_now', 'ans:nprs_worst']) });
  if (answers.night === 'none' && safetyRows.some((r) => r.questionId === 'night_unrelieved' && r.answer))
    contradictions.push({ text: 'History says no trouble at night, but the safety screen reports severe constant night pain — clarify.', evidence: cite(['ans:night', ...evidence.filter((e) => e.source.kind === 'safety').map((e) => e.id)]) });
  const reportedSides = new Set(regions.filter((r) => pathway.isRegion(r.regionId)).map((r) => r.side).filter(Boolean));
  const caps = db.captures.filter((c) => c.assessmentId === assessmentId);
  for (const side of reportedSides) {
    const any = caps.some((c) => c.side === side);
    const validOnSide = caps.some((c) => c.side === side && c.result.quality.verdict === 'valid');
    if (any && !validOnSide)
      contradictions.push({ text: `Symptoms were reported on the ${side}, but no capture of the ${side} side passed quality checks — the affected side is not yet measured.`, evidence: cite(regions.filter((r) => r.side === side).map((r) => `map:${r.id}`)) });
  }

  // Considerations — only from the versioned rule set; none exist for regions without rules.
  const results = pathway.hasConsiderationRules ? evaluate(evidence, level) : [];
  const considerations: DraftFinding[] = results
    .filter((r) => r.state !== 'insufficient_evidence')
    .map((r) => ({ text: `${r.rule.title}: ${STATE_LABEL[r.state].toLowerCase()} (rule ${r.rule.id})`, evidence: [...new Set([...r.supporting, ...r.conflicting].flatMap((s) => s.evidence.map((e) => e.id)))] }))
    .filter((f) => f.evidence.length);

  const missingData: string[] = [...new Set(results.flatMap((r) => r.missing))];
  const plan = latestPlanItems(db, assessmentId);
  const notValid = plan.filter((i) => !caps.some((c) => c.protocolId === i.protocolId && (c.side ?? null) === (i.side ?? null) && c.result.quality.verdict === 'valid'));
  for (const i of notValid) missingData.push(`No valid capture: ${i.title}${i.side ? ` (${i.side})` : ''}`);
  const required = pathway.history.questions.filter((q) => q.required && answers[q.id] === undefined);
  for (const q of required) missingData.push(`Not answered: ${q.text}`);

  const followUpQuestions = [...contradictions.map((c) => c.text.replace(/ — clarify.*$/, '').replace(/ — the affected side.*$/, '')).map((t) => `Ask about: ${t}`), ...results.flatMap((r) => r.missing).slice(0, 6).map((m) => `Clarify: ${m}`)];
  const suggestedTests = [...new Set([...notValid.map((i) => `Recapture ${i.title}${i.side ? ` (${i.side})` : ''}`), ...results.filter((r) => r.state !== 'safety_hold').flatMap((r) => r.rule.furtherExamination.map((x) => `Clinical examination: ${x}`)), ...pathway.scopeLimits.slice(1, 2).map((x) => `Not measured by camera — examine clinically: ${x.replace(/^.*?:\s*/, '')}`)])];

  const uncertaintyReasons: string[] = [];
  if (level && level !== 'clear') uncertaintyReasons.push('safety screen not clear — automated organisation withheld where relevant');
  if (notValid.length) uncertaintyReasons.push(`${notValid.length} planned test(s) without a valid capture`);
  if (missingData.length > notValid.length) uncertaintyReasons.push(`${missingData.length - notValid.length} item(s) of history or examination missing`);
  if (contradictions.length) uncertaintyReasons.push(`${contradictions.length} inconsistency(ies) to clarify`);
  const uncertainty = level && level !== 'clear' ? 'high' : uncertaintyReasons.length >= 2 ? 'high' : uncertaintyReasons.length === 1 ? 'moderate' : 'low';

  return {
    schema: DRAFT_SCHEMA_VERSION,
    assessmentId,
    generatedAt: now,
    generator: RULE_GENERATOR,
    status: 'ai_draft_awaiting_review',
    uncertainty,
    uncertaintyReasons,
    sections: { summary, observations, safetyFlags, contradictions, considerations, missingData, followUpQuestions, suggestedTests },
  };
}

// ---------------------------------------------------------------------------------------------
// Validator — the gate every draft passes through (rule-based or model-generated)
// ---------------------------------------------------------------------------------------------

/** Claims the product must never make. Checked on every free-text statement a draft contains. */
const FORBIDDEN: { re: RegExp; why: string }[] = [
  { re: /\b(diagnos(is|ed|e|es)|you have|patient has (a|an)\b|confirm(s|ed)? (a|an|the)\b|definitely|certainly)\b/i, why: 'diagnostic claim' },
  { re: /\b\d{1,3}\s?%|\bpercent\b|\bprobabilit|\blikelihood\b|\bodds\b|\bchance of\b/i, why: 'probability' },
  { re: /\b(severity|severe|mild|moderate)\s+(tear|injury|damage|lesion|arthritis|osteoarthritis|tendinopathy|sprain|strain)\b|\bgrade\s+[1-4I]{1,3}\b/i, why: 'severity grade' },
  { re: /\b(strength|force|power|torque)\s+(is|was|of|measured|reduced|deficit)\b|\bmeasured (strength|force)\b/i, why: 'strength or force claimed from video' },
  { re: /\b(tear|rupture|fracture|tendinopathy|impingement|bursitis|meniscal tear|ligament tear)\s+(is present|confirmed|seen|visible|detected)\b/i, why: 'tissue finding claimed from imagery' },
  { re: /\bnormal range\b|\babove normal\b|\bbelow normal\b|\bpopulation norm/i, why: 'invented norm' },
];
/** Text a patient could type to redirect a model. Any hit rejects the whole draft. */
const INJECTION = /(ignore (all |any )?(previous|prior|above) (instructions|rules)|disregard (the )?(instructions|rules)|system prompt|developer message|you are now|act as (a|an) |new instructions|\bjailbreak\b|<\/?(system|assistant|user)>|prescribe (the )?patient)/i;

export interface ValidationOutcome {
  ok: boolean;
  /** The draft with every failing finding removed (null when the whole draft is rejected). */
  draft: ConsultationDraft | null;
  errors: { section: string; text: string; reason: string }[];
}

export function validateDraft(input: unknown, evidence: EvidenceItem[], allowedConsiderationRuleIds: string[] = []): ValidationOutcome {
  const errors: ValidationOutcome['errors'] = [];
  const reject = (reason: string): ValidationOutcome => ({ ok: false, draft: null, errors: [...errors, { section: '*', text: '', reason }] });
  if (!input || typeof input !== 'object') return reject('not an object');
  const d = input as ConsultationDraft;
  if (d.schema !== DRAFT_SCHEMA_VERSION) return reject(`schema must be ${DRAFT_SCHEMA_VERSION}`);
  if (d.status !== 'ai_draft_awaiting_review') return reject('a draft can only be "ai_draft_awaiting_review"');
  if (!d.sections || typeof d.sections !== 'object') return reject('missing sections');
  if (!['high', 'moderate', 'low'].includes(d.uncertainty)) return reject('uncertainty state missing');
  const valid = new Map(evidence.filter((e) => e.validity !== 'invalid').map((e) => [e.id, e]));
  // The patient's own words are data, not instructions: a verbatim quote of cited evidence is removed
  // before scanning, so "my doctor said I have arthritis" or a hostile goal text is neither treated as
  // a claim by the draft nor able to smuggle instructions. Only the draft's own wording is checked.
  const own = (text: string, ids: string[]) => ids.reduce((t, id) => { const v = valid.get(id)?.value; return v && v.length > 3 ? t.split(v).join(' ') : t; }, text);
  const sectionTexts = (['summary', 'observations', 'safetyFlags', 'contradictions', 'considerations'] as DraftSection[]).flatMap((s) => (Array.isArray(d.sections[s]) ? d.sections[s] : []).map((f) => own(String(f?.text ?? ''), Array.isArray(f?.evidence) ? f.evidence : [])));
  const lists = (['missingData', 'followUpQuestions', 'suggestedTests'] as const).flatMap((s) => (Array.isArray(d.sections[s]) ? d.sections[s] : []).map(String));
  if ([...sectionTexts, ...lists].some((t) => INJECTION.test(t))) return reject('prompt-injection text in draft');

  const out = structuredClone(d);
  for (const s of ['summary', 'observations', 'safetyFlags', 'contradictions', 'considerations'] as DraftSection[]) {
    const list = Array.isArray(d.sections[s]) ? d.sections[s] : [];
    out.sections[s] = list.filter((f) => {
      const text = typeof f?.text === 'string' ? f.text : '';
      const ev = Array.isArray(f?.evidence) ? f.evidence : [];
      if (!text.trim()) return errors.push({ section: s, text, reason: 'empty statement' }) && false;
      if (!ev.length) return errors.push({ section: s, text, reason: 'no evidence cited' }) && false;
      const bad = ev.filter((id) => !valid.has(id));
      if (bad.length) return errors.push({ section: s, text, reason: `cites unknown or invalid evidence: ${bad.join(', ')}` }) && false;
      const hit = FORBIDDEN.find((x) => x.re.test(own(text, ev)));
      if (hit) return errors.push({ section: s, text, reason: hit.why }) && false;
      if (s === 'considerations' && d.generator?.kind === 'model') {
        const rid = /\(rule ([\w-]+)\)/.exec(text)?.[1];
        if (!rid || !allowedConsiderationRuleIds.includes(rid)) return errors.push({ section: s, text, reason: 'consideration not from the approved rule set' }) && false;
      }
      return true;
    });
  }
  for (const s of ['missingData', 'followUpQuestions', 'suggestedTests'] as const) {
    const list = Array.isArray(d.sections[s]) ? d.sections[s] : [];
    out.sections[s] = list.filter((text) => {
      if (typeof text !== 'string' || !text.trim()) return false;
      const hit = FORBIDDEN.find((x) => x.re.test(text));
      if (hit) return errors.push({ section: s, text, reason: hit.why }) && false;
      return true;
    });
  }
  return { ok: errors.length === 0, draft: out, errors };
}
