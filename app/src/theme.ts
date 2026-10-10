// "Dusk" design system from the approved wireframes: dark, Jade accent.
export type Palette = {
  [K in 'bg' | 'surf' | 'surf2' | 'raised' | 'text' | 'muted' | 'subtle' | 'line' | 'accent' | 'onAccent' | 'tint' | 'warn' | 'warnBg' | 'danger' | 'dangerBg']: string;
};

const dark: Palette = {
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
};

/** Theme choices from the wireframes (G5); jade accent is part of each. */
export const palettes = {
  dark,
  black: { ...dark, bg: '#000000', surf: '#0b0d11', surf2: '#14171d', raised: '#1d2129' },
  light: {
    ...dark,
    bg: '#f5f6f9',
    surf: '#ffffff',
    surf2: '#eceef3',
    raised: '#dfe2ea',
    text: '#12161d',
    muted: '#566072',
    subtle: '#8a93a3',
    line: 'rgba(0,0,0,0.09)',
    warn: '#a85f00',
    warnBg: 'rgba(168,95,0,0.12)',
    danger: '#c43838',
    dangerBg: 'rgba(196,56,56,0.12)',
  },
} as const satisfies Record<string, Palette>;

/** Accent colour per theme: [on dark surfaces, on the light theme]. Text on the accent is dark, or white for the light-theme variants. */
export const accents = {
  jade: { dark: '#3ddbb0', light: '#0b8a6c' },
  indigo: { dark: '#9aa3ff', light: '#4a54d6' },
  amber: { dark: '#ffbf5e', light: '#a86400' },
  rose: { dark: '#ff8fb0', light: '#c8386a' },
} as const;

const hexToRgba = (hex: string, alpha: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${alpha})`;
};

/**
 * Live colours. `applyAppearance` rewrites them in place and bumps `themeVersion`; screens re-read
 * them when they render, and `themedStyles` rebuilds a style sheet the first time it is read after a bump.
 */
export const colors: Palette = { ...dark };

let version = 0;
/** Changes every time `applyAppearance` actually changes a colour. */
export const themeVersion = () => version;

/** A style sheet written in terms of `colors`: same object each render, rebuilt after a theme or accent change. */
export function themedStyles<T extends object>(make: () => T): T {
  let built: T | undefined;
  let builtFor = -1;
  return new Proxy({} as T, {
    get(_, key) {
      if (builtFor !== version || !built) [built, builtFor] = [make(), version];
      return built[key as keyof T];
    },
  });
}

/** Sets `colors` for the chosen theme and accent; returns whether the result is light (for the status bar). */
export function applyAppearance(
  theme: 'system' | 'light' | 'dark' | 'black',
  accent: keyof typeof accents,
  systemScheme: string | null | undefined,
): 'light' | 'dark' {
  const mode = theme === 'system' ? (systemScheme === 'light' ? 'light' : 'dark') : theme;
  const accentHex = accents[accent][mode === 'light' ? 'light' : 'dark'];
  const next: Palette = { ...palettes[mode], accent: accentHex, onAccent: mode === 'light' ? '#ffffff' : '#07130f', tint: hexToRgba(accentHex, 0.14) };
  if ((Object.keys(next) as (keyof Palette)[]).some((k) => next[k] !== colors[k])) {
    Object.assign(colors, next);
    version++;
  }
  return mode === 'light' ? 'light' : 'dark';
}

/** The status bar icons to use on the current background. */
export const statusBarStyle = () => (colors.bg === palettes.light.bg ? 'dark' : 'light');

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
