// SPDX-License-Identifier: Apache-2.0
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { AxeBuilder } from '@axe-core/playwright';
import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';

/**
 * Shared helpers for the specs. The app is driven only through the browser; nothing here imports it.
 */

/*
 * The non-affiliation statement as the app must show it (AGENTS.md, Non-affiliation, brand and legal). Kept
 * literal on purpose: these are the expectations, not copies of frontend/src/branding.ts.
 */
/** The title block's third line, on the canvas and in every export. */
export const TAGLINE = 'gcportrait.app - Visualize your Google Cloud Infrastructure';
/** The footer's notice on every route; its last words, the maintainer's name, are a link. */
export const FOOTER_NOTICE =
  'Not affiliated with Google / Google Cloud. gcportrait is an independent open-source project by Florian Chrometz';
export const MAINTAINER_NAME = 'Florian Chrometz';
export const MAINTAINER_LINK_NAME = 'Florian Chrometz (personal website)';
export const MAINTAINER_URL = 'https://florian-chrometz.de';
/**
 * The footer notice's first sentence, which appears nowhere else: not in a drawing or an export, not in the
 * `hostedBy` line, not on any page (footers and long-form texts only).
 */
export const NOT_AFFILIATED = 'Not affiliated with Google / Google Cloud.';

export const WORDMARK = 'gcportrait';

/**
 * The footer's link to the app's source and its licence, next to the non-affiliation notice on every
 * route.
 */
export const SOURCE_LINK_TEXT = 'Source (Apache-2.0)';

/**
 * Where the footer's source link points when nothing configures it: the default of VITE_SOURCE_URL (the e2e
 * suite's servers set none) and of the backend's SOURCE_URL.
 */
export const DEFAULT_SOURCE_URL = 'https://github.com/florianchrometz/gcportrait';

/**
 * Checks the shell footer: the non-affiliation notice with the maintainer's name linked to their website (a new tab,
 * named "Florian Chrometz (personal website)"), and next to it the "Source (Apache-2.0)" link to `sourceUrl`.
 */
export async function expectShellFooter(page: Page, sourceUrl: string): Promise<void> {
  const footer = page.getByRole('contentinfo');
  await expect(footer).toBeVisible();
  await expect(footer).toBeInViewport();
  await expect(footer.getByText(FOOTER_NOTICE, { exact: true })).toBeVisible();
  const maintainer = footer.getByRole('link', { name: MAINTAINER_LINK_NAME, exact: true });
  await expect(maintainer).toBeVisible();
  await expect(maintainer).toHaveText(MAINTAINER_NAME);
  await expect(maintainer).toHaveAttribute('href', MAINTAINER_URL);
  await expect(maintainer).toHaveAttribute('target', '_blank');
  await expect(maintainer).toHaveAttribute('rel', 'noopener');
  const link = footer.getByRole('link', { name: SOURCE_LINK_TEXT, exact: true });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', sourceUrl);
  await expect(footer).toHaveText(`${FOOTER_NOTICE}${SOURCE_LINK_TEXT}`);
  await expect(footer).not.toContainText('side project');
}

/**
 * A footer link as the footer draws every link: the footer's own text colour (style skill §9 on-surface-variant),
 * underlined, at 4.5 : 1 or more; on keyboard focus the chrome ring (§9: 2 px primary outside a 2 px surface gap), at
 * 3 : 1 on the footer. `name` labels the failures.
 */
export async function expectFooterLinkStyle(page: Page, link: Locator, name: string): Promise<void> {
  const rest = await link.evaluate((element) => {
    const css = getComputedStyle(element);
    const footerCss = getComputedStyle(element.closest('footer') ?? element);
    return {
      colour: css.color,
      footerColour: footerCss.color,
      background: footerCss.backgroundColor,
      underline: css.textDecorationLine,
    };
  });
  expect(rest.colour, name).toBe(rest.footerColour);
  expect(rest.underline, name).toContain('underline');
  expect(wcagContrast(rest.colour, rest.background), name).toBeGreaterThanOrEqual(4.5);
  await link.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(link).toBeFocused();
  const ring = await link.evaluate((element) => {
    const shadows = getComputedStyle(element).boxShadow.split(/,(?![^(]*\))/);
    const colours = shadows.map((shadow) => /rgba?\([^)]*\)/.exec(shadow)?.[0] ?? '');
    const background = getComputedStyle(element.closest('footer') ?? element).backgroundColor;
    return { colours, background };
  });
  expect(ring.colours, name).toHaveLength(2);
  expect(wcagContrast(ring.colours[1] ?? '', ring.background), name).toBeGreaterThanOrEqual(3);
  expect(wcagContrast(ring.colours[1] ?? '', ring.colours[0] ?? ''), name).toBeGreaterThanOrEqual(3);
}

/** The routes of the shell with the level-1 heading of each page. */
export const ROUTES = [
  { path: '/', heading: 'Connect' },
  { path: '/diagram', heading: 'Diagram' },
  { path: '/snapshots', heading: 'Snapshots' },
  { path: '/permissions', heading: 'Permissions' },
  { path: '/settings', heading: 'Settings' },
] as const;

export function primaryNav(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Primary' });
}

/**
 * Reads a stored preference straight from IndexedDB (database `gcportrait`, store `preferences`).
 * Never creates the database: if it does not exist yet the version-change transaction is aborted.
 */
export async function readStoredPreference(page: Page, key: string): Promise<unknown> {
  return page.evaluate(
    (preferenceKey) =>
      new Promise<unknown>((resolve) => {
        const request = indexedDB.open('gcportrait');
        request.onupgradeneeded = () => {
          request.transaction?.abort();
        };
        request.onerror = () => {
          resolve(undefined);
        };
        request.onsuccess = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains('preferences')) {
            db.close();
            resolve(undefined);
            return;
          }
          const get = db.transaction('preferences').objectStore('preferences').get(preferenceKey);
          get.onsuccess = () => {
            db.close();
            resolve(get.result);
          };
          get.onerror = () => {
            db.close();
            resolve(undefined);
          };
        };
      }),
    key,
  );
}

export async function readStoredTheme(page: Page): Promise<unknown> {
  return readStoredPreference(page, 'theme');
}

/** Collects the paths of every request the page makes to the backend API. */
export function recordApiRequests(page: Page): string[] {
  const paths: string[] = [];
  page.on('request', (request) => {
    const { pathname } = new URL(request.url());
    if (pathname === '/api' || pathname.startsWith('/api/')) paths.push(pathname);
  });
  return paths;
}

/**
 * Runs axe-core (all non-experimental rules, best practices included) on the page (or `scope` when given)
 * as it is now, after the web fonts have loaded, and fails with a readable summary of any violation (WCAG 2.2 AA).
 */
export async function expectNoAxeViolations(page: Page, scope?: string): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  const builder = new AxeBuilder({ page });
  if (scope !== undefined) builder.include(scope);
  const results = await builder.analyze();
  const violations = results.violations.map((violation) => ({
    rule: violation.id,
    impact: violation.impact,
    help: violation.help,
    targets: violation.nodes.map((node) => node.target.join(' ')),
  }));
  expect(violations).toEqual([]);
}

/** The repository's root, where the demo generator runs. */
const REPO = path.resolve(import.meta.dirname, '..', '..');

/** The demo exports this worker has generated, by their path. */
const generatedExports = new Set<string>();

/**
 * Demo organisation `size` on `day` (`YYYY-MM-DD`) as a Cloud Asset Inventory export of its organisation (the demo
 * generator's `cai-export` format: one asset per line, the protobuf spelling), written once per worker as
 * `export.json` under the project's test output; answers its path.
 */
export function demoCaiExport(testInfo: TestInfo, size: 'S' | 'M', day: string): string {
  const dir = path.join(
    testInfo.project.outputDir,
    `cai-export-${size}-${day}`,
    `worker-${String(testInfo.workerIndex)}`,
  );
  const lines = path.join(dir, 'export.json');
  if (generatedExports.has(lines)) return lines;
  mkdirSync(dir, { recursive: true });
  execFileSync(
    'pnpm',
    [
      '--silent',
      '--filter',
      '@gcportrait/demo-data',
      'generate',
      '--size',
      size,
      '--format',
      'cai-export',
      '--tick',
      day,
      '--out',
      lines,
    ],
    { cwd: REPO, stdio: 'ignore' },
  );
  generatedExports.add(lines);
  return lines;
}

/**
 * The `operation.json` of a finished export of `parent` (`organizations/…`) that was read at `readTime`, as
 * `gcloud asset operations describe` writes it: the sidecar an import takes the export's read time and scope from.
 */
export function exportOperation(parent: string, readTime: string): string {
  return JSON.stringify({
    name: `${parent}/operations/ExportAssets/RESOURCE/7`,
    metadata: {
      '@type': 'type.googleapis.com/google.cloud.asset.v1.ExportAssetsRequest',
      contentType: 'RESOURCE',
      parent,
    },
    done: true,
    response: {
      '@type': 'type.googleapis.com/google.cloud.asset.v1.ExportAssetsResponse',
      readTime,
    },
  });
}

/** The diagram of demo organisation M (the e2e suite's diagram fixture). */
export const DEMO_M_DIAGRAM = '/diagram#snapshot=demo:M';

/** The canvas `<svg>` once a drawing is on it, fitted and interactive (frontend/src/diagram/DiagramCanvas.tsx). */
export const DRAWN_CANVAS = 'svg.dg-canvas[data-diagram-ready="true"]';

export function detailsDrawer(page: Page): Locator {
  return page.getByRole('complementary', { name: 'Details' });
}

/**
 * Waits until both workers have answered and a diagram is drawn on the page; returns the canvas `<svg>`. The canvas
 * stays ready while the next view is prepared, its drawing still on it, so after a view change this answers at once
 * with that drawing: a spec that needs the next one reads `drawingOf` before the change and waits with
 * `redrawnCanvas` after it.
 */
export async function drawnCanvas(page: Page): Promise<Locator> {
  const svg = page.locator(DRAWN_CANVAS);
  await expect(svg).toBeVisible({ timeout: 60_000 });
  return svg;
}

/**
 * The number of the drawing on the canvas (`data-drawing`), once one is drawn: every drawing the canvas puts up (a
 * new view, or the same view in another theme) takes the page's next number. A selection, a hover or a pan leaves
 * it unchanged. Read before a view change, for `redrawnCanvas`.
 */
export async function drawingOf(page: Page): Promise<string> {
  const drawing = await (await drawnCanvas(page)).getAttribute('data-drawing');
  if (drawing === null) throw new Error('the canvas numbers no drawing');
  return drawing;
}

/**
 * Waits until the canvas holds a drawing after `previous` (`drawingOf`, read before the view changed: a lens, a
 * focus, a filter, a flip, a drill-in, a snapshot, a day of the timeline, Back), fitted and interactive; returns the
 * canvas `<svg>`.
 */
export async function redrawnCanvas(page: Page, previous: string): Promise<Locator> {
  await expect(page.locator(`${DRAWN_CANVAS}:not([data-drawing="${previous}"])`)).toBeVisible({
    timeout: 60_000,
  });
  return page.locator(DRAWN_CANVAS);
}

/**
 * Opens a diagram view and waits until both workers have answered and the SVG is drawn, and the web fonts
 * have loaded. Returns the canvas `<svg>`. A page loaded afresh needs no previous drawing number, as its first
 * drawing is its view's. A spec that opens another view of the diagram it is on loads `about:blank` first,
 * since an address that changes only the hash keeps the page and its drawing.
 */
export async function openDiagram(page: Page, address: string = DEMO_M_DIAGRAM): Promise<Locator> {
  await page.goto(address);
  const svg = await drawnCanvas(page);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  return svg;
}

/** The view in the address: its hash, `#` included, percent-decoded for reading. */
export function hashOf(page: Page): string {
  return decodeURIComponent(new URL(page.url()).hash);
}

/** A value of the view in the address (`selection`, `root`, `lens`, `flips`), or null. */
export function viewParam(page: Page, name: string): string | null {
  return new URLSearchParams(new URL(page.url()).hash.slice(1)).get(name);
}

/**
 * Waits until the camera stands still (a glide of 200 ms has ended): two reads of the viewport's transform and the
 * canvas's scale, at least 100 ms apart, agree. Answers the scale (`data-scale`).
 * A panel's refit, a flip's framing or a jump can glide the camera without drawing anything new.
 */
export async function cameraSettled(svg: Locator): Promise<number> {
  const read = (): Promise<string> =>
    svg.evaluate(
      (element) =>
        `${element.getAttribute('data-scale') ?? ''} ${element.querySelector('.dg-viewport')?.getAttribute('transform') ?? ''}`,
    );
  // The first read only starts the comparison, so that two reads always lie an interval apart.
  let last: string | undefined;
  await expect
    .poll(
      async () => {
        const now = await read();
        const still = now === last;
        last = now;
        return still;
      },
      { intervals: [150], timeout: 10_000 },
    )
    .toBe(true);
  return Number(await svg.getAttribute('data-scale'));
}

/** An element's box on the screen, in CSS pixels. */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The box of what `locator` points at; fails when it is not rendered. */
export async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error('not rendered');
  return box;
}

/** Whether `inner` lies inside `outer`, give or take `slack` pixels of rounding. */
export function inside(inner: Box, outer: Box, slack = 0.5): boolean {
  return (
    inner.x >= outer.x - slack &&
    inner.y >= outer.y - slack &&
    inner.x + inner.width <= outer.x + outer.width + slack &&
    inner.y + inner.height <= outer.y + outer.height + slack
  );
}

/** WCAG 2.2's relative luminance of a colour given by its 0–255 channels. */
export function relativeLuminance(r: number, g: number, b: number): number {
  const channel = (value: number): number => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2.2's contrast ratio of two relative luminances. */
export function contrastRatio(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** The 0–255 channels of a colour written `#rrggbb` or `rgb(…)`/`rgba(…)` (as getComputedStyle answers). */
function channelsOf(colour: string): [number, number, number] {
  if (colour.startsWith('#')) {
    const value = Number.parseInt(colour.slice(1, 7), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  }
  const [r = 0, g = 0, b = 0] = (colour.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
  return [r, g, b];
}

/** WCAG 2.2's contrast ratio of two colours, each `#rrggbb` or `rgb(…)`. */
export function wcagContrast(a: string, b: string): number {
  return contrastRatio(relativeLuminance(...channelsOf(a)), relativeLuminance(...channelsOf(b)));
}

/**
 * Whether a person asked for the screenshots scratchShot takes: `E2E_SHOTS=1`. CI never sets it, as nothing compares
 * those screenshots and no job uploads them.
 */
export const SHOTS_WANTED = process.env.E2E_SHOTS === '1';

/** Where screenshots for a person to look at go: e2e/.scratch/ (git-ignored). */
const SCRATCH = path.resolve(import.meta.dirname, '..', '.scratch');

/**
 * With `E2E_SHOTS=1` (SHOTS_WANTED), saves a screenshot of the page or of one element as
 * e2e/.scratch/<dir>/<name>.png once the web fonts have loaded, for a person to look at (the specs assert nothing on
 * it). Without it, returns at once and leaves the page alone.
 */
export async function scratchShot(
  target: Page | Locator,
  dir: string,
  name: string,
  options: { readonly clip?: Box; readonly fullPage?: boolean } = {},
): Promise<void> {
  if (!SHOTS_WANTED) return;
  const page = 'goto' in target ? target : target.page();
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  const file = path.join(SCRATCH, dir, `${name}.png`);
  if ('goto' in target) await target.screenshot({ path: file, ...options });
  else await target.screenshot({ path: file });
}
