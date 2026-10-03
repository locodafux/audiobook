import { createAudioPlayer, requestNotificationPermissionsAsync, setAudioModeAsync, type AudioStatus } from 'expo-audio';

import type { EngineStatus, PlayerEngine, TrackInfo } from './engine';

/**
 * The real player: expo-audio with background playback and the notification / lock-screen card.
 * ponytail: the card's seek buttons use the platform's default step, expo-audio cannot set 15/30 s there;
 * switch to react-native-track-player only if that matters.
 */
export function createExpoEngine(): PlayerEngine {
  void setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'doNotMix', allowsRecording: false, shouldRouteThroughEarpiece: false }).catch(() => {});
  const player = createAudioPlayer(null, { updateInterval: 250 });
  const listeners = new Set<(s: EngineStatus) => void>();
  let asked = false;
  let finishedSent = false;

  player.addListener('playbackStatusUpdate', (s: AudioStatus) => {
    const ended = s.didJustFinish && !finishedSent;
    if (s.didJustFinish) finishedSent = true;
    else if (s.playing) finishedSent = false;
    const status: EngineStatus = { position: s.currentTime, duration: s.duration, playing: s.playing, ended };
    listeners.forEach((l) => l(status));
  });

  return {
    async load(uri: string, track: TrackInfo) {
      if (!asked) {
        asked = true;
        // Android 13+ needs this for the playback notification; playing works either way.
        void requestNotificationPermissionsAsync().catch(() => {});
      }
      finishedSent = false;
      player.replace({ uri });
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => (sub.remove(), reject(new Error('The chapter file did not load'))), 10_000);
        const sub = player.addListener('playbackStatusUpdate', (s: AudioStatus) => {
          if (s.isLoaded || s.error) {
            clearTimeout(timer);
            sub.remove();
            return s.error ? reject(new Error(s.error)) : resolve();
          }
        });
        if (player.isLoaded) {
          clearTimeout(timer);
          sub.remove();
          resolve();
        }
      });
      player.setActiveForLockScreen(true, { title: track.title, artist: track.artist, albumTitle: track.album }, { showSeekBackward: true, showSeekForward: true });
    },
    play: () => player.play(),
    pause: () => player.pause(),
    seekTo: (seconds) => player.seekTo(seconds),
    setRate: (rate) => player.setPlaybackRate(rate, 'high'),
    setVolume: (volume) => {
      player.volume = volume;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    clear() {
      player.pause();
      player.clearLockScreenControls();
    },
  };
}
