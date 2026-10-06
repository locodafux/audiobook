import { AuthFlowError, type AuthApi } from './authApi';
import type { AuthFailure } from './errors';
import { initialSignInState, signInReducer, type EntryMode, type SignInEvent, type SignInState } from './signInMachine';
import { normalizeUsername, validateForm } from './username';

const failureOf = (error: unknown): AuthFailure => (error instanceof AuthFlowError ? error.failure : 'unknown');

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

  /** The session exists; ask whether this member is approved. */
  const finishSignIn = async (username: string) => {
    dispatch({ type: 'SESSION_STARTED', username });
    dispatch({ type: 'ACCESS_RESULT', status: await api.checkAccess() });
  };

  /** Validates, runs `go` (register and/or sign in) and finishes the sign-in. `confirm` is null for log in. */
  const submit = async (rawUsername: string, password: string, confirm: string | null, go: (username: string) => Promise<void>) => {
    if (state.name !== 'entry' || state.busy) return;
    const username = normalizeUsername(rawUsername);
    const invalid = validateForm(username, password, confirm);
    if (invalid) return dispatch({ type: 'FAILED', error: invalid });
    dispatch({ type: 'SUBMIT' });
    try {
      await go(username);
    } catch (error) {
      return dispatch({ type: 'FAILED', error: failureOf(error) });
    }
    await finishSignIn(username);
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
      dispatch({ type: 'RESTORED', username: session?.username ?? null });
      if (session) dispatch({ type: 'ACCESS_RESULT', status: await api.checkAccess() });
    },

    setMode: (mode: EntryMode) => dispatch({ type: 'MODE', mode }),

    logIn: (username: string, password: string) => submit(username, password, null, (u) => api.signIn(u, password)),

    /** Creates a pending account, then signs in so the person lands on "waiting for approval". */
    register: (username: string, password: string, confirm: string) =>
      submit(username, password, confirm, async (u) => {
        await api.register(u, password);
        await api.signIn(u, password);
      }),

    async signOut() {
      await api.signOut().catch(() => {});
      dispatch({ type: 'SIGNED_OUT' });
    },

    /** The session vanished while signed in (refresh token refused or removed). */
    sessionLost: () => (state.name === 'signed_in' || state.name === 'pending') && dispatch({ type: 'SIGNED_OUT' }),

    /** Asks again whether this member is approved (when the app comes to the foreground, or "Check again"). */
    async recheckAccess() {
      if (state.name !== 'signed_in' && state.name !== 'pending') return;
      dispatch({ type: 'ACCESS_RESULT', status: await api.checkAccess() });
    },

    /** The session was refused while the app was open (for example a revoked member's refresh). */
    accessEnded: () => dispatch({ type: 'ACCESS_RESULT', status: 'revoked' }),
  };
}

export type SignInController = ReturnType<typeof createSignInController>;
