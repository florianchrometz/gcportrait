// SPDX-License-Identifier: MIT
/**
 * `pnpm --filter @gcportrait/website stars`: the header's repository widget, live (docs/website.md, "GitHub repository
 * widget"), in Playwright's Chromium, on the built site's landing page (website/dist), light and dark, at 1440, 768,
 * 390 and 320 CSS pixels. Run after `pnpm website:build`. Exit code 0 when clean, 1 with every problem listed, 2 on a
 * usage error.
 *
 * The check answers GitHub's part itself (scripts/browser.ts) and holds the answers back until the header has been
 * measured, so "before" and "after" are the same page. In every case: the page asks once for the repository and once for
 * its latest release, both after its load event, with `credentials: 'omit'`, no referrer and only an Accept header; no
 * layout shift (every item of the header but the link keeps its box, the header its height and the link its place,
 * and Chromium's layout-shift observer reports nothing once the answers are let through); nothing logged but Chrome's
 * own line for a failed request.
 * - Facts (`--count N` stars, `--forks N`, `--release TAG`; by default the build's stars plus 100, its forks plus one
 *   and its version with the last digit changed, or 1301, 42 and v1.0.0 where the build had none): the widget and the
 *   link's name then show them, the counts abbreviated as the build does, and sessionStorage keeps them. Facts as long
 *   as the build's, or counts to 9.9k where the build had them (each count keeps room for those), must show; facts that
 *   would move something (a box where the build had none, on most widths) must leave the header's HTML as it was. A reload within the hour asks
 *   nothing and shows the kept facts; a reload with facts older than an hour asks again. Also, at 1440 pixels: a
 *   repository without a release (the release's 404) shows the counts and keeps the build's version.
 * - A failure, to both requests: GitHub's 404 (its answer for a private repository) at every width; a 403 with
 *   the rate limit spent, a 429, a 500, a body that is not JSON, counts that are not numbers, an answer slower than the
 *   page's 4 seconds, and no network, at 1440 and 390 pixels. The header's HTML and every box stay as they were;
 *   sessionStorage holds the note that the browser asked, without facts; a reload within the hour asks nothing.
 * - Leaving the page before the answers: the next page of the tab asks nothing within the hour.
 * - sessionStorage blocked, or full (writing throws): the page asks nothing and the header stays as it was.
 * - axe-core finds no violation, with the facts shown and after the 404.
 * - The repository not public to the build (GitHub's 404 to the build's own request, or an answer marked private: the
 *   header link carries `data-repository-not-public`): the page asks nothing at all, not after its load event and not
 *   on a reload, writes nothing to sessionStorage, and the header stays as the build made it (no box, no HTML changed,
 *   no layout shift); nothing logged; no axe violation. On a build that saw the repository as not public (a build while
 *   it is private) this is all the check can run, at every width in both themes, and it says so; on any other build
 *   it runs the cases above and this one too, at 1440 and 390 pixels in both themes, with the marker added to the
 *   served landing page.
 * With `--real`, once (light, 1440 pixels): GitHub itself answers the page's own requests, with a cookie set for
 * api.github.com that must not be sent; a failure (a private repository's 404) must change nothing and be kept, so a
 * reload asks GitHub nothing; facts must show. On a build that saw the repository as not public there is no request
 * to make.
 *
 *   pnpm --filter @gcportrait/website stars [--count 1301] [--forks 42] [--release v1.0.0] [--real] [--shots DIR]
 *                                           [--dist DIR]
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
  type Request,
  type Response,
} from 'playwright';

import {
  FACTS_STORAGE_KEY,
  formatCount,
  isReleaseTag,
  repositoryLinkLabel,
  type RepositoryFacts,
} from '../src/lib/star-count.js';
import { PRODUCT_NAME } from '../src/site.js';
import {
  KEEP_NAMES_SHIM,
  WEBSITE,
  axeProblems,
  axeSource,
  isReleaseRequest,
  isRepositoryRequest,
  settle,
  timeoutGives,
  type MockedFacts,
} from './browser.js';
import { serve } from './serve.js';

const WIDTHS: readonly number[] = [1440, 768, 390, 320];
const HEIGHT = 900;
const THEMES = ['light', 'dark'] as const;
type Theme = (typeof THEMES)[number];

class UsageError extends Error {}

type Box = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
type Boxes = Readonly<Record<string, Box>>;

/** Records every fetch the page makes, with the options that matter here and whether the page had loaded. */
const FETCH_RECORDER = `
  (() => {
    const original = window.fetch;
    const calls = [];
    Object.defineProperty(window, '__fetches', { value: calls });
    window.fetch = function (input, init) {
      calls.push({
        url: String(input instanceof Request ? input.url : input),
        method: init && init.method,
        credentials: init && init.credentials,
        referrerPolicy: init && init.referrerPolicy,
        headers: JSON.stringify((init && init.headers) || {}),
        readyState: document.readyState,
      });
      return original.call(this, input, init);
    };
  })();
`;

/** Records Chromium's layout-shift entries (startTime, value) from the start of the page. */
const SHIFT_RECORDER = `
  (() => {
    const shifts = [];
    Object.defineProperty(window, '__shifts', { value: shifts });
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) shifts.push({ at: entry.startTime, value: entry.value });
      }).observe({ type: 'layout-shift', buffered: true });
    } catch {}
  })();
`;

type Shift = { at: number; value: number };

type FetchCall = {
  url: string;
  method?: string;
  credentials?: string;
  referrerPolicy?: string;
  headers: string;
  readyState: string;
};

/** The boxes of the header's items, the header itself and the main content, in CSS pixels. */
function headerBoxes(page: Page): Promise<Boxes> {
  return page.evaluate(() => {
    const boxes: Record<string, Box> = {};
    const add = (name: string, element: Element | null): void => {
      if (element === null) return;
      const box = element.getBoundingClientRect();
      if (box.width === 0 && box.height === 0) return;
      const round = (value: number): number => Math.round(value * 100) / 100;
      boxes[name] = { x: round(box.x), y: round(box.y), width: round(box.width), height: round(box.height) };
    };
    add('header', document.querySelector('.site-header'));
    add('main', document.querySelector('main'));
    add('wordmark', document.querySelector('.site-header .wordmark'));
    add('menu button', document.querySelector('.site-header .menu-toggle'));
    for (const link of document.querySelectorAll('.site-header .site-menu a'))
      add(`menu link "${link.textContent.trim()}"`, link);
    add('demo button', document.querySelector('.site-header .header-cta'));
    add('GitHub link', document.querySelector('.site-header .header-github'));
    add('repository facts', document.querySelector('.site-header .repo-facts'));
    return boxes;
  });
}

/** The names whose box moved or changed size by more than half a pixel (or appeared, or went). */
function moved(
  before: Boxes,
  after: Boxes,
  names = new Set([...Object.keys(before), ...Object.keys(after)]),
) {
  const changes: string[] = [];
  for (const name of names) {
    const a = before[name];
    const b = after[name];
    if (a === undefined || b === undefined) {
      if (a !== b) changes.push(`${name} ${a === undefined ? 'appeared' : 'went'}`);
      continue;
    }
    const delta = (['x', 'y', 'width', 'height'] as const).filter((key) => Math.abs(a[key] - b[key]) > 0.5);
    if (delta.length > 0)
      changes.push(`${name} ${delta.map((key) => `${key} ${String(a[key])}→${String(b[key])}`).join(', ')}`);
  }
  return changes;
}

/** The widget's three texts as shown ('' where a fact is hidden). */
type Texts = { readonly version: string; readonly stars: string; readonly forks: string };

type HeaderState = { html: string; label: string; texts: Texts; hidden: boolean; counted: boolean };

function headerState(page: Page): Promise<HeaderState> {
  return page.evaluate(() => {
    const link = document.querySelector<HTMLAnchorElement>('.site-header .header-github');
    const box = link?.querySelector<HTMLElement>('.repo-facts');
    const text = (name: string): string => {
      const fact = box?.querySelector<HTMLElement>(`.repo-fact[data-fact="${name}"]`);
      return fact === null || fact === undefined || fact.hidden
        ? ''
        : (fact.querySelector('.fact-value')?.textContent ?? '');
    };
    return {
      // The header as a tree with its attributes sorted: removing an attribute and setting it again changes its place
      // in outerHTML, not what it says.
      html: (function canonical(node: Node): string {
        if (node instanceof Element) {
          const attributes = [...node.attributes]
            .map((attribute) => `${attribute.name}="${attribute.value}"`)
            .sort();
          return `<${node.localName} ${attributes.join(' ')}>${[...node.childNodes].map(canonical).join('')}</>`;
        }
        return node.nodeType === Node.TEXT_NODE ? (node.textContent ?? '').trim() : '';
      })(document.querySelector('.site-header') ?? document.createElement('header')),
      label: link?.getAttribute('aria-label') ?? '',
      texts: { version: text('version'), stars: text('stars'), forks: text('forks') },
      hidden: box === null || box === undefined || box.hidden !== false,
      counted: link?.classList.contains('has-facts') ?? false,
    };
  });
}

function kept(page: Page): Promise<string | null> {
  return page.evaluate((key) => sessionStorage.getItem(key), FACTS_STORAGE_KEY);
}

function fetches(page: Page): Promise<FetchCall[]> {
  return page.evaluate(() => (window as unknown as { __fetches: FetchCall[] }).__fetches);
}

type Hold = {
  /** URLs of the requests to api.github.com so far. */
  readonly requests: string[];
  /** Resolves when the first two requests to api.github.com (the repository's and the release's) have arrived. */
  readonly arrived: Promise<void>;
  /** Lets the held requests (and every later one) through. */
  readonly release: () => void;
};

/** The failures the check answers with, and how its output names them. */
const FAILURES = {
  'not found': '404',
  'rate limited': '403 rate limit',
  'too many requests': '429',
  'server error': '500',
  'not JSON': '200, not JSON',
  'no number': '200, counts not numbers',
  slow: 'slower than 4 s',
  offline: 'no network',
} as const;
type Failure = keyof typeof FAILURES;
/** What the check answers: facts (the release's 404 instead of its tag with `noRelease`), a failure, or GitHub itself. */
type Answer = { readonly facts: MockedFacts; readonly noRelease?: boolean } | Failure | 'real';

/** How long the slow answer takes: past the page's own 4-second timeout. */
const SLOW_MS = 6000;

/**
 * The response the check gives to one of the widget's requests (`release`: the latest release's, else the
 * repository's), for facts or a failure GitHub answers (CORS allowed, as GitHub allows it).
 */
function factsAnswer(answer: Exclude<Answer, 'real' | 'offline'>, release: boolean) {
  const json = (status: number, body: unknown, headers: Record<string, string> = {}) => ({
    status,
    contentType: 'application/json; charset=utf-8',
    headers: { 'access-control-allow-origin': '*', ...headers },
    body: JSON.stringify(body),
  });
  if (typeof answer !== 'string') {
    if (!release) return json(200, { stargazers_count: answer.facts.stars, forks_count: answer.facts.forks });
    return answer.noRelease === true
      ? json(404, { message: 'Not Found' })
      : json(200, { tag_name: answer.facts.version });
  }
  switch (answer) {
    case 'not found':
      return json(404, { message: 'Not Found' });
    case 'rate limited':
      return json(403, { message: 'API rate limit exceeded' }, { 'x-ratelimit-remaining': '0' });
    case 'too many requests':
      return json(429, { message: 'Too Many Requests' });
    case 'server error':
      return json(500, {});
    case 'not JSON':
      return { ...json(200, {}), contentType: 'text/html', body: '<!doctype html><p>Unicorn!</p>' };
    case 'no number':
      return release
        ? json(200, { tag_name: 'v1.0.0' })
        : json(200, { stargazers_count: '1301', forks_count: '42' });
    case 'slow':
      return release
        ? json(200, { tag_name: 'v1.0.0' })
        : json(200, { stargazers_count: 1301, forks_count: 42 });
  }
}

/**
 * Answers the widget's requests in `context` (facts, a failure, or GitHub itself with 'real'), each request held until
 * `release` is called. Any other address on api.github.com is refused.
 */
async function holdRepositoryRequests(context: BrowserContext, answer: Answer): Promise<Hold> {
  let release = (): void => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let arrive = (): void => undefined;
  const arrived = new Promise<void>((resolve) => {
    arrive = resolve;
  });
  const requests: string[] = [];
  await context.route('https://api.github.com/**', async (route) => {
    const url = route.request().url();
    requests.push(url);
    if (requests.length >= 2) arrive();
    await released;
    // The page may have given up (its timeout) or gone (a navigation) meanwhile: then the route is gone too.
    try {
      if (!isRepositoryRequest(url)) await route.abort('blockedbyclient');
      else if (answer === 'real') await route.continue();
      else if (answer === 'offline') await route.abort('internetdisconnected');
      else {
        if (answer === 'slow') await new Promise((resolve) => setTimeout(resolve, SLOW_MS));
        await route.fulfill(factsAnswer(answer, isReleaseRequest(url)));
      }
    } catch {
      // Already ended by the page.
    }
  });
  return { requests, arrived, release };
}

/** Resolves when both of the widget's requests have ended: answered, or failed (aborted, timed out, no network). */
function requestsEnd(page: Page, ms: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const ends: string[] = [];
    const onResponse = (response: Response): void => {
      if (isRepositoryRequest(response.url())) done(`answered ${String(response.status())}`);
    };
    const onFailed = (request: Request): void => {
      if (isRepositoryRequest(request.url())) done('failed');
    };
    const timer = setTimeout(() => {
      stop();
      reject(new Error(`the requests to api.github.com did not end within ${String(ms / 1000)} s`));
    }, ms);
    const stop = (): void => {
      clearTimeout(timer);
      page.off('response', onResponse);
      page.off('requestfailed', onFailed);
    };
    const done = (how: string): void => {
      ends.push(how);
      if (ends.length < 2) return;
      stop();
      resolve([...new Set(ends)].join(' and '));
    };
    page.on('response', onResponse);
    page.on('requestfailed', onFailed);
  });
}

/** Waits for `promise`, or rejects after `ms` with `what`. */
async function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(what));
    }, ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function newContext(browser: Browser, theme: Theme, width: number): Promise<BrowserContext> {
  const phone = width < 768;
  const context = await browser.newContext({
    viewport: { width, height: HEIGHT },
    colorScheme: theme,
    deviceScaleFactor: 2,
    hasTouch: phone,
    isMobile: phone,
  });
  await context.addInitScript(KEEP_NAMES_SHIM);
  await context.addInitScript(FETCH_RECORDER);
  await context.addInitScript(SHIFT_RECORDER);
  return context;
}

/**
 * Collects what the page logs and throws: anything but Chrome's own line for a failed request ("Failed to load
 * resource: …", which no script can silence) is a problem, since the widget never logs.
 */
function watchConsole(page: Page): string[] {
  const logged: string[] = [];
  page.on('console', (message) => {
    if (!/^Failed to load resource\b/.test(message.text()))
      logged.push(`the page logged (${message.type()}): ${message.text().slice(0, 160)}`);
  });
  page.on('pageerror', (error) => {
    logged.push(`a page error: ${error.message.slice(0, 160)}`);
  });
  return logged;
}

/** The page's clock now, to tell later layout shifts from earlier ones. */
function pageNow(page: Page): Promise<number> {
  return page.evaluate(() => performance.now());
}

/** The layout shifts Chromium reported since `since` (the page's clock), as problems. */
async function shiftProblems(page: Page, since: number): Promise<string[]> {
  const shifts = await page.evaluate(() => (window as unknown as { __shifts: Shift[] }).__shifts);
  return shifts
    .filter((shift) => shift.at >= since && shift.value > 0)
    .map((shift) => `a layout shift of ${shift.value.toFixed(4)} at ${String(Math.round(shift.at))} ms`);
}

async function open(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await settle(page);
}

async function shot(page: Page, shots: string | undefined, name: string): Promise<void> {
  if (shots === undefined) return;
  const header = await page.locator('.site-header').boundingBox();
  const width = page.viewportSize()?.width ?? 1440;
  await page.screenshot({
    path: path.join(shots, `${name}.png`),
    clip: { x: 0, y: 0, width, height: Math.ceil((header?.height ?? 120) + 12) },
  });
}

/**
 * The checks of the requests' options (FETCH_RECORDER): one for the repository and one for its latest release, each
 * anonymous, without a referrer, Accept only, after the load event.
 */
function requestProblems(calls: readonly FetchCall[]): string[] {
  const problems: string[] = [];
  const github = calls.filter((call) => call.url.startsWith('https://api.github.com/'));
  const releases = github.filter((call) => isReleaseRequest(call.url)).length;
  if (github.length !== 2 || releases !== 1)
    problems.push(
      `${String(github.length)} requests to api.github.com, ${String(releases)} of them for the release (two: the repository and its latest release)`,
    );
  for (const call of github) {
    if (!isRepositoryRequest(call.url)) problems.push(`a request to ${call.url}`);
    if (call.method !== undefined && call.method !== 'GET') problems.push(`a ${call.method} request`);
    if (call.credentials !== 'omit') problems.push(`credentials: ${String(call.credentials)} (omit)`);
    if (call.referrerPolicy !== 'no-referrer')
      problems.push(`referrerPolicy: ${String(call.referrerPolicy)} (no-referrer)`);
    if (call.headers !== JSON.stringify({ Accept: 'application/vnd.github+json' }))
      problems.push(`headers ${call.headers} (Accept only)`);
    if (call.readyState !== 'complete')
      problems.push(`asked while the page was "${call.readyState}", before its load event`);
  }
  const other = calls.filter((call) => !call.url.startsWith('https://api.github.com/'));
  if (other.length > 0) problems.push(`other fetches: ${other.map((call) => call.url).join(', ')}`);
  return problems;
}

type Build = { readonly counted: boolean; readonly texts: Texts; readonly notPublic: boolean };

/** The header's GitHub link's start tag in a page's HTML. */
const GITHUB_LINK = /<a\b[^>]*\bclass="[^"]*\bheader-github\b[^"]*"[^>]*>/;

/**
 * What the build put into the landing page's header: whether it had facts (the link's name says so), their texts, and
 * whether GitHub told the build the repository is not public (`data-repository-not-public` on the link).
 */
function buildHeader(dist: string): Build {
  const html = readFileSync(path.join(dist, 'index.html'), 'utf8');
  const tag = GITHUB_LINK.exec(html)?.[0] ?? '';
  const label = /\baria-label="([^"]*)"/.exec(tag)?.[1] ?? '';
  const text = (name: string): string => {
    const fact = new RegExp(
      `<span class="repo-fact"([^>]*)data-fact="${name}"([^>]*)>[\\s\\S]*?<span class="fact-value"[^>]*>([^<]*)</span>`,
    ).exec(html);
    if (fact === null || /\shidden(?:=|\s|>|$)/.test(`${fact[1] ?? ''} ${fact[2] ?? ''}`)) return '';
    return fact[3] ?? '';
  };
  const notPublic = /\sdata-repository-not-public(?:=|\s|>)/.test(tag);
  const counted = label.startsWith(`${PRODUCT_NAME} on GitHub: `);
  return {
    counted,
    texts: counted
      ? { version: text('version'), stars: text('stars'), forks: text('forks') }
      : { version: '', stars: '', forks: '' },
    notPublic,
  };
}

/** What sessionStorage holds: the facts (or null for the note without them) and whether they are dated. */
function keptValue(text: string | null): { facts: unknown; dated: boolean } | undefined {
  if (text === null) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== 'object' || value === null) return undefined;
    const { facts, at } = value as Record<string, unknown>;
    return { facts, dated: typeof at === 'number' && at <= Date.now() && Date.now() - at < 60 * 60 * 1000 };
  } catch {
    return undefined;
  }
}

/** Whether a count's place keeps room for this text (Header.astro: every count from 0 to 9.9k). */
function fitsReserve(text: string): boolean {
  return /^\d{1,3}$/.test(text) || /^\d(?:\.\d)?k$/.test(text);
}

/** Whether a count's place fits `after` where the build wrote `before`: as long, or both within the reserve. */
function countFits(before: string, after: string): boolean {
  return before.length === after.length || (fitsReserve(before) && fitsReserve(after));
}

/** The texts the widget shows for `facts`, the version as the build wrote it where GitHub gave none. */
function textsOf(facts: RepositoryFacts, buildVersion: string): Texts {
  return {
    version: facts.version ?? buildVersion,
    stars: formatCount(facts.stars),
    forks: formatCount(facts.forks),
  };
}

function sameTexts(a: Texts, b: Texts): boolean {
  return a.version === b.version && a.stars === b.stars && a.forks === b.forks;
}

function describeTexts(texts: Texts): string {
  return `"${[texts.version, texts.stars, texts.forks].filter((text) => text !== '').join(' ')}"`;
}

async function withFacts(
  browser: Browser,
  base: string,
  theme: Theme,
  width: number,
  answer: { readonly facts: MockedFacts; readonly noRelease?: boolean },
  build: Build,
  shots: string | undefined,
  axe: string,
): Promise<string[]> {
  const noRelease = answer.noRelease === true;
  const mocked = answer.facts;
  const where = `${noRelease ? 'no release' : mocked.version}, ${String(mocked.stars)} stars, ${String(mocked.forks)} forks, ${theme}, ${String(width)} px`;
  const problems: string[] = [];
  const fail = (message: string): void => {
    problems.push(`${where}: ${message}`);
  };
  // What GitHub gives the page, and what the widget then shows (without a release, the build's version stays).
  const given: RepositoryFacts = {
    version: noRelease ? null : mocked.version,
    stars: mocked.stars,
    forks: mocked.forks,
  };
  const context = await newContext(browser, theme, width);
  const hold = await holdRepositoryRequests(context, answer);
  const page = await context.newPage();
  const logged = watchConsole(page);
  try {
    await open(page, `${base}/`);
    await within(hold.arrived, 8000, 'no two requests to api.github.com within 8 s of the load event');
    const before = await headerBoxes(page);
    const was = await headerState(page);
    const wanted = textsOf(given, was.texts.version);
    await shot(page, shots, `facts-${theme}-${String(width)}-before`);
    const since = await pageNow(page);
    hold.release();
    const shown = await page
      .waitForFunction(
        (text) =>
          document.querySelector('.site-header [data-fact="stars"] .fact-value')?.textContent === text,
        wanted.stars,
        { timeout: 4000 },
      )
      .then(() => true)
      .catch(timeoutGives(false));
    await page.waitForTimeout(200);
    await settle(page);
    const after = await headerBoxes(page);
    const now = await headerState(page);
    await shot(page, shots, `facts-${theme}-${String(width)}-after`);
    for (const problem of requestProblems(await fetches(page))) fail(problem);

    // Nothing may move: every box but the link's size and the facts' stays, and the link keeps its place.
    const changes = moved(before, after);
    const others = new Set(
      Object.keys({ ...before, ...after }).filter((name) => name !== 'repository facts'),
    );
    others.delete('GitHub link');
    const shifts = moved(before, after, others);
    const link = { before: before['GitHub link'], after: after['GitHub link'] };
    if (link.before !== undefined && link.after !== undefined) {
      if (Math.abs(link.before.x - link.after.x) > 0.5 || Math.abs(link.before.y - link.after.y) > 0.5)
        shifts.push(
          `GitHub link moved from ${String(link.before.x)},${String(link.before.y)} to ${String(link.after.x)},${String(link.after.y)}`,
        );
    }
    for (const shift of shifts) fail(`a layout shift: ${shift}`);
    for (const shift of await shiftProblems(page, since)) fail(shift);
    const updated = shown && !now.hidden;
    if (updated) {
      if (!now.counted) fail('the facts show without has-facts on the link');
      if (!sameTexts(now.texts, wanted))
        fail(`the widget shows ${describeTexts(now.texts)}, not ${describeTexts(wanted)}`);
      const named = repositoryLinkLabel(PRODUCT_NAME, {
        ...given,
        version: wanted.version === '' ? null : wanted.version,
      });
      if (now.label !== named) fail(`the link is named "${now.label}", not "${named}"`);
    } else {
      // Kept as it was: showing the facts would have moved something.
      if (now.html !== was.html) fail('the facts are not shown, yet the header changed');
      const fits =
        build.counted &&
        was.texts.version.length === wanted.version.length &&
        countFits(was.texts.stars, wanted.stars) &&
        countFits(was.texts.forks, wanted.forks);
      if (fits)
        fail(
          `facts the widget keeps room for (${describeTexts(was.texts)} → ${describeTexts(wanted)}) were not shown`,
        );
    }
    const outcome = updated
      ? build.counted
        ? `${describeTexts(was.texts)} → ${describeTexts(now.texts)}`
        : `facts added ${describeTexts(now.texts)}`
      : `kept ${build.counted ? describeTexts(was.texts) : 'without facts'} (showing ${describeTexts(wanted)} would move the header's items)`;
    const stored = keptValue(await kept(page));
    if (JSON.stringify(stored?.facts) !== JSON.stringify(given) || stored?.dated !== true)
      fail(`sessionStorage holds ${JSON.stringify(stored)}`);
    for (const problem of await axeProblems(page, axe)) fail(problem);

    // A reload within the hour: no request, the kept facts.
    const asked = hold.requests.length;
    await open(page, `${base}/`);
    await page
      .waitForFunction(
        (text) =>
          document.querySelector('.site-header [data-fact="stars"] .fact-value')?.textContent === text,
        now.texts.stars,
        { timeout: 4000 },
      )
      .catch(timeoutGives(undefined));
    await page.waitForTimeout(500);
    const again = await headerState(page);
    if (hold.requests.length !== asked)
      fail(
        `a reload within the hour asked GitHub again (${String(hold.requests.length - asked)} request(s))`,
      );
    if (!sameTexts(again.texts, now.texts))
      fail(
        `after a reload the widget shows ${describeTexts(again.texts)}, not the kept ${describeTexts(now.texts)}`,
      );
    if ((await fetches(page)).length !== 0) fail('after a reload the page fetched something');

    // Facts kept for more than an hour: asked again, both requests.
    await page.evaluate(
      ([key, value]) => {
        sessionStorage.setItem(key, value);
      },
      [FACTS_STORAGE_KEY, JSON.stringify({ facts: given, at: Date.now() - 61 * 60 * 1000 })] as const,
    );
    await open(page, `${base}/`);
    await page.waitForTimeout(2500);
    if (hold.requests.length !== asked + 2)
      fail(
        `with facts older than an hour the page asked ${String(hold.requests.length - asked)} time(s) (twice: the repository and its release)`,
      );
    for (const line of logged) fail(line);
    console.log(
      `stars   ${where.padEnd(48)} ${outcome}; ${changes.length === 0 ? 'no box changed' : `changed: ${changes.join('; ')}`}; reload: ${String(hold.requests.length - asked - 2)} request(s)`,
    );
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  } finally {
    await context.close();
  }
  return problems;
}

async function failure(
  browser: Browser,
  base: string,
  theme: Theme,
  width: number,
  answer: Failure,
  shots: string | undefined,
  axe: string | undefined,
): Promise<string[]> {
  const where = `${FAILURES[answer]}, ${theme}, ${String(width)} px`;
  const problems: string[] = [];
  const fail = (message: string): void => {
    problems.push(`${where}: ${message}`);
  };
  const context = await newContext(browser, theme, width);
  const hold = await holdRepositoryRequests(context, answer);
  const page = await context.newPage();
  const logged = watchConsole(page);
  try {
    await open(page, `${base}/`);
    await within(hold.arrived, 8000, 'no two requests to api.github.com within 8 s of the load event');
    const before = await headerBoxes(page);
    const was = await headerState(page);
    const since = await pageNow(page);
    const ended = requestsEnd(page, SLOW_MS + 4000);
    const started = Date.now();
    hold.release();
    const how = await ended;
    const took = Date.now() - started;
    await page.waitForTimeout(500);
    await settle(page);
    const after = await headerBoxes(page);
    const now = await headerState(page);
    if (answer === 'not found') await shot(page, shots, `404-${theme}-${String(width)}`);
    for (const problem of requestProblems(await fetches(page))) fail(problem);
    const changes = moved(before, after);
    if (changes.length > 0) fail(`the header changed: ${changes.join('; ')}`);
    if (now.html !== was.html) fail("the header's HTML changed");
    for (const shift of await shiftProblems(page, since)) fail(shift);
    const stored = keptValue(await kept(page));
    if (stored?.facts !== null || !stored.dated)
      fail(`sessionStorage holds ${JSON.stringify(stored)}, not the note without facts`);
    if (axe !== undefined) for (const problem of await axeProblems(page, axe)) fail(problem);

    // A reload within the hour: GitHub is not asked again, the header is as the build made it.
    const asked = hold.requests.length;
    await open(page, `${base}/`);
    await page.waitForTimeout(2500); // past the idle callback's 2-second limit
    if (hold.requests.length !== asked)
      fail(
        `a reload within the hour asked GitHub again (${String(hold.requests.length - asked)} request(s))`,
      );
    if ((await headerState(page)).html !== was.html) fail("after a reload the header's HTML differs");
    for (const line of logged) fail(line);
    console.log(
      `stars   ${where.padEnd(48)} ${how} after ${(took / 1000).toFixed(1)} s; ${changes.length === 0 && now.html === was.html ? 'nothing changed' : 'the header changed'} (${now.counted ? describeTexts(now.texts) : 'no facts'}); ${stored?.facts === null && stored.dated ? 'the note kept' : `kept ${JSON.stringify(stored)}`}; reload: ${String(hold.requests.length - asked)} request(s)`,
    );
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  } finally {
    await context.close();
  }
  return problems;
}

/**
 * The repository not public to the build (its 404): the page asks nothing, keeps nothing and changes nothing, also on a
 * reload. `simulated`: the build did not see that, so the check adds `data-repository-not-public` to the header link
 * of the landing page it serves, as the build would have written it.
 */
async function notPublic(
  browser: Browser,
  base: string,
  theme: Theme,
  width: number,
  simulated: boolean,
  shots: string | undefined,
  axe: string,
): Promise<string[]> {
  const where = `${simulated ? 'not public (marked here)' : 'not public (the build)'}, ${theme}, ${String(width)} px`;
  const problems: string[] = [];
  const fail = (message: string): void => {
    problems.push(`${where}: ${message}`);
  };
  const context = await newContext(browser, theme, width);
  // Any request would be answered (and counted); none may come.
  const hold = await holdRepositoryRequests(context, {
    facts: { stars: 1301, forks: 42, version: 'v1.0.0' },
  });
  hold.release();
  let marked = !simulated;
  if (simulated) {
    await context.route(`${base}/`, async (route) => {
      const response = await route.fetch();
      const html = await response.text();
      const body = html.replace(GITHUB_LINK, (tag) => tag.replace(/>$/, ' data-repository-not-public="">'));
      marked = body !== html;
      await route.fulfill({ response, body });
    });
  }
  const page = await context.newPage();
  const logged = watchConsole(page);
  try {
    await open(page, `${base}/`);
    if (!marked) throw new Error('the served landing page has no header GitHub link to mark');
    const before = await headerBoxes(page);
    const was = await headerState(page);
    const since = await pageNow(page);
    await page.waitForTimeout(3000); // past the load event and the idle callback's 2-second limit
    await settle(page);
    const after = await headerBoxes(page);
    await shot(page, shots, `not-public-${theme}-${String(width)}`);
    if (hold.requests.length !== 0)
      fail(`${String(hold.requests.length)} request(s) to api.github.com (none: GitHub would answer 404)`);
    const calls = await fetches(page);
    if (calls.length !== 0) fail(`the page fetched ${calls.map((call) => call.url).join(', ')}`);
    const changes = moved(before, after);
    if (changes.length > 0) fail(`the header changed: ${changes.join('; ')}`);
    if ((await headerState(page)).html !== was.html) fail("the header's HTML changed");
    if (!simulated && (!was.hidden || was.counted))
      fail('the build shows facts for a repository GitHub says is not public');
    for (const shift of await shiftProblems(page, since)) fail(shift);
    const stored = await kept(page);
    if (stored !== null) fail(`sessionStorage holds ${stored} (nothing: the page asked nothing)`);
    for (const problem of await axeProblems(page, axe)) fail(problem);
    await open(page, `${base}/`);
    await page.waitForTimeout(2500);
    if (hold.requests.length !== 0)
      fail(`after a reload ${String(hold.requests.length)} request(s) to api.github.com (none)`);
    for (const line of logged) fail(line);
    console.log(
      `stars   ${where.padEnd(48)} ${String(hold.requests.length)} request(s), also on a reload; ${changes.length === 0 ? 'nothing changed' : 'the header changed'}; sessionStorage ${stored === null ? 'untouched' : 'written'}`,
    );
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  } finally {
    await context.close();
  }
  return problems;
}

/** The visitor leaves the landing page before GitHub's answers: the next page of the tab asks nothing. */
async function leftBeforeAnswer(browser: Browser, base: string): Promise<string[]> {
  const where = 'left before the answers, light, 1440 px';
  const problems: string[] = [];
  const fail = (message: string): void => {
    problems.push(`${where}: ${message}`);
  };
  const context = await newContext(browser, 'light', 1440);
  const hold = await holdRepositoryRequests(context, {
    facts: { stars: 1301, forks: 42, version: 'v1.0.0' },
  });
  const page = await context.newPage();
  const logged = watchConsole(page);
  try {
    await open(page, `${base}/`);
    await within(hold.arrived, 8000, 'no two requests to api.github.com within 8 s of the load event');
    await open(page, `${base}/docs/`);
    hold.release();
    await page.waitForTimeout(2500);
    if (hold.requests.length !== 2)
      fail(
        `${String(hold.requests.length)} requests to api.github.com in the tab (two, from the first page)`,
      );
    const stored = keptValue(await kept(page));
    if (stored?.facts !== null || !stored.dated)
      fail(`sessionStorage holds ${JSON.stringify(stored)}, not the note without facts`);
    for (const line of logged) fail(line);
    console.log(
      `stars   ${where.padEnd(48)} ${String(hold.requests.length)} request(s) in the tab; ${stored?.facts === null && stored.dated ? 'the note kept' : `kept ${JSON.stringify(stored)}`}`,
    );
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  } finally {
    await context.close();
  }
  return problems;
}

/** sessionStorage blocked (reading it throws) or full (writing throws): GitHub is never asked. */
async function storageBlocked(browser: Browser, base: string, how: 'blocked' | 'full'): Promise<string[]> {
  const where = `sessionStorage ${how}, light, 1440 px`;
  const problems: string[] = [];
  const fail = (message: string): void => {
    problems.push(`${where}: ${message}`);
  };
  const context = await newContext(browser, 'light', 1440);
  await context.addInitScript(
    how === 'blocked'
      ? `Object.defineProperty(window, 'sessionStorage', { configurable: true, get() { throw new DOMException('The operation is insecure.', 'SecurityError'); } });`
      : `Storage.prototype.setItem = function () { throw new DOMException('The quota has been exceeded.', 'QuotaExceededError'); };`,
  );
  const hold = await holdRepositoryRequests(context, {
    facts: { stars: 1301, forks: 42, version: 'v1.0.0' },
  });
  hold.release();
  const page = await context.newPage();
  const logged = watchConsole(page);
  try {
    await open(page, `${base}/`);
    const before = await headerBoxes(page);
    const was = await headerState(page);
    await page.waitForTimeout(3000); // past the load event and the idle callback's 2-second limit
    await settle(page);
    if (hold.requests.length !== 0)
      fail(
        `${String(hold.requests.length)} request(s) to api.github.com (none: the tab could not remember asking)`,
      );
    const changes = moved(before, await headerBoxes(page));
    if (changes.length > 0) fail(`the header changed: ${changes.join('; ')}`);
    if ((await headerState(page)).html !== was.html) fail("the header's HTML changed");
    for (const line of logged) fail(line);
    console.log(
      `stars   ${where.padEnd(48)} ${String(hold.requests.length)} request(s); ${changes.length === 0 ? 'nothing changed' : 'the header changed'}`,
    );
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  } finally {
    await context.close();
  }
  return problems;
}

async function real(browser: Browser, base: string, shots: string | undefined): Promise<string[]> {
  const where = 'GitHub itself, light, 1440 px';
  const problems: string[] = [];
  const fail = (message: string): void => {
    problems.push(`${where}: ${message}`);
  };
  const context = await newContext(browser, 'light', 1440);
  // A cookie for api.github.com: credentials 'omit' must keep it out of the requests.
  await context.addCookies([
    {
      name: 'gcportrait_probe',
      value: '1',
      domain: 'api.github.com',
      path: '/',
      secure: true,
      sameSite: 'None', // sent on a cross-site request unless credentials say omit
    },
  ]);
  const hold = await holdRepositoryRequests(context, 'real');
  const page = await context.newPage();
  const logged = watchConsole(page);
  try {
    await open(page, `${base}/`);
    await within(hold.arrived, 8000, 'no two requests to api.github.com within 8 s of the load event');
    const before = await headerBoxes(page);
    const was = await headerState(page);
    const since = await pageNow(page);
    const answered = (release: boolean): Promise<Response> =>
      page.waitForResponse(
        (response) => isRepositoryRequest(response.url()) && isReleaseRequest(response.url()) === release,
        { timeout: 10_000 },
      );
    const answers = Promise.all([answered(false), answered(true)]);
    hold.release();
    const [repository, release] = await answers;
    const status = repository.status();
    await page.waitForTimeout(1000);
    await settle(page);
    const after = await headerBoxes(page);
    const now = await headerState(page);
    await shot(page, shots, `real-light-1440-${String(status)}`);
    for (const problem of requestProblems(await fetches(page))) fail(problem);
    for (const shift of await shiftProblems(page, since)) fail(shift);
    for (const response of [repository, release]) {
      const headers = await response.request().allHeaders();
      if ('cookie' in headers) fail(`a request carried a cookie: ${headers.cookie}`);
      if ('referer' in headers) fail(`a request carried a referrer: ${headers.referer}`);
      if ('authorization' in headers) fail('a request carried an Authorization header');
    }
    let outcome: string;
    if (status === 200) {
      const body = (await repository.json()) as { stargazers_count?: unknown; forks_count?: unknown };
      const stars = typeof body.stargazers_count === 'number' ? body.stargazers_count : -1;
      const forks = typeof body.forks_count === 'number' ? body.forks_count : -1;
      const tag =
        release.status() === 200 ? ((await release.json()) as { tag_name?: unknown }).tag_name : undefined;
      const wanted = textsOf({ version: isReleaseTag(tag) ? tag : null, stars, forks }, was.texts.version);
      if (!now.hidden && !sameTexts(now.texts, wanted))
        fail(`GitHub answered ${describeTexts(wanted)}, the widget shows ${describeTexts(now.texts)}`);
      outcome = `200 and ${String(release.status())}, ${describeTexts(wanted)}, the widget shows ${describeTexts(now.texts)}`;
    } else {
      const changes = moved(before, after);
      if (changes.length > 0) fail(`the header changed after a ${String(status)}: ${changes.join('; ')}`);
      if (now.html !== was.html) fail(`the header's HTML changed after a ${String(status)}`);
      const stored = keptValue(await kept(page));
      if (stored?.facts !== null || !stored.dated)
        fail(
          `after a ${String(status)} sessionStorage holds ${JSON.stringify(stored)}, not the note without facts`,
        );
      outcome = `${String(status)}, nothing changed, the note kept`;
    }
    // A reload within the hour asks GitHub nothing, whatever it answered.
    const asked = hold.requests.length;
    await open(page, `${base}/`);
    await page.waitForTimeout(2500);
    if (hold.requests.length !== asked)
      fail(
        `a reload within the hour asked GitHub again (${String(hold.requests.length - asked)} request(s))`,
      );
    for (const line of logged) fail(line);
    const headers = await repository.request().allHeaders();
    console.log(
      `stars   ${where.padEnd(48)} ${outcome}; reload: ${String(hold.requests.length - asked)} request(s); request headers: ${Object.keys(headers).sort().join(', ')}`,
    );
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  } finally {
    await context.close();
  }
  return problems;
}

/** A whole number from an option, or undefined when the option is not given. */
function wholeOption(value: string | undefined, name: string, what: string): number | undefined {
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new UsageError(`${name}: a whole number of ${what}`);
  return number;
}

/** The build's version with its last digit changed, so the same length (v1.0.0 → v1.0.1), or v1.0.0 without one. */
function versionAfter(tag: string): string {
  const last = /\d$/.exec(tag)?.[0];
  if (last === undefined) return 'v1.0.0';
  return `${tag.slice(0, -1)}${String((Number(last) + 1) % 10)}`;
}

/** A count the build abbreviated, read back with a step that changes its last shown digit (1.2k → 1300). */
function countAfter(text: string, step: number, otherwise: number): number {
  if (text === '') return otherwise;
  const thousands = /^(\d+(?:\.\d)?)k$/.exec(text)?.[1];
  return thousands !== undefined ? Math.round(Number(thousands) * 1000) + 100 * step : Number(text) + step;
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      count: { type: 'string' },
      forks: { type: 'string' },
      release: { type: 'string' },
      real: { type: 'boolean', default: false },
      shots: { type: 'string' },
      dist: { type: 'string', default: path.join(WEBSITE, 'dist') },
    },
  });
  const dist = path.resolve(values.dist);
  if (!existsSync(path.join(dist, 'index.html'))) {
    console.error(`website stars: no built site in ${dist}; run \`pnpm website:build\` first`);
    return 1;
  }
  const build = buildHeader(dist);
  // The build's counts are not in the page as numbers; their abbreviations are. One more step changes the last digit.
  const stars = wholeOption(values.count, '--count', 'stars') ?? countAfter(build.texts.stars, 1, 1301);
  const forks = wholeOption(values.forks, '--forks', 'forks') ?? countAfter(build.texts.forks, 1, 42);
  const version = values.release ?? versionAfter(build.texts.version);
  if (!isReleaseTag(version)) throw new UsageError('--release: a release tag, such as v1.2.3');
  const facts: MockedFacts = { stars, forks, version };
  const shots = values.shots === undefined ? undefined : path.resolve(values.shots);
  if (shots !== undefined) mkdirSync(shots, { recursive: true });
  console.log(
    build.notPublic
      ? "stars   the build's header: no facts, and GitHub told the build the repository is not public (data-repository-not-public): the page must ask nothing"
      : `stars   the build's header: ${build.counted ? describeTexts(build.texts) : 'no facts'}; GitHub's answers here: ${version}, ${String(stars)} stars ("${formatCount(stars)}"), ${String(forks)} forks ("${formatCount(forks)}")`,
  );

  const { base, close } = await serve(dist);
  const browser = await chromium.launch();
  const problems: string[] = [];
  const axe = axeSource();
  const others = (Object.keys(FAILURES) as Failure[]).filter((answer) => answer !== 'not found');
  if (build.notPublic) {
    try {
      for (const theme of THEMES) {
        for (const width of WIDTHS)
          problems.push(...(await notPublic(browser, base, theme, width, false, shots, axe)));
      }
    } finally {
      await browser.close();
      await close();
    }
    if (problems.length > 0) {
      console.error(`\nwebsite stars: ${String(problems.length)} problem(s):`);
      for (const problem of problems) console.error(`  - ${problem}`);
      return 1;
    }
    console.log(
      `\nwebsite stars: OK (/ at ${WIDTHS.join(', ')} px, light and dark, built while GitHub answers 404: the page asks GitHub nothing, also on a reload, keeps nothing and changes nothing; nothing logged; no axe violation${values.real ? '; --real: there is no request to make' : ''}). The widget's other cases need a build that did not see the 404: WEBSITE_STAR_COUNT=1234 WEBSITE_FORK_COUNT=56 WEBSITE_RELEASE=v1.0.0 pnpm website:build.`,
    );
    return 0;
  }
  try {
    for (const theme of THEMES) {
      for (const width of WIDTHS) {
        problems.push(...(await withFacts(browser, base, theme, width, { facts }, build, shots, axe)));
        problems.push(...(await failure(browser, base, theme, width, 'not found', shots, axe)));
        if (width === 1440 || width === 390) {
          for (const answer of others)
            problems.push(...(await failure(browser, base, theme, width, answer, undefined, undefined)));
        }
      }
    }
    problems.push(
      ...(await withFacts(browser, base, 'light', 1440, { facts, noRelease: true }, build, shots, axe)),
    );
    for (const theme of THEMES) {
      for (const width of [1440, 390])
        problems.push(...(await notPublic(browser, base, theme, width, true, shots, axe)));
    }
    problems.push(...(await leftBeforeAnswer(browser, base)));
    problems.push(...(await storageBlocked(browser, base, 'blocked')));
    problems.push(...(await storageBlocked(browser, base, 'full')));
    if (values.real) problems.push(...(await real(browser, base, shots)));
  } finally {
    await browser.close();
    await close();
  }
  if (problems.length > 0) {
    console.error(`\nwebsite stars: ${String(problems.length)} problem(s):`);
    for (const problem of problems) console.error(`  - ${problem}`);
    return 1;
  }
  console.log(
    `\nwebsite stars: OK (/ at ${WIDTHS.join(', ')} px, light and dark: the repository and its latest release asked once each after load, anonymous; the version, stars and forks shown without a layout shift, or not at all; kept for the hour; a repository without a release keeps the build's version; ${Object.values(FAILURES).join(', ')}: nothing changes and the tab asks nothing more within the hour; leaving before the answers, storage blocked or full: no further request; the repository not public to the build (marked here, at 1440 and 390 px): no request at all; nothing logged; no axe violation${values.real ? '; GitHub itself asked once' : ''}).`,
  );
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    if (error instanceof UsageError) {
      console.error(`website stars: ${error.message}`);
      process.exitCode = 2;
    } else {
      console.error(error);
      process.exitCode = 1;
    }
  },
);
