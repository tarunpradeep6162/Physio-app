import type { Clinician, Patient, User } from '../models';
import { erasePatient } from '../privacy';
import { getDb, insert, replaceDb, update, uuid } from '../store';
import { supabase } from './client';
import { RemoteAuthError } from './config';
import { flush, getSyncStatus, pendingCount, startSync, stopSync, syncNow } from './sync';

/**
 * Sign-in with Supabase Auth. The account's ROLE is read from the server profile (a physiotherapist
 * only if the clinic owner put their email on the allowlist) — never chosen in the app. After
 * sign-in all records the account may see are pulled, and the local identity rows (user, patient or
 * clinician) are created only if the server has none, so a second device never duplicates them.
 */

export { RemoteAuthError };

type SetSession = (id: string | null) => void;

async function profileOf(uid: string): Promise<{ role: 'patient' | 'clinician'; name: string | null }> {
  const { data, error } = await supabase().from('profiles').select('role,display_name').eq('user_id', uid).maybeSingle();
  if (error) throw new RemoteAuthError(typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'server');
  if (!data) throw new RemoteAuthError('server');
  return { role: data.role === 'clinician' ? 'clinician' : 'patient', name: data.display_name ?? null };
}

/** After a Supabase session exists: pull, create missing identity rows, start syncing, open the session. */
export async function establish(uid: string, email: string, fallbackName: string | undefined, setSession: SetSession): Promise<User> {
  const prof = await profileOf(uid);
  await startSync(uid, prof.role);
  const st = getSyncStatus().state;
  if ((st === 'error' || st === 'offline') && !getDb().users.some((u) => u.id === uid)) {
    // The first download failed: creating identity rows now could duplicate ones on the server.
    stopSync();
    await supabase().auth.signOut().catch(() => undefined);
    throw new RemoteAuthError(st === 'offline' ? 'offline' : 'server');
  }
  const db = getDb();
  let user = db.users.find((u) => u.id === uid);
  const now = new Date().toISOString();
  if (!user) {
    user = { id: uid, email: email.toLowerCase(), passwordHash: '', passwordSalt: '', role: prof.role, displayName: prof.name ?? fallbackName ?? email.split('@')[0], createdAt: now };
    insert('users', user, uid, 'sign_up');
  } else if (user.role !== prof.role) {
    // The server is authoritative (e.g. the owner added this email to the physiotherapist allowlist).
    update('users', uid, { role: prof.role }, uid, 'role_from_server');
    user = { ...user, role: prof.role };
  }
  if (prof.role === 'patient' && !getDb().patients.some((p) => p.userId === uid)) {
    const p: Patient = { id: uuid(), userId: uid, name: user.displayName, preferredLanguage: 'en', createdAt: now };
    insert('patients', p, uid);
    for (const c of getDb().clinicians.filter((c) => !c.isDemo)) insert('careRelationships', { id: uuid(), patientId: p.id, clinicianId: c.id, status: 'active', createdAt: now }, uid);
  }
  if (prof.role === 'clinician' && !getDb().clinicians.some((c) => c.userId === uid)) {
    const c: Clinician = { id: uuid(), userId: uid, name: user.displayName, title: 'Physiotherapist', clinic: getDb().settings.clinicName, createdAt: now };
    insert('clinicians', c, uid);
  }
  setSession(uid);
  void syncNow();
  return user;
}

export async function remoteSignUp(args: { email: string; password: string; name: string }, setSession: SetSession): Promise<User> {
  if (args.password.length < 8) throw new RemoteAuthError('password');
  const email = args.email.trim().toLowerCase();
  const { data, error } = await supabase().auth.signUp({ email, password: args.password, options: { data: { display_name: args.name.trim() }, emailRedirectTo: `${location.origin}/auth?mode=signin` } });
  if (error) throw new RemoteAuthError(/registered|exists/i.test(error.message) ? 'exists' : /password/i.test(error.message) ? 'password' : 'server');
  if (!data.session || !data.user) throw new RemoteAuthError('confirm');
  return establish(data.user.id, email, args.name.trim(), setSession);
}

export async function remoteSignIn(emailRaw: string, password: string, setSession: SetSession): Promise<User> {
  const email = emailRaw.trim().toLowerCase();
  const { data, error } = await supabase().auth.signInWithPassword({ email, password });
  if (error) throw new RemoteAuthError(/confirm/i.test(error.message) ? 'confirm' : /fetch|network/i.test(error.message) ? 'offline' : 'invalid');
  return establish(data.user.id, email, undefined, setSession);
}

/** On app start: resume a saved Supabase session (works offline from the local copy). */
export async function restoreRemoteSession(currentLocal: string | null, setSession: SetSession): Promise<void> {
  const { data } = await supabase().auth.getSession();
  const s = data.session;
  if (!s) {
    // The local session belongs to a real account whose server session has ended: sign out locally.
    const u = currentLocal ? getDb().users.find((x) => x.id === currentLocal) : undefined;
    if (u && !u.isDemo) {
      clearLocalRealData();
      setSession(null);
    }
    return;
  }
  if (currentLocal !== s.user.id) setSession(null);
  try {
    await establish(s.user.id, s.user.email ?? '', undefined, setSession);
  } catch {
    // Offline: keep working from the local copy; the outbox is sent when the connection returns.
    if (getDb().users.some((u) => u.id === s.user.id)) setSession(s.user.id);
  }
}

/** Removes every non-demo record from this device (shared-device privacy after sign-out). */
export function clearLocalRealData() {
  let db = getDb();
  for (const p of db.patients.filter((x) => !x.isDemo)) db = erasePatient(db, p.id, new Date().toISOString());
  db = { ...db, users: db.users.filter((u) => u.isDemo), clinicians: db.clinicians.filter((c) => c.isDemo), audit: db.audit.filter((e) => db.users.some((u) => u.id === e.actorId)) };
  replaceDb(db);
  // The local copy is gone, so the next sign-in must pull everything again.
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('dl.sync.cursor.')) localStorage.removeItem(k);
  } catch {
    /* storage disabled */
  }
}

export async function remoteSignOut(setSession: SetSession): Promise<{ unsent: number }> {
  try {
    await flush();
  } catch {
    /* offline: unsent changes stay in this account's outbox and are sent at its next sign-in */
  }
  const unsent = pendingCount();
  stopSync();
  await supabase().auth.signOut().catch(() => undefined);
  clearLocalRealData();
  setSession(null);
  return { unsent };
}

export async function requestPasswordReset(email: string) {
  const { error } = await supabase().auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo: `${location.origin}/auth?mode=reset` });
  if (error) throw new RemoteAuthError('server');
}

export async function setNewPassword(password: string, setSession: SetSession): Promise<User> {
  if (password.length < 8) throw new RemoteAuthError('password');
  const { data, error } = await supabase().auth.updateUser({ password });
  if (error || !data.user) throw new RemoteAuthError('server');
  return establish(data.user.id, data.user.email ?? '', undefined, setSession);
}

/** Patient account deletion: the server removes every linked record and the sign-in itself. */
export async function remoteDeleteMyAccount(setSession: SetSession) {
  const { error } = await supabase().rpc('delete_my_data');
  if (error) throw new RemoteAuthError('server');
  stopSync();
  await supabase().auth.signOut().catch(() => undefined);
  clearLocalRealData();
  setSession(null);
}
