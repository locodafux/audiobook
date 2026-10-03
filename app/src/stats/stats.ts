import type { KeyValueStore } from '../data/offlineList';
import { createPersisted } from '../phone/persisted';

export const STATS_KEY = 'hearthread.stats.v1';

/** Seconds listened on one local calendar day, in total and per book. */
type Day = { s: number; books: Record<string, number> };

/**
 * ponytail: one small record per day that had any listening (~100 bytes), kept forever;
 * roll old days into a total if it ever grows past a few years of daily use.
 */
export type StatsState = {
  /** Keyed by local date, "2026-10-04". */
  days: Record<string, Day>;
  /** Ids of books listened to the end. */
  finished: string[];
};

export const EMPTY_STATS: StatsState = { days: {}, finished: [] };

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

export function sanitizeStats(raw: unknown): StatsState {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as { days?: unknown; finished?: unknown };
  const days: Record<string, Day> = {};
  for (const [key, d] of Object.entries(typeof r.days === 'object' && r.days !== null ? r.days : {})) {
    const day = d as { s?: unknown; books?: unknown } | null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !day || !isNum(day.s)) continue;
    const books = Object.fromEntries(
      Object.entries(typeof day.books === 'object' && day.books !== null ? day.books : {}).filter(([, v]) => isNum(v)),
    ) as Record<string, number>;
    days[key] = { s: day.s, books };
  }
  return { days, finished: Array.isArray(r.finished) ? [...new Set(r.finished.filter((x) => typeof x === 'string'))] : [] };
}

/** "2026-10-04" in the phone's own time zone, so a listening day ends at the listener's midnight. */
export const dayKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const daysAgo = (from: Date, n: number) => new Date(from.getFullYear(), from.getMonth(), from.getDate() - n);

/** Adds `seconds` of listening to a book on the day of `at`. Zero, negative or non-numeric amounts change nothing. */
export function addListening(state: StatsState, bookId: string, seconds: number, at: Date): StatsState {
  if (!isNum(seconds) || seconds === 0) return state;
  const key = dayKey(at);
  const day = state.days[key] ?? { s: 0, books: {} };
  return {
    ...state,
    days: { ...state.days, [key]: { s: day.s + seconds, books: { ...day.books, [bookId]: (day.books[bookId] ?? 0) + seconds } } },
  };
}

export type StatsSummary = {
  todayS: number;
  weekS: number;
  /** Seconds for Monday..Sunday of the current week; days still to come are 0. */
  weekBars: number[];
  /** Days in a row with listening, up to today; a quiet today does not break yesterday's streak. */
  streakDays: number;
  allTimeS: number;
  booksFinished: number;
  /** Most listened first. */
  byBook: { bookId: string; seconds: number }[];
};

export function summarize(state: StatsState, now: Date): StatsSummary {
  const at = (d: Date) => state.days[dayKey(d)]?.s ?? 0;
  const mondayOffset = (now.getDay() + 6) % 7;
  const weekBars = Array.from({ length: 7 }, (_, i) => (i > mondayOffset ? 0 : at(daysAgo(now, mondayOffset - i))));

  let streakDays = 0;
  for (let back = at(now) > 0 ? 0 : 1; at(daysAgo(now, back)) > 0; back++) streakDays++;

  const perBook: Record<string, number> = {};
  let allTimeS = 0;
  for (const day of Object.values(state.days)) {
    allTimeS += day.s;
    for (const [id, s] of Object.entries(day.books)) perBook[id] = (perBook[id] ?? 0) + s;
  }
  return {
    todayS: at(now),
    weekS: weekBars.reduce((a, b) => a + b, 0),
    weekBars,
    streakDays,
    allTimeS,
    booksFinished: state.finished.length,
    byBook: Object.entries(perBook)
      .map(([bookId, seconds]) => ({ bookId, seconds }))
      .sort((a, b) => b.seconds - a.seconds),
  };
}

/** "4h 12m", "38m", "0m". Unlike `formatDuration`, a zero shows as "0m" so a stat is never blank. */
export function formatListened(seconds: number): string {
  const total = Math.round(seconds / 60);
  const h = Math.floor(total / 60);
  return h ? `${h}h ${total % 60}m` : `${total}m`;
}

/**
 * The listening log. The player calls `record(bookId, seconds)` with the real time it just
 * played (not scaled by speed), e.g. every 10 s while playing, and `markFinished` at the end of a book.
 */
export function createStatsStore(kv: KeyValueStore, now: () => Date = () => new Date()) {
  const store = createPersisted(kv, STATS_KEY, EMPTY_STATS, sanitizeStats);
  return {
    ...store,
    record: (bookId: string, seconds: number) => store.set((s) => addListening(s, bookId, seconds, now())),
    markFinished: (bookId: string) =>
      store.set((s) => (s.finished.includes(bookId) ? s : { ...s, finished: [...s.finished, bookId] })),
    clear: () => store.set(() => EMPTY_STATS),
  };
}
export type StatsStore = ReturnType<typeof createStatsStore>;
