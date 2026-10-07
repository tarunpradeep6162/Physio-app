import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCurrentUser } from '../../app/hooks';
import { DemoBadge, Notice } from '../../components/ui';
import { patientCode } from '../../clinical/directory';
import { appointmentMessage, appointmentsOn, courseProgress, daySlots, localDay, localTime, monthGrid, slotTaken, whatsappLink } from '../../clinic/backoffice';
import type { Appointment, Clinician, DB } from '../../data/models';
import { insert, update, useDb, uuid } from '../../data/store';
import { RegisterPatientForm } from './RegisterPatient';

/**
 * Clinic schedule: a month calendar, the selected day's agenda, booking, and the staff list.
 * Attendance is recorded by hand (attended / missed); course session counts follow from it.
 */

const KIND_LABEL: Record<Appointment['kind'], string> = {
  session: 'Treatment session',
  assessment: 'Assessment',
  reassessment: 'Reassessment',
  review: 'Review',
  call: 'Phone or video call',
};
const STATUS_LABEL: Record<Appointment['status'], string> = { scheduled: 'Booked', done: 'Attended', missed: 'Missed', cancelled: 'Cancelled' };
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function todayLocal(): string {
  return localDay(new Date().toISOString());
}

export function SchedulePage() {
  const user = useCurrentUser();
  const db = useDb((d) => d);
  const [day, setDay] = useState(todayLocal());
  const [ym, setYm] = useState(() => todayLocal().slice(0, 7));
  if (!user) return null;
  const [y, m] = ym.split('-').map(Number);
  const weeks = monthGrid(y, m);
  const shift = (n: number) => {
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    setYm(d.toISOString().slice(0, 7));
  };
  const monthName = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const counts = new Map<string, number>();
  for (const a of db.appointments ?? []) if (a.status !== 'cancelled') counts.set(localDay(a.at), (counts.get(localDay(a.at)) ?? 0) + 1);

  return (
    <div className="content stack loose">
      <div className="row between wrap">
        <div>
          <p className="eyebrow">Clinic</p>
          <h1>Schedule</h1>
          <p className="muted">Book visits, record attendance and see each day's agenda. Session counts on treatment courses come from attendance recorded here.</p>
        </div>
        <Link className="btn secondary" to="/c/billing">
          Billing
        </Link>
      </div>
      <div className="schedule-layout">
        <section className="panel stack tight" aria-labelledby="cal-h">
          <div className="row between">
            <h2 id="cal-h">{monthName}</h2>
            <div className="row" style={{ gap: '0.35rem' }}>
              <button className="btn ghost sm" onClick={() => shift(-1)} aria-label="Previous month">
                ‹
              </button>
              <button className="btn ghost sm" onClick={() => { setYm(todayLocal().slice(0, 7)); setDay(todayLocal()); }}>
                Today
              </button>
              <button className="btn ghost sm" onClick={() => shift(1)} aria-label="Next month">
                ›
              </button>
            </div>
          </div>
          <table className="cal" role="grid">
            <thead>
              <tr>
                {WEEKDAYS.map((w) => (
                  <th key={w} scope="col">
                    {w}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeks.map((w, i) => (
                <tr key={i}>
                  {w.map((d, j) =>
                    d ? (
                      <td key={d}>
                        <button
                          type="button"
                          className={`cal-day${d === day ? ' selected' : ''}${d === todayLocal() ? ' today' : ''}`}
                          aria-pressed={d === day}
                          onClick={() => setDay(d)}
                        >
                          {/* The spoken name starts with the visible day number (voice control: "click 4"). */}
                          <span className="num">{Number(d.slice(8))}</span>
                          <span className="sr-only"> {new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</span>
                          {counts.get(d) ? (
                            <>
                              <span className="sr-only">, </span>
                              <span className="cal-count">{counts.get(d)}</span>
                              <span className="sr-only"> booked</span>
                            </>
                          ) : null}
                        </button>
                      </td>
                    ) : (
                      <td key={`e${j}`} />
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <DayAgenda db={db} day={day} actorId={user.id} />
      </div>
      <BookingForm db={db} day={day} actorId={user.id} onBooked={setDay} />
      <StaffPanel db={db} actorId={user.id} />
    </div>
  );
}

function DayAgenda({ db, day, actorId }: { db: DB; day: string; actorId: string }) {
  const list = appointmentsOn(db, day);
  const label = new Date(`${day}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <section className="panel stack tight" aria-labelledby="agenda-h">
      <h2 id="agenda-h">{label}</h2>
      {list.length === 0 && <p className="small muted">Nothing booked for this day.</p>}
      <ul className="agenda">
        {list.map((a) => {
          const p = db.patients.find((x) => x.id === a.patientId);
          const staff = db.clinicians.find((c) => c.id === a.clinicianId);
          const course = a.courseId ? (db.treatmentCourses ?? []).find((c) => c.id === a.courseId) : undefined;
          const wa = p ? whatsappLink(p.phone, appointmentMessage(a, db.settings.clinicName, staff?.name ?? 'your physiotherapist', p.name.split(' ')[0])) : null;
          return (
            <li key={a.id} className={`agenda-item status-${a.status}`}>
              <div className="agenda-time num">{localTime(a.at)}</div>
              <div className="grow stack" style={{ gap: '0.15rem' }}>
                <div>
                  {p ? (
                    <Link to={`/c/patients/${p.id}`}>
                      <strong>{p.name}</strong>
                    </Link>
                  ) : (
                    <strong>Unknown patient</strong>
                  )}{' '}
                  {p && <span className="xs muted mono">{patientCode(p.id)}</span>} {p?.isDemo && <DemoBadge />}
                </div>
                <div className="xs muted">
                  {KIND_LABEL[a.kind]} · {staff?.name ?? 'Unassigned'}
                  {course ? ` · ${course.title} (${courseProgress(db, course).attended}/${course.plannedSessions})` : ''}
                  {a.note ? ` · ${a.note}` : ''}
                </div>
              </div>
              <div className="row wrap" style={{ gap: '0.3rem', justifyContent: 'flex-end' }}>
                <span className={`badge ${a.status === 'done' ? 'ok' : a.status === 'missed' ? 'danger' : ''}`}>{STATUS_LABEL[a.status]}</span>
                {a.status === 'scheduled' && (
                  <>
                    <button className="btn ghost sm" onClick={() => update('appointments', a.id, { status: 'done' }, actorId)}>
                      Attended
                    </button>
                    <button className="btn ghost sm" onClick={() => update('appointments', a.id, { status: 'missed' }, actorId)}>
                      Missed
                    </button>
                    <button className="btn ghost sm" onClick={() => update('appointments', a.id, { status: 'cancelled' }, actorId)}>
                      Cancel
                    </button>
                    {wa && (
                      <a className="btn ghost sm" href={wa} target="_blank" rel="noopener noreferrer" title="Opens WhatsApp with a reminder: date, time, clinic and staff only">
                        WhatsApp reminder
                      </a>
                    )}
                  </>
                )}
                {(a.status === 'done' || a.status === 'missed') && (
                  <button className="btn ghost sm" onClick={() => update('appointments', a.id, { status: 'scheduled' }, actorId)}>
                    Undo
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="xs muted">The WhatsApp reminder contains only the date, time, clinic and staff name. It opens WhatsApp on this device; nothing is sent until you press send there.</p>
    </section>
  );
}

function BookingForm({ db, day, actorId, onBooked }: { db: DB; day: string; actorId: string; onBooked: (d: string) => void }) {
  const staff = db.clinicians.filter((c) => c.active !== false);
  const patients = useMemo(() => [...db.patients].sort((a, b) => a.name.localeCompare(b.name)), [db.patients]);
  const [patientId, setPatientId] = useState('');
  const [date, setDate] = useState(day);
  const [time, setTime] = useState('09:00');
  const [staffId, setStaffId] = useState(staff[0]?.id ?? '');
  const [kind, setKind] = useState<Appointment['kind']>('session');
  const [courseId, setCourseId] = useState('');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => setDate(day), [day]);
  const courses = (db.treatmentCourses ?? []).filter((c) => c.patientId === patientId && c.status === 'active');
  const atIso = date && time ? new Date(`${date}T${time}:00`).toISOString() : '';
  const taken = !!(staffId && atIso && slotTaken(db, staffId, atIso));
  const patient = db.patients.find((p) => p.id === patientId);
  return (
    <section className="panel stack tight" aria-labelledby="book-h">
      <h2 id="book-h">Book a visit</h2>
      {staff.length === 0 && <Notice tone="warn">Add a staff member below before booking.</Notice>}
      <div className="form-grid">
        <label className="field grow">
          <span>Patient</span>
          <select className="input" value={patientId} onChange={(e) => { setPatientId(e.target.value); setCourseId(''); }}>
            <option value="">Select…</option>
            {patients.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {patientCode(p.id)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Date</span>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="field">
          <span>Time</span>
          <select className="input" value={time} onChange={(e) => setTime(e.target.value)}>
            {daySlots().map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Staff</span>
          <select className="input" value={staffId} onChange={(e) => setStaffId(e.target.value)}>
            {staff.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Type</span>
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value as Appointment['kind'])}>
            {(Object.keys(KIND_LABEL) as Appointment['kind'][]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Treatment course</span>
          <select className="input" value={courseId} onChange={(e) => setCourseId(e.target.value)} disabled={!courses.length}>
            <option value="">{courses.length ? 'None' : 'No active course'}</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </label>
        <label className="field grow">
          <span>Note (optional)</span>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <button
          className="btn primary sm"
          disabled={!patient || !staffId || !atIso || taken}
          onClick={() => {
            insert('appointments', { id: uuid(), patientId, clinicianId: staffId, at: atIso, kind, courseId: courseId || undefined, note: note.trim() || undefined, status: 'scheduled', createdBy: actorId, createdAt: new Date().toISOString(), isDemo: patient?.isDemo }, actorId, 'appointment');
            setMsg(`Booked ${patient!.name} on ${date} at ${time}.`);
            setNote('');
            onBooked(date);
          }}
        >
          Book
        </button>
      </div>
      <div className="row wrap" style={{ gap: '0.5rem' }}>
        <button
          className="btn secondary sm"
          disabled={!patient || !staffId}
          title="Records a visit happening now, already marked attended"
          onClick={() => {
            const now = new Date().toISOString();
            insert('appointments', { id: uuid(), patientId, clinicianId: staffId, at: now, kind, courseId: courseId || undefined, note: ['Walk-in', note.trim()].filter(Boolean).join(' · '), status: 'done', createdBy: actorId, createdAt: now, isDemo: patient?.isDemo }, actorId, 'appointment');
            setMsg(`Walk-in recorded for ${patient!.name} now, marked attended.`);
            setNote('');
            onBooked(localDay(now));
          }}
        >
          Walk-in now (attended)
        </button>
        <details className="grow">
          <summary className="small" style={{ cursor: 'pointer' }}>
            New patient? Register them here
          </summary>
          <RegisterPatientForm db={db} actorId={actorId} compact onRegistered={(p) => setPatientId(p.id)} />
        </details>
      </div>
      {taken && <Notice tone="warn">This staff member already has a booking at {time} on {date}.</Notice>}
      {msg && <p className="small" role="status">{msg}</p>}
    </section>
  );
}

function StaffPanel({ db, actorId }: { db: DB; actorId: string }) {
  const [name, setName] = useState('');
  const [title, setTitle] = useState('Physiotherapist');
  const list: Clinician[] = [...db.clinicians].sort((a, b) => Number(b.active !== false) - Number(a.active !== false) || a.name.localeCompare(b.name));
  return (
    <section className="panel stack tight" aria-labelledby="staff-h">
      <h2 id="staff-h">Staff</h2>
      <p className="xs muted">Staff listed here can be booked. Adding a name here does not create a login; physiotherapist logins are added by the clinic owner on the server.</p>
      <ul className="agenda">
        {list.map((c) => (
          <li key={c.id} className="agenda-item">
            <div className="grow">
              <strong>{c.name}</strong> <span className="xs muted">{c.title}</span> {c.isDemo && <DemoBadge />}
            </div>
            <span className={`badge ${c.active === false ? '' : 'ok'}`}>{c.active === false ? 'Not bookable' : 'Bookable'}</span>
            <button className="btn ghost sm" onClick={() => update('clinicians', c.id, { active: c.active === false }, actorId)}>
              {c.active === false ? 'Make bookable' : 'Stop new bookings'}
            </button>
          </li>
        ))}
      </ul>
      <div className="form-grid">
        <label className="field grow">
          <span>Name</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span>Role</span>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <button
          className="btn secondary sm"
          disabled={!name.trim()}
          onClick={() => {
            insert('clinicians', { id: uuid(), userId: null, name: name.trim(), title: title.trim() || 'Staff', clinic: db.settings.clinicName, active: true, createdAt: new Date().toISOString() }, actorId, 'staff');
            setName('');
          }}
        >
          Add staff
        </button>
      </div>
    </section>
  );
}
