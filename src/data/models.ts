import type { ExerciseResult } from '../engine/exerciseRunner';
import type { ExercisePrescription } from '../engine/exercises/types';
import type { ActivitySample } from '../integrations/activity';
import type { ContentItem } from '../content/library';
import type { DeviceMeasurement } from '../interop/deviceMeasurements';
export type { DeviceMeasurement };
export type { ActivitySample };
import type { Provenance } from '../engine/provenance';
import type { CaptureConfig, ConditionMatch, ProtocolResult } from '../engine/protocols/types';
import type { Landmark, Side } from '../engine/types';

/**
 * Domain model. Mirrors db/schema.sql (PostgreSQL) one-to-one so a server-backed repository can
 * replace the local one without UI changes. All ids are UUIDs — sequential identifiers are never
 * exposed.
 */

export type ID = string;
export type ISODate = string;

export type Role = 'patient' | 'clinician';

export interface User {
  id: ID;
  email: string;
  passwordHash: string;
  passwordSalt: string;
  role: Role;
  displayName: string;
  createdAt: ISODate;
  isDemo?: boolean;
}

export interface Patient {
  id: ID;
  userId: ID | null;
  name: string;
  dob?: string;
  sex?: 'female' | 'male' | 'other';
  phone?: string;
  heightCm?: number;
  preferredLanguage: 'en' | 'ta';
  concern?: string;
  goal?: string;
  /** Patient-reported: equipment available at home (library equipment tags). */
  equipment?: string[];
  /** Patient-reported: minutes per day available for exercise. */
  minutesPerDay?: number;
  /**
   * Validation-study split, fixed per PARTICIPANT (never per clip) so tuning and final-evaluation
   * data never share a person.
   */
  validationSplit?: 'tuning' | 'evaluation';
  createdAt: ISODate;
  isDemo?: boolean;
}

export interface Clinician {
  id: ID;
  userId: ID | null;
  name: string;
  title: string;
  clinic: string;
  /** Staff listed for scheduling; false = no new bookings (existing ones are kept). */
  active?: boolean;
  createdAt: ISODate;
  isDemo?: boolean;
}

export interface CareRelationship {
  id: ID;
  patientId: ID;
  clinicianId: ID;
  status: 'active' | 'ended';
  createdAt: ISODate;
}

export type ConsentType = 'camera_processing' | 'data_storage' | 'image_storage' | 'research_export' | 'activity_steps' | 'activity_walking';

export interface Consent {
  id: ID;
  patientId: ID;
  type: ConsentType;
  granted: boolean;
  /** Version of the consent text the patient saw. */
  textVersion: string;
  at: ISODate;
}

export type AssessmentStatus = 'in_progress' | 'submitted' | 'reviewed' | 'safety_hold';

export type SafetyLevel = 'clear' | 'clinician_review' | 'urgent' | 'emergency';

export interface Assessment {
  id: ID;
  patientId: ID;
  createdBy: ID;
  status: AssessmentStatus;
  /** Body-region pathway. The first release implements the knee pathway end to end. */
  region?: 'knee' | 'shoulder' | 'hip' | 'ankle' | 'spine' | 'balance' | 'low_back' | 'general';
  type?: 'initial' | 'reassessment';
  baselineAssessmentId?: ID;
  safetyLevel?: SafetyLevel;
  createdAt: ISODate;
  submittedAt?: ISODate;
  reviewedAt?: ISODate;
  reviewedBy?: ID;
  /** Step the patient reached (for resuming interrupted assessments). */
  step: number;
  isDemo?: boolean;
}

export type SymptomType = 'pain' | 'stiffness' | 'weakness' | 'numbness' | 'tingling';

/** One symptomatic body region. Anatomy, side, symptom types and location are stored separately. */
export interface PainRegion {
  id: ID;
  assessmentId: ID;
  /** View-independent map location id, e.g. 'knee_left'. */
  regionId: string;
  anatomy?: string;
  side?: Side | null;
  symptomTypes?: SymptomType[];
  /** Finer location within the region, e.g. knee: anterior / medial / lateral / posterior. */
  subLocations?: string[];
}

/** Patient-drawn symptom radiation path (SVG coordinates of the given map view). */
export interface RadiationPath {
  id: ID;
  assessmentId: ID;
  view: string;
  symptomType: SymptomType;
  points: [number, number][];
  createdAt: ISODate;
}

/** Original intake answer — immutable; a correction supersedes rather than overwrites. */
export interface IntakeAnswer {
  id: ID;
  assessmentId: ID;
  patientId: ID;
  questionnaireId: string;
  questionnaireVersion: string;
  questionId: string;
  questionText: string;
  answer: string | number | string[] | boolean | null;
  answeredAt: ISODate;
  supersededBy?: ID;
  isDemo?: boolean;
}

export type SafetyAction = 'emergency' | 'urgent' | 'clinician_review';

/** Safety questionnaire response with the rule outcome at the time it was answered. */
export interface SafetyResponse {
  id: ID;
  assessmentId: ID;
  patientId: ID;
  questionnaireId: string;
  questionnaireVersion: string;
  questionId: string;
  questionText: string;
  answer: boolean;
  triggered: boolean;
  action: SafetyAction | null;
  at: ISODate;
  isDemo?: boolean;
}

/** Clinician correction of an auto-organised summary line; the original is preserved. */
export interface Amendment {
  id: ID;
  assessmentId: ID;
  target: string;
  original: string;
  amended: string;
  by: ID;
  at: ISODate;
}

export interface TestPlanItem {
  protocolId: string;
  protocolVersion: string;
  side: Side | null;
}

/** Test plan revisions — the latest row for an assessment is current; history is kept. */
export interface TestPlan {
  id: ID;
  assessmentId: ID;
  items: TestPlanItem[];
  source: 'protocol_default' | 'clinician' | 'baseline_copy';
  createdBy: ID;
  createdAt: ISODate;
  note?: string;
}

export interface CaptureSession {
  id: ID;
  assessmentId: ID;
  patientId: ID;
  protocolId: string;
  protocolVersion: string;
  side: Side | null;
  result: ProtocolResult;
  config: CaptureConfig | null;
  baselineCaptureId?: ID;
  conditionMatch?: ConditionMatch;
  /** Frame-to-screen coaching cue latency measured during this capture (ms). */
  cueLatency?: { n: number; p50: number | null; p95: number | null };
  /** Free-text setup the camera cannot see, e.g. chair height. */
  setupNotes?: string;
  provenance: Provenance;
  createdAt: ISODate;
  isDemo?: boolean;
}

export type ReasoningAction = 'accept' | 'reject' | 'defer' | 'annotate';

/** Clinician action on a rule-generated consideration; the suggestion snapshot is preserved. */
export interface ReasoningDecision {
  id: ID;
  assessmentId: ID;
  ruleSetId: string;
  ruleSetVersion: string;
  considerationId: string;
  suggestion: { state: string; supporting: string[]; conflicting: string[]; missing: string[] };
  action: ReasoningAction;
  note?: string;
  by: ID;
  at: ISODate;
  isDemo?: boolean;
}

export interface Impression {
  id: ID;
  assessmentId: ID;
  text: string;
  by: ID;
  at: ISODate;
  isDemo?: boolean;
}

/**
 * A clinician's decision on one statement of an AI consultation draft (Phase 8). The AI proposal is
 * kept verbatim with its evidence, next to the human decision — the audit shows both.
 */
export interface DraftDecision {
  id: ID;
  assessmentId: ID;
  draftSchema: string;
  generator: string;
  section: string;
  /** The AI-proposed statement exactly as shown. */
  proposal: string;
  evidence: string[];
  action: 'accept' | 'reject' | 'edit' | 'defer';
  /** Clinician wording when action = edit. */
  editedText?: string;
  note?: string;
  by: ID;
  at: ISODate;
  isDemo?: boolean;
}

/** Clinician examination finding (Phase 8) — what the camera cannot establish. */
export interface ExamFinding {
  id: ID;
  assessmentId: ID;
  area: string;
  text: string;
  by: ID;
  at: ISODate;
  isDemo?: boolean;
}

export interface Report {
  id: ID;
  assessmentId: ID;
  version: number;
  status: 'preliminary' | 'clinician_reviewed';
  generatedAt: ISODate;
  generatedBy: ID;
  approvedBy?: ID;
  approvedAt?: ISODate;
  templateVersion: string;
  isDemo?: boolean;
}

export type ProType =
  | 'nprs_now'
  | 'nprs_worst_24h'
  | 'pain_quality'
  | 'duration'
  | 'onset'
  | 'aggravating'
  | 'pattern'
  | 'red_flags'
  | 'session_pain_before'
  | 'session_pain_after'
  | 'session_rpe'
  /** Daily companion check-in (Phase 10): { pain: 0–10, note?: string }. */
  | 'daily_checkin';

export interface DailyCheckin {
  pain: number;
  note?: string;
}

/** Patient-reported outcome — stored verbatim, never interpreted by the engine. */
export interface PatientReportedOutcome {
  id: ID;
  patientId: ID;
  assessmentId?: ID;
  sessionId?: ID;
  type: ProType;
  value: number | string | string[] | Record<string, boolean> | DailyCheckin;
  recordedAt: ISODate;
  isDemo?: boolean;
}

export interface CameraScan {
  id: ID;
  patientId: ID;
  assessmentId?: ID;
  kind: 'static_posture' | 'dynamic_movement';
  view: string;
  frameWidth: number;
  frameHeight: number;
  /** Smoothed landmarks at capture time — lets a clinician re-render the overlay without video. */
  landmarks: Landmark[];
  /** Only present when the patient granted image_storage consent. */
  imageDataUrl?: string;
  provenance: Provenance;
  createdAt: ISODate;
  isDemo?: boolean;
}

export type ReviewStatus = 'pending' | 'accepted' | 'rejected' | 'repeat_requested';

export interface Measurement {
  id: ID;
  patientId: ID;
  assessmentId?: ID;
  scanId?: ID;
  sessionId?: ID;
  type: string;
  value: number;
  unit: 'deg' | 'pct_height' | 's' | 'pct_leg' | 'count';
  side?: Side;
  direction?: string;
  /** Standard deviation over the capture window, where applicable. */
  sd?: number;
  confidence: number;
  category: 'camera_estimate' | 'clinician_measured';
  captureId?: ID;
  metricId?: string;
  validity?: 'valid' | 'invalid';
  validityReason?: string;
  provenance: Provenance;
  reviewStatus: ReviewStatus;
  reviewedBy?: ID;
  reviewedAt?: ISODate;
  reviewNote?: string;
  /** When this clinician measurement is a REFERENCE for a camera capture metric (validation study). */
  reference?: { instrument: 'goniometer' | 'inclinometer' | 'stopwatch' | 'video_annotation' | 'other'; blinded: boolean; note?: string };
  createdAt: ISODate;
  isDemo?: boolean;
}

/** Algorithmic observation: a rule evaluated against a measurement. Never a diagnosis. */
export interface Observation {
  id: ID;
  patientId: ID;
  assessmentId?: ID;
  measurementId: ID;
  rule: string;
  threshold: number;
  value: number;
  status: ReviewStatus;
  createdAt: ISODate;
  isDemo?: boolean;
}

/**
 * A PubMed record the clinician attached to a plan: PMID, title, journal and year exactly as
 * PubMed returned them, with the search, retrieval time and who attached it (evidence/pubmed.ts).
 */
export interface EvidenceRef {
  source: 'pubmed';
  pmid: string;
  title: string;
  journal: string;
  year: string;
  url: string;
  doi?: string;
  query: string;
  retrievedAt: ISODate;
  attachedBy: ID;
  attachedAt: ISODate;
}

export interface Program {
  id: ID;
  patientId: ID;
  clinicianId: ID;
  title: string;
  status: 'draft' | 'active' | 'completed' | 'archived';
  startDate: string;
  endDate: string;
  approvedAt?: ISODate;
  approvedBy?: ID;
  notes?: string;
  createdAt: ISODate;
  /** Plan version per patient (1, 2, …) and the version it replaced (Phase 9). */
  version?: number;
  supersedes?: ID;
  /** Clinician's reason for this version; required when it intensifies the previous one. */
  changeReason?: string;
  /** Reassessment due this many days after approval (clinician-set; blank = none). */
  reassessAfterDays?: number;
  /** Events that make a reassessment due before then. */
  reassessTriggers?: ReassessTrigger[];
  /** A session stopped by the pain rule pauses the whole plan until a clinician resumes it. */
  pauseOnPainStop?: boolean;
  /** Days of the week the clinician scheduled sessions on (0 = Sunday). Absent = flexible (N per week). */
  scheduleDays?: number[];
  /** PubMed references the clinician attached to this plan version. */
  evidence?: EvidenceRef[];
  isDemo?: boolean;
}

/** Next contact with the clinician, set by the clinician (Phase 10). */
/** One import of phone/wearable activity (Phase 11): what was read, from where, and what was left out. */
export interface ActivityImport {
  id: ID;
  patientId: ID;
  platform: 'apple_health' | 'health_connect' | 'csv';
  fileName?: string;
  at: ISODate;
  status: 'ok' | 'permission_revoked' | 'consent_missing' | 'error';
  added: number;
  duplicates: number;
  /** Record types present in the source and deliberately not imported (counts only). */
  ignored: Record<string, number>;
  errors: string[];
  isDemo?: boolean;
}

/** One version of a library item (Phase 16). Row id = `${item.id}@${item.version}`; content of an approved version is never edited. */
export interface ContentRow {
  id: ID;
  item: ContentItem;
}

/** Append-only content review trail. */
export interface ContentReview {
  id: ID;
  itemId: string;
  version: string;
  action: 'submit' | 'approve' | 'request_changes' | 'retire' | 'import' | 'new_version';
  note?: string;
  by: ID;
  at: ISODate;
}

/** A non-camera library exercise prescribed in a plan version (patient self-reports completion). */
export interface ProgramLibraryItem {
  id: ID;
  programId: ID;
  order: number;
  itemId: string;
  itemVersion: string;
  sets: number;
  reps?: number;
  holdSeconds?: number;
  durationSeconds?: number;
  frequencyPerWeek: number;
  instructions?: string;
}

export interface Appointment {
  id: ID;
  patientId: ID;
  clinicianId: ID;
  at: ISODate;
  kind: 'reassessment' | 'review' | 'call' | 'session' | 'assessment';
  note?: string;
  /** 'done' = the patient attended; 'missed' = booked but did not attend. */
  status: 'scheduled' | 'cancelled' | 'done' | 'missed';
  /** The treatment course this visit counts towards (back office). */
  courseId?: ID;
  createdBy: ID;
  createdAt: ISODate;
  isDemo?: boolean;
}

/**
 * Clinic back office (Oct 2026). A treatment course is the number of sessions and the fee agreed with
 * the patient. Attended sessions are counted from appointments marked 'done'; nothing is estimated.
 * Money is stored in paise (integer) to avoid rounding.
 */
export interface TreatmentCourse {
  id: ID;
  patientId: ID;
  title: string;
  plannedSessions: number;
  /** Agreed fee for the whole course, in paise. */
  feePaise: number;
  startDate: string; // YYYY-MM-DD
  status: 'active' | 'completed' | 'stopped';
  note?: string;
  createdBy: ID;
  createdAt: ISODate;
  isDemo?: boolean;
}

/**
 * A signed discharge summary. Append-only: re-signing adds a new version. `fingerprint` captures the
 * patient's data at signing; if it no longer matches, the summary is shown as preliminary again.
 */
export interface Discharge {
  id: ID;
  patientId: ID;
  version: number;
  summary: string;
  advice: string;
  followUp: string;
  signedBy: ID; // clinician id
  signedAt: ISODate;
  fingerprint: string;
  isDemo?: boolean;
}

export type PaymentMethod = 'cash' | 'upi' | 'card' | 'bank';

export interface Payment {
  id: ID;
  patientId: ID;
  courseId?: ID;
  amountPaise: number;
  method: PaymentMethod;
  date: string; // YYYY-MM-DD
  reference?: string;
  note?: string;
  createdBy: ID;
  createdAt: ISODate;
  isDemo?: boolean;
}

export type ExpenseCategory = 'rent' | 'salaries' | 'utilities' | 'equipment' | 'supplies' | 'software' | 'other';

export interface Expense {
  id: ID;
  category: ExpenseCategory;
  title: string;
  amountPaise: number;
  date: string; // YYYY-MM-DD
  vendor?: string;
  method?: PaymentMethod;
  createdBy: ID;
  createdAt: ISODate;
  isDemo?: boolean;
}

export type ReassessTrigger = 'pain_stop' | 'pain_increase' | 'patient_pause';

/**
 * A plan pause (Phase 9). The patient, or the clinician's pain rule acting for them, may pause a
 * plan; neither may change or intensify it. Pauses are append-only: they are lifted by a separate
 * clinician-only PlanResume row, so the history of who paused and who resumed is never rewritten.
 */
export interface PlanPause {
  id: ID;
  programId: ID;
  patientId: ID;
  reason: 'pain_rule' | 'patient_report' | 'safety';
  detail?: string;
  sessionId?: ID;
  by: ID;
  at: ISODate;
  isDemo?: boolean;
}

export interface PlanResume {
  id: ID;
  pauseId: ID;
  programId: ID;
  patientId: ID;
  note: string;
  by: ID;
  at: ISODate;
  isDemo?: boolean;
}

export interface ProgramExercise {
  id: ID;
  programId: ID;
  order: number;
  prescription: ExercisePrescription;
}

export interface TrainingSession {
  id: ID;
  patientId: ID;
  programId: ID;
  startedAt: ISODate;
  endedAt?: ISODate;
  status: 'in_progress' | 'completed' | 'interrupted';
  painBefore?: number;
  painAfter?: number;
  rpe?: number;
  /** In-session pain reports and the configured rule's outcome. */
  painEvents?: { at: ISODate; nprs: number; paused: boolean; rule: string }[];
  results: (ExerciseResult & { programExerciseId: ID; usedAlternative?: boolean })[];
  /** Library (non-camera) exercises the patient reported doing in this session (patient-reported). */
  libraryDone?: { programLibraryItemId: ID; itemId: string; itemVersion: string; done: boolean }[];
  provenance: Provenance;
  isDemo?: boolean;
}

export interface ClinicalNote {
  id: ID;
  patientId: ID;
  authorId: ID;
  assessmentId?: ID;
  body: string;
  createdAt: ISODate;
  isDemo?: boolean;
}

export type AlertType = 'red_flag_urgent' | 'red_flag_review' | 'pain_increase' | 'low_adherence' | 'assessment_submitted' | 'tracking_quality' | 'plan_paused' | 'reassess_due' | 'checkin_note';

export interface Alert {
  id: ID;
  patientId: ID;
  type: AlertType;
  severity: 'info' | 'warning' | 'critical';
  detail?: string;
  createdAt: ISODate;
  resolvedAt?: ISODate;
  resolvedBy?: ID;
  isDemo?: boolean;
}

export interface Message {
  id: ID;
  patientId: ID;
  fromUserId: ID;
  fromName: string;
  body: string;
  at: ISODate;
  isDemo?: boolean;
}

export interface AuditEvent {
  id: ID;
  actorId: ID;
  action: string;
  entity: string;
  entityId: ID;
  at: ISODate;
  detail?: string;
}

/** Clinician-configured thresholds that turn measurements into observations. */
export interface ObservationThresholds {
  shoulder_level: number;
  pelvic_level: number;
  head_tilt: number;
  trunk_lateral_lean: number;
  knee_frontal: number;
  ear_shoulder_line: number;
  trunk_sagittal: number;
  asymmetry: number;
  /** Knee flexion below this (camera-estimated, valid capture) creates an observation. */
  knee_flexion_limited: number;
}

export interface ClinicSettings {
  clinicName: string;
  emergencyNumber: string;
  thresholds: ObservationThresholds;
  validationModeEnabled: boolean;
  /** Clinical-lead sign-off of versioned clinical rule sets (safety, reasoning, protocols). */
  ruleApprovals: Record<string, { approvedBy: ID; approvedAt: ISODate }>;
  /**
   * Validation release thresholds, set and LOCKED by the clinical lead before the final evaluation
   * set is analysed. Null until set — nothing passes without them.
   */
  releaseThresholds?: { values: Record<string, { loaWithin: number; maxFailureRate: number; minIcc: number; minN: number }>; lockedBy: ID; lockedAt: ISODate } | null;
  /** Raw video is never stored; landmark data retention in days (0 = keep until deleted). */
  retentionDays: number;
  /** Exception-queue rules (Phase 17); absent = defaults, all unreviewed. */
  exceptionRules?: import('../clinical/trends').ExceptionRule[];
}

export interface DB {
  schemaVersion: number;
  users: User[];
  patients: Patient[];
  clinicians: Clinician[];
  careRelationships: CareRelationship[];
  consents: Consent[];
  assessments: Assessment[];
  painRegions: PainRegion[];
  pros: PatientReportedOutcome[];
  scans: CameraScan[];
  measurements: Measurement[];
  observations: Observation[];
  programs: Program[];
  programExercises: ProgramExercise[];
  sessions: TrainingSession[];
  notes: ClinicalNote[];
  alerts: Alert[];
  messages: Message[];
  audit: AuditEvent[];
  radiationPaths: RadiationPath[];
  intakeAnswers: IntakeAnswer[];
  safetyResponses: SafetyResponse[];
  amendments: Amendment[];
  testPlans: TestPlan[];
  captures: CaptureSession[];
  reasoningDecisions: ReasoningDecision[];
  impressions: Impression[];
  reports: Report[];
  draftDecisions: DraftDecision[];
  examFindings: ExamFinding[];
  planPauses: PlanPause[];
  planResumes: PlanResume[];
  appointments: Appointment[];
  activitySamples: ActivitySample[];
  activityImports: ActivityImport[];
  contentItems: ContentRow[];
  contentReviews: ContentReview[];
  programLibraryItems: ProgramLibraryItem[];
  deviceMeasurements: DeviceMeasurement[];
  treatmentCourses: TreatmentCourse[];
  payments: Payment[];
  expenses: Expense[];
  discharges: Discharge[];
  settings: ClinicSettings;
}

export type Table = Exclude<keyof DB, 'schemaVersion' | 'settings'>;
