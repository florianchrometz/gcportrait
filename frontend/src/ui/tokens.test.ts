// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
/**
 * Both themes through tokens: every stylesheet of the app chrome (each `*.module.css` under src/ outside the
 * diagram, which has its own token table and theme tests) uses no raw colour, and every colour token it uses is
 * defined for the light and the dark theme in styles/tokens.css (skill gcp-diagram-style §9); any other custom
 * property it reads is a token there too, or one the sheet declares itself from them (the timeline bar's
 * `--ring-reach`), whose value this check reads as well. The primitives, the
 * view controls and every other chrome sheet alike, one row each. The filled primary buttons (the top bar's
 * Export button among them) keep their text at 4.5 : 1 on the fill in both themes, and the destructive control (the
 * Delete buttons) its error-coloured text at 4.5 : 1 on the control's fills, through a rule that outranks the
 * control's own whatever order the stylesheets load in (e2e/tests/snapshots.spec.ts reads the colour in a browser).
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
    const own = [...css.matchAll(/(?:^|[{;])\s*(--[a-z0-9-]+)\s*:/gm)].map((match) => match[1] ?? '');
    const allowed = [...(DIAGRAM_TOKENS[path] ?? []), ...(MEASURED[path] ?? []), ...own];
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

describe('the filled primary button', () => {
  const CONTROLS = withoutComments(readSource('ui/controls.module.css'));
  const COMPONENTS = sourceFiles('', (path) => path.endsWith('.tsx') && !path.endsWith('.test.tsx'));

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

  it('is a compound selector on the control in the primitive’s sheet, and an inert one keeps the inert look', () => {
    // `.control.primary` outranks `.control` (and any page's single class), so the variant never depends on the
    // order the bundler emits the sheets in; `:not([aria-disabled='true'])` leaves the control's inert look alone.
    const primary = block(CONTROLS, ".control.primary:not([aria-disabled='true']) {");
    expect(primary).toContain('border-color: var(--color-primary);');
    expect(primary).toContain('background: var(--color-primary);');
    expect(primary).toContain('color: var(--color-on-primary);');
    expect(primary).toContain('font-weight: var(--font-weight-medium);');
  });

  it.each(SHEETS.filter((path) => path !== 'ui/controls.module.css'))(
    '%s defines no primary class of its own, which would compete with the control’s rule by emit order',
    (path) => {
      expect(withoutComments(readSource(path))).not.toMatch(/\.primary\b/);
    },
  );

  it('is named through the primitive’s sheet wherever a component asks for it', () => {
    // A page sheet's `styles.primary` would be undefined (no sheet but the primitive's has the class) and drop silently.
    const uses = COMPONENTS.flatMap((path) =>
      [...readSource(path).matchAll(/\b(\w+)\.primary\b/g)].map((match) => `${path}: ${match[1] ?? ''}`),
    );
    expect(uses.length).toBeGreaterThan(0);
    for (const use of uses) expect(use).toMatch(/: controls$/);
  });
});

describe('the pressed toggle control', () => {
  const CONTROLS = withoutComments(readSource('ui/controls.module.css'));

  it('is a compound selector on the control in the primitive’s sheet, and an inert one keeps the inert look', () => {
    const pressed = block(CONTROLS, ".control[aria-pressed='true']:not([aria-disabled='true']) {");
    expect(pressed).toContain('border-color: var(--color-primary);');
    expect(pressed).toContain('color: var(--color-primary);');
  });

  it.each([
    ['light', LIGHT],
    ['dark', DARK],
  ] as const)('%s: the primary colour reaches 4.5 : 1 on the control’s fill', (theme, declarations) => {
    const primary = token(declarations, '--color-primary');
    expect(
      contrastRatio(primary, token(declarations, '--color-surface')),
      `${theme}: on --color-surface`,
    ).toBeGreaterThanOrEqual(4.5);
  });
});

describe('the destructive control', () => {
  const CONTROLS = withoutComments(readSource('ui/controls.module.css'));
  const COMPONENTS = sourceFiles('', (path) => path.endsWith('.tsx') && !path.endsWith('.test.tsx'));

  it('is a compound selector on the control in the primitive’s sheet, and an inert one keeps the inert look', () => {
    // `.control.danger` outranks `.control` (and any page's single class), so the variant never depends on the
    // order the bundler emits the sheets in; `:not([aria-disabled='true'])` leaves the control's inert look alone.
    const danger = block(CONTROLS, ".control.danger:not([aria-disabled='true']) {");
    expect(danger).toContain('border-color: var(--color-error);');
    expect(danger).toContain('color: var(--color-error);');
  });

  it.each(SHEETS.filter((path) => path !== 'ui/controls.module.css'))(
    '%s defines no danger class of its own, which would compete with the control’s rule by emit order',
    (path) => {
      expect(withoutComments(readSource(path))).not.toMatch(/\.danger\b/);
    },
  );

  it('is named through the primitive’s sheet wherever a component asks for it', () => {
    // A page sheet's `styles.danger` would be undefined (no sheet but the primitive's has the class) and drop silently.
    const uses = COMPONENTS.flatMap((path) =>
      [...readSource(path).matchAll(/\b(\w+)\.danger\b/g)].map((match) => `${path}: ${match[1] ?? ''}`),
    );
    expect(uses.length).toBeGreaterThan(0);
    for (const use of uses) expect(use).toMatch(/: controls$/);
  });

  it.each([
    ['light', LIGHT],
    ['dark', DARK],
  ] as const)(
    '%s: the error colour reaches 4.5 : 1 on the control’s fill and on its hover fill',
    (theme, declarations) => {
      const error = token(declarations, '--color-error');
      for (const fill of ['--color-surface', '--color-surface-container']) {
        expect(
          contrastRatio(error, token(declarations, fill)),
          `${theme}: on ${fill}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    },
  );
});
