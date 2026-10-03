import { AuthFlowError, type AccessStatus, type AuthApi } from './authApi';
import { parseAuthLink } from './authLink';
import { classifyAuthError } from './errors';
import { chunkedSecureStorage, type SecureStoreLike } from './secureStorage';
import { createSignInController } from './signInController';
import { signInReducer, type SignInEvent, type SignInState } from './signInMachine';

type FakeApi = AuthApi & { calls: string[] };

const fakeApi = (over: Partial<AuthApi> = {}): FakeApi => {
  const calls: string[] = [];
  const rec =
    <A extends unknown[]>(name: string, fn: (...a: A) => Promise<void>) =>
    (...a: A) => {
      calls.push(`${name}:${a.join(',')}`);
      return fn(...a);
    };
  return {
    calls,
    requestCode: rec('requestCode', async () => {}),
    verifyCode: rec('verifyCode', async () => {}),
    exchangeLinkCode: rec('exchangeLinkCode', async () => {}),
    restoreSession: async () => null,
    checkAccess: async (): Promise<AccessStatus> => 'active',
    signOut: rec('signOut', async () => {}),
    ...over,
  };
};
const reject = (failure: ConstructorParameters<typeof AuthFlowError>[0]) => async () => {
  throw new AuthFlowError(failure);
};

describe('signInReducer', () => {
  const run = (events: SignInEvent[], from: SignInState = { name: 'restoring' }) =>
    events.reduce(signInReducer, from);

  it('goes to entry when there is no stored session', () => {
    expect(run([{ type: 'RESTORED', email: null }])).toEqual({ name: 'entry', email: '' });
  });

  it('trusts a stored session', () => {
    expect(run([{ type: 'RESTORED', email: 'a@b.co' }])).toEqual({ name: 'signed_in', email: 'a@b.co' });
  });

  it('rejects a malformed email without sending', () => {
    const s = run([{ type: 'RESTORED', email: null }, { type: 'EMAIL_CHANGED', email: 'nope' }, { type: 'SUBMIT_EMAIL' }]);
    expect(s).toEqual({ name: 'entry', email: 'nope', error: 'invalid_email' });
  });

  it('lowercases and trims the email when sending', () => {
    const s = run([{ type: 'RESTORED', email: null }, { type: 'EMAIL_CHANGED', email: '  Ana@Mail.COM ' }, { type: 'SUBMIT_EMAIL' }]);
    expect(s).toEqual({ name: 'sending', email: 'ana@mail.com' });
  });

  it.each([
    ['not_invited', { name: 'not_invited', email: 'a@b.co' }],
    ['offline', { name: 'offline', email: 'a@b.co' }],
    ['rate_limited', { name: 'entry', email: 'a@b.co', error: 'rate_limited' }],
    ['unknown', { name: 'entry', email: 'a@b.co', error: 'failed' }],
  ] as const)('maps a %s send failure', (failure, expected) => {
    expect(signInReducer({ name: 'sending', email: 'a@b.co' }, { type: 'REQUEST_FAILED', failure })).toEqual(expected);
  });

  it('ignores a late result after the user moved on', () => {
    const entry: SignInState = { name: 'entry', email: '' };
    expect(signInReducer(entry, { type: 'REQUEST_OK' })).toBe(entry);
  });

  it('keeps the revoked verdict even if a session start arrives later', () => {
    const ended: SignInState = { name: 'access_ended' };
    expect(signInReducer(ended, { type: 'SESSION_STARTED', email: 'a@b.co' })).toBe(ended);
  });

  it('unknown access (offline) still signs in', () => {
    const s = signInReducer({ name: 'signing_in', email: 'a@b.co' }, { type: 'ACCESS_RESULT', status: 'unknown' });
    expect(s).toEqual({ name: 'signed_in', email: 'a@b.co' });
  });

  it('a revoked check ends access even when already signed in', () => {
    const s = signInReducer({ name: 'signed_in', email: 'a@b.co' }, { type: 'ACCESS_RESULT', status: 'revoked' });
    expect(s).toEqual({ name: 'access_ended' });
  });

  it('a failed link with no known email returns to entry with a hint', () => {
    const s = signInReducer({ name: 'signing_in', email: '' }, { type: 'LINK_FAILED', reason: 'expired' });
    expect(s).toEqual({ name: 'entry', email: '', error: 'link_expired' });
  });
});

describe('createSignInController', () => {
  it('signs in with the emailed code, then checks access', async () => {
    const api = fakeApi();
    const c = createSignInController(api);
    await c.start();
    c.setEmail('Ana@Mail.com');
    await c.submitEmail();
    expect(c.getState()).toEqual({ name: 'sent', email: 'ana@mail.com', verifying: false });
    await c.submitCode('481 207');
    expect(api.calls).toContain('verifyCode:ana@mail.com,481207');
    expect(c.getState()).toEqual({ name: 'signed_in', email: 'ana@mail.com' });
  });

  it('a stranger lands on the invite-list message', async () => {
    const c = createSignInController(fakeApi({ requestCode: reject('not_invited') }));
    await c.start();
    c.setEmail('dave@yahoo.com');
    await c.submitEmail();
    expect(c.getState()).toEqual({ name: 'not_invited', email: 'dave@yahoo.com' });
    c.useOtherEmail();
    expect(c.getState()).toEqual({ name: 'entry', email: '' });
  });

  it('a wrong code stays on the code screen with an error, and can retry', async () => {
    let first = true;
    const c = createSignInController(
      fakeApi({
        verifyCode: async () => {
          if (first) {
            first = false;
            throw new AuthFlowError('invalid');
          }
        },
      }),
    );
    await c.start();
    c.setEmail('a@b.co');
    await c.submitEmail();
    await c.submitCode('123456');
    expect(c.getState()).toEqual({ name: 'sent', email: 'a@b.co', verifying: false, error: 'invalid' });
    await c.submitCode('123456');
    expect(c.getState().name).toBe('signed_in');
  });

  it('ignores a code that is not six digits', async () => {
    const api = fakeApi();
    const c = createSignInController(api);
    await c.start();
    c.setEmail('a@b.co');
    await c.submitEmail();
    await c.submitCode('12345');
    expect(api.calls.some((x) => x.startsWith('verifyCode'))).toBe(false);
  });

  it('signs in from a PKCE link, even on a cold start', async () => {
    let signedIn = false;
    const api = fakeApi({
      exchangeLinkCode: async () => void (signedIn = true),
      restoreSession: async () => (signedIn ? { email: 'ana@mail.com' } : null),
    });
    const c = createSignInController(api);
    await c.start();
    await c.openLink('hearthread://auth?code=abc123');
    expect(c.getState()).toEqual({ name: 'signed_in', email: 'ana@mail.com' });
  });

  it('shows the expired state for a used link when the email is known, and resends', async () => {
    const c = createSignInController(fakeApi({ exchangeLinkCode: reject('expired') }));
    await c.start();
    c.setEmail('ana@mail.com');
    await c.submitEmail();
    await c.openLink('hearthread://auth?code=old');
    expect(c.getState()).toEqual({ name: 'link_expired', email: 'ana@mail.com' });
    await c.submitEmail();
    expect(c.getState().name).toBe('sent');
  });

  it('ignores links that are not auth links', async () => {
    const c = createSignInController(fakeApi());
    await c.start();
    await c.openLink('hearthread://other');
    await c.openLink(null);
    expect(c.getState()).toEqual({ name: 'entry', email: '' });
  });

  it('a revoked member lands on "access ended" and can sign out', async () => {
    const api = fakeApi({ restoreSession: async () => ({ email: 'a@b.co' }), checkAccess: async () => 'revoked' });
    const c = createSignInController(api);
    await c.start();
    expect(c.getState()).toEqual({ name: 'access_ended' });
    await c.signOut();
    expect(api.calls).toContain('signOut:');
    expect(c.getState()).toEqual({ name: 'entry', email: '' });
  });

  it('opens signed in when offline at launch (stored session trusted)', async () => {
    const c = createSignInController(
      fakeApi({ restoreSession: async () => ({ email: 'a@b.co' }), checkAccess: async () => 'unknown' }),
    );
    await c.start();
    expect(c.getState()).toEqual({ name: 'signed_in', email: 'a@b.co' });
  });

  it('notifies subscribers only when the state changes', async () => {
    const c = createSignInController(fakeApi());
    const seen: string[] = [];
    c.subscribe(() => seen.push(c.getState().name));
    await c.start();
    c.setEmail('x');
    expect(seen).toEqual(['entry', 'entry']);
  });
});

describe('parseAuthLink', () => {
  it('reads the PKCE code', () => {
    expect(parseAuthLink('hearthread://auth?code=abc-1')).toEqual({ type: 'code', code: 'abc-1' });
  });
  it('reads an expired-link error from query or fragment', () => {
    const expected = { type: 'error', reason: 'expired' };
    expect(parseAuthLink('hearthread://auth?error=access_denied&error_code=otp_expired')).toEqual(expected);
    expect(parseAuthLink('hearthread://auth#error=access_denied&error_code=otp_expired')).toEqual(expected);
  });
  it('treats other errors as invalid', () => {
    expect(parseAuthLink('hearthread://auth?error=server_error')).toEqual({ type: 'error', reason: 'invalid' });
  });
  it('ignores everything else', () => {
    expect(parseAuthLink('hearthread://auth')).toBeNull();
    expect(parseAuthLink('https://evil.example/auth?code=x')).toBeNull();
    expect(parseAuthLink('hearthread://authx?code=x')).toBeNull();
    expect(parseAuthLink(undefined)).toBeNull();
  });
});

describe('classifyAuthError', () => {
  it.each([
    [{ code: 'otp_disabled' }, 'not_invited'],
    [{ code: 'signup_disabled' }, 'not_invited'],
    [{ message: 'Signups not allowed for otp' }, 'not_invited'],
    [{ code: 'otp_expired' }, 'expired'],
    [{ message: 'Token has expired or is invalid' }, 'expired'],
    [{ code: 'over_email_send_rate_limit' }, 'rate_limited'],
    [{ status: 429 }, 'rate_limited'],
    [{ name: 'AuthRetryableFetchError', status: 0, message: 'Network request failed' }, 'offline'],
    [{ code: 'user_banned' }, 'banned'],
    [{ code: 'validation_failed' }, 'invalid'],
    [new Error('???'), 'unknown'],
    [undefined, 'unknown'],
  ])('%j -> %s', (error, expected) => {
    expect(classifyAuthError(error)).toBe(expected);
  });
});

describe('chunkedSecureStorage', () => {
  const fakeStore = () => {
    const data = new Map<string, string>();
    const store: SecureStoreLike = {
      getItemAsync: async (k) => data.get(k) ?? null,
      setItemAsync: async (k, v) => {
        if (v.length > 2048) throw new Error('value too large');
        data.set(k, v);
      },
      deleteItemAsync: async (k) => void data.delete(k),
    };
    return { data, store };
  };

  it('round-trips a value bigger than the 2 KB limit', async () => {
    const { store } = fakeStore();
    const s = chunkedSecureStorage(store);
    const big = JSON.stringify({ token: 'x'.repeat(5000), emoji: '🙂'.repeat(50) });
    await s.setItem('session', big);
    expect(await s.getItem('session')).toBe(big);
  });

  it('removes stale chunks when a value shrinks and on remove', async () => {
    const { store, data } = fakeStore();
    const s = chunkedSecureStorage(store);
    await s.setItem('k', 'a'.repeat(5000));
    await s.setItem('k', 'small');
    expect([...data.keys()].sort()).toEqual(['k', 'k.0']);
    await s.removeItem('k');
    expect(data.size).toBe(0);
    expect(await s.getItem('k')).toBeNull();
  });

  it('treats a torn write as signed out', async () => {
    const { store, data } = fakeStore();
    const s = chunkedSecureStorage(store);
    await s.setItem('k', 'a'.repeat(5000));
    data.delete('k.1');
    expect(await s.getItem('k')).toBeNull();
  });
});
