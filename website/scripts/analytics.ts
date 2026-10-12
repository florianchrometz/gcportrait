// SPDX-License-Identifier: MIT
/**
 * `pnpm --filter @gcportrait/website analytics`: the website's page views (docs/website.md, "Analytics";
 * src/lib/analytics-page.ts) in a real browser, on a build with analytics on (`WEBSITE_ANALYTICS=1 pnpm
 * website:build`). Exit code 0 when clean, 1 with every problem listed, 2 on a usage error.
 *
 * The built site is served the way GitHub Pages serves it (scripts/serve.ts) and shown to Playwright's Chromium at its
 * own address, https://gcportrait.app (every request there is answered from the build: the pages send only from the
 * site's own host). TelemetryDeck is never asked: its ingestion host is answered by the check, or refused. Cases:
 *
 * - **Sending.** /docs/self-host/ loaded with a query and a fragment: exactly one POST to TelemetryDeck's ingestion
 *   address, started after the load event, holding one `pageView` signal with the app id, the path without query and
 *   fragment, a hashed user identifier (64 hexadecimal digits) and a session identifier, nothing else in its payload;
 *   no cookie sent (one is set for the host), a referrer of the site's origin at most. The next page of the tab
 *   (/coverage/) sends one more, with the same identifiers. sessionStorage holds `gcportrait.analytics`; nothing in
 *   localStorage, no cookie for the site. A click on "Try the demo" sends `Outbound.demo` (the demo opens in a new
 *   tab, which sends nothing at all: the demo is the app), and one on the header's GitHub link `Outbound.repository`.
 * - **Blocked.** TelemetryDeck refused (no network to it) on /, /docs/ and /coverage/: the pages load, no uncaught
 *   error or rejection, the request starts only after the load event, and a click on the demo link still opens it.
 * - **Do Not Track, Global Privacy Control, another host** (the build served at its local address): no request to
 *   TelemetryDeck, the SDK's file not even fetched, nothing in sessionStorage.
 *
 *   pnpm --filter @gcportrait/website analytics [--dist DIR]
 *
 * Chromium from `pnpm --filter @gcportrait/e2e install-browsers`.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { chromium, type Browser, type BrowserContext, type Page, type Request } from 'playwright';

import { ANALYTICS_SESSION_KEY } from '../src/lib/analytics.js';
import { SITE_URL, TELEMETRYDECK_APP_ID, TELEMETRYDECK_TARGET } from '../src/site.js';
import { KEEP_NAMES_SHIM, WEBSITE, answerRepositoryRequests } from './browser.js';
import { ANALYTICS_PREFIX } from './check-site.js';
import { serve } from './serve.js';

const VIEWPORT = { width: 1440, height: 900 };
/** How long a page view may take after the load event: the idle callback's 2 s at most, then the SDK's file. */
const SEND_TIMEOUT = 10_000;
/** How long to watch for a request that must not come. */
const QUIET = 3_000;

/** One request to TelemetryDeck, as the check saw it: when (milliseconds since the epoch), from which page, its body. */
type Sent = {
  readonly request: Request;
  /** Every header the browser sent, cookies included (`headers()` leaves those out). */
  readonly headers: Record<string, string>;
  readonly at: number;
  readonly from: string;
  readonly body: unknown;
};

/** A context that shows the build at https://gcportrait.app and records (or refuses) what goes to TelemetryDeck. */
async function siteContext(
  browser: Browser,
  base: string,
  telemetryDeck: 'answer' | 'refuse',
  init: string[] = [],
): Promise<{ context: BrowserContext; sent: Sent[]; problems: string[] }> {
  const context = await browser.newContext({ viewport: VIEWPORT });
  const sent: Sent[] = [];
  const problems: string[] = [];
  await context.addInitScript({ content: KEEP_NAMES_SHIM });
  for (const content of init) await context.addInitScript({ content });
  // A cookie TelemetryDeck's host might have set: the page views must not send it.
  await context.addCookies([
    {
      name: 'probe',
      value: 'must-not-be-sent',
      domain: new URL(TELEMETRYDECK_TARGET).hostname,
      path: '/',
      secure: true,
      sameSite: 'None',
    },
  ]);
  await answerRepositoryRequests(context);
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === SITE_URL) {
      const response = await route.fetch({ url: `${base}${url.pathname}${url.search}` });
      await route.fulfill({ response });
      return;
    }
    if (request.url().startsWith(ANALYTICS_PREFIX)) {
      const at = Date.now();
      if (telemetryDeck === 'refuse') {
        // Refused at its first request, the CORS preflight where the browser sends one, or the POST itself.
        sent.push({
          request,
          headers: await request.allHeaders(),
          at,
          from: request.frame().url(),
          body: request.method() === 'POST' ? request.postDataJSON() : null,
        });
        await route.abort('blockedbyclient');
        return;
      }
      const cors = {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'POST',
        'access-control-allow-headers': 'content-type',
      };
      if (request.method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: cors });
        return;
      }
      sent.push({
        request,
        headers: await request.allHeaders(),
        at,
        from: request.frame().url(),
        body: request.postDataJSON(),
      });
      await route.fulfill({
        status: 200,
        headers: { ...cors, 'content-type': 'application/json' },
        body: '[]',
      });
      return;
    }
    if (url.hostname === 'api.github.com') {
      await route.fallback();
      return;
    }
    if (url.protocol === 'http:' && url.hostname === '127.0.0.1') {
      await route.fallback();
      return;
    }
    problems.push(`a request to another host: ${request.url()}`);
    await route.abort('blockedbyclient');
  });
  context.on('page', (page) => {
    page.on('pageerror', (error) => {
      problems.push(`an uncaught error on ${page.url()}: ${error.message}`);
    });
  });
  return { context, sent, problems };
}

/** Leeway between the page's clock and the check's when a request's time is compared with the load event. */
const CLOCK_LEEWAY_MS = 5;

/** When the page's load event started, in milliseconds since the epoch (as the check times requests). */
async function loadedAt(page: Page): Promise<number> {
  await page.waitForFunction(() => document.readyState === 'complete');
  return page.evaluate(() => {
    const [navigation] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
    return performance.timeOrigin + (navigation?.loadEventStart ?? 0);
  });
}

/** Waits until `sent` holds `count` requests, or the timeout. */
async function until(
  page: Page,
  sent: readonly Sent[],
  count: number,
  timeout = SEND_TIMEOUT,
): Promise<boolean> {
  const end = Date.now() + timeout;
  while (sent.length < count) {
    if (Date.now() > end) return false;
    await page.waitForTimeout(100);
  }
  return true;
}

/** What is wrong with one page view's request. */
function pageViewProblems(sent: Sent, path: string, loaded: number): string[] {
  const problems: string[] = [];
  const where = (message: string): void => {
    problems.push(`${path}: ${message}`);
  };
  if (sent.request.url() !== TELEMETRYDECK_TARGET) where(`sent to ${sent.request.url()}`);
  if (sent.request.method() !== 'POST') where(`a ${sent.request.method()}, not a POST`);
  if (sent.at < loaded - CLOCK_LEEWAY_MS) where('sent before the load event');
  const { headers } = sent;
  const cookie: string | undefined = headers.cookie;
  if (cookie !== undefined) where(`a cookie was sent: ${cookie}`);
  const referrer: string | undefined = headers.referer;
  if (referrer !== undefined && referrer !== `${SITE_URL}/`)
    where(`the referrer is ${referrer}, more than the origin`);
  const signals = Array.isArray(sent.body) ? (sent.body as Record<string, unknown>[]) : [];
  if (signals.length !== 1) where(`${String(signals.length)} signals in one request (one)`);
  const [signal] = signals;
  if (signal === undefined) return problems;
  if (signal.type !== 'pageView') where(`the signal is ${String(signal.type)}, not pageView`);
  if (signal.appID !== TELEMETRYDECK_APP_ID) where(`the app id is ${String(signal.appID)}`);
  if (typeof signal.clientUser !== 'string' || !/^[0-9a-f]{64}$/.test(signal.clientUser))
    where(`the user identifier is not a SHA-256 hash: ${String(signal.clientUser)}`);
  if (typeof signal.sessionID !== 'string' || !/^[0-9a-f]{32}$/.test(signal.sessionID))
    where(`the session identifier is not the tab's random one: ${String(signal.sessionID)}`);
  if (JSON.stringify(signal.payload) !== JSON.stringify({ path }))
    where(`the payload is ${JSON.stringify(signal.payload)}, not the path alone`);
  const known = new Set(['type', 'appID', 'clientUser', 'sessionID', 'telemetryClientVersion', 'payload']);
  for (const key of Object.keys(signal)) if (!known.has(key)) where(`the signal carries ${key}`);
  return problems;
}

/** The case "Sending" (see the module comment). */
async function checkSending(browser: Browser, base: string): Promise<string[]> {
  const { context, sent, problems } = await siteContext(browser, base, 'answer');
  const page = await context.newPage();
  try {
    await page.goto(`${SITE_URL}/docs/self-host/?project=secret-project#oauth`);
    const loaded = await loadedAt(page);
    if (!(await until(page, sent, 1))) return [...problems, '/docs/self-host/: no page view within 10 s'];
    await page.waitForTimeout(QUIET);
    if (sent.length !== 1)
      problems.push(`/docs/self-host/: ${String(sent.length)} requests for one page view`);
    const [first] = sent;
    if (first !== undefined) problems.push(...pageViewProblems(first, '/docs/self-host/', loaded));
    if (JSON.stringify(first?.body ?? '').includes('secret'))
      problems.push('the query reached TelemetryDeck');

    await page.goto(`${SITE_URL}/coverage/`);
    const next = await loadedAt(page);
    if (!(await until(page, sent, 2))) return [...problems, '/coverage/: no page view within 10 s'];
    const second = sent[1];
    if (second !== undefined) {
      problems.push(...pageViewProblems(second, '/coverage/', next));
      const ids = (item: Sent | undefined): string => {
        const [signal] = (item?.body ?? []) as Record<string, unknown>[];
        return `${String(signal?.clientUser)} ${String(signal?.sessionID)}`;
      };
      if (ids(first) !== ids(second))
        problems.push('/coverage/: other identifiers than the tab’s first page');
    }
    const stored = await page.evaluate(() => ({
      session: Object.keys(sessionStorage),
      local: Object.keys(localStorage),
      value: sessionStorage.getItem('gcportrait.analytics'),
    }));
    if (!stored.session.includes(ANALYTICS_SESSION_KEY))
      problems.push('nothing in sessionStorage for the session');
    if (!/^\{"user":"[0-9a-f]{32}","session":"[0-9a-f]{32}"\}$/.test(stored.value ?? ''))
      problems.push(`sessionStorage holds ${stored.value ?? 'nothing'}`);
    if (stored.local.length > 0) problems.push(`localStorage holds ${stored.local.join(', ')}`);
    const cookies = await context.cookies(SITE_URL);
    if (cookies.length > 0)
      problems.push(`cookies for the site: ${cookies.map((cookie) => cookie.name).join(', ')}`);

    // "Try the demo" in the header: a signal from this page; the demo's tab sends nothing.
    const [demo] = await Promise.all([
      context.waitForEvent('page'),
      page.locator('header a.header-cta').first().click(),
    ]);
    if (!(await until(page, sent, 3))) problems.push('no signal for a click on "Try the demo"');
    await demo.waitForLoadState('load');
    await page.waitForTimeout(QUIET);
    const [, , demoClick] = sent;
    const demoSignal = ((demoClick?.body ?? []) as Record<string, unknown>[])[0];
    if (
      demoSignal !== undefined &&
      (demoSignal.type !== 'Outbound.demo' || JSON.stringify(demoSignal.payload) !== '{"path":"/coverage/"}')
    )
      problems.push(`a click on "Try the demo" sent ${JSON.stringify(demoSignal)}`);
    for (const item of sent)
      if (new URL(item.from).pathname.startsWith('/demo/'))
        problems.push(`the demo sent ${JSON.stringify(item.body)}`);
    await demo.close();

    // The header's GitHub link: a signal; the navigation itself is held back (the check asks no other host).
    await page.evaluate(() => {
      document.addEventListener('click', (event) => {
        event.preventDefault();
      });
    });
    await page.locator('header a.header-github').click();
    if (!(await until(page, sent, 4))) problems.push('no signal for a click on the header’s GitHub link');
    const repositorySignal = ((sent[3]?.body ?? []) as Record<string, unknown>[])[0];
    if (repositorySignal !== undefined && repositorySignal.type !== 'Outbound.repository')
      problems.push(`a click on the GitHub link sent ${JSON.stringify(repositorySignal)}`);
    // A link to a page of the site sends nothing.
    await page.locator('footer a[href="/licence/"]').first().click();
    await page.waitForTimeout(QUIET);
    if (sent.length !== 4)
      problems.push(`${String(sent.length - 4)} signal(s) for a link to a page of the site`);
    return problems;
  } finally {
    await context.close();
  }
}

/** The case "Blocked" (see the module comment). */
async function checkBlocked(browser: Browser, base: string): Promise<string[]> {
  const { context, sent, problems } = await siteContext(browser, base, 'refuse');
  const page = await context.newPage();
  try {
    for (const pathname of ['/', '/docs/', '/coverage/']) {
      const before = sent.length;
      const response = await page.goto(`${SITE_URL}${pathname}`);
      if (response?.status() !== 200) problems.push(`${pathname}: status ${String(response?.status())}`);
      const loaded = await loadedAt(page);
      if (!(await until(page, sent, before + 1))) {
        problems.push(`${pathname}: the page view was never attempted`);
        continue;
      }
      const attempt = sent[before];
      if (attempt !== undefined && attempt.at < loaded - CLOCK_LEEWAY_MS)
        problems.push(`${pathname}: the page view started before the load event`);
      const heading = await page.locator('h1').count();
      if (heading !== 1)
        problems.push(`${pathname}: the page is not shown (${String(heading)} level-1 headings)`);
    }
    await page.waitForTimeout(QUIET);
    const [demo] = await Promise.all([
      context.waitForEvent('page'),
      page.locator('header a.header-cta').first().click(),
    ]);
    await demo.waitForLoadState('load');
    if (!new URL(demo.url()).pathname.startsWith('/demo/'))
      problems.push(`"Try the demo" opened ${demo.url()}`);
    return problems;
  } finally {
    await context.close();
  }
}

/** The cases where nothing may be sent: Do Not Track, GPC, and another host (the build at its local address). */
async function checkSilent(browser: Browser, base: string, init: string[], at: string): Promise<string[]> {
  const { context, sent, problems } = await siteContext(browser, base, 'answer', init);
  const page = await context.newPage();
  const sdkFiles: string[] = [];
  page.on('request', (request) => {
    if (/\/_astro\/telemetrydeck\.[^/]*\.js$/.test(request.url())) sdkFiles.push(request.url());
  });
  try {
    await page.goto(`${at}/docs/`);
    await loadedAt(page);
    await page.waitForTimeout(QUIET + 2_000);
    if (sent.length > 0) problems.push(`${String(sent.length)} request(s) to TelemetryDeck`);
    if (sdkFiles.length > 0) problems.push("the SDK's file was fetched");
    const stored = await page.evaluate(() => Object.keys(sessionStorage));
    if (stored.includes(ANALYTICS_SESSION_KEY)) problems.push('identifiers in sessionStorage');
    return problems;
  } finally {
    await context.close();
  }
}

/** Whether the build carries the page views (a script naming TelemetryDeck's ingestion address). */
function sendsPageViews(dist: string): boolean {
  const dir = path.join(dist, '_astro');
  return (
    existsSync(dir) &&
    readdirSync(dir)
      .filter((file) => file.endsWith('.js'))
      .some((file) => readFileSync(path.join(dir, file), 'utf8').includes(ANALYTICS_PREFIX))
  );
}

async function main(argv: readonly string[]): Promise<number> {
  const { values } = parseArgs({ args: [...argv], options: { dist: { type: 'string' } } });
  const dist = path.resolve(values.dist ?? path.join(WEBSITE, 'dist'));
  if (!existsSync(path.join(dist, 'index.html'))) {
    console.error(
      `analytics: no built site in ${dist}; run \`WEBSITE_ANALYTICS=1 pnpm website:build\` first`,
    );
    return 1;
  }
  if (!sendsPageViews(dist)) {
    console.error(
      `analytics: the build in ${dist} has analytics off; build it with \`WEBSITE_ANALYTICS=1 pnpm website:build\``,
    );
    return 1;
  }
  const { base, close } = await serve(dist);
  const browser = await chromium.launch();
  const problems: string[] = [];
  const step = async (name: string, run: () => Promise<string[]>): Promise<void> => {
    try {
      const found = await run();
      problems.push(...found.map((problem) => `${name}: ${problem}`));
      console.log(`analytics: ${name}: ${found.length === 0 ? 'OK' : found.join('; ')}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      problems.push(`${name}: ${message}`);
      console.log(`analytics: ${name}: failed: ${message.split('\n')[0] ?? ''}`);
    }
  };
  try {
    await step('sending', () => checkSending(browser, base));
    await step('TelemetryDeck blocked', () => checkBlocked(browser, base));
    await step('Do Not Track', () =>
      checkSilent(
        browser,
        base,
        ["Object.defineProperty(Navigator.prototype, 'doNotTrack', { get: () => '1' });"],
        SITE_URL,
      ),
    );
    await step('Global Privacy Control', () =>
      checkSilent(
        browser,
        base,
        ["Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', { get: () => true });"],
        SITE_URL,
      ),
    );
    await step('another host (the build at its local address)', () => checkSilent(browser, base, [], base));
  } finally {
    await browser.close();
    await close();
  }
  if (problems.length > 0) {
    console.error(`analytics: ${String(problems.length)} problem(s):`);
    for (const problem of problems) console.error(`  - ${problem}`);
    return 1;
  }
  console.log(
    'analytics: one page view per load after the load event (path only, hashed user, the tab’s session, no cookie, sessionStorage only), the demo and repository clicks, none from the demo; with TelemetryDeck blocked the pages load and nothing throws; nothing at all under Do Not Track, Global Privacy Control or on another host.',
  );
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(`analytics: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = error instanceof Error && 'code' in error ? 2 : 1;
  },
);
