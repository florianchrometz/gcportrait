// SPDX-License-Identifier: MIT
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, type ReactNode } from 'react';

import { usePreferenceStore } from '../storage/preferences';
import {
  applyTheme,
  readThemeMirror,
  subscribeToSystemTheme,
  systemPrefersDark,
  writeThemeMirror,
} from './browser';
import { initialThemeState, resolveTheme, themeReducer, type ThemePreference } from './theme';
import { ThemeContext, type ThemeContextValue } from './useTheme';

/**
 * Owns the theme for the whole app: starts from what the bootstrap script already applied (the
 * localStorage mirror), then adopts the IndexedDB value, follows the system scheme while the preference is
 * "system", writes every user choice to IndexedDB and the mirror, and keeps <html data-theme> current.
 */
export function ThemeProvider({ children }: { readonly children: ReactNode }) {
  const store = usePreferenceStore();
  const [state, dispatch] = useReducer(themeReducer, undefined, () =>
    initialThemeState(readThemeMirror(), systemPrefersDark()),
  );

  useEffect(() => {
    let cancelled = false;
    store.get('theme').then(
      (preference) => {
        if (!cancelled && preference !== undefined) dispatch({ type: 'storedPreferenceLoaded', preference });
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [store]);

  useEffect(
    () =>
      subscribeToSystemTheme((prefersDark) => {
        dispatch({ type: 'systemPreferenceChanged', prefersDark });
      }),
    [],
  );

  const resolved = resolveTheme(state.preference, state.systemPrefersDark);

  useLayoutEffect(() => {
    applyTheme(document.documentElement, resolved, state.preference);
  }, [resolved, state.preference]);

  useEffect(() => {
    // Keep the bootstrap mirror in step with the store of record once that is known.
    if (state.source !== 'initial') writeThemeMirror(state.preference);
  }, [state.preference, state.source]);

  const setPreference = useCallback(
    (preference: ThemePreference) => {
      dispatch({ type: 'preferenceChosen', preference });
      void store.set('theme', preference);
    },
    [store],
  );

  const value = useMemo<ThemeContextValue>(
    () => ({ preference: state.preference, resolved, setPreference }),
    [state.preference, resolved, setPreference],
  );

  return <ThemeContext value={value}>{children}</ThemeContext>;
}
