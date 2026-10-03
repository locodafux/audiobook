import { memoryStore } from '../phone/memoryStore';
import { BOOKMARKS_KEY, createBookmarksStore, forBook, formatPosition, sanitizeBookmarks } from './bookmarks';

let n = 0;
const make = (kv = memoryStore()) => createBookmarksStore(kv, () => 1_000, () => `id${++n}`);

describe('bookmarks', () => {
  it('adds a bookmark with a trimmed note and the saved sentence', () => {
    const b = make().add({ bookId: 'a', chapterN: 4, positionS: 26, quote: ' Then the ground began to tremble. ', note: '  trailer line ' });
    expect(b).toMatchObject({ bookId: 'a', chapterN: 4, positionS: 26, quote: 'Then the ground began to tremble.', note: 'trailer line', createdAt: 1_000 });
  });

  it('treats a double tap on the same spot as one bookmark, keeping a note given the second time', () => {
    const s = make();
    const first = s.add({ bookId: 'a', chapterN: 1, positionS: 10 });
    const again = s.add({ bookId: 'a', chapterN: 1, positionS: 11, note: 'later' });
    expect(s.getState()).toHaveLength(1);
    expect(again.id).toBe(first.id);
    expect(s.getState()[0]!.note).toBe('later');
    s.add({ bookId: 'a', chapterN: 1, positionS: 30 });
    s.add({ bookId: 'a', chapterN: 2, positionS: 10 });
    expect(s.getState()).toHaveLength(3);
  });

  it('edits and deletes notes', () => {
    const s = make();
    const b = s.add({ bookId: 'a', chapterN: 1, positionS: 1 });
    expect(s.setNote(b.id, ' hello ')?.note).toBe('hello');
    s.setNote(b.id, '');
    expect(s.getState()[0]!.note).toBe('');
    expect(s.setNote('missing', 'x')).toBeUndefined();
    s.remove(b.id);
    expect(s.getState()).toEqual([]);
  });

  it('lists one book in reading order', () => {
    const s = make();
    s.add({ bookId: 'a', chapterN: 3, positionS: 190 });
    s.add({ bookId: 'b', chapterN: 1, positionS: 5 });
    s.add({ bookId: 'a', chapterN: 1, positionS: 62 });
    s.add({ bookId: 'a', chapterN: 3, positionS: 20 });
    expect(forBook(s.getState(), 'a').map((b) => [b.chapterN, b.positionS])).toEqual([[1, 62], [3, 20], [3, 190]]);
  });

  it('saves, reloads, and drops broken saved entries', async () => {
    const kv = memoryStore();
    const s = make(kv);
    s.add({ bookId: 'a', chapterN: 1, positionS: 1, note: 'keep' });
    await new Promise((r) => setTimeout(r, 0));
    const reloaded = make(kv);
    await reloaded.load();
    expect(reloaded.getState()).toHaveLength(1);

    expect(sanitizeBookmarks([{ id: 'x' }, null, 5, ...reloaded.getState()])).toHaveLength(1);
    expect(sanitizeBookmarks('nope')).toEqual([]);
    const bad = make(memoryStore({ [BOOKMARKS_KEY]: '{' }));
    await bad.load();
    expect(bad.getState()).toEqual([]);
  });

  it('formats positions', () => {
    expect(formatPosition(26)).toBe('0:26');
    expect(formatPosition(190)).toBe('3:10');
    expect(formatPosition(3790)).toBe('1:03:10');
    expect(formatPosition(-4)).toBe('0:00');
  });
});
