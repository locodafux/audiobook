import { fakeFiles, type Remote } from '../downloads/fakes';
import { COVER_BATCH, createCoverStore, parseCoverLinks, type CoverLinksApi } from './covers';

const jpeg: Remote = { bytes: 30_000, sha: '' };

function setup(links: Record<string, string>, remote: Record<string, Remote> = {}) {
  const files = fakeFiles(remote);
  const asked: string[][] = [];
  const api: CoverLinksApi & { error: Error | null } = {
    error: null,
    async coverLinks(ids) {
      asked.push(ids);
      if (api.error) throw api.error;
      return Object.fromEntries(ids.filter((id) => links[id]).map((id) => [id, links[id]!]));
    },
  };
  const queued: (() => void)[] = [];
  const store = createCoverStore({ files, api, schedule: (run) => void queued.push(run) });
  const flush = async () => {
    const runs = queued.splice(0);
    runs.forEach((r) => r());
    await new Promise((r) => setTimeout(r, 0));
  };
  return { files, api, asked, store, flush, queued };
}

describe('cover store', () => {
  it('fetches wanted covers in one request, keeps them on the phone and tells listeners', async () => {
    const t = setup({ a: 'https://t/a.jpg', b: 'https://t/b.jpg' }, { 'https://t/a.jpg': jpeg, 'https://t/b.jpg': jpeg });
    const heard = jest.fn();
    t.store.subscribe(heard);
    expect(t.store.uri('a')).toBeUndefined();
    t.store.want('a');
    t.store.want('b');
    t.store.want('a');
    await t.flush();
    expect(t.asked).toEqual([['a', 'b']]);
    expect(t.store.uri('a')).toBe('file:///fake/covers/a.jpg');
    expect(t.files.exists('covers/a.part')).toBe(false);
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it('shows a cover already on the phone without asking the server', async () => {
    const t = setup({});
    t.files.disk.set('covers/a.jpg', jpeg);
    expect(t.store.uri('a')).toBe('file:///fake/covers/a.jpg');
    t.store.want('a');
    expect(t.queued).toHaveLength(0);
  });

  it('leaves books without a cover on the gradient, and does not ask again this session', async () => {
    const t = setup({});
    t.store.want('plain');
    await t.flush();
    t.store.want('plain');
    await t.flush();
    expect(t.asked).toEqual([['plain']]);
    expect(t.store.uri('plain')).toBeUndefined();
  });

  it('asks again later when offline or the download fails, and keeps no half file', async () => {
    const t = setup({ a: 'https://t/a.jpg' }, {});
    t.api.error = new Error('offline');
    t.store.want('a');
    await t.flush();
    t.api.error = null;
    t.store.want('a');
    await t.flush(); // link arrives, download 404s
    expect(t.files.exists('covers/a.part')).toBe(false);
    expect(t.store.uri('a')).toBeUndefined();
    t.files.remote['https://t/a.jpg'] = jpeg;
    t.store.want('a');
    await t.flush();
    expect(t.store.uri('a')).toBe('file:///fake/covers/a.jpg');
    expect(t.asked).toHaveLength(3);
  });

  it('splits a large library into batches the function accepts', async () => {
    const t = setup({});
    for (let i = 0; i < COVER_BATCH + 5; i++) t.store.want(`b${i}`);
    await t.flush();
    expect(t.asked.map((a) => a.length)).toEqual([COVER_BATCH, 5]);
  });
});

describe('download-links cover answer', () => {
  it('keeps the books that have a url and drops the rest', () => {
    expect(parseCoverLinks({ expires_in: 1800, covers: [{ book_id: 'a', url: 'u' }, { book_id: 'b', error: 'not_available' }] })).toEqual({ a: 'u' });
  });
  it('rejects an answer that is not a cover list', () => {
    expect(() => parseCoverLinks({ chapters: [] })).toThrow();
  });
});
