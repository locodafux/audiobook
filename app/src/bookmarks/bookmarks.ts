import type { KeyValueStore } from '../data/offlineList';
import { createPersisted } from '../phone/persisted';

export const BOOKMARKS_KEY = 'hearthread.bookmarks.v1';

export const NOTE_MAX = 500;
const QUOTE_MAX = 300;
/** Saving twice within this many seconds of the same spot is one bookmark (a double tap). */
const SAME_SPOT_S = 2;

export type Bookmark = {
  id: string;
  bookId: string;
  chapterN: number;
  /** Seconds into the chapter audio. */
  positionS: number;
  /** The sentence that was playing when it was saved. */
  quote: string;
  /** Optional note; empty when there is none. */
  note: string;
  createdAt: number;
};

export type NewBookmark = Pick<Bookmark, 'bookId' | 'chapterN' | 'positionS'> & { quote?: string; note?: string };

const isBookmark = (b: unknown): b is Bookmark => {
  const r = b as Record<string, unknown> | null;
  return (
    typeof r === 'object' &&
    r !== null &&
    typeof r.id === 'string' &&
    typeof r.bookId === 'string' &&
    Number.isInteger(r.chapterN) &&
    typeof r.positionS === 'number' &&
    Number.isFinite(r.positionS) &&
    typeof r.quote === 'string' &&
    typeof r.note === 'string' &&
    typeof r.createdAt === 'number'
  );
};

/** Keeps the valid bookmarks of a saved copy and drops the rest. */
export const sanitizeBookmarks = (raw: unknown): Bookmark[] => (Array.isArray(raw) ? raw.filter(isBookmark) : []);

/** One book's bookmarks in reading order. */
export const forBook = (all: readonly Bookmark[], bookId: string): Bookmark[] =>
  all.filter((b) => b.bookId === bookId).sort((a, b) => a.chapterN - b.chapterN || a.positionS - b.positionS);

/** "0:26" or "1:03:10", for the bookmark row's position. */
export function formatPosition(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
}

export function createBookmarksStore(
  kv: KeyValueStore,
  now: () => number = Date.now,
  newId: () => string = () => `${now()}-${Math.random().toString(36).slice(2, 8)}`,
) {
  const store = createPersisted<Bookmark[]>(kv, BOOKMARKS_KEY, [], sanitizeBookmarks);
  return {
    ...store,
    /** Saves a bookmark and returns it; a second tap on the same spot returns the first (adding its note if given). */
    add(input: NewBookmark): Bookmark {
      const note = (input.note ?? '').trim().slice(0, NOTE_MAX);
      const twin = store
        .getState()
        .find((b) => b.bookId === input.bookId && b.chapterN === input.chapterN && Math.abs(b.positionS - input.positionS) < SAME_SPOT_S);
      if (twin) return note ? this.setNote(twin.id, note) ?? twin : twin;
      const created: Bookmark = {
        id: newId(),
        bookId: input.bookId,
        chapterN: input.chapterN,
        positionS: Math.max(0, input.positionS),
        quote: (input.quote ?? '').trim().slice(0, QUOTE_MAX),
        note,
        createdAt: now(),
      };
      store.set((all) => [...all, created]);
      return created;
    },
    /** Returns the updated bookmark, or undefined when it no longer exists. */
    setNote(id: string, note: string): Bookmark | undefined {
      const clean = note.trim().slice(0, NOTE_MAX);
      store.set((all) => all.map((b) => (b.id === id ? { ...b, note: clean } : b)));
      return store.getState().find((b) => b.id === id);
    },
    remove: (id: string) => store.set((all) => all.filter((b) => b.id !== id)),
    clear: () => store.set(() => []),
  };
}
export type BookmarksStore = ReturnType<typeof createBookmarksStore>;
