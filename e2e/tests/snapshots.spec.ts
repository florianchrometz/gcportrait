// SPDX-License-Identifier: Apache-2.0
import { readFileSync, writeFileSync } from 'node:fs';

import { expect, test, type Locator, type Page } from '@playwright/test';

import { drawnCanvas, expectNoAxeViolations, primaryNav, scratchShot } from './support.js';

/**
 * The demo entry and the Snapshots page in demo mode: "Try the demo" generates a demo organisation in a
 * worker started for the job (the demo generator runs in workers only; AGENTS.md, Architecture and code),
 * stores it in IndexedDB and opens it on the diagram; the size can be switched and survives a reload; stored
 * snapshots export as `.gcportrait.json` files that import back (read by the worker, loaded by the diagram's
 * data worker from IndexedDB) as separate copies, each under a new id (the demo organisations' files share
 * their snapshot id), and can be deleted: a deleted snapshot's ref then draws nothing, even while the data
 * worker still holds its Graph, and never another snapshot. Without IndexedDB the demo still works, in memory
 * until a reload. In both themes the Delete buttons are in the error colour, read from the computed styles, and
 * the controls beside them in the control's.
 */
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const READ = 'example.com, read 2026-10-08 00:00 UTC';
const M_LABEL = `${READ}, demo:M`;
const BUNDLE_NAME = 'gcportrait_example.com_20261008T000000Z.gcportrait.json';
/** What a browser names the second download of the same name. */
const SECOND_BUNDLE_NAME = 'gcportrait_example.com_20261008T000000Z (1).gcportrait.json';

// Each test generates demo organisations through the workers; a cold dev server compiles them first.
test.describe.configure({ timeout: 120_000 });

function demoCard(page: Page): Locator {
  return page
    .getByRole('region', { name: 'Demo mode' })
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: 'Demo organisations' }) });
}

async function tryDemo(page: Page, size: 'S' | 'M' | 'L' | 'XL'): Promise<Locator> {
  await primaryNav(page).getByRole('link', { name: 'Connect' }).click();
  const card = demoCard(page);
  await card.getByRole('radio', { name: size, exact: true }).click();
  await expect(card.getByRole('radio', { name: size, exact: true })).toHaveAttribute('aria-checked', 'true');
  await card.getByRole('button', { name: 'Try the demo' }).click();
  await expect(page).toHaveURL(new RegExp(`/diagram#snapshot=demo:${size}$`), { timeout: 60_000 });
  return drawnCanvas(page);
}

/** Demo M has a "Networking" folder under Platform; demo S does not (packages/demo-data README). */
function networkingFolder(svg: Locator): Locator {
  return svg.locator('text').filter({ hasText: /^Networking · folder \d+$/ });
}

async function snapshotsPage(page: Page): Promise<Locator> {
  await primaryNav(page).getByRole('link', { name: 'Snapshots' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Snapshots' })).toBeVisible();
  return page.getByRole('table', { name: 'Snapshots stored in this browser' });
}

function row(table: Locator, id: string): Locator {
  return table.locator(`tr[data-snapshot="${id}"]`);
}

/** Exports a row's snapshot and saves the file as `name` in the test's output directory. */
async function exportRow(page: Page, table: Locator, label: string, file: string): Promise<string> {
  const downloading = page.waitForEvent('download');
  await table.getByRole('button', { name: `Export ${label}` }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe(BUNDLE_NAME);
  await download.saveAs(file);
  return file;
}

/** What a chrome token resolves to in the page's theme, in the form computed styles give colours (`rgb(…)`). */
async function tokenColour(page: Page, name: string): Promise<string> {
  return page.evaluate((property) => {
    const probe = document.createElement('span');
    probe.style.color = `var(${property})`;
    document.body.append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  }, name);
}

/** A control's computed text and outline colours. */
async function expectColours(control: Locator, text: string, outline: string): Promise<void> {
  await expect(control).toHaveCSS('color', text);
  await expect(control).toHaveCSS('border-top-color', outline);
}

test('try demo S, switch to M, reload: M is still loaded; export both, import them as copies, load, delete', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  const small = await tryDemo(page, 'S');
  await expect(networkingFolder(small)).toHaveCount(0);

  const medium = await tryDemo(page, 'M');
  await expect(networkingFolder(medium).first()).toBeVisible();

  await page.reload();
  await expect(page).toHaveURL(/\/diagram#snapshot=demo:M$/);
  await expect(networkingFolder(await drawnCanvas(page)).first()).toBeVisible();

  // Both demo organisations were stored in IndexedDB, the newest first, and are still there after the reload.
  const table = await snapshotsPage(page);
  await expect(table.locator('tbody tr')).toHaveCount(2);
  await expect(table.locator('tbody tr').nth(0)).toHaveAttribute('data-snapshot', 'demo:M');
  await expect(table.locator('tbody tr').nth(1)).toHaveAttribute('data-snapshot', 'demo:S');
  const m = row(table, 'demo:M');
  // Each demo size is its own organisation: M is 30000000002.
  await expect(m.getByRole('rowheader')).toHaveText('example.comOrganisation 30000000002');
  await expect(m.getByRole('cell').nth(0)).toHaveText('2026-10-08 00:00 UTC');
  await expect(m.getByRole('cell').nth(1)).toHaveText('Demodemo:M · 35-day history');
  await expect(m.getByRole('cell').nth(2)).toHaveText('952');
  await expect(page.getByText(/^2 snapshots take [\d.]+ (kB|MB) in this browser\.$/)).toBeVisible();
  await expect(
    page.getByText(/^The browser estimates that this site uses about [\d.]+ (kB|MB) in all, of the/),
  ).toBeVisible();

  // Export M and S as .gcportrait.json bundles (a browser saves the second under "… (1)").
  const file = await exportRow(page, table, M_LABEL, testInfo.outputPath(BUNDLE_NAME));
  const smallFile = await exportRow(page, table, `${READ}, demo:S`, testInfo.outputPath(SECOND_BUNDLE_NAME));
  const bundle = JSON.parse(readFileSync(file, 'utf8')) as {
    format: string;
    notice?: string;
    snapshot: { id: string; assets: unknown[]; scope: unknown };
    history: { ticks: unknown[] };
  };
  expect(bundle.format).toBe('gcportrait.snapshot');
  // No non-affiliation line travels with an exported file (footers and long-form texts only; AGENTS.md,
  // Non-affiliation, brand and legal).
  expect(bundle.notice).toBeUndefined();
  expect(bundle.snapshot.assets).toHaveLength(952);
  expect(bundle.snapshot.id).toMatch(ULID);
  expect(bundle.history.ticks).toHaveLength(35);
  // Every demo organisation has the same deterministic snapshot id, so the two files carry the same one.
  const smallBundle = JSON.parse(readFileSync(smallFile, 'utf8')) as {
    snapshot: { id: string; assets: unknown[] };
  };
  expect(smallBundle.snapshot.assets).toHaveLength(96);
  expect(smallBundle.snapshot.id).toBe(bundle.snapshot.id);

  // Import both back together through the file picker: two more rows, each under a new id (never the files' own,
  // which the two share), the second noted as a copy.
  const choosing = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose files…' }).click();
  await (await choosing).setFiles([file, smallFile]);
  await expect(
    page.getByText(
      `Imported ${READ}, ${BUNDLE_NAME} (952 assets); ${READ}, ${SECOND_BUNDLE_NAME} (96 assets).`,
    ),
  ).toBeVisible({ timeout: 60_000 });
  await expect(
    page.getByText(
      `The snapshot in ${SECOND_BUNDLE_NAME} is also in another file of this import, so it was stored again as a ` +
        'separate copy.',
    ),
  ).toBeVisible();
  await expect(table.locator('tbody tr')).toHaveCount(4);
  const mediumCopy = table.locator('tbody tr').filter({ hasText: BUNDLE_NAME });
  await expect(mediumCopy.getByRole('cell').nth(1)).toHaveText(`Demo${BUNDLE_NAME} · 35-day history`);
  await expect(mediumCopy.getByRole('cell').nth(2)).toHaveText('952');
  const smallCopy = table.locator('tbody tr').filter({ hasText: SECOND_BUNDLE_NAME });
  await expect(smallCopy.getByRole('cell').nth(2)).toHaveText('96');
  const mediumId = (await mediumCopy.getAttribute('data-snapshot')) ?? '';
  const smallId = (await smallCopy.getAttribute('data-snapshot')) ?? '';
  expect(mediumId).toMatch(ULID);
  expect(smallId).toMatch(ULID);
  expect(new Set([bundle.snapshot.id, mediumId, smallId]).size).toBe(3);
  const copyLabel = `${READ}, ${BUNDLE_NAME}`;

  // Load the copies: the diagram's data worker reads each from IndexedDB, S as S and M as M.
  await smallCopy.getByRole('button', { name: `Load ${READ}, ${SECOND_BUNDLE_NAME}` }).click();
  await expect(page).toHaveURL(new RegExp(`/diagram#snapshot=${smallId}$`));
  await expect(networkingFolder(await drawnCanvas(page))).toHaveCount(0);
  await row(await snapshotsPage(page), mediumId)
    .getByRole('button', { name: `Load ${copyLabel}` })
    .click();
  await expect(page).toHaveURL(new RegExp(`/diagram#snapshot=${mediumId}$`));
  await expect(networkingFolder(await drawnCanvas(page)).first()).toBeVisible();

  // Delete the M copy, after confirming; the data worker still holds its Graph.
  const again = await snapshotsPage(page);
  await row(again, mediumId)
    .getByRole('button', { name: `Delete ${copyLabel}` })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Delete this snapshot?' });
  await expect(dialog).toContainText(`${copyLabel}, 952 assets.`);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(again.locator('tbody tr')).toHaveCount(4);
  await row(again, mediumId)
    .getByRole('button', { name: `Delete ${copyLabel}` })
    .click();
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(again.locator('tbody tr')).toHaveCount(3);
  await expect(page.getByRole('heading', { name: 'Stored snapshots' })).toBeFocused();

  // Back to the deleted copy's view, without a reload: nothing is drawn from memory; it says so, as after a reload.
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/diagram#snapshot=${mediumId}$`));
  await expect(page.getByRole('alert')).toContainText(
    `No snapshot "${mediumId}" is stored in this browser.`,
    {
      timeout: 60_000,
    },
  );
  await expect(page.locator('svg.dg-canvas')).toHaveCount(0);

  // Import the S file again (it carries the same id as the deleted M copy's file): a new id, which draws S.
  await snapshotsPage(page);
  const rechoosing = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose files…' }).click();
  await (await rechoosing).setFiles(smallFile);
  await expect(page.getByText(`Imported ${READ}, ${SECOND_BUNDLE_NAME} (96 assets).`)).toBeVisible({
    timeout: 60_000,
  });
  await expect(again.locator('tbody tr')).toHaveCount(4);
  const ids = await again
    .locator('tbody tr')
    .evaluateAll((rows) => rows.map((tr) => tr.getAttribute('data-snapshot')));
  const smallAgain = ids.find((id) => id !== null && ![smallId, 'demo:M', 'demo:S'].includes(id)) ?? '';
  expect(smallAgain).toMatch(ULID);
  expect([mediumId, bundle.snapshot.id]).not.toContain(smallAgain);
  await row(again, smallAgain)
    .getByRole('button', { name: /^Load / })
    .click();
  await expect(page).toHaveURL(new RegExp(`/diagram#snapshot=${smallAgain}$`));
  await expect(networkingFolder(await drawnCanvas(page))).toHaveCount(0);

  // The same after a reload: S under its ref, and the deleted ref still names nothing.
  await page.reload();
  await expect(networkingFolder(await drawnCanvas(page))).toHaveCount(0);
  await page.goto(`/diagram#snapshot=${mediumId}`);
  await expect(page.getByRole('alert')).toContainText(
    `No snapshot "${mediumId}" is stored in this browser.`,
    {
      timeout: 60_000,
    },
  );
  const reloaded = await snapshotsPage(page);
  await expect(reloaded.locator('tbody tr')).toHaveCount(4);
  await expect(row(reloaded, smallId)).toHaveCount(1);
  await expect(row(reloaded, smallAgain)).toHaveCount(1);
});

test('an import that is not a snapshot is refused with its problems', async ({ page }, testInfo) => {
  await page.goto('/snapshots');
  const file = testInfo.outputPath('broken.json');
  writeFileSync(file, 'not json\n[1, 2]\n');
  const choosing = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose files…' }).click();
  await (await choosing).setFiles(file);
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Nothing was imported from broken.json.');
  await expect(alert).toContainText('No assets were found in broken.json.');
  await expect(alert.getByRole('listitem')).toHaveCount(2);
  await expect(
    page.getByText('No snapshots are stored in this browser yet.', { exact: false }),
  ).toBeVisible();
});

test('without IndexedDB the demo still works, in memory until a reload, and the page says so', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', { configurable: true, get: () => undefined });
  });
  await page.goto('/');
  await tryDemo(page, 'S');
  const table = await snapshotsPage(page);
  await expect(page.getByTestId('snapshots-memory-notice')).toContainText(
    'This browser does not let gcportrait store data here',
  );
  await expect(row(table, 'demo:S')).toContainText('in memory');
  await expect(
    page.getByText(/^1 snapshot takes [\d.]+ (kB|MB) in memory, until this page is reloaded or closed\.$/),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Choose files…' })).toHaveAttribute('aria-disabled', 'true');
  await row(table, 'demo:S')
    .getByRole('button', { name: /^Load / })
    .click();
  await drawnCanvas(page);

  // As the page says: a reload forgets what was kept in memory.
  await snapshotsPage(page);
  await page.reload();
  await expect(
    page.getByText('No snapshots are stored in this browser yet.', { exact: false }),
  ).toBeVisible();
});

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    test('axe reports no violations on the Connect page, on /snapshots and in the delete dialog', async ({
      page,
    }) => {
      await page.goto('/');
      await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
      const card = demoCard(page);
      await card.getByRole('radio', { name: 'M', exact: true }).click();
      await scratchShot(page, '.', `snapshots-connect-${scheme}`);
      await expectNoAxeViolations(page);
      await card.getByRole('button', { name: 'Try the demo' }).click();
      await drawnCanvas(page);

      const table = await snapshotsPage(page);
      await expect(table.locator('tbody tr')).toHaveCount(1);
      await expect(page.getByText(/^The browser estimates/)).toBeVisible();
      await scratchShot(page, '.', `snapshots-page-${scheme}`, { fullPage: true });
      await expectNoAxeViolations(page);

      await row(table, 'demo:M')
        .getByRole('button', { name: `Delete ${M_LABEL}` })
        .click();
      await expect(page.getByRole('dialog', { name: 'Delete this snapshot?' })).toBeVisible();
      await scratchShot(page, '.', `snapshots-delete-${scheme}`);
      await expectNoAxeViolations(page);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(row(table, 'demo:M').getByRole('button', { name: `Delete ${M_LABEL}` })).toBeFocused();
    });

    test('every Delete button is in the error colour, the controls beside it in the control’s, an inert one inert', async ({
      page,
    }) => {
      // The destructive control's rule outranks the control's own (ui/controls.module.css), so the colours hold
      // whatever order the stylesheets were emitted in, in the dev server as in the production build.
      await page.goto('/');
      await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
      await tryDemo(page, 'S');
      const table = await snapshotsPage(page);
      const error = await tokenColour(page, '--color-error');
      const text = await tokenColour(page, '--color-on-surface');
      const outline = await tokenColour(page, '--color-outline');
      expect(error).not.toBe(text);

      const label = `${READ}, demo:S`;
      const remove = row(table, 'demo:S').getByRole('button', { name: `Delete ${label}` });
      await expectColours(remove, error, error);
      await remove.hover();
      await expectColours(remove, error, error);
      await expectColours(
        row(table, 'demo:S').getByRole('button', { name: `Export ${label}` }),
        text,
        outline,
      );
      const removeAll = page.getByRole('button', { name: 'Delete all snapshots…' });
      await expectColours(removeAll, error, error);

      await remove.click();
      const dialog = page.getByRole('dialog', { name: 'Delete this snapshot?' });
      await expectColours(dialog.getByRole('button', { name: 'Delete', exact: true }), error, error);
      await expectColours(dialog.getByRole('button', { name: 'Cancel' }), text, outline);
      await dialog.getByRole('button', { name: 'Cancel' }).click();

      await removeAll.click();
      const all = page.getByRole('dialog', { name: 'Delete all snapshots?' });
      await expectColours(all.getByRole('button', { name: 'Delete all', exact: true }), error, error);
      await all.getByRole('button', { name: 'Delete all', exact: true }).click();
      await expect(table).toHaveCount(0);
      // Nothing left to delete: the button is inert and looks it (secondary text, the outline), not destructive.
      await expect(removeAll).toHaveAttribute('aria-disabled', 'true');
      await expectColours(removeAll, await tokenColour(page, '--color-on-surface-variant'), outline);
    });
  });
}
