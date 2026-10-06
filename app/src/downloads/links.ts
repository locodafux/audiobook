import type { SupabaseClient } from '@supabase/supabase-js';

/** Where to fetch one chapter from the audio proxy, with the sign-in header it needs. */
export type ChapterLink = {
  n: number;
  audioUrl: string;
  timingUrl: string;
  bytes: number;
  sha256: string;
  /** Sent with both downloads. Holds the member's sign-in token, so never log it. */
  headers: Record<string, string>;
  /** Epoch ms. After this the queue asks again. */
  expiresAt: number;
};

/** Most chapters the app asks for at once. 10 keeps the sign-in token fresh. */
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

/** A refused download arrives from the file layer as an error naming the HTTP status; turn it into the reason the queue understands. */
export function downloadFailure(e: unknown): Error {
  const message = e instanceof Error ? e.message : String(e);
  if (/\b(401|403)\b/.test(message)) return new LinksError('access_ended', message);
  if (/\b404\b/.test(message)) return new LinksError('not_available', message);
  return e instanceof Error ? e : new Error(message);
}

/** The proxy asks the phone's token again at least this often, so a refreshed sign-in is picked up. */
export const LINK_TTL_MS = 5 * 60_000;

/**
 * Chapters come from the audio proxy (`audio-proxy/`): the phone sends its own sign-in token, the proxy
 * checks the member is still active and streams the file out of Telegram. The size and hash to verify
 * against come from the `chapters` rows the database already shows this member (revoked members, chapters
 * that are not ready and other people's private books come back empty, so those chapters simply have no link).
 */
export function proxyLinks(client: SupabaseClient, proxyUrl: string, now: () => number = Date.now): LinksApi {
  const base = proxyUrl.replace(/\/+$/, '');
  return {
    async chapterLinks(bookId, chapters) {
      const { data: session } = await client.auth.getSession();
      const token = session.session?.access_token;
      if (!token) throw new LinksError('unavailable', 'not signed in');
      const { data, error } = await client.from('chapters').select('n,bytes,audio_sha256').eq('book_id', bookId).in('n', chapters);
      if (error) throw new LinksError('unavailable', error.message);
      const book = encodeURIComponent(bookId);
      return (data ?? []).flatMap((r: { n: number; bytes: number | null; audio_sha256: string | null }) =>
        r.bytes && r.audio_sha256
          ? [{ n: r.n, audioUrl: `${base}/audio/${book}/${r.n}`, timingUrl: `${base}/timing/${book}/${r.n}`, bytes: r.bytes, sha256: r.audio_sha256.toLowerCase(), headers: { authorization: `Bearer ${token}` }, expiresAt: now() + LINK_TTL_MS }]
          : [],
      );
    },
  };
}
