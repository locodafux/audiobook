/**
 * Smart rewind: after a pause, resume a little earlier so the listener does not lose the thread.
 * Under a minute: none. Up to ten minutes: half of the setting. Longer: the full setting.
 * `maxS` is the setting (0 = off).
 */
export function smartRewindS(pausedMs: number, maxS: number): number {
  if (maxS <= 0 || pausedMs < 60_000) return 0;
  return pausedMs < 10 * 60_000 ? Math.round(maxS / 2) : maxS;
}
