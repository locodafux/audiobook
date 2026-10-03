import { fixtureBooks, fixtureLibrary, makeBook } from './fixtures';
import { supabaseLibrary } from './library';
import { BOOK_LIST_KEY, loadBookList, type KeyValueStore } from './offlineList';
import { fetchAllPages } from './paging';
import { entryBook, filterBooks, groupBooks } from './series';
import { BOOK_COLUMNS, CHAPTER_COLUMNS } from './types';

const memoryStore = (initial: Record<string, string> = {}): KeyValueStore & { data: Record<string, string> } => {
  const data = { ...initial };
  return {
    data,
    getItem: async (k) => data[k] ?? null,
    setItem: async (k, v) => void (data[k] = v),
  };
};

describe('fetchAllPages', () => {
  const rows = Array.from({ length: 1322 }, (_, i) => i);
  const source = (calls: [number, number][]) => async (from: number, to: number) => {
    calls.push([from, to]);
    return rows.slice(from, to + 1);
  };

  it('reads a 1,322-chapter book in three blocks of 500', async () => {
    const calls: [number, number][] = [];
    expect(await fetchAllPages(source(calls), 500)).toEqual(rows);
    expect(calls).toEqual([[0, 499], [500, 999], [1000, 1499]]);
  });

  it('asks once more after an exactly full last block, then stops', async () => {
    const calls: [number, number][] = [];
    const exact = rows.slice(0, 1000);
    const all = await fetchAllPages(async (f, t) => {
      calls.push([f, t]);
      return exact.slice(f, t + 1);
    }, 500);
    expect(all).toHaveLength(1000);
    expect(calls).toHaveLength(3);
  });

  it('returns nothing for an empty table', async () => {
    expect(await fetchAllPages(async () => [], 500)).toEqual([]);
  });
});

describe('safe columns', () => {
  const hidden = ['audio_key', 'timing_key', 'source_key', 'source_sha256', 'parser_version', 'text_sha256', 'input_hash', 'source_ref', 'backup_status', 'voice', 'rate'];
  it('never asks for hidden columns', () => {
    for (const col of hidden) {
      expect(BOOK_COLUMNS.split(',')).not.toContain(col);
      expect(CHAPTER_COLUMNS.split(',')).not.toContain(col);
      expect(CHAPTER_COLUMNS).not.toMatch(/telegram/);
    }
  });
});

describe('supabaseLibrary', () => {
  // Records the chain a query builder is called with; resolves to `rows` sliced by range().
  const fakeClient = (rows: unknown[]) => {
    const log: { table: string; select?: string; eq?: [string, string]; order: string[]; ranges: [number, number][] } = {
      table: '',
      order: [],
      ranges: [],
    };
    let range: [number, number] = [0, 0];
    const builder: Record<string, unknown> = {
      select: (c: string) => ((log.select = c), builder),
      eq: (c: string, v: string) => ((log.eq = [c, v]), builder),
      order: (c: string) => (log.order.push(c), builder),
      range: (f: number, t: number) => ((range = [f, t]), log.ranges.push([f, t]), builder),
      returns: () => builder,
      then: (resolve: (v: unknown) => void) => resolve({ data: rows.slice(range[0], range[1] + 1), error: null }),
    };
    const client = { from: (t: string) => ((log.table = t), builder) };
    return { client: client as never, log };
  };

  it('lists chapters of one book in pages of 500, in order', async () => {
    const rows = Array.from({ length: 501 }, (_, i) => ({ n: i + 1 }));
    const { client, log } = fakeClient(rows);
    const chapters = await supabaseLibrary(client).listChapters('lantern-road-1');
    expect(chapters).toHaveLength(501);
    expect(log).toMatchObject({ table: 'chapters', select: CHAPTER_COLUMNS, eq: ['book_id', 'lantern-road-1'] });
    expect(new Set(log.order)).toEqual(new Set(['n']));
    expect(log.ranges).toEqual([[0, 499], [500, 999]]);
  });

  it('lists books with the safe columns', async () => {
    const { client, log } = fakeClient(fixtureBooks);
    expect(await supabaseLibrary(client).listBooks()).toEqual(fixtureBooks);
    expect(log).toMatchObject({ table: 'books', select: BOOK_COLUMNS });
  });

  it('throws the server error', async () => {
    const client = {
      from: () => {
        const b: Record<string, unknown> = {};
        for (const m of ['select', 'order', 'range', 'returns']) b[m] = () => b;
        b.then = (r: (v: unknown) => void) => r({ data: null, error: new Error('boom') });
        return b;
      },
    };
    await expect(supabaseLibrary(client as never).listBooks()).rejects.toThrow('boom');
  });
});

describe('loadBookList (offline copy)', () => {
  it('saves what it fetched', async () => {
    const store = memoryStore();
    const list = await loadBookList(fixtureLibrary(), store, () => 1000);
    expect(list).toEqual({ books: fixtureBooks, source: 'network', fetchedAt: 1000 });
    expect(JSON.parse(store.data[BOOK_LIST_KEY]!)).toEqual({ books: fixtureBooks, fetchedAt: 1000 });
  });

  it('falls back to the saved copy when the fetch fails', async () => {
    const store = memoryStore();
    await loadBookList(fixtureLibrary(), store, () => 1000);
    const offline = { listBooks: async () => Promise.reject(new Error('offline')), listChapters: async () => [] };
    expect(await loadBookList(offline, store)).toEqual({ books: fixtureBooks, source: 'cache', fetchedAt: 1000 });
  });

  it('throws when offline with no saved copy', async () => {
    const offline = { listBooks: async () => Promise.reject(new Error('offline')), listChapters: async () => [] };
    await expect(loadBookList(offline, memoryStore())).rejects.toThrow('offline');
  });

  it('ignores a corrupt saved copy', async () => {
    const offline = { listBooks: async () => Promise.reject(new Error('offline')), listChapters: async () => [] };
    await expect(loadBookList(offline, memoryStore({ [BOOK_LIST_KEY]: '{nope' }))).rejects.toThrow('offline');
  });

  it('still returns books when saving fails', async () => {
    const store: KeyValueStore = { getItem: async () => null, setItem: async () => Promise.reject(new Error('disk full')) };
    expect((await loadBookList(fixtureLibrary(), store)).books).toEqual(fixtureBooks);
  });
});

describe('series grouping', () => {
  it('groups volumes into one entry, in volume order', () => {
    const entries = groupBooks([...fixtureBooks].reverse());
    const series = entries.find((e) => e.kind === 'series');
    expect(series).toMatchObject({ title: 'Lantern Road', author: 'Mira Vale' });
    expect(series?.kind === 'series' && series.volumes.map((v) => v.volume)).toEqual([1, 2]);
    expect(entries).toHaveLength(3);
  });

  it('keeps a lone volume as a plain book', () => {
    const entries = groupBooks([makeBook({ id: 'a', title: 'A', series_title: 'S', volume: 1 })]);
    expect(entries).toEqual([expect.objectContaining({ kind: 'book' })]);
  });

  it('opens the first volume of a series', () => {
    const [first] = groupBooks(fixtureBooks);
    expect(first && entryBook(first).id).toBe('lantern-road-1');
  });

  it('filters on title, author and series, ignoring case', () => {
    expect(filterBooks(fixtureBooks, 'LANTERN').map((b) => b.id)).toEqual(['lantern-road-1', 'lantern-road-2']);
    expect(filterBooks(fixtureBooks, 'birch').map((b) => b.id)).toEqual(['quiet-orchard']);
    expect(filterBooks(fixtureBooks, '  ')).toEqual(fixtureBooks);
    expect(filterBooks(fixtureBooks, 'dune')).toEqual([]);
  });
});
