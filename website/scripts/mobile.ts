// SPDX-License-Identifier: MIT
/**
 * `pnpm --filter @gcportrait/website mobile`: the built site (website/dist) on phones, in a real browser. Run after
 * `pnpm website:build`. Exit code 0 when clean, 1 with every problem listed, 2 on a usage error.
 *
 * Layout (Playwright's Chromium): every page of the sitemap but the demo (the app at /demo/, which has its own phone
 * and tablet check, `pnpm --filter @gcportrait/frontend mobile`) and the 404 page, at 320, 375, 390 and 430 CSS
 * pixels wide,
 * in the light and the dark theme, with the disclosures (the header's menu, the docs menu and contents) folded and
 * then unfolded. It fails when
 * - the page scrolls sideways, or an element reaches past the viewport's edge without a box that scrolls it;
 * - two items of the header (links, buttons) overlap, or one leaves the viewport;
 * - the header does not stay at the top of the window once the page is scrolled to its end, or an anchor jump to the
 *   page's last level-2 heading leaves the heading under the header (the header is sticky);
 * - a link or button that is not inline text (its display is not `inline`; prose is left out) is smaller than 44 × 44
 *   CSS pixels;
 * - axe-core finds a violation (all its non-experimental rules, as the app's end-to-end tests run it; folded at every
 *   width, unfolded at 375);
 * - the name Chromium gives a link or a button (its accessibility tree, as a screen reader reads it; unfolded, at the
 *   first width) has a space before a punctuation mark, as "Open SVG , Demo S" (axe-core does not look at it).
 *
 * Playback (the animated demos of the landing page): an iPhone 15 on Playwright's WebKit and a Pixel 7 on its
 * Chromium, with their device descriptors (viewport, pixel ratio, touch, user agent), both themes. Each demo is
 * scrolled into view and must play, as WebM or as the GIF fallback; its button must pause it (a video stops on its
 * frame, a GIF gives way to the poster) and play it again. Then, on each device: the GIF fallback when the browser
 * says it cannot play WebM, and when the WebM fails to load; with reduced motion, nothing plays until the Play
 * button is pressed. Every request must stay on the site's own host, but for the header's repository widget.
 *
 * The header's repository widget (docs/website.md, "GitHub repository widget") is answered by the check, never by
 * GitHub: with a 404, as GitHub answers for a private repository, so nothing changes; with `--stars N`, N stars,
 * `--forks` forks (N unless given) and the release `--release` (v1.0.0 unless given), shown (or added where the build
 * had none) before the layout is measured.
 *
 *   pnpm --filter @gcportrait/website mobile [--only layout|playback] [--page /docs/]... [--theme dark] [--width 375]...
 *                                            [--stars 12345 [--forks 678] [--release v1.2.3]]
 *                                            [--dist DIR]   (another build than website/dist)
 *
 * Browsers: Chromium from `pnpm --filter @gcportrait/e2e install-browsers`; WebKit once per machine with
 * `pnpm --filter @gcportrait/website exec playwright install webkit`. axe-core is read from the e2e package's
 * dependency (@axe-core/playwright), so the website adds no dependency for it.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { chromium, devices, webkit, type Browser, type BrowserType, type Page } from 'playwright';

import { formatCount, isReleaseTag } from '../src/lib/star-count.js';
import { DEMO_URL, SITE_URL } from '../src/site.js';
import {
  KEEP_NAMES_SHIM,
  WEBSITE,
  answerRepositoryRequests,
  axeProblems,
  axeSource,
  isRepositoryRequest,
  settle,
  timeoutGives,
  type MockedFacts,
} from './browser.js';
import { SPACE_BEFORE_PUNCTUATION } from './check-site.js';
import { serve } from './serve.js';

const WIDTHS: readonly number[] = [320, 375, 390, 430];
const HEIGHT = 800;
/** The width at which the unfolded disclosures are also checked with axe-core. */
const AXE_UNFOLDED_WIDTH = 375;
const THEMES = ['light', 'dark'] as const;
type Theme = (typeof THEMES)[number];
/** The smallest touch target, in CSS pixels (WCAG 2.5.5's 44 × 44; a little rounding allowed). */
const TARGET = 43.5;

class UsageError extends Error {}

/**
 * The site's pages: the sitemap's and the 404 page, without the demo (/demo/), which is the app, checked by the e2e
 * suite (its phone and tablet layouts by `pnpm --filter @gcportrait/frontend mobile`) and `pnpm --filter
 * @gcportrait/website demo`.
 */
function sitemapPages(dist: string): string[] {
  const sitemap = readFileSync(path.join(dist, 'sitemap.xml'), 'utf8');
  return [
    ...[...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)]
      .map((match) => (match[1] ?? '').slice(SITE_URL.length))
      .filter((page) => !page.startsWith(DEMO_URL)),
    '/404.html',
  ];
}

/** Overflow, the header's items, touch targets: the problems at the current width, without the page's prefix. */
function layoutProblems(page: Page, target: number): Promise<string[]> {
  return page.evaluate((minimum) => {
    const problems: string[] = [];
    const width = document.documentElement.clientWidth;
    const name = (element: Element): string => {
      const classes = [...element.classList].filter((item) => !item.startsWith('astro-')).slice(0, 2);
      const text = element.textContent.trim().replace(/\s+/g, ' ').slice(0, 30);
      return `<${element.tagName.toLowerCase()}${classes.length > 0 ? `.${classes.join('.')}` : ''}>${text === '' ? '' : ` "${text}"`}`;
    };
    const shown = (element: Element): boolean => {
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== 'hidden';
    };
    // Text for assistive technology only (.visually-hidden): absolutely placed and clipped to nothing.
    const visuallyHidden = (element: Element): boolean => {
      const style = getComputedStyle(element);
      const clip = style.getPropertyValue('clip');
      return style.position === 'absolute' && ((clip !== '' && clip !== 'auto') || style.clipPath !== 'none');
    };
    const scrolledOrClipped = (element: Element): boolean => {
      for (
        let parent = element.parentElement;
        parent !== null && parent !== document.body;
        parent = parent.parentElement
      ) {
        if (getComputedStyle(parent).overflowX !== 'visible') return true;
      }
      return false;
    };

    const scrollWidth = document.documentElement.scrollWidth;
    const outside: string[] = [];
    for (const element of document.body.querySelectorAll('*')) {
      const box = element.getBoundingClientRect();
      if (box.width === 0 && box.height === 0) continue;
      if (box.left >= -0.5 && box.right <= width + 0.5) continue;
      if (visuallyHidden(element) || scrolledOrClipped(element)) continue;
      outside.push(`${name(element)} at ${String(Math.round(box.left))}–${String(Math.round(box.right))}`);
    }
    if (scrollWidth > width)
      problems.push(`the page scrolls sideways (${String(scrollWidth)} > ${String(width)} px)`);
    if (outside.length > 0) {
      problems.push(
        `${String(outside.length)} element(s) reach past the viewport (0–${String(width)}): ${outside.slice(0, 4).join('; ')}`,
      );
    }

    const items = [...document.querySelectorAll('.site-header a, .site-header button')].filter(shown);
    items.forEach((item, index) => {
      const a = item.getBoundingClientRect();
      if (a.left < -0.5 || a.right > width + 0.5)
        problems.push(`the header's ${name(item)} leaves the viewport`);
      for (const other of items.slice(index + 1)) {
        const b = other.getBoundingClientRect();
        const overlap =
          Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
          Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
        if (overlap > 1) problems.push(`the header's ${name(item)} and ${name(other)} overlap`);
      }
    });

    const small: string[] = [];
    for (const element of document.querySelectorAll('a[href], button, summary')) {
      if (!shown(element) || element.closest('.prose') !== null || element.classList.contains('skip-link'))
        continue;
      if (getComputedStyle(element).display === 'inline') continue;
      const box = element.getBoundingClientRect();
      if (box.width < minimum || box.height < minimum) {
        small.push(`${name(element)} ${String(Math.round(box.width))}×${String(Math.round(box.height))}`);
      }
    }
    if (small.length > 0) {
      problems.push(`${String(small.length)} target(s) under 44 × 44 px: ${small.slice(0, 4).join('; ')}`);
    }
    return problems;
  }, target);
}

/**
 * The names Chromium gives the page's links and buttons, read from its accessibility tree over the DevTools protocol:
 * what a screen reader reads, which axe-core does not check. None may have a space before a punctuation mark. Text
 * for assistive technology only (.visually-hidden) is absolutely placed, so the browsers read it as a block, with a
 * space before it: a hidden part beginning with a comma reads "Open SVG , Demo S" (such a name is an `aria-label`,
 * as src/lib/exports.ts, exportLinkName, writes the sample exports' names).
 */
async function nameProblems(page: Page): Promise<string[]> {
  const session = await page.context().newCDPSession(page);
  try {
    const { nodes } = await session.send('Accessibility.getFullAXTree');
    const problems: string[] = [];
    for (const node of nodes) {
      const role: unknown = node.role?.value;
      const name: unknown = node.name?.value;
      if (node.ignored || (role !== 'link' && role !== 'button') || typeof name !== 'string') continue;
      const mark = SPACE_BEFORE_PUNCTUATION.exec(name)?.[1];
      if (mark !== undefined) problems.push(`a ${role} is named "${name}", with a space before "${mark}"`);
    }
    return problems;
  } finally {
    await session.detach();
  }
}

/**
 * With mocked facts: waits (3 s at most) for the header's repository widget to show the stars, so the layout is
 * measured with them. Where the script keeps the link as it was (it would move the header's items), the wait runs out.
 */
async function liveFacts(page: Page, facts: MockedFacts | undefined): Promise<void> {
  if (facts === undefined) return;
  await page
    .waitForFunction(
      (text) =>
        document.querySelector('.header-github [data-fact="stars"] .fact-value')?.textContent === text,
      formatCount(facts.stars),
      { timeout: 3000 },
    )
    .catch(timeoutGives(undefined));
  await settle(page);
}

/**
 * The sticky header at the current width: scrolled to the end of the page, the header is still at the top of the window
 * (within half a pixel), and an anchor jump to the page's last level-2 heading leaves the heading below the header. The
 * page is scrolled back to its top afterwards.
 */
async function stickyProblems(page: Page): Promise<string[]> {
  const problems = await page.evaluate(async () => {
    const found: string[] = [];
    const frame = (): Promise<void> =>
      new Promise((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      });
    const header = document.querySelector('.site-header');
    if (header === null) return ['no header'];
    const root = document.documentElement;
    if (root.scrollHeight > root.clientHeight + 100) {
      window.scrollTo(0, root.scrollHeight);
      await frame();
      const box = header.getBoundingClientRect();
      if (Math.abs(box.top) > 0.5 || box.bottom <= 0)
        found.push(`scrolled to the end, the header is at ${String(Math.round(box.top))} px, not at the top`);
    }
    const headings = [...document.querySelectorAll<HTMLElement>('main h2[id]')].filter(
      (heading) => heading.getBoundingClientRect().height > 0,
    );
    const target = headings[headings.length - 1];
    if (target !== undefined) {
      window.scrollTo(0, 0);
      await frame();
      location.hash = `#${encodeURIComponent(target.id)}`;
      await frame();
      const under = header.getBoundingClientRect().bottom;
      const top = target.getBoundingClientRect().top;
      const end = root.scrollTop + root.clientHeight >= root.scrollHeight - 1;
      if (top < under - 0.5 && !end)
        found.push(
          `an anchor jump to #${target.id} leaves it under the header (its top at ${String(Math.round(top))} px, the header's bottom at ${String(Math.round(under))} px)`,
        );
      history.replaceState(null, '', location.pathname + location.search);
    }
    window.scrollTo(0, 0);
    await frame();
    return found;
  });
  return problems;
}

/** Unfolds (true) or folds (false) every disclosure that is shown at this width; returns how many it pressed. */
async function setDisclosures(page: Page, open: boolean): Promise<number> {
  const toggles = page.locator(`[data-disclosure][aria-expanded="${open ? 'false' : 'true'}"]`);
  let pressed = 0;
  for (const toggle of await toggles.all()) {
    if (!(await toggle.isVisible())) continue;
    await toggle.click();
    pressed += 1;
  }
  await settle(page);
  return pressed;
}

async function layout(
  browser: Browser,
  base: string,
  pages: readonly string[],
  themes: readonly Theme[],
  widths: readonly number[],
  facts: MockedFacts | undefined,
): Promise<string[]> {
  const source = axeSource();
  const problems: string[] = [];
  for (const theme of themes) {
    const context = await browser.newContext({
      viewport: { width: widths[0] ?? 375, height: HEIGHT },
      colorScheme: theme,
      deviceScaleFactor: 2,
      hasTouch: true,
      isMobile: true,
    });
    await context.addInitScript(KEEP_NAMES_SHIM);
    await answerRepositoryRequests(context, facts);
    const page = await context.newPage();
    for (const pagePath of pages) {
      await page.setViewportSize({ width: widths[0] ?? 375, height: HEIGHT });
      await page.goto(`${base}${pagePath}`, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      await liveFacts(page, facts);
      const found: string[] = [];
      for (const width of widths) {
        await page.setViewportSize({ width, height: HEIGHT });
        await settle(page);
        const where = `${pagePath} ${String(width)} px ${theme}`;
        for (const problem of await layoutProblems(page, TARGET)) found.push(`${where}: ${problem}`);
        for (const problem of await stickyProblems(page)) found.push(`${where}: ${problem}`);
        for (const problem of await axeProblems(page, source)) found.push(`${where}: ${problem}`);
        const unfolded = await setDisclosures(page, true);
        // The names once per page and theme, with every disclosure unfolded, so no link is folded out of the tree.
        if (width === widths[0]) {
          for (const problem of await nameProblems(page)) found.push(`${pagePath} ${theme}: ${problem}`);
        }
        if (unfolded > 0) {
          for (const problem of await layoutProblems(page, TARGET))
            found.push(`${where}, unfolded: ${problem}`);
          if (width === AXE_UNFOLDED_WIDTH) {
            for (const problem of await axeProblems(page, source))
              found.push(`${where}, unfolded: ${problem}`);
          }
          await setDisclosures(page, false);
        }
      }
      console.log(
        `layout  ${theme.padEnd(5)} ${pagePath.padEnd(28)} ${found.length === 0 ? 'ok' : `${String(found.length)} problem(s)`}`,
      );
      problems.push(...found);
    }
    await context.close();
  }
  return problems;
}

type DemoState = 'video' | 'gif' | '';

/** How demo `index` of the page is showing: a playing video, a shown GIF, or neither. */
function demoState(page: Page, index: number): Promise<DemoState> {
  return page.evaluate((at) => {
    const root = document.querySelectorAll('[data-demo-video]')[at];
    const video = root?.querySelector('video');
    const gif = root?.querySelector<HTMLImageElement>('img.demo-video-gif');
    if (video !== null && video !== undefined && !video.hidden && !video.paused && video.currentTime > 0.1) {
      return 'video';
    }
    if (gif !== null && gif !== undefined && !gif.hidden && gif.complete && gif.naturalWidth > 0)
      return 'gif';
    return '';
  }, index);
}

async function waitForPlay(page: Page, index: number, timeoutMs = 20_000): Promise<DemoState> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const state = await demoState(page, index);
    if (state !== '' || Date.now() > until) return state;
    await page.waitForTimeout(150);
  }
}

/** The demo's video time, or undefined while a GIF (or nothing) shows. */
function videoTime(page: Page, index: number): Promise<number | undefined> {
  return page.evaluate((at) => {
    const video = document.querySelectorAll('[data-demo-video]')[at]?.querySelector('video');
    return video === null || video === undefined || video.hidden ? undefined : video.currentTime;
  }, index);
}

/** Presses the demo's button: it must pause (a video stops on its frame, a GIF gives way to the poster), then play. */
async function pauseAndPlay(page: Page, index: number, state: DemoState): Promise<string[]> {
  const problems: string[] = [];
  const toggle = page.locator('[data-demo-video]').nth(index).locator('[data-demo-toggle]');
  if (!(await toggle.isVisible())) return ['no pause button while it plays'];
  if (!((await toggle.getAttribute('aria-label')) ?? '').startsWith('Pause:'))
    problems.push('the button is not named Pause');
  await toggle.tap();
  await page.waitForTimeout(300);
  if (!((await toggle.getAttribute('aria-label')) ?? '').startsWith('Play:'))
    problems.push('paused, the button is not named Play');
  if (state === 'video') {
    const before = await videoTime(page, index);
    await page.waitForTimeout(700);
    const after = await videoTime(page, index);
    if (before === undefined || after !== before)
      problems.push(`the video went on after the pause (${String(before)} → ${String(after)})`);
  } else if ((await demoState(page, index)) !== '') {
    problems.push('the GIF still shows after the pause (the poster should)');
  }
  await toggle.tap();
  if ((await waitForPlay(page, index, 10_000)) === '') problems.push('it did not play again');
  return problems;
}

type Device = { readonly label: string; readonly type: BrowserType; readonly descriptor: string };

const DEVICES: readonly Device[] = [
  { label: 'iPhone 15 (WebKit)', type: webkit, descriptor: 'iPhone 15' },
  { label: 'Pixel 7 (Chromium)', type: chromium, descriptor: 'Pixel 7' },
];

type Scenario = {
  readonly name: string;
  readonly reducedMotion?: boolean;
  readonly initScript?: string;
  readonly blockWebm?: boolean;
  /** The WebM requests are never answered, so the video stalls before any data arrives. */
  readonly stallWebm?: boolean;
  /** The demos it plays (all by default, else the first only) and how they must play. */
  readonly firstOnly?: boolean;
  readonly expect?: DemoState;
};

const SCENARIOS: readonly Scenario[] = [
  { name: 'as is' },
  {
    name: 'no WebM (canPlayType says no)',
    initScript: "HTMLMediaElement.prototype.canPlayType = () => '';",
    firstOnly: true,
    expect: 'gif',
  },
  { name: 'WebM fails to load', blockWebm: true, firstOnly: true, expect: 'gif' },
  { name: 'WebM never arrives (stalled)', stallWebm: true, firstOnly: true, expect: 'gif' },
  { name: 'reduced motion', reducedMotion: true, firstOnly: true },
];

async function playback(
  base: string,
  themes: readonly Theme[],
  facts: MockedFacts | undefined,
): Promise<string[]> {
  const problems: string[] = [];
  for (const device of DEVICES) {
    if (!existsSync(device.type.executablePath())) {
      problems.push(
        `${device.label}: the browser is not installed; run \`pnpm --filter @gcportrait/website exec playwright install ${device.type.name()}\``,
      );
      continue;
    }
    const browser = await device.type.launch();
    try {
      for (const scenario of SCENARIOS) {
        for (const theme of scenario.name === 'as is' ? themes : themes.slice(0, 1)) {
          const where = `${device.label}, ${theme}, ${scenario.name}`;
          const context = await browser.newContext({
            ...devices[device.descriptor],
            colorScheme: theme,
            reducedMotion: scenario.reducedMotion === true ? 'reduce' : 'no-preference',
          });
          await context.addInitScript(KEEP_NAMES_SHIM);
          if (scenario.initScript !== undefined) await context.addInitScript(scenario.initScript);
          await answerRepositoryRequests(context, facts);
          const page = await context.newPage();
          const origin = new URL(base).origin;
          page.on('request', (request) => {
            const url = request.url();
            if (
              !url.startsWith('data:') &&
              !url.startsWith('blob:') &&
              new URL(url).origin !== origin &&
              !isRepositoryRequest(url)
            ) {
              problems.push(`${where}: a request to another host: ${url}`);
            }
          });
          if (scenario.blockWebm === true) {
            await page.route('**/*.webm', (route) => route.abort('failed'));
          }
          if (scenario.stallWebm === true) {
            await page.route('**/*.webm', () => new Promise<void>(() => undefined));
          }
          await page.goto(`${base}/`, { waitUntil: 'load' });
          const count = await page.locator('[data-demo-video]').count();
          if (count === 0) problems.push(`${where}: no animated demo on the landing page`);
          const modes: string[] = [];
          for (
            let index = 0;
            index < (scenario.firstOnly === true ? Math.min(1, count) : count);
            index += 1
          ) {
            const demo = page.locator('[data-demo-video]').nth(index);
            const title = (await demo.getAttribute('data-title')) ?? String(index);
            await demo.scrollIntoViewIfNeeded();
            if (scenario.reducedMotion === true) {
              await page.waitForTimeout(1500);
              const toggle = demo.locator('[data-demo-toggle]');
              const state = await demoState(page, index);
              const loaded = await demo.locator('video').getAttribute('src');
              if (state !== '' || loaded !== null) problems.push(`${where}: "${title}" started by itself`);
              if (
                !(await toggle.isVisible()) ||
                !((await toggle.getAttribute('aria-label')) ?? '').startsWith('Play:')
              ) {
                problems.push(`${where}: "${title}" shows no Play button`);
                continue;
              }
              await toggle.tap();
            }
            const state = await waitForPlay(page, index);
            if (state === '') {
              problems.push(`${where}: "${title}" did not play (neither the WebM nor the GIF)`);
              continue;
            }
            if (scenario.expect !== undefined && state !== scenario.expect) {
              problems.push(`${where}: "${title}" played as ${state}, not as ${scenario.expect}`);
            }
            modes.push(state);
            for (const problem of await pauseAndPlay(page, index, state))
              problems.push(`${where}: "${title}": ${problem}`);
          }
          console.log(`play    ${where}: ${modes.length === 0 ? 'nothing played' : modes.join(', ')}`);
          await context.close();
        }
      }
    } finally {
      await browser.close();
    }
  }
  return problems;
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      only: { type: 'string', multiple: true, default: [] },
      page: { type: 'string', multiple: true, default: [] },
      theme: { type: 'string', multiple: true, default: [] },
      width: { type: 'string', multiple: true, default: [] },
      stars: { type: 'string' },
      forks: { type: 'string' },
      release: { type: 'string' },
      dist: { type: 'string', default: path.join(WEBSITE, 'dist') },
    },
  });
  const dist = path.resolve(values.dist);
  for (const only of values.only) {
    if (only !== 'layout' && only !== 'playback') throw new UsageError(`--only ${only}: layout or playback`);
  }
  for (const theme of values.theme) {
    if (theme !== 'light' && theme !== 'dark') throw new UsageError(`--theme ${theme}: light or dark`);
  }
  const widths = values.width.length > 0 ? values.width.map(Number) : WIDTHS;
  if (widths.some((width) => !Number.isInteger(width) || width < 200))
    throw new UsageError('--width: whole pixels');
  const stars = values.stars === undefined ? undefined : Number(values.stars);
  if (stars !== undefined && (!Number.isSafeInteger(stars) || stars < 0))
    throw new UsageError('--stars: a whole number of stars');
  const forks = values.forks === undefined ? stars : Number(values.forks);
  if (forks !== undefined && (!Number.isSafeInteger(forks) || forks < 0))
    throw new UsageError('--forks: a whole number of forks');
  const release = values.release ?? 'v1.0.0';
  if (!isReleaseTag(release)) throw new UsageError('--release: a release tag, such as v1.2.3');
  if (stars === undefined && (values.forks !== undefined || values.release !== undefined))
    throw new UsageError('--forks and --release go with --stars');
  const facts: MockedFacts | undefined =
    stars === undefined ? undefined : { stars, forks: forks ?? stars, version: release };
  if (!existsSync(path.join(dist, 'index.html'))) {
    console.error(`website mobile: no built site in ${dist}; run \`pnpm website:build\` first`);
    return 1;
  }
  const themes = values.theme.length > 0 ? (values.theme as Theme[]) : [...THEMES];
  const wanted = (part: string): boolean => values.only.length === 0 || values.only.includes(part);
  const pages = values.page.length > 0 ? values.page : sitemapPages(dist);

  const { base, close } = await serve(dist);
  const problems: string[] = [];
  try {
    if (wanted('layout')) {
      const browser = await chromium.launch();
      try {
        problems.push(...(await layout(browser, base, pages, themes, widths, facts)));
      } finally {
        await browser.close();
      }
    }
    if (wanted('playback')) problems.push(...(await playback(base, themes, facts)));
  } finally {
    await close();
  }
  if (problems.length > 0) {
    console.error(`\nwebsite mobile: ${String(problems.length)} problem(s):`);
    for (const problem of problems) console.error(`  - ${problem}`);
    return 1;
  }
  console.log(
    `\nwebsite mobile: OK (${wanted('layout') ? `${String(pages.length)} pages at ${widths.join(', ')} px, ${themes.join(' and ')}: no sideways scrolling, no overlapping header items, the header at the top when scrolled and above anchor targets, 44-pixel targets, no axe violation, no name with a space before a punctuation mark` : ''}${wanted('layout') && wanted('playback') ? '; ' : ''}${wanted('playback') ? 'the demos play on the iPhone and the Pixel, pause and play again, and fall back to the GIF' : ''}${facts === undefined ? '' : `; GitHub's answers mocked as ${facts.version}, ${String(facts.stars)} stars, ${String(facts.forks)} forks`}).`,
  );
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    if (error instanceof UsageError) {
      console.error(`website mobile: ${error.message}`);
      process.exitCode = 2;
    } else {
      console.error(error);
      process.exitCode = 1;
    }
  },
);
