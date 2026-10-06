import type { AccessStatus } from './authApi';
import type { AuthFailure } from './errors';
import type { FormError } from './username';

export type EntryMode = 'login' | 'register';
export type EntryError = FormError | 'invalid_login' | 'username_taken' | 'registration_full' | 'rate_limited' | 'offline' | 'failed';

export type SignInState =
  | { name: 'restoring' }
  | { name: 'entry'; mode: EntryMode; busy: boolean; error?: EntryError }
  | { name: 'signing_in'; username: string }
  /** Registered, waiting for an admin to approve. */
  | { name: 'pending'; username: string }
  | { name: 'signed_in'; username: string }
  | { name: 'access_ended' };

export type SignInEvent =
  | { type: 'RESTORED'; username: string | null }
  | { type: 'MODE'; mode: EntryMode }
  | { type: 'SUBMIT' }
  | { type: 'FAILED'; error: FormError | AuthFailure }
  | { type: 'SESSION_STARTED'; username: string }
  | { type: 'ACCESS_RESULT'; status: AccessStatus }
  | { type: 'SIGNED_OUT' };

export const initialSignInState: SignInState = { name: 'restoring' };
const entry = (mode: EntryMode = 'login'): SignInState => ({ name: 'entry', mode, busy: false });

const entryError = (error: FormError | AuthFailure): EntryError =>
  error === 'banned' ? 'invalid_login' : error === 'unknown' ? 'failed' : error;

export function signInReducer(state: SignInState, event: SignInEvent): SignInState {
  switch (event.type) {
    case 'RESTORED':
      return state.name === 'restoring' ? (event.username ? { name: 'signed_in', username: event.username } : entry()) : state;

    case 'MODE':
      return state.name === 'entry' && !state.busy ? entry(event.mode) : state;

    case 'SUBMIT':
      return state.name === 'entry' && !state.busy ? { name: 'entry', mode: state.mode, busy: true } : state;

    case 'FAILED':
      return state.name === 'entry' ? { name: 'entry', mode: state.mode, busy: false, error: entryError(event.error) } : state;

    case 'SESSION_STARTED':
      return state.name === 'entry' ? { name: 'signing_in', username: event.username } : state;

    case 'ACCESS_RESULT': {
      if (event.status === 'revoked') return { name: 'access_ended' };
      const username = 'username' in state ? state.username : null;
      if (username === null || state.name === 'access_ended') return state;
      if (event.status === 'pending') return { name: 'pending', username };
      // `active`, or `unknown` = could not ask (offline): the stored session is trusted, but a pending member stays pending.
      return event.status === 'unknown' && state.name === 'pending' ? state : { name: 'signed_in', username };
    }

    case 'SIGNED_OUT':
      return entry();
  }
}
