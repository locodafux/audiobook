import type { PositionStore } from '../player/position';
import type { DownloadStore } from './store';
import type { DownloadedChapter } from './types';

/** Chapters on the phone that the listener has finished, for one book or all. `keep` is never included (the one playing now). */
export function finishedOnPhone(
  downloaded: DownloadStore,
  positions: PositionStore,
  bookId?: string,
  keep?: { bookId: string; n: number } | null,
): DownloadedChapter[] {
  return Object.values(downloaded.state.get()).filter(
    (c) => (!bookId || c.bookId === bookId) && positions.isFinished(c.bookId, c.n) && !(keep && keep.bookId === c.bookId && keep.n === c.n),
  );
}

/** Deletes finished chapters (their place and finished tags are kept). Returns the bytes freed. */
export function cleanUpFinished(downloaded: DownloadStore, positions: PositionStore, bookId?: string, keep?: { bookId: string; n: number } | null): number {
  let freed = 0;
  for (const c of finishedOnPhone(downloaded, positions, bookId, keep)) {
    downloaded.removeChapter(c.bookId, c.n);
    freed += c.bytes;
  }
  return freed;
}

/**
 * "Auto-clean after N days": deletes finished chapters of books not listened to for `days` days. 0 = off.
 * ponytail: the age is the book's last-listened time, since a finished tag has no date of its own.
 */
export function cleanUpOld(downloaded: DownloadStore, positions: PositionStore, days: number, now: number, keep?: { bookId: string; n: number } | null): number {
  if (days <= 0) return 0;
  const cutoff = now - days * 86_400_000;
  let freed = 0;
  for (const [bookId, p] of Object.entries(positions.state.get())) {
    if (p.updatedAt < cutoff) freed += cleanUpFinished(downloaded, positions, bookId, keep);
  }
  return freed;
}
