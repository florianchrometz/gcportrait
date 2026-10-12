// SPDX-License-Identifier: MIT
import { expect, test } from '@playwright/test';

import { scratchShot } from './support.js';

/**
 * Visual smoke test: checks the chrome tokens are applied in each theme and saves screenshots of the
 * shell to e2e/.scratch/ (git-ignored) for a person to look at. The diagram's visual baselines are SVG text
 * (e2e/baselines/diagram/, e2e/README.md).
 */
/** gcp-diagram-style §9: surface and on-surface per theme. */
const EXPECTED = {
  light: { surface: 'rgb(255, 255, 255)', onSurface: 'rgb(32, 33, 36)' },
  dark: { surface: 'rgb(31, 31, 31)', onSurface: 'rgb(232, 234, 237)' },
} as const;

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    test(`shell uses the ${scheme} tokens; screenshots saved`, async ({ page }) => {
      for (const route of ['/diagram', '/', '/settings']) {
        await page.goto(route);
        await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
        await page.evaluate(async () => {
          await document.fonts.ready;
        });
        const colours = await page.evaluate(() => {
          const style = getComputedStyle(document.body);
          return { surface: style.backgroundColor, onSurface: style.color };
        });
        expect(colours).toEqual(EXPECTED[scheme]);
        const name = route === '/' ? 'connect' : route.slice(1);
        await scratchShot(page, '.', `shell-${name}-${scheme}`);
      }
    });
  });
}
