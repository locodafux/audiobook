import { Appearance } from 'react-native';

import type { KeyValueStore } from '../data/offlineList';
import { applyAppearance } from '../theme';
import { SETTINGS_KEY, sanitizeSettings } from './settings';

/** Reads the saved theme and accent and applies them. Run once before any screen module loads. */
export async function loadAppearance(kv: KeyValueStore): Promise<void> {
  let saved: unknown = null;
  try {
    saved = JSON.parse((await kv.getItem(SETTINGS_KEY)) ?? 'null');
  } catch {
    // unreadable copy: defaults
  }
  const { theme, accent } = sanitizeSettings(saved);
  applyAppearance(theme, accent, Appearance.getColorScheme());
}
