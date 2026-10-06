import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Notice } from '../../components/ui';
import { patientCode } from '../../clinical/directory';
import { localDay } from '../../clinic/backoffice';
import { buildWalkInPatient, samePhone, validateWalkIn, type WalkInError, type WalkInInput } from '../../clinic/registration';
import type { DB, Patient } from '../../data/models';
import { getDb, insert, uuid } from '../../data/store';

const ERR: Record<WalkInError, string> = {
  name: 'Enter the patient’s name (at least 2 letters).',
  phone: 'Phone number not recognised. Use a 10-digit mobile number or +country code.',
  dob: 'Date of birth must be a real date, not in the future.',
};

/**
 * Register a walk-in patient (clinic staff). Creates the patient record only — no login, no
 * complaint or diagnosis unless the patient states one. Duplicates by phone are flagged.
 */
export function RegisterPatientForm({ db, actorId, onRegistered, compact }: { db: DB; actorId: string; onRegistered?: (p: Patient) => void; compact?: boolean }) {
  const blank: WalkInInput = { name: '', phone: '', dob: '', sex: '', concern: '' };
  const [f, setF] = useState<WalkInInput>(blank);
  const [errors, setErrors] = useState<WalkInError[]>([]);
  const [done, setDone] = useState<Patient | null>(null);
  const today = localDay(new Date().toISOString());
  const dupes = f.phone ? samePhone(db.patients, f.phone) : [];
  const set = (patch: Partial<WalkInInput>) => {
    setF((x) => ({ ...x, ...patch }));
    setErrors([]);
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validateWalkIn(f, today);
    setErrors(errs);
    if (errs.length) return;
    const now = new Date().toISOString();
    const demo = db.users.find((u) => u.id === actorId)?.isDemo;
    const p = buildWalkInPatient(f, uuid(), now, demo);
    insert('patients', p, actorId, 'register_walk_in');
    for (const c of getDb().clinicians) insert('careRelationships', { id: uuid(), patientId: p.id, clinicianId: c.id, status: 'active', createdAt: now }, actorId);
    setDone(p);
    setF(blank);
    onRegistered?.(p);
  };
  return (
    <form className="stack tight" onSubmit={submit} aria-label="Register a patient" noValidate>
      {!compact && <p className="xs muted">For walk-ins and phone bookings. This creates a record only; the patient can create their own app login later from the app QR. Record the complaint in the patient’s own words, or leave it blank.</p>}
      <div className="form-grid">
        <label className="field grow">
          <span>Full name</span>
          <input className="input" value={f.name} onChange={(e) => set({ name: e.target.value })} autoComplete="off" aria-invalid={errors.includes('name')} />
        </label>
        <label className="field">
          <span>Mobile (optional)</span>
          <input className="input" inputMode="tel" value={f.phone} onChange={(e) => set({ phone: e.target.value })} aria-invalid={errors.includes('phone')} />
        </label>
        <label className="field">
          <span>Date of birth (optional)</span>
          <input className="input" type="date" max={today} value={f.dob} onChange={(e) => set({ dob: e.target.value })} aria-invalid={errors.includes('dob')} />
        </label>
        <label className="field">
          <span>Sex (optional)</span>
          <select className="input" value={f.sex} onChange={(e) => set({ sex: e.target.value as WalkInInput['sex'] })}>
            <option value="">Not recorded</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="field grow">
          <span>Complaint in the patient’s words (optional)</span>
          <input className="input" value={f.concern} onChange={(e) => set({ concern: e.target.value })} />
        </label>
        <button className="btn primary sm">Register patient</button>
      </div>
      {errors.map((e) => (
        <p key={e} className="small" role="alert" style={{ color: 'var(--red-ink)', margin: 0 }}>
          {ERR[e]}
        </p>
      ))}
      {dupes.length > 0 && (
        <Notice tone="warn">
          Already registered with this number: {dupes.map((p) => `${p.name} (${patientCode(p.id)})`).join(', ')}. Check before creating a second record.
        </Notice>
      )}
      {done && (
        <p className="small" role="status" style={{ margin: 0 }}>
          Registered {done.name} · <span className="mono">{patientCode(done.id)}</span> · <Link to={`/c/patients/${done.id}`}>Open patient</Link>
        </p>
      )}
    </form>
  );
}
