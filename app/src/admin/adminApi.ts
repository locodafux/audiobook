import type { SupabaseClient } from '@supabase/supabase-js';

import { callAccounts } from '../auth/accounts';

export type MemberStatus = 'pending' | 'active' | 'revoked';
export type MemberItem = { userId: string; username: string; status: MemberStatus; isAdmin: boolean; createdAt: string };

/** What the admin screen needs. Every call is checked again on the server (the `accounts` function). */
export interface AdminApi {
  list(): Promise<MemberItem[]>;
  /** Approve (`active`) or reject (`revoked`). */
  setStatus(userId: string, status: 'active' | 'revoked'): Promise<void>;
  resetPassword(userId: string, password: string): Promise<void>;
}

type Row = { user_id: string; username: string | null; status: MemberStatus; is_admin: boolean; created_at: string };

export const toItems = (rows: Row[]): MemberItem[] =>
  rows.map((r) => ({ userId: r.user_id, username: r.username ?? '(no username)', status: r.status, isAdmin: r.is_admin, createdAt: r.created_at }));

export function supabaseAdmin(client: SupabaseClient): AdminApi {
  return {
    async list() {
      return toItems((await callAccounts<{ members: Row[] }>(client, { action: 'list' })).members);
    },
    async setStatus(userId, status) {
      await callAccounts(client, { action: 'set_status', user_id: userId, status });
    },
    async resetPassword(userId, password) {
      await callAccounts(client, { action: 'reset_password', user_id: userId, password });
    },
  };
}
