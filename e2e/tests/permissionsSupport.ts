// SPDX-License-Identifier: Apache-2.0
import { type BrowserContext, type Locator, type Page } from '@playwright/test';

/**
 * The Permissions page's fillable commands (preflight/CommandBlock.tsx, commands/), for their specs in live mode
 * (permissions-variables.spec.ts) and in demo mode (permissions-variables-demo.spec.ts).
 */

export function reference(page: Page): Locator {
  return page.getByRole('region', { name: 'What each mode needs' });
}

/** The reference table's row of a need, by words of its "Needed" cell. */
export function row(page: Page, need: RegExp): Locator {
  return reference(page).getByRole('row').filter({ hasText: need });
}

export function panel(page: Page): Locator {
  return reference(page).getByRole('group', { name: 'Variables' });
}

/** The values of every field of a variable on the page. */
export function values(page: Page, label: string): Promise<string[]> {
  return page
    .getByRole('textbox', { name: label, exact: true })
    .evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));
}

/** What the Copy button in `scope` copies, after a click. */
export async function copied(page: Page, scope: Locator): Promise<string> {
  await scope.getByRole('button', { name: /^Copy the command/ }).click();
  return page.evaluate(() => navigator.clipboard.readText());
}

export async function grantClipboard(context: BrowserContext): Promise<void> {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
}
