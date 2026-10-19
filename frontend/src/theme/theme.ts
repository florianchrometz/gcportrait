// SPDX-License-Identifier: Apache-2.0

/**
 * Theme state, pure: no DOM, no storage. The ThemeProvider wires it to the browser.
 *
 * The user picks a preference (system, light or dark); the app always renders a resolved theme (light or
 * dark) which goes into <html data-theme>. "system" follows prefers-color-scheme and keeps following it.
 */

export const THEME_PREFERENCES = ['system', 'light', 'dark'] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];
export type ResolvedTheme = 'light' | 'dark';

/**
 * localStorage key of the synchronous mirror of the theme preference. IndexedDB is the store of record,
 * but it cannot be read before first paint; the inline bootstrap script in index.html reads this mirror
 * instead. bootstrap.test.ts checks that the script and this module agree.
 */
export const THEME_MIRROR_KEY = 'gcportrait.theme';

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && (THEME_PREFERENCES as readonly string[]).includes(value);
}

export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  if (preference === 'system') return systemPrefersDark ? 'dark' : 'light';
  return preference;
}

export type ThemeState = {
  readonly preference: ThemePreference;
  readonly systemPrefersDark: boolean;
  /**
   * Where the preference came from: the synchronous mirror at start-up, the preference store (IndexedDB),
   * or the user in this session. A choice the user makes always wins over a store read that lands later.
   */
  readonly source: 'initial' | 'stored' | 'user';
};

export type ThemeAction =
  | { readonly type: 'storedPreferenceLoaded'; readonly preference: ThemePreference }
  | { readonly type: 'preferenceChosen'; readonly preference: ThemePreference }
  | { readonly type: 'systemPreferenceChanged'; readonly prefersDark: boolean };

export function initialThemeState(
  mirroredPreference: ThemePreference | null,
  systemPrefersDark: boolean,
): ThemeState {
  return { preference: mirroredPreference ?? 'system', systemPrefersDark, source: 'initial' };
}

export function themeReducer(state: ThemeState, action: ThemeAction): ThemeState {
  switch (action.type) {
    case 'storedPreferenceLoaded':
      if (state.source === 'user') return state;
      return { ...state, preference: action.preference, source: 'stored' };
    case 'preferenceChosen':
      return { ...state, preference: action.preference, source: 'user' };
    case 'systemPreferenceChanged':
      if (state.systemPrefersDark === action.prefersDark) return state;
      return { ...state, systemPrefersDark: action.prefersDark };
  }
}

/** Human-readable names for the settings UI. */
export const THEME_PREFERENCE_LABELS: Readonly<Record<ThemePreference, string>> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
};
