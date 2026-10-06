import type { SupabaseClient } from '@supabase/supabase-js';

/** One chapter's short-lived Telegram link, from the `download-links` function (tech plan section 5). */
export type ChapterLink = {
  n: number;
  audioUrl: string;
  timingUrl: string;
  bytes: number;
  sha256: string;
  /** Epoch ms. Links last 15 minutes. */
  expiresAt: number;
};

/** Most chapters the app asks for at once. The function allows 25; 10 keeps the 15-minute window ample. */
export const LINK_BATCH = 10;

export type LinksFailure =
  /** The invite was revoked: stop downloading. */
  | 'access_ended'
  /** The chapter is not published or not ready: this chapter cannot be downloaded. */
  | 'not_available'
  /** Anything else (no connection, server error, an answer we do not understand). Retry later. */
  | 'unavailable';

export class LinksError extends Error {
  constructor(readonly code: LinksFailure, detail?: string) {
    super(detail ?? code);
  }
}

export interface LinksApi {
  /** Links for up to `LINK_BATCH` chapters of one book. Chapters the server leaves out are simply missing from the result. */
  chapterLinks(bookId: string, chapters: number[]): Promise<ChapterLink[]>;
}

/**
 * ASSUMED contract (owned by the download-links function; adjust here only):
 * request `{ book_id, chapters: number[] }`; response
 * `{ chapters: [{ n, audio_url, timing_url, bytes, sha256, expires_in }] }` with `expires_in` in seconds;
 * refusals are non-2xx with `{ error: 'access_ended' | 'not_available' }`.
 */
export function parseLinks(body: unknown, now: number): ChapterLink[] {
  const rows = (body as { chapters?: unknown } | null)?.chapters;
  if (!Array.isArray(rows)) throw new LinksError('unavailable', 'unexpected answer from download-links');
  // A chapter that is not ready comes back as `{ n, error }`: leave it out so only that chapter fails (the queue treats a missing one as not available).
  return rows.filter((r: Record<string, unknown>) => typeof r?.error !== 'string').map((r: Record<string, unknown>) => {
    const expiresIn = typeof r.expires_in === 'number' ? r.expires_in : 900;
    if (typeof r.n !== 'number' || typeof r.audio_url !== 'string' || typeof r.timing_url !== 'string' || typeof r.bytes !== 'number' || typeof r.sha256 !== 'string') {
      throw new LinksError('unavailable', 'unexpected chapter in download-links answer');
    }
    return { n: r.n, audioUrl: r.audio_url, timingUrl: r.timing_url, bytes: r.bytes, sha256: r.sha256.toLowerCase(), expiresAt: now + expiresIn * 1000 };
  });
}

export function supabaseLinks(client: SupabaseClient, now: () => number = Date.now): LinksApi {
  return {
    async chapterLinks(bookId, chapters) {
      const { data, error } = await client.functions.invoke('download-links', { body: { book_id: bookId, chapters } });
      if (error) {
        // A refusal arrives as an HTTP error whose body names the reason; anything else is a connection problem.
        const body = await (error as { context?: { json?: () => Promise<{ error?: string }> } }).context?.json?.().catch(() => null);
        if (body?.error === 'access_ended' || body?.error === 'not_available') throw new LinksError(body.error);
        throw new LinksError('unavailable', error.message);
      }
      return parseLinks(data, now());
    },
  };
}
