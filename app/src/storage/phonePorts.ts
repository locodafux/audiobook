import { cleanUpFinished, finishedOnPhone } from '../downloads/cleanup';
import type { FileStore } from '../downloads/files';
import type { Job, DownloadQueue, QueueState } from '../downloads/queue';
import type { DownloadStore } from '../downloads/store';
import type { PlayerController } from '../player/controller';
import type { PositionStore } from '../player/position';
import type { DownloadsPort, PhonePorts, QueueItem, QueueSnapshot, StoragePort } from './ports';

const idOf = (j: { bookId: string; n: number }) => `${j.bookId}/${j.n}`;
const parse = (id: string) => {
  const at = id.lastIndexOf('/');
  return { bookId: id.slice(0, at), n: Number(id.slice(at + 1)) };
};

const BLOCKED_NOTE = { offline: 'No connection · will resume automatically', wifi: 'Waiting for Wi-Fi · downloads use Wi-Fi only (change in Settings)' } as const;

/** Maps the real queue onto what the Downloads screen shows. */
export function snapshotOf(q: QueueState): QueueSnapshot {
  const held = q.blocked === 'offline' || q.blocked === 'wifi';
  const item = (j: Job): QueueItem => ({
    id: idOf(j),
    bookId: j.bookId,
    bookTitle: j.bookTitle,
    chapterN: j.n,
    chapterTitle: j.title,
    status: j.status === 'downloading' ? 'active' : j.status === 'failed' ? 'failed' : held ? 'waiting' : 'queued',
    progress: j.progress || undefined,
    error: j.status === 'failed' ? j.error : undefined,
  });
  const active = q.jobs.find((j) => j.status === 'downloading');
  return {
    items: q.jobs.map(item),
    paused: q.paused,
    online: !held,
    note: held ? BLOCKED_NOTE[q.blocked as 'offline' | 'wifi'] : undefined,
    bytesLeft: active ? Math.round(active.bytes * (1 - active.progress)) : undefined,
  };
}

export function createDownloadsPort(queue: DownloadQueue): DownloadsPort {
  // The screen re-reads getState on every render, so the same snapshot object is returned until the queue changes.
  let last: { src: QueueState; snap: QueueSnapshot } | null = null;
  const on = (id: string, f: (bookId: string, n: number) => void) => {
    const { bookId, n } = parse(id);
    f(bookId, n);
  };
  return {
    getState() {
      const src = queue.state.get();
      if (last?.src !== src) last = { src, snap: snapshotOf(src) };
      return last.snap;
    },
    subscribe: (l) => queue.state.subscribe(l),
    doFirst: (id) => on(id, queue.doFirst),
    cancel: (id) => on(id, queue.cancel),
    retry: (id) => on(id, queue.retry),
    retryAll: queue.retryAll,
    pause: queue.pause,
    resume: queue.resume,
    cancelAll: queue.cancelAll,
  };
}

export function createStoragePort(d: {
  downloaded: DownloadStore;
  positions: PositionStore;
  queue: DownloadQueue;
  player: PlayerController;
  files: FileStore;
  /** Chapter counts of the library's books, when known (the "3 of 12" in the list). */
  totalChapters: (bookId: string) => number | undefined;
}): StoragePort {
  const playing = () => {
    const s = d.player.state.get();
    return s.book && s.chapterN !== null ? { bookId: s.book.id, n: s.chapterN } : null;
  };
  return {
    async usage() {
      const books = d.downloaded.usage().map((u) => {
        const rows = d.downloaded.forBook(u.bookId);
        const done = finishedOnPhone(d.downloaded, d.positions, u.bookId, playing());
        return {
          bookId: u.bookId,
          title: rows[0]?.bookTitle ?? u.bookId,
          downloadedChapters: u.chapters,
          totalChapters: Math.max(u.chapters, d.totalChapters(u.bookId) ?? 0),
          bytes: u.bytes,
          finishedChapters: done.length,
          finishedBytes: done.reduce((n, c) => n + c.bytes, 0),
        };
      });
      return { books, freeBytes: d.files.freeBytes() };
    },
    async cleanUp(bookId) {
      cleanUpFinished(d.downloaded, d.positions, bookId, playing());
    },
    async remove(bookId) {
      if (d.player.state.get().book?.id === bookId) d.player.close();
      d.downloaded.removeBook(bookId);
    },
    async clearAll() {
      d.player.close();
      d.queue.cancelAll();
      for (const u of d.downloaded.usage()) d.downloaded.removeBook(u.bookId);
      d.positions.clear();
    },
  };
}

export const createPhonePorts = (d: Parameters<typeof createStoragePort>[0]): PhonePorts => ({ downloads: createDownloadsPort(d.queue), storage: createStoragePort(d) });
