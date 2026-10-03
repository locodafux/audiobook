import type { KeyValueStore } from '../data/offlineList';
import { createStore, type Store } from '../store';

/** Where the listener is in a book. Phone-only (tech plan section 3). */
export type BookPosition = {
  chapter: number;
  /** Seconds into the chapter. */
  positionS: number;
  /** Epoch ms of the last save; also when playback last paused, for smart rewind after a restart. */
  updatedAt: number;
  finished: number[];
};

export const POSITIONS_KEY = 'hearthread.positions.v1';
/** A chapter counts as finished when playback gets within this many seconds of its end (same rule as the old app). */
export const FINISHED_WITHIN_S = 5;

export const isNearEnd = (positionS: number, durationS: number) => durationS > 0 && durationS - positionS <= FINISHED_WITHIN_S;

export interface PositionStore {
  state: Store<Record<string, BookPosition>>;
  load(): Promise<void>;
  get(bookId: string): BookPosition | undefined;
  save(bookId: string, chapter: number, positionS: number, now: number): void;
  markFinished(bookId: string, chapter: number): void;
  isFinished(bookId: string, chapter: number): boolean;
  /** The book listened to most recently, for the Continue card. */
  latest(): { bookId: string; position: BookPosition } | undefined;
}

export function createPositionStore(kv: KeyValueStore): PositionStore {
  const state = createStore<Record<string, BookPosition>>({});
  const commit = (next: Record<string, BookPosition>) => {
    state.set(next);
    void kv.setItem(POSITIONS_KEY, JSON.stringify(next)).catch(() => {});
  };
  const get = (bookId: string) => state.get()[bookId];
  return {
    state,
    async load() {
      try {
        const raw = await kv.getItem(POSITIONS_KEY);
        const parsed: unknown = raw ? JSON.parse(raw) : null;
        if (typeof parsed !== 'object' || parsed === null) return;
        const clean: Record<string, BookPosition> = {};
        for (const [id, p] of Object.entries(parsed as Record<string, Partial<BookPosition>>)) {
          if (typeof p?.chapter === 'number' && typeof p.positionS === 'number' && typeof p.updatedAt === 'number') {
            clean[id] = { chapter: p.chapter, positionS: p.positionS, updatedAt: p.updatedAt, finished: Array.isArray(p.finished) ? p.finished.filter((n) => typeof n === 'number') : [] };
          }
        }
        state.set(clean);
      } catch {
        // unreadable copy: start fresh
      }
    },
    get,
    save(bookId, chapter, positionS, now) {
      commit({ ...state.get(), [bookId]: { finished: [], ...get(bookId), chapter, positionS: Math.max(0, positionS), updatedAt: now } });
    },
    markFinished(bookId, chapter) {
      const cur = get(bookId);
      if (cur?.finished.includes(chapter)) return;
      commit({ ...state.get(), [bookId]: { chapter, positionS: 0, updatedAt: Date.now(), ...cur, finished: [...(cur?.finished ?? []), chapter] } });
    },
    isFinished: (bookId, chapter) => !!get(bookId)?.finished.includes(chapter),
    latest() {
      let best: { bookId: string; position: BookPosition } | undefined;
      for (const [bookId, position] of Object.entries(state.get())) {
        if (!best || position.updatedAt > best.position.updatedAt) best = { bookId, position };
      }
      return best;
    },
  };
}
