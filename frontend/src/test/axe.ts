// SPDX-License-Identifier: MIT
/**
 * axe-core in jsdom, for the primitives' unit tests (the e2e suite runs it in Chromium on whole pages). jsdom
 * does no layout, so the rules that need rendered pixels (colour contrast) cannot decide there; the contrast of
 * the tokens is checked by the theme tests, and the e2e suite's axe run covers it in a real browser.
 *
 * axe runs one audit at a time and refuses a second while one is under way ("Axe is already running"). A test
 * that times out leaves its audit running, so each run here waits for the one before it to end, however it
 * ends: one slow audit costs the next test time, never its result.
 */
import axe from 'axe-core';
import { expect } from 'vitest';

export interface AxeFinding {
  readonly rule: string;
  readonly impact: string | null;
  readonly help: string;
  readonly targets: readonly string[];
}

/** The last audit started in this test file, settled whatever its outcome. */
let previous: Promise<unknown> = Promise.resolve();

/** The axe violations inside `context` (all non-experimental rules, best practices included). */
export async function axeViolations(context: Element = document.body): Promise<AxeFinding[]> {
  const run = previous.then(() =>
    axe.run(context, {
      resultTypes: ['violations'],
      rules: { 'color-contrast': { enabled: false } },
    }),
  );
  previous = run.catch(() => undefined);
  const results = await run;
  return results.violations.map((violation) => ({
    rule: violation.id,
    impact: violation.impact ?? null,
    help: violation.help,
    targets: violation.nodes.map((node) => node.target.join(' ')),
  }));
}

/** Fails with a readable list when axe finds anything. */
export async function expectNoAxeViolations(context: Element = document.body): Promise<void> {
  expect(await axeViolations(context)).toEqual([]);
}
