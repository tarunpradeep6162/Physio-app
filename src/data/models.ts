import type { ExerciseResult } from '../engine/exerciseRunner';
import type { ExercisePrescription } from '../engine/exercises/types';
import type { Provenance } from '../engine/provenance';
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

export interface Assessment {
  id: ID;
  patientId: ID;
  createdBy: ID;
  status: AssessmentStatus;
  createdAt: ISODate;
  submittedAt?: ISODate;
  reviewedAt?: ISODate;
  reviewedBy?: ID;
  /** Step the patient reached (for resuming interrupted assessments). */
  step: number;
  isDemo?: boolean;
}

export interface PainRegion {
  id: ID;
  assessmentId: ID;
  regionId: string;
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
  unit: 'deg' | 'pct_height';
  side?: Side;
  direction?: string;
  /** Standard deviation over the capture window, where applicable. */
  sd?: number;
  confidence: number;
  category: 'camera_estimate' | 'clinician_measured';
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
}

export interface ClinicSettings {
  clinicName: string;
  emergencyNumber: string;
  thresholds: ObservationThresholds;
  validationModeEnabled: boolean;
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
  settings: ClinicSettings;
}

export type Table = Exclude<keyof DB, 'schemaVersion' | 'settings'>;
