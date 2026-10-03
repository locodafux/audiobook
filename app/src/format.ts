/** "14h 54m", "42m", "" for zero. */
export function formatDuration(seconds: number): string {
  const total = Math.round(seconds / 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return m === 0 ? '' : `${m}m`;
  return `${h}h ${m}m`;
}

export const formatBytes = (bytes: number): string =>
  bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`;

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "just now", "3 hours ago", "2 days ago" for the offline-list pill. */
export function timeAgo(from: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - from) / 60_000));
  if (minutes < 2) return 'just now';
  if (minutes < 120) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hours ago`;
  return `${Math.round(hours / 24)} days ago`;
}

/** "4:07" or "1:02:03" for a position in seconds. */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** 1.25 -> "1.25×", 1 -> "1×". */
export const formatSpeed = (speed: number): string => `${Number(speed.toFixed(2))}×`;
