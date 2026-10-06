import type { Patient } from '../data/models';

/**
 * Walk-in registration by clinic staff. Only what the patient or staff actually provide is stored:
 * no default complaint, diagnosis or score. The patient gets no login from this; they can be given
 * the app QR to create their own account.
 */

export interface WalkInInput {
  name: string;
  phone?: string;
  dob?: string;
  sex?: Patient['sex'] | '';
  concern?: string;
}

/** Indian mobile numbers as +91XXXXXXXXXX; other international numbers kept with their +code. Null if not a phone number. */
export function normalisePhone(input: string): string | null {
  const s = input.replace(/[\s()-]/g, '');
  if (!s) return null;
  if (/^\+\d{8,15}$/.test(s)) return s.startsWith('+91') && s.length !== 13 ? null : s;
  const d = s.replace(/^0+/, '');
  if (/^91[6-9]\d{9}$/.test(d)) return `+${d}`;
  if (/^[6-9]\d{9}$/.test(d)) return `+91${d}`;
  return null;
}

export type WalkInError = 'name' | 'phone' | 'dob';

export function validateWalkIn(i: WalkInInput, today: string): WalkInError[] {
  const e: WalkInError[] = [];
  if (i.name.trim().length < 2) e.push('name');
  if (i.phone?.trim() && !normalisePhone(i.phone)) e.push('phone');
  if (i.dob && (!/^\d{4}-\d{2}-\d{2}$/.test(i.dob) || i.dob > today || i.dob < '1900-01-01')) e.push('dob');
  return e;
}

export function buildWalkInPatient(i: WalkInInput, id: string, createdAt: string, isDemo?: boolean): Patient {
  const phone = i.phone?.trim() ? normalisePhone(i.phone) ?? undefined : undefined;
  return {
    id,
    userId: null,
    name: i.name.trim().replace(/\s+/g, ' '),
    ...(phone ? { phone } : {}),
    ...(i.dob ? { dob: i.dob } : {}),
    ...(i.sex ? { sex: i.sex } : {}),
    ...(i.concern?.trim() ? { concern: i.concern.trim() } : {}),
    preferredLanguage: 'en',
    createdAt,
    ...(isDemo ? { isDemo: true } : {}),
  };
}

/** Patients already registered with this phone number (to avoid duplicates). */
export function samePhone(patients: Patient[], phone: string): Patient[] {
  const n = normalisePhone(phone);
  if (!n) return [];
  return patients.filter((p) => p.phone && normalisePhone(p.phone) === n);
}
