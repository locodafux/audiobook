import { Appearance } from 'react-native';

import { accents, applyAppearance, colors, palettes, statusBarStyle } from '../theme';
import { memoryStore } from '../phone/memoryStore';
import { loadAppearance } from './appearance';
import { SETTINGS_KEY } from './settings';

jest.spyOn(Appearance, 'getColorScheme').mockReturnValue('light');

afterEach(() => applyAppearance('dark', 'jade', 'dark'));

describe('appearance', () => {
  it('applies theme and accent to the live colours', () => {
    expect(applyAppearance('black', 'rose', null)).toBe('dark');
    expect(colors.bg).toBe('#000000');
    expect(colors.accent).toBe(accents.rose.dark);
    expect(statusBarStyle()).toBe('light');
  });

  it('uses the darker accent and dark status icons on the light theme', () => {
    expect(applyAppearance('light', 'jade', null)).toBe('light');
    expect(colors.bg).toBe(palettes.light.bg);
    expect(colors.accent).toBe(accents.jade.light);
    expect(colors.onAccent).toBe('#ffffff');
    expect(statusBarStyle()).toBe('dark');
  });

  it('follows the phone for "system"', () => {
    expect(applyAppearance('system', 'jade', 'light')).toBe('light');
    expect(applyAppearance('system', 'jade', undefined)).toBe('dark');
  });

  it('loads the saved choice, and falls back to dark jade', async () => {
    await loadAppearance(memoryStore({ [SETTINGS_KEY]: JSON.stringify({ theme: 'system', accent: 'amber' }) }));
    expect(colors.bg).toBe(palettes.light.bg); // the mocked phone is in light mode
    expect(colors.accent).toBe(accents.amber.light);
    await loadAppearance(memoryStore({ [SETTINGS_KEY]: '{' }));
    expect(colors.bg).toBe(palettes.dark.bg);
    expect(colors.accent).toBe(accents.jade.dark);
  });
});
