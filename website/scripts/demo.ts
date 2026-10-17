// SPDX-License-Identifier: MIT
/**
 * `pnpm --filter @gcportrait/website demo`: the static demo (/demo/) in the built site (website/dist), served
 * the way GitHub Pages serves it (scripts/serve.ts: no rewrites, `x.html` for `x`, the site's 404 page for anything
 * else), in a real browser. Run after `pnpm website:build`. Exit code 0 when clean, 1 with every problem listed, 2 on a
 * usage error.
 *
 * In Playwright's Chromium at 1440 × 900 (a desktop window; the app's own phone and tablet check covers the narrower
 * layouts), in the light and the dark theme:
 * - /demo/ boots the app on its Connect page in the theme asked for: only "Try the demo" with the sizes S to XL, the
 *   way to one's own project, the footer's non-affiliation notice, "Source (MIT)" and the Impressum and the
 *   privacy notice on the maintainer's website (each in a new tab), the favicon; axe-core finds nothing;
 * - "Try the demo" with S, M and L (light theme; M in the dark one) draws each organisation on /demo/diagram;
 * - drilling in (the drawer's "Details" on a project of M), a day back on the timeline (`[`), and an export (PNG and SVG
 *   from the Export menu) work; axe-core finds nothing on the diagram;
 * - a reload on that deep link (/demo/diagram#…, the view in the hash) draws the same view again, and a direct load of
 *   every other route (/demo/snapshots, /demo/settings, /demo/permissions, /demo/impressum, /demo/privacy) boots the
 *   app there; /demo without its slash is redirected; an unknown address below /demo/ is the site's 404 page;
 * - throughout: no request leaves the site's origin, no Content Security Policy violation, no uncaught error.
 *
 *   pnpm --filter @gcportrait/website demo [--theme light|dark]... [--shots DIR] [--dist DIR]
 *
 * `--shots DIR` saves screenshots of the Connect page and of diagrams there. Chromium from
 * `pnpm --filter @gcportrait/e2e install-browsers`; axe-core is read from the e2e package's dependency.
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright';

import { DEMO_URL, IMPRESSUM_URL, MAINTAINER_URL, PRIVACY_URL, REPOSITORY_URL } from '../src/site.js';
import { KEEP_NAMES_SHIM, WEBSITE, axeProblems, axeSource } from './browser.js';
import { serve } from './serve.js';

const VIEWPORT = { width: 1440, height: 900 };
const THEMES = ['light', 'dark'] as const;
type Theme = (typeof THEMES)[number];
/** Generating and drawing demo L takes a while on a slow machine. */
const DRAW_TIMEOUT = 180_000;
const STEP_TIMEOUT = 30_000;
/** A project of demo organisation M ("Retail batch VMs (prod)"), to drill into. */
const PROJECT = '//cloudresourcemanager.googleapis.com/projects/10000000013';
/** The app's routes besides the start page, each with a word its page shows. */
const ROUTES: readonly { readonly path: string; readonly heading: string }[] = [
  { path: 'snapshots', heading: 'Snapshots' },
  { path: 'settings', heading: 'Settings' },
  { path: 'permissions', heading: 'Permissions' },
  { path: 'impressum', heading: 'Impressum' },
  { path: 'privacy', heading: 'Privacy notice' },
];

class UsageError extends Error {}

/** What a context saw that it must not: requests elsewhere, policy violations, errors. */
type Watch = { readonly problems: string[] };

async function watched(
  browser: Browser,
  base: string,
  theme: Theme,
): Promise<{ context: BrowserContext; watch: Watch }> {
  const context = await browser.newContext({ viewport: VIEWPORT, colorScheme: theme, acceptDownloads: true });
  const watch: Watch = { problems: [] };
  const origin = new URL(base).origin;
  context.on('request', (request) => {
    const url = request.url();
    if (url.startsWith('data:') || url.startsWith('blob:')) return;
    if (new URL(url).origin !== origin) watch.problems.push(`a request left the site: ${url}`);
  });
  await context.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { cspViolations: string[] }).cspViolations = seen;
    document.addEventListener('securitypolicyviolation', (event) => {
      seen.push(`${event.violatedDirective} refused ${event.blockedURI || '(inline)'}`);
    });
  });
  await context.addInitScript({ content: KEEP_NAMES_SHIM });
  context.on('page', (page) => {
    page.on('pageerror', (error) => {
      watch.problems.push(`an uncaught error on ${page.url()}: ${error.message}`);
    });
    page.on('console', (message) => {
      if (message.type() === 'error' && /Content Security Policy|Refused to/i.test(message.text()))
        watch.problems.push(`the console on ${page.url()}: ${message.text()}`);
    });
  });
  return { context, watch };
}

async function violations(page: Page): Promise<string[]> {
  try {
    return await page.evaluate(() => [
      ...((window as unknown as { cspViolations?: string[] }).cspViolations ?? []),
    ]);
  } catch (error) {
    return [`could not be read: ${error instanceof Error ? error.message : String(error)}`];
  }
}

async function visible(locator: Locator, what: string, timeout = STEP_TIMEOUT): Promise<void> {
  try {
    await locator.first().waitFor({ state: 'visible', timeout });
  } catch {
    throw new Error(`${what} did not appear within ${String(timeout / 1000)} s`);
  }
}

/** The canvas `<svg>` once a drawing is on it, fitted and interactive (frontend/src/diagram/DiagramCanvas.tsx). */
const DRAWN_CANVAS = 'svg.dg-canvas[data-diagram-ready="true"]';

/**
 * The number of the drawing on the canvas (`data-drawing`), once one is drawn: every drawing the canvas puts up takes
 * the page's next number. Read before a view change, for `drawn`'s `previous`.
 */
async function drawingOf(page: Page): Promise<string> {
  const drawing = await page.locator(DRAWN_CANVAS).getAttribute('data-drawing', { timeout: DRAW_TIMEOUT });
  if (drawing === null) throw new Error('the canvas numbers no drawing');
  return drawing;
}

/**
 * Waits until a drawing is on the canvas, fitted and interactive, and the web fonts have loaded. The canvas stays
 * ready while the next view is prepared, the drawing before it still on it, so after a view change (a drill-in, a day
 * of the timeline) `previous`, the number `drawingOf` read before the change, makes it wait for a drawing after that
 * one; without it, it waits for the first drawing of a page just loaded.
 */
async function drawn(page: Page, what: string, previous?: string): Promise<void> {
  const canvas =
    previous === undefined
      ? page.locator(DRAWN_CANVAS)
      : page.locator(`${DRAWN_CANVAS}:not([data-drawing="${previous}"])`);
  await visible(canvas, `the diagram of ${what}`, DRAW_TIMEOUT);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

/** The view in an address: its hash, percent-decoded. */
function hashOf(address: string | URL): string {
  return decodeURIComponent(new URL(address).hash);
}

/**
 * Waits until the page's address holds `part` in its hash. The app writes the view there through the history API, a
 * navigation within the page (no new document), which Playwright follows.
 */
async function waitForHash(page: Page, part: string): Promise<void> {
  try {
    await page.waitForURL((url) => hashOf(url).includes(part), { timeout: STEP_TIMEOUT });
  } catch {
    throw new Error(`the address never got ${part} (it is ${page.url()})`);
  }
}

/**
 * axe-core's violations. The demo's policy refuses inline scripts, as it should, so axe is not added as a `<script>`
 * (browser.ts's way) but evaluated through the browser's DevTools protocol, which the page's policy does not govern.
 */
async function axeOn(page: Page, source: string): Promise<string[]> {
  if (!(await page.evaluate(() => 'axe' in window))) await page.evaluate(source);
  return axeProblems(page, source);
}

async function shot(page: Page, shots: string | undefined, name: string): Promise<void> {
  if (shots === undefined) return;
  await page.screenshot({ path: path.join(shots, `${name}.png`) });
}

/** The Connect page at /demo/: what it offers, the footer, the favicon, the theme, axe. */
async function checkConnect(
  page: Page,
  base: string,
  theme: Theme,
  axe: string,
  shots?: string,
): Promise<string[]> {
  const problems: string[] = [];
  const response = await page.goto(`${base}${DEMO_URL}`);
  if (response?.status() !== 200) problems.push(`${DEMO_URL} answered ${String(response?.status())}`);
  const sources = page.getByRole('region', { name: 'Demo mode' });
  await visible(sources, 'the Connect page’s demo section');
  const radios = await sources.getByRole('radiogroup', { name: 'Size' }).getByRole('radio').allTextContents();
  if (radios.join(',') !== 'S,M,L,XL') problems.push(`the sizes on offer are ${radios.join(',')}`);
  if ((await page.getByRole('button', { name: 'Sign in with Google' }).count()) > 0)
    problems.push('the Connect page offers sign-in');
  if ((await page.getByRole('region', { name: 'Your own Google Cloud' }).count()) !== 1)
    problems.push('the Connect page lacks the way to one’s own project');
  if ((await page.getByTestId('demo-badge').count()) !== 1) problems.push('the top bar has no demo badge');
  const footer = page.getByRole('contentinfo');
  const links = await footer
    .getByRole('link')
    .evaluateAll((anchors) =>
      anchors.map((anchor) => [
        anchor.getAttribute('aria-label') ?? anchor.textContent.trim(),
        anchor.getAttribute('href') ?? '',
      ]),
    );
  const expected = [
    ['Florian Chrometz (personal website)', MAINTAINER_URL],
    ['Source (MIT)', REPOSITORY_URL],
    ['Impressum (opens florian-chrometz.de in a new tab)', IMPRESSUM_URL],
    ['Privacy (opens florian-chrometz.de in a new tab)', PRIVACY_URL],
  ];
  if (JSON.stringify(links) !== JSON.stringify(expected))
    problems.push(`the footer links ${JSON.stringify(links)}, not ${JSON.stringify(expected)}`);
  // The legal pages open in a new tab: following them in the app's tab would end a signed-in session.
  const legal = await footer
    .getByRole('navigation', { name: 'Legal' })
    .getByRole('link')
    .evaluateAll((anchors) =>
      anchors.map((anchor) => [anchor.getAttribute('target') ?? '', anchor.getAttribute('rel') ?? '']),
    );
  if (legal.length !== 2 || legal.some(([target, rel]) => target !== '_blank' || rel !== 'noopener'))
    problems.push(
      `the footer's legal links open with ${JSON.stringify(legal)}, not a new tab with rel="noopener"`,
    );
  const icon = await page.locator('link[rel="icon"]').getAttribute('href');
  if (icon !== `${DEMO_URL}favicon.svg`) problems.push(`the favicon is ${String(icon)}`);
  const favicon = await page.request.get(`${base}${DEMO_URL}favicon.svg`);
  if (favicon.status() !== 200) problems.push(`the favicon answered ${String(favicon.status())}`);
  const shown = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  if (shown !== theme) problems.push(`the page is in the ${String(shown)} theme, not ${theme}`);
  const title = await page.title();
  if (title !== 'Connect · gcportrait') problems.push(`the title is "${title}"`);
  problems.push(...(await axeOn(page, axe)).map((problem) => `Connect page: ${problem}`));
  await shot(page, shots, `connect-${theme}`);
  return problems;
}

/** "Try the demo" with one size, from the Connect page, to its diagram. */
async function tryTheDemo(page: Page, base: string, size: 'S' | 'M' | 'L'): Promise<void> {
  await page.goto(`${base}${DEMO_URL}`);
  const sources = page.getByRole('region', { name: 'Demo mode' });
  await visible(sources, 'the Connect page’s demo section');
  await sources.getByRole('radio', { name: size, exact: true }).click();
  await sources.getByRole('button', { name: 'Try the demo' }).click();
  await waitForHash(page, `snapshot=demo:${size}`);
  if (new URL(page.url()).pathname !== `${DEMO_URL}diagram`)
    throw new Error(`"Try the demo" with ${size} went to ${page.url()}`);
  await drawn(page, `demo ${size}`);
}

/** Drill in, a day back, the exports, a reload on the deep link. */
async function checkDiagram(
  page: Page,
  base: string,
  theme: Theme,
  axe: string,
  shots?: string,
): Promise<string[]> {
  const problems: string[] = [];
  // A page loaded afresh, whose first drawing is this view's: from the diagram of the demo tried last, an address
  // that changes only the hash keeps the page, and that demo's drawing on the canvas until this one replaces it.
  await page.goto('about:blank');
  await page.goto(`${base}${DEMO_URL}diagram#snapshot=demo:M&lens=compute&selection=${PROJECT}`);
  await drawn(page, 'demo M with a project selected');
  const drawer = page.getByRole('complementary', { name: 'Details' });
  await visible(drawer, 'the details drawer');
  const organisation = await drawingOf(page);
  await drawer.getByRole('button', { name: 'Details' }).click();
  await waitForHash(page, `root=${PROJECT}`);
  await drawn(page, 'the drilled-in project', organisation);
  const ownDay = await drawingOf(page);
  await page.keyboard.press('[');
  await waitForHash(page, 'tick=');
  await drawn(page, 'the day before', ownDay);
  problems.push(...(await axeOn(page, axe)).map((problem) => `diagram: ${problem}`));
  await shot(page, shots, `diagram-M-drilled-in-${theme}`);

  for (const action of ['Download PNG', 'Download SVG'] as const) {
    await page.getByRole('banner').getByRole('button', { name: 'Export' }).click();
    const menu = page.getByRole('menu', { name: 'Export' });
    await visible(menu, 'the Export menu');
    const pending = page.waitForEvent('download', { timeout: STEP_TIMEOUT });
    await menu.getByRole('menuitem', { name: action }).click();
    const download = await pending;
    const file = await download.path();
    const name = download.suggestedFilename();
    const expected = action === 'Download PNG' ? '.png' : '.svg';
    if (!name.endsWith(expected)) problems.push(`${action} saved ${name}`);
    if (!existsSync(file)) problems.push(`${action} saved nothing`);
    await page.keyboard.press('Escape');
  }

  const deepLink = page.url();
  await page.reload();
  await drawn(page, 'the deep link after a reload');
  if (page.url() !== deepLink) problems.push(`the reload of ${deepLink} ended on ${page.url()}`);
  if (!hashOf(page.url()).includes(`root=${PROJECT}`)) problems.push('the reload lost the drill-in');
  const scope = await page.getByRole('navigation', { name: 'Scope' }).textContent();
  if (!(scope ?? '').includes('Retail batch VMs (prod)'))
    problems.push(`after the reload the scope reads "${scope ?? ''}", not the drilled-in project`);
  return problems;
}

/** A direct load of every other route, /demo without its slash, an unknown address. */
async function checkRoutes(page: Page, base: string): Promise<string[]> {
  const problems: string[] = [];
  for (const route of ROUTES) {
    const response = await page.goto(`${base}${DEMO_URL}${route.path}`);
    if (response?.status() !== 200)
      problems.push(`${DEMO_URL}${route.path} answered ${String(response?.status())}`);
    try {
      await visible(
        page.getByRole('heading', { level: 1, name: route.heading }),
        `the ${route.heading} page`,
      );
    } catch (error) {
      problems.push(`${DEMO_URL}${route.path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  await page.goto(`${base}${DEMO_URL}impressum`);
  const impressum = page
    .getByRole('main')
    .getByRole('link', { name: `${IMPRESSUM_URL} (opens florian-chrometz.de in a new tab)`, exact: true });
  if ((await impressum.count()) !== 1) problems.push(`${DEMO_URL}impressum does not link ${IMPRESSUM_URL}`);
  else if ((await impressum.getAttribute('target')) !== '_blank')
    problems.push(`${DEMO_URL}impressum links ${IMPRESSUM_URL} in the same tab`);
  const bare = await page.goto(`${base}${DEMO_URL.replace(/\/$/, '')}`);
  if (new URL(page.url()).pathname !== DEMO_URL || bare?.status() !== 200)
    problems.push(`${DEMO_URL.replace(/\/$/, '')} ended on ${page.url()} (${String(bare?.status())})`);
  const unknown = await page.goto(`${base}${DEMO_URL}no-such-page`);
  if (unknown?.status() !== 404)
    problems.push(`${DEMO_URL}no-such-page answered ${String(unknown?.status())}`);
  const back = await page.getByRole('link', { name: 'Try the demo' }).first().getAttribute('href');
  if (back !== DEMO_URL) problems.push(`the 404 page's "Try the demo" goes to ${String(back)}`);
  return problems;
}

async function main(argv: readonly string[]): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      theme: { type: 'string', multiple: true, default: [] },
      shots: { type: 'string' },
      dist: { type: 'string' },
    },
  });
  const themes = values.theme.length > 0 ? values.theme : [...THEMES];
  for (const theme of themes)
    if (theme !== 'light' && theme !== 'dark') throw new UsageError(`--theme ${theme}`);
  const dist = path.resolve(values.dist ?? path.join(WEBSITE, 'dist'));
  if (!existsSync(path.join(dist, DEMO_URL.slice(1), 'index.html'))) {
    console.error(`demo: no static demo in ${dist}; run \`pnpm website:build\` first`);
    return 1;
  }
  const shots = values.shots === undefined ? undefined : path.resolve(values.shots);
  if (shots !== undefined) mkdirSync(shots, { recursive: true });
  const axe = axeSource();
  const { base, close } = await serve(dist);
  const browser = await chromium.launch();
  const problems: string[] = [];
  try {
    for (const theme of themes as Theme[]) {
      const { context, watch } = await watched(browser, base, theme);
      const page = await context.newPage();
      const step = async (name: string, run: () => Promise<string[]>): Promise<void> => {
        const started = Date.now();
        try {
          const found = await run();
          problems.push(...found.map((problem) => `${theme}, ${name}: ${problem}`));
          console.log(
            `demo: ${theme}, ${name}: ${found.length === 0 ? 'OK' : found.join('; ')} (${String(Math.round((Date.now() - started) / 1000))} s)`,
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          problems.push(`${theme}, ${name}: ${message}`);
          console.log(`demo: ${theme}, ${name}: failed: ${message.split('\n')[0] ?? ''}`);
        }
        problems.push(...(await violations(page)).map((violation) => `${theme}, ${name}: CSP ${violation}`));
      };
      await step('Connect page', () => checkConnect(page, base, theme, axe, shots));
      const sizes = theme === 'light' ? (['S', 'M', 'L'] as const) : (['M'] as const);
      for (const size of sizes) {
        await step(`Try the demo ${size}`, async () => {
          await tryTheDemo(page, base, size);
          await shot(page, shots, `diagram-${size}-${theme}`);
          return [];
        });
      }
      await step('drill in, timeline, export, reload', () => checkDiagram(page, base, theme, axe, shots));
      await step('routes', () => checkRoutes(page, base));
      problems.push(...watch.problems.map((problem) => `${theme}: ${problem}`));
      await context.close();
    }
  } finally {
    await browser.close();
    await close();
  }
  if (problems.length > 0) {
    console.error(`demo: ${String(problems.length)} problem(s):`);
    for (const problem of problems) console.error(`  - ${problem}`);
    return 1;
  }
  console.log(
    `demo: ${DEMO_URL} works from the built site served statically (${themes.join(' and ')}: Connect page, S/M/L, drill-in, timeline, PNG and SVG export, reload on a deep link, every route, 404; axe, no CSP violation, no request elsewhere).`,
  );
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(`demo: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = error instanceof UsageError || (error instanceof Error && 'code' in error) ? 2 : 1;
  },
);
