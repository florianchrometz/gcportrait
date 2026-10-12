// SPDX-License-Identifier: MIT
import { expect, test, type Page } from '@playwright/test';

import {
  expectNoAxeViolations,
  openDiagram,
  primaryNav,
  readStoredTheme,
  scratchShot,
  WORDMARK,
} from './support.js';

/**
 * Findings of the app walkthrough of 2026-10-10, in the browser at the minimum desktop viewport, 1280 × 800
 * (ADR 0011), in both themes: the Networking lens on demo M opens readable (its
 * default detail is the ceiling of `auto`, so the fitted drawing keeps its labels); the top bar's Theme menu sets
 * the same preference as Settings; "Try the demo" lands focus on the page and announces it; the view row is shown
 * on the diagram page only; a link naming no snapshot and a refused focus say so. Screenshots of the Networking
 * lens and of the Theme menu go to e2e/.scratch/walkthrough/ (git-ignored).
 */
test.use({ viewport: { width: 1280, height: 800 } });

function canvasClasses(page: Page): Promise<string> {
  return page
    .locator('svg.dg-canvas[data-diagram-ready="true"]')
    .evaluate((svg) => svg.getAttribute('class') ?? '');
}

async function shot(page: Page, name: string): Promise<void> {
  await scratchShot(page, 'walkthrough', name);
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    test('the Networking lens on demo M opens readable at 1280 × 800: auto, no deeper than networks, labels drawn', async ({
      page,
    }) => {
      await openDiagram(page, '/diagram#snapshot=demo:M');
      await page.getByRole('banner').getByRole('combobox', { name: 'Lens' }).click();
      await page.getByRole('option', { name: 'Networking' }).click();
      await expect.poll(() => page.url()).toMatch(/#snapshot=demo:M&lens=networking$/);
      await expect(page.locator('svg.dg-canvas > title')).toHaveText(
        'gcportrait diagram of example.com, Networking lens',
        { timeout: 30_000 },
      );
      const auto = page.getByRole('radiogroup', { name: 'Detail' }).getByRole('radio', { name: /^Auto · / });
      await expect(auto).toHaveAttribute('aria-checked', 'true');
      await expect(auto).toHaveText(/^Auto · (folders|projects|networks)$/);
      // Fitted to the canvas, the drawing keeps its labels (the walkthrough saw 172 rects below the label scale).
      const scale = Number(
        await page.locator('svg.dg-canvas[data-diagram-ready="true"]').getAttribute('data-scale'),
      );
      expect(scale).toBeGreaterThanOrEqual(0.35);
      expect(await canvasClasses(page)).not.toContain('dg-lod-nolabel');
      const shown = await page.getByText(/^\d+ of \d+ shown$/).textContent();
      expect(Number(shown?.split(' ')[0])).toBeLessThan(120);
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      await shot(page, `networking-M-1280x800-${scheme}`);
      await expectNoAxeViolations(page);
    });

    test('the top bar’s Theme menu sets the preference Settings shows, and it survives a reload', async ({
      page,
    }) => {
      await page.goto('/settings');
      const other = scheme === 'light' ? 'Dark' : 'Light';
      const button = page.getByRole('banner').getByRole('button', { name: 'Theme' });
      await button.click();
      const menu = page.getByRole('menu', { name: 'Theme' });
      await expect(menu.getByRole('menuitemradio', { name: 'System' })).toHaveAttribute(
        'aria-checked',
        'true',
      );
      await expectNoAxeViolations(page);
      await shot(page, `theme-menu-open-${scheme}`);
      await menu.getByRole('menuitemradio', { name: other }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', other.toLowerCase());
      await expect(button).toBeFocused();
      await expect(page.getByRole('radio', { name: other })).toBeChecked();
      await shot(page, `theme-menu-chosen-${other.toLowerCase()}`);
      await expect.poll(() => readStoredTheme(page)).toBe(other.toLowerCase());
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('data-theme', other.toLowerCase());
      await page.getByRole('banner').getByRole('button', { name: 'Theme' }).click();
      await expect(
        page.getByRole('menu', { name: 'Theme' }).getByRole('menuitemradio', { name: other }),
      ).toHaveAttribute('aria-checked', 'true');
    });
  });
}

test('after “Try the demo” focus is on the page and the page is announced; the view row is the diagram’s only', async ({
  page,
}) => {
  await page.goto('/');
  // Away from the diagram the view row's controls are not shown (they could never work there).
  const banner = page.getByRole('banner');
  await expect(banner.getByRole('combobox', { name: 'Lens' })).toHaveCount(0);
  await expect(banner.getByRole('navigation', { name: 'Scope' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Try the demo' }).click();
  await expect(page).toHaveURL(/\/diagram#snapshot=demo:S$/, { timeout: 60_000 });
  await expect(page.getByRole('main')).toBeFocused();
  await expect(page.getByTestId('route-announcer')).toHaveText(`Diagram · ${WORDMARK}`);
  await expect(banner.getByRole('combobox', { name: 'Lens' })).toBeVisible();
  await primaryNav(page).getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('main')).toBeFocused();
  await expect(page.getByTestId('route-announcer')).toHaveText(`Settings · ${WORDMARK}`);
  await expect(banner.getByRole('combobox', { name: 'Lens' })).toHaveCount(0);
});

test('a link naming no snapshot says so, and a refused focus says so on its button', async ({ page }) => {
  await page.goto('/diagram#snapshot=demo:Q');
  await expect(page.getByRole('heading', { level: 2, name: 'This link names no snapshot' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('“demo:Q” is not a snapshot');
  await openDiagram(page, '/diagram#snapshot=demo:S&focus=project&focus.project=no-such');
  const focus = page.getByRole('banner').getByRole('button', { name: /^Focus/ });
  await expect(focus).toContainText('not applied');
  await expect(focus).toHaveAccessibleName(/^Focus: no-such, not applied$/);
});
