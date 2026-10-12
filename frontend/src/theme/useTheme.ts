// SPDX-License-Identifier: MIT
import { createContext, useContext } from 'react';

import type { ResolvedTheme, ThemePreference } from './theme';

export type ThemeContextValue = {
  /** What the user chose: system, light or dark. */
  readonly preference: ThemePreference;
  /** What is on screen now. */
  readonly resolved: ResolvedTheme;
  readonly setPreference: (preference: ThemePreference) => void;
};

export const ThemeContext = createContext<ThemeContextValue | null>(null);

/** The current theme and a setter. Must be used under <ThemeProvider>. */
export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (value === null) throw new Error('useTheme must be used inside <ThemeProvider>.');
  return value;
}
