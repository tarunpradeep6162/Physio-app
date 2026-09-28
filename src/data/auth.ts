import { useSyncExternalStore } from 'react';
import type { Clinician, Patient, Role, User } from './models';
import { RemoteAuthError, remoteConfigured } from './remote/config';
import { bindSession, getDb, insert, sessionChanged, uuid } from './store';

/**
 * Sign-in. With a clinic server configured (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY), accounts
 * are Supabase Auth accounts and the role comes from the server (see data/remote/account.ts).
 * Otherwise this is the local authentication for the MVP. Passwords are hashed with PBKDF2-SHA256 (210k iterations)
 * via WebCrypto and never stored in plain text. This protects only against casual inspection of
 * the device; production MUST use server-side auth (OIDC / secure HTTP-only sessions).
 */

const SESSION_KEY = 'physiovision.session';
const ITERATIONS = 210_000;

function b64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

async function hash(password: string, saltB64: string): Promise<string> {
  const salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS }, key, 256);
  return b64(bits);
}

let sessionUserId: string | null = readSession();
const listeners = new Set<() => void>();
bindSession(() => sessionUserId);

function readSession(): string | null {
  try {
    return sessionStorage.getItem(SESSION_KEY) ?? localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

function setSession(id: string | null) {
  sessionUserId = id;
  try {
    if (id) {
      sessionStorage.setItem(SESSION_KEY, id);
      // Survive PWA restarts on the patient's own device.
      localStorage.setItem(SESSION_KEY, id);
    } else {
      sessionStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(SESSION_KEY);
    }
  } catch {
    /* storage disabled */
  }
  listeners.forEach((l) => l());
  sessionChanged();
}

export function useSessionUserId(): string | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => sessionUserId,
  );
}

export class AuthError extends Error {
  constructor(public code: 'invalid' | 'exists' | 'password' | 'confirm' | 'offline' | 'server') {
    super(code);
  }
}

/** True when this build stores records on the clinic's Supabase server (shared across devices). */
export const serverMode = remoteConfigured;

const wrap = async <T>(f: () => Promise<T>): Promise<T> => {
  try {
    return await f();
  } catch (e) {
    if (e instanceof RemoteAuthError) throw new AuthError(e.code);
    throw e;
  }
};

export async function signUp(args: { email: string; password: string; name: string; role: Role }): Promise<User> {
  // Server mode: the role is decided by the server (clinic owner's allowlist), never by the form.
  if (serverMode()) return wrap(async () => (await import('./remote/account')).remoteSignUp(args, setSession));
  const email = args.email.trim().toLowerCase();
  if (args.password.length < 8) throw new AuthError('password');
  if (getDb().users.some((u) => u.email === email)) throw new AuthError('exists');
  const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
  const user: User = {
    id: uuid(),
    email,
    passwordSalt: salt,
    passwordHash: await hash(args.password, salt),
    role: args.role,
    displayName: args.name.trim(),
    createdAt: new Date().toISOString(),
  };
  insert('users', user, user.id, 'sign_up');
  if (args.role === 'patient') {
    const p: Patient = { id: uuid(), userId: user.id, name: user.displayName, preferredLanguage: 'en', createdAt: user.createdAt };
    insert('patients', p, user.id);
    // Single-clinic MVP: link the new patient to every clinician in the clinic.
    for (const c of getDb().clinicians) {
      insert('careRelationships', { id: uuid(), patientId: p.id, clinicianId: c.id, status: 'active', createdAt: user.createdAt }, user.id);
    }
  } else {
    const c: Clinician = { id: uuid(), userId: user.id, name: user.displayName, title: 'Physiotherapist', clinic: getDb().settings.clinicName, createdAt: user.createdAt };
    insert('clinicians', c, user.id);
  }
  setSession(user.id);
  return user;
}

export async function signIn(emailRaw: string, password: string): Promise<User> {
  if (serverMode()) return wrap(async () => (await import('./remote/account')).remoteSignIn(emailRaw, password, setSession));
  const email = emailRaw.trim().toLowerCase();
  const user = getDb().users.find((u) => u.email === email && !u.isDemo);
  if (!user) throw new AuthError('invalid');
  if ((await hash(password, user.passwordSalt)) !== user.passwordHash) throw new AuthError('invalid');
  setSession(user.id);
  return user;
}

/** Demo accounts have no password and can only view demonstration data. */
export function signInDemo(role: Role) {
  const u = getDb().users.find((x) => x.isDemo && x.role === role);
  if (u) setSession(u.id);
  return u;
}

export function signOut() {
  const u = sessionUserId ? getDb().users.find((x) => x.id === sessionUserId) : undefined;
  if (serverMode() && u && !u.isDemo) {
    void import('./remote/account').then((m) => m.remoteSignOut(setSession));
    return;
  }
  setSession(null);
}

export async function requestPasswordReset(email: string) {
  return wrap(async () => (await import('./remote/account')).requestPasswordReset(email));
}

export async function setNewPassword(password: string): Promise<User> {
  return wrap(async () => (await import('./remote/account')).setNewPassword(password, setSession));
}

/** Patient deletes their own account (server mode: on the server; local mode: on this device). */
export async function deleteMyAccount(localErase: () => void) {
  if (serverMode()) return wrap(async () => (await import('./remote/account')).remoteDeleteMyAccount(setSession));
  localErase();
  setSession(null);
}

// Resume a saved server session when the app opens.
if (typeof window !== 'undefined' && serverMode()) {
  void import('./remote/account').then((m) => m.restoreRemoteSession(sessionUserId, setSession)).catch(() => undefined);
}
