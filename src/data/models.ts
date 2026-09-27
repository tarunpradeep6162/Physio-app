import type { ExerciseResult } from '../engine/exerciseRunner';
import type { ExercisePrescription } from '../engine/exercises/types';
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
  createdAt: ISODate;
  isDemo?: boolean;
}

export interface Clinician {
  id: ID;
  userId: ID | null;
  name: string;
  title: string;
  clinic: string;
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

export type ConsentType = 'camera_processing' | 'data_storage' | 'image_storage' | 'research_export';

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
  region?: 'knee' | 'shoulder' | 'low_back' | 'general';
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
  | 'session_rpe';

/** Patient-reported outcome — stored verbatim, never interpreted by the engine. */
export interface PatientReportedOutcome {
  id: ID;
  patientId: ID;
  assessmentId?: ID;
  sessionId?: ID;
  type: ProType;
  value: number | string | string[] | Record<string, boolean>;
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
  results: (ExerciseResult & { programExerciseId: ID })[];
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

export type AlertType = 'red_flag_urgent' | 'red_flag_review' | 'pain_increase' | 'low_adherence' | 'assessment_submitted' | 'tracking_quality';

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
  /** Raw video is never stored; landmark data retention in days (0 = keep until deleted). */
  retentionDays: number;
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
  settings: ClinicSettings;
}

export type Table = Exclude<keyof DB, 'schemaVersion' | 'settings'>;
