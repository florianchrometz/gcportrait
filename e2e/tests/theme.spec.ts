// SPDX-License-Identifier: Apache-2.0
import { expect, test } from '@playwright/test';

import { readStoredTheme, scratchShot } from './support.js';

/** The shell's surface and on-surface colours in each theme (gcp-diagram-style §9). */
const SHELL_COLOURS = {
  light: { surface: 'rgb(255, 255, 255)', onSurface: 'rgb(32, 33, 36)' },
  dark: { surface: 'rgb(31, 31, 31)', onSurface: 'rgb(232, 234, 237)' },
} as const;

test.use({ colorScheme: 'light' });

test('the theme choice on /settings changes <html data-theme> and persists across reload', async ({
  page,
}) => {
  await page.goto('/settings');
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-theme', 'light');
  await expect(page.getByRole('radio', { name: 'System' })).toBeChecked();

  await page.getByRole('radio', { name: 'Dark' }).check();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect.poll(() => readStoredTheme(page)).toBe('dark');

  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('radio', { name: 'Dark' })).toBeChecked();

  await page.getByRole('radio', { name: 'Light' }).check();
  await expect(html).toHaveAttribute('data-theme', 'light');
  // As above: the choice is stored (IndexedDB) before the reload; under load the write can trail the click.
  await expect.poll(() => readStoredTheme(page)).toBe('light');
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'light');
  await expect(page.getByRole('radio', { name: 'Light' })).toBeChecked();
});

test('IndexedDB alone restores the theme when the bootstrap mirror is gone', async ({ page }) => {
  await page.goto('/settings');
  await page.getByRole('radio', { name: 'Dark' }).check();
  await expect.poll(() => readStoredTheme(page)).toBe('dark');

  await page.evaluate(() => {
    window.localStorage.clear();
  });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('radio', { name: 'Dark' })).toBeChecked();
});

test('the bootstrap script applies the stored theme before any app code runs (no flash)', async ({
  page,
}) => {
  await page.goto('/settings');
  await page.getByRole('radio', { name: 'Dark' }).check();
  await expect.poll(() => readStoredTheme(page)).toBe('dark');

  // Block everything but the HTML document: only the inline bootstrap script can run.
  await page.route('**/*', (route) =>
    route.request().resourceType() === 'document' ? route.continue() : route.abort(),
  );
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('#root')).toBeEmpty();
});

test('"System" follows the operating system scheme live', async ({ page }) => {
  await page.goto('/settings');
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(html).toHaveAttribute('data-theme', 'light');
});

test('an explicit choice ignores the operating system scheme', async ({ page }) => {
  await page.goto('/settings');
  await page.getByRole('radio', { name: 'Light' }).check();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`the ${scheme} colour scheme`, () => {
    test.use({ colorScheme: scheme });

    test(`the shell takes the ${scheme} theme's surface colours on /diagram, / and /settings`, async ({
      page,
    }) => {
      for (const route of ['/diagram', '/', '/settings']) {
        await page.goto(route);
        await expect(page.locator('html'), route).toHaveAttribute('data-theme', scheme);
        const body = page.locator('body');
        await expect(body, route).toHaveCSS('background-color', SHELL_COLOURS[scheme].surface);
        await expect(body, route).toHaveCSS('color', SHELL_COLOURS[scheme].onSurface);
        await scratchShot(page, '.', `shell-${route === '/' ? 'connect' : route.slice(1)}-${scheme}`);
      }
    });
  });
}
