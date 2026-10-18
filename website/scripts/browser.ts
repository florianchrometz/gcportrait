// SPDX-License-Identifier: Apache-2.0
/**
 * What the website's browser checks share (scripts/mobile.ts, scripts/fillable.ts, scripts/demo.ts):
 * the stand-in for tsx's name helper, axe-core via @axe-core/playwright, a wait for the layout to settle, and how to
 * tell a wait that ran out from any other failure.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { AxeBuilder } from '@axe-core/playwright';
import { errors, type Page } from 'playwright';

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
