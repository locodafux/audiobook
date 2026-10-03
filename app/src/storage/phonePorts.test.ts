import { fixtureBooks } from '../data/fixtures';
import { fakeFiles, fakeLinks, fakeNetwork, memoryKv } from '../downloads/fakes';
import { createDownloadQueue } from '../downloads/queue';
import { createDownloadStore } from '../downloads/store';
import { audioPath } from '../downloads/types';
import { createPlayerController } from '../player/controller';
import { fakeEngine } from '../player/fakeEngine';
import { createPositionStore } from '../player/position';
import { createSettingsStore } from '../settings/settings';
import { createPhonePorts } from './phonePorts';

const book = fixtureBooks[2]!;
const job = (n: number) => ({ bookId: book.id, bookTitle: book.title, n, title: `Chapter ${n}`, bytes: 1000, durationS: 60, sentenceCount: 5 });

function setup(net = { connected: true, wifi: false }) {
  const files = fakeFiles();
  const downloaded = createDownloadStore(memoryKv(), files);
  const settings = createSettingsStore(memoryKv());
  const positions = createPositionStore(memoryKv());
  const player = createPlayerController({ engine: fakeEngine(), files, downloaded, positions, settings });
  const queue = createDownloadQueue({ kv: memoryKv(), files, links: fakeLinks({}), downloaded, settings, network: fakeNetwork(net), delay: async () => {} });
  const ports = createPhonePorts({ downloaded, positions, queue, player, files, totalChapters: () => 12 });
  const have = (n: number) => {
    files.disk.set(audioPath(book.id, n), { bytes: 500, sha: 'x' });
    downloaded.add({ bookId: book.id, n, title: `Chapter ${n}`, bookTitle: book.title, durationS: 60, bytes: 500, sentenceCount: 5, audioSha256: 'x', downloadedAt: 0 });
  };
  return { ports, queue, positions, downloaded, have, settings };
}

describe('downloads port', () => {
  it('shows jobs held back by Wi-Fi-only as waiting, with the reason', () => {
    const t = setup(); // on mobile data, Wi-Fi only (the default)
    t.queue.enqueue([job(1), job(2)]);
    const snap = t.ports.downloads.getState();
    expect(snap).toMatchObject({ online: false, paused: false, note: expect.stringContaining('Wi-Fi') });
    expect(snap.items.map((i) => [i.chapterN, i.status])).toEqual([[1, 'waiting'], [2, 'waiting']]);
    expect(t.ports.downloads.getState()).toBe(snap); // same object until something changes
  });

  it('acts on a row by its id', () => {
    const t = setup();
    t.queue.enqueue([job(1), job(2)]);
    const second = t.ports.downloads.getState().items[1]!;
    t.ports.downloads.doFirst(second.id);
    expect(t.ports.downloads.getState().items.map((i) => i.chapterN)).toEqual([2, 1]);
    t.ports.downloads.cancel(second.id);
    expect(t.ports.downloads.getState().items.map((i) => i.chapterN)).toEqual([1]);
    t.ports.downloads.pause();
    expect(t.ports.downloads.getState().paused).toBe(true);
  });
});

describe('storage port', () => {
  it('reports per-book use and what clean-up would free, then cleans and removes', async () => {
    const t = setup();
    [1, 2, 3].forEach(t.have);
    t.positions.markFinished(book.id, 1);
    t.positions.markFinished(book.id, 2);
    const usage = await t.ports.storage.usage();
    expect(usage.books).toEqual([
      { bookId: book.id, title: book.title, downloadedChapters: 3, totalChapters: 12, bytes: 1500, finishedChapters: 2, finishedBytes: 1000 },
    ]);
    await t.ports.storage.cleanUp(book.id);
    expect(t.downloaded.forBook(book.id).map((c) => c.n)).toEqual([3]);
    await t.ports.storage.remove(book.id);
    expect(t.downloaded.forBook(book.id)).toEqual([]);
  });

  it('clears every download and the listening places', async () => {
    const t = setup();
    t.have(1);
    t.positions.save(book.id, 1, 5, 1);
    await t.ports.storage.clearAll();
    expect(t.downloaded.totalBytes()).toBe(0);
    expect(t.positions.get(book.id)).toBeUndefined();
  });
});
