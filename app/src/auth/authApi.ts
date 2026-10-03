import type { AuthFailure } from './errors';

export class AuthFlowError extends Error {
  constructor(readonly failure: AuthFailure) {
    super(failure);
    this.name = 'AuthFlowError';
  }
}

export type AccessStatus = 'active' | 'revoked' | 'unknown';

/**
 * Everything the sign-in flow needs from the backend. Methods throw
 * AuthFlowError so the state machine never sees Supabase's own error shapes.
 */
export interface AuthApi {
  /** Emails a link and a 6-digit code. Fails with `not_invited` for strangers. */
  requestCode(email: string): Promise<void>;
  verifyCode(email: string, code: string): Promise<void>;
  /** Trades the `code` from a PKCE link for a session. */
  exchangeLinkCode(code: string): Promise<void>;
  /** The signed-in email from the stored session; null when signed out. */
  restoreSession(): Promise<{ email: string } | null>;
  /** `unknown` means we could not ask (offline): the stored session is trusted. */
  checkAccess(): Promise<AccessStatus>;
  signOut(): Promise<void>;
}
