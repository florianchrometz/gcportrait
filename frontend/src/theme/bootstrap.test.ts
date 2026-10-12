// SPDX-License-Identifier: MIT
import { afterEach, describe, expect, it } from 'vitest';

import indexHtml from '../../index.html?raw';
import { installMatchMedia, type SystemSchemeControl } from '../test/matchMedia';
import { isThemePreference, resolveTheme, THEME_MIRROR_KEY, THEME_PREFERENCES } from './theme';

/**
 * The inline script in index.html runs before the bundle, so it cannot import theme.ts. These tests run
 * the exact script text (jsdom executes it) and compare its result with resolveTheme() for every
 * combination of stored preference and system scheme.
 */

function inlineScripts(html: string): string[] {
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1] ?? '');
}

/**
 * Executes the bootstrap. jsdom runs script elements in its own global, which is not the object Vitest
 * exposes as `window` (where the test's matchMedia stub lives), so the source is wrapped in a function
 * whose `window` parameter is the test window. The source text itself is unchanged.
 */
function executeBootstrap(): void {
  const script = document.createElement('script');
  script.textContent = `(function (window) {\n${inlineScripts(indexHtml)[0] ?? ''}\n})(document.defaultView);`;
  document.head.append(script);
  script.remove();
}

let media: SystemSchemeControl | undefined;
afterEach(() => {
  media?.uninstall();
  media = undefined;
});

function runBootstrap(
  stored: string | null,
  systemDark: boolean,
): { theme: string | null; preference: string | null } {
  window.localStorage.clear();
  if (stored !== null) window.localStorage.setItem(THEME_MIRROR_KEY, stored);
  media = installMatchMedia(systemDark);
  const root = document.documentElement;
  root.removeAttribute('data-theme');
  root.removeAttribute('data-theme-preference');
  executeBootstrap();
  return { theme: root.getAttribute('data-theme'), preference: root.getAttribute('data-theme-preference') };
}

describe('index.html theme bootstrap', () => {
  it('is the only inline script, and reads the mirror key from theme.ts', () => {
    const scripts = inlineScripts(indexHtml);
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toContain(`'${THEME_MIRROR_KEY}'`);
  });

  const storedValues = [null, ...THEME_PREFERENCES, 'garbage'] as const;
  for (const stored of storedValues) {
    for (const systemDark of [false, true]) {
      it(`stored=${String(stored)}, system dark=${String(systemDark)}`, () => {
        const preference = isThemePreference(stored) ? stored : 'system';
        expect(runBootstrap(stored, systemDark)).toEqual({
          theme: resolveTheme(preference, systemDark),
          preference,
        });
      });
    }
  }

  it('falls back to light when matchMedia is missing', () => {
    window.localStorage.clear();
    const root = document.documentElement;
    root.removeAttribute('data-theme');
    executeBootstrap();
    expect(root.getAttribute('data-theme')).toBe('light');
  });
});
