// SPDX-License-Identifier: MIT
import { expect, type Locator, type Page, type Request } from '@playwright/test';

import { storedEverywhere, type GoogleStubs } from './gis.js';

/**
 * What the live specs (run by the `chromium-live` project against `pnpm dev`'s Vite server) share: the backend's
 * GET /api/config answered inside the browser, the Permissions page's check section, and the checks that the access
 * token travels only in gcportrait's own header and is kept nowhere (ADR 0031). Everything is synthetic.
 */

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
 * Authorization header (ADR 0031). A request that does not is noted in `refused`, by its path and why.
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
