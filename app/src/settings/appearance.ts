import { Appearance, useColorScheme } from 'react-native';

import type { KeyValueStore } from '../data/offlineList';
import { usePhone } from '../phone/PhoneProvider';
import { useStore } from '../phone/persisted';
import { applyAppearance, themeVersion } from '../theme';
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

/**
 * Applies the chosen theme and accent as they change (and the phone's light/dark switch for "system"),
 * and returns a key that changes with the colours: put it on the screens so they remount with the new ones.
 */
export function useAppearance(): number {
  const { theme, accent } = useStore(usePhone().settings);
  applyAppearance(theme, accent, useColorScheme());
  return themeVersion();
}
