import type { SupabaseClient } from '@supabase/supabase-js';

import { AuthFlowError, type AccessStatus, type AuthApi } from './authApi';
import { classifyAuthError } from './errors';

export const AUTH_REDIRECT = 'hearthread://auth';

const fail = (error: unknown): never => {
  throw new AuthFlowError(classifyAuthError(error));
};

export function supabaseAuth(client: SupabaseClient): AuthApi {
  return {
    async requestCode(email) {
      // Sign-ups are disabled on the server, which is what really keeps strangers out;
      // shouldCreateUser:false only makes the intent explicit.
      const { error } = await client.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false, emailRedirectTo: AUTH_REDIRECT },
      });
      if (error) fail(error);
    },

    async verifyCode(email, token) {
      const { error } = await client.auth.verifyOtp({ email, token, type: 'email' });
      if (error) fail(error);
    },

    async exchangeLinkCode(code) {
      const { error } = await client.auth.exchangeCodeForSession(code);
      if (error) fail(error);
    },

    async restoreSession() {
      const { data } = await client.auth.getSession();
      const email = data.session?.user.email;
      return email ? { email } : null;
    },

    async checkAccess(): Promise<AccessStatus> {
      // members: a signed-in user can read only their own row.
      const { data, error } = await client.from('members').select('status').maybeSingle();
      if (error) return classifyAuthError(error) === 'banned' ? 'revoked' : 'unknown';
      // No row at all (or a revoked one) means the invite is gone.
      return (data as { status?: string } | null)?.status === 'active' ? 'active' : 'revoked';
    },

    async signOut() {
      await client.auth.signOut();
    },
  };
}
