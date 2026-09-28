import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { remoteConfigured, SUPABASE_ANON_KEY, SUPABASE_URL } from './config';

/**
 * Supabase connection (shared records across devices). The anon key is public by design: every
 * read and write is checked by row-level security on the server. The service-role key must NEVER
 * be put in the app or in any VITE_ variable.
 */

export { remoteConfigured };

let client: SupabaseClient | null = null;
export function supabase(): SupabaseClient {
  if (!remoteConfigured()) throw new Error('Supabase is not configured for this build');
  client ??= createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'dl.auth' } });
  return client;
}
