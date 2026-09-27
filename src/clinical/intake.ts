import type { IntakeAnswer, PainRegion, SymptomType } from '../data/models';

/**
 * Adaptive history questionnaire (knee pathway). Versioned; DRAFT content for clinical-lead
 * review. Questions appear only when relevant (e.g. mechanism only after a sudden onset, knee
 * questions only when a knee region is selected). Answers are stored verbatim with the question
 * text and version they were answered against.
 */

export type AnswerValue = IntakeAnswer['answer'];

export interface Question {
  id: string;
  section: 'onset' | 'intensity' | 'behaviour' | 'knee' | 'shoulder' | 'function' | 'history' | 'context' | 'goals';
  text: string;
  help?: string;
  kind: 'single' | 'multi' | 'nprs' | 'scale04' | 'text' | 'date';
  options?: { id: string; label: string }[];
  required?: boolean;
  showIf?: (ctx: IntakeContext) => boolean;
}

export interface IntakeContext {
  answers: Record<string, AnswerValue>;
  regions: PainRegion[];
}

const opt = (pairs: [string, string][]) => pairs.map(([id, label]) => ({ id, label }));
const has = (v: AnswerValue, id: string) => (Array.isArray(v) ? v.includes(id) : v === id);
export const hasKnee = (ctx: IntakeContext) => ctx.regions.some((r) => r.regionId.startsWith('knee'));
export const hasShoulder = (ctx: IntakeContext) => ctx.regions.some((r) => r.regionId.startsWith('shoulder') || r.regionId.startsWith('upper_arm'));
const symptomSelected = (ctx: IntakeContext, s: SymptomType) => ctx.regions.some((r) => r.symptomTypes?.includes(s));

export const SCALE04 = ['No difficulty', 'Mild', 'Moderate', 'Severe', 'Unable'];

export interface Questionnaire {
  id: string;
  version: string;
  status: string;
  questions: Question[];
}

export const HISTORY_QUESTIONNAIRE: Questionnaire = {
  id: 'knee-history',
  version: '1.0.0',
  status: 'DRAFT — pending clinical-lead approval',
  questions: [
    { id: 'onset', section: 'onset', kind: 'single', required: true, text: 'How did it start?', options: opt([['sudden', 'Suddenly — a specific moment or injury'], ['gradual', 'Gradually, without a clear injury'], ['after_surgery', 'After surgery'], ['unsure', 'Not sure']]) },
    {
      id: 'mechanism',
      section: 'onset',
      kind: 'multi',
      text: 'What happened at the time?',
      options: opt([['twisting', 'Twisting or pivoting on the leg'], ['landing', 'Landing from a jump'], ['direct_blow', 'A direct blow to the knee'], ['hyperextension', 'Knee bent backwards'], ['fall', 'A fall'], ['other', 'Something else']]),
      showIf: (c) => c.answers.onset === 'sudden',
    },
    { id: 'surgery_type', section: 'onset', kind: 'single', text: 'What surgery did you have?', options: opt([['acl', 'Ligament (ACL) reconstruction'], ['meniscus', 'Meniscus (cartilage) surgery'], ['replacement', 'Knee replacement'], ['other', 'Other / not sure']]), showIf: (c) => c.answers.onset === 'after_surgery' },
    { id: 'surgery_date', section: 'onset', kind: 'date', text: 'Date of surgery', showIf: (c) => c.answers.onset === 'after_surgery' },
    { id: 'duration', section: 'onset', kind: 'single', required: true, text: 'How long have you had these symptoms?', options: opt([['lt1w', 'Less than 1 week'], ['1_6w', '1–6 weeks'], ['6_12w', '6–12 weeks'], ['gt3m', 'More than 3 months']]) },
    { id: 'nprs_now', section: 'intensity', kind: 'nprs', required: true, text: 'Pain right now (0–10)' },
    { id: 'nprs_worst', section: 'intensity', kind: 'nprs', required: true, text: 'Worst pain in the last 24 hours (0–10)' },
    { id: 'nprs_best', section: 'intensity', kind: 'nprs', text: 'Least pain in the last 24 hours (0–10)' },
    { id: 'pattern', section: 'behaviour', kind: 'single', text: 'Is it constant, or does it come and go?', options: opt([['constant', 'Constant'], ['intermittent', 'Comes and goes']]) },
    { id: 'time_of_day', section: 'behaviour', kind: 'multi', text: 'When is it worst?', options: opt([['morning', 'On waking / morning'], ['during_activity', 'During activity'], ['after_activity', 'After activity'], ['evening', 'Evening'], ['no_pattern', 'No pattern']]) },
    {
      id: 'morning_stiffness',
      section: 'behaviour',
      kind: 'single',
      text: 'How long does morning stiffness last?',
      options: opt([['none', 'No morning stiffness'], ['lt30', 'Less than 30 minutes'], ['gt30', 'More than 30 minutes']]),
      showIf: (c) => has(c.answers.time_of_day, 'morning') || symptomSelected(c, 'stiffness'),
    },
    { id: 'night', section: 'behaviour', kind: 'single', text: 'How is it at night?', options: opt([['none', 'No trouble at night'], ['position', 'Only when I lie on it / move'], ['wakes_often', 'Wakes me most nights']]) },
    {
      id: 'aggravating',
      section: 'behaviour',
      kind: 'multi',
      text: 'What makes it worse?',
      options: opt([['stairs_up', 'Going up stairs'], ['stairs_down', 'Going down stairs'], ['squatting', 'Squatting'], ['kneeling', 'Kneeling'], ['prolonged_sitting', 'Sitting for a long time'], ['walking', 'Walking'], ['running', 'Running'], ['pivoting', 'Turning / pivoting'], ['standing', 'Standing']]),
    },
    { id: 'easing', section: 'behaviour', kind: 'multi', text: 'What makes it better?', options: opt([['rest', 'Rest'], ['movement', 'Gentle movement'], ['ice', 'Ice'], ['heat', 'Heat'], ['medication', 'Pain medication'], ['nothing', 'Nothing helps']]) },
    { id: 'swelling', section: 'knee', kind: 'single', text: 'Has the knee swollen?', options: opt([['none', 'No'], ['within_2h', 'Yes — within 2 hours of an injury'], ['after_6h', 'Yes — later the same day or next day'], ['comes_goes', 'It comes and goes']]), showIf: hasKnee },
    { id: 'locking', section: 'knee', kind: 'single', text: 'Does the knee catch or lock?', options: opt([['no', 'No'], ['catching', 'It catches or clicks painfully'], ['true_locking', 'It gets stuck and I have to wiggle it free']]), showIf: hasKnee },
    { id: 'giving_way', section: 'knee', kind: 'single', text: 'Does the knee give way?', options: opt([['no', 'No'], ['occasional', 'Occasionally'], ['frequent', 'Often']]), showIf: hasKnee },
    { id: 'func_stairs', section: 'function', kind: 'scale04', text: 'Difficulty with stairs' },
    { id: 'func_squat', section: 'function', kind: 'scale04', text: 'Difficulty squatting or kneeling', showIf: hasKnee },
    { id: 'func_walk', section: 'function', kind: 'scale04', text: 'Difficulty walking for 10 minutes' },
    { id: 'func_chair', section: 'function', kind: 'scale04', text: 'Difficulty getting up from a chair' },
    { id: 'prev_injury', section: 'history', kind: 'single', text: 'Have you injured or had surgery on this area before?', options: opt([['no', 'No'], ['yes', 'Yes']]) },
    { id: 'prev_injury_detail', section: 'history', kind: 'text', text: 'Tell us briefly what happened before', showIf: (c) => c.answers.prev_injury === 'yes' },
    { id: 'conditions', section: 'history', kind: 'multi', text: 'Do you have any of these?', options: opt([['diabetes', 'Diabetes'], ['inflammatory_arthritis', 'Rheumatoid or other inflammatory arthritis'], ['osteoporosis', 'Osteoporosis'], ['heart', 'Heart condition'], ['none', 'None of these']]) },
    { id: 'prior_care', section: 'history', kind: 'multi', text: 'What care have you had for this so far?', options: opt([['physio', 'Physiotherapy'], ['injection', 'Injection'], ['imaging', 'X-ray / scan'], ['surgery', 'Surgery'], ['medication', 'Medication'], ['none', 'None yet']]) },
    { id: 'occupation', section: 'context', kind: 'single', text: 'What is your main daily activity?', options: opt([['desk', 'Desk / seated work'], ['standing', 'Standing work'], ['manual', 'Manual / physical work'], ['student', 'Studying'], ['home', 'Home duties'], ['retired', 'Retired']]) },
    { id: 'activity', section: 'context', kind: 'single', text: 'Sport or exercise level', options: opt([['sedentary', 'Little regular exercise'], ['recreational', 'Recreational'], ['competitive', 'Competitive sport']]) },
    { id: 'goal', section: 'goals', kind: 'text', required: true, text: 'What would you most like to be able to do again?' },
  ] as Question[],
};

export function visibleQuestions(ctx: IntakeContext, qn: Questionnaire = HISTORY_QUESTIONNAIRE): Question[] {
  return qn.questions.filter((q) => !q.showIf || q.showIf(ctx));
}

export function optionLabel(qid: string, v: string, qn: Questionnaire = HISTORY_QUESTIONNAIRE): string {
  const q = qn.questions.find((x) => x.id === qid);
  return q?.options?.find((o) => o.id === v)?.label ?? v;
}

export function formatAnswer(qid: string, v: AnswerValue, qn: Questionnaire = HISTORY_QUESTIONNAIRE): string {
  const q = qn.questions.find((x) => x.id === qid);
  if (v === null || v === undefined || v === '') return '—';
  if (q?.kind === 'scale04' && typeof v === 'number') return `${v}/4 (${SCALE04[v]})`;
  if (q?.kind === 'nprs' && typeof v === 'number') return `${v}/10`;
  if (Array.isArray(v)) return v.map((x) => optionLabel(qid, x, qn)).join(', ') || '—';
  if (typeof v === 'string') return optionLabel(qid, v, qn);
  return String(v);
}

export interface SummaryLine {
  key: string;
  text: string;
  /** Question ids whose answers support this line (for traceability). */
  sources: string[];
}

/**
 * Rule-based (not LLM) organisation of the patient's own answers into a readable history. Each
 * line lists the answers it came from; clinicians can amend a line without altering the answers.
 */
export function organiseHistory(answers: Record<string, AnswerValue>, regions: PainRegion[], qn: Questionnaire = HISTORY_QUESTIONNAIRE): SummaryLine[] {
  const L: SummaryLine[] = [];
  const f = (qid: string, v: AnswerValue) => formatAnswer(qid, v, qn);
  const where = regions.map((r) => r.regionId.replace(/_/g, ' ')).join(', ');
  if (where) L.push({ key: 'location', text: `Symptoms reported at: ${where}.`, sources: ['symptom_map'] });
  if (answers.onset) {
    let t = `Onset: ${f('onset', answers.onset).toLowerCase()}`;
    if (answers.mechanism) t += ` (${f('mechanism', answers.mechanism).toLowerCase()})`;
    if (answers.surgery_type) t += ` — ${f('surgery_type', answers.surgery_type)}${answers.surgery_date ? ` on ${answers.surgery_date}` : ''}`;
    L.push({ key: 'onset', text: `${t}; duration ${f('duration', answers.duration).toLowerCase()}.`, sources: ['onset', 'mechanism', 'surgery_type', 'surgery_date', 'duration'].filter((k) => answers[k] !== undefined) });
  }
  if (answers.nprs_now !== undefined) L.push({ key: 'intensity', text: `Pain now ${answers.nprs_now}/10, worst in 24 h ${answers.nprs_worst ?? '—'}/10${answers.nprs_best !== undefined ? `, least ${answers.nprs_best}/10` : ''}.`, sources: ['nprs_now', 'nprs_worst', 'nprs_best'].filter((k) => answers[k] !== undefined) });
  const beh: string[] = [];
  if (answers.pattern) beh.push(f('pattern', answers.pattern).toLowerCase());
  if (answers.time_of_day) beh.push(`worst ${f('time_of_day', answers.time_of_day).toLowerCase()}`);
  if (answers.morning_stiffness) beh.push(`morning stiffness: ${f('morning_stiffness', answers.morning_stiffness).toLowerCase()}`);
  if (answers.night) beh.push(`night: ${f('night', answers.night).toLowerCase()}`);
  if (beh.length) L.push({ key: 'behaviour', text: `Behaviour: ${beh.join('; ')}.`, sources: ['pattern', 'time_of_day', 'morning_stiffness', 'night'].filter((k) => answers[k] !== undefined) });
  if (answers.aggravating || answers.easing)
    L.push({ key: 'factors', text: `Worse with: ${f('aggravating', answers.aggravating ?? null).toLowerCase()}. Better with: ${f('easing', answers.easing ?? null).toLowerCase()}.`, sources: ['aggravating', 'easing'].filter((k) => answers[k] !== undefined) });
  const knee: string[] = [];
  if (answers.swelling) knee.push(`swelling: ${f('swelling', answers.swelling).toLowerCase()}`);
  if (answers.locking) knee.push(`catching/locking: ${f('locking', answers.locking).toLowerCase()}`);
  if (answers.giving_way) knee.push(`giving way: ${f('giving_way', answers.giving_way).toLowerCase()}`);
  if (knee.length) L.push({ key: 'knee', text: `Knee: ${knee.join('; ')}.`, sources: ['swelling', 'locking', 'giving_way'].filter((k) => answers[k] !== undefined) });
  const sh: string[] = [];
  if (answers.dominant_arm) sh.push(`dominant arm: ${f('dominant_arm', answers.dominant_arm).toLowerCase()}`);
  if (answers.instability) sh.push(`feels unstable: ${f('instability', answers.instability).toLowerCase()}`);
  if (answers.arm_symptoms) sh.push(`arm symptoms: ${f('arm_symptoms', answers.arm_symptoms).toLowerCase()}`);
  if (answers.neck_link) sh.push(`neck movement brings it on: ${f('neck_link', answers.neck_link).toLowerCase()}`);
  if (sh.length) L.push({ key: 'shoulder', text: `Shoulder: ${sh.join('; ')}.`, sources: ['dominant_arm', 'instability', 'arm_symptoms', 'neck_link'].filter((k) => answers[k] !== undefined) });
  const func = qn.questions.filter((q) => q.section === 'function' && typeof answers[q.id] === 'number');
  if (func.length) L.push({ key: 'function', text: `Function (0 none – 4 unable): ${func.map((q) => `${q.text.replace('Difficulty ', '')} ${answers[q.id]}`).join(', ')}.`, sources: func.map((q) => q.id) });
  const hist: string[] = [];
  if (answers.prev_injury) hist.push(`previous injury/surgery: ${f('prev_injury', answers.prev_injury).toLowerCase()}${answers.prev_injury_detail ? ` (${answers.prev_injury_detail})` : ''}`);
  if (answers.conditions) hist.push(`conditions: ${f('conditions', answers.conditions).toLowerCase()}`);
  if (answers.prior_care) hist.push(`care so far: ${f('prior_care', answers.prior_care).toLowerCase()}`);
  if (hist.length) L.push({ key: 'history', text: `History: ${hist.join('; ')}.`, sources: ['prev_injury', 'prev_injury_detail', 'conditions', 'prior_care'].filter((k) => answers[k] !== undefined) });
  if (answers.occupation || answers.activity) L.push({ key: 'context', text: `Activity: ${f('occupation', answers.occupation ?? null).toLowerCase()}; exercise: ${f('activity', answers.activity ?? null).toLowerCase()}.`, sources: ['occupation', 'activity'].filter((k) => answers[k] !== undefined) });
  if (answers.goal) L.push({ key: 'goal', text: `Goal: “${answers.goal}”.`, sources: ['goal'] });
  return L;
}

// ---------------------------------------------------------------------------------------------
// Shoulder history — DRAFT for clinical-lead review (approval on hold). Shared questions keep
// the same ids and wording as the knee questionnaire so answers stay comparable.
// ---------------------------------------------------------------------------------------------
const shared = (id: string) => HISTORY_QUESTIONNAIRE.questions.find((q) => q.id === id)!;

export const SHOULDER_HISTORY_QUESTIONNAIRE: Questionnaire = {
  id: 'shoulder-history',
  version: '1.0.0',
  status: 'DRAFT — pending clinical-lead approval',
  questions: [
    shared('onset'),
    {
      id: 'mechanism',
      section: 'onset',
      kind: 'multi',
      text: 'What happened at the time?',
      options: opt([['fall_hand', 'Fell onto an outstretched hand or elbow'], ['fall_shoulder', 'Fell onto the shoulder'], ['lifting', 'Lifting, pulling or catching something heavy'], ['overhead', 'Reaching overhead or throwing'], ['out_of_joint', 'The shoulder came out of joint'], ['other', 'Something else']]),
      showIf: (c) => c.answers.onset === 'sudden',
    },
    { id: 'surgery_type', section: 'onset', kind: 'single', text: 'What surgery did you have?', options: opt([['cuff_repair', 'Tendon (rotator cuff) repair'], ['stabilisation', 'Stabilisation after dislocation'], ['decompression', 'Decompression'], ['replacement', 'Shoulder replacement'], ['fracture_fixation', 'Fracture fixation'], ['other', 'Other / not sure']]), showIf: (c) => c.answers.onset === 'after_surgery' },
    shared('surgery_date'),
    shared('duration'),
    { id: 'dominant_arm', section: 'shoulder', kind: 'single', required: true, text: 'Which is your dominant (writing) arm?', options: opt([['right', 'Right'], ['left', 'Left'], ['both', 'Both equally']]) },
    shared('nprs_now'),
    shared('nprs_worst'),
    shared('nprs_best'),
    shared('pattern'),
    shared('time_of_day'),
    shared('morning_stiffness'),
    { id: 'night', section: 'behaviour', kind: 'single', text: 'How is it at night?', options: opt([['none', 'No trouble at night'], ['position', 'Only when I lie on that shoulder'], ['wakes_often', 'Wakes me most nights']]) },
    {
      id: 'aggravating',
      section: 'behaviour',
      kind: 'multi',
      text: 'What makes it worse?',
      options: opt([['reach_overhead', 'Reaching up or overhead'], ['reach_behind', 'Reaching behind my back'], ['lifting', 'Lifting or carrying'], ['lying_on_side', 'Lying on that side'], ['dressing', 'Dressing'], ['pushing_pulling', 'Pushing or pulling'], ['throwing', 'Throwing or sport'], ['desk', 'Desk or computer work']]),
    },
    shared('easing'),
    { id: 'instability', section: 'shoulder', kind: 'single', text: 'Does the shoulder ever feel like it slips or moves out of place?', options: opt([['no', 'No'], ['sometimes', 'Sometimes'], ['often', 'Often']]), showIf: hasShoulder },
    { id: 'arm_symptoms', section: 'shoulder', kind: 'multi', text: 'Do you have any of these down the arm?', options: opt([['below_elbow', 'Pain spreading below the elbow'], ['pins_needles', 'Pins and needles'], ['numbness', 'Numbness'], ['none', 'None of these']]), showIf: hasShoulder },
    { id: 'neck_link', section: 'shoulder', kind: 'single', text: 'Does moving your neck bring on the shoulder or arm symptoms?', options: opt([['no', 'No'], ['yes', 'Yes'], ['unsure', 'Not sure']]), showIf: hasShoulder },
    { id: 'func_overhead', section: 'function', kind: 'scale04', text: 'Difficulty reaching a high shelf' },
    { id: 'func_behind_back', section: 'function', kind: 'scale04', text: 'Difficulty reaching behind your back (e.g. tucking in a shirt)' },
    { id: 'func_carry', section: 'function', kind: 'scale04', text: 'Difficulty carrying a full shopping bag on that side' },
    { id: 'func_dressing', section: 'function', kind: 'scale04', text: 'Difficulty getting dressed' },
    shared('prev_injury'),
    shared('prev_injury_detail'),
    shared('conditions'),
    shared('prior_care'),
    shared('occupation'),
    shared('activity'),
    shared('goal'),
  ],
};

/** Latest, non-superseded answer per question. */
export function currentAnswers(rows: IntakeAnswer[]): Record<string, AnswerValue> {
  const out: Record<string, AnswerValue> = {};
  for (const r of [...rows].filter((r) => !r.supersededBy).sort((a, b) => a.answeredAt.localeCompare(b.answeredAt))) out[r.questionId] = r.answer;
  return out;
}
