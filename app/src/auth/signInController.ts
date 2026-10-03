import { AuthFlowError, type AuthApi } from './authApi';
import { parseAuthLink } from './authLink';
import {
  initialSignInState,
  normalizeCode,
  signInReducer,
  type SignInEvent,
  type SignInState,
} from './signInMachine';
import type { AuthFailure } from './errors';

const failureOf = (error: unknown): AuthFailure =>
  error instanceof AuthFlowError ? error.failure : 'unknown';

/** Runs the sign-in state machine against an AuthApi. No React in here, so it is testable. */
export function createSignInController(api: AuthApi) {
  let state: SignInState = initialSignInState;
  const listeners = new Set<() => void>();

  const dispatch = (event: SignInEvent) => {
    const next = signInReducer(state, event);
    if (next === state) return;
    state = next;
    listeners.forEach((l) => l());
  };

  /** The session exists; ask whether this member may still use the app. */
  const finishSignIn = async (email: string) => {
    dispatch({ type: 'SESSION_STARTED', email });
    dispatch({ type: 'ACCESS_RESULT', status: await api.checkAccess() });
  };

  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },

    /** Reads the stored session. Offline, the stored session is trusted. */
    async start() {
      const session = await api.restoreSession().catch(() => null);
      dispatch({ type: 'RESTORED', email: session?.email ?? null });
      if (session) dispatch({ type: 'ACCESS_RESULT', status: await api.checkAccess() });
    },

    setEmail: (email: string) => dispatch({ type: 'EMAIL_CHANGED', email }),

    /** Also used to resend and to retry after offline / not invited / expired. */
    async submitEmail() {
      dispatch({ type: 'SUBMIT_EMAIL' });
      if (state.name !== 'sending') return;
      try {
        await api.requestCode(state.email);
        dispatch({ type: 'REQUEST_OK' });
      } catch (error) {
        dispatch({ type: 'REQUEST_FAILED', failure: failureOf(error) });
      }
    },

    async submitCode(rawCode: string) {
      const code = normalizeCode(rawCode);
      if (state.name !== 'sent' || code.length !== 6) return;
      const { email } = state;
      dispatch({ type: 'SUBMIT_CODE' });
      try {
        await api.verifyCode(email, code);
      } catch (error) {
        dispatch({ type: 'CODE_FAILED', failure: failureOf(error) });
        return;
      }
      await finishSignIn(email);
    },

    /** Call with every URL the app is opened with; non-auth URLs are ignored. */
    async openLink(url: string | null | undefined) {
      const link = parseAuthLink(url);
      if (!link) return;
      dispatch({ type: 'LINK_RECEIVED' });
      if (state.name !== 'signing_in') return;
      const { email } = state;
      if (link.type === 'error') {
        dispatch({ type: 'LINK_FAILED', reason: link.reason });
        return;
      }
      try {
        await api.exchangeLinkCode(link.code);
      } catch (error) {
        dispatch({ type: 'LINK_FAILED', reason: failureOf(error) === 'expired' ? 'expired' : 'invalid' });
        return;
      }
      const session = await api.restoreSession().catch(() => null);
      await finishSignIn(session?.email ?? email);
    },

    useOtherEmail: () => dispatch({ type: 'USE_OTHER_EMAIL' }),

    async signOut() {
      await api.signOut().catch(() => {});
      dispatch({ type: 'SIGNED_OUT' });
    },

    /** The session vanished while signed in (refresh token refused or removed). */
    sessionLost: () => state.name === 'signed_in' && dispatch({ type: 'SIGNED_OUT' }),

    /** Asks again whether this member may still use the app (for example when the app comes to the foreground). */
    async recheckAccess() {
      if (state.name !== 'signed_in') return;
      dispatch({ type: 'ACCESS_RESULT', status: await api.checkAccess() });
    },

    /** The session was refused while the app was open (for example a revoked member's refresh). */
    accessEnded: () => dispatch({ type: 'ACCESS_RESULT', status: 'revoked' }),
  };
}

export type SignInController = ReturnType<typeof createSignInController>;