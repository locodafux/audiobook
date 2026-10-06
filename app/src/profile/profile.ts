import type { SupabaseClient } from '@supabase/supabase-js';

import type { KeyValueStore } from '../data/offlineList';

export const PROFILE_KEY = 'hearthread.profile.v1';

/** From the signed-in person's own `members` row. `isAdmin` only decides whether the Requests screen is offered; the server checks it again. */
export type Profile = { displayName: string; invitedBy: string | null; isAdmin: boolean };

export interface ProfileApi {
  /** Null when there is no row to read (for example the server is unreachable); throws on errors. */
  get(): Promise<Profile | null>;
}

/** RLS lets a signed-in friend read only their own `members` row, so no filter is needed. */
export function supabaseProfile(client: SupabaseClient): ProfileApi {
  return {
    async get() {
      const { data, error } = await client.from('members').select('display_name,invited_by,is_admin').maybeSingle();
      if (error) throw error;
      return data ? { displayName: String(data.display_name), invitedBy: (data.invited_by as string | null) ?? null, isAdmin: data.is_admin === true } : null;
    },
  };
}

const parse = (raw: string | null): Profile | null => {
  try {
    const p = JSON.parse(raw ?? 'null') as Partial<Profile> | null;
    return p && typeof p.displayName === 'string' ? { displayName: p.displayName, invitedBy: typeof p.invitedBy === 'string' ? p.invitedBy : null, isAdmin: p.isAdmin === true } : null;
  } catch {
    return null;
  }
};

/** The saved copy (for the first paint and offline). */
export async function readSavedProfile(kv: KeyValueStore): Promise<Profile | null> {
  return parse(await kv.getItem(PROFILE_KEY).catch(() => null));
}

/** Asks the server and keeps a copy; falls back to the copy (or null) when it cannot. */
export async function loadProfile(api: ProfileApi, kv: KeyValueStore): Promise<Profile | null> {
  try {
    const fresh = await api.get();
    if (fresh) await kv.setItem(PROFILE_KEY, JSON.stringify(fresh)).catch(() => {});
    return fresh ?? (await readSavedProfile(kv));
  } catch {
    return readSavedProfile(kv);
  }
}
