// SPDX-License-Identifier: MIT
import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Helpers for the specs of the phone and tablet layouts (mobile.spec.ts, handheld.spec.ts; frontend/AGENTS.md, Phones, tablets and desktops):
 * the layouts' measures and the top bar's two folds. The app is driven only through the browser; nothing here
 * imports it.
 */

/** The smallest touch target, in CSS pixels (WCAG 2.5.5's 44 × 44; a little rounding allowed). */
export const TARGET = 43.5;

/** Where the tablet's layout starts (48rem at a 16-pixel rem, frontend/src/ui/screen.ts): narrower is a phone. */
export const TABLET_FROM = 768;

/**
 * The top bar's folds below the desktop's width: View holds the view row's controls but the breadcrumb, More the
 * navigation and the app row's actions.
 */
export type Fold = 'View' | 'More';

/** A fold of the top bar: its button and its sheet. */
export function fold(page: Page, name: Fold): { readonly button: Locator; readonly sheet: Locator } {
  const banner = page.getByRole('banner');
  return {
    button: banner.getByRole('button', { name, exact: true }),
    sheet: banner.getByRole('dialog', { name, exact: true }),
  };
}

/** Opens a fold with a tap on its button (or a click, with `gesture` 'click'); answers its sheet once it shows. */
export async function openSheet(page: Page, name: Fold, gesture: 'tap' | 'click' = 'tap'): Promise<Locator> {
  const { button, sheet } = fold(page, name);
  await (gesture === 'tap' ? button.tap() : button.click());
  await expect(sheet).toBeVisible();
  return sheet;
}
