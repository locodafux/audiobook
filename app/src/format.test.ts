import { formatBytes, formatDuration, plural, timeAgo } from './format';

describe('format', () => {
  it('formats durations', () => {
    expect(formatDuration(53_640)).toBe('14h 54m');
    expect(formatDuration(2_520)).toBe('42m');
    expect(formatDuration(0)).toBe('');
  });
  it('formats sizes and plurals', () => {
    expect(formatBytes(322_000_000)).toBe('322 MB');
    expect(formatBytes(1_200_000_000)).toBe('1.2 GB');
    expect(plural(1, 'chapter')).toBe('1 chapter');
    expect(plural(95, 'chapter')).toBe('95 chapters');
  });
  it('says how old the saved list is', () => {
    const now = 1_000_000_000;
    expect(timeAgo(now - 30_000, now)).toBe('just now');
    expect(timeAgo(now - 5 * 3_600_000, now)).toBe('5 hours ago');
    expect(timeAgo(now - 3 * 86_400_000, now)).toBe('3 days ago');
  });
});
