import type { LibraryApi } from './library';
import type { KeyValueStore } from './offlineList';

const key = (bookId: string) => `hearthread.description.v1.${bookId}`;

/** The description saved the last time this book was opened, or null. */
export async function readSavedDescription(store: KeyValueStore, bookId: string): Promise<string | null> {
  try {
    return (await store.getItem(key(bookId))) || null;
  } catch {
    return null;
  }
}

/** Fetches the description and keeps a copy for offline; rejects when the server cannot be reached. */
export async function fetchDescription(api: LibraryApi, store: KeyValueStore, bookId: string): Promise<string | null> {
  const text = await api.getDescription(bookId);
  if (text) await store.setItem(key(bookId), text).catch(() => {});
  return text;
}
