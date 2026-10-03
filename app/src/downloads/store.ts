import type { KeyValueStore } from '../data/offlineList';
import type { ChapterRow } from '../data/types';
import { createStore, type Store } from '../store';
import type { FileStore } from './files';
import { audioPath, chapterKey, timingPath, type DownloadedChapter } from './types';

export const DOWNLOADED_KEY = 'hearthread.downloaded.v1';

export type BookUsage = { bookId: string; chapters: number; bytes: number };

/** The list of chapters on the phone, and the only place that deletes them. */
export interface DownloadStore {
  state: Store<Record<string, DownloadedChapter>>;
  load(): Promise<void>;
  has(bookId: string, n: number): boolean;
  get(bookId: string, n: number): DownloadedChapter | undefined;
  forBook(bookId: string): DownloadedChapter[];
  add(chapter: DownloadedChapter): void;
  removeChapter(bookId: string, n: number): void;
  removeBook(bookId: string): void;
  usage(): BookUsage[];
  totalBytes(): number;
  /** Drops entries whose file is gone or the wrong size (storage cleared), so the app says "not on the phone". Returns how many. */
  reconcile(): number;
}

export function createDownloadStore(kv: KeyValueStore, files: FileStore): DownloadStore {
  const state = createStore<Record<string, DownloadedChapter>>({});
  const commit = (next: Record<string, DownloadedChapter>) => {
    state.set(next);
    void kv.setItem(DOWNLOADED_KEY, JSON.stringify(next)).catch(() => {});
  };
  const all = () => Object.values(state.get());
  const deleteFiles = (bookId: string, n: number) => {
    files.remove(audioPath(bookId, n));
    files.remove(timingPath(bookId, n));
  };

  return {
    state,
    async load() {
      try {
        const raw = await kv.getItem(DOWNLOADED_KEY);
        const parsed: unknown = raw ? JSON.parse(raw) : null;
        if (typeof parsed === 'object' && parsed !== null) state.set(parsed as Record<string, DownloadedChapter>);
      } catch {
        // unreadable copy: files stay on disk but are not listed
      }
    },
    has: (bookId, n) => chapterKey(bookId, n) in state.get(),
    get: (bookId, n) => state.get()[chapterKey(bookId, n)],
    forBook: (bookId) => all().filter((c) => c.bookId === bookId).sort((a, b) => a.n - b.n),
    add: (c) => commit({ ...state.get(), [chapterKey(c.bookId, c.n)]: c }),
    removeChapter(bookId, n) {
      const { [chapterKey(bookId, n)]: gone, ...rest } = state.get();
      if (!gone) return;
      deleteFiles(bookId, n);
      commit(rest);
    },
    removeBook(bookId) {
      const rest = Object.fromEntries(Object.entries(state.get()).filter(([, c]) => c.bookId !== bookId));
      files.removeDir(`books/${bookId}`);
      commit(rest);
    },
    usage() {
      const by = new Map<string, BookUsage>();
      for (const c of all()) {
        const u = by.get(c.bookId) ?? { bookId: c.bookId, chapters: 0, bytes: 0 };
        u.chapters += 1;
        u.bytes += c.bytes;
        by.set(c.bookId, u);
      }
      return [...by.values()].sort((a, b) => b.bytes - a.bytes);
    },
    totalBytes: () => all().reduce((sum, c) => sum + c.bytes, 0),
    reconcile() {
      const kept = Object.fromEntries(Object.entries(state.get()).filter(([, c]) => files.size(audioPath(c.bookId, c.n)) === c.bytes));
      const dropped = Object.keys(state.get()).length - Object.keys(kept).length;
      if (dropped) commit(kept);
      return dropped;
    },
  };
}

/** The downloaded chapters of a book shaped like catalog rows, so a book can be opened and played with no connection. */
export const downloadedAsRows = (store: DownloadStore, bookId: string): ChapterRow[] =>
  store.forBook(bookId).map((c) => ({ book_id: c.bookId, n: c.n, title: c.title, status: 'ready', duration_s: c.durationS, bytes: c.bytes, sentence_count: c.sentenceCount, audio_sha256: c.audioSha256 }));
