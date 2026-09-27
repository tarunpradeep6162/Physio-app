import { useState } from 'react';
import { Notice } from '../../components/ui';
import type { DB, Patient } from '../../data/models';
import { fmtDateTime } from '../../data/queries';
import { useDb } from '../../data/store';
import { DEDUPE_METHOD, parseActivityCsv, parseAppleHealthXml, type ActivityMetric } from '../../integrations/activity';
import { activityView, grantActivityConsent, importActivity, lastNDays, withdrawActivityConsent } from '../../integrations/activityStore';
import { useT } from '../../i18n';

/** Largest export read in the browser (Apple exports can be several hundred MB). */
const MAX_FILE_MB = 300;
const METRICS: ActivityMetric[] = ['steps', 'walking_minutes'];

/**
 * Phone / wearable activity (Phase 11) — patient side. Granular consent per data type, file import
 * with a report of what was and was not read, and removal on withdrawal. Days without data are
 * shown as "no data", never as zero.
 */
export function ActivityPanel({ patient, userId }: { patient: Patient; userId: string }) {
  const { t } = useT();
  const days = lastNDays(14);
  const views = useDb((d) => METRICS.map((m) => activityView(d, patient.id, m, days)), [patient.id, days[13]]);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<string | null>(null);
  const [deleteOnWithdraw, setDeleteOnWithdraw] = useState(true);
  const anyConsent = views.some((v) => v.consent.granted);

  const onFile = async (f: File) => {
    if (f.size > MAX_FILE_MB * 1024 * 1024) {
      setReport(t('activity.too_large', { mb: MAX_FILE_MB }));
      return;
    }
    setBusy(true);
    try {
      const text = await f.text();
      const isCsv = /\.csv$/i.test(f.name);
      const parsed = isCsv ? parseActivityCsv(text) : parseAppleHealthXml(text);
      const rec = importActivity(patient.id, userId, parsed, isCsv ? 'csv' : 'apple_health', { fileName: f.name, isDemo: patient.isDemo });
      const ignored = Object.entries(rec.ignored).map(([k, n]) => `${k} ${n}`).join(', ');
      setReport(`${t('activity.imported', { added: rec.added, dup: rec.duplicates })}${ignored ? ` ${t('activity.ignored', { list: ignored })}` : ''}${rec.errors.length ? ` ${t('activity.errors', { n: rec.errors.length })}` : ''}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel stack" aria-labelledby="activity-h">
      <h2 id="activity-h">{t('activity.title')}</h2>
      <p className="small muted">{t('activity.explain')}</p>
      {METRICS.map((m) => {
        const v = views.find((x) => x.metric === m)!;
        return (
          <div key={m} className="row between wrap">
            <span className="small">
              <strong>{t(`activity.metric.${m}`)}</strong> · {v.consent.granted ? t('activity.sharing_since', { at: fmtDateTime(v.consent.at!) }) : t('activity.not_sharing')}
            </span>
            {v.consent.granted ? (
              <button className="btn ghost sm" onClick={() => withdrawActivityConsent(patient.id, userId, m, deleteOnWithdraw)}>
                {t('activity.stop')}
              </button>
            ) : (
              <button className="btn secondary sm" onClick={() => grantActivityConsent(patient.id, userId, m)}>
                {t('activity.allow')}
              </button>
            )}
          </div>
        );
      })}
      {anyConsent && (
        <label className="check xs">
          <input type="checkbox" checked={deleteOnWithdraw} onChange={(e) => setDeleteOnWithdraw(e.target.checked)} />
          <span>{t('activity.delete_on_stop')}</span>
        </label>
      )}
      {anyConsent && (
        <div className="stack tight">
          <label className="field">
            <span>{t('activity.import_label')}</span>
            <input type="file" accept=".xml,.csv,text/xml,text/csv" disabled={busy} onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = ''; // allow choosing the same file again
                if (f) void onFile(f);
              }}
            />
          </label>
          <p className="xs muted">{t('activity.import_help')}</p>
        </div>
      )}
      {report && <Notice>{report}</Notice>}
      {views[0].permissionRevoked && <Notice tone="warn">{t('activity.permission_revoked')}</Notice>}
      <ActivityTable views={views} />
    </section>
  );
}

/** 14-day table shared by the patient and clinician views. */
export function ActivityTable({ views }: { views: ReturnType<typeof activityView>[] }) {
  const { t } = useT();
  const shown = views.filter((v) => v.consent.granted && v.days.some((d) => d.value !== null));
  if (!shown.length) return <p className="small muted">{t('activity.none')}</p>;
  const days = shown[0].days.map((d) => d.day);
  return (
    <div className="stack tight">
      <div className="table-wrap" tabIndex={0} role="region" aria-label={t('activity.title')}>
        <table className="data">
          <thead>
            <tr>
              <th>{t('activity.day')}</th>
              {shown.map((v) => (
                <th key={v.metric}>{t(`activity.metric.${v.metric}`)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {days.map((day) => (
              <tr key={day}>
                <td className="small">{day}</td>
                {shown.map((v) => {
                  const d = v.days.find((x) => x.day === day)!;
                  return (
                    <td key={v.metric} className="num small" title={d.bySource.map((s) => `${s.source}: ${s.value}`).join('\n')}>
                      {d.value === null ? <span className="muted">{t('activity.no_data')}</span> : Math.round(d.value).toLocaleString()}
                      {d.conflicting && <span className="badge warn"> {t('activity.sources_differ')}</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="xs muted">
        {t('activity.provenance', { sources: [...new Set(shown.flatMap((v) => v.days.flatMap((d) => d.bySource.map((s) => s.source))))].join('; ') })} {DEDUPE_METHOD} {t('activity.camera_note')}
      </p>
    </div>
  );
}

/** Clinician read-only view. */
export function ClinicianActivity({ db, patient }: { db: DB; patient: Patient }) {
  const days = lastNDays(14);
  const views = METRICS.map((m) => activityView(db, patient.id, m, days));
  const last = views[0].lastImport;
  return (
    <section className="panel stack tight">
      <h2>Activity (imported, device-measured)</h2>
      <p className="xs muted">
        {views.map((v) => `${v.metric}: ${v.consent.granted ? 'shared' : 'not shared'}`).join(' · ')}
        {last ? ` · last import ${fmtDateTime(last.at)} (${last.platform}, ${last.status}, +${last.added})` : ' · never imported'}
      </p>
      {views[0].permissionRevoked && <Notice tone="warn">The phone reported the permission as revoked at the last import: days after it are a gap, not inactivity.</Notice>}
      <ActivityTable views={views} />
    </section>
  );
}
