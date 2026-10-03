import { memoryStore } from '../phone/memoryStore';
import { EMPTY_STATS, addListening, createStatsStore, dayKey, formatListened, sanitizeStats, summarize, type StatsState } from './stats';

// Local-time dates (month is 0-based): Sunday 4 Oct 2026 is the last day of that Mon-Sun week.
const sun = new Date(2026, 9, 4, 20, 0);
const day = (offset: number, hour = 12) => new Date(2026, 9, 4 + offset, hour);

function listened(entries: [number, string, number][]): StatsState {
  return entries.reduce((s, [offset, book, secs]) => addListening(s, book, secs, day(offset)), EMPTY_STATS);
}

describe('stats', () => {
  it('adds up today, the week and all time', () => {
    const s = listened([[0, 'a', 600], [0, 'b', 300], [-2, 'a', 3600], [-10, 'a', 1000]]);
    const sum = summarize(s, sun);
    expect(sum.todayS).toBe(900);
    expect(sum.weekS).toBe(900 + 3600);
    expect(sum.allTimeS).toBe(5500);
    expect(sum.weekBars).toEqual([0, 0, 0, 0, 3600, 0, 900]);
    expect(sum.byBook).toEqual([{ bookId: 'a', seconds: 5200 }, { bookId: 'b', seconds: 300 }]);
  });

  it('starts the week on Monday and leaves days still to come at 0', () => {
    const wed = new Date(2026, 9, 7, 9);
    const s = addListening(addListening(EMPTY_STATS, 'a', 60, new Date(2026, 9, 5, 9)), 'a', 120, wed);
    expect(summarize(s, wed).weekBars).toEqual([60, 0, 120, 0, 0, 0, 0]);
    expect(summarize(s, new Date(2026, 9, 6)).weekS).toBe(60);
  });

  it('counts a streak of consecutive days', () => {
    expect(summarize(listened([[0, 'a', 60], [-1, 'a', 60], [-2, 'a', 60], [-4, 'a', 60]]), sun).streakDays).toBe(3);
  });

  it('keeps yesterday\'s streak alive until today is over', () => {
    expect(summarize(listened([[-1, 'a', 60], [-2, 'a', 60]]), sun).streakDays).toBe(2);
    expect(summarize(listened([[-2, 'a', 60]]), sun).streakDays).toBe(0);
    expect(summarize(EMPTY_STATS, sun).streakDays).toBe(0);
  });

  it('counts streaks across a month boundary', () => {
    const now = new Date(2026, 10, 1, 8);
    const s = [new Date(2026, 9, 30), new Date(2026, 9, 31), now].reduce((acc, d) => addListening(acc, 'a', 30, d), EMPTY_STATS);
    expect(summarize(s, now).streakDays).toBe(3);
  });

  it('ignores zero, negative and non-numeric listening', () => {
    for (const bad of [0, -5, NaN, Infinity]) expect(addListening(EMPTY_STATS, 'a', bad, sun)).toBe(EMPTY_STATS);
  });

  it('records through the store, counts finished books once, and clears', async () => {
    const kv = memoryStore();
    const store = createStatsStore(kv, () => sun);
    store.record('a', 120);
    store.record('a', 30);
    store.markFinished('a');
    store.markFinished('a');
    expect(summarize(store.getState(), sun)).toMatchObject({ todayS: 150, booksFinished: 1 });
    await new Promise((r) => setTimeout(r, 0));
    const reloaded = createStatsStore(kv, () => sun);
    await reloaded.load();
    expect(reloaded.getState()).toEqual(store.getState());
    store.clear();
    expect(store.getState()).toEqual(EMPTY_STATS);
  });

  it('repairs a bad saved copy', () => {
    const s = sanitizeStats({ days: { '2026-10-04': { s: 60, books: { a: 60, b: 'x' } }, nonsense: { s: 5 }, '2026-10-03': { s: -1 } }, finished: ['a', 'a', 7] });
    expect(s).toEqual({ days: { '2026-10-04': { s: 60, books: { a: 60 } } }, finished: ['a'] });
    expect(sanitizeStats(undefined)).toEqual(EMPTY_STATS);
  });

  it('formats keys and durations', () => {
    expect(dayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(formatListened(4 * 3600 + 12 * 60)).toBe('4h 12m');
    expect(formatListened(0)).toBe('0m');
    expect(formatListened(38 * 60)).toBe('38m');
  });
});
