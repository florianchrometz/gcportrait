// SPDX-License-Identifier: Apache-2.0
import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  DEMO_M_DIAGRAM,
  detailsDrawer,
  expectNoAxeViolations,
  hashOf,
  openDiagram,
  scratchShot,
} from './support.js';

/**
 * Search on demo organisation M: `/` focuses the box, the results are grouped by kind with a count, and
 * choosing the first result lands on the right card — selected (the hash, the ring, the drawer) and glided to the
 * centre of the room the disclosure bar leaves, its collapsed ancestors flipped open first — for an IP, a domain, a
 * project id and a label. Only the current text's results can be chosen: a new text typed over earlier results and
 * Enter pressed at once lands on the new text's best result (by keyboard), and a click on a result lands too. These
 * run once, in the light theme: the theme changes none of it. A node the lens leaves out opens the reveal dialog,
 * whose offer switches to the Everything lens and lands on it; axe finds nothing with the results or the dialog open:
 * both in both themes.
 */

const BASTION = '//compute.googleapis.com/projects/demo-vm-1/zones/europe-west3-a/instances/bastion';
const BILLING_API = '//run.googleapis.com/projects/demo-svc-1/locations/europe-west3/services/billing-api';
const WEB_PROJECT = '//cloudresourcemanager.googleapis.com/projects/10000000009';
const ORDERS_DB = '//cloudsql.googleapis.com/projects/demo-svc-1/instances/orders-db';
const ATTESTOR =
  '//cloudkms.googleapis.com/projects/demo-sec-1/locations/europe-west3/keyRings/kr-europe-west3/cryptoKeys/attestor';

/** What the e2e searches for, and the card each must land on: an IP, a domain, a project id and a label. */
const SEARCHES = [
  { what: 'an IP', query: '10.0.14.5', id: BASTION, name: 'bastion' },
  {
    what: 'a domain',
    query: 'billing-api-10000000011.europe-west3.run.app',
    id: BILLING_API,
    name: 'billing-api',
  },
  { what: 'a project id', query: 'demo-web-1', id: WEB_PROJECT, name: 'Retail web (prod)' },
  { what: 'a label', query: 'orders-db', id: ORDERS_DB, name: 'orders-db' },
] as const;

function searchBox(page: Page): Locator {
  return page.getByRole('banner').getByRole('combobox', { name: 'Search assets' });
}

/** Types a query after focusing the box with `/`, and waits for its results. */
async function search(page: Page, query: string): Promise<Locator> {
  // Start from the canvas, so `/` comes from outside any text field.
  await page.locator('main').focus();
  await page.keyboard.press('/');
  const box = searchBox(page);
  await expect(box).toBeFocused();
  await box.fill(query);
  const list = page.getByRole('listbox', { name: 'Search assets' });
  await expect(list).toBeVisible();
  // The results are this text's, not an earlier text's (those are listed `aria-busy` until the answer comes).
  await expect(list).not.toHaveAttribute('aria-busy', 'true');
  return list;
}

/**
 * The node is selected and the camera has glided it to the centre of the room the disclosure bar leaves, the canvas
 * above its row at rest (the bar floats over the canvas's foot and the directed moves keep clear of it).
 */
async function expectLanded(page: Page, svg: Locator, id: string): Promise<void> {
  await expect.poll(() => hashOf(page)).toContain(`selection=${id}`);
  const node = svg.locator(`[data-id="${id}"]`).first();
  await expect(node).toHaveAttribute('aria-pressed', 'true', { timeout: 20_000 });
  await expect(svg.locator('.dg-select-ring')).not.toHaveAttribute('display', 'none');
  await expect(detailsDrawer(page)).toBeVisible();
  const bar = page.locator('#diagram-canvas [data-canvas-jump]');
  await expect
    .poll(
      async () => {
        const [canvas, box, row] = await Promise.all([
          svg.boundingBox(),
          node.boundingBox(),
          bar.boundingBox(),
        ]);
        if (canvas === null || box === null || row === null) return Number.POSITIVE_INFINITY;
        const bottom = Math.min(canvas.y + canvas.height, row.y);
        const dx = box.x + box.width / 2 - (canvas.x + canvas.width / 2);
        const dy = box.y + box.height / 2 - (canvas.y + bottom) / 2;
        return Math.hypot(dx, dy);
      },
      { timeout: 5_000 },
    )
    .toBeLessThan(4);
}

for (const { what, query, id, name } of SEARCHES) {
  test(`searching for ${what} lands on the right card`, async ({ page }) => {
    const svg = await openDiagram(page, DEMO_M_DIAGRAM);
    const list = await search(page, query);
    const first = list.getByRole('option').first();
    await expect(first).toHaveAccessibleName(name);
    await expect(page.getByRole('search').getByRole('status').first()).toHaveText(/^\d+ results?/);
    await page.keyboard.press('ArrowDown');
    await expect(first).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Enter');
    await expectLanded(page, svg, id);
    expect(hashOf(page)).toContain(`highlight=${query}`);
    await expect(searchBox(page)).toHaveValue(query);
    if (what === 'an IP') await scratchShot(page, 'search', 'landed-ip-light');
  });
}

test('Enter pressed before a new text’s results arrive lands on its best result, never an earlier one', async ({
  page,
}) => {
  const svg = await openDiagram(page, DEMO_M_DIAGRAM);
  const list = await search(page, '10.0.14.5');
  await expect(list.getByRole('option').first()).toHaveAccessibleName('bastion');
  const status = page.getByRole('search').getByRole('status').first();
  await expect(status).toHaveText(/^\d+ results?/);
  // Type over the text and press Enter at once: the earlier results are still listed, but busy.
  const box = searchBox(page);
  await box.fill('orders-db');
  await box.press('Enter');
  await expectLanded(page, svg, ORDERS_DB);
  expect(hashOf(page)).toContain('highlight=orders-db');
  expect(hashOf(page)).not.toContain(BASTION);
  await expect(box).toHaveValue('orders-db');
});

test('a click on a result lands on its card', async ({ page }) => {
  const svg = await openDiagram(page, DEMO_M_DIAGRAM);
  const list = await search(page, 'demo-web-1');
  await list.getByRole('option', { name: 'Retail web (prod)' }).click();
  await expectLanded(page, svg, WEB_PROJECT);
  await expect(searchBox(page)).toBeFocused();
});

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`search, ${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    test('the results are grouped by kind with icons, and axe finds nothing with them open', async ({
      page,
    }) => {
      await openDiagram(page, DEMO_M_DIAGRAM);
      const list = await search(page, 'web');
      const groups = list.getByRole('group');
      expect(await groups.count()).toBeGreaterThan(1);
      await expect(groups.first()).toHaveAccessibleName(/^(Folders|Projects|Networks|Containers|Resources)$/);
      await expect(list.locator('[role="option"] svg[aria-hidden="true"]').first()).toBeVisible();
      await scratchShot(page, 'search', `results-${scheme}`);
      await expectNoAxeViolations(page);
    });

    test('a node the lens leaves out: the reveal dialog switches to the Everything lens on confirm', async ({
      page,
    }) => {
      const svg = await openDiagram(page, '/diagram#snapshot=demo:M&lens=networking');
      await search(page, 'attestor');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog', { name: 'attestor is not in this view' });
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText('The Networking lens does not draw the type');
      // The results list closed when the result was chosen; only the dialog is open.
      await expect(searchBox(page)).toHaveAttribute('aria-expanded', 'false');
      await expect(page.getByRole('listbox', { name: 'Search assets' })).toBeHidden();
      const offer = dialog.getByRole('button', { name: 'Switch to the Everything lens' });
      await expect(offer).toBeFocused();
      expect(hashOf(page)).not.toContain('selection=');
      await scratchShot(page, 'search', `reveal-dialog-${scheme}`);
      await expectNoAxeViolations(page);
      await offer.click();
      await expect(dialog).toBeHidden();
      await expect.poll(() => hashOf(page)).toContain('lens=everything');
      await expectLanded(page, svg, ATTESTOR);
    });
  });
}
