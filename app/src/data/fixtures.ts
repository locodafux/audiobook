import type { LibraryApi } from './library';
import type { BookRow, ChapterRow } from './types';

// Made-up books shaped like plan section 3 (safe columns only), for tests.

export const makeBook = (over: Partial<BookRow> & Pick<BookRow, 'id' | 'title'>): BookRow => ({
  author: 'Ada Example',
  series_title: null,
  volume: null,
  description: null,
  language: 'en',
  cover_key: null,
  chapter_count: 12,
  total_duration_s: 36_000,
  total_bytes: 120_000_000,
  status: 'published',
  ...over,
});

export const makeChapter = (book_id: string, n: number): ChapterRow => ({
  book_id,
  n,
  title: `Chapter ${n}`,
  status: 'ready',
  duration_s: 600 + n,
  bytes: 3_000_000,
  sentence_count: 80,
  audio_sha256: 'f'.repeat(64),
});

export const fixtureBooks: BookRow[] = [
  makeBook({ id: 'lantern-road-1', title: 'The Lantern Road', author: 'Mira Vale', series_title: 'Lantern Road', volume: 1 }),
  makeBook({ id: 'lantern-road-2', title: 'The Salt Gate', author: 'Mira Vale', series_title: 'Lantern Road', volume: 2 }),
  makeBook({ id: 'quiet-orchard', title: 'The Quiet Orchard', author: 'Jon Birch', cover_key: 'books/quiet-orchard/cover.jpg' }),
  makeBook({ id: 'small-habits', title: 'Small Habits', author: null, chapter_count: 35 }),
];

export function fixtureLibrary(
  books: BookRow[] = fixtureBooks,
  chaptersPerBook: Record<string, number> = {},
): LibraryApi {
  return {
    listBooks: async () => books,
    listChapters: async (bookId) =>
      Array.from({ length: chaptersPerBook[bookId] ?? 5 }, (_, i) => makeChapter(bookId, i + 1)),
  };
}
