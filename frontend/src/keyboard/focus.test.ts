// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
/**
 * Focus indicators meet 3 : 1 (WCAG 2.2 1.4.11 / 2.4.13; skill gcp-diagram-style §9, §13). The app
 * chrome's ring (global.css: 2 px `primary` outside a 2 px `surface` gap, or inset in popups) against every colour
 * next to it, in both themes; the diagram's indicators are in theme/theme.test.ts. And every stylesheet that turns
 * the browser's outline off is one of the places listed here, each with the indicator that replaces it, so a new
 * `outline: none` cannot hide focus unnoticed.
 */
import { describe, expect, it } from 'vitest';

import { contrastRatio } from '../diagram/theme/contrast';
import { readSource as read, sourceFiles, themeBlock, withoutComments } from '../test/css';

const TOKENS = read('styles/tokens.css');

/** The `--color-*` values of a theme's block in tokens.css. */
function chrome(theme: 'light' | 'dark'): Readonly<Record<string, string>> {
  const values: Record<string, string> = {};
  for (const match of themeBlock(TOKENS, theme).matchAll(/(--color-[a-z-]+):\s*(#[0-9a-f]{6})/gi)) {
    const [, name, value] = match;
    if (name !== undefined && value !== undefined) values[name] = value;
  }
  return values;
}

function colour(values: Readonly<Record<string, string>>, name: string): string {
  const value = values[name];
  if (value === undefined) throw new Error(`tokens.css has no ${name}`);
  return value;
}

/**
 * Where the stylesheets turn the browser's outline off, and what shows focus instead. A selector missing here
 * fails the test: add it with its indicator, after checking that indicator in both themes.
 */
const OUTLINE_OFF: Readonly<Record<string, readonly string[]>> = {
  // The inset 2 px primary ring (popup items, and the active option of a listbox whose focus stays on its combobox).
  'ui/popup.module.css': ['.item:focus-visible, .active', '.panel:focus'],
  // A modal dialog and a popover panel take focus only to move it inside; their controls show the ring.
  'ui/Dialog.module.css': ['.dialog:focus'],
  // The skip link's target; the page's controls show the ring.
  'shell/AppShell.module.css': ['.main:focus'],
  // The drawing's own indicators: the painter's focus ring (2 px focus colour between canvas gaps), the console
  // action's focused pill and the collapse button's focused plate (the focus colour on a canvas rim).
  'diagram/diagram.css': ['.dg-console-action', '.dg-node:focus'],
  'diagram/disclosure/disclosure.css': ['.dg-collapse'],
  // A slider's thumb that a pointer's press focused: no ring until a key is pressed on it, as on a native range
  // input (the thumb lies under the pointer that pressed it); the key brings the chrome ring back. On a phone or a
  // tablet the thumb is a transparent touch box whose dot (`::after`) carries the chrome ring instead, and the
  // press's mark hides the dot's ring alike.
  'ui/Slider.module.css': [
    ".track .thumb[data-pointer-focus='true']:focus-visible",
    '.thumb:focus-visible',
    ".track .thumb[data-pointer-focus='true']:focus-visible::after",
  ],
};

/** The selectors of the rules in a stylesheet that set `outline: none` (or `0`). */
function outlineOff(css: string): string[] {
  const selectors: string[] = [];
  for (const match of withoutComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const [, selector, body] = match;
    if (selector === undefined || body === undefined) continue;
    if (/(^|;)\s*outline\s*:\s*(none|0)\s*(;|$)/.test(body.trim()))
      selectors.push(selector.trim().replace(/\s+/g, ' '));
  }
  return selectors;
}

describe('focus indicators', () => {
  it.each(['light', 'dark'] as const)(
    '%s: the chrome ring reaches 3 : 1 against its gap and every surface beside it',
    (theme) => {
      const values = chrome(theme);
      const ring = colour(values, '--color-primary');
      // The ring's gap (global.css) and the surfaces a ring sits on or an inset ring sits in (an active item).
      for (const name of ['--color-surface', '--color-surface-container']) {
        expect(
          contrastRatio(ring, colour(values, name)),
          `${theme}: primary on ${name}`,
        ).toBeGreaterThanOrEqual(3);
      }
    },
  );

  it('draws the global ring as 2 px primary outside a 2 px surface gap', () => {
    const global = withoutComments(read('styles/global.css'));
    const rule = /:focus-visible\s*\{([^}]*)\}/.exec(global)?.[1] ?? '';
    expect(rule).toContain('0 0 0 var(--focus-ring-gap) var(--color-surface)');
    expect(rule).toContain('calc(var(--focus-ring-gap) + var(--focus-ring-width)) var(--color-primary)');
    expect(TOKENS).toMatch(/--focus-ring-width:\s*2px/);
    expect(TOKENS).toMatch(/--focus-ring-gap:\s*2px/);
  });

  it('draws the same ring round a slider thumb’s dot on a phone or a tablet, with the outline for forced colours', () => {
    const slider = withoutComments(read('ui/Slider.module.css'));
    const rule = /\.thumb:focus-visible::after\s*\{([^}]*)\}/.exec(slider)?.[1] ?? '';
    expect(rule).toContain('0 0 0 var(--focus-ring-gap) var(--color-surface)');
    expect(rule).toContain('calc(var(--focus-ring-gap) + var(--focus-ring-width)) var(--color-primary)');
    expect(rule).toContain('outline: var(--focus-ring-width) solid transparent');
  });

  it('keeps the diagram’s focused pill and plate on a canvas rim', () => {
    const rim = (css: string, selector: string): string => {
      const at = css.indexOf(`${selector} {`);
      return at < 0 ? '' : css.slice(at, css.indexOf('}', at));
    };
    const pill = rim(
      withoutComments(read('diagram/diagram.css')),
      '.dg-console-action:focus-visible .dg-console-pill',
    );
    const plate = rim(
      withoutComments(read('diagram/disclosure/disclosure.css')),
      '.dg-collapse:focus-visible .dg-collapse-plate',
    );
    for (const rule of [pill, plate]) {
      expect(rule).toContain('fill: var(--dg-focus)');
      expect(rule).toContain('stroke: var(--dg-canvas)');
      expect(rule).toContain('stroke-width: 2px');
    }
  });

  it('turns the browser outline off only where another indicator shows focus', () => {
    const sheets = sourceFiles('', (path) => path.endsWith('.css'));
    expect(sheets.length).toBeGreaterThan(10);
    const found: Record<string, string[]> = {};
    for (const path of sheets) {
      const selectors = outlineOff(read(path));
      if (selectors.length > 0) found[path] = selectors;
    }
    expect(found).toEqual(OUTLINE_OFF);
  });
});
