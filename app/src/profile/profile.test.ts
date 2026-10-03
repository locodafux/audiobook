import { memoryStore } from '../phone/memoryStore';
import { PROFILE_KEY, loadProfile, readSavedProfile, supabaseProfile, type ProfileApi } from './profile';

const api = (result: () => Promise<{ displayName: string; invitedBy: string | null } | null>): ProfileApi => ({ get: result });

describe('profile', () => {
  it('loads from the server and keeps a copy', async () => {
    const kv = memoryStore();
    expect(await loadProfile(api(async () => ({ displayName: 'Maria', invitedBy: 'Leo' })), kv)).toEqual({ displayName: 'Maria', invitedBy: 'Leo' });
    expect(await readSavedProfile(kv)).toEqual({ displayName: 'Maria', invitedBy: 'Leo' });
  });

  it('falls back to the copy when the server cannot be reached', async () => {
    const kv = memoryStore({ [PROFILE_KEY]: JSON.stringify({ displayName: 'Maria', invitedBy: null }) });
    expect(await loadProfile(api(() => Promise.reject(new Error('offline'))), kv)).toEqual({ displayName: 'Maria', invitedBy: null });
  });

  it('is null with no row and no copy, and ignores a broken copy', async () => {
    expect(await loadProfile(api(async () => null), memoryStore())).toBeNull();
    expect(await loadProfile(api(() => Promise.reject(new Error('x'))), memoryStore({ [PROFILE_KEY]: '{' }))).toBeNull();
  });

  it('reads display_name and invited_by from the members row', async () => {
    const row = { display_name: 'Ana', invited_by: null };
    const client = { from: () => ({ select: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }) };
    expect(await supabaseProfile(client as never).get()).toEqual({ displayName: 'Ana', invitedBy: null });
    const failing = { from: () => ({ select: () => ({ maybeSingle: async () => ({ data: null, error: new Error('denied') }) }) }) };
    await expect(supabaseProfile(failing as never).get()).rejects.toThrow('denied');
  });
});
