import { createPrefsStore } from '../prefs/prefs';
import { chaptersToKeep } from './autoDownload';
import { fakeFiles, fakeLinks, fakeNetwork, memoryKv, type Remote } from './fakes';
import { LinksError, parseLinks } from './links';
import { createDownloadQueue, MAX_ATTEMPTS, QUEUE_KEY, type NewJob } from './queue';
import { createDownloadStore } from './store';
import { audioPath, isSafeBookId, timingPath } from './types';

const BOOK = 'quiet-orchard';
const job = (n: number): NewJob => ({ bookId: BOOK, bookTitle: 'The Quiet Orchard', n, title: `Chapter ${n}`, bytes: 1000, durationS: 600, sentenceCount: 50 });
const settle = async () => {
  for (let i = 0; i < 30; i++) await new Promise<void>((r) => setImmediate(() => r()));
};

function setup(chapterCount = 12, opts: { net?: { connected: boolean; wifi: boolean }; seedKv?: Record<string, string> } = {}) {
  const remote: Record<string, Remote> = {};
  const specs: Record<number, { bytes: number; sha: string }> = {};
  for (let n = 1; n <= chapterCount; n++) {
    specs[n] = { bytes: 1000, sha: `sha${n}` };
    remote[`https://r2/${BOOK}/${n}.mp3`] = specs[n]!;
    remote[`https://r2/${BOOK}/${n}.json`] = { bytes: 10, sha: '', text: '{"v":1,"sentences":[]}' };
  }
  const kv = memoryKv(opts.seedKv);
  const files = fakeFiles(remote);
  const links = fakeLinks(specs);
  const network = fakeNetwork(opts.net);
  const prefs = createPrefsStore(memoryKv());
  const downloaded = createDownloadStore(kv, files);
  const queue = createDownloadQueue({ kv, files, links, downloaded, prefs, network, delay: async () => {} });
  return { kv, files, links, network, prefs, downloaded, queue, remote };
}

describe('download queue', () => {
  it('downloads queued chapters, checks size and hash, and lists them as on the phone', async () => {
    const t = setup();
    t.queue.enqueue([job(1), job(2)]);
    await settle();
    expect(t.queue.state.get().jobs).toEqual([]);
    expect(t.downloaded.forBook(BOOK).map((c) => c.n)).toEqual([1, 2]);
    expect(t.files.exists(audioPath(BOOK, 1))).toBe(true);
    expect(t.files.exists(timingPath(BOOK, 1))).toBe(true);
    expect(t.files.exists(`${audioPath(BOOK, 1)}.part`)).toBe(false);
  });

  it('asks for links just in time, in one batch of at most 10', async () => {
    const t = setup(25);
    t.queue.enqueue(Array.from({ length: 25 }, (_, i) => job(i + 1)));
    await settle();
    expect(t.links.asked.map((a) => a.length)).toEqual([10, 10, 5]);
    expect(t.links.asked[0]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(t.downloaded.forBook(BOOK)).toHaveLength(25);
  });

  it('asks again when a link is about to expire', async () => {
    let clock = 0;
    const t = setup(3);
    const links = fakeLinks({ 1: { bytes: 1000, sha: 'sha1' }, 2: { bytes: 1000, sha: 'sha2' } }, () => clock);
    const queue = createDownloadQueue({ kv: t.kv, files: t.files, links, downloaded: t.downloaded, prefs: t.prefs, network: t.network, now: () => clock, delay: async () => {} });
    let release!: () => void;
    t.files.gate = new Promise<void>((r) => (release = () => r())); // hold chapter 1 mid-download
    queue.enqueue([job(1), job(2)]);
    await settle();
    clock = 850_000; // the 15-minute links now have under a minute left
    release();
    await settle();
    expect(links.asked).toEqual([[1, 2], [2]]);
    expect(t.downloaded.forBook(BOOK)).toHaveLength(2);
  });

  it('rejects a file whose hash is wrong, retries, then marks it failed with a reason', async () => {
    const t = setup();
    t.remote[`https://r2/${BOOK}/1.mp3`] = { bytes: 1000, sha: 'tampered' };
    t.queue.enqueue([job(1)]);
    await settle();
    const [failed] = t.queue.state.get().jobs;
    expect(failed).toMatchObject({ status: 'failed', attempts: MAX_ATTEMPTS, error: 'The file did not pass its check' });
    expect(t.downloaded.has(BOOK, 1)).toBe(false);
    expect(t.files.exists(audioPath(BOOK, 1))).toBe(false);
    // retry after the file is fixed
    t.remote[`https://r2/${BOOK}/1.mp3`] = { bytes: 1000, sha: 'sha1' };
    t.queue.retry(BOOK, 1);
    await settle();
    expect(t.downloaded.has(BOOK, 1)).toBe(true);
  });

  it('rejects a file of the wrong size', async () => {
    const t = setup();
    t.remote[`https://r2/${BOOK}/1.mp3`] = { bytes: 999, sha: 'sha1' };
    t.queue.enqueue([job(1)]);
    await settle();
    expect(t.queue.state.get().jobs[0]).toMatchObject({ status: 'failed' });
  });

  it('on Wi-Fi only, waits on mobile data and starts by itself when Wi-Fi returns', async () => {
    const t = setup(12, { net: { connected: true, wifi: false } });
    t.queue.enqueue([job(1)]);
    await settle();
    expect(t.queue.state.get().blocked).toBe('wifi');
    expect(t.links.asked).toEqual([]);
    t.network.set({ connected: true, wifi: true });
    await settle();
    expect(t.downloaded.has(BOOK, 1)).toBe(true);
    expect(t.queue.state.get().blocked).toBeNull();
  });

  it('downloads on mobile data once Wi-Fi only is switched off', async () => {
    const t = setup(12, { net: { connected: true, wifi: false } });
    t.queue.enqueue([job(1)]);
    await settle();
    t.prefs.update({ wifiOnly: false });
    await settle();
    expect(t.downloaded.has(BOOK, 1)).toBe(true);
  });

  it('losing the connection mid-download waits and does not count a try', async () => {
    const t = setup();
    t.files.failNext = new Error('Network request failed');
    t.network.set({ connected: false, wifi: false });
    t.queue.enqueue([job(1)]);
    await settle();
    expect(t.queue.state.get()).toMatchObject({ blocked: 'offline', jobs: [{ status: 'queued', attempts: 0 }] });
    t.network.set({ connected: true, wifi: true });
    await settle();
    expect(t.downloaded.has(BOOK, 1)).toBe(true);
  });

  it('stops the running download when Wi-Fi drops, and keeps the job', async () => {
    const t = setup();
    t.files.gate = new Promise(() => {});
    t.queue.enqueue([job(1)]);
    await settle();
    expect(t.queue.state.get().jobs[0]!.status).toBe('downloading');
    t.network.set({ connected: true, wifi: false });
    await settle();
    expect(t.queue.state.get()).toMatchObject({ blocked: 'wifi', jobs: [{ status: 'queued', attempts: 0 }] });
  });

  it('pause stops the active chapter, resume carries on', async () => {
    const t = setup();
    t.files.gate = new Promise(() => {});
    t.queue.enqueue([job(1), job(2)]);
    await settle();
    t.queue.pause();
    await settle();
    expect(t.queue.state.get()).toMatchObject({ paused: true, blocked: 'paused' });
    expect(t.queue.state.get().jobs.map((j) => j.status)).toEqual(['queued', 'queued']);
    t.files.gate = null;
    t.queue.resume();
    await settle();
    expect(t.downloaded.forBook(BOOK)).toHaveLength(2);
  });

  it('cancel removes a queued chapter; do first moves it to the front', async () => {
    const t = setup();
    t.queue.pause();
    t.queue.enqueue([job(1), job(2), job(3)]);
    t.queue.doFirst(BOOK, 3);
    expect(t.queue.state.get().jobs.map((j) => j.n)).toEqual([3, 1, 2]);
    t.queue.cancel(BOOK, 1);
    expect(t.queue.state.get().jobs.map((j) => j.n)).toEqual([3, 2]);
    t.queue.cancelAll();
    expect(t.queue.state.get().jobs).toEqual([]);
  });

  it('ignores chapters already on the phone or already queued', async () => {
    const t = setup();
    t.queue.pause();
    expect(t.queue.enqueue([job(1), job(1), job(2)])).toBe(2);
    expect(t.queue.enqueue([job(2)])).toBe(0);
    t.queue.resume();
    await settle();
    expect(t.queue.enqueue([job(1)])).toBe(0);
  });

  it('refuses book ids that could escape the app folder', () => {
    const t = setup();
    t.queue.pause();
    expect(t.queue.enqueue([{ ...job(1), bookId: '../../etc' }, { ...job(2), bookId: 'a/b' }])).toBe(0);
    expect(isSafeBookId('lantern-road-1')).toBe(true);
    expect(isSafeBookId('..')).toBe(false);
  });

  it('stops everything when access has ended, and says so', async () => {
    const t = setup();
    t.links.error = new LinksError('access_ended');
    t.queue.enqueue([job(1), job(2)]);
    await settle();
    expect(t.queue.state.get().blocked).toBe('access_ended');
    expect(t.queue.state.get().jobs.every((j) => j.status === 'queued')).toBe(true);
    expect(t.links.asked).toHaveLength(1);
  });

  it('fails a chapter the server no longer offers, without retrying', async () => {
    const t = setup(1);
    t.queue.enqueue([job(1), job(7)]);
    await settle();
    expect(t.queue.state.get().jobs).toEqual([expect.objectContaining({ n: 7, status: 'failed', error: 'No longer available', attempts: 0 })]);
  });

  it('fails clearly when the phone is out of space', async () => {
    const t = setup();
    t.files.free = 1000;
    t.queue.enqueue([job(1)]);
    await settle();
    expect(t.queue.state.get().jobs[0]).toMatchObject({ status: 'failed', error: 'Not enough space on the phone' });
  });

  it('survives a restart: waiting chapters come back and download', async () => {
    const t = setup();
    t.queue.pause();
    t.queue.enqueue([job(1), job(2)]);
    await settle();
    const t2 = setup(12, { seedKv: { [QUEUE_KEY]: t.kv.data[QUEUE_KEY]! } });
    await t2.queue.load();
    await settle();
    expect(t2.downloaded.forBook(BOOK).map((c) => c.n)).toEqual([1, 2]);
  });
});

describe('downloaded store', () => {
  it('totals sizes per book, deletes files with the entry, and drops entries whose file is gone', async () => {
    const t = setup();
    t.queue.enqueue([job(1), job(2), job(3)]);
    await settle();
    expect(t.downloaded.usage()).toEqual([{ bookId: BOOK, chapters: 3, bytes: 3000 }]);
    t.downloaded.removeChapter(BOOK, 1);
    expect(t.files.exists(audioPath(BOOK, 1))).toBe(false);
    expect(t.files.exists(timingPath(BOOK, 1))).toBe(false);
    t.files.remove(audioPath(BOOK, 2)); // phone storage cleared behind our back
    expect(t.downloaded.reconcile()).toBe(1);
    expect(t.downloaded.forBook(BOOK).map((c) => c.n)).toEqual([3]);
    t.downloaded.removeBook(BOOK);
    expect(t.downloaded.totalBytes()).toBe(0);
    expect(t.files.disk.size).toBe(0);
  });

  it('reloads the list after a restart', async () => {
    const t = setup();
    t.queue.enqueue([job(1)]);
    await settle();
    const again = createDownloadStore(t.kv, t.files);
    await again.load();
    expect(again.has(BOOK, 1)).toBe(true);
  });
});

describe('keep next N', () => {
  const chapters = Array.from({ length: 10 }, (_, i) => ({ n: i + 1, title: `Chapter ${i + 1}`, bytes: 1, duration_s: 1, sentence_count: 1 }));
  const base = { bookId: BOOK, bookTitle: 't', chapters, queued: () => false };

  it('wants the N chapters after the current one that are missing', () => {
    const got = chaptersToKeep({ ...base, currentN: 4, keepNext: 3, have: (n) => n === 6 });
    expect(got.map((j) => j.n)).toEqual([5, 7]); // 6 already counts toward the three
  });
  it('does nothing when off, at the end of the book, or already queued', () => {
    expect(chaptersToKeep({ ...base, currentN: 4, keepNext: 0, have: () => false })).toEqual([]);
    expect(chaptersToKeep({ ...base, currentN: 10, keepNext: 3, have: () => false })).toEqual([]);
    expect(chaptersToKeep({ ...base, currentN: 4, keepNext: 2, have: () => false, queued: (n) => n === 5 }).map((j) => j.n)).toEqual([6]);
  });
});

describe('download-links answer', () => {
  it('maps the answer and lower-cases the hash', () => {
    const [l] = parseLinks({ chapters: [{ n: 3, audio_url: 'a', timing_url: 't', bytes: 5, sha256: 'ABC', expires_in: 900 }] }, 1000);
    expect(l).toEqual({ n: 3, audioUrl: 'a', timingUrl: 't', bytes: 5, sha256: 'abc', expiresAt: 901_000 });
  });
  it('rejects an answer it does not understand', () => {
    expect(() => parseLinks({ nope: 1 }, 0)).toThrow(LinksError);
    expect(() => parseLinks({ chapters: [{ n: 1 }] }, 0)).toThrow(LinksError);
  });
});
