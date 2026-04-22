import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

// In-memory storage adapter — Supabase client needs some storage for PKCE verifier.
// We don't want to persist anything automatically; we handle session storage ourselves.
const memoryStore = new Map<string, string>();

const storage = {
  getItem: (key: string) => memoryStore.get(key) ?? null,
  setItem: (key: string, value: string) => {
    memoryStore.set(key, value);
  },
  removeItem: (key: string) => {
    memoryStore.delete(key);
  },
};

export function createPkceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      flowType: 'pkce',
      persistSession: true,
      storage,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export function createAuthenticatedClient(
  accessToken: string,
  refreshToken: string,
): SupabaseClient {
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
  // Also set the session so auth.getUser() works
  client.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
  return client;
}
