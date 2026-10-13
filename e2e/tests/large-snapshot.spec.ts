// SPDX-License-Identifier: MIT
import { expect, test, type Locator, type Page } from '@playwright/test';

import { expectNoAxeViolations, primaryNav } from './support.js';

/**
 * The large-snapshot guard in Chromium, in demo mode: "Try the demo" with size XL (about 50 000 assets, more than
 * `LARGE_SNAPSHOT_ASSETS`) asks first, in an alert dialog with focus on Cancel; Cancel stays on the Connect page
 * and generates nothing; "Draw it anyway" generates the organisation and the diagram pipeline starts on it; with
 * "Do not ask again in this session" ticked, the next XL is not asked about, in this tab only; axe finds nothing
 * with the dialog open, in both themes. The drawing itself is not waited for: the layout's budget tests cover XL.
 */

function demoRegion(page: Page): Locator {
  return page.getByRole('region', { name: 'Demo mode' });
}

function question(page: Page): Locator {
  return page.getByRole('alertdialog', { name: 'Draw a large snapshot?' });
}

async function tryXl(page: Page): Promise<void> {
  await demoRegion(page).getByRole('radio', { name: 'XL' }).click();
  await demoRegion(page).getByRole('button', { name: 'Try the demo' }).click();
}

/** The diagram pipeline is on its way (a loading stage) or done (the canvas drawn). */
async function pipelineStarted(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const stages =
            /^(Generating the demo organisation|Reading the assets|Building the graph|Building the view|Laying out the diagram)…$/;
          const status = [...document.querySelectorAll('[role="status"]')].some((element) =>
            stages.test(element.textContent),
          );
          return status || document.querySelector('svg.dg-canvas') !== null;
        }),
      { timeout: 60_000 },
    )
    .toBe(true);
}

test('Try the demo XL asks first: Cancel stays on the Connect page, Draw it anyway draws it, the session box silences it', async ({
  page,
}) => {
  await page.goto('/');
  await tryXl(page);
  const dialog = question(page);
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await expect(dialog).toHaveAccessibleDescription(
    'This snapshot has about 50,000 assets. Drawing more than 10,000 assets at once is slow and heavy on memory; ' +
      'the diagram will still work.',
  );
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  // Tab stays inside it.
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Draw it anyway' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('checkbox', { name: 'Do not ask again in this session' })).toBeFocused();

  // Cancel: the Connect page as it was, nothing generated.
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  expect(new URL(page.url()).pathname).toBe('/');
  await expect(demoRegion(page).getByRole('progressbar')).toHaveCount(0);
  await expect(demoRegion(page).getByRole('button', { name: 'Try the demo' })).toBeFocused();

  // Escape cancels as well.
  await tryXl(page);
  await expect(question(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(question(page)).toBeHidden();
  expect(new URL(page.url()).pathname).toBe('/');

  // Draw it anyway, not asking again in this session: generated, then drawn.
  await tryXl(page);
  await question(page).getByRole('checkbox', { name: 'Do not ask again in this session' }).check();
  await question(page).getByRole('button', { name: 'Draw it anyway' }).click();
  await expect(page).toHaveURL(/\/diagram#snapshot=demo:XL$/, { timeout: 120_000 });
  await pipelineStarted(page);
  await expect(question(page)).toHaveCount(0);
  expect(await page.evaluate(() => window.sessionStorage.getItem('gcportrait.drawLargeSnapshots'))).toBe(
    'draw',
  );
  expect(await page.evaluate(() => window.localStorage.getItem('gcportrait.drawLargeSnapshots'))).toBeNull();

  // The same tab is not asked again; it generates at once.
  await primaryNav(page).getByRole('link', { name: 'Connect' }).click();
  await tryXl(page);
  await expect(
    demoRegion(page).getByRole('progressbar', { name: 'Preparing the demo organisation' }),
  ).toBeVisible();
  await expect(question(page)).toHaveCount(0);
});

test('a new tab asks again: the setting lives in the tab’s session only', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(() => {
    window.sessionStorage.setItem('gcportrait.drawLargeSnapshots', 'draw');
  });
  const other = await context.newPage();
  await other.goto('/');
  await tryXl(other);
  await expect(question(other)).toBeVisible();
  await question(other).getByRole('button', { name: 'Cancel' }).click();
  await expect(question(other)).toBeHidden();
});

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    test(`axe finds nothing with the question open (${scheme})`, async ({ page }) => {
      await page.goto('/');
      await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
      await tryXl(page);
      await expect(question(page)).toBeVisible();
      await expectNoAxeViolations(page);
    });
  });
}
