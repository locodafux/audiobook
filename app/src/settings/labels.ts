import { plural } from '../format';
import type { Settings } from './settings';

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);

export const themeLabel = (t: Settings['theme']) => cap(t);
export const accentLabel = (a: Settings['accent']) => cap(a);
export const textSizeLabel = (t: Settings['textSize']) => cap(t);
export const secondsLabel = (n: number) => `${n} s`;
export const offOr = (unit: (n: number) => string) => (n: number) => (n === 0 ? 'Off' : unit(n));
export const minutesLabel = offOr((n) => `${n} min`);
export const rewindLabel = offOr((n) => `${n} s`);
export const chaptersLabel = offOr((n) => plural(n, 'chapter'));
export const afterDaysLabel = offOr((n) => `After ${plural(n, 'day')}`);
