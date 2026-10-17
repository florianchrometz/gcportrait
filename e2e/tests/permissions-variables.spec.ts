// SPDX-License-Identifier: MIT
import { expect, type Page } from '@playwright/test';

import { storedEverywhere, stubGoogle, TEST_CLIENT_ID, TEST_EMAIL } from '../fixtures/gis.js';
import { stubConfig, test } from '../fixtures/live.js';
import { copied, grantClipboard, panel, reference, row, values } from './permissionsSupport.js';
import { expectNoAxeViolations, scratchShot, SHOTS_WANTED } from './support.js';

/**
 * Fillable commands on the Permissions page (preflight/CommandBlock.tsx, commands/): every variable of a
 * command is a labelled field filled in place, and every field of a variable on the page shows one value,
 * prefilled from what the app knows (the scope picked, the signed-in account, the instance's service account)
 * and editable; Copy copies the command with the values (an unfilled one as its token) and says so; the
 * values outlive a reload in the tab's sessionStorage. Run by the `chromium-live` project on the normal-mode
 * server (every backend and Google call answered in the page): signed out, signed in, demo-only and
 * service-account cases; axe in both themes. The demo mode case:
 * permissions-variables-demo.spec.ts. Synthetic values only (AGENTS.md, Security and privacy, principle 6).
 */
const ACCOUNT = 'gcportrait-backend@demo-host.iam.gserviceaccount.com';
const TOKEN = 'e2e-fake-access-token-variables-7c2e';
const FOLDER = {
  kind: 'folder',
  scope: 'folders/20000000001',
  id: '20000000001',
  displayName: 'Web shop',
  parent: 'organizations/30000000001',
} as const;

async function stubBackend(page: Page, overrides: Record<string, unknown> = {}): Promise<void> {
  await stubConfig(page, {
    oauthClientId: TEST_CLIENT_ID,
    saMode: true,
    backendServiceAccount: ACCOUNT,
    ...overrides,
  });
  await page.route('**/api/scopes/search', (route) =>
    route.fulfill({ json: { scopes: [FOLDER], problems: [] } }),
  );
}

test('signed out: fill a variable once, every command follows; Copy copies the filled command; a reload keeps it', async ({
  page,
  context,
}) => {
  await grantClipboard(context);
  await stubBackend(page);
  await page.goto('/permissions');
  await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeEnabled();

  // Nothing is known signed out but the instance's service account (from /api/config).
  await expect.poll(() => values(page, 'Organisation number')).toEqual(['', '', '', '']);
  await expect.poll(() => values(page, 'Your e-mail')).toEqual(['', '', '']);
  await expect.poll(() => values(page, 'Service account')).toEqual([ACCOUNT, ACCOUNT]);
  const listing = row(page, /^Your account.*single permission/);
  const field = listing.getByRole('textbox', { name: 'Organisation number' });
  await expect(field).toHaveAttribute('placeholder', 'YOUR_ORG_ID');

  // Filled in the first command: the other commands and the panel follow at once.
  await field.fill('30000000001');
  await expect.poll(() => values(page, 'Organisation number')).toEqual(Array(4).fill('30000000001'));

  const exportRow = row(page, /^Export file/);
  const exportCopy = exportRow.getByRole('button', { name: /^Copy the command/ });
  await expect(exportCopy).toHaveAccessibleName(
    'Copy the command that exports the scope’s assets to Cloud Storage (reference)',
  );
  await expect(exportCopy).toHaveAccessibleDescription('1 value to fill');
  expect(await copied(page, exportRow)).toBe(
    'gcloud asset export --organization=30000000001 --content-type=resource --output-path=gs://YOUR_BUCKET/export.json',
  );
  await expect(exportRow.getByRole('status')).toHaveText('Copied, with 1 value still to fill: YOUR_BUCKET.');

  // Filled in the panel: the command follows, and copies complete.
  await panel(page).getByRole('textbox', { name: 'Bucket' }).fill('demo-exports-1');
  await expect(exportRow.getByRole('textbox', { name: 'Bucket' })).toHaveValue('demo-exports-1');
  await expect(exportCopy).not.toHaveAttribute('aria-describedby');
  expect(await copied(page, exportRow)).toBe(
    'gcloud asset export --organization=30000000001 --content-type=resource --output-path=gs://demo-exports-1/export.json',
  );
  await expect(exportRow.getByRole('status')).toHaveText('Copied.');

  // A value of the wrong format is marked on leaving the field, never refused.
  const email = listing.getByRole('textbox', { name: 'Your e-mail' });
  await email.fill('ada');
  await expect(email).not.toHaveAttribute('aria-invalid');
  await email.press('Tab');
  await expect(email).toHaveAttribute('aria-invalid', 'true');
  await expect(listing.getByRole('button', { name: /^Copy the command/ })).toHaveAccessibleDescription(
    'Check Your e-mail: an e-mail address such as ada@example.com.',
  );
  await email.fill('ada@example.com');
  await expect(email).not.toHaveAttribute('aria-invalid');

  // A reload in this tab shows the values again; another tab starts empty (sessionStorage).
  await page.reload();
  await expect.poll(() => values(page, 'Organisation number')).toEqual(Array(4).fill('30000000001'));
  await expect.poll(() => values(page, 'Bucket')).toEqual(['demo-exports-1', 'demo-exports-1']);
  await expect.poll(() => values(page, 'Your e-mail')).toEqual(Array(3).fill('ada@example.com'));
  const other = await context.newPage();
  await stubBackend(other);
  await other.goto('/permissions');
  await expect.poll(() => values(other, 'Organisation number')).toEqual(['', '', '', '']);
  await other.close();

  // Clear values forgets what was typed.
  await panel(page).getByRole('button', { name: 'Clear values' }).click();
  await expect.poll(() => values(page, 'Organisation number')).toEqual(['', '', '', '']);
  expect(await page.evaluate(() => window.sessionStorage.getItem('gcportrait.commandVariables'))).toBeNull();
});

test('signed in: the scope picked, the account and the service account are prefilled, and stay editable', async ({
  page,
  context,
}) => {
  await grantClipboard(context);
  await stubBackend(page);
  await stubGoogle(page, { tokens: [TOKEN] });
  await page.goto('/permissions');
  const check = page.getByRole('region', { name: 'Check a scope' });
  await check.getByRole('button', { name: 'Sign in with Google' }).click();
  await check.getByRole('combobox', { name: 'Scope' }).fill('web');
  await page.getByRole('option', { name: /Web shop/ }).click();

  // The folder's commands, filled in with what the app knows.
  await expect.poll(() => values(page, 'Folder number')).toEqual(Array(4).fill('20000000001'));
  await expect.poll(() => values(page, 'Your e-mail')).toEqual(Array(3).fill(TEST_EMAIL));
  await expect.poll(() => values(page, 'Service account')).toEqual([ACCOUNT, ACCOUNT]);
  const listing = row(page, /^Your account.*single permission/);
  expect(await copied(page, listing)).toBe(
    `gcloud resource-manager folders add-iam-policy-binding 20000000001 --member="user:${TEST_EMAIL}" --role="roles/cloudasset.viewer"`,
  );

  // Edited in the service account's command: every command follows.
  await row(page, /^Service account.*roles\/cloudasset.viewer/)
    .getByRole('textbox', { name: 'Folder number' })
    .fill('20000000002');
  await expect.poll(() => values(page, 'Folder number')).toEqual(Array(4).fill('20000000002'));
  expect(await copied(page, listing)).toBe(
    `gcloud resource-manager folders add-iam-policy-binding 20000000002 --member="user:${TEST_EMAIL}" --role="roles/cloudasset.viewer"`,
  );
  await expect(listing.getByRole('status')).toHaveText('Copied.');
  // The token never reaches a value, a field or any storage.
  expect(await storedEverywhere(page)).not.toContain(TOKEN);
});

test('a demo-only instance: the commands’ fields start empty and fill in place', async ({
  page,
  context,
}) => {
  await grantClipboard(context);
  await stubBackend(page, {
    demoOnly: true,
    oauthClientId: null,
    saMode: false,
    backendServiceAccount: null,
  });
  await page.goto('/permissions');
  await expect(page.getByText(/This instance is a demo/)).toBeVisible();
  await expect.poll(() => values(page, 'Service account')).toEqual(['', '']);
  await expect.poll(() => values(page, 'Quota project')).toEqual(['', '', '']);
  const quota = row(page, /^Your account.*quota project/);
  await quota.getByRole('textbox', { name: 'Quota project' }).first().fill('demo-billing-1');
  await expect.poll(() => values(page, 'Quota project')).toEqual(Array(3).fill('demo-billing-1'));
  expect(await copied(page, quota.locator('div', { hasText: /^gcloud services enable/ }).first())).toBe(
    'gcloud services enable cloudasset.googleapis.com --project=demo-billing-1',
  );
});

for (const scheme of ['light', 'dark'] as const) {
  test(`${scheme} theme: axe finds nothing with filled, unfilled and invalid fields`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await stubBackend(page);
    await page.goto('/permissions');
    await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
    await expect.poll(() => values(page, 'Service account')).toEqual([ACCOUNT, ACCOUNT]);
    await panel(page).getByRole('textbox', { name: 'Organisation number' }).fill('30000000001');
    await panel(page).getByRole('textbox', { name: 'Bucket' }).fill('demo-exports-1');
    await expectNoAxeViolations(page);
    if (SHOTS_WANTED) {
      // For a person to look at (git-ignored): the whole page with filled variables (its main area scrolls inside
      // the shell, so a viewport tall enough for all of it), and the table's first rows up close.
      await page.setViewportSize({ width: 1440, height: 2400 });
      await scratchShot(page, 'permissions-variables', `permissions-filled-${scheme}`);
      await scratchShot(reference(page), 'permissions-variables', `reference-filled-${scheme}`);
      await page.setViewportSize({ width: 1440, height: 900 });
    }

    const email = row(page, /^Your account.*single permission/).getByRole('textbox', { name: 'Your e-mail' });
    await email.fill('ada');
    await email.press('Tab');
    await expect(email).toHaveAttribute('aria-invalid', 'true');
    await email.focus();
    await expectNoAxeViolations(page);
    await scratchShot(
      row(page, /^Your account.*single permission/),
      'permissions-variables',
      `invalid-focused-${scheme}`,
    );
  });
}
