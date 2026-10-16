// @vitest-environment node
// SPDX-License-Identifier: MIT
/**
 * Both themes through tokens: every stylesheet of the app chrome (each `*.module.css` under src/ outside the
 * diagram, which has its own token table and theme tests) uses no raw colour, and every colour token it uses is
 * defined for the light and the dark theme in styles/tokens.css (skill gcp-diagram-style §9). The primitives, the
 * view controls and every other chrome sheet alike, one row each. And the filled primary buttons (the top bar's
 * Export button among them) keep their text at 4.5 : 1 on the fill in both themes.
 */
import { describe, expect, it } from 'vitest';

import { contrastRatio } from '../diagram/theme/contrast';
import { block, readSource, sourceFiles, themeBlock, token, withoutComments } from '../test/css';

const SHEETS = sourceFiles('', (path) => path.endsWith('.module.css') && !path.startsWith('diagram/'));
const TOKENS = readSource('styles/tokens.css');
const LIGHT = themeBlock(TOKENS, 'light');
const DARK = themeBlock(TOKENS, 'dark');

/**
 * The diagram's own tokens a chrome sheet may name, each with why: the page behind the canvas is the canvas's
 * colour, so no other colour shows at its edges while the drawing pans.
 */
const DIAGRAM_TOKENS: Readonly<Record<string, readonly string[]>> = {
  'pages/DiagramPage.module.css': ['--dg-canvas'],
};

/**
 * Measurements a component sets on its own element as a custom property, which a sheet may read, each with why: the
 * top bar carries the diagram canvas's height, so the sheets hanging over the canvas leave a third of it in view
 * (shell/topbar/TopBar.tsx).
 */
const MEASURED: Readonly<Record<string, readonly string[]>> = {
  'shell/topbar/TopBar.module.css': ['--canvas-height'],
};

describe('the app chrome uses the chrome tokens only', () => {
  it('finds the primitives’ and the view controls’ sheets, and both themes’ tokens', () => {
    // A precondition of the rows below: a path or a selector that moved would leave nothing to check.
    expect(SHEETS).toEqual(
      expect.arrayContaining([
        'ui/controls.module.css',
        'ui/popup.module.css',
        'views/SavedViewsDialog.module.css',
        'shell/topbar/FiltersControl.module.css',
        'pages/DiagramPage.module.css',
      ]),
    );
    expect(LIGHT).toContain('--color-primary:');
    expect(DARK).toContain('--color-primary:');
  });

  it.each(SHEETS)('%s has no raw colour, and only tokens both themes define', (path) => {
    const css = withoutComments(readSource(path));
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
    const allowed = [...(DIAGRAM_TOKENS[path] ?? []), ...(MEASURED[path] ?? [])];
    for (const match of css.matchAll(/var\((--[a-z0-9-]+)/g)) {
      const name = match[1] ?? '';
      if (allowed.includes(name)) continue;
      if (name.startsWith('--color-')) {
        expect(LIGHT, `${path}: ${name} in the light theme`).toContain(`${name}:`);
        expect(DARK, `${path}: ${name} in the dark theme`).toContain(`${name}:`);
      } else {
        expect(TOKENS, `${path}: ${name}`).toContain(`${name}:`);
      }
    }
  });
});

describe('the filled primary buttons', () => {
  it.each([
    ['light', LIGHT],
    ['dark', DARK],
  ] as const)('%s: on-primary text on the primary fill reaches 4.5 : 1', (theme, declarations) => {
    const ratio = contrastRatio(
      token(declarations, '--color-on-primary'),
      token(declarations, '--color-primary'),
    );
    expect(ratio, theme).toBeGreaterThanOrEqual(4.5);
  });

  it('the top bar’s Export button is one: the primary fill, on-primary text, and no fill while it is inert', () => {
    const css = withoutComments(readSource('shell/topbar/ExportMenu.module.css'));
    const control = block(css, '.control {');
    expect(control).toContain('background: var(--color-primary);');
    expect(control).toContain('color: var(--color-on-primary);');
    expect(control).toContain('border: 1px solid var(--color-primary);');
    const inert = block(css, ".control[aria-disabled='true'] {");
    expect(inert).toContain('background: var(--color-surface);');
    expect(inert).toContain('color: var(--color-on-surface-variant);');
  });
});
