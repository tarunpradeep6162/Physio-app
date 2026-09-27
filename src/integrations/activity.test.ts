import { describe, expect, it } from 'vitest';
import { emptyDb, getDb, replaceDb, uuid } from '../data/store';
import { dailyActivity, localDay, parseActivityCsv, parseAppleHealthXml, parseNativeBatch, parseZoned, type ActivitySample, type NativeActivityBatch } from './activity';
import { activityView, grantActivityConsent, importActivity, withdrawActivityConsent } from './activityStore';

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<HealthData locale="en_IN">
 <Record type="HKQuantityTypeIdentifierStepCount" sourceName="Test iPhone" sourceVersion="17.0" device="&lt;&lt;HKDevice: 0x1&gt;, name:iPhone, manufacturer:Apple Inc., model:iPhone, hardware:iPhone15,2, software:17.0&gt;" unit="count" creationDate="2026-01-05 09:01:00 +0530" startDate="2026-01-05 08:00:00 +0530" endDate="2026-01-05 08:30:00 +0530" value="1200"/>
 <Record type="HKQuantityTypeIdentifierStepCount" sourceName="Test Watch" unit="count" startDate="2026-01-05 08:05:00 +0530" endDate="2026-01-05 08:35:00 +0530" value="1000"/>
 <Record type="HKQuantityTypeIdentifierStepCount" sourceName="Test iPhone" device="&lt;&lt;HKDevice: 0x1&gt;, name:iPhone, manufacturer:Apple Inc., model:iPhone, hardware:iPhone15,2, software:17.0&gt;" unit="count" startDate="2026-01-05 23:30:00 +0530" endDate="2026-01-05 23:50:00 +0530" value="300"/>
 <Record type="HKQuantityTypeIdentifierHeartRate" sourceName="Test Watch" unit="count/min" startDate="2026-01-05 08:00:00 +0530" endDate="2026-01-05 08:00:00 +0530" value="72"/>
 <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Test Watch" startDate="2026-01-05 00:00:00 +0530" endDate="2026-01-05 06:00:00 +0530" value="HKCategoryValueSleepAnalysisAsleep"/>
 <Workout workoutActivityType="HKWorkoutActivityTypeWalking" duration="25" durationUnit="min" sourceName="Test Watch" startDate="2026-01-05 18:00:00 +0530" endDate="2026-01-05 18:25:00 +0530"/>
 <Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="30" durationUnit="min" sourceName="Test Watch" startDate="2026-01-06 18:00:00 +0530" endDate="2026-01-06 18:30:00 +0530"/>
</HealthData>`;

describe('Phase 11 — activity import', () => {
  it('parses zoned timestamps and keeps the source offset for the local day', () => {
    expect(parseZoned('2026-01-05 23:30:00 +0530')).toEqual({ utc: '2026-01-05T18:00:00.000Z', offsetMin: 330 });
    expect(parseZoned('2026-01-05T08:00:00-05:00')).toEqual({ utc: '2026-01-05T13:00:00.000Z', offsetMin: -300 });
    expect(parseZoned('yesterday')).toBeNull();
    // 00:30 in India is still the previous day in UTC — the local day must follow the source offset.
    expect(localDay({ start: parseZoned('2026-01-06 00:30:00 +0530')!.utc, tzOffsetMin: 330 })).toBe('2026-01-06');
  });

  it('reads only steps and walking workouts from an Apple Health export; heart rate, sleep and other workouts are skipped', () => {
    const r = parseAppleHealthXml(XML);
    expect(r.samples.filter((s) => s.metric === 'steps')).toHaveLength(3);
    expect(r.samples.filter((s) => s.metric === 'walking_minutes').map((s) => s.value)).toEqual([25]);
    expect(r.ignored).toMatchObject({ HeartRate: 1, SleepAnalysis: 1, Workout: 1 });
    expect(JSON.stringify(r.samples)).not.toMatch(/72|HeartRate/);
    expect(r.samples[0].source).toEqual({ platform: 'apple_health', app: 'Test iPhone', device: 'iPhone' });
    expect(parseAppleHealthXml('<foo/>').errors).toEqual(['not_apple_health_export']);
  });

  it('does not add phone and watch together; shows both sources and marks absent days as no data', () => {
    const parsed = parseAppleHealthXml(XML).samples.map((s, i) => ({ ...s, id: `s${i}`, patientId: 'p', importId: 'i', importedAt: '' })) as ActivitySample[];
    const [d5, d6] = dailyActivity(parsed, 'steps', ['2026-01-05', '2026-01-06']);
    // 08:00 hour: phone 1200 vs watch 1000 → 1200 (not 2200); 23:00 hour: phone 300.
    expect(d5.value).toBe(1500);
    expect(d5.bySource).toEqual([
      { source: 'Apple Health · Test iPhone (iPhone)', value: 1500 },
      { source: 'Apple Health · Test Watch', value: 1000 },
    ]);
    expect(d5.conflicting).toBe(true);
    expect(d6.value).toBeNull();
  });

  it('CSV: validates the header and rows, ignores other metrics', () => {
    const ok = parseActivityCsv('metric,start,end,value,source\nsteps,2026-01-05T08:00:00+05:30,2026-01-05T09:00:00+05:30,800,Fitbit\nheart_rate,2026-01-05T08:00:00+05:30,2026-01-05T08:00:00+05:30,70,Fitbit\nsteps,bad,2026-01-05T09:00:00+05:30,1,x');
    expect(ok.samples).toHaveLength(1);
    expect(ok.ignored).toEqual({ heart_rate: 1 });
    expect(ok.errors).toEqual(['line_4']);
    expect(parseActivityCsv('a,b\n1,2').errors[0]).toMatch(/header/);
  });

  it('native bridge contract: a revoked permission yields no samples for that type and is reported', () => {
    const b: NativeActivityBatch = {
      platform: 'health_connect',
      permission: { steps: 'revoked', walking: 'granted' },
      readAt: '2026-01-06T00:00:00Z',
      steps: [{ count: 500, startTime: '2026-01-05T02:30:00Z', endTime: '2026-01-05T03:00:00Z', startZoneOffsetSeconds: 19800, metadata: { id: 'hc1', dataOrigin: { packageName: 'com.google.android.apps.fitness' } } }],
      walkingSessions: [{ startTime: '2026-01-05T12:30:00Z', endTime: '2026-01-05T12:50:00Z', startZoneOffsetSeconds: 19800, metadata: { id: 'hc2', dataOrigin: { packageName: 'com.google.android.apps.fitness' } } }],
    };
    const r = parseNativeBatch(b);
    expect(r.revoked).toEqual(['steps']);
    expect(r.samples.map((s) => s.metric)).toEqual(['walking_minutes']);
    expect(r.samples[0]).toMatchObject({ value: 20, recordId: 'hc2', tzOffsetMin: 330 });
  });

  it('stores only consented metrics, drops duplicates on re-import, and hides/deletes data on withdrawal', () => {
    replaceDb(emptyDb());
    const pid = uuid();
    getDb().patients.push({ id: pid, userId: 'u', name: 'DP-A', dob: '1990-01-01', preferredLanguage: 'en', createdAt: '' });
    const parsed = parseAppleHealthXml(XML);
    const none = importActivity(pid, 'u', parsed, 'apple_health');
    expect(none.status).toBe('consent_missing');
    expect(none.added).toBe(0);
    grantActivityConsent(pid, 'u', 'steps');
    const first = importActivity(pid, 'u', parsed, 'apple_health');
    expect(first.added).toBe(3);
    expect(first.ignored['walking_minutes (no consent)']).toBe(1);
    const again = importActivity(pid, 'u', parsed, 'apple_health');
    expect(again).toMatchObject({ added: 0, duplicates: 3 });
    expect(activityView(getDb(), pid, 'steps', ['2026-01-05']).days[0].value).toBe(1500);
    withdrawActivityConsent(pid, 'u', 'steps', false);
    expect(activityView(getDb(), pid, 'steps', ['2026-01-05']).days).toEqual([]); // kept but not shown
    grantActivityConsent(pid, 'u', 'steps');
    withdrawActivityConsent(pid, 'u', 'steps', true);
    expect(getDb().activitySamples.filter((s) => s.patientId === pid)).toEqual([]);
  });
});
