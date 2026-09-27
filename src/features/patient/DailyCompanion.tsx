import { useEffect, useState } from 'react';
import { recoveryMessage, todayView } from '../../clinical/companion';
import { NprsInput, Notice } from '../../components/ui';
import type { Patient } from '../../data/models';
import { fmtDate, fmtDateTime } from '../../data/queries';
import { insert, syncConflicts, useDb, uuid } from '../../data/store';
import { useT } from '../../i18n';

/**
 * Daily companion (Phase 10): a calm daily home. Today's plan status, a symptom check-in, missed-day
 * recovery, the session log and the next appointment. Pain is recorded, never scored or praised;
 * missed days are met with reassurance, never with extra work.
 */
export function DailyCompanion({ patient, userId }: { patient: Patient; userId: string }) {
  const { t } = useT();
  const now = new Date().toISOString();
  const v = useDb((d) => todayView(d, patient.id, now), [patient.id, now.slice(0, 13)]);
  const [pain, setPain] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [editing, setEditing] = useState(false);
  const online = useOnline();
  const conflicts = syncConflicts().length;
  const recovery = recoveryMessage(v);

  const saveCheckin = () => {
    if (pain === null) return;
    const at = new Date().toISOString();
    insert('pros', { id: uuid(), patientId: patient.id, type: 'daily_checkin', value: { pain, note: note.trim() || undefined }, recordedAt: at, isDemo: patient.isDemo }, userId, 'daily_checkin');
    // A written note goes to the clinician as information; the app does not interpret it.
    if (note.trim()) insert('alerts', { id: uuid(), patientId: patient.id, type: 'checkin_note', severity: 'info', detail: `“${note.trim()}” (pain ${pain}/10)`, createdAt: at, isDemo: patient.isDemo }, userId);
    setPain(null);
    setNote('');
    setEditing(false);
  };

  return (
    <div className="stack">
      {!online && <Notice>{t('companion.offline')}</Notice>}
      {conflicts > 0 && <Notice tone="warn">{t('companion.sync_conflict', { n: conflicts })}</Notice>}

      {v.plan === 'active' && (
        <p className="small muted" aria-live="polite">
          {v.doneToday > 0 ? t('companion.done_today') : v.today === 'scheduled' ? t('companion.scheduled_today') : v.today === 'rest' ? t('companion.rest_day') : t('companion.flexible_today')}
          {' · '}
          {t('companion.week', { done: v.weekDone, target: v.weekTarget })}
        </p>
      )}
      {recovery !== 'none' && <Notice>{t(`companion.${recovery}`)}</Notice>}

      <section className="panel stack tight" aria-labelledby="checkin-h">
        <h2 id="checkin-h">{t('companion.checkin_title')}</h2>
        {v.checkin.today && !editing ? (
          <div className="row between wrap">
            <span className="small">
              {t('companion.checked_in', { at: fmtDateTime(v.checkin.today.recordedAt), pain: v.checkin.today.value.pain })}
              {v.checkin.today.value.note ? ` — “${v.checkin.today.value.note}”` : ''}
            </span>
            <button className="btn ghost sm" onClick={() => setEditing(true)}>
              {t('companion.checkin_again')}
            </button>
          </div>
        ) : (
          <>
            <NprsInput label={t('companion.pain_now')} value={pain} onChange={setPain} />
            <label className="field">
              <span>{t('companion.note')}</span>
              <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <p className="xs muted">{t('companion.checkin_explain')}</p>
            <button className="btn primary" disabled={pain === null} onClick={saveCheckin}>
              {t('common.save')}
            </button>
          </>
        )}
      </section>

      <section className="panel stack tight" aria-labelledby="next-h">
        <h2 id="next-h">{t('companion.next_title')}</h2>
        {v.nextAppointment ? (
          <p className="small">
            {t(`companion.appt.${v.nextAppointment.kind}`)} · <strong>{fmtDateTime(v.nextAppointment.at)}</strong>
            {v.nextAppointment.note ? ` — ${v.nextAppointment.note}` : ''}
          </p>
        ) : (
          <p className="small muted">{v.reassessWithoutAppointment ? t('companion.reassess_soon') : t('companion.no_appt')}</p>
        )}
      </section>

      <section className="panel stack tight" aria-labelledby="log-h">
        <h2 id="log-h">{t('companion.log_title')}</h2>
        {v.sessionLog.length === 0 ? (
          <p className="small muted">{t('companion.log_empty')}</p>
        ) : (
          <ul className="stack tight" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {v.sessionLog.map((s) => (
              <li key={s.id} className="row between small">
                <span>{fmtDate(s.startedAt)}</span>
                <span className="muted">
                  {s.status === 'completed' ? t('companion.log_completed') : t('companion.log_partial')}
                  {s.painBefore !== undefined && s.painAfter !== undefined ? ` · ${t('companion.log_pain', { before: s.painBefore, after: s.painAfter })}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function useOnline() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}
