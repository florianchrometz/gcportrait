// @vitest-environment node
// SPDX-License-Identifier: MIT
/**
 * The three layouts (ui/screen.ts; AGENTS.md, Product rules): the queries name the breakpoints in rem, tokens.css
 * names the same widths, every stylesheet of the app asks for a width only with one of those queries (or for
 * the colour scheme, motion and the like), and a width maps to its layout on either side of each breakpoint.
 */
import { describe, expect, it } from 'vitest';

import { readSource, sourceFiles, withoutComments } from '../test/css';
import { BREAKPOINTS_REM, CONTAINER, MEDIA, screenAt, screenOf } from './screen';

const SHEETS = sourceFiles('', (path) => path.endsWith('.css'));
const QUERIES: ReadonlySet<string> = new Set(Object.values(MEDIA));
const CONTAINER_QUERIES: ReadonlySet<string> = new Set(Object.values(CONTAINER));

/** Every `@media` (or `@container`) prelude in a stylesheet, as written, whitespace collapsed. */
function mediaQueries(css: string, rule: 'media' | 'container' = 'media'): string[] {
  return [...withoutComments(css).matchAll(new RegExp(`@${rule}\\s+([^{]+)\\{`, 'g'))].map((match) =>
    (match[1] ?? '').trim().replace(/\s+/g, ' '),
  );
}

describe('the layouts’ breakpoints', () => {
  it('are the queries’ widths, in rem, the phone’s and the tablet’s ending a hundredth below the next', () => {
    const below = (rem: number): string => `${String(Math.round((rem - 0.01) * 100) / 100)}rem`;
    expect(MEDIA.phone).toBe(`(max-width: ${below(BREAKPOINTS_REM.tablet)})`);
    expect(MEDIA.tablet).toBe(
      `(min-width: ${String(BREAKPOINTS_REM.tablet)}rem) and (max-width: ${below(BREAKPOINTS_REM.desktop)})`,
    );
    expect(MEDIA.narrow).toBe(`(max-width: ${below(BREAKPOINTS_REM.desktop)})`);
    expect(MEDIA.wide).toBe(`(min-width: ${String(BREAKPOINTS_REM.tablet)}rem)`);
    expect(MEDIA.desktop).toBe(`(min-width: ${String(BREAKPOINTS_REM.desktop)}rem)`);
  });

  it('are the widths tokens.css names', () => {
    const tokens = readSource('styles/tokens.css');
    expect(tokens).toContain(`--breakpoint-tablet: ${String(BREAKPOINTS_REM.tablet)}rem;`);
    expect(tokens).toContain(`--breakpoint-desktop: ${String(BREAKPOINTS_REM.desktop)}rem;`);
  });

  it('finds the stylesheets that fold the chrome', () => {
    // A precondition of the rows below: a sheet that moved would leave nothing to check.
    expect(SHEETS).toEqual(
      expect.arrayContaining(['styles/tokens.css', 'shell/topbar/TopBar.module.css', 'ui/popup.module.css']),
    );
    expect(mediaQueries(readSource('shell/topbar/TopBar.module.css'))).toContain(MEDIA.narrow);
  });

  it.each(SHEETS)('%s asks for a width only with the layouts’ queries', (path) => {
    for (const query of mediaQueries(readSource(path))) {
      if (/^\((prefers-|forced-colors|hover|pointer)/.test(query)) continue;
      expect(QUERIES, `${path}: @media ${query}`).toContain(query);
    }
    for (const query of mediaQueries(readSource(path), 'container'))
      expect(CONTAINER_QUERIES, `${path}: @container ${query}`).toContain(query);
  });

  it('has its container queries in rem, each used where its part is', () => {
    for (const query of Object.values(CONTAINER)) expect(query).toMatch(/^\(max-height: [\d.]+rem\)$/);
    // The short canvas: the disclosure bar's frame is the container, over the canvas.
    expect(mediaQueries(readSource('diagram/disclosure/DisclosureBar.module.css'), 'container')).toEqual([
      CONTAINER.shortCanvas,
    ]);
    // The short workspace: the diagram page's workspace is the container, the timeline bar's fold asks it.
    expect(mediaQueries(readSource('pages/diagram/TimelineBar.module.css'), 'container')).toEqual([
      CONTAINER.shortWorkspace,
    ]);
    expect(withoutComments(readSource('pages/DiagramPage.module.css'))).toMatch(
      /\.workspace\s*\{\s*container-type:\s*size;\s*\}/,
    );
  });
});

describe('a width’s layout', () => {
  it.each([
    [320, 'phone'],
    [430, 'phone'],
    [767, 'phone'],
    [768, 'tablet'],
    [820, 'tablet'],
    [1279, 'tablet'],
    [1280, 'desktop'],
    [1440, 'desktop'],
  ] as const)('%i px is a %s', (width, screen) => {
    expect(screenAt(width)).toBe(screen);
  });

  it('follows the media queries, and a window that answers none is a desktop', () => {
    expect(screenOf((query) => query === MEDIA.phone || query === MEDIA.narrow)).toBe('phone');
    expect(screenOf((query) => query === MEDIA.tablet)).toBe('tablet');
    expect(screenOf(() => false)).toBe('desktop');
  });
});
