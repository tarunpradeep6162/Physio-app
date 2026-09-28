/**
 * Whether this build talks to the clinic's Supabase server. Enabled when the build has
 * VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY. Kept free of imports so the main bundle does not
 * load the Supabase client until it is needed.
 */
export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
export const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();

export const remoteConfigured = (): boolean => !!SUPABASE_URL && !!SUPABASE_ANON_KEY && /^https:\/\//.test(SUPABASE_URL);

export class RemoteAuthError extends Error {
  constructor(public code: 'invalid' | 'exists' | 'password' | 'confirm' | 'offline' | 'server') {
    super(code);
  }
}
