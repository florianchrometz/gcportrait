// SPDX-License-Identifier: MIT
/**
 * The app's three layouts and the widths between them (AGENTS.md, Product rules): the phone up to 47.99rem (portrait
 * and landscape), the tablet from 48rem to 79.99rem, the desktop from 80rem. Media queries cannot read custom
 * properties, so the stylesheets write these queries out, in rem, exactly as `MEDIA` has them (ui/screen.test.ts holds
 * every sheet to them, and styles/tokens.css names the two widths as `--breakpoint-tablet` and `--breakpoint-desktop`);
 * the one container query, a part's own height, is `CONTAINER`'s.
 *
 * What moves between the layouts is the chrome only, never a control: a fold (ui/Popover `sheet`) keeps the same
 * components and shows them in place on the desktop and behind a button on narrower screens.
 */
import { useSyncExternalStore } from 'react';

/** The widths where the next layout starts, in rem. */
export const BREAKPOINTS_REM = { tablet: 48, desktop: 80 } as const;

/** The media queries of the layouts; a stylesheet uses these strings and no others for widths. */
export const MEDIA = {
  /** The phone. */
  phone: '(max-width: 47.99rem)',
  /** The tablet. */
  tablet: '(min-width: 48rem) and (max-width: 79.99rem)',
  /** The phone and the tablet: the folded chrome and its 44-pixel targets. */
  narrow: '(max-width: 79.99rem)',
  /** The tablet and the desktop. */
  wide: '(min-width: 48rem)',
  /** The desktop. */
  desktop: '(min-width: 80rem)',
} as const;

/**
 * The container queries a stylesheet may use, in rem as well: a part's own room rather than the window's width.
 * `shortCanvas`: a phone's canvas under 10.5rem tall (a small phone turned sideways), too short for the disclosure bar
 * above the half-height details sheet, which covers half of it (the bar's 44-pixel buttons in their panel, 54 px, the
 * sheet handle's outer half and a gap, 30 px: 84 px, twice), so the bar is hidden while the sheet is open
 * (diagram/disclosure/DisclosureBar.module.css).
 */
export const CONTAINER = {
  shortCanvas: '(max-height: 10.49rem)',
} as const;

export type Screen = 'phone' | 'tablet' | 'desktop';

/** The layout for a set of media query answers. A window that answers none of them (no matchMedia) is a desktop. */
export function screenOf(matches: (query: string) => boolean): Screen {
  if (matches(MEDIA.phone)) return 'phone';
  if (matches(MEDIA.tablet)) return 'tablet';
  return 'desktop';
}

/** The layout of a window `width` CSS pixels wide, with a root font size of `rem` pixels. */
export function screenAt(width: number, rem = 16): Screen {
  if (width < BREAKPOINTS_REM.tablet * rem) return 'phone';
  if (width < BREAKPOINTS_REM.desktop * rem) return 'tablet';
  return 'desktop';
}

function canMatch(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function';
}

function currentScreen(): Screen {
  return canMatch() ? screenOf((query) => window.matchMedia(query).matches) : 'desktop';
}

function subscribe(onChange: () => void): () => void {
  if (!canMatch()) return () => undefined;
  const lists = [MEDIA.phone, MEDIA.tablet].map((query) => window.matchMedia(query));
  for (const list of lists) list.addEventListener('change', onChange);
  return () => {
    for (const list of lists) list.removeEventListener('change', onChange);
  };
}

function serverScreen(): Screen {
  return 'desktop';
}

/** The window's layout, kept current as the window is resized or turned. */
export function useScreen(): Screen {
  return useSyncExternalStore(subscribe, currentScreen, serverScreen);
}
