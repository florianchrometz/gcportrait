// SPDX-License-Identifier: Apache-2.0
import { isThemePreference, THEME_MIRROR_KEY, type ResolvedTheme, type ThemePreference } from './theme';

/**
 * The browser side of theming: the prefers-color-scheme query, the localStorage mirror read by the
 * bootstrap script, and the <html> attributes. Every access is guarded: a browser without matchMedia, or
 * one that throws on localStorage (some private modes), still gets a working light/dark app.
 */

const DARK_QUERY = '(prefers-color-scheme: dark)';

function matchMediaOrUndefined(): ((query: string) => MediaQueryList) | undefined {
  const { matchMedia } = window as Partial<Window>;
  return typeof matchMedia === 'function' ? matchMedia.bind(window) : undefined;
}

export function systemPrefersDark(): boolean {
  try {
    return matchMediaOrUndefined()?.(DARK_QUERY).matches ?? false;
  } catch {
    return false;
  }
}

/** Calls `listener` whenever the system colour scheme changes. Returns the unsubscribe function. */
export function subscribeToSystemTheme(listener: (prefersDark: boolean) => void): () => void {
  let query: MediaQueryList | undefined;
  try {
    query = matchMediaOrUndefined()?.(DARK_QUERY);
  } catch {
    query = undefined;
  }
  if (query === undefined) return () => undefined;
  const onChange = (event: MediaQueryListEvent): void => {
    listener(event.matches);
  };
  query.addEventListener('change', onChange);
  return () => {
    query.removeEventListener('change', onChange);
  };
}

export function readThemeMirror(): ThemePreference | null {
  try {
    const value = window.localStorage.getItem(THEME_MIRROR_KEY);
    return isThemePreference(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeThemeMirror(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_MIRROR_KEY, preference);
  } catch {
    // Storage blocked: the next load falls back to the IndexedDB value (or the system theme) after paint.
  }
}

/** Puts the theme on <html>: data-theme is what tokens.css keys on; data-theme-preference is informational. */
export function applyTheme(root: HTMLElement, resolved: ResolvedTheme, preference: ThemePreference): void {
  root.dataset.theme = resolved;
  root.dataset.themePreference = preference;
}
