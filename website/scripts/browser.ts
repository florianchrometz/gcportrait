// SPDX-License-Identifier: MIT
/**
 * What the website's browser checks share (scripts/mobile.ts, scripts/fillable.ts, scripts/stars.ts): the stand-in for
 * tsx's name helper, axe-core read from the e2e package, a wait for the layout to settle, and GitHub's answers to the
 * header's repository widget given by the check itself.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { BrowserContext, Page } from 'playwright';

export const WEBSITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * tsx compiles these scripts with esbuild's keepNames, which wraps named functions in a `__name(…)` call; the
 * functions handed to page.evaluate run in the page, where that helper does not exist, so each page gets a stand-in.
 */
export const KEEP_NAMES_SHIM = 'globalThis.__name ??= (target) => target;';

/** axe-core's browser build, from the e2e package's dependency (@axe-core/playwright): the website adds none. */
export function axeSource(): string {
  const fromE2e = createRequire(path.join(WEBSITE, '..', 'e2e', 'package.json'));
  const builder = fromE2e.resolve('@axe-core/playwright');
  const axe = createRequire(builder).resolve('axe-core');
  return readFileSync(path.join(path.dirname(axe), 'axe.min.js'), 'utf8');
}

type AxeResult = { violations: { id: string; help: string; nodes: { target: unknown[] }[] }[] };

/** axe-core's violations on the page as it is now (all its non-experimental rules, as the e2e tests run it). */
export async function axeProblems(page: Page, source: string): Promise<string[]> {
  const loaded = await page.evaluate(() => 'axe' in window);
  if (!loaded) await page.addScriptTag({ content: source });
  const result = (await page.evaluate(() =>
    (window as unknown as { axe: { run: (context: Document, options: object) => Promise<unknown> } }).axe.run(
      document,
      { resultTypes: ['violations'] },
    ),
  )) as AxeResult;
  return result.violations.map(
    (violation) =>
      `axe ${violation.id}: ${violation.help} (${violation.nodes
        .slice(0, 3)
        .map((node) => JSON.stringify(node.target))
        .join(', ')})`,
  );
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
 * the latest release's tag), or with GitHub's 404 to both (its answer for the private repository today: nothing
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
