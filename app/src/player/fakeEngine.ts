import type { EngineStatus, PlayerEngine, TrackInfo } from './engine';

/** A scripted player for tests: `tick` plays `seconds` of audio and reports it like the real one does. */
export function fakeEngine(duration = 600) {
  let listener: ((s: EngineStatus) => void) | null = null;
  const e = {
    uri: null as string | null,
    track: null as TrackInfo | null,
    position: 0,
    playing: false,
    rate: 1,
    volume: 1,
    duration,
    cleared: 0,
    seeks: [] as number[],
    status(extra: Partial<EngineStatus> = {}): EngineStatus {
      return { position: e.position, duration: e.duration, playing: e.playing, ended: false, ...extra };
    },
    emit(extra: Partial<EngineStatus> = {}) {
      listener?.(e.status(extra));
    },
    tick(seconds: number) {
      e.position = Math.min(e.duration, e.position + seconds * e.rate);
      e.emit();
    },
    async load(uri: string, track: TrackInfo) {
      e.uri = uri;
      e.track = track;
      e.position = 0;
      e.playing = false;
    },
    play: () => void (e.playing = true),
    pause: () => void (e.playing = false),
    async seekTo(s: number) {
      e.position = s;
      e.seeks.push(s);
    },
    setRate: (r: number) => void (e.rate = r),
    setVolume: (v: number) => void (e.volume = v),
    subscribe(l: (s: EngineStatus) => void) {
      listener = l;
      return () => void (listener = null);
    },
    clear: () => void (e.cleared += 1),
  } satisfies PlayerEngine & Record<string, unknown>;
  return e;
}
