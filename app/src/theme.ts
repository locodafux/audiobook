// "Dusk" design system from the approved wireframes: dark, Jade accent.
export const colors = {
  bg: '#0e1116',
  surf: '#171b22',
  surf2: '#20252e',
  raised: '#2a303b',
  text: '#f2f4f8',
  muted: '#9aa3b2',
  subtle: '#5f6878',
  line: 'rgba(255,255,255,0.08)',
  accent: '#3ddbb0',
  onAccent: '#04251c',
  tint: 'rgba(61,219,176,0.14)',
  warn: '#ffb454',
  warnBg: 'rgba(255,180,84,0.14)',
  danger: '#ff7a7a',
  dangerBg: 'rgba(255,122,122,0.14)',
} as const;

export const fonts = {
  sans: 'Manrope_500Medium',
  sansBold: 'Manrope_700Bold',
  sansHeavy: 'Manrope_800ExtraBold',
  serif: 'Fraunces_700Bold',
} as const;

/** Cover fallback gradients (used when a book has no cover image). */
export const coverGradients: readonly (readonly [string, string, string])[] = [
  ['#1f2a5a', '#6b3fa0', '#e0568f'],
  ['#0f3b3a', '#1f7a6b', '#9ad9a5'],
  ['#5a1f2a', '#b5413d', '#f1a35e'],
  ['#2b2f3a', '#566078', '#a9b4cf'],
  ['#3b2a10', '#a87321', '#f2d27a'],
];

/** Same book, same gradient, every time. */
export function gradientFor(seed: string): readonly [string, string, string] {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return coverGradients[h % coverGradients.length] ?? coverGradients[0]!;
}
