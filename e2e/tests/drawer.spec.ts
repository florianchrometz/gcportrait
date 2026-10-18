// SPDX-License-Identifier: Apache-2.0
import { expect, test, type Locator, type Page } from '@playwright/test';

import { COMPUTE_ALL, selectVm as selectBastion, stubConsole, VM, VM_PAGE } from './consoleSupport.js';
import {
  detailsDrawer,
  drawingOf,
  drawnCanvas,
  expectNoAxeViolations,
  hashOf,
  openDiagram,
  readStoredPreference,
  scratchShot,
} from './support.js';

/**
 * The details drawer in a real browser, on demo organisation M: selecting the bastion VM
 * opens it with the VM's facts, its subnet (in its Shared VPC network) and disk relations and its console page;
 * the camera keeps the VM clear of the drawer; a jump link selects the subnet, and one whose target sits in a
 * collapsed zone flips that zone open; "Raw JSON" shows `resource.data`; Escape closes the drawer back onto the
 * card; the width follows the handle and survives a reload; the project's "Drill in" re-roots the view. axe finds
 * nothing with the drawer open, in both themes. No request reaches Google: the Cloud Console is a stub page.
 */

const SUBNET =
  '//compute.googleapis.com/projects/demo-net-1/regions/europe-west3/subnetworks/demo-vm-1-europe-west3';
const DISK = '//compute.googleapis.com/projects/demo-vm-1/zones/europe-west3-a/disks/bastion';
const PROJECT = '//cloudresourcemanager.googleapis.com/projects/10000000013';

/** Selects the bastion VM and waits for the drawer with its relations. */
async function selectVm(page: Page): Promise<{ svg: Locator; vm: Locator; drawer: Locator }> {
  const { svg, vm } = await selectBastion(page);
  const drawer = detailsDrawer(page);
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('heading', { level: 3, name: /^Relations/ })).toBeVisible();
  return { svg, vm, drawer };
}

test('selecting a VM shows its facts, its subnet, network and disk relations and its console page', async ({
  page,
  context,
}) => {
  await stubConsole(context);
  const { svg, vm, drawer } = await selectVm(page);
  await expect(drawer.getByRole('heading', { level: 2 })).toHaveText('bastion');
  await expect(drawer).toContainText('Compute Engine instance');
  await expect(drawer).toContainText(VM);
  await expect(drawer.getByRole('button', { name: 'Copy resource name' })).toBeVisible();
  await expect(drawer).toContainText('demo-vm-1');
  await expect(drawer).toContainText('10000000013');
  await expect(drawer).toContainText('europe-west3-a');
  for (const value of ['10.0.14.5', '203.0.113.19', 'bastion.corp.example.com']) {
    await expect(drawer.getByRole('button', { name: `Copy ${value}` })).toBeVisible();
  }
  await expect(drawer.getByRole('listitem').filter({ hasText: 'team: retail' })).toBeVisible();

  // Relations by kind in the catalog's order (gcp-asset-catalog skill §4): attaches (the subnet, in its network),
  // then uses (the disk).
  const kinds = await drawer
    .locator('[data-kind]')
    .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-kind')));
  expect(kinds).toEqual(['attaches', 'uses', 'runsAs']);
  const attaches = drawer.locator('[data-kind="attaches"]');
  await expect(attaches.getByRole('heading')).toHaveText('attaches — a resource sits on a network/subnet');
  await expect(attaches.getByRole('button', { name: 'demo-vm-1-europe-west3' })).toHaveAttribute(
    'title',
    SUBNET,
  );
  await expect(attaches.getByRole('button', { name: 'vpc-shared-prod' })).toBeVisible();
  await expect(drawer.locator('[data-kind="uses"]').getByRole('button', { name: 'bastion' })).toHaveAttribute(
    'title',
    DISK,
  );

  // The console page from the catalog's template, opened in a new tab only when activated.
  const link = drawer.getByRole('link', { name: 'Open in Cloud Console (opens a new tab)' });
  await expect(link).toHaveAttribute('href', VM_PAGE);
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  expect(context.pages()).toHaveLength(1);

  // The camera kept the VM in view beside the drawer.
  await expect
    .poll(async () => {
      const card = await vm.boundingBox();
      const aside = await drawer.boundingBox();
      return card !== null && aside !== null && card.x >= 0 && card.x + card.width <= aside.x;
    })
    .toBe(true);
  await expect(svg).toBeVisible();
});

test('opening the drawer pans a card it would cover back into view, without a new layout', async ({
  page,
}) => {
  const svg = await openDiagram(page, COMPUTE_ALL);
  // The rightmost card: the drawer opens over the canvas's right edge.
  const ids = await svg.locator('.dg-card').evaluateAll((elements) =>
    elements
      .map((element) => {
        const box = element.getBoundingClientRect();
        return { id: element.getAttribute('data-id') ?? '', right: box.right };
      })
      .sort((a, b) => b.right - a.right)
      .map((each) => each.id),
  );
  const card = svg.locator(`[data-id="${ids[0] ?? ''}"]`);
  // Before: the card lies where the drawer (360 px at the right edge) is about to open.
  const page_ = page.viewportSize();
  const start = await card.boundingBox();
  if (page_ === null || start === null) throw new Error('no geometry');
  expect(start.x + start.width).toBeGreaterThan(page_.width - 360);
  const viewport = svg.locator('.dg-viewport');
  const before = await viewport.getAttribute('transform');
  const drawn = await svg.locator('.dg-node').count();
  const drawing = await drawingOf(page);
  await card.click();
  const drawer = detailsDrawer(page);
  await expect(drawer).toBeVisible();
  await expect
    .poll(async () => {
      const box = await card.boundingBox();
      const aside = await drawer.boundingBox();
      return box !== null && aside !== null && box.x + box.width <= aside.x;
    })
    .toBe(true);
  // A pan: the scale is the same, the drawing is the same one (no new drawing came).
  const scale = (transform: string | null): string => /scale\(([^)]+)\)/.exec(transform ?? '')?.[1] ?? '';
  expect(scale(await viewport.getAttribute('transform'))).toBe(scale(before));
  expect(await svg.locator('.dg-node').count()).toBe(drawn);
  expect(await drawingOf(page)).toBe(drawing);
});

test('a jump link selects the subnet; one into a collapsed zone flips it open', async ({ page }) => {
  const { svg, drawer } = await selectVm(page);
  await drawer
    .locator('[data-kind="attaches"]')
    .getByRole('button', { name: 'demo-vm-1-europe-west3' })
    .click();
  await expect.poll(() => hashOf(page)).toContain(`selection=${SUBNET}`);
  await expect(drawer.getByRole('heading', { level: 2 })).toHaveText('demo-vm-1-europe-west3');
  await expect(drawer).toContainText('Compute Engine subnetwork');
  // The subnet's own relations name the VM attaching to it (incoming).
  await expect(drawer.getByRole('button', { name: 'bastion' }).first()).toBeVisible();
  await expect(svg.locator(`[data-id="${SUBNET}"]`)).toBeVisible();

  // At the folder level the VM's project is a chip: the details still come, and its disk's jump link opens
  // the chips around the disk (flips in the hash) and selects it.
  await openDiagram(page, `/diagram#snapshot=demo:M&lens=compute&selection=${VM}`);
  const folded = detailsDrawer(page);
  await expect(folded.getByRole('heading', { level: 2 })).toHaveText('bastion');
  const canvas = page.locator('svg.dg-canvas');
  await expect(canvas.locator(`[data-id="${DISK}"]`)).toHaveCount(0);
  await folded.locator('[data-kind="uses"]').getByRole('button', { name: 'bastion' }).click();
  await expect.poll(() => hashOf(page)).toContain(`selection=${DISK}`);
  expect(hashOf(page)).toMatch(/flips=/);
  await expect(canvas.locator(`[data-id="${DISK}"]`)).toBeVisible({ timeout: 30_000 });
  await expect(canvas.locator(`[data-id="${DISK}"]`)).toHaveAttribute('aria-pressed', 'true');
});

test('Raw JSON shows resource.data; Escape closes the drawer and returns focus to the card', async ({
  page,
}) => {
  const { vm, drawer } = await selectVm(page);
  const toggle = drawer.getByRole('button', { name: 'Show resource.data' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(drawer.getByRole('button', { name: 'Hide resource.data' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  const json = drawer.locator('pre');
  await expect(json).toBeVisible();
  await expect(json).toContainText(
    '"machineType": "https://www.googleapis.com/compute/v1/projects/demo-vm-1/',
  );
  await expect(json).toContainText('"natIP": "203.0.113.19"');
  await expect(drawer.getByRole('button', { name: 'Copy JSON' })).toBeVisible();

  await drawer.getByRole('button', { name: 'Copy JSON' }).focus();
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(vm).toBeFocused();
  expect(hashOf(page)).not.toContain('selection=');
});

test('the handle resizes the drawer between 360 and 420 px, by keyboard and by drag, and keeps it', async ({
  page,
}) => {
  const { drawer } = await selectVm(page);
  const handle = drawer.getByRole('separator', { name: 'Resize the details drawer' });
  const width = async (): Promise<number> => (await drawer.boundingBox())?.width ?? 0;
  expect(await width()).toBeCloseTo(360, 0);
  await handle.focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(handle).toHaveAttribute('aria-valuenow', '380');
  expect(await width()).toBeCloseTo(380, 0);
  await page.keyboard.press('End');
  await expect(handle).toHaveAttribute('aria-valuenow', '420');
  // A drag to the right narrows it, never below 360.
  const box = await handle.boundingBox();
  if (box === null) throw new Error('no handle');
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 32, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect(handle).toHaveAttribute('aria-valuenow', '390');
  // Kept in the preferences (IndexedDB): the next visit opens it at that width.
  await expect.poll(() => readStoredPreference(page, 'drawerWidth')).toBe(390);
  await page.reload();
  await drawnCanvas(page);
  await page.locator(`svg.dg-canvas [data-id="${VM}"]`).click();
  await expect(detailsDrawer(page).getByRole('separator')).toHaveAttribute('aria-valuenow', '390');
  expect((await detailsDrawer(page).boundingBox())?.width).toBeCloseTo(390, 0);
});

test('the project offers "Details", which re-roots the view at it', async ({ page }) => {
  const { drawer } = await selectVm(page);
  await drawer.getByRole('button', { name: 'Retail batch VMs (prod)' }).click();
  await expect.poll(() => hashOf(page)).toContain(`selection=${PROJECT}`);
  await expect(drawer.getByRole('heading', { level: 2 })).toHaveText('Retail batch VMs (prod)');
  await expect(drawer.getByRole('link', { name: 'Open in Cloud Console (opens a new tab)' })).toHaveAttribute(
    'href',
    'https://console.cloud.google.com/home/dashboard?project=demo-vm-1',
  );
  await expect(drawer.locator('[data-kind="contains"]')).toContainText('bastion');
  await drawer.getByRole('button', { name: 'Details' }).click();
  await expect.poll(() => hashOf(page)).toContain(`root=${PROJECT}`);
  expect(hashOf(page)).not.toContain('selection=');
  await expect(drawer).toBeHidden();
  await expect(page.locator('svg.dg-canvas > title')).toContainText('Retail batch VMs (prod)', {
    timeout: 30_000,
  });
});

for (const theme of ['light', 'dark'] as const) {
  test.describe(`${theme} theme`, () => {
    test.use({ colorScheme: theme });

    test(`axe finds nothing with the drawer open, and with raw JSON shown (${theme})`, async ({ page }) => {
      const { drawer } = await selectVm(page);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expectNoAxeViolations(page);
      await scratchShot(page, '.', `drawer-M-bastion-${theme}`);
      await drawer.getByRole('button', { name: 'Show resource.data' }).click();
      await expect(drawer.locator('pre')).toBeVisible();
      await expectNoAxeViolations(page);
      await drawer.locator('pre').evaluate((element) => {
        element.scrollIntoView({ block: 'start' });
      });
      await scratchShot(drawer, '.', `drawer-M-bastion-raw-json-${theme}`);
    });
  });
}
