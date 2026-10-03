import type { KeyValueStore } from '../data/offlineList';
import { createStore, type Store } from '../store';

/**
 * Phone-only settings the player and downloads read (tech plan section 3).
 * The Settings screen (phase 6) edits these through `update`; nothing here is in memory only,
 * so the default speed survives a restart (the old app reset to 1x on every launch).
 */
export type Prefs = {
  defaultSpeed: number;
  /** Per-book override of `defaultSpeed`, by book id. */
  bookSpeed: Record<string, number>;
  skipBackS: number;
  skipForwardS: number;
  /** Seconds rewound after a long pause; 0 turns smart rewind off. */
  smartRewindS: number;
  sleepFadeOut: boolean;
  wifiOnly: boolean;
  /** Keep this many chapters after the current one downloaded; 0 turns it off. */
  keepNext: number;
  autoClean: boolean;
  textSize: number;
  followText: boolean;
};

export const DEFAULT_PREFS: Prefs = {
  defaultSpeed: 1,
  bookSpeed: {},
  skipBackS: 15,
  skipForwardS: 30,
  smartRewindS: 10,
  sleepFadeOut: true,
  wifiOnly: true,
  keepNext: 3,
  autoClean: false,
  textSize: 18,
  followText: true,
};

export const PREFS_KEY = 'hearthread.prefs.v1';
export const MIN_SPEED = 0.5;
export const MAX_SPEED = 3;

/** Speeds move in 0.05 steps between 0.5x and 3x. */
export const clampSpeed = (v: number): number =>
  Number.isFinite(v) ? Math.round(Math.min(MAX_SPEED, Math.max(MIN_SPEED, v)) * 20) / 20 : 1;

const num = (v: unknown, fallback: number, min: number, max: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);

/** Keeps only valid values from whatever was saved, so a bad or older copy cannot break playback. */
export function sanitizePrefs(raw: unknown): Prefs {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_PREFS;
  const bookSpeed: Record<string, number> = {};
  if (typeof r.bookSpeed === 'object' && r.bookSpeed !== null) {
    for (const [id, v] of Object.entries(r.bookSpeed)) if (typeof v === 'number') bookSpeed[id] = clampSpeed(v);
  }
  return {
    defaultSpeed: clampSpeed(num(r.defaultSpeed, d.defaultSpeed, MIN_SPEED, MAX_SPEED)),
    bookSpeed,
    skipBackS: num(r.skipBackS, d.skipBackS, 5, 120),
    skipForwardS: num(r.skipForwardS, d.skipForwardS, 5, 120),
    smartRewindS: num(r.smartRewindS, d.smartRewindS, 0, 60),
    sleepFadeOut: bool(r.sleepFadeOut, d.sleepFadeOut),
    wifiOnly: bool(r.wifiOnly, d.wifiOnly),
    keepNext: Math.round(num(r.keepNext, d.keepNext, 0, 20)),
    autoClean: bool(r.autoClean, d.autoClean),
    textSize: num(r.textSize, d.textSize, 14, 30),
    followText: bool(r.followText, d.followText),
  };
}

export interface PrefsStore {
  state: Store<Prefs>;
  /** Reads the saved copy; call once at start. */
  load(): Promise<void>;
  update(patch: Partial<Omit<Prefs, 'bookSpeed'>>): void;
  /** `null` removes the override. */
  setBookSpeed(bookId: string, speed: number | null): void;
  speedFor(bookId: string): number;
}

export function createPrefsStore(kv: KeyValueStore): PrefsStore {
  const state = createStore<Prefs>(DEFAULT_PREFS);
  const commit = (next: Prefs) => {
    state.set(next);
    void kv.setItem(PREFS_KEY, JSON.stringify(next)).catch(() => {});
  };
  return {
    state,
    async load() {
      try {
        const raw = await kv.getItem(PREFS_KEY);
        if (raw) state.set(sanitizePrefs(JSON.parse(raw)));
      } catch {
        // unreadable copy: keep defaults
      }
    },
    update: (patch) => commit(sanitizePrefs({ ...state.get(), ...patch })),
    setBookSpeed(bookId, speed) {
      const { [bookId]: _old, ...rest } = state.get().bookSpeed;
      commit(sanitizePrefs({ ...state.get(), bookSpeed: speed === null ? rest : { ...rest, [bookId]: speed } }));
    },
    speedFor: (bookId) => state.get().bookSpeed[bookId] ?? state.get().defaultSpeed,
  };
}
