import type { BookRow, ChapterRow } from '../data/types';
import { downloadedAsRows, type DownloadStore } from '../downloads/store';
import { audioPath, timingPath } from '../downloads/types';
import type { FileStore } from '../downloads/files';
import { clampSpeed, smartRewindS, speedFor, type SettingsStore } from '../settings/settings';
import { createStore, type Store } from '../store';
import type { EngineStatus, PlayerEngine } from './engine';
import { isNearEnd, type PositionStore } from './position';
import { extendSleep, sleepIn, sleepRemainingS, sleepVolume, type SleepTimer } from './sleep';
import { parseTiming, sentenceIndexAt, type Sentence } from './timing';

export type PlayerState = {
  book: BookRow | null;
  /** Chapters known for the book (all of them online; the downloaded ones offline). */
  chapters: ChapterRow[];
  chapterN: number | null;
  /** `missing`: the chapter is in the library but its file is not on the phone. */
  load: 'idle' | 'loading' | 'ready' | 'missing';
  playing: boolean;
  position: number;
  duration: number;
  sentences: Sentence[];
  sentenceIndex: number;
  speed: number;
  sleep: SleepTimer | null;
  /** Real seconds until the sleep timer fires. */
  sleepLeftS: number | null;
  /** Shown as "Welcome back, rewound 10 s" with Undo. */
  rewound: { seconds: number; from: number } | null;
};

const IDLE: PlayerState = {
  book: null,
  chapters: [],
  chapterN: null,
  load: 'idle',
  playing: false,
  position: 0,
  duration: 0,
  sentences: [],
  sentenceIndex: -1,
  speed: 1,
  sleep: null,
  sleepLeftS: null,
  rewound: null,
};

/** Save the place at least this often (seconds of listening) while playing. */
export const SAVE_EVERY_S = 5;

export type PlayerDeps = {
  engine: PlayerEngine;
  files: FileStore;
  downloaded: DownloadStore;
  positions: PositionStore;
  settings: SettingsStore;
  now?: () => number;
  /** A chapter became the current one (the place to keep the next ones downloaded). */
  onChapter?: (book: BookRow, chapters: ChapterRow[], n: number) => void;
  /** Real seconds just listened (not scaled by speed), reported every ~10 s and on pause, for the listening stats. */
  onListened?: (bookId: string, seconds: number) => void;
  /** The last chapter of the book ended. */
  onBookFinished?: (bookId: string) => void;
};

export interface PlayerController {
  state: Store<PlayerState>;
  /** Opens a book at `n`, or at the saved place, or at its first chapter. */
  open(book: BookRow, chapters: ChapterRow[], n?: number, autoplay?: boolean): Promise<void>;
  play(): void;
  pause(): void;
  toggle(): void;
  seekTo(seconds: number): void;
  skip(seconds: number): void;
  skipBack(): void;
  skipForward(): void;
  seekToSentence(index: number): void;
  prevSentence(): void;
  nextSentence(): void;
  openChapter(n: number, autoplay?: boolean): Promise<void>;
  nextChapter(autoplay?: boolean): Promise<void>;
  setSpeed(speed: number, scope: 'book' | 'all'): void;
  setSleep(timer: { minutes: number } | 'chapter' | null): void;
  extendSleep(): void;
  undoRewind(): void;
  /** Writes the place now (call when the app goes to the background). */
  flush(): void;
  /** Stops and hides the player. */
  close(): void;
}

export function createPlayerController(deps: PlayerDeps): PlayerController {
  const { engine, files, downloaded, positions, settings } = deps;
  const now = deps.now ?? Date.now;
  const state = createStore<PlayerState>(IDLE);
  const set = (patch: Partial<PlayerState>) => state.set({ ...state.get(), ...patch });

  let lastActiveAt = now();
  let lastSavedPos = 0;
  let finishedMarked = false;
  let volume = 1;
  let listenedS = 0;
  let lastTickAt: number | null = null;
  // A newer open() makes an older one stop before it touches the engine.
  let opening = 0;

  const save = (position = state.get().position) => {
    const { book, chapterN } = state.get();
    if (book && chapterN !== null) {
      positions.save(book.id, chapterN, position, now());
      lastSavedPos = position;
    }
  };

  const flushListened = () => {
    const book = state.get().book;
    if (book && listenedS >= 1) deps.onListened?.(book.id, Math.round(listenedS));
    listenedS = 0;
  };

  const setVolume = (v: number) => {
    if (v !== volume) {
      volume = v;
      engine.setVolume(v);
    }
  };

  const chapterAfter = (n: number) =>
    state.get().chapters.filter((c) => c.n > n).sort((a, b) => a.n - b.n)[0];

  function finishChapter() {
    const { book, chapterN, sleep } = state.get();
    if (!book || chapterN === null || finishedMarked) return;
    finishedMarked = true;
    positions.markFinished(book.id, chapterN);
    positions.save(book.id, chapterN, 0, now());
    const finished = chapterN;
    if (sleep?.kind === 'chapter') set({ sleep: null, sleepLeftS: null });
    // An end-of-chapter sleep timer, or "Play next chapter" turned off, stops at the start of the next chapter.
    const stopHere = sleep?.kind === 'chapter' || !settings.getState().autoPlayNext;
    const next = chapterAfter(finished);
    flushListened();
    if (next) void api.openChapter(next.n, !stopHere);
    else {
      set({ playing: false });
      deps.onBookFinished?.(book.id);
    }
  }

  function onStatus(s: EngineStatus) {
    const cur = state.get();
    if (cur.load !== 'ready') return;
    const position = Math.min(s.position, s.duration || s.position);
    if (s.playing) {
      if (lastTickAt !== null) listenedS += Math.min(5, (now() - lastTickAt) / 1000);
      lastTickAt = now();
      if (listenedS >= 10) flushListened();
    } else lastTickAt = null;
    const patch: Partial<PlayerState> = { playing: s.playing, position, duration: s.duration || cur.duration, sentenceIndex: sentenceIndexAt(cur.sentences, position) };

    if (cur.sleep) {
      const left = sleepRemainingS(cur.sleep, now(), ((s.duration || cur.duration) - position) / cur.speed);
      patch.sleepLeftS = left;
      if (cur.sleep.kind === 'minutes' && left <= 0) {
        engine.pause();
        setVolume(1);
        Object.assign(patch, { sleep: null, sleepLeftS: null, playing: false });
        lastActiveAt = now();
      } else {
        setVolume(sleepVolume(left, true));
      }
    }
    set(patch);

    if (s.playing && Math.abs(position - lastSavedPos) >= SAVE_EVERY_S) save(position);
    if (s.ended || (s.playing && isNearEnd(position, s.duration))) {
      if (s.ended) finishChapter();
      else if (!finishedMarked && cur.book && cur.chapterN !== null) {
        // Tagged Finished as soon as it is within 5 s of the end; the chapter itself plays on to its end.
        finishedMarked = true;
        positions.markFinished(cur.book.id, cur.chapterN);
      }
    }
  }
  engine.subscribe(onStatus);

  async function loadChapter(book: BookRow, chapters: ChapterRow[], n: number, startAt: number, autoplay: boolean) {
    const ticket = ++opening;
    const row = chapters.find((c) => c.n === n);
    set({ book, chapters, chapterN: n, load: 'loading', playing: false, position: startAt, duration: row?.duration_s ?? 0, sentences: [], sentenceIndex: -1, rewound: null, speed: speedFor(settings.getState(), book.id) });
    finishedMarked = false;
    lastSavedPos = startAt;
    engine.pause();

    const have = downloaded.get(book.id, n);
    if (!have || !files.exists(audioPath(book.id, n))) {
      if (have) downloaded.removeChapter(book.id, n);
      engine.clear();
      set({ load: 'missing' });
      deps.onChapter?.(book, chapters, n);
      return;
    }
    let sentences: Sentence[] = [];
    try {
      sentences = parseTiming(JSON.parse(await files.readText(timingPath(book.id, n))));
    } catch {
      // no usable timing file: play without the read-along
    }
    await engine.load(files.uri(audioPath(book.id, n)), { title: have.title, artist: book.author ?? '', album: book.title });
    if (ticket !== opening) return;
    engine.setRate(state.get().speed);
    if (startAt > 0) await engine.seekTo(startAt);
    if (ticket !== opening) return;
    set({ load: 'ready', sentences, sentenceIndex: sentenceIndexAt(sentences, startAt) });
    deps.onChapter?.(book, chapters, n);
    save(startAt);
    if (autoplay) api.play();
  }

  const api: PlayerController = {
    state,
    async open(book, chapters, n, autoplay = false) {
      if (state.get().book) save();
      const known = chapters.length ? chapters : downloadedAsRows(downloaded, book.id);
      const saved = positions.get(book.id);
      let target = n ?? saved?.chapter ?? known[0]?.n;
      let startAt = n === undefined || n === saved?.chapter ? (saved?.positionS ?? 0) : 0;
      // A place within 5 s of the end means that chapter is done: start the next one.
      const row = known.find((c) => c.n === target);
      if (n === undefined && row && isNearEnd(startAt, row.duration_s)) {
        const next = known.filter((c) => c.n > row.n).sort((a, b) => a.n - b.n)[0];
        if (next) [target, startAt] = [next.n, 0];
      }
      if (target === undefined) return;
      lastActiveAt = n === undefined || n === saved?.chapter ? (saved?.updatedAt ?? now()) : now();
      await loadChapter(book, known, target, startAt, autoplay);
    },
    play() {
      const cur = state.get();
      if (cur.load !== 'ready' || cur.playing) return;
      if (cur.sleep?.kind === 'minutes' && now() >= cur.sleep.endsAt) set({ sleep: null, sleepLeftS: null });
      const back = Math.min(cur.position, smartRewindS(now() - lastActiveAt, settings.getState().smartRewindS));
      if (back > 0) {
        const to = cur.position - back;
        void engine.seekTo(to);
        set({ position: to, sentenceIndex: sentenceIndexAt(cur.sentences, to), rewound: { seconds: back, from: cur.position } });
      } else if (cur.rewound) {
        set({ rewound: null });
      }
      setVolume(1);
      engine.play();
      set({ playing: true });
    },
    pause() {
      if (state.get().load !== 'ready') return;
      engine.pause();
      lastActiveAt = now();
      set({ playing: false });
      flushListened();
      save();
    },
    toggle() {
      if (state.get().playing) api.pause();
      else api.play();
    },
    seekTo(seconds) {
      const { duration, sentences, load } = state.get();
      if (load !== 'ready') return;
      const to = Math.max(0, duration > 0 ? Math.min(seconds, duration) : seconds);
      void engine.seekTo(to);
      set({ position: to, sentenceIndex: sentenceIndexAt(sentences, to), rewound: null });
    },
    skip: (seconds) => api.seekTo(state.get().position + seconds),
    skipBack: () => api.skip(-settings.getState().skipBackS),
    skipForward: () => api.skip(settings.getState().skipForwardS),
    seekToSentence(index) {
      const s = state.get().sentences[index];
      if (s) api.seekTo(s.s);
    },
    prevSentence() {
      const { sentences, position, sentenceIndex } = state.get();
      // Within the first 2 s of a sentence, go to the one before; otherwise replay this one.
      const cur = sentences[sentenceIndex];
      api.seekToSentence(cur && position - cur.s > 2 ? sentenceIndex : Math.max(0, sentenceIndex - 1));
    },
    nextSentence() {
      api.seekToSentence(Math.min(state.get().sentences.length - 1, state.get().sentenceIndex + 1));
    },
    async openChapter(n, autoplay = true) {
      const { book, chapters } = state.get();
      if (!book) return;
      save();
      lastActiveAt = now();
      await loadChapter(book, chapters, n, 0, autoplay);
    },
    async nextChapter(autoplay = true) {
      const n = state.get().chapterN;
      const next = n === null ? undefined : chapterAfter(n);
      if (next) await api.openChapter(next.n, autoplay);
    },
    setSpeed(speed, scope) {
      const { book } = state.get();
      if (scope === 'book' && book) settings.setBookSpeed(book.id, speed);
      else {
        // "All books" changes the default and drops this book's own override so the change is heard now.
        if (book) settings.setBookSpeed(book.id, null);
        settings.update({ speed });
      }
      const applied = book ? speedFor(settings.getState(), book.id) : clampSpeed(speed);
      engine.setRate(applied);
      set({ speed: applied });
    },
    setSleep(timer) {
      setVolume(1);
      set({ sleep: timer === null ? null : timer === 'chapter' ? { kind: 'chapter' } : sleepIn(timer.minutes, now()), sleepLeftS: null });
    },
    extendSleep() {
      const { sleep } = state.get();
      if (sleep) set({ sleep: extendSleep(sleep, now()) });
      setVolume(1);
    },
    undoRewind() {
      const r = state.get().rewound;
      if (r) api.seekTo(r.from);
    },
    flush() {
      flushListened();
      save();
    },
    close() {
      flushListened();
      if (state.get().book) save();
      opening++;
      engine.pause();
      engine.clear();
      setVolume(1);
      state.set(IDLE);
    },
  };
  return api;
}
