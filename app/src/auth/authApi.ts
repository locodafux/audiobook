import type { AuthFailure } from './errors';

export class AuthFlowError extends Error {
  constructor(readonly failure: AuthFailure) {
    super(failure);
    this.name = 'AuthFlowError';
  }
}

/** `pending` = registered, waiting for an admin to approve. */
export type AccessStatus = 'active' | 'pending' | 'revoked' | 'unknown';

/**
 * Everything the sign-in flow needs from the backend. Methods throw
 * AuthFlowError so the state machine never sees Supabase's own error shapes.
 */
export interface AuthApi {
  /** Asks for an account; it starts out pending. Does not sign in. */
  register(username: string, password: string): Promise<void>;
  signIn(username: string, password: string): Promise<void>;
  /** The signed-in username from the stored session; null when signed out. */
  restoreSession(): Promise<{ username: string } | null>;
  /** `unknown` means we could not ask (offline): the stored session is trusted. */
  checkAccess(): Promise<AccessStatus>;
  signOut(): Promise<void>;
}
