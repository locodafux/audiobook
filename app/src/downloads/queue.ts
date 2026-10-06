import type { KeyValueStore } from '../data/offlineList';
import type { SettingsStore } from '../settings/settings';
import { createStore, type Store } from '../store';
import type { FileStore } from './files';
import { LINK_BATCH, LinksError, type ChapterLink, type LinksApi } from './links';
import { downloadsAllowed, type Blocked, type NetworkWatcher } from './network';
import type { DownloadStore } from './store';
import { audioPath, chapterKey, isSafeBookId, timingPath } from './types';

export const QUEUE_KEY = 'hearthread.queue.v1';
export const MAX_ATTEMPTS = 3;
/** Links are asked for just in time; one with less than this left is asked for again. */
const LINK_MARGIN_MS = 60_000;

export type Job = {
  bookId: string;
  n: number;
  title: string;
  bookTitle: string;
  /** Expected size, for the free-space check before the link is known. */
  bytes: number;
  durationS: number;
  sentenceCount: number;
  status: 'queued' | 'downloading' | 'failed';
  /** 0..1 */
  progress: number;
  attempts: number;
  /** Plain words shown on a failed row. */
  error?: string;
};

export type QueueState = { jobs: Job[]; paused: boolean; blocked: Blocked };

export type NewJob = Pick<Job, 'bookId' | 'n' | 'title' | 'bookTitle' | 'bytes' | 'durationS' | 'sentenceCount'>;

export type QueueDeps = {
  kv: KeyValueStore;
  files: FileStore;
  links: LinksApi;
  downloaded: DownloadStore;
  settings: SettingsStore;
  network: NetworkWatcher;
  now?: () => number;
  /** Pause between a failed try and the next one; tests pass an instant one. */
  delay?: (ms: number) => Promise<void>;
};

export interface DownloadQueue {
  state: Store<QueueState>;
  load(): Promise<void>;
  /** Adds chapters that are not already downloaded or queued; returns how many were added. */
  enqueue(items: NewJob[]): number;
  pause(): void;
  resume(): void;
  cancel(bookId: string, n: number): void;
  cancelAll(): void;
  doFirst(bookId: string, n: number): void;
  retry(bookId: string, n: number): void;
  retryAll(): void;
  isQueued(bookId: string, n: number): boolean;
}

const sameJob = (bookId: string, n: number) => (j: Job) => j.bookId === bookId && j.n === n;

export function createDownloadQueue(deps: QueueDeps): DownloadQueue {
  const { kv, files, links, downloaded, settings, network } = deps;
  const now = deps.now ?? Date.now;
  const delay = deps.delay ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const state = createStore<QueueState>({ jobs: [], paused: false, blocked: null });
  const linkCache = new Map<string, ChapterLink>();
  let accessEnded = false;
  let running = false;
  let active: { bookId: string; n: number; abort: AbortController; reason?: 'pause' | 'cancel' } | null = null;

  const blockedNow = (paused = state.get().paused): Blocked => {
    if (accessEnded) return 'access_ended';
    if (paused) return 'paused';
    const gate = downloadsAllowed(network.get(), settings.getState().wifiOnly);
    return gate === 'ok' ? null : gate;
  };

  const persist = (jobs: Job[]) =>
    void kv.setItem(QUEUE_KEY, JSON.stringify(jobs.map((j) => ({ ...j, status: j.status === 'downloading' ? 'queued' : j.status, progress: 0 })))).catch(() => {});

  /** The one way state changes: new jobs and/or paused flag; `blocked` is always recomputed. */
  const update = (jobs: Job[], paused = state.get().paused) => {
    state.set({ jobs, paused, blocked: blockedNow(paused) });
    persist(jobs);
  };
  const patch = (bookId: string, n: number, change: Partial<Job>, save = true) => {
    const jobs = state.get().jobs.map((j) => (sameJob(bookId, n)(j) ? { ...j, ...change } : j));
    if (save) update(jobs);
    else state.set({ ...state.get(), jobs });
  };
  const drop = (bookId: string, n: number) => update(state.get().jobs.filter((j) => !sameJob(bookId, n)(j)));

  async function ensureLink(job: Job): Promise<ChapterLink> {
    const fresh = (j: Job) => {
      const l = linkCache.get(chapterKey(j.bookId, j.n));
      return l && l.expiresAt - LINK_MARGIN_MS > now() ? l : undefined;
    };
    const have = fresh(job);
    if (have) return have;
    // Ask for this chapter and the next waiting ones of the same book in one go.
    const batch = state.get().jobs.filter((j) => j.bookId === job.bookId && j.status === 'queued' && (j === job || !fresh(j))).slice(0, LINK_BATCH);
    const got = await links.chapterLinks(job.bookId, [job.n, ...batch.filter((j) => j.n !== job.n).map((j) => j.n)].slice(0, LINK_BATCH));
    for (const l of got) linkCache.set(chapterKey(job.bookId, l.n), l);
    const mine = fresh(job);
    if (!mine) throw new LinksError('not_available');
    return mine;
  }

  async function fetchChapter(job: Job, signal: AbortSignal) {
    const link = await ensureLink(job);
    if (files.freeBytes() < link.bytes * 1.1 + 5_000_000) throw new LinksError('unavailable', 'space');
    const audio = audioPath(job.bookId, job.n);
    const timing = timingPath(job.bookId, job.n);
    let lastShown = 0;
    files.remove(`${audio}.part`);
    await files.download(link.audioUrl, `${audio}.part`, {
      headers: link.headers,
      signal,
      onProgress: (written, total) => {
        const p = total > 0 ? Math.min(1, written / total) : 0;
        if (p - lastShown >= 0.01) {
          lastShown = p;
          patch(job.bookId, job.n, { progress: p }, false);
        }
      },
    });
    if (files.size(`${audio}.part`) !== link.bytes || (await files.sha256(`${audio}.part`)) !== link.sha256) {
      files.remove(`${audio}.part`);
      throw new LinksError('unavailable', 'check');
    }
    files.remove(`${timing}.part`);
    await files.download(link.timingUrl, `${timing}.part`, { headers: link.headers, signal });
    files.move(`${audio}.part`, audio);
    files.move(`${timing}.part`, timing);
    downloaded.add({
      bookId: job.bookId,
      n: job.n,
      title: job.title,
      bookTitle: job.bookTitle,
      durationS: job.durationS,
      bytes: link.bytes,
      sentenceCount: job.sentenceCount,
      audioSha256: link.sha256,
      downloadedAt: now(),
    });
  }

  async function run(job: Job) {
    const abort = new AbortController();
    active = { bookId: job.bookId, n: job.n, abort };
    patch(job.bookId, job.n, { status: 'downloading', progress: 0, error: undefined });
    try {
      await fetchChapter(job, abort.signal);
      drop(job.bookId, job.n);
    } catch (e) {
      const reason = active?.reason;
      files.remove(`${audioPath(job.bookId, job.n)}.part`);
      files.remove(`${timingPath(job.bookId, job.n)}.part`);
      if (reason === 'cancel') return;
      if (reason === 'pause') return patch(job.bookId, job.n, { status: 'queued', progress: 0 });
      const code = e instanceof LinksError ? e.code : 'unavailable';
      const detail = e instanceof LinksError ? e.message : '';
      if (code === 'access_ended') {
        accessEnded = true;
        return patch(job.bookId, job.n, { status: 'queued', progress: 0 });
      }
      if (code === 'not_available') return patch(job.bookId, job.n, { status: 'failed', error: 'No longer available' });
      if (detail === 'space') return patch(job.bookId, job.n, { status: 'failed', error: 'Not enough space on the phone' });
      // Lost the connection or the Wi-Fi: wait for it, do not count a try.
      if (blockedNow()) return patch(job.bookId, job.n, { status: 'queued', progress: 0 });
      const attempts = job.attempts + 1;
      const error = detail === 'check' ? 'The file did not pass its check' : 'Connection problem';
      // A job that keeps failing waits for a manual retry; otherwise it goes to the back of the line.
      const failed = attempts >= MAX_ATTEMPTS;
      const rest = state.get().jobs.filter((j) => !sameJob(job.bookId, job.n)(j));
      update([...rest, { ...job, status: failed ? 'failed' : 'queued', progress: 0, attempts, error }]);
      if (!failed) await delay(1000 * 2 ** attempts);
    } finally {
      active = null;
    }
  }

  async function pump() {
    if (running) return;
    running = true;
    try {
      for (;;) {
        if (blockedNow()) break;
        const job = state.get().jobs.find((j) => j.status === 'queued');
        if (!job) break;
        await run(job);
      }
    } finally {
      running = false;
      // Something may have changed (a retry, a reconnect) while the last job was finishing.
      state.set({ ...state.get(), blocked: blockedNow() });
    }
  }

  const refresh = () => {
    state.set({ ...state.get(), blocked: blockedNow() });
    // Off Wi-Fi (or offline) mid-download: stop now instead of finishing on mobile data.
    if (active && !active.reason && blockedNow()) {
      active.reason = 'pause';
      active.abort.abort();
    }
    void pump();
  };
  network.subscribe(refresh);
  settings.subscribe(refresh);

  const start = (jobs: Job[], paused?: boolean) => {
    update(jobs, paused);
    void pump();
  };

  return {
    state,
    async load() {
      try {
        const raw = await kv.getItem(QUEUE_KEY);
        const parsed: unknown = raw ? JSON.parse(raw) : null;
        if (Array.isArray(parsed)) {
          start(parsed.filter((j: Job) => isSafeBookId(j?.bookId) && Number.isInteger(j.n)).map((j: Job) => ({ ...j, status: j.status === 'failed' ? 'failed' : 'queued', progress: 0 })));
        }
      } catch {
        // unreadable queue: start empty
      }
    },
    enqueue(items) {
      const jobs = state.get().jobs;
      const added: Job[] = [];
      for (const it of items) {
        const dup = downloaded.has(it.bookId, it.n) || [...jobs, ...added].some(sameJob(it.bookId, it.n));
        if (dup || !isSafeBookId(it.bookId) || !Number.isInteger(it.n) || it.n < 1) continue;
        added.push({ ...it, status: 'queued', progress: 0, attempts: 0 });
      }
      if (added.length) start([...jobs, ...added]);
      return added.length;
    },
    pause() {
      if (active) active.reason = 'pause';
      active?.abort.abort();
      update(state.get().jobs, true);
    },
    resume() {
      start(state.get().jobs, false);
    },
    cancel(bookId, n) {
      if (active && active.bookId === bookId && active.n === n) {
        active.reason = 'cancel';
        active.abort.abort();
      }
      drop(bookId, n);
    },
    cancelAll() {
      if (active) active.reason = 'cancel';
      active?.abort.abort();
      update([]);
    },
    doFirst(bookId, n) {
      const jobs = state.get().jobs;
      const job = jobs.find(sameJob(bookId, n));
      if (!job || job.status === 'downloading') return;
      const rest = jobs.filter((j) => j !== job);
      const at = rest.findIndex((j) => j.status === 'queued');
      rest.splice(at === -1 ? rest.length : at, 0, { ...job, status: 'queued', attempts: 0, error: undefined });
      update(rest);
    },
    retry(bookId, n) {
      accessEnded = false;
      start(state.get().jobs.map((j) => (sameJob(bookId, n)(j) ? { ...j, status: 'queued', attempts: 0, error: undefined } : j)));
    },
    retryAll() {
      accessEnded = false;
      start(state.get().jobs.map((j) => (j.status === 'failed' ? { ...j, status: 'queued', attempts: 0, error: undefined } : j)));
    },
    isQueued: (bookId, n) => state.get().jobs.some(sameJob(bookId, n)),
  };
}
