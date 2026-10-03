import type { AccessStatus } from './authApi';
import type { AuthFailure } from './errors';

export type EntryError = 'invalid_email' | 'rate_limited' | 'failed' | 'link_expired';
export type CodeError = 'invalid' | 'expired' | 'offline' | 'failed';

export type SignInState =
  | { name: 'restoring' }
  | { name: 'entry'; email: string; error?: EntryError }
  | { name: 'sending'; email: string }
  | { name: 'sent'; email: string; verifying: boolean; error?: CodeError }
  | { name: 'not_invited'; email: string }
  | { name: 'link_expired'; email: string }
  | { name: 'offline'; email: string }
  | { name: 'signing_in'; email: string }
  | { name: 'signed_in'; email: string }
  | { name: 'access_ended' };

export type SignInEvent =
  | { type: 'RESTORED'; email: string | null }
  | { type: 'EMAIL_CHANGED'; email: string }
  | { type: 'SUBMIT_EMAIL' }
  | { type: 'REQUEST_OK' }
  | { type: 'REQUEST_FAILED'; failure: AuthFailure }
  | { type: 'SUBMIT_CODE' }
  | { type: 'CODE_FAILED'; failure: AuthFailure }
  | { type: 'LINK_RECEIVED' }
  | { type: 'LINK_FAILED'; reason: 'expired' | 'invalid' }
  | { type: 'SESSION_STARTED'; email: string }
  | { type: 'ACCESS_RESULT'; status: AccessStatus }
  | { type: 'USE_OTHER_EMAIL' }
  | { type: 'SIGNED_OUT' };

export const initialSignInState: SignInState = { name: 'restoring' };

export const normalizeEmail = (raw: string) => raw.trim().toLowerCase();
export const isPlausibleEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
/** Keeps digits only, so "481 207" and "481-207" both work. */
export const normalizeCode = (raw: string) => raw.replace(/\D/g, '');

/** Where the flow is, as the email it is about ('' when none is known yet). */
const emailOf = (s: SignInState) => ('email' in s ? s.email : '');

export function signInReducer(state: SignInState, event: SignInEvent): SignInState {
  switch (event.type) {
    case 'RESTORED':
      return state.name === 'restoring'
        ? event.email
          ? { name: 'signed_in', email: event.email }
          : { name: 'entry', email: '' }
        : state;

    case 'EMAIL_CHANGED':
      return state.name === 'entry' ? { name: 'entry', email: event.email } : state;

    case 'SUBMIT_EMAIL': {
      if (!['entry', 'sent', 'not_invited', 'link_expired', 'offline'].includes(state.name)) return state;
      const email = normalizeEmail(emailOf(state));
      return isPlausibleEmail(email)
        ? { name: 'sending', email }
        : { name: 'entry', email: emailOf(state), error: 'invalid_email' };
    }

    case 'REQUEST_OK':
      return state.name === 'sending' ? { name: 'sent', email: state.email, verifying: false } : state;

    case 'REQUEST_FAILED': {
      if (state.name !== 'sending') return state;
      const { email } = state;
      switch (event.failure) {
        case 'not_invited':
          return { name: 'not_invited', email };
        case 'offline':
          return { name: 'offline', email };
        case 'rate_limited':
          return { name: 'entry', email, error: 'rate_limited' };
        default:
          return { name: 'entry', email, error: 'failed' };
      }
    }

    case 'SUBMIT_CODE':
      return state.name === 'sent' && !state.verifying
        ? { name: 'sent', email: state.email, verifying: true }
        : state;

    case 'CODE_FAILED': {
      if (state.name !== 'sent') return state;
      const error: CodeError =
        event.failure === 'expired' ? 'expired' : event.failure === 'offline' ? 'offline' : event.failure === 'invalid' ? 'invalid' : 'failed';
      return { name: 'sent', email: state.email, verifying: false, error };
    }

    case 'LINK_RECEIVED':
      return state.name === 'signed_in' || state.name === 'access_ended' || state.name === 'restoring'
        ? state
        : { name: 'signing_in', email: emailOf(state) };

    case 'LINK_FAILED': {
      if (state.name !== 'signing_in') return state;
      // A cold start by link has no email to prefill, so fall back to the entry screen.
      return state.email
        ? { name: 'link_expired', email: state.email }
        : { name: 'entry', email: '', error: 'link_expired' };
    }

    case 'SESSION_STARTED':
      return state.name === 'signed_in' || state.name === 'access_ended'
        ? state
        : { name: 'signing_in', email: event.email };

    case 'ACCESS_RESULT':
      if (event.status === 'revoked') return { name: 'access_ended' };
      // `unknown` = could not ask (offline): the stored session is trusted.
      return state.name === 'signing_in' ? { name: 'signed_in', email: state.email } : state;

    case 'USE_OTHER_EMAIL':
      return { name: 'entry', email: '' };

    case 'SIGNED_OUT':
      return { name: 'entry', email: '' };
  }
}
