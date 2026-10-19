// SPDX-License-Identifier: Apache-2.0
import { expect, test } from '@playwright/test';

import { copied, grantClipboard, row, values } from './permissionsSupport.js';

/**
 * Fillable commands on the Permissions page in demo mode (the `chromium` project): the guidance's commands fill in
 * place as they do on a live instance (permissions-variables.spec.ts).
 */

test('demo mode: the guidance’s commands fill in place too', async ({ page, context }) => {
  await grantClipboard(context);
  await page.goto('/permissions');
  await expect(page.getByText(/This instance is a demo/)).toBeVisible();
  await expect.poll(() => values(page, 'Organisation number')).toEqual(['', '', '', '']);
  await page.getByRole('textbox', { name: 'Organisation number' }).last().fill('30000000001');
  await expect.poll(() => values(page, 'Organisation number')).toEqual(Array(4).fill('30000000001'));
  expect(await copied(page, row(page, /^Export file/))).toBe(
    'gcloud asset export --organization=30000000001 --content-type=resource --output-path=gs://YOUR_BUCKET/export.json',
  );
});
