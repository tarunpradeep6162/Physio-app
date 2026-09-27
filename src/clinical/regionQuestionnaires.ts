import { HISTORY_QUESTIONNAIRE, type IntakeContext, type Question, type Questionnaire } from './intake';
import type { SafetyQuestionnaire } from './safety';

/**
 * History and safety (red-flag) questionnaires for the hip, ankle and foot, spine and neck, and
 * balance pathways (Phases 12–15). DRAFT content for clinical-lead review — approval is on hold,
 * and every item carries that status. Shared questions keep the knee questionnaire's ids and
 * wording so answers stay comparable across regions. Nothing here scores or predicts anything:
 * answers are stored verbatim and shown to the clinician; red-flag items route to a safety action.
 */

const opt = (pairs: [string, string][]) => pairs.map(([id, label]) => ({ id, label }));
const shared = (id: string) => HISTORY_QUESTIONNAIRE.questions.find((q) => q.id === id)!;
const DRAFT = 'DRAFT — pending clinical-lead approval';
const SAFETY_DRAFT = 'DRAFT — requires clinical-lead approval before patient use';
const any = (prefixes: string[]) => (c: IntakeContext) => c.regions.some((r) => prefixes.some((p) => r.regionId.startsWith(p)));

const common = (extraFunction: Question[], aggravating: [string, string][], mechanism: [string, string][], surgery: [string, string][], region: Question[]): Question[] => [
  shared('onset'),
  { id: 'mechanism', section: 'onset', kind: 'multi', text: 'What happened at the time?', options: opt(mechanism), showIf: (c) => c.answers.onset === 'sudden' },
  { id: 'surgery_type', section: 'onset', kind: 'single', text: 'What surgery did you have?', options: opt(surgery), showIf: (c) => c.answers.onset === 'after_surgery' },
  shared('surgery_date'),
  shared('duration'),
  shared('nprs_now'),
  shared('nprs_worst'),
  shared('nprs_best'),
  shared('pattern'),
  shared('time_of_day'),
  shared('morning_stiffness'),
  shared('night'),
  { id: 'aggravating', section: 'behaviour', kind: 'multi', text: 'What makes it worse?', options: opt(aggravating) },
  shared('easing'),
  ...region,
  ...extraFunction,
  shared('prev_injury'),
  shared('prev_injury_detail'),
  shared('conditions'),
  shared('prior_care'),
  shared('occupation'),
  shared('activity'),
  shared('goal'),
];

// ---------------------------------------------------------------------------------------------
// Hip
// ---------------------------------------------------------------------------------------------
const hasHip = any(['hip', 'groin', 'buttock']);
export const HIP_HISTORY_QUESTIONNAIRE: Questionnaire = {
  id: 'hip-history',
  version: '1.0.0',
  status: DRAFT,
  questions: common(
    [
      { id: 'func_socks', section: 'function', kind: 'scale04', text: 'Difficulty putting on socks and shoes' },
      shared('func_stairs'),
      shared('func_walk'),
      { id: 'func_car', section: 'function', kind: 'scale04', text: 'Difficulty getting in or out of a car' },
      shared('func_chair'),
    ],
    [['walking', 'Walking'], ['stairs_up', 'Going up stairs'], ['prolonged_sitting', 'Sitting for a long time'], ['car', 'Getting in or out of a car'], ['lying_on_side', 'Lying on that side'], ['socks', 'Putting on socks'], ['running', 'Running or sport'], ['standing', 'Standing']],
    [['fall', 'A fall'], ['twisting', 'Twisting or pivoting'], ['kicking', 'Kicking or sprinting'], ['lifting', 'Lifting'], ['other', 'Something else']],
    [['replacement', 'Hip replacement'], ['arthroscopy', 'Keyhole (arthroscopy)'], ['fracture_fixation', 'Fracture fixation'], ['other', 'Other / not sure']],
    [
      { id: 'hip_location', section: 'region', kind: 'multi', text: 'Where exactly is it?', options: opt([['groin', 'Groin / front of hip'], ['outer', 'Outer side of the hip'], ['buttock', 'Buttock'], ['thigh', 'Down the thigh'], ['below_knee', 'Below the knee']]), showIf: hasHip },
      { id: 'hip_clicking', section: 'region', kind: 'single', text: 'Does the hip click, catch or lock painfully?', options: opt([['no', 'No'], ['click', 'Clicks or catches'], ['lock', 'Sometimes gets stuck']]), showIf: hasHip },
      { id: 'hip_limp', section: 'region', kind: 'single', text: 'Do you limp?', options: opt([['no', 'No'], ['sometimes', 'Sometimes'], ['always', 'Most of the time']]) },
    ],
  ),
};

export const HIP_SAFETY_QUESTIONNAIRE: SafetyQuestionnaire = {
  id: 'hip-safety',
  version: '1.0.0',
  status: SAFETY_DRAFT,
  items: [
    { id: 'fall_cannot_weight_bear', text: 'After a fall, are you unable to stand or walk on the leg, or does the leg look shorter or turned outwards?', action: 'emergency', rationale: 'Possible hip fracture — emergency assessment.' },
    { id: 'replacement_dislocation', text: 'If you have a hip replacement: did it suddenly give way with severe pain, and now you cannot move the leg?', action: 'emergency', rationale: 'Possible dislocation of a hip replacement.' },
    { id: 'hot_swollen_fever', text: 'Is the hip very painful to move AND do you feel feverish or generally unwell?', action: 'emergency', rationale: 'Possible joint infection — same-day emergency assessment.' },
    { id: 'saddle_bladder', text: 'Do you have numbness around the groin or buttocks, or new bladder or bowel problems?', action: 'emergency', rationale: 'Possible cauda equina syndrome.' },
    { id: 'chest_breath', text: 'Do you have new chest pain or unexplained shortness of breath?', action: 'emergency', rationale: 'Possible cardiorespiratory event or pulmonary embolism.' },
    { id: 'calf', text: 'Is your calf swollen, warm, red or very tender — especially after surgery or long travel?', action: 'urgent', rationale: 'Possible deep vein thrombosis.' },
    { id: 'wound', text: 'If you had recent surgery: is the wound red, leaking or opening?', action: 'urgent', rationale: 'Possible wound infection.' },
    { id: 'progressive_weakness', text: 'Is weakness or numbness in the leg rapidly getting worse?', action: 'urgent', rationale: 'Possible progressive neurological deficit.' },
    { id: 'night_unrelieved', text: 'Do you have severe, constant pain at night that no position eases?', action: 'clinician_review', rationale: 'Non-mechanical pain pattern needs clinical review.' },
    { id: 'cancer_weight', text: 'Do you have a history of cancer, or unexplained weight loss?', action: 'clinician_review', rationale: 'Screening for serious pathology.' },
  ],
};

// ---------------------------------------------------------------------------------------------
// Ankle and foot
// ---------------------------------------------------------------------------------------------
const hasAnkle = any(['ankle', 'foot', 'calf']);
export const ANKLE_HISTORY_QUESTIONNAIRE: Questionnaire = {
  id: 'ankle-history',
  version: '1.0.0',
  status: DRAFT,
  questions: common(
    [
      shared('func_stairs'),
      { id: 'func_uneven', section: 'function', kind: 'scale04', text: 'Difficulty walking on uneven ground' },
      { id: 'func_tiptoe', section: 'function', kind: 'scale04', text: 'Difficulty standing on tiptoe' },
      { id: 'func_hop', section: 'function', kind: 'scale04', text: 'Difficulty running or hopping' },
      shared('func_walk'),
    ],
    [['walking', 'Walking'], ['first_steps', 'First steps in the morning'], ['stairs_down', 'Going down stairs'], ['uneven', 'Uneven ground'], ['running', 'Running or jumping'], ['standing', 'Standing'], ['footwear', 'Certain footwear']],
    [['rolled_in', 'Rolled the ankle inwards'], ['rolled_out', 'Rolled the ankle outwards'], ['landing', 'Landed badly from a jump'], ['snap_back', 'Felt a snap or kick at the back of the ankle'], ['direct_blow', 'A direct blow'], ['other', 'Something else']],
    [['ligament', 'Ligament repair or reconstruction'], ['fracture_fixation', 'Fracture fixation'], ['achilles', 'Achilles tendon repair'], ['other', 'Other / not sure']],
    [
      { id: 'ankle_swelling', section: 'region', kind: 'single', text: 'Has the ankle or foot swollen?', options: opt([['none', 'No'], ['within_2h', 'Yes — within 2 hours of an injury'], ['later', 'Yes — later'], ['comes_goes', 'It comes and goes']]), showIf: hasAnkle },
      { id: 'ankle_giving_way', section: 'region', kind: 'single', text: 'Does the ankle give way or feel unstable?', options: opt([['no', 'No'], ['uneven', 'Only on uneven ground'], ['often', 'Often']]), showIf: hasAnkle },
      { id: 'previous_sprains', section: 'region', kind: 'single', text: 'Have you sprained this ankle before?', options: opt([['no', 'No'], ['once', 'Once'], ['several', 'Several times']]), showIf: hasAnkle },
    ],
  ),
};

export const ANKLE_SAFETY_QUESTIONNAIRE: SafetyQuestionnaire = {
  id: 'ankle-safety',
  version: '1.0.0',
  status: SAFETY_DRAFT,
  items: [
    { id: 'cold_pale_foot', text: 'Is the foot cold, pale or blue, or very painful even at rest?', action: 'emergency', rationale: 'Possible loss of blood supply to the foot.' },
    { id: 'deformity', text: 'After an injury, does the ankle or foot look deformed or out of place?', action: 'emergency', rationale: 'Possible dislocation or fracture.' },
    { id: 'hot_swollen_fever', text: 'Is the ankle or foot hot, red and swollen AND do you feel feverish or unwell?', action: 'emergency', rationale: 'Possible joint or soft-tissue infection.' },
    { id: 'chest_breath', text: 'Do you have new chest pain or unexplained shortness of breath?', action: 'emergency', rationale: 'Possible pulmonary embolism.' },
    { id: 'cannot_weight_bear', text: 'Since a recent injury, have you been unable to take 4 steps on the foot?', action: 'urgent', rationale: 'Possible fracture — medical assessment/imaging decision (inspired by the Ottawa ankle rules).' },
    { id: 'achilles_snap', text: 'Did you feel a sudden snap or kick at the back of the ankle, and now struggle to push off or stand on tiptoe?', action: 'urgent', rationale: 'Possible Achilles tendon rupture — time-sensitive treatment decision.' },
    { id: 'calf', text: 'Is your calf swollen, warm, red or very tender — especially after surgery, a cast or long travel?', action: 'urgent', rationale: 'Possible deep vein thrombosis.' },
    { id: 'diabetic_foot', text: 'If you have diabetes: is there a wound, a colour change, or a new hot swollen foot?', action: 'urgent', rationale: 'Possible diabetic foot infection or Charcot foot.' },
    { id: 'progressive_weakness', text: 'Is the foot getting weaker quickly — for example it slaps down or you trip over it?', action: 'urgent', rationale: 'Possible progressive neurological deficit (foot drop).' },
    { id: 'night_unrelieved', text: 'Do you have severe, constant pain at night that no position eases?', action: 'clinician_review', rationale: 'Non-mechanical pain pattern needs clinical review.' },
  ],
};

// ---------------------------------------------------------------------------------------------
// Spine and neck
// ---------------------------------------------------------------------------------------------
const hasNeck = any(['neck', 'upper_back', 'head']);
const hasBack = any(['lower_back', 'mid_back', 'flank', 'buttock']);
export const SPINE_HISTORY_QUESTIONNAIRE: Questionnaire = {
  id: 'spine-history',
  version: '1.0.0',
  status: DRAFT,
  questions: common(
    [
      { id: 'func_sitting', section: 'function', kind: 'scale04', text: 'Difficulty sitting for 30 minutes' },
      { id: 'func_bending', section: 'function', kind: 'scale04', text: 'Difficulty bending to pick something up from the floor' },
      { id: 'func_turn_head', section: 'function', kind: 'scale04', text: 'Difficulty turning your head (e.g. when driving)', showIf: hasNeck },
      { id: 'func_lifting', section: 'function', kind: 'scale04', text: 'Difficulty lifting a full shopping bag' },
      shared('func_walk'),
    ],
    [['bending', 'Bending forward'], ['leaning_back', 'Leaning back'], ['prolonged_sitting', 'Sitting for a long time'], ['standing', 'Standing'], ['walking', 'Walking'], ['lifting', 'Lifting'], ['coughing', 'Coughing or sneezing'], ['looking_down', 'Looking down (phone, desk)'], ['turning_head', 'Turning the head']],
    [['lifting', 'Lifting or twisting'], ['fall', 'A fall'], ['road_accident', 'A road accident'], ['sport', 'Sport'], ['other', 'Something else']],
    [['decompression', 'Decompression'], ['discectomy', 'Disc surgery'], ['fusion', 'Fusion'], ['other', 'Other / not sure']],
    [
      { id: 'leg_symptoms', section: 'region', kind: 'multi', text: 'Do you have any of these in the legs?', options: opt([['below_knee', 'Pain spreading below the knee'], ['pins_needles', 'Pins and needles'], ['numbness', 'Numbness'], ['none', 'None of these']]), showIf: hasBack },
      { id: 'arm_symptoms', section: 'region', kind: 'multi', text: 'Do you have any of these in the arms?', options: opt([['below_elbow', 'Pain spreading below the elbow'], ['pins_needles', 'Pins and needles'], ['numbness', 'Numbness'], ['none', 'None of these']]), showIf: hasNeck },
      { id: 'headache', section: 'region', kind: 'single', text: 'Do you get headaches with the neck pain?', options: opt([['no', 'No'], ['sometimes', 'Sometimes'], ['often', 'Often']]), showIf: hasNeck },
      { id: 'sitting_vs_standing', section: 'region', kind: 'single', text: 'Which is worse?', options: opt([['sitting', 'Sitting'], ['standing', 'Standing or walking'], ['same', 'No difference']]), showIf: hasBack },
    ],
  ),
};

export const SPINE_SAFETY_QUESTIONNAIRE: SafetyQuestionnaire = {
  id: 'spine-safety',
  version: '1.0.0',
  status: SAFETY_DRAFT,
  items: [
    { id: 'saddle_bladder', text: 'Do you have numbness around the groin, genitals or buttocks, or new problems passing urine, controlling your bladder or bowels, or with sexual function?', action: 'emergency', rationale: 'Possible cauda equina syndrome — emergency.' },
    { id: 'neuro_vascular', text: 'Since this started, or when you move your neck: dizziness or blackouts, double vision, difficulty speaking or swallowing, or numbness of the face?', action: 'emergency', rationale: 'Possible vascular or brainstem cause — emergency assessment.' },
    { id: 'chest_breath', text: 'Is the pain also in your chest, or with breathlessness, sweating or feeling faint?', action: 'emergency', rationale: 'Possible cardiac or other serious cause of spinal pain.' },
    { id: 'trauma', text: 'Did the pain start after a significant fall, accident or blow?', action: 'urgent', rationale: 'Possible fracture — medical assessment.' },
    { id: 'fever_unwell', text: 'Do you have a fever or feel generally unwell along with the pain?', action: 'urgent', rationale: 'Possible spinal infection.' },
    { id: 'progressive_weakness', text: 'Is weakness or numbness in the legs or arms getting worse?', action: 'urgent', rationale: 'Possible progressive neurological deficit.' },
    { id: 'myelopathy', text: 'Do you have new clumsiness in your hands, or problems with balance or walking?', action: 'urgent', rationale: 'Possible spinal cord compression.' },
    { id: 'cancer_new_pain', text: 'Have you ever had cancer, and is this new back or neck pain?', action: 'urgent', rationale: 'Screening for spinal metastases — prompt medical review.' },
    { id: 'steroid_osteoporosis', text: 'Have you taken steroid tablets for a long time or been told you have osteoporosis, and the pain started suddenly?', action: 'clinician_review', rationale: 'Possible fragility fracture.' },
    { id: 'night_unrelieved', text: 'Do you have severe, constant pain at night that no position eases?', action: 'clinician_review', rationale: 'Non-mechanical pain pattern needs clinical review.' },
  ],
};

// ---------------------------------------------------------------------------------------------
// Balance, falls and mobility
// ---------------------------------------------------------------------------------------------
export const BALANCE_HISTORY_QUESTIONNAIRE: Questionnaire = {
  id: 'balance-history',
  version: '1.0.0',
  status: DRAFT,
  questions: [
    { id: 'falls_12m', section: 'region', kind: 'single', required: true, text: 'How many times have you fallen in the last 12 months?', options: opt([['0', 'None'], ['1', 'Once'], ['2plus', 'Twice or more']]) },
    { id: 'fall_injury', section: 'region', kind: 'single', text: 'Were you hurt, or unable to get up by yourself, after a fall?', options: opt([['no', 'No'], ['hurt', 'I was hurt'], ['could_not_get_up', 'I could not get up by myself']]), showIf: (c) => c.answers.falls_12m === '1' || c.answers.falls_12m === '2plus' },
    { id: 'fear_of_falling', section: 'region', kind: 'single', text: 'Are you worried about falling?', options: opt([['no', 'No'], ['somewhat', 'Somewhat'], ['very', 'Very']]) },
    { id: 'unsteady', section: 'region', kind: 'multi', text: 'When do you feel unsteady?', options: opt([['standing_up', 'Standing up'], ['turning', 'Turning around'], ['stairs', 'On stairs'], ['outdoors', 'Walking outdoors'], ['dark', 'In the dark'], ['never', 'I don’t feel unsteady']]) },
    { id: 'dizziness', section: 'region', kind: 'multi', text: 'Do you get any of these?', options: opt([['spinning', 'The room spinning'], ['lightheaded', 'Light-headed on standing'], ['off_balance', 'Feeling off-balance'], ['none', 'None of these']]) },
    { id: 'walking_aid', section: 'region', kind: 'single', text: 'Do you use a walking aid?', options: opt([['none', 'No'], ['stick', 'A stick'], ['frame', 'A frame or walker'], ['wheelchair', 'A wheelchair for longer distances']]) },
    { id: 'medicines_count', section: 'history', kind: 'single', text: 'How many different medicines do you take each day?', options: opt([['0_3', '0–3'], ['4plus', '4 or more'], ['unsure', 'Not sure']]) },
    { id: 'vision', section: 'history', kind: 'single', text: 'Is your eyesight a problem for getting around?', options: opt([['no', 'No'], ['somewhat', 'Somewhat'], ['yes', 'Yes']]) },
    { id: 'func_chair_no_arms', section: 'function', kind: 'scale04', text: 'Difficulty standing up from a chair without using your arms' },
    { id: 'func_outdoors', section: 'function', kind: 'scale04', text: 'Difficulty walking outdoors' },
    shared('func_stairs'),
    { id: 'func_floor', section: 'function', kind: 'scale04', text: 'Difficulty getting up from the floor' },
    shared('conditions'),
    shared('goal'),
  ],
};

export const BALANCE_SAFETY_QUESTIONNAIRE: SafetyQuestionnaire = {
  id: 'balance-safety',
  version: '1.0.0',
  status: SAFETY_DRAFT,
  items: [
    { id: 'stroke_signs', text: 'Do you have any NEW face drooping, arm or leg weakness, or difficulty speaking?', action: 'emergency', rationale: 'Possible stroke — call emergency services.' },
    { id: 'chest_breath', text: 'Do you have chest pain, a racing or irregular heartbeat, or breathlessness when you feel unsteady?', action: 'emergency', rationale: 'Possible cardiac cause.' },
    { id: 'blackout', text: 'Have you blacked out or nearly fainted recently?', action: 'urgent', rationale: 'Loss of consciousness needs medical assessment before balance testing.' },
    { id: 'sudden_vertigo', text: 'Did severe dizziness or unsteadiness start suddenly in the last few days?', action: 'urgent', rationale: 'Acute vestibular or neurological cause needs medical assessment.' },
    { id: 'head_injury', text: 'Have you hit your head in a fall in the last week — especially if you take blood thinners?', action: 'urgent', rationale: 'Possible head injury complication.' },
    { id: 'cannot_stand_alone', text: 'Do you need another person’s help to stand up or to stand still?', action: 'clinician_review', rationale: 'Camera balance tests are not safe unsupervised — the clinician decides how to test.' },
    { id: 'repeated_falls', text: 'Have you fallen two or more times in the last 12 months?', action: 'clinician_review', rationale: 'Balance tests only with the clinician’s go-ahead and supervision.' },
  ],
};
