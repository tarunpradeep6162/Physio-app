import type { SafetyAction, SafetyLevel, SafetyResponse } from '../data/models';

/**
 * Safety (red-flag) questionnaire. Criteria and actions are clinician-authored, versioned rules —
 * no model or LLM may add, remove or reinterpret them. This version is a DRAFT: it is shown as
 * such until a clinical lead records approval in Settings.
 */

export interface SafetyItem {
  id: string;
  text: string;
  action: SafetyAction;
  rationale: string;
}

export interface SafetyQuestionnaire {
  id: string;
  version: string;
  status: string;
  items: SafetyItem[];
}

export const SAFETY_QUESTIONNAIRE: SafetyQuestionnaire = {
  id: 'knee-safety',
  version: '1.0.0',
  status: 'DRAFT — requires clinical-lead approval before patient use',
  items: [
    { id: 'hot_swollen_fever', text: 'Is the knee hot, red and swollen AND do you feel feverish or generally unwell?', action: 'emergency', rationale: 'Possible joint infection — same-day emergency assessment.' },
    { id: 'deformity', text: 'After an injury, did the knee look deformed or out of place?', action: 'emergency', rationale: 'Possible dislocation or fracture.' },
    { id: 'chest_breath', text: 'Do you have new chest pain or unexplained shortness of breath?', action: 'emergency', rationale: 'Possible cardiorespiratory event or pulmonary embolism.' },
    { id: 'saddle_bladder', text: 'Do you have numbness around the groin/buttocks, or new bladder or bowel problems?', action: 'emergency', rationale: 'Possible cauda equina syndrome.' },
    { id: 'calf', text: 'Is your calf swollen, warm, red or very tender — especially after surgery or long travel?', action: 'urgent', rationale: 'Possible deep vein thrombosis.' },
    { id: 'cannot_weight_bear', text: 'Since a recent injury, have you been unable to take 4 steps or put weight on the leg?', action: 'urgent', rationale: 'Possible fracture — medical assessment/imaging decision (inspired by the Ottawa knee rule).' },
    { id: 'wound', text: 'If you had recent surgery: is the wound red, leaking or opening?', action: 'urgent', rationale: 'Possible wound infection.' },
    { id: 'progressive_weakness', text: 'Is weakness or numbness in the leg rapidly getting worse?', action: 'urgent', rationale: 'Possible progressive neurological deficit.' },
    { id: 'locked', text: 'Is the knee locked — you cannot straighten it at all?', action: 'clinician_review', rationale: 'Possible mechanical block; orthopaedic review may be needed.' },
    { id: 'night_unrelieved', text: 'Do you have severe, constant pain at night that no position eases?', action: 'clinician_review', rationale: 'Non-mechanical pain pattern needs clinical review.' },
    { id: 'cancer_weight', text: 'Do you have a history of cancer, or unexplained weight loss?', action: 'clinician_review', rationale: 'Screening for serious pathology.' },
  ] as SafetyItem[],
};

/**
 * Shoulder red-flag screen — DRAFT (approval on hold). Items cover causes of shoulder or arm pain
 * that need medical rather than physiotherapy care first; the wording and actions are the clinical
 * lead's to confirm. A camera cannot detect any of these.
 */
export const SHOULDER_SAFETY_QUESTIONNAIRE: SafetyQuestionnaire = {
  id: 'shoulder-safety',
  version: '1.0.0',
  status: 'DRAFT — requires clinical-lead approval before patient use',
  items: [
    { id: 'cardiac', text: 'Is the pain also in your chest or jaw, or does it come with breathlessness, sweating or feeling faint?', action: 'emergency', rationale: 'Possible cardiac cause of shoulder or arm pain.' },
    { id: 'hot_swollen_fever', text: 'Is the shoulder hot, red and swollen AND do you feel feverish or generally unwell?', action: 'emergency', rationale: 'Possible joint infection — same-day emergency assessment.' },
    { id: 'deformity', text: 'After an injury, does the shoulder look deformed or out of place right now?', action: 'emergency', rationale: 'Possible dislocation or fracture.' },
    { id: 'trauma_cannot_lift', text: 'Since a recent fall or injury, are you unable to lift the arm at all?', action: 'urgent', rationale: 'Possible fracture or acute tendon tear — prompt medical assessment.' },
    { id: 'arm_swelling', text: 'Is the whole arm or hand swollen, discoloured or heavy?', action: 'urgent', rationale: 'Possible blood clot or circulation problem in the arm.' },
    { id: 'progressive_weakness', text: 'Is weakness or numbness in the arm or hand rapidly getting worse?', action: 'urgent', rationale: 'Possible progressive neurological deficit.' },
    { id: 'myelopathy', text: 'Along with neck pain, do you have new clumsiness in both hands or problems with balance or walking?', action: 'urgent', rationale: 'Possible spinal cord compression in the neck.' },
    { id: 'wound', text: 'If you had recent surgery: is the wound red, leaking or opening?', action: 'urgent', rationale: 'Possible wound infection.' },
    { id: 'night_unrelieved', text: 'Do you have severe, constant pain at night that no position eases?', action: 'clinician_review', rationale: 'Non-mechanical pain pattern needs clinical review.' },
    { id: 'cancer_weight', text: 'Do you have a history of cancer, or unexplained weight loss?', action: 'clinician_review', rationale: 'Screening for serious pathology.' },
  ],
};

export const SAFETY_QUESTIONNAIRES: Record<string, SafetyQuestionnaire> = { [SAFETY_QUESTIONNAIRE.id]: SAFETY_QUESTIONNAIRE, [SHOULDER_SAFETY_QUESTIONNAIRE.id]: SHOULDER_SAFETY_QUESTIONNAIRE };

/** Registers additional regions' questionnaires (called by the pathway registry; avoids an import cycle). */
export function registerSafetyQuestionnaire(q: SafetyQuestionnaire) {
  SAFETY_QUESTIONNAIRES[q.id] = q;
}

const RANK: Record<SafetyLevel, number> = { clear: 0, clinician_review: 1, urgent: 2, emergency: 3 };

export function evaluateSafety(answers: Record<string, boolean>, qn: SafetyQuestionnaire = SAFETY_QUESTIONNAIRE): { level: SafetyLevel; triggered: SafetyItem[] } {
  const triggered = qn.items.filter((i) => answers[i.id] === true);
  let level: SafetyLevel = 'clear';
  for (const t of triggered) if (RANK[t.action] > RANK[level]) level = t.action;
  return { level, triggered };
}

/** Re-derives the level from stored responses, using the questionnaire each response was answered against. */
export function levelFromResponses(rows: SafetyResponse[]): SafetyLevel {
  const latest = new Map<string, SafetyResponse>();
  for (const r of [...rows].sort((a, b) => a.at.localeCompare(b.at))) latest.set(`${r.questionnaireId}:${r.questionId}`, r);
  let level: SafetyLevel = 'clear';
  const byQn = new Map<string, Record<string, boolean>>();
  for (const r of latest.values()) byQn.set(r.questionnaireId, { ...(byQn.get(r.questionnaireId) ?? {}), [r.questionId]: r.answer });
  for (const [qid, answers] of byQn) {
    const l = evaluateSafety(answers, SAFETY_QUESTIONNAIRES[qid] ?? SAFETY_QUESTIONNAIRE).level;
    if (RANK[l] > RANK[level]) level = l;
  }
  return level;
}

export const SAFETY_ACTION_TEXT: Record<SafetyLevel, { title: string; body: string }> = {
  emergency: { title: 'Seek emergency care now', body: 'One or more answers can be a sign of a condition that needs emergency medical attention. Do not do any tests or exercises. Call {emergency} or go to the nearest emergency department.' },
  urgent: { title: 'Get a medical assessment today', body: 'One or more answers need a same-day medical assessment. Camera tests and exercises are paused. Your physiotherapist has been alerted.' },
  clinician_review: { title: 'Your physiotherapist needs to review this first', body: 'Some answers need your physiotherapist to check before camera tests or exercises. They have been notified. You can still finish describing your symptoms.' },
  clear: { title: 'No safety concerns reported', body: '' },
};

/** Whether routine automated steps (camera tests, reasoning suggestions, exercise) may run. */
export function routineAllowed(level: SafetyLevel | undefined): boolean {
  return !level || level === 'clear';
}
