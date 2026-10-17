// SPDX-License-Identifier: MIT
import { expect, test as base, type Locator, type Page, type Request } from '@playwright/test';

import { storedEverywhere, type GoogleStubs } from './gis.js';
import { LIVE_URL } from './servers.js';

/**
 * What the live specs (run by the `chromium-live` project against the normal-mode server) share: their `test`, which
 * lets no request reach the server's proxy, the backend's GET /api/config answered inside the browser, the Permissions
 * page's check section, and the checks that the access token travels only in gcportrait's own header and is kept
 * nowhere (AGENTS.md, Security and privacy, Tokens). Everything is synthetic.
 */

const LIVE_ORIGIN = new URL(LIVE_URL).origin;

/**
 * Whether the normal-mode server would proxy a request for `url`: one to that server whose path starts with `/api`
 * (frontend/vite.config.ts names the proxy's path, and Vite matches it as a prefix).
 */
function proxied(url: URL): boolean {
  return url.origin === LIVE_ORIGIN && url.pathname.startsWith('/api');
}

/**
 * The `test` of every spec that opens the normal-mode server (the live specs, and mobile.spec.ts for a live instance's
 * pages). That server's proxy sends `/api` to a backend on port 8080 that the suite never starts, so each request must
 * be answered by the test: its own routes (`stubConfig`, `page.route`, `routeApiTo`), or the request fails in the proxy,
 * which prints an error into the run's output. A request none of them answers is answered here instead, with a 503 that
 * names it, and the test fails at its end, listing every such request. The route is the context's, so it covers every
 * page of the test and comes after every route of a page.
 */
export const test = base.extend<{ unansweredApi: readonly string[] }>({
  unansweredApi: [
    async ({ context }, use) => {
      const unanswered: string[] = [];
      await context.route(proxied, (route) => {
        const request = route.request();
        const what = `${request.method()} ${new URL(request.url()).pathname}`;
        unanswered.push(what);
        return route.fulfill({
          status: 503,
          json: {
            statusCode: 503,
            error: 'Service Unavailable',
            code: 'E2E_NOT_STUBBED',
            message: `No route of this test answers ${what}, and the e2e suite runs no backend (e2e/fixtures/live.ts).`,
          },
        });
      });
      await use(unanswered);
      expect(
        unanswered,
        'the /api requests to the normal-mode server that no route of the test answered',
      ).toEqual([]);
    },
    { auto: true },
  ],
});

/** The operator's SOURCE_URL most specs configure: a fork elsewhere, so the footer must not link the default. */
export const FORK_SOURCE_URL = 'https://git.example.org/team/gcportrait-fork';

/** The public configuration GET /api/config answers: a normal-mode instance, then `overrides`. */
export function liveConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    oauthClientId: null,
    saMode: false,
    backendServiceAccount: null,
    version: '0.0.0-e2e',
    sourceUrl: FORK_SOURCE_URL,
    demo: false,
    ...overrides,
  };
}

/** Answers the page's GET /api/config with liveConfig(`overrides`). */
export async function stubConfig(page: Page, overrides: Record<string, unknown> = {}): Promise<void> {
  const json = liveConfig(overrides);
  await page.route('**/api/config', (route) => route.fulfill({ json }));
}

/** The Permissions page's "Check a scope" section. */
export function checkSection(page: Page): Locator {
  return page.getByRole('region', { name: 'Check a scope' });
}

/** The Connect page's "Read your environment" section, where "Pull now" is. */
export function environment(page: Page): Locator {
  return page.getByRole('region', { name: 'Read your environment' });
}

/** Types `text` into the check section's combobox `field` and chooses the option named `option`. */
export async function choose(page: Page, field: string, text: string, option: RegExp): Promise<void> {
  await checkSection(page).getByRole('combobox', { name: field }).fill(text);
  await page.getByRole('option', { name: option }).click();
}

/**
 * A stubbed backend's guard: whether a request carries this session's `token` in X-Gcportrait-Token and no
 * Authorization header. A request that does not is noted in `refused`, by its path and why.
 */
export function requireToken(token: string, refused: string[]): (request: Request) => boolean {
  return (request) => {
    const headers = request.headers();
    const sent = headers['x-gcportrait-token'];
    const why =
      headers.authorization !== undefined
        ? 'an Authorization header'
        : sent === undefined || sent === ''
          ? 'no token'
          : sent === token
            ? undefined
            : 'another token';
    if (why === undefined) return true;
    refused.push(`${new URL(request.url()).pathname}: ${why}`);
    return false;
  };
}

/**
 * The tokens are nowhere they must never be: storage, IndexedDB, cookies, the address, the DOM, any request URL, the
 * browser console (console messages and uncaught errors).
 */
export async function expectTokenNowhere(
  page: Page,
  google: GoogleStubs,
  tokens: readonly string[],
): Promise<void> {
  const stored = await storedEverywhere(page);
  const html = await page.content();
  for (const token of tokens) {
    expect(stored).not.toContain(token);
    expect(html).not.toContain(token);
    expect(google.urls().filter((url) => url.includes(token))).toEqual([]);
    expect(google.console().filter((line) => line.includes(token))).toEqual([]);
  }
}
