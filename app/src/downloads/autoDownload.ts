import type { SettingsStore } from '../settings/settings';
import type { DownloadQueue, NewJob } from './queue';
import type { DownloadStore } from './store';

type Known = { n: number; title: string; bytes: number; duration_s: number; sentence_count: number };

/**
 * Keep-next-N: the chapters after `currentN` (up to `keepNext` of them) that are neither on the phone
 * nor queued, in order. `chapters` is the book's chapter list; gaps in numbering are skipped.
 */
export function chaptersToKeep(args: {
  bookId: string;
  bookTitle: string;
  chapters: readonly Known[];
  currentN: number;
  keepNext: number;
  have: (n: number) => boolean;
  queued: (n: number) => boolean;
}): NewJob[] {
  const { bookId, bookTitle, chapters, currentN, keepNext, have, queued } = args;
  if (keepNext <= 0) return [];
  return [...chapters]
    .filter((c) => c.n > currentN)
    .sort((a, b) => a.n - b.n)
    .slice(0, keepNext)
    .filter((c) => !have(c.n) && !queued(c.n))
    .map((c) => ({ bookId, bookTitle, n: c.n, title: c.title, bytes: c.bytes, durationS: c.duration_s, sentenceCount: c.sentence_count }));
}

/** Queues the next chapters for `book` after `currentN`, as set in Settings (does nothing when Keep next is 0). */
export function keepNextChapters(
  d: { queue: Pick<DownloadQueue, 'enqueue' | 'isQueued'>; downloaded: Pick<DownloadStore, 'has'>; settings: Pick<SettingsStore, 'getState'> },
  book: { id: string; title: string },
  chapters: readonly Known[],
  currentN: number,
): number {
  return d.queue.enqueue(
    chaptersToKeep({
      bookId: book.id,
      bookTitle: book.title,
      chapters,
      currentN,
      keepNext: d.settings.getState().keepNextN,
      have: (n) => d.downloaded.has(book.id, n),
      queued: (n) => d.queue.isQueued(book.id, n),
    }),
  );
}

/** A queue job for one chapter row of a book. */
export const toJob = (book: { id: string; title: string }, c: Known): NewJob => ({
  bookId: book.id,
  bookTitle: book.title,
  n: c.n,
  title: c.title,
  bytes: c.bytes,
  durationS: c.duration_s,
  sentenceCount: c.sentence_count,
});
