// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';

import {
  initialThemeState,
  isThemePreference,
  resolveTheme,
  THEME_PREFERENCES,
  themeReducer,
  type ThemeState,
} from './theme';

describe('resolveTheme', () => {
  it.each([
    ['system', false, 'light'],
    ['system', true, 'dark'],
    ['light', true, 'light'],
    ['light', false, 'light'],
    ['dark', false, 'dark'],
    ['dark', true, 'dark'],
  ] as const)('%s with system dark=%s resolves to %s', (preference, systemDark, expected) => {
    expect(resolveTheme(preference, systemDark)).toBe(expected);
  });
});

describe('isThemePreference', () => {
  it('accepts exactly the three preferences', () => {
    for (const preference of THEME_PREFERENCES) expect(isThemePreference(preference)).toBe(true);
    for (const other of ['', 'Dark', 'auto', null, undefined, 1, {}])
      expect(isThemePreference(other)).toBe(false);
  });
});

describe('initialThemeState', () => {
  it('starts from the mirrored preference, or system when there is none', () => {
    expect(initialThemeState('dark', false)).toEqual({
      preference: 'dark',
      systemPrefersDark: false,
      source: 'initial',
    });
    expect(initialThemeState(null, true)).toEqual({
      preference: 'system',
      systemPrefersDark: true,
      source: 'initial',
    });
  });
});

describe('themeReducer', () => {
  const initial: ThemeState = initialThemeState(null, false);

  it('adopts a stored preference', () => {
    expect(themeReducer(initial, { type: 'storedPreferenceLoaded', preference: 'dark' })).toEqual({
      preference: 'dark',
      systemPrefersDark: false,
      source: 'stored',
    });
  });

  it('applies a user choice', () => {
    expect(themeReducer(initial, { type: 'preferenceChosen', preference: 'light' })).toEqual({
      preference: 'light',
      systemPrefersDark: false,
      source: 'user',
    });
  });

  it('keeps a user choice when a slower store read lands afterwards', () => {
    const chosen = themeReducer(initial, { type: 'preferenceChosen', preference: 'light' });
    expect(themeReducer(chosen, { type: 'storedPreferenceLoaded', preference: 'dark' })).toBe(chosen);
  });

  it('tracks the system scheme without touching the preference', () => {
    const dark = themeReducer(initial, { type: 'systemPreferenceChanged', prefersDark: true });
    expect(dark).toEqual({ preference: 'system', systemPrefersDark: true, source: 'initial' });
    expect(resolveTheme(dark.preference, dark.systemPrefersDark)).toBe('dark');
  });

  it('returns the same state for a no-op system change', () => {
    expect(themeReducer(initial, { type: 'systemPreferenceChanged', prefersDark: false })).toBe(initial);
  });
});
