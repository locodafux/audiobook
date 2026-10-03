export type SleepTimer = { kind: 'minutes'; endsAt: number } | { kind: 'chapter' };

export const FADE_S = 30;
export const EXTEND_MIN = 10;

export const sleepIn = (minutes: number, now: number): SleepTimer => ({ kind: 'minutes', endsAt: now + minutes * 60_000 });

/** Seconds of real time until the timer fires; `chapterLeftS` is real seconds left in the chapter (audio left / speed). */
export function sleepRemainingS(timer: SleepTimer, now: number, chapterLeftS: number): number {
  return timer.kind === 'chapter' ? chapterLeftS : Math.max(0, (timer.endsAt - now) / 1000);
}

/** Volume (0..1): full until the last 30 seconds, then easing to silence so the voice does not cut off. */
export function sleepVolume(remainingS: number, fadeOut: boolean): number {
  if (!fadeOut || remainingS >= FADE_S) return 1;
  return Math.max(0, remainingS / FADE_S);
}

/** "Still awake?" extends by 10 minutes; an end-of-chapter timer becomes a 10-minute one. */
export const extendSleep = (timer: SleepTimer, now: number): SleepTimer =>
  sleepIn(EXTEND_MIN + (timer.kind === 'minutes' ? Math.max(0, (timer.endsAt - now) / 60_000) : 0), now);
