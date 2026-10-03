import type { KeyValueStore } from '../data/offlineList';
import { createPersisted } from '../phone/persisted';

export const SETTINGS_KEY = 'hearthread.settings.v1';

export const THEMES = ['system', 'light', 'dark', 'black'] as const;
export const ACCENTS = ['jade', 'indigo', 'amber', 'rose'] as const;
export const TEXT_SIZES = ['small', 'medium', 'large'] as const;

/** The choices each picker offers; stored values outside them fall back to the default. */
export const OPTIONS = {
  skipBackS: [5, 10, 15, 30, 45, 60],
  skipForwardS: [10, 15, 30, 45, 60, 90],
  /** 0 = off */
  smartRewindS: [0, 5, 10, 15, 20, 30],
  sleepDefaultMin: [0, 15, 30, 45, 60, 90],
  keepNextN: [0, 1, 3, 5, 10],
  autoCleanDays: [0, 1, 3, 7, 14, 30],
} as const;

export const SPEED_MIN = 0.5;
export const SPEED_MAX = 3;
export const SPEED_STEP = 0.05;

/** Everything the plan lists under "Settings" (phone only). A 0 in a choice list means off. */
export type Settings = {
  /** Default narration speed for every book (1 = normal). */
  speed: number;
  /** Per-book overrides of `speed`, by book id. */
  bookSpeeds: Record<string, number>;
  skipBackS: number;
  skipForwardS: number;
  /** Pre-selected duration in the sleep timer sheet; 0 = none. */
  sleepDefaultMin: number;
  /** Longest rewind on resume after a pause; 0 = off. */
  smartRewindS: number;
  autoPlayNext: boolean;
  wifiOnly: boolean;
  /** Keep this many chapters ahead downloaded; 0 = off. */
  keepNextN: number;
  /** Delete a finished chapter after this many days; 0 = off. */
  autoCleanDays: number;
  theme: (typeof THEMES)[number];
  accent: (typeof ACCENTS)[number];
  textSize: (typeof TEXT_SIZES)[number];
  /** Read-along text scrolls with the voice. */
  follow: boolean;
};

// Auto-download and auto-delete start off: they spend data or remove files, so the listener opts in.
export const DEFAULT_SETTINGS: Settings = {
  speed: 1,
  bookSpeeds: {},
  skipBackS: 15,
  skipForwardS: 30,
  sleepDefaultMin: 30,
  smartRewindS: 10,
  autoPlayNext: true,
  wifiOnly: true,
  keepNextN: 0,
  autoCleanDays: 0,
  theme: 'dark',
  accent: 'jade',
  textSize: 'medium',
  follow: true,
};

/** Snaps to the 0.05 grid inside 0.5-3 (rounded to 2 decimals so 1.1 stays 1.1). */
export function clampSpeed(v: number): number {
  const snapped = Math.round(v / SPEED_STEP) * SPEED_STEP;
  return Math.round(Math.min(SPEED_MAX, Math.max(SPEED_MIN, snapped)) * 100) / 100;
}

const speedOr = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? clampSpeed(v) : fallback);
const oneOf = <T>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);
const flag = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);

/** Turns anything (an old save, a hand-edited value, garbage) into valid settings. */
export function sanitizeSettings(raw: unknown): Settings {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  const overrides = typeof r.bookSpeeds === 'object' && r.bookSpeeds !== null ? Object.entries(r.bookSpeeds) : [];
  return {
    speed: speedOr(r.speed, d.speed),
    bookSpeeds: Object.fromEntries(
      overrides.filter(([, v]) => typeof v === 'number' && Number.isFinite(v)).map(([id, v]) => [id, clampSpeed(v as number)]),
    ),
    skipBackS: oneOf(r.skipBackS, OPTIONS.skipBackS, d.skipBackS),
    skipForwardS: oneOf(r.skipForwardS, OPTIONS.skipForwardS, d.skipForwardS),
    sleepDefaultMin: oneOf(r.sleepDefaultMin, OPTIONS.sleepDefaultMin, d.sleepDefaultMin),
    smartRewindS: oneOf(r.smartRewindS, OPTIONS.smartRewindS, d.smartRewindS),
    autoPlayNext: flag(r.autoPlayNext, d.autoPlayNext),
    wifiOnly: flag(r.wifiOnly, d.wifiOnly),
    keepNextN: oneOf(r.keepNextN, OPTIONS.keepNextN, d.keepNextN),
    autoCleanDays: oneOf(r.autoCleanDays, OPTIONS.autoCleanDays, d.autoCleanDays),
    theme: oneOf(r.theme, THEMES, d.theme),
    accent: oneOf(r.accent, ACCENTS, d.accent),
    textSize: oneOf(r.textSize, TEXT_SIZES, d.textSize),
    follow: flag(r.follow, d.follow),
  };
}

/** The speed to play a book at: its own override, else the default. */
export const speedFor = (s: Settings, bookId: string): number => s.bookSpeeds[bookId] ?? s.speed;

/**
 * How far to rewind when playback resumes after `pausedMs`: none for a short pause,
 * a third of the maximum after 30 s, two thirds after 5 min, the maximum after an hour.
 */
export function smartRewindS(pausedMs: number, maxS: number): number {
  if (pausedMs < 30_000) return 0;
  if (pausedMs < 5 * 60_000) return Math.round(maxS / 3);
  if (pausedMs < 60 * 60_000) return Math.round((maxS * 2) / 3);
  return maxS;
}

/**
 * The settings store. The player reads `getState()` (or `speedFor`) and `subscribe`s to changes;
 * screens change it only through `update` and `setBookSpeed`, which keep every value valid.
 */
export function createSettingsStore(kv: KeyValueStore) {
  const store = createPersisted(kv, SETTINGS_KEY, DEFAULT_SETTINGS, sanitizeSettings);
  return {
    ...store,
    update: (patch: Partial<Settings>) => store.set((s) => sanitizeSettings({ ...s, ...patch })),
    /** `null` removes the override. */
    setBookSpeed: (bookId: string, speed: number | null) =>
      store.set((s) => {
        const { [bookId]: _old, ...rest } = s.bookSpeeds;
        return { ...s, bookSpeeds: speed === null ? rest : { ...rest, [bookId]: clampSpeed(speed) } };
      }),
  };
}
export type SettingsStore = ReturnType<typeof createSettingsStore>;
