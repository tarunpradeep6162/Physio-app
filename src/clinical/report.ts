import type { Assessment, DB, ID, Report } from '../data/models';
import { activeProgram, age, fmtDate, fmtDateTime, programExercises, sessionsFor } from '../data/queries';
import { getDefinition } from '../engine/exercises/definitions';
import { getProtocol } from '../engine/protocols/knee';
import type { Keyframe } from '../engine/protocols/types';
import type { Landmark } from '../engine/types';
import { regionLabel } from '../features/bodymap/regions';
import { buildEvidence, capturesFor } from './evidence';
import { currentAnswers, formatAnswer, HISTORY_QUESTIONNAIRE, organiseHistory } from './intake';
import { evaluate, RULE_SET, STATE_LABEL } from './reasoning';
import { levelFromResponses, SAFETY_QUESTIONNAIRE } from './safety';

/**
 * Report model: built only from stored data. Every section marks missing or invalid data
 * explicitly instead of inventing content. The same model renders to the print view and to the
 * PDF. Conclusions appear as clinician conclusions ONLY in a clinician-reviewed report.
 */

export const REPORT_TEMPLATE_VERSION = 'pv-knee-report-1.0.0';

export type Block =
  | { kind: 'para'; text: string; tone?: 'muted' | 'warn' | 'strong' }
  | { kind: 'kv'; rows: [string, string][] }
  | { kind: 'table'; head: string[]; rows: string[][] }
  | { kind: 'missing'; text: string }
  | { kind: 'regions'; ids: string[] }
  | { kind: 'skeletons'; caption: string; width: number; height: number; frames: { label: string; landmarks: Landmark[] }[] }
  | { kind: 'chart'; title: string; unit: string; xLabel: string; series: { label: string; dashed?: boolean; points: { x: number; y: number | null }[] }[]; xFormat: 'seconds' | 'date' };

export interface ReportSection {
  n: number;
  title: string;
  label?: string;
  blocks: Block[];
}

export type ReportState = 'preliminary' | 'clinician_reviewed';

export interface ReportModel {
  audience: 'clinician' | 'patient';
  state: ReportState;
  staleApproval: boolean;
  documentVersion: number;
  generatedAt: string;
  assessmentId: ID;
  patientLabel: string;
  clinicianName: string;
  approvedBy?: string;
  approvedAt?: string;
  sections: ReportSection[];
}

/** Latest time any assessment data changed — an approval older than this is stale. */
export function lastDataChange(db: DB, id: ID): string {
  const ts = [
    ...db.captures.filter((x) => x.assessmentId === id).map((x) => x.createdAt),
    ...db.scans.filter((x) => x.assessmentId === id).map((x) => x.createdAt),
    ...db.measurements.filter((x) => x.assessmentId === id).flatMap((x) => [x.createdAt, x.reviewedAt ?? '']),
    ...db.intakeAnswers.filter((x) => x.assessmentId === id).map((x) => x.answeredAt),
    ...db.reasoningDecisions.filter((x) => x.assessmentId === id).map((x) => x.at),
    ...db.impressions.filter((x) => x.assessmentId === id).map((x) => x.at),
    ...db.amendments.filter((x) => x.assessmentId === id).map((x) => x.at),
    ...db.safetyResponses.filter((x) => x.assessmentId === id).map((x) => x.at),
  ];
  return ts.sort().at(-1) ?? '';
}

export function reportStatus(db: DB, id: ID): { state: ReportState; latest?: Report; approved?: Report; stale: boolean; nextVersion: number } {
  const rows = db.reports.filter((r) => r.assessmentId === id).sort((a, b) => b.version - a.version);
  const approved = rows.find((r) => r.status === 'clinician_reviewed');
  const stale = !!approved && (approved.approvedAt ?? '') < lastDataChange(db, id);
  return { state: approved && !stale ? 'clinician_reviewed' : 'preliminary', latest: rows[0], approved, stale, nextVersion: (rows[0]?.version ?? 0) + 1 };
}

const fmtMetric = (v: number | null, unit: string) => (v === null ? '—' : `${v}${unit === 'deg' ? '°' : unit === 's' ? ' s' : unit === 'pct_leg' ? '% leg' : ''}`);

export function buildReport(db: DB, assessmentId: ID, audience: 'clinician' | 'patient'): ReportModel {
  const a = db.assessments.find((x) => x.id === assessmentId) as Assessment;
  const p = db.patients.find((x) => x.id === a.patientId)!;
  const baseline = a.baselineAssessmentId ? db.assessments.find((x) => x.id === a.baselineAssessmentId) : undefined;
  const st = reportStatus(db, assessmentId);
  const reviewed = st.state === 'clinician_reviewed';
  const clinician = db.clinicians.find((c) => c.id === (st.approved?.approvedBy ?? a.reviewedBy)) ?? db.clinicians[0];
  // Reassessments re-ask a subset; other history is carried from the baseline.
  const answers = { ...(a.baselineAssessmentId ? currentAnswers(db.intakeAnswers.filter((r) => r.assessmentId === a.baselineAssessmentId)) : {}), ...currentAnswers(db.intakeAnswers.filter((r) => r.assessmentId === a.id)) };
  const regions = db.painRegions.filter((r) => r.assessmentId === a.id);
  const caps = capturesFor(db, a.id);
  const bCaps = baseline ? capturesFor(db, baseline.id) : [];
  const evidence = buildEvidence(db, a.id);
  const safety = db.safetyResponses.filter((r) => r.assessmentId === a.id);
  const level = safety.length ? levelFromResponses(safety) : a.safetyLevel;
  const impression = db.impressions.filter((i) => i.assessmentId === a.id).sort((x, y) => y.at.localeCompare(x.at))[0];
  const S: ReportSection[] = [];
  const add = (n: number, title: string, blocks: Block[], label?: string) => S.push({ n, title, blocks, label });
  const valid = (c: (typeof caps)[number] | undefined, id: string) => {
    const m = c?.result.metrics.find((x) => x.id === id);
    return c && c.result.quality.verdict === 'valid' && m?.validity === 'valid' ? m.value : null;
  };

  // 1. Cover
  add(1, 'Cover', [
    {
      kind: 'kv',
      rows: [
        ['Patient identifier', `${p.name} · ${p.id.slice(0, 8).toUpperCase()}`],
        ['Age', age(p.dob) === null ? 'not recorded' : `${age(p.dob)} years`],
        ['Assessment ID', a.id.slice(0, 8).toUpperCase()],
        ['Assessment date', fmtDateTime(a.createdAt)],
        ['Type', `Knee ${a.type === 'reassessment' ? `reassessment (baseline ${baseline ? fmtDate(baseline.createdAt) : '—'})` : 'initial assessment'}`],
        ['Clinician', clinician ? `${clinician.name}, ${clinician.title}` : 'not assigned'],
        ['Review status', reviewed ? `Clinician-reviewed (v${st.approved!.version}, ${fmtDateTime(st.approved!.approvedAt!)})` : st.stale ? 'AI preliminary — data changed after the last approval; requires re-review' : 'AI preliminary — requires clinician review'],
      ],
    },
    { kind: 'regions', ids: regions.map((r) => r.regionId) },
  ]);

  // 2. Concerns
  const concerns: Block[] = regions.length
    ? [{ kind: 'table', head: ['Region', 'Symptoms', 'Location detail'], rows: regions.map((r) => [regionLabel(r.regionId), (r.symptomTypes ?? []).join(', '), r.subLocations?.join(', ') ?? '']) }]
    : [{ kind: 'missing', text: 'No symptom map recorded.' }];
  const paths = db.radiationPaths.filter((x) => x.assessmentId === a.id);
  if (paths.length) concerns.push({ kind: 'para', text: `Radiation drawn: ${paths.map((x) => `${x.symptomType} (${x.view} view)`).join(', ')}.` });
  concerns.push({
    kind: 'kv',
    rows: ['nprs_now', 'nprs_worst', 'duration', 'aggravating', 'easing', 'func_stairs', 'func_squat', 'func_walk', 'func_chair'].map((q) => [HISTORY_QUESTIONNAIRE.questions.find((x) => x.id === q)!.text, answers[q] === undefined ? 'not answered' : formatAnswer(q, answers[q])]),
  });
  add(2, 'Concerns', concerns, 'Patient-reported');

  // 3. History
  const amend = db.amendments.filter((m) => m.assessmentId === a.id);
  const lines = organiseHistory(answers, regions);
  add(
    3,
    'History',
    lines.length
      ? [
          { kind: 'para', text: 'Patient-reported. Auto-organised from the patient’s answers (rule-based); clinician amendments are marked.', tone: 'muted' },
          ...lines.map<Block>((l) => {
            const m = amend.filter((x) => x.target === l.key).sort((x, y) => y.at.localeCompare(x.at))[0];
            return { kind: 'para', text: m ? `${m.amended} [clinician amendment ${fmtDate(m.at)}; original: ${l.text}]` : l.text };
          }),
          { kind: 'para', text: `Safety screen ${SAFETY_QUESTIONNAIRE.id}@${SAFETY_QUESTIONNAIRE.version}: ${level === 'clear' ? 'no red-flag answers' : `${level?.replace('_', ' ')} — ${safety.filter((s) => s.answer).map((s) => s.questionText).join('; ')}`}.`, tone: level && level !== 'clear' ? 'warn' : undefined },
        ]
      : [{ kind: 'missing', text: 'History not completed.' }],
    'Patient-reported',
  );

  // 4. Static assessment
  const latestScanByView = new Map<string, string>();
  for (const s of db.scans.filter((x) => x.assessmentId === a.id && x.kind === 'static_posture').sort((x, y) => x.createdAt.localeCompare(y.createdAt))) latestScanByView.set(s.view, s.id);
  const latestScanIds = new Set(latestScanByView.values());
  const scanMs = db.measurements.filter((m) => m.assessmentId === a.id && !!m.scanId && latestScanIds.has(m.scanId) && m.type.startsWith('posture.') && m.confidence >= 0.7 && m.reviewStatus !== 'rejected');
  add(
    4,
    'Static assessment',
    scanMs.length
      ? [
          { kind: 'table', head: ['View / measure', 'Estimate', 'SD', 'Confidence', 'Review'], rows: scanMs.map((m) => [`${m.provenance.view ?? ''} · ${m.type.replace('posture.', '').replace(/_/g, ' ')}${m.direction ? ` (${m.direction.replace(/_/g, ' ')})` : ''}`, `${m.value}${m.unit === 'deg' ? '°' : '%'}`, m.sd !== undefined ? `±${m.sd}` : '—', m.confidence.toFixed(2), m.reviewStatus]) },
          { kind: 'para', text: 'Camera-estimated from 2D landmarks with a level camera assumption. No population norms are applied.', tone: 'muted' },
        ]
      : [{ kind: 'missing', text: 'No static posture capture in this assessment (optional for the knee pathway).' }],
    'Camera-estimated',
  );

  // 5. ROM
  const romRows: string[][] = [];
  for (const side of ['left', 'right'] as const) {
    const c = caps.find((x) => x.protocolId === 'knee_supported_flexion' && x.side === side);
    const b = bCaps.find((x) => x.protocolId === 'knee_supported_flexion' && x.side === side);
    for (const [id, label] of [
      ['knee_flexion_peak', 'Flexion (peak)'],
      ['knee_extension_position', 'Most-extended position'],
    ] as const) {
      const cv = valid(c, id);
      const bv = valid(b, id);
      romRows.push([`Knee ${side} — ${label}`, baseline ? (b ? fmtMetric(bv, 'deg') + (bv === null ? ' (invalid)' : '') : 'not captured') : '—', c ? fmtMetric(cv, 'deg') + (cv === null ? ' (invalid — recapture)' : '') : 'not captured', bv !== null && cv !== null ? `${cv - bv >= 0 ? '+' : ''}${Math.round((cv - bv) * 10) / 10}°` : '—', c ? `${getProtocol(c.protocolId).id}@${c.protocolVersion}, ${c.result.quality.verdict}` : '—']);
    }
  }
  add(5, 'Range of motion', [{ kind: 'table', head: ['Joint / side', 'Baseline', 'Current', 'Difference', 'Method / validity'], rows: romRows }, { kind: 'para', text: 'Camera-estimated, 2D lateral view, active movement. Not interchangeable with goniometry until validated.', tone: 'muted' }], 'Camera-estimated');

  // 6. Movement
  const mv: Block[] = [];
  for (const c of caps.filter((x) => x.result.quality.verdict === 'valid')) {
    const def = getProtocol(c.protocolId, c.protocolVersion);
    const kf: Keyframe[] = c.result.keyframes;
    if (kf.length) mv.push({ kind: 'skeletons', caption: `${def.shortTitle}${c.side ? ` (${c.side})` : ''} — start / mid / peak / return (landmark skeleton; no images stored)`, width: c.result.frameWidth, height: c.result.frameHeight, frames: kf.map((k) => ({ label: k.label, landmarks: k.filtered })) });
    mv.push({ kind: 'chart', title: `${def.shortTitle}${c.side ? ` (${c.side})` : ''} — ${def.signalLabel} over time`, unit: def.signalUnit === 'deg' ? '°' : '%', xLabel: 'seconds', xFormat: 'seconds', series: [{ label: def.signalLabel, points: c.result.signal.map((s) => ({ x: s.t, y: s.v })) }] });
  }
  add(6, 'Movement', mv.length ? mv : [{ kind: 'missing', text: 'No valid dynamic capture available.' }], 'Camera-estimated');

  // 7. Symmetry
  const sym: string[][] = [];
  const fl = valid(caps.find((x) => x.protocolId === 'knee_supported_flexion' && x.side === 'left'), 'knee_flexion_peak');
  const fr = valid(caps.find((x) => x.protocolId === 'knee_supported_flexion' && x.side === 'right'), 'knee_flexion_peak');
  sym.push(['Knee flexion (peak)', fmtMetric(fl, 'deg'), fmtMetric(fr, 'deg'), fl !== null && fr !== null ? `${Math.round(Math.abs(fl - fr) * 10) / 10}°` : 'not available']);
  const sq = caps.find((x) => x.protocolId === 'knee_squat');
  const sl = valid(sq, 'squat_fppa_left');
  const sr = valid(sq, 'squat_fppa_right');
  sym.push(['Squat FPPA (+ toward midline)', fmtMetric(sl, 'deg'), fmtMetric(sr, 'deg'), sl !== null && sr !== null ? `${Math.round(Math.abs(sl - sr) * 10) / 10}°` : 'not available']);
  add(7, 'Symmetry', [{ kind: 'table', head: ['Measure', 'Left', 'Right', 'Difference'], rows: sym }, { kind: 'para', text: 'Descriptive comparison only; a left/right difference is not, by itself, evidence of pathology.', tone: 'muted' }], 'Camera-estimated');

  // 8. Functional tests
  const fn: string[][] = [];
  for (const pid of ['knee_sit_to_stand', 'knee_squat']) {
    const def = getProtocol(pid);
    const c = caps.find((x) => x.protocolId === pid);
    const b = bCaps.find((x) => x.protocolId === pid);
    if (!c && !b) {
      fn.push([`${def.title} v${def.version}`, 'not performed', '—', '—', '—']);
      continue;
    }
    for (const m of (c ?? b)!.result.metrics) {
      fn.push([`${def.shortTitle} — ${m.label}`, c ? fmtMetric(valid(c, m.id), m.unit) : 'not captured', c ? fmtDate(c.createdAt) : '—', c ? `${c.result.quality.verdict}, ${Math.round(c.result.quality.coverage * 100)}% coverage${c.setupNotes ? `, setup: ${c.setupNotes}` : ''}` : '—', baseline ? (b ? `${fmtMetric(valid(b, m.id), m.unit)} (${fmtDate(b.createdAt)})` : 'no baseline') : '—']);
    }
  }
  add(8, 'Functional tests', [{ kind: 'table', head: ['Test / result', 'Value', 'Date', 'Quality', 'Baseline'], rows: fn }], 'Camera-estimated');

  // 9. Reported outcomes
  const sess = sessionsFor(db, p.id).slice(0, 8);
  add(
    9,
    'Reported outcomes',
    [
      { kind: 'kv', rows: ['nprs_now', 'nprs_worst', 'nprs_best'].map((q) => [HISTORY_QUESTIONNAIRE.questions.find((x) => x.id === q)!.text, answers[q] === undefined ? 'not answered' : formatAnswer(q, answers[q])]) },
      sess.length ? { kind: 'table', head: ['Session', 'Pain before → after', 'Exertion (RPE)'], rows: sess.map((s) => [fmtDate(s.startedAt), `${s.painBefore ?? '—'} → ${s.painAfter ?? '—'}`, `${s.rpe ?? '—'}/10`]) } : { kind: 'missing', text: 'No exercise sessions recorded yet.' },
      { kind: 'para', text: 'No licensed outcome instruments were administered in this version.', tone: 'muted' },
    ],
    'Patient-reported',
  );

  // 10. Findings — four categories kept separate
  const byCat = (c: string) => evidence.filter((e) => e.category === c && e.validity !== 'invalid').map((e) => [e.label, e.value]);
  add(10, 'Findings', [
    { kind: 'para', text: 'Patient-reported', tone: 'strong' },
    byCat('patient_reported').length ? { kind: 'table', head: ['Item', 'Answer'], rows: byCat('patient_reported') } : { kind: 'missing', text: 'None.' },
    { kind: 'para', text: 'Camera-estimated (valid captures only)', tone: 'strong' },
    byCat('camera_estimated').length ? { kind: 'table', head: ['Measure', 'Estimate'], rows: byCat('camera_estimated') } : { kind: 'missing', text: 'None.' },
    { kind: 'para', text: 'Algorithmic observations (clinician-configured thresholds)', tone: 'strong' },
    byCat('algorithmic').length ? { kind: 'table', head: ['Observation', 'Value'], rows: byCat('algorithmic') } : { kind: 'missing', text: 'None triggered.' },
    { kind: 'para', text: 'Clinician findings', tone: 'strong' },
    reviewed && impression ? { kind: 'para', text: impression.text } : { kind: 'missing', text: 'No clinician-approved findings in this document.' },
  ]);

  // 11. Reasoning
  const results = evaluate(evidence, level);
  const decisions = db.reasoningDecisions.filter((d) => d.assessmentId === a.id);
  add(11, 'Reasoning', [
    { kind: 'para', text: `Differential considerations generated by rule set ${RULE_SET.id}@${RULE_SET.version} (${db.settings.ruleApprovals[`${RULE_SET.id}@${RULE_SET.version}`] ? 'approved' : 'DRAFT'}). No probabilities; not diagnoses.`, tone: 'muted' },
    {
      kind: 'table',
      head: ['Consideration', 'Evidence state', 'For', 'Against', 'Missing / further tests', 'Clinician action'],
      rows: results.map((r) => {
        const d = decisions.filter((x) => x.considerationId === r.rule.id).sort((x, y) => y.at.localeCompare(x.at))[0];
        return [r.rule.title, STATE_LABEL[r.state], r.supporting.map((s) => s.label).join('; ') || '—', r.conflicting.map((s) => s.label).join('; ') || '—', [...r.missing, ...r.rule.furtherExamination].join('; '), d ? `${d.action}${d.note ? `: ${d.note}` : ''}` : 'not reviewed'];
      }),
    },
    reviewed && impression
      ? { kind: 'para', text: `Clinician conclusion (${fmtDate(impression.at)}): ${impression.text}`, tone: 'strong' }
      : { kind: 'para', text: 'DRAFT — no clinician conclusion. Considerations above are preliminary and require clinician review.', tone: 'warn' },
  ]);

  // 12. Rehabilitation
  const prog = activeProgram(db, p.id);
  add(
    12,
    'Rehabilitation',
    prog
      ? [
          { kind: 'para', text: `${prog.title} — approved ${prog.approvedAt ? fmtDate(prog.approvedAt) : '—'}; ${fmtDate(prog.startDate)} to ${fmtDate(prog.endDate)}.` },
          {
            kind: 'table',
            head: ['Exercise', 'Side', 'Sets × reps', 'Target', 'Hold', 'Frequency', 'Progression'],
            rows: programExercises(db, prog.id).map((e) => [getDefinition(e.prescription.definitionId).id.replace(/_/g, ' '), e.prescription.side, `${e.prescription.sets} × ${e.prescription.reps}`, `${e.prescription.target.min}–${e.prescription.target.max}°`, `${e.prescription.holdSeconds} s`, `${e.prescription.frequencyPerWeek}/wk`, e.prescription.progression ?? '—']),
          },
        ]
      : [{ kind: 'missing', text: 'No approved rehabilitation program.' }],
    'Clinician-approved',
  );

  // 13. Progress
  const flexSeries = (side: 'left' | 'right') =>
    db.assessments
      .filter((x) => x.patientId === p.id && x.region === 'knee')
      .map((x) => ({ at: x.createdAt, v: valid(capturesFor(db, x.id).find((c) => c.protocolId === 'knee_supported_flexion' && c.side === side), 'knee_flexion_peak') }))
      .sort((x, y) => x.at.localeCompare(y.at));
  const L = flexSeries('left');
  const R = flexSeries('right');
  add(
    13,
    'Progress',
    L.length + R.length > 1
      ? [
          { kind: 'chart', title: 'Camera-estimated knee flexion by assessment', unit: '°', xLabel: 'date', xFormat: 'date', series: [{ label: 'Left', points: L.map((x) => ({ x: new Date(x.at).getTime(), y: x.v })) }, { label: 'Right', dashed: true, points: R.map((x) => ({ x: new Date(x.at).getTime(), y: x.v })) }] },
          { kind: 'para', text: `Dates: ${L.map((x) => `${fmtDate(x.at)} L ${x.v ?? 'missing/invalid'}`).join(' · ')}. Gaps mean no valid capture that day.`, tone: 'muted' },
        ]
      : [{ kind: 'missing', text: 'Only one assessment so far — progress needs a matched reassessment.' }],
  );

  // 14. Technical appendix
  const tech: string[][] = caps.map((c) => [
    `${c.protocolId}@${c.protocolVersion}${c.side ? ` (${c.side})` : ''}`,
    `${c.provenance.poseModel ?? '—'} ${c.provenance.poseModelVersion ?? ''} · ${c.result.algorithmVersion} · filter ${c.provenance.filter ?? '—'}`,
    `${c.result.quality.verdict}; coverage ${Math.round(c.result.quality.coverage * 100)}%; conf ${c.result.quality.meanConfidence ?? '—'}; ${c.result.quality.meanFps ?? '—'} fps`,
    `${c.provenance.device?.videoWidth ?? '—'}×${c.provenance.device?.videoHeight ?? '—'}, roll ${c.config?.cameraRollDeg ?? 'unknown'}${c.provenance.source === 'simulated_demo' ? ' · SIMULATED' : ''}${c.conditionMatch ? ` · baseline match ${Math.round(c.conditionMatch.score * 100)}%` : ''}`,
  ]);
  add(14, 'Technical appendix', [
    tech.length ? { kind: 'table', head: ['Capture', 'Model / algorithm', 'Quality', 'Device / conditions'], rows: tech } : { kind: 'missing', text: 'No captures.' },
    {
      kind: 'kv',
      rows: [
        ['Report template', REPORT_TEMPLATE_VERSION],
        ['History questionnaire', `${HISTORY_QUESTIONNAIRE.id}@${HISTORY_QUESTIONNAIRE.version}`],
        ['Safety questionnaire', `${SAFETY_QUESTIONNAIRE.id}@${SAFETY_QUESTIONNAIRE.version} (${db.settings.ruleApprovals[`${SAFETY_QUESTIONNAIRE.id}@${SAFETY_QUESTIONNAIRE.version}`] ? 'approved' : 'draft'})`],
        ['Reasoning rules', `${RULE_SET.id}@${RULE_SET.version} (${db.settings.ruleApprovals[`${RULE_SET.id}@${RULE_SET.version}`] ? 'approved' : 'draft'})`],
      ],
    },
    { kind: 'para', text: 'Known limitations: camera measurements are 2D estimates from a single phone/laptop camera and have not been clinically validated; they cannot establish tissue diagnosis, force or laboratory-grade 3D kinematics. No regulatory clearance is claimed. Raw video is not stored; results derive from stored landmarks.', tone: 'muted' },
  ]);

  const patientSections = [1, 2, 5, 7, 8, 12, 13].map((n) => S.find((s) => s.n === n)!);
  if (audience === 'patient') {
    patientSections.push({ n: 11, title: 'Your physiotherapist’s summary', blocks: [reviewed && impression ? { kind: 'para', text: impression.text } : { kind: 'missing', text: 'Your physiotherapist has not reviewed this yet.' }] });
    patientSections.push({ n: 14, title: 'About these measurements', blocks: [{ kind: 'para', text: 'Camera measurements are estimates made on your device from body landmarks. They are not a diagnosis and are reviewed by your physiotherapist.', tone: 'muted' }] });
  }
  return {
    audience,
    state: st.state,
    staleApproval: st.stale,
    documentVersion: st.approved && !st.stale ? st.approved.version : st.nextVersion,
    generatedAt: new Date().toISOString(),
    assessmentId,
    patientLabel: `${p.name} · ${p.id.slice(0, 8).toUpperCase()}`,
    clinicianName: clinician?.name ?? '—',
    approvedBy: reviewed ? db.clinicians.find((c) => c.id === st.approved!.approvedBy)?.name : undefined,
    approvedAt: reviewed ? st.approved!.approvedAt : undefined,
    sections: audience === 'patient' ? patientSections : S,
  };
}
