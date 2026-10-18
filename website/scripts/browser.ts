// SPDX-License-Identifier: Apache-2.0
/**
 * What the website's browser checks share (scripts/mobile.ts, scripts/fillable.ts, scripts/stars.ts, scripts/demo.ts):
 * the stand-in for tsx's name helper, axe-core via @axe-core/playwright, a wait for the layout to settle, how to tell
 * a wait that ran out from any other failure, and GitHub's answers to the header's repository widget given by the check
 * itself.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { AxeBuilder } from '@axe-core/playwright';
import { errors, type BrowserContext, type Page } from 'playwright';

export const WEBSITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * tsx compiles these scripts with esbuild's keepNames, which wraps named functions in a `__name(…)` call; the
 * functions handed to page.evaluate run in the page, where that helper does not exist, so each page gets a stand-in.
 */
export const KEEP_NAMES_SHIM = 'globalThis.__name ??= (target) => target;';

/** axe-core's violations on the page as it is now (all its non-experimental rules, as the e2e tests run it). */
export async function axeProblems(page: Page): Promise<string[]> {
  const result = await new AxeBuilder({ page }).analyze();
  return result.violations.map(
    (violation) =>
      `axe ${violation.id}: ${violation.help} (${violation.nodes
        .slice(0, 3)
        .map((node) => JSON.stringify(node.target))
        .join(', ')})`,
  );
}

/**
 * Whether `error` is Playwright's timeout: a wait or an action that ran out. A closed page, a crashed browser or a
 * failed navigation is another error, which a check reports as it is, never as a wait that ran out.
 */
export function isTimeout(error: unknown): error is errors.TimeoutError {
  return error instanceof errors.TimeoutError;
}

/**
 * A `.catch` handler for a wait whose running out the check expects: `value` for Playwright's timeout, every other
 * error thrown on (`page.waitForFunction(…).catch(timeoutGives(undefined))`).
 */
export function timeoutGives<T>(value: T): (error: unknown) => T {
  return (error) => {
    if (isTimeout(error)) return value;
    throw error;
  };
}

/** Two animation frames: the layout after a resize or a click has settled. */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      }),
  );
}

/**
 * The header's repository widget asks exactly these addresses (src/lib/star-count.ts): the repository, and its latest
 * release. Nothing else elsewhere.
 */
const REPOSITORY_REQUEST =
  /^https:\/\/api\.github\.com\/repos\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+(\/releases\/latest)?$/;

/** Whether a request is one of the repository widget's (the requests to another host a page may make). */
export function isRepositoryRequest(url: string): boolean {
  return REPOSITORY_REQUEST.test(url);
}

/** Whether a request of the repository widget is the one for the latest release (else the repository's). */
export function isReleaseRequest(url: string): boolean {
  return isRepositoryRequest(url) && url.endsWith('/releases/latest');
}

/** What the checks answer for the repository: its counts and its latest release's tag. */
export type MockedFacts = { readonly stars: number; readonly forks: number; readonly version: string };

/**
 * Answers the repository widget's requests in `context` without asking GitHub: with `facts` (the repository's counts and
 * the latest release's tag), or with GitHub's 404 to both (its answer for a private repository: nothing
 * changes) when `facts` is undefined. Any other request to api.github.com is refused. The checks load many pages;
 * asking GitHub for each would spend the 60 unauthenticated requests an hour of the machine's address, and the answer
 * would change from run to run.
 */
export async function answerRepositoryRequests(context: BrowserContext, facts?: MockedFacts): Promise<void> {
  await context.route('https://api.github.com/**', (route) => {
    const url = route.request().url();
    if (!isRepositoryRequest(url)) return route.abort('blockedbyclient');
    const body =
      facts === undefined
        ? { message: 'Not Found' }
        : isReleaseRequest(url)
          ? { tag_name: facts.version }
          : { stargazers_count: facts.stars, forks_count: facts.forks };
    return route.fulfill({
      status: facts === undefined ? 404 : 200,
      contentType: 'application/json; charset=utf-8',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(body),
    });
  });
}
