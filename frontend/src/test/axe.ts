// SPDX-License-Identifier: MIT
/**
 * axe-core in jsdom, for the primitives' unit tests (the e2e suite runs it in Chromium on whole pages). jsdom
 * does no layout, so the rules that need rendered pixels (colour contrast) cannot decide there; the contrast of
 * the tokens is checked by the theme tests, and the e2e suite's axe run covers it in a real browser.
 */
import axe from 'axe-core';
import { expect } from 'vitest';

export interface AxeFinding {
  readonly rule: string;
  readonly impact: string | null;
  readonly help: string;
  readonly targets: readonly string[];
}

/** The axe violations inside `context` (all non-experimental rules, best practices included). */
export async function axeViolations(context: Element = document.body): Promise<AxeFinding[]> {
  const results = await axe.run(context, {
    resultTypes: ['violations'],
    rules: { 'color-contrast': { enabled: false } },
  });
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
