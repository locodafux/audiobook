export type EngineStatus = {
  /** Seconds into the chapter file. */
  position: number;
  /** 0 until the file is loaded. */
  duration: number;
  playing: boolean;
  /** True once, when the file plays to its end. */
  ended: boolean;
};

export type TrackInfo = { title: string; artist: string; album: string };

/** The audio player, as the controller needs it. The real one wraps expo-audio; tests use a fake. */
export interface PlayerEngine {
  load(uri: string, track: TrackInfo): Promise<void>;
  play(): void;
  pause(): void;
  seekTo(seconds: number): Promise<void>;
  setRate(rate: number): void;
  /** 0..1 */
  setVolume(volume: number): void;
  subscribe(listener: (status: EngineStatus) => void): () => void;
  /** Stops playback and removes the notification and lock-screen card. */
  clear(): void;
}
