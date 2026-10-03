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
