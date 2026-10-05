import { fixtureBooks, makeChapter } from '../data/fixtures';
import { fakeFiles, memoryKv } from '../downloads/fakes';
import { cleanUpFinished, cleanUpOld } from '../downloads/cleanup';
import { createDownloadStore } from '../downloads/store';
import { audioPath, timingPath } from '../downloads/types';
import { createSettingsStore, DEFAULT_SETTINGS, smartRewindS, speedFor } from '../settings/settings';
import { createPlayerController } from './controller';
import { fakeEngine } from './fakeEngine';
import { createPositionStore, FINISHED_WITHIN_S, POSITIONS_KEY } from './position';
import { extendSleep, sleepIn, sleepRemainingS, sleepVolume } from './sleep';
import { parseTiming, sentenceIndexAt } from './timing';

const book = fixtureBooks[2]!; // quiet-orchard
const chapters = [1, 2, 3, 4].map((n) => makeChapter(book.id, n));
const sentences = Array.from({ length: 20 }, (_, i) => ({ i, t: `Sentence ${i}.`, s: i * 3, e: i * 3 + 3 }));
const timingJson = JSON.stringify({ v: 1, sentences });

function setup(opts: { have?: number[]; clock?: { t: number }; kv?: ReturnType<typeof memoryKv> } = {}) {
  const clock = opts.clock ?? { t: 1_000_000 };
  const kv = opts.kv ?? memoryKv();
  const files = fakeFiles();
  const downloaded = createDownloadStore(memoryKv(), files);
  for (const n of opts.have ?? [1, 2, 3]) {
    files.disk.set(audioPath(book.id, n), { bytes: 3_000_000, sha: 'x' });
    files.disk.set(timingPath(book.id, n), { bytes: 1, sha: '', text: timingJson });
    downloaded.add({ bookId: book.id, n, title: `Chapter ${n}`, bookTitle: book.title, durationS: 600 + n, bytes: 3_000_000, sentenceCount: 20, audioSha256: 'x', downloadedAt: 0 });
  }
  const settings = createSettingsStore(memoryKv());
  const positions = createPositionStore(kv);
  const engine = fakeEngine(60);
  const onChapter = jest.fn();
  const onListened = jest.fn();
  const onBookFinished = jest.fn();
  const player = createPlayerController({ engine, files, downloaded, positions, settings, now: () => clock.t, onChapter, onListened, onBookFinished });
  return { clock, kv, files, downloaded, settings, positions, engine, player, onChapter, onListened, onBookFinished };
}

describe('timing file', () => {
  it('reads the v1 format and finds the sentence at a time', () => {
    const s = parseTiming(JSON.parse(timingJson));
    expect(s).toHaveLength(20);
    expect(sentenceIndexAt(s, 0)).toBe(0);
    expect(sentenceIndexAt(s, 2.99)).toBe(0);
    expect(sentenceIndexAt(s, 3)).toBe(1);
    expect(sentenceIndexAt(s, 7.5)).toBe(2);
    expect(sentenceIndexAt(s, 9999)).toBe(19);
    expect(sentenceIndexAt([], 5)).toBe(-1);
  });
  it('refuses files it cannot trust', () => {
    expect(() => parseTiming({ v: 2, sentences: [] })).toThrow();
    expect(() => parseTiming({ v: 1, sentences: [{ i: 0, t: 'a', s: 2, e: 1 }] })).toThrow();
    expect(() => parseTiming({ v: 1, sentences: [{ i: 0, t: 'a', s: 0, e: 5 }, { i: 1, t: 'b', s: 1, e: 6 }] })).toThrow();
    expect(() => parseTiming(null)).toThrow();
  });
});

describe('sleep timer and smart rewind rules', () => {
  it('fades over the last 30 seconds', () => {
    expect(sleepVolume(45, true)).toBe(1);
    expect(sleepVolume(15, true)).toBe(0.5);
    expect(sleepVolume(0, true)).toBe(0);
    expect(sleepVolume(5, false)).toBe(1);
  });
  it('counts down minutes and follows the chapter', () => {
    expect(sleepRemainingS(sleepIn(10, 0), 60_000, 999)).toBe(540);
    expect(sleepRemainingS({ kind: 'chapter' }, 0, 123)).toBe(123);
  });
  it('extends by ten minutes', () => {
    expect(extendSleep(sleepIn(5, 0), 60_000)).toEqual({ kind: 'minutes', endsAt: 60_000 + 14 * 60_000 });
    expect(extendSleep({ kind: 'chapter' }, 0)).toEqual({ kind: 'minutes', endsAt: 600_000 });
  });
  it('rewinds more the longer the pause, and not at all when off', () => {
    expect(smartRewindS(20_000, 10)).toBe(0);
    expect(smartRewindS(60_000, 10)).toBe(3);
    expect(smartRewindS(10 * 60_000, 10)).toBe(7);
    expect(smartRewindS(3_600_000, 10)).toBe(10);
    expect(smartRewindS(3_600_000, 0)).toBe(0);
  });
});

describe('player', () => {
  it('plays a downloaded chapter at the book speed and follows the voice', async () => {
    const t = setup();
    t.settings.update({ speed: 1.25 });
    await t.player.open(book, chapters, 1, true);
    const s = t.player.state.get();
    expect(s).toMatchObject({ load: 'ready', playing: true, chapterN: 1, speed: 1.25 });
    expect(t.engine.rate).toBe(1.25);
    expect(t.engine.uri).toBe(`file:///fake/${audioPath(book.id, 1)}`);
    expect(t.engine.track).toMatchObject({ title: 'Chapter 1', album: book.title });
    t.engine.tick(4); // 5 s of audio at 1.25x
    expect(t.player.state.get()).toMatchObject({ position: 5, sentenceIndex: 1 });
  });

  it('says so when the chapter file is not on the phone', async () => {
    const t = setup({ have: [1] });
    await t.player.open(book, chapters, 2, true);
    expect(t.player.state.get()).toMatchObject({ load: 'missing', playing: false, chapterN: 2 });
    expect(t.engine.cleared).toBe(1);
    // storage cleared behind the app's back: the list heals itself
    t.files.remove(audioPath(book.id, 1));
    await t.player.open(book, chapters, 1);
    expect(t.player.state.get().load).toBe('missing');
    expect(t.downloaded.has(book.id, 1)).toBe(false);
  });

  it('plays without text when the timing file is bad', async () => {
    const t = setup();
    t.files.disk.set(timingPath(book.id, 1), { bytes: 1, sha: '', text: '{"v":9}' });
    await t.player.open(book, chapters, 1, true);
    expect(t.player.state.get()).toMatchObject({ load: 'ready', sentences: [], sentenceIndex: -1 });
  });

  it('skips by the configured seconds and stays inside the chapter', async () => {
    const t = setup();
    await t.player.open(book, chapters, 1, true);
    t.engine.emit(); // the file reports its real length (60 s)
    t.player.skipForward();
    expect(t.player.state.get().position).toBe(30);
    t.player.skipBack();
    expect(t.player.state.get().position).toBe(15);
    t.settings.update({ skipBackS: 30, skipForwardS: 45 });
    t.player.skipForward();
    t.player.skipForward();
    expect(t.player.state.get().position).toBe(60); // chapter is 60 s long
    t.player.seekTo(-5);
    expect(t.player.state.get().position).toBe(0);
  });

  it('jumps by sentence', async () => {
    const t = setup();
    await t.player.open(book, chapters, 1, true);
    t.player.seekToSentence(5);
    expect(t.player.state.get().position).toBe(15);
    t.player.nextSentence();
    expect(t.player.state.get().position).toBe(18);
    t.engine.tick(1); // 1 s into sentence 6: previous goes to 5
    t.player.prevSentence();
    expect(t.player.state.get().position).toBe(15);
    t.player.seekTo(26.5); // 2.5 s into sentence 8: previous replays it
    t.player.prevSentence();
    expect(t.player.state.get().position).toBe(24);
  });

  it('saves the place while playing, on pause, and resumes there after a restart', async () => {
    const t = setup();
    await t.player.open(book, chapters, 2, true);
    t.engine.tick(3);
    expect(t.positions.get(book.id)?.positionS).toBe(0); // under 5 s since the last save
    t.engine.tick(3);
    expect(t.positions.get(book.id)).toMatchObject({ chapter: 2, positionS: 6 });
    t.engine.tick(2);
    t.player.pause();
    expect(t.positions.get(book.id)?.positionS).toBe(8);

    const again = setup({ kv: t.kv, clock: t.clock });
    await again.positions.load();
    await again.player.open(book, chapters);
    expect(again.player.state.get()).toMatchObject({ chapterN: 2, position: 8, load: 'ready' });
    expect(again.positions.state.get()[book.id]?.chapter).toBe(2);
  });

  it('rewinds a little after a long pause, with Undo', async () => {
    const t = setup();
    await t.player.open(book, chapters, 1, true);
    t.engine.tick(30);
    t.player.pause();
    t.clock.t += 3_600_000;
    t.player.play();
    expect(t.player.state.get()).toMatchObject({ position: 20, rewound: { seconds: 10, from: 30 } });
    t.player.undoRewind();
    expect(t.player.state.get()).toMatchObject({ position: 30, rewound: null });
    // a short pause does not rewind
    t.player.pause();
    t.clock.t += 20_000;
    t.player.play();
    expect(t.player.state.get().rewound).toBeNull();
  });

  it('rewinds after the app was closed for a while, using the saved time', async () => {
    const t = setup();
    await t.player.open(book, chapters, 1, true);
    t.engine.tick(30);
    t.player.pause();
    const later = setup({ kv: t.kv, clock: { t: t.clock.t + 7_200_000 } });
    await later.positions.load();
    await later.player.open(book, chapters);
    later.player.play();
    expect(later.player.state.get()).toMatchObject({ position: 20, rewound: { seconds: 10 } });
  });

  it('moves on to the next chapter at the end and tags the finished one', async () => {
    const t = setup();
    await t.player.open(book, chapters, 1, true);
    t.engine.position = 60;
    t.engine.emit({ ended: true });
    await Promise.resolve();
    await Promise.resolve();
    expect(t.positions.isFinished(book.id, 1)).toBe(true);
    expect(t.player.state.get()).toMatchObject({ chapterN: 2, load: 'ready', playing: true });
  });

  it('still moves on at the end after being tagged finished near the end', async () => {
    const t = setup();
    await t.player.open(book, chapters, 1, true);
    t.engine.tick(60 - FINISHED_WITHIN_S + 1);
    expect(t.positions.isFinished(book.id, 1)).toBe(true);
    t.engine.emit({ ended: true });
    await Promise.resolve();
    await Promise.resolve();
    expect(t.player.state.get()).toMatchObject({ chapterN: 2, load: 'ready', playing: true });
  });

  it('tags a chapter finished within 5 s of the end', async () => {
    const t = setup();
    await t.player.open(book, chapters, 1, true);
    t.engine.tick(60 - FINISHED_WITHIN_S - 1);
    expect(t.positions.isFinished(book.id, 1)).toBe(false);
    t.engine.tick(1.5);
    expect(t.positions.isFinished(book.id, 1)).toBe(true);
  });

  it('reopens at the next chapter when the saved place was almost at the end', async () => {
    const t = setup();
    t.positions.save(book.id, 1, 601, t.clock.t); // chapter 1 is 601 s long
    await t.player.open(book, chapters);
    expect(t.player.state.get()).toMatchObject({ chapterN: 2, position: 0 });
  });

  it('keeps the next chapters coming: tells the downloads which chapter is current', async () => {
    const t = setup();
    await t.player.open(book, chapters, 2);
    expect(t.onChapter).toHaveBeenCalledWith(book, chapters, 2);
  });

  it('book speed overrides the default; "all books" changes the default and clears the override', async () => {
    const t = setup();
    await t.player.open(book, chapters, 1);
    t.player.setSpeed(1.5, 'book');
    expect(speedFor(t.settings.getState(), book.id)).toBe(1.5);
    expect(speedFor(t.settings.getState(), 'other')).toBe(DEFAULT_SETTINGS.speed);
    expect(t.engine.rate).toBe(1.5);
    t.player.setSpeed(1.75, 'all');
    expect(speedFor(t.settings.getState(), book.id)).toBe(1.75);
    expect(t.settings.getState().bookSpeeds).toEqual({});
    t.player.setSpeed(9, 'all'); // clamped to 3x
    expect(t.engine.rate).toBe(3);
  });

  it('sleep timer in minutes fades out, then pauses', async () => {
    const t = setup();
    await t.player.open(book, chapters, 1, true);
    t.player.setSleep({ minutes: 5 });
    t.clock.t += 4 * 60_000;
    t.engine.tick(1);
    expect(t.engine.volume).toBe(1);
    t.clock.t += 45_000; // 15 s left
    t.engine.tick(1);
    expect(t.engine.volume).toBeCloseTo(0.5);
    t.clock.t += 20_000;
    t.engine.tick(1);
    expect(t.engine.playing).toBe(false);
    expect(t.engine.volume).toBe(1);
    expect(t.player.state.get()).toMatchObject({ sleep: null, playing: false });
  });

  it('end-of-chapter sleep timer stops at the next chapter instead of playing on', async () => {
    const t = setup();
    await t.player.open(book, chapters, 1, true);
    t.player.setSleep('chapter');
    t.engine.position = 60;
    t.engine.emit({ ended: true });
    await Promise.resolve();
    await Promise.resolve();
    expect(t.player.state.get()).toMatchObject({ chapterN: 2, playing: false, sleep: null });
  });

  it('extending the timer adds ten minutes', async () => {
    const t = setup();
    await t.player.open(book, chapters, 1, true);
    t.player.setSleep({ minutes: 1 });
    t.player.extendSleep();
    expect(t.player.state.get().sleep).toEqual({ kind: 'minutes', endsAt: t.clock.t + 11 * 60_000 });
  });

  it('stops at the start of the next chapter when "Play next chapter" is off', async () => {
    const t = setup();
    t.settings.update({ autoPlayNext: false });
    await t.player.open(book, chapters, 1, true);
    t.engine.position = 60;
    t.engine.emit({ ended: true });
    await Promise.resolve();
    await Promise.resolve();
    expect(t.player.state.get()).toMatchObject({ chapterN: 2, playing: false });
  });

  it('reports real listening time every 10 s and on pause, and the end of the book', async () => {
    const t = setup();
    await t.player.open(book, chapters, 1, true);
    t.engine.playing = true;
    for (let i = 0; i < 12; i++) {
      t.clock.t += 1000;
      t.engine.tick(0.5); // listening time is wall-clock, not audio time
    }
    expect(t.onListened).toHaveBeenCalledWith(book.id, 10);
    t.clock.t += 3000;
    t.engine.tick(0.5);
    t.player.pause();
    expect(t.onListened).toHaveBeenLastCalledWith(book.id, 4);

    const last = setup({ have: [4] });
    await last.player.open(book, chapters, 4, true);
    last.engine.position = 60;
    last.engine.emit({ ended: true });
    expect(last.onBookFinished).toHaveBeenCalledWith(book.id);
  });
});

describe('storage clean-up', () => {
  it('frees finished chapters but never the one that is playing, and keeps the place', async () => {
    const t = setup();
    t.positions.markFinished(book.id, 1);
    t.positions.markFinished(book.id, 2);
    const freed = cleanUpFinished(t.downloaded, t.positions, book.id, { bookId: book.id, n: 2 });
    expect(freed).toBe(3_000_000);
    expect(t.downloaded.forBook(book.id).map((c) => c.n)).toEqual([2, 3]);
    expect(t.positions.isFinished(book.id, 1)).toBe(true);
  });
});

describe('auto-clean after N days', () => {
  it('removes finished chapters of books left alone for that long, and nothing when off', () => {
    const t = setup();
    t.positions.save(book.id, 2, 10, 1_000_000);
    t.positions.markFinished(book.id, 1);
    const day = 86_400_000;
    expect(cleanUpOld(t.downloaded, t.positions, 0, 1_000_000 + 30 * day)).toBe(0);
    expect(cleanUpOld(t.downloaded, t.positions, 7, 1_000_000 + 3 * day)).toBe(0);
    expect(cleanUpOld(t.downloaded, t.positions, 7, 1_000_000 + 8 * day)).toBe(3_000_000);
    expect(t.downloaded.has(book.id, 1)).toBe(false);
    expect(t.downloaded.has(book.id, 2)).toBe(true);
  });
});

describe('position store', () => {
  it('survives a restart and knows the most recent book', async () => {
    const kv = memoryKv();
    const a = createPositionStore(kv);
    a.save('b1', 3, 42, 100);
    a.save('b2', 1, 5, 200);
    const b = createPositionStore(kv);
    await b.load();
    expect(b.get('b1')).toMatchObject({ chapter: 3, positionS: 42 });
    expect(b.latest()?.bookId).toBe('b2');
  });
  it('ignores a corrupt copy', async () => {
    const b = createPositionStore(memoryKv({ [POSITIONS_KEY]: '{not json' }));
    await b.load();
    expect(b.get('x')).toBeUndefined();
  });
});
