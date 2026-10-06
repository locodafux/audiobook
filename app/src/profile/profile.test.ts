import { memoryStore } from '../phone/memoryStore';
import { PROFILE_KEY, loadProfile, readSavedProfile, supabaseProfile, type Profile, type ProfileApi } from './profile';

const api = (result: () => Promise<Profile | null>): ProfileApi => ({ get: result });

describe('profile', () => {
  it('loads from the server and keeps a copy', async () => {
    const kv = memoryStore();
    const maria = { displayName: 'Maria', invitedBy: 'Leo', isAdmin: false };
    expect(await loadProfile(api(async () => maria), kv)).toEqual(maria);
    expect(await readSavedProfile(kv)).toEqual(maria);
  });

  it('falls back to the copy when the server cannot be reached', async () => {
    const kv = memoryStore({ [PROFILE_KEY]: JSON.stringify({ displayName: 'Maria', invitedBy: null, isAdmin: true }) });
    expect(await loadProfile(api(() => Promise.reject(new Error('offline'))), kv)).toEqual({ displayName: 'Maria', invitedBy: null, isAdmin: true });
  });

  it('is null with no row and no copy, and ignores a broken copy', async () => {
    expect(await loadProfile(api(async () => null), memoryStore())).toBeNull();
    expect(await loadProfile(api(() => Promise.reject(new Error('x'))), memoryStore({ [PROFILE_KEY]: '{' }))).toBeNull();
  });

  it('reads display_name, invited_by and is_admin from the members row', async () => {
    const row = { display_name: 'Ana', invited_by: null, is_admin: true };
    const client = { from: () => ({ select: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }) };
    expect(await supabaseProfile(client as never).get()).toEqual({ displayName: 'Ana', invitedBy: null, isAdmin: true });
    const failing = { from: () => ({ select: () => ({ maybeSingle: async () => ({ data: null, error: new Error('denied') }) }) }) };
    await expect(supabaseProfile(failing as never).get()).rejects.toThrow('denied');
  });
});
