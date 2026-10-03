import { memoryStore } from '../phone/memoryStore';
import {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  clampSpeed,
  createSettingsStore,
  sanitizeSettings,
  smartRewindS,
  speedFor,
} from './settings';

describe('settings', () => {
  it('starts with the plan defaults', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({ speed: 1, skipBackS: 15, skipForwardS: 30, wifiOnly: true, theme: 'dark', accent: 'jade' });
  });

  it('snaps speed to 0.05 steps inside 0.5-3', () => {
    expect(clampSpeed(1.27)).toBe(1.25);
    expect(clampSpeed(1.1)).toBe(1.1);
    expect(clampSpeed(0.1)).toBe(0.5);
    expect(clampSpeed(9)).toBe(3);
  });

  it('repairs a bad saved copy field by field', () => {
    const s = sanitizeSettings({ speed: 'fast', skipBackS: 7, wifiOnly: 'yes', theme: 'neon', keepNextN: 5, bookSpeeds: { a: 2.02, b: 'x' } });
    expect(s).toMatchObject({ speed: 1, skipBackS: 15, wifiOnly: true, theme: 'dark', keepNextN: 5 });
    expect(s.bookSpeeds).toEqual({ a: 2 });
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings([1, 2])).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps every value valid on update and saves it', async () => {
    const kv = memoryStore();
    const store = createSettingsStore(kv);
    store.update({ speed: 1.37, skipBackS: 99, wifiOnly: false });
    expect(store.getState()).toMatchObject({ speed: 1.35, skipBackS: 15, wifiOnly: false });
    await new Promise((r) => setTimeout(r, 0));
    expect(JSON.parse(kv.data[SETTINGS_KEY]!)).toMatchObject({ speed: 1.35, wifiOnly: false });
  });

  it('loads what was saved, and tells subscribers', async () => {
    const kv = memoryStore({ [SETTINGS_KEY]: JSON.stringify({ speed: 1.5, keepNextN: 3 }) });
    const store = createSettingsStore(kv);
    const seen = jest.fn();
    store.subscribe(seen);
    await store.load();
    expect(store.getState()).toMatchObject({ speed: 1.5, keepNextN: 3, wifiOnly: true });
    expect(seen).toHaveBeenCalled();
  });

  it('keeps a change made before the saved copy arrived', async () => {
    const kv = memoryStore({ [SETTINGS_KEY]: JSON.stringify({ speed: 1.5 }) });
    const store = createSettingsStore(kv);
    store.update({ wifiOnly: false });
    await store.load();
    expect(store.getState()).toMatchObject({ speed: 1, wifiOnly: false });
  });

  it('keeps defaults when the saved copy is unreadable', async () => {
    const store = createSettingsStore(memoryStore({ [SETTINGS_KEY]: '{oops' }));
    await store.load();
    expect(store.getState()).toEqual(DEFAULT_SETTINGS);
  });

  it('gives a book its own speed, or the default', () => {
    const store = createSettingsStore(memoryStore());
    store.update({ speed: 1.25 });
    store.setBookSpeed('shadow', 1.8);
    expect(speedFor(store.getState(), 'shadow')).toBe(1.8);
    expect(speedFor(store.getState(), 'other')).toBe(1.25);
    store.setBookSpeed('shadow', null);
    expect(speedFor(store.getState(), 'shadow')).toBe(1.25);
  });

  it('survives a failing disk', async () => {
    const store = createSettingsStore({ getItem: async () => null, setItem: async () => Promise.reject(new Error('full')) });
    store.update({ speed: 2 });
    await new Promise((r) => setTimeout(r, 0));
    expect(store.getState().speed).toBe(2);
  });
});

describe('smart rewind', () => {
  it.each([
    [10_000, 0],
    [60_000, 3],
    [20 * 60_000, 7],
    [3 * 3600_000, 10],
  ])('after %i ms paused rewinds %i s', (paused, expected) => {
    expect(smartRewindS(paused, 10)).toBe(expected);
  });
  it('is off when the maximum is 0', () => expect(smartRewindS(3600_000 * 5, 0)).toBe(0));
});
