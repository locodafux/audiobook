import { AuthFlowError, type AccessStatus, type AuthApi } from './authApi';
import { classifyAuthError } from './errors';
import { chunkedSecureStorage, type SecureStoreLike } from './secureStorage';
import { createSignInController } from './signInController';
import { signInReducer, type SignInEvent, type SignInState } from './signInMachine';
import { emailFor, usernameFrom, validateForm } from './username';

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
    register: rec('register', async () => {}),
    signIn: rec('signIn', async () => {}),
    restoreSession: async () => null,
    checkAccess: async (): Promise<AccessStatus> => 'active',
    signOut: rec('signOut', async () => {}),
    ...over,
  };
};
const reject = (failure: ConstructorParameters<typeof AuthFlowError>[0]) => async () => {
  throw new AuthFlowError(failure);
};
const entry = (extra: Partial<Extract<SignInState, { name: 'entry' }>> = {}): SignInState => ({ name: 'entry', mode: 'login', busy: false, ...extra });

describe('username', () => {
  it('maps a username to the internal address and back', () => {
    expect(emailFor('maria_7')).toBe('maria_7@users.hearthread.invalid');
    expect(usernameFrom(emailFor('maria_7'))).toBe('maria_7');
  });

  it('checks the form before anything is sent', () => {
    expect(validateForm('ab', 'longenough', null)).toBe('username_invalid');
    expect(validateForm('has space', 'longenough', null)).toBe('username_invalid');
    expect(validateForm('maria', 'x', null)).toBeNull(); // log in: the server judges the password
    expect(validateForm('maria', 'short', 'short')).toBe('password_short');
    expect(validateForm('maria', 'longenough', 'different1')).toBe('password_mismatch');
    expect(validateForm('maria', 'longenough', 'longenough')).toBeNull();
  });
});

describe('signInReducer', () => {
  const run = (events: SignInEvent[], from: SignInState = { name: 'restoring' }) => events.reduce(signInReducer, from);

  it('goes to log in when there is no stored session', () => {
    expect(run([{ type: 'RESTORED', username: null }])).toEqual(entry());
  });

  it('trusts a stored session', () => {
    expect(run([{ type: 'RESTORED', username: 'ana' }])).toEqual({ name: 'signed_in', username: 'ana' });
  });

  it('switches between log in and register, but not while a request is running', () => {
    expect(run([{ type: 'MODE', mode: 'register' }], entry())).toEqual(entry({ mode: 'register' }));
    const busy = entry({ busy: true });
    expect(signInReducer(busy, { type: 'MODE', mode: 'register' })).toBe(busy);
  });

  it.each([
    ['invalid_login', 'invalid_login'],
    ['username_taken', 'username_taken'],
    ['registration_full', 'registration_full'],
    ['rate_limited', 'rate_limited'],
    ['offline', 'offline'],
    ['banned', 'invalid_login'],
    ['unknown', 'failed'],
    ['password_mismatch', 'password_mismatch'],
  ] as const)('shows %s as %s on the form and lets the person retry', (failure, shown) => {
    expect(signInReducer(entry({ busy: true }), { type: 'FAILED', error: failure })).toEqual(entry({ error: shown }));
  });

  it('ignores a late result after the person moved on', () => {
    const signedIn: SignInState = { name: 'signed_in', username: 'ana' };
    expect(signInReducer(signedIn, { type: 'FAILED', error: 'offline' })).toBe(signedIn);
    expect(signInReducer(signedIn, { type: 'SESSION_STARTED', username: 'ana' })).toBe(signedIn);
  });

  it('keeps the revoked verdict even if a session start arrives later', () => {
    const ended: SignInState = { name: 'access_ended' };
    expect(signInReducer(ended, { type: 'SESSION_STARTED', username: 'ana' })).toBe(ended);
    expect(signInReducer(ended, { type: 'ACCESS_RESULT', status: 'active' })).toBe(ended);
  });

  it('a pending result means waiting for approval; an active one lets them in', () => {
    const signing: SignInState = { name: 'signing_in', username: 'ana' };
    const pending = signInReducer(signing, { type: 'ACCESS_RESULT', status: 'pending' });
    expect(pending).toEqual({ name: 'pending', username: 'ana' });
    expect(signInReducer(pending, { type: 'ACCESS_RESULT', status: 'active' })).toEqual({ name: 'signed_in', username: 'ana' });
  });

  it('unknown access (offline) signs in a stored session but never approves a pending member', () => {
    expect(signInReducer({ name: 'signing_in', username: 'ana' }, { type: 'ACCESS_RESULT', status: 'unknown' })).toEqual({ name: 'signed_in', username: 'ana' });
    const pending: SignInState = { name: 'pending', username: 'ana' };
    expect(signInReducer(pending, { type: 'ACCESS_RESULT', status: 'unknown' })).toBe(pending);
  });

  it('a revoked check ends access even when already signed in or pending', () => {
    expect(signInReducer({ name: 'signed_in', username: 'ana' }, { type: 'ACCESS_RESULT', status: 'revoked' })).toEqual({ name: 'access_ended' });
    expect(signInReducer({ name: 'pending', username: 'ana' }, { type: 'ACCESS_RESULT', status: 'revoked' })).toEqual({ name: 'access_ended' });
  });

  it('an access result with nobody signed in changes nothing', () => {
    const e = entry();
    expect(signInReducer(e, { type: 'ACCESS_RESULT', status: 'pending' })).toBe(e);
  });
});

describe('createSignInController', () => {
  it('logs in with a normalized username, then checks access', async () => {
    const api = fakeApi();
    const c = createSignInController(api);
    await c.start();
    await c.logIn('  Ana_1 ', 'secret-pass');
    expect(api.calls).toEqual(['signIn:ana_1,secret-pass']);
    expect(c.getState()).toEqual({ name: 'signed_in', username: 'ana_1' });
  });

  it('a wrong password stays on the form with a message, and can retry', async () => {
    let first = true;
    const c = createSignInController(
      fakeApi({
        signIn: async () => {
          if (first) {
            first = false;
            throw new AuthFlowError('invalid_login');
          }
        },
      }),
    );
    await c.start();
    await c.logIn('ana', 'wrong');
    expect(c.getState()).toEqual(entry({ error: 'invalid_login' }));
    await c.logIn('ana', 'right-pass');
    expect(c.getState().name).toBe('signed_in');
  });

  it('does not call the server for a username that cannot exist', async () => {
    const api = fakeApi();
    const c = createSignInController(api);
    await c.start();
    await c.logIn('a', 'whatever');
    expect(c.getState()).toEqual(entry({ error: 'username_invalid' }));
    expect(api.calls).toEqual([]);
  });

  it('registering creates the account, signs in and lands on waiting for approval', async () => {
    const api = fakeApi({ checkAccess: async () => 'pending' });
    const c = createSignInController(api);
    await c.start();
    c.setMode('register');
    await c.register('Maria', 'longenough1', 'longenough1');
    expect(api.calls).toEqual(['register:maria,longenough1', 'signIn:maria,longenough1']);
    expect(c.getState()).toEqual({ name: 'pending', username: 'maria' });
  });

  it('registering checks the passwords first', async () => {
    const api = fakeApi();
    const c = createSignInController(api);
    await c.start();
    c.setMode('register');
    await c.register('maria', 'longenough1', 'longenough2');
    expect(c.getState()).toEqual(entry({ mode: 'register', error: 'password_mismatch' }));
    await c.register('maria', 'short', 'short');
    expect(c.getState()).toEqual(entry({ mode: 'register', error: 'password_short' }));
    expect(api.calls).toEqual([]);
  });

  it('a taken username stays on the register form and signs nobody in', async () => {
    const api = fakeApi({ register: reject('username_taken') });
    const c = createSignInController(api);
    await c.start();
    c.setMode('register');
    await c.register('maria', 'longenough1', 'longenough1');
    expect(c.getState()).toEqual(entry({ mode: 'register', error: 'username_taken' }));
    expect(api.calls.some((x) => x.startsWith('signIn'))).toBe(false);
  });

  it('an offline log in says so', async () => {
    const c = createSignInController(fakeApi({ signIn: reject('offline') }));
    await c.start();
    await c.logIn('ana', 'secret-pass');
    expect(c.getState()).toEqual(entry({ error: 'offline' }));
  });

  it('a pending member is approved on the next check', async () => {
    let status: AccessStatus = 'pending';
    const c = createSignInController(fakeApi({ restoreSession: async () => ({ username: 'ana' }), checkAccess: async () => status }));
    await c.start();
    expect(c.getState()).toEqual({ name: 'pending', username: 'ana' });
    await c.recheckAccess();
    expect(c.getState().name).toBe('pending');
    status = 'active';
    await c.recheckAccess();
    expect(c.getState()).toEqual({ name: 'signed_in', username: 'ana' });
  });

  it('a rejected member lands on "access ended" and can sign out', async () => {
    const api = fakeApi({ restoreSession: async () => ({ username: 'ana' }), checkAccess: async () => 'revoked' });
    const c = createSignInController(api);
    await c.start();
    expect(c.getState()).toEqual({ name: 'access_ended' });
    await c.signOut();
    expect(api.calls).toContain('signOut:');
    expect(c.getState()).toEqual(entry());
  });

  it('opens signed in when offline at launch (stored session trusted)', async () => {
    const c = createSignInController(fakeApi({ restoreSession: async () => ({ username: 'ana' }), checkAccess: async () => 'unknown' }));
    await c.start();
    expect(c.getState()).toEqual({ name: 'signed_in', username: 'ana' });
  });

  it('losing the session sends a signed-in or pending member back to log in', async () => {
    const c = createSignInController(fakeApi({ restoreSession: async () => ({ username: 'ana' }) }));
    await c.start();
    c.sessionLost();
    expect(c.getState()).toEqual(entry());
  });
});

describe('classifyAuthError', () => {
  it.each([
    [{ code: 'invalid_credentials' }, 'invalid_login'],
    [{ code: 'user_not_found' }, 'invalid_login'],
    [{ code: 'over_request_rate_limit' }, 'rate_limited'],
    [{ status: 429 }, 'rate_limited'],
    [{ name: 'AuthRetryableFetchError', status: 0, message: 'Network request failed' }, 'offline'],
    [{ name: 'FunctionsFetchError', message: 'Failed to send a request to the Edge Function' }, 'offline'],
    [{ code: 'user_banned' }, 'banned'],
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
