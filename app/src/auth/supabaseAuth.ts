import type { SupabaseClient } from '@supabase/supabase-js';

import { callAccounts } from './accounts';
import { AuthFlowError, type AccessStatus, type AuthApi } from './authApi';
import { classifyAuthError } from './errors';
import { emailFor, usernameFrom } from './username';

const fail = (error: unknown): never => {
  throw new AuthFlowError(classifyAuthError(error));
};

export function supabaseAuth(client: SupabaseClient): AuthApi {
  return {
    async register(username, password) {
      await callAccounts(client, { action: 'register', username, password });
    },

    async signIn(username, password) {
      // The session is stored by supabase-js (Android Keystore), so offline use keeps working.
      const { error } = await client.auth.signInWithPassword({ email: emailFor(username), password });
      if (error) fail(error);
    },

    async restoreSession() {
      const { data } = await client.auth.getSession();
      const email = data.session?.user.email;
      return email ? { username: usernameFrom(email) } : null;
    },

    async checkAccess(): Promise<AccessStatus> {
      // members: a signed-in user can read only their own row.
      const { data, error } = await client.from('members').select('status').maybeSingle();
      if (error) return classifyAuthError(error) === 'banned' ? 'revoked' : 'unknown';
      const status = (data as { status?: string } | null)?.status;
      // No row at all (or a revoked one) means the access is gone.
      return status === 'active' || status === 'pending' ? status : 'revoked';
    },

    async signOut() {
      await client.auth.signOut();
    },
  };
}
