import type { LibraryApi } from './library';
import type { BookRow } from './types';

/** The slice of AsyncStorage the offline copy needs (so tests can fake it). */
export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export const BOOK_LIST_KEY = 'hearthread.bookList.v1';

export type BookList = {
  books: BookRow[];
  /** `network`: just fetched. `cache`: the saved copy, because the fetch failed. */
  source: 'network' | 'cache';
  /** Epoch ms when the books were fetched from the server. */
  fetchedAt: number;
};

/** Fetches the book list and keeps a copy; falls back to the copy when offline. */
export async function loadBookList(
  api: LibraryApi,
  store: KeyValueStore,
  now: () => number = Date.now,
): Promise<BookList> {
  try {
    const books = await api.listBooks();
    const fetchedAt = now();
    await store.setItem(BOOK_LIST_KEY, JSON.stringify({ books, fetchedAt })).catch(() => {});
    return { books, source: 'network', fetchedAt };
  } catch (error) {
    const cached = await readSavedBookList(store);
    if (cached) return { ...cached, source: 'cache' };
    throw error;
  }
}

export async function readSavedBookList(
  store: KeyValueStore,
): Promise<Omit<BookList, 'source'> | null> {
  try {
    const raw = await store.getItem(BOOK_LIST_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      Array.isArray((parsed as { books?: unknown }).books) &&
      typeof (parsed as { fetchedAt?: unknown }).fetchedAt === 'number'
    ) {
      const { books, fetchedAt } = parsed as { books: BookRow[]; fetchedAt: number };
      return { books, fetchedAt };
    }
  } catch {
    // unreadable copy: treat as no copy
  }
  return null;
}
