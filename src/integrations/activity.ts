/**
 * Phone / wearable activity (Phase 11). Steps and walking time only — the minimum needed to see
 * whether daily activity changes during rehabilitation. Heart rate and every other health record
 * type are ignored by the parsers and never stored (they would need a concrete clinical use and
 * approval first).
 *
 * Sources:
 *  - Android Health Connect and Apple HealthKit need a NATIVE app capability; a web page cannot
 *    read them. `NativeActivityBatch` is the contract a native bridge must send (Health Connect
 *    record shape). Until a native app exists, patients can import files they export themselves:
 *  - Apple Health "Export All Health Data" → export.xml (steps + walking workouts);
 *  - a CSV (metric,start,end,value,source) for other apps.
 *
 * Every sample keeps its source app/device, the original local time-zone offset, the time it was
 * imported and the import it came from. The camera is NEVER a source of steps: a camera session
 * sees a few minutes of exercise, not a day of walking.
 */

export type ActivityMetric = 'steps' | 'walking_minutes';
export type ActivityPlatform = 'apple_health' | 'health_connect' | 'csv';

export interface ActivitySource {
  platform: ActivityPlatform;
  /** App or device name as reported by the platform (e.g. "iPhone", "com.fitbit.FitbitMobile"). */
  app: string;
  device?: string;
}

export interface ActivitySample {
  id: string;
  patientId: string;
  metric: ActivityMetric;
  value: number;
  /** UTC instants. */
  start: string;
  end: string;
  /** The source's local offset from UTC in minutes at `start` (for day bucketing in the patient's day). */
  tzOffsetMin: number;
  source: ActivitySource;
  /** Platform record id when available (dedupe key). */
  recordId?: string;
  importId: string;
  importedAt: string;
  isDemo?: boolean;
}

export interface ParsedSample {
  metric: ActivityMetric;
  value: number;
  start: string;
  end: string;
  tzOffsetMin: number;
  source: ActivitySource;
  recordId?: string;
}

export interface ParseResult {
  samples: ParsedSample[];
  /** Records of other types seen in the file and deliberately not imported (counts only). */
  ignored: Record<string, number>;
  errors: string[];
}

/** "2026-01-05 08:00:00 +0530" (Apple) or ISO 8601 with offset → { utc, offsetMin }. */
export function parseZoned(s: string): { utc: string; offsetMin: number } | null {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)\s*(Z|[+-]\d{2}:?\d{2})$/.exec(s.trim());
  if (!m) return null;
  let offsetMin = 0;
  if (m[3] !== 'Z') {
    const sign = m[3][0] === '-' ? -1 : 1;
    const digits = m[3].slice(1).replace(':', '');
    offsetMin = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4)));
  }
  const time = m[2].length === 5 ? `${m[2]}:00` : m[2];
  const ms = Date.parse(`${m[1]}T${time}Z`) - offsetMin * 60_000;
  if (!Number.isFinite(ms)) return null;
  return { utc: new Date(ms).toISOString(), offsetMin };
}

const attrRe = /([A-Za-z_:][\w:.-]*)="([^"]*)"/g;
function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(attrRe)) out[m[1]] = m[2].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  return out;
}
/** Apple's device attribute: "<<HKDevice: 0x…>, name:iPhone, manufacturer:Apple Inc., model:iPhone, …>". */
function appleDevice(d: string | undefined): string | undefined {
  if (!d) return undefined;
  const name = /name:([^,>]+)/.exec(d)?.[1]?.trim();
  const model = /model:([^,>]+)/.exec(d)?.[1]?.trim();
  return [name, model && model !== name ? model : undefined].filter(Boolean).join(' / ') || undefined;
}

/**
 * Apple Health export.xml. Reads only StepCount records and Walking workouts. The file can be very
 * large; tags are scanned with a regular expression rather than building a DOM.
 */
export function parseAppleHealthXml(xml: string): ParseResult {
  const res: ParseResult = { samples: [], ignored: {}, errors: [] };
  if (!/<HealthData[\s>]/.test(xml)) {
    res.errors.push('not_apple_health_export');
    return res;
  }
  for (const m of xml.matchAll(/<(Record|Workout)\s([^>]*?)\/?>/g)) {
    const a = attrs(m[2]);
    if (m[1] === 'Record') {
      if (a.type !== 'HKQuantityTypeIdentifierStepCount') {
        const k = (a.type ?? 'unknown').replace(/^HK\w+?TypeIdentifier/, '');
        res.ignored[k] = (res.ignored[k] ?? 0) + 1;
        continue;
      }
      const s = parseZoned(a.startDate ?? '');
      const e = parseZoned(a.endDate ?? '');
      const v = Number(a.value);
      if (!s || !e || !Number.isFinite(v) || v < 0) {
        res.errors.push(`bad_step_record@${a.startDate ?? '?'}`);
        continue;
      }
      res.samples.push({ metric: 'steps', value: Math.round(v), start: s.utc, end: e.utc, tzOffsetMin: s.offsetMin, source: { platform: 'apple_health', app: a.sourceName || 'unknown', device: appleDevice(a.device) } });
    } else {
      if (a.workoutActivityType !== 'HKWorkoutActivityTypeWalking') {
        res.ignored.Workout = (res.ignored.Workout ?? 0) + 1;
        continue;
      }
      const s = parseZoned(a.startDate ?? '');
      const e = parseZoned(a.endDate ?? '');
      if (!s || !e) {
        res.errors.push(`bad_walking_workout@${a.startDate ?? '?'}`);
        continue;
      }
      // Duration from the start/end instants (the durationUnit attribute varies between exports).
      const minutes = Math.round(((Date.parse(e.utc) - Date.parse(s.utc)) / 60_000) * 10) / 10;
      if (minutes > 0) res.samples.push({ metric: 'walking_minutes', value: minutes, start: s.utc, end: e.utc, tzOffsetMin: s.offsetMin, source: { platform: 'apple_health', app: a.sourceName || 'unknown', device: appleDevice(a.device) } });
    }
  }
  return res;
}

/** CSV: header `metric,start,end,value,source`; timestamps ISO 8601 with offset. */
export function parseActivityCsv(csv: string): ParseResult {
  const res: ParseResult = { samples: [], ignored: {}, errors: [] };
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  const head = lines.shift()?.toLowerCase().split(',').map((h) => h.trim());
  const col = (n: string) => head?.indexOf(n) ?? -1;
  if (!head || ['metric', 'start', 'end', 'value', 'source'].some((n) => col(n) < 0)) {
    res.errors.push('csv_header_must_be:metric,start,end,value,source');
    return res;
  }
  lines.forEach((l, i) => {
    const c = l.split(',').map((x) => x.trim());
    const metric = c[col('metric')];
    if (metric !== 'steps' && metric !== 'walking_minutes') {
      res.ignored[metric || 'blank'] = (res.ignored[metric || 'blank'] ?? 0) + 1;
      return;
    }
    const s = parseZoned(c[col('start')] ?? '');
    const e = parseZoned(c[col('end')] ?? '');
    const v = Number(c[col('value')]);
    if (!s || !e || !Number.isFinite(v) || v < 0 || Date.parse(e.utc) < Date.parse(s.utc)) {
      res.errors.push(`line_${i + 2}`);
      return;
    }
    res.samples.push({ metric, value: v, start: s.utc, end: e.utc, tzOffsetMin: s.offsetMin, source: { platform: 'csv', app: c[col('source')] || 'unknown' } });
  });
  return res;
}

/**
 * Contract for the future native bridge (Health Connect record shape; a HealthKit bridge maps to
 * the same). `permission` reflects the OS permission at read time: 'revoked' stops the import and
 * is shown to the patient and clinician as a data gap, never as zero activity.
 */
export interface NativeActivityBatch {
  platform: 'health_connect' | 'apple_health';
  permission: { steps: 'granted' | 'revoked' | 'never_asked'; walking: 'granted' | 'revoked' | 'never_asked' };
  readAt: string;
  steps: { count: number; startTime: string; endTime: string; startZoneOffsetSeconds: number; metadata: { id: string; dataOrigin: { packageName: string }; device?: { manufacturer?: string; model?: string } } }[];
  walkingSessions: { startTime: string; endTime: string; startZoneOffsetSeconds: number; metadata: { id: string; dataOrigin: { packageName: string } } }[];
}

export function parseNativeBatch(b: NativeActivityBatch): ParseResult & { revoked: ActivityMetric[] } {
  const res: ParseResult & { revoked: ActivityMetric[] } = { samples: [], ignored: {}, errors: [], revoked: [] };
  if (b.permission.steps === 'revoked') res.revoked.push('steps');
  if (b.permission.walking === 'revoked') res.revoked.push('walking_minutes');
  const iso = (t: string) => (Number.isFinite(Date.parse(t)) ? new Date(Date.parse(t)).toISOString() : null);
  if (b.permission.steps === 'granted')
    for (const r of b.steps) {
      const s = iso(r.startTime);
      const e = iso(r.endTime);
      if (!s || !e || !(r.count >= 0)) {
        res.errors.push(`bad_steps:${r.metadata.id}`);
        continue;
      }
      const dev = [r.metadata.device?.manufacturer, r.metadata.device?.model].filter(Boolean).join(' ') || undefined;
      res.samples.push({ metric: 'steps', value: r.count, start: s, end: e, tzOffsetMin: Math.round(r.startZoneOffsetSeconds / 60), source: { platform: b.platform, app: r.metadata.dataOrigin.packageName, device: dev }, recordId: r.metadata.id });
    }
  if (b.permission.walking === 'granted')
    for (const r of b.walkingSessions) {
      const s = iso(r.startTime);
      const e = iso(r.endTime);
      if (!s || !e) continue;
      res.samples.push({ metric: 'walking_minutes', value: Math.round(((Date.parse(e) - Date.parse(s)) / 60_000) * 10) / 10, start: s, end: e, tzOffsetMin: Math.round(r.startZoneOffsetSeconds / 60), source: { platform: b.platform, app: r.metadata.dataOrigin.packageName }, recordId: r.metadata.id });
    }
  return res;
}

const sourceKey = (s: ActivitySource) => `${s.platform}|${s.app}|${s.device ?? ''}`;
export const sourceLabel = (s: ActivitySource) => `${s.platform === 'apple_health' ? 'Apple Health' : s.platform === 'health_connect' ? 'Health Connect' : 'CSV import'} · ${s.app}${s.device ? ` (${s.device})` : ''}`;

/** Exact duplicates (same record id, or same source + interval + value) — re-importing a file adds nothing. */
export function dedupeKey(s: Pick<ActivitySample, 'metric' | 'start' | 'end' | 'value' | 'source' | 'recordId'>) {
  return s.recordId ? `${s.source.platform}#${s.recordId}` : `${s.metric}|${sourceKey(s.source)}|${s.start}|${s.end}|${s.value}`;
}

/** The patient's local calendar day of a sample, using the offset recorded by the source. */
export function localDay(s: Pick<ActivitySample, 'start' | 'tzOffsetMin'>): string {
  return new Date(Date.parse(s.start) + s.tzOffsetMin * 60_000).toISOString().slice(0, 10);
}

export interface DailyActivity {
  day: string;
  metric: ActivityMetric;
  /** null = no data from any source that day (absent — never shown as 0). */
  value: number | null;
  /** Totals per source before de-duplication, so disagreement is visible. */
  bySource: { source: string; value: number }[];
  /** More than one source reported and their totals differ. */
  conflicting: boolean;
  method: string;
}

export const DEDUPE_METHOD = 'Overlapping sources are not added together: for each hour the single source reporting the most is used (phone and watch otherwise double-count).';

/** Daily totals for `days` (YYYY-MM-DD, local), de-duplicated across sources hour by hour. */
export function dailyActivity(samples: ActivitySample[], metric: ActivityMetric, days: string[]): DailyActivity[] {
  const rows = samples.filter((s) => s.metric === metric);
  return days.map((day) => {
    const today = rows.filter((s) => localDay(s) === day);
    if (!today.length) return { day, metric, value: null, bySource: [], conflicting: false, method: DEDUPE_METHOD };
    const bySource = new Map<string, number>();
    const byHour = new Map<string, Map<string, number>>();
    for (const s of today) {
      const src = sourceLabel(s.source);
      bySource.set(src, (bySource.get(src) ?? 0) + s.value);
      const hour = new Date(Date.parse(s.start) + s.tzOffsetMin * 60_000).toISOString().slice(0, 13);
      const h = byHour.get(hour) ?? new Map<string, number>();
      h.set(src, (h.get(src) ?? 0) + s.value);
      byHour.set(hour, h);
    }
    let total = 0;
    for (const h of byHour.values()) total += Math.max(...h.values());
    const list = [...bySource].map(([source, value]) => ({ source, value: Math.round(value * 10) / 10 }));
    return { day, metric, value: Math.round(total * 10) / 10, bySource: list, conflicting: list.length > 1 && new Set(list.map((x) => x.value)).size > 1, method: DEDUPE_METHOD };
  });
}
