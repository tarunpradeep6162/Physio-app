import { EXERCISE_LIST } from '../engine/exercises/definitions';

/**
 * Exercise content system (Phase 16). Designed for a library of 2,000+ curated records across
 * goals, regions, positions, equipment, difficulty and accessibility alternatives.
 *
 * Two statuses are recorded SEPARATELY for every item:
 *  - content review: imported_unreviewed → draft → in_review → approved (published) → retired;
 *  - camera status: not camera-guided, or camera-guided with a named per-exercise definition and a
 *    QA record. Only the individually tested subset is ever labelled camera-guided, and the badge
 *    says which QA level it has (synthetic tests only, real devices, or validated).
 *
 * Patients only ever see APPROVED items. Imported and templated content arrives unreviewed and
 * cannot be published without a named reviewer's approval of that exact version.
 */

export const CONTENT_SCHEMA_VERSION = 'dl-content-1.0.0';

export const GOALS = ['mobility', 'strength', 'balance', 'control', 'endurance', 'pain_relief', 'function'] as const;
export const REGIONS = ['knee', 'hip', 'ankle', 'foot', 'shoulder', 'elbow', 'wrist_hand', 'neck', 'upper_back', 'lower_back', 'whole_body'] as const;
export const POSITIONS = ['standing', 'seated', 'supine', 'prone', 'side_lying', 'kneeling', 'quadruped'] as const;
export const EQUIPMENT = ['none', 'chair', 'wall', 'step', 'band', 'towel', 'weight', 'ball', 'table'] as const;
export const ACCESS_TAGS = ['seated_option', 'no_floor_work', 'one_arm', 'low_vision_audio', 'no_equipment', 'limited_space'] as const;

export type Goal = (typeof GOALS)[number];
export type BodyRegion = (typeof REGIONS)[number];
export type Position = (typeof POSITIONS)[number];
export type Equipment = (typeof EQUIPMENT)[number];
export type AccessTag = (typeof ACCESS_TAGS)[number];

export type ReviewStatus = 'imported_unreviewed' | 'draft' | 'in_review' | 'approved' | 'retired';
export type CameraQa = 'synthetic_tested' | 'device_tested' | 'validated';

export interface MediaAsset {
  kind: 'illustration' | 'video' | 'audio';
  uri: string;
  rights: { owner: string; licence: string; attribution?: string; expires?: string };
  alt: string;
}

export interface ContentItem {
  /** Stable id across versions. */
  id: string;
  version: string;
  schema: string;
  title: string;
  summary: string;
  instructions: string[];
  goals: Goal[];
  regions: BodyRegion[];
  position: Position;
  equipment: Equipment[];
  difficulty: 1 | 2 | 3 | 4 | 5;
  accessibility: AccessTag[];
  /** Easier or adapted alternatives, by item id, with why. */
  alternatives: { itemId: string; reason: string }[];
  /** Shown to the patient. */
  precautions: string[];
  /** Short coaching cues shown to the patient (clinician-authored). */
  cues?: string[];
  /** Common mistakes to avoid, shown to the patient (clinician-authored). */
  commonMistakes?: string[];
  /** Clinician-only notes (e.g. when not to prescribe). */
  clinicianNotes?: string;
  /** Where it may be done once prescribed: at home, or only supervised in the clinic (default home). */
  supervision?: 'home' | 'in_clinic';
  defaultDosage: { sets: number; reps?: number; holdSeconds?: number; durationSeconds?: number; frequencyPerWeek: number };
  media: MediaAsset[];
  review: { status: ReviewStatus; owner: string; reviewedBy?: string; reviewedAt?: string; note?: string };
  camera: { status: 'not_camera_guided' } | { status: 'camera_guided'; definitionId: string; definitionVersion: string; qa: CameraQa; qaEvidence: string };
  source: { kind: 'authored' | 'imported' | 'template'; ref?: string };
  locale: 'en' | 'ta';
  createdAt: string;
  isDemo?: boolean;
}

const VERSION_RE = /^\d+\.\d+\.\d+$/;

/** Problems that block review approval / publication. Empty = complete. */
export function validateItem(item: ContentItem, known: Set<string> = new Set()): string[] {
  const e: string[] = [];
  if (!item.id || !/^[a-z0-9_-]+$/.test(item.id)) e.push('id must be lower-case letters, digits, - or _');
  if (!VERSION_RE.test(item.version)) e.push('version must be x.y.z');
  if (!item.title.trim()) e.push('title missing');
  if (item.instructions.filter((s) => s.trim()).length < 2) e.push('at least 2 instruction steps');
  if (!item.precautions.length) e.push('precautions missing (write "none specific" explicitly if so)');
  if (!item.goals.length || !item.regions.length) e.push('goal and region required');
  if (!(item.defaultDosage.sets >= 1 && item.defaultDosage.frequencyPerWeek >= 1)) e.push('default dosage incomplete');
  if (!item.defaultDosage.reps && !item.defaultDosage.holdSeconds && !item.defaultDosage.durationSeconds) e.push('dosage needs reps, a hold or a duration');
  for (const m of item.media) {
    if (!m.rights.owner || !m.rights.licence) e.push(`media ${m.uri}: rights owner and licence required`);
    if (!m.alt.trim()) e.push(`media ${m.uri}: alternative text required`);
    if (m.rights.expires && m.rights.expires < new Date().toISOString().slice(0, 10)) e.push(`media ${m.uri}: licence expired ${m.rights.expires}`);
  }
  for (const a of item.alternatives) if (known.size && !known.has(a.itemId)) e.push(`alternative ${a.itemId} not in the library`);
  if (!item.review.owner.trim()) e.push('review owner required');
  if (item.camera.status === 'camera_guided') {
    const cam = item.camera;
    const def = EXERCISE_LIST.find((d) => d.id === cam.definitionId);
    if (!def) e.push('camera-guided item must name an existing per-exercise camera definition');
    else if (def.version !== cam.definitionVersion) e.push(`camera definition version ${cam.definitionVersion} does not match the current ${def.version}`);
    if (!cam.qaEvidence.trim()) e.push('camera-guided item needs QA evidence');
  }
  return e;
}

/** Visible to patients only when approved for this exact version and still complete. */
export function isPublished(item: ContentItem, known?: Set<string>): boolean {
  return item.review.status === 'approved' && !!item.review.reviewedBy && validateItem(item, known).length === 0;
}

/** The label shown next to an item. Never "live tracked" unless it is a QA'd camera-guided item. */
export function cameraLabel(item: ContentItem): string | null {
  if (item.camera.status !== 'camera_guided') return null;
  return item.camera.qa === 'validated' ? 'Camera-guided (validated)' : item.camera.qa === 'device_tested' ? 'Camera-guided (tested on devices; not yet validated)' : 'Camera-guided (synthetic tests only; not yet tested on devices)';
}

// ---- Search -----------------------------------------------------------------------------------
export interface LibraryQuery {
  text?: string;
  goals?: Goal[];
  regions?: BodyRegion[];
  positions?: Position[];
  equipment?: Equipment[];
  maxDifficulty?: number;
  accessibility?: AccessTag[];
  cameraGuidedOnly?: boolean;
  statuses?: ReviewStatus[];
}

/** Inverted index over facets, so filtering 2,000+ items stays interactive. */
export class LibraryIndex {
  private readonly byFacet = new Map<string, Set<number>>();
  private readonly text: string[];
  constructor(readonly items: ContentItem[]) {
    this.text = items.map((i) => `${i.title} ${i.summary} ${i.instructions.join(' ')}`.toLowerCase());
    items.forEach((it, n) => {
      const add = (k: string) => (this.byFacet.get(k) ?? this.byFacet.set(k, new Set()).get(k)!).add(n);
      it.goals.forEach((g) => add(`g:${g}`));
      it.regions.forEach((r) => add(`r:${r}`));
      add(`p:${it.position}`);
      it.equipment.forEach((q) => add(`e:${q}`));
      it.accessibility.forEach((a) => add(`a:${a}`));
      add(`s:${it.review.status}`);
      if (it.camera.status === 'camera_guided') add('camera');
    });
  }
  private anyOf(prefix: string, values: readonly string[] | undefined): Set<number> | null {
    if (!values?.length) return null;
    const out = new Set<number>();
    for (const v of values) for (const n of this.byFacet.get(`${prefix}:${v}`) ?? []) out.add(n);
    return out;
  }
  search(q: LibraryQuery): ContentItem[] {
    // AND across facets, OR within a facet; accessibility tags must ALL be present.
    let hits: Set<number> | null = null;
    const narrow = (s: Set<number> | null) => {
      if (!s) return;
      hits = hits === null ? new Set(s) : new Set([...hits].filter((n) => s.has(n)));
    };
    narrow(this.anyOf('g', q.goals));
    narrow(this.anyOf('r', q.regions));
    narrow(this.anyOf('p', q.positions));
    narrow(this.anyOf('e', q.equipment));
    narrow(this.anyOf('s', q.statuses));
    for (const a of q.accessibility ?? []) narrow(this.byFacet.get(`a:${a}`) ?? new Set());
    if (q.cameraGuidedOnly) narrow(this.byFacet.get('camera') ?? new Set());
    const words = (q.text ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    const base: number[] = hits === null ? this.items.map((_, n) => n) : [...(hits as Set<number>)].sort((a, b) => a - b);
    return base.filter((n) => (q.maxDifficulty === undefined || this.items[n].difficulty <= q.maxDifficulty) && words.every((w) => this.text[n].includes(w))).map((n) => this.items[n]);
  }
}

// ---- Import -----------------------------------------------------------------------------------
/**
 * Imports items from JSON (array of partial items). Every imported or templated item is forced to
 * 'imported_unreviewed' and its camera status to not-camera-guided, whatever the file claims: an
 * import can never publish content or advertise live tracking.
 */
export function importItems(json: string, now: string, sourceRef: string): { items: ContentItem[]; errors: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { items: [], errors: ['not valid JSON'] };
  }
  if (!Array.isArray(raw)) return { items: [], errors: ['expected an array of items'] };
  const items: ContentItem[] = [];
  const errors: string[] = [];
  raw.forEach((r: Partial<ContentItem>, i) => {
    if (!r || typeof r !== 'object' || !r.id || !r.title) {
      errors.push(`row ${i + 1}: id and title required`);
      return;
    }
    items.push({
      id: String(r.id),
      version: r.version && VERSION_RE.test(r.version) ? r.version : '0.1.0',
      schema: CONTENT_SCHEMA_VERSION,
      title: String(r.title),
      summary: r.summary ?? '',
      instructions: Array.isArray(r.instructions) ? r.instructions.map(String) : [],
      goals: (r.goals ?? []).filter((g): g is Goal => (GOALS as readonly string[]).includes(g)),
      regions: (r.regions ?? []).filter((g): g is BodyRegion => (REGIONS as readonly string[]).includes(g)),
      position: (POSITIONS as readonly string[]).includes(r.position as string) ? (r.position as Position) : 'standing',
      equipment: (r.equipment ?? ['none']).filter((g): g is Equipment => (EQUIPMENT as readonly string[]).includes(g)),
      difficulty: [1, 2, 3, 4, 5].includes(Number(r.difficulty)) ? (Number(r.difficulty) as ContentItem['difficulty']) : 1,
      accessibility: (r.accessibility ?? []).filter((g): g is AccessTag => (ACCESS_TAGS as readonly string[]).includes(g)),
      alternatives: Array.isArray(r.alternatives) ? r.alternatives : [],
      precautions: Array.isArray(r.precautions) ? r.precautions.map(String) : [],
      ...(Array.isArray(r.cues) && r.cues.length ? { cues: r.cues.map(String) } : {}),
      ...(Array.isArray(r.commonMistakes) && r.commonMistakes.length ? { commonMistakes: r.commonMistakes.map(String) } : {}),
      clinicianNotes: r.clinicianNotes,
      supervision: r.supervision === 'in_clinic' ? 'in_clinic' : 'home',
      defaultDosage: r.defaultDosage ?? { sets: 1, reps: 10, frequencyPerWeek: 3 },
      media: Array.isArray(r.media) ? r.media : [],
      review: { status: 'imported_unreviewed', owner: r.review?.owner ?? '' },
      camera: { status: 'not_camera_guided' },
      source: { kind: r.source?.kind === 'template' ? 'template' : 'imported', ref: sourceRef },
      locale: r.locale === 'ta' ? 'ta' : 'en',
      createdAt: now,
    });
  });
  return { items, errors };
}

/** Next patch/minor version for an edited item (an approved version is never edited in place). */
export function bumpVersion(v: string, kind: 'patch' | 'minor' = 'patch'): string {
  const [a, b, c] = v.split('.').map(Number);
  return kind === 'minor' ? `${a}.${b + 1}.0` : `${a}.${b}.${c + 1}`;
}
