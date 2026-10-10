import type { SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useSyncExternalStore } from 'react';

import type { FileStore } from '../downloads/files';

/** Most books the `download-links` function answers for at once. */
export const COVER_BATCH = 50;

export interface CoverLinksApi {
  /** Short-lived picture links by book id. Books the server has no cover for (or may not show) are left out. */
  coverLinks(bookIds: string[]): Promise<Record<string, string>>;
}

/**
 * Request `{ book_ids }`; answer `{ covers: [{ book_id, url } | { book_id, error }] }` (see the function's README).
 * Anything else, or a refusal, throws: the gradient simply stays.
 */
export function parseCoverLinks(body: unknown): Record<string, string> {
  const rows = (body as { covers?: unknown } | null)?.covers;
  if (!Array.isArray(rows)) throw new Error('unexpected answer from download-links');
  const out: Record<string, string> = {};
  for (const r of rows as Record<string, unknown>[]) {
    if (typeof r?.book_id === 'string' && typeof r.url === 'string') out[r.book_id] = r.url;
  }
  return out;
}

export function supabaseCoverLinks(client: SupabaseClient): CoverLinksApi {
  return {
    async coverLinks(bookIds) {
      const { data, error } = await client.functions.invoke('download-links', { body: { book_ids: bookIds } });
      if (error) throw new Error(error.message);
      return parseCoverLinks(data);
    },
  };
}

export interface CoverStore {
  /** A file URI for the book's cover, or undefined while the phone has none (the gradient shows). */
  uri(bookId: string): string | undefined;
  /** Fetches the cover if the phone has none yet. Cheap to call again; asks are batched. */
  want(bookId: string): void;
  subscribe(listener: () => void): () => void;
}

const coverPath = (bookId: string) => `covers/${bookId}.jpg`;

/**
 * Covers live on the phone as `covers/<book>.jpg`, so they show offline and the token-bearing link is never kept.
 * ponytail: a cover is fetched once per install; a replaced cover shows after a reinstall. Version the file name if that ever matters.
 */
export function createCoverStore(opts: {
  files: FileStore;
  api: CoverLinksApi;
  /** Runs the batch after the current render pass; tests pass their own. */
  schedule?: (run: () => void) => void;
}): CoverStore {
  const { files, api, schedule = (run) => void setTimeout(run, 0) } = opts;
  const known = new Map<string, string>();
  const asked = new Set<string>();
  const pending = new Set<string>();
  const listeners = new Set<() => void>();

  const got = (id: string, uri: string) => {
    known.set(id, uri);
    listeners.forEach((l) => l());
  };

  async function fetchOne(id: string, url: string) {
    const tmp = `covers/${id}.part`;
    try {
      await files.download(url, tmp, {});
      files.move(tmp, coverPath(id));
      got(id, files.uri(coverPath(id)));
    } catch {
      files.remove(tmp);
      asked.delete(id); // offline or a bad link: ask again next time the book is shown
    }
  }

  async function flush() {
    const ids = [...pending];
    pending.clear();
    for (let i = 0; i < ids.length; i += COVER_BATCH) {
      const batch = ids.slice(i, i + COVER_BATCH);
      let urls: Record<string, string>;
      try {
        urls = await api.coverLinks(batch);
      } catch {
        batch.forEach((id) => asked.delete(id));
        continue;
      }
      await Promise.all(batch.filter((id) => urls[id]).map((id) => fetchOne(id, urls[id]!)));
    }
  }

  return {
    uri(id) {
      const hit = known.get(id);
      if (hit) return hit;
      if (!files.exists(coverPath(id))) return undefined;
      const uri = files.uri(coverPath(id));
      known.set(id, uri);
      return uri;
    },
    want(id) {
      if (known.has(id) || asked.has(id) || files.exists(coverPath(id))) return;
      asked.add(id);
      if (!pending.size) schedule(() => void flush());
      pending.add(id);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

const nobody: CoverStore = { uri: () => undefined, want: () => {}, subscribe: () => () => {} };

/** The book's cover URI (undefined = draw the gradient); asks for it when the phone does not have it. */
export function useCoverUri(store: CoverStore | undefined, bookId: string): string | undefined {
  const s = store ?? nobody;
  const uri = useSyncExternalStore(s.subscribe, () => s.uri(bookId));
  useEffect(() => {
    if (!uri) s.want(bookId);
  }, [s, bookId, uri]);
  return uri;
}
