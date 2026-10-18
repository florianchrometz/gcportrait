// SPDX-License-Identifier: Apache-2.0
import { expect, test, type Locator, type Page } from '@playwright/test';

import { COMPUTE_ALL, selectVm, stubConsole, VM, VM_PAGE } from './consoleSupport.js';
import { boxOf, inside, openDiagram, scratchShot, type Box } from './support.js';

/**
 * The console affordance (the gcp-diagram-style skill §6) in a real browser, on demo organisation M: the selected
 * card offers "Open in Cloud Console ↗" and so does its context menu, both with the page the catalog's console
 * template gives (`consoleUrlFor` in the catalog engine); nothing ever opens by itself, and activating the action
 * opens a new tab and leaves the app where it was. A type without a console template (the VM's, stripped from the
 * catalog this test serves) offers its project's console home and the resource name instead. The action sits inside
 * the selected card, in its top-right corner, so it never covers the card below; it is a tab stop after the card.
 *
 * No request reaches Google: the Cloud Console is answered by a stub page.
 */

const PROJECT_HOME = 'https://console.cloud.google.com/home/dashboard?project=demo-vm-1';
/**
 * The compiled asset catalog as the data worker fetches it: the module under the dev server, the JSON table
 * `assets/catalog-data-<hash>.json` in a build.
 */
const CATALOG_TABLE = /\/(?:compiled-catalog\.ts|assets\/catalog-data-[^/?]*\.json)(?:\?|$)/;

/** Whether two boxes share area (touching does not count). */
function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** Zooms with the wheel, centred on a node, until it is at least `width` px wide on screen. */
async function zoomOnto(page: Page, target: Locator, width: number): Promise<void> {
  for (let step = 0; step < 12; step += 1) {
    const box = await boxOf(target);
    if (box.width >= width) break;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -300);
    await expect.poll(async () => (await boxOf(target)).width).toBeGreaterThan(box.width);
  }
  // Off the canvas, so that no hover preview mixes in.
  await page.mouse.move(2, 2);
}

test('the selected card offers "Open in Cloud Console ↗" with the VM’s page, and opens nothing by itself', async ({
  page,
  context,
}) => {
  const pages = await stubConsole(context);
  const { svg, vm } = await selectVm(page);
  const action = svg.locator('.dg-console-action');
  await expect(svg.locator('.dg-actions')).not.toHaveAttribute('display', 'none');
  await expect(action).toHaveAttribute('href', VM_PAGE);
  await expect(action).toHaveAttribute('target', '_blank');
  await expect(action).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(action).toHaveAttribute('aria-label', 'Open bastion in Cloud Console (opens a new tab)');
  await expect(action.locator('.dg-console-resource > title')).toHaveText(
    'Open in Cloud Console ↗ (opens a new tab)',
  );
  // Inside the card, in its top-right corner.
  await zoomOnto(page, vm, 200);
  const card = await boxOf(vm.locator('.dg-body'));
  const pill = await boxOf(action);
  expect(inside(pill, card), JSON.stringify({ pill, card })).toBe(true);
  expect(pill.x + pill.width).toBeCloseTo(card.x + card.width, 0);
  expect(pill.y).toBeCloseTo(card.y, 0);
  // Hovering it shows its label where the labelled pill fits inside the card; still inside the card.
  await expect(action).toHaveAttribute('data-expand', 'true');
  await action.hover();
  await expect(action.locator('.dg-console-resource .dg-console-full')).toBeVisible();
  await expect(action.locator('.dg-console-resource .dg-console-text')).toHaveText('Open in Cloud Console');
  expect(
    inside(await boxOf(action.locator('.dg-console-resource .dg-console-full .dg-console-pill')), card),
  ).toBe(true);
  // Selecting, hovering and waiting open nothing.
  await vm.hover();
  await page.waitForTimeout(500);
  expect(pages.opened()).toBe(0);
  expect(context.pages()).toHaveLength(1);

  // Activating it opens the page in a new tab; the app stays where it was, the selection too.
  const before = page.url();
  const popup = page.waitForEvent('popup');
  await action.click();
  const tab = await popup;
  await tab.waitForLoadState();
  expect(tab.url()).toBe(VM_PAGE);
  expect(page.url()).toBe(before);
  await expect(svg.locator(`[data-id="${VM}"]`)).toHaveAttribute('aria-pressed', 'true');
});

test('the console action is the tab stop after the selected card; Escape there goes back to the card', async ({
  page,
  context,
}) => {
  const pages = await stubConsole(context);
  const { svg, vm } = await selectVm(page);
  const action = svg.locator('.dg-console-action');
  await vm.focus();
  await page.keyboard.press('Tab');
  await expect(action).toBeFocused();
  // Keyboard focus shows the label too (where it fits) and fills the pill in the focus colour.
  await expect(action.locator('.dg-console-resource .dg-console-full')).toBeVisible();
  await page.keyboard.press('Shift+Tab');
  await expect(vm).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(action).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(vm).toBeFocused();
  await expect(vm).toHaveAttribute('aria-pressed', 'false');
  await expect(svg.locator('.dg-actions')).toHaveAttribute('display', 'none');
  expect(pages.opened()).toBe(0);
});

for (const theme of ['light', 'dark'] as const) {
  test.describe(`${theme} theme`, () => {
    test.use({ colorScheme: theme });

    test(`partner-gw-1’s console action stays inside it, clear of partner-gw-2 (${theme})`, async ({
      page,
      context,
    }) => {
      await stubConsole(context);
      const svg = await openDiagram(page, COMPUTE_ALL);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const gw1 = svg.locator('.dg-card[data-id$="/instances/partner-gw-1"]');
      const gw2 = svg.locator('.dg-card[data-id$="/instances/partner-gw-2"]');
      await gw1.click();
      await expect(gw1).toHaveAttribute('aria-pressed', 'true');
      await zoomOnto(page, gw1, 260);
      const action = svg.locator('.dg-console-action');
      await expect(svg.locator('.dg-actions')).not.toHaveAttribute('display', 'none');
      const card = await boxOf(gw1.locator('.dg-body'));
      const below = await boxOf(gw2.locator('.dg-body'));
      const pill = await boxOf(action.locator('.dg-console-resource .dg-console-compact .dg-console-pill'));
      // A pill hung under the card would lie on partner-gw-2's top border; it is inside the card.
      expect(inside(pill, card), JSON.stringify({ pill, card })).toBe(true);
      expect(overlaps(pill, below), JSON.stringify({ pill, below })).toBe(false);
      // Every other card stays clear of it too.
      const others = await svg.locator('.dg-card, .dg-chip, .dg-empty').evaluateAll(
        (elements, selected) =>
          elements
            .filter((element) => element.getAttribute('data-id') !== selected)
            .map((element) => {
              const box = element.querySelector('.dg-body')?.getBoundingClientRect();
              return box === undefined ? null : { x: box.x, y: box.y, width: box.width, height: box.height };
            }),
        await gw1.getAttribute('data-id'),
      );
      for (const other of others) if (other !== null) expect(overlaps(pill, other)).toBe(false);
      // A picture of both cards for a person to look at (scratchShot: only with E2E_SHOTS=1).
      const top = Math.min(card.y, below.y) - 60;
      const left = Math.min(card.x, below.x) - 80;
      const clip = {
        x: Math.max(0, left),
        y: Math.max(0, top),
        width: Math.max(card.x + card.width, below.x + below.width) + 80 - Math.max(0, left),
        height: Math.max(card.y + card.height, below.y + below.height) + 60 - Math.max(0, top),
      };
      await scratchShot(page, 'console-pill', `pill-partner-gw-1-M-compute-all-${theme}`, { clip });
      // Hovered, it shows its label, still inside the card and clear of the card below.
      await expect(action).toHaveAttribute('data-expand', 'true');
      await action.hover();
      await expect(action.locator('.dg-console-resource .dg-console-full')).toBeVisible();
      const labelled = await boxOf(action.locator('.dg-console-resource .dg-console-full .dg-console-pill'));
      expect(inside(labelled, card), JSON.stringify({ labelled, card })).toBe(true);
      expect(overlaps(labelled, below)).toBe(false);
      await scratchShot(page, 'console-pill', `pill-partner-gw-1-M-compute-all-${theme}-hover`, { clip });
    });
  });
}

test('the context menu offers the console link, the resource name and, on containers, drill-in', async ({
  page,
  context,
}) => {
  const pages = await stubConsole(context);
  const { svg, vm } = await selectVm(page);
  await vm.click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Actions for bastion' });
  await expect(menu).toBeVisible();
  const items = menu.getByRole('menuitem');
  await expect(items).toHaveText(['Open in Cloud Console', 'Copy resource name']);
  await expect(menu.getByRole('menuitem', { name: 'Open in Cloud Console' })).toHaveAttribute(
    'href',
    VM_PAGE,
  );
  await expect(items.first()).toBeFocused();
  expect(pages.opened()).toBe(0);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(vm).toBeFocused();

  // The keyboard: Enter on the selected card, Shift+F10 on any focused card.
  await page.keyboard.press('Enter');
  await expect(menu).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(items.nth(1)).toBeFocused();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Shift+F10');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');

  // A project offers drill-in, which re-roots the view at it (a right-click on its header: lines never cross
  // a header, so the point is the project's own).
  const project = svg.locator('.dg-zone[aria-label^="Project: "]').first();
  const projectId = await project.getAttribute('data-id');
  await project.locator('.dg-body').click({ button: 'right', position: { x: 3, y: 3 } });
  const projectMenu = page.getByRole('menu');
  await expect(projectMenu.getByRole('menuitem', { name: 'Details' })).toBeVisible();
  await projectMenu.getByRole('menuitem', { name: 'Details' }).click();
  await expect.poll(() => decodeURIComponent(new URL(page.url()).hash)).toContain(`root=${projectId ?? ''}`);
  expect(pages.opened()).toBe(0);
});

test('a type without a console template offers its project’s console home and the resource name', async ({
  page,
  context,
}) => {
  await stubConsole(context);
  // Serve a catalog whose VM type has no console template. The demo's data worker reads the compiled catalog: the
  // module itself from the dev server, the build's JSON table of it from a build (frontend/vite.config.ts,
  // `dataTablesAsJson`), both quoting the key as JSON writes it (packages/catalog/tooling/generate.ts).
  let stripped = false;
  await context.route(CATALOG_TABLE, async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace(
      /["']?console["']?:\s*["']https:\/\/console\.cloud\.google\.com\/compute\/instancesDetail\/[^"']*["'],?/,
      () => {
        stripped = true;
        return '';
      },
    );
    await route.fulfill({ response, body });
  });
  const { svg, vm } = await selectVm(page);
  expect(stripped).toBe(true);
  const action = svg.locator('.dg-console-action');
  await expect(action).toHaveAttribute('href', PROJECT_HOME);
  await expect(action).toHaveAttribute(
    'aria-label',
    'Open project demo-vm-1 in Cloud Console (opens a new tab)',
  );
  await expect(action.locator('.dg-console-project')).not.toHaveAttribute('display', 'none');
  await expect(action.locator('.dg-console-project > title')).toHaveText(
    'Open project in Cloud Console ↗ (opens a new tab)',
  );
  await vm.click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Actions for bastion' });
  await expect(menu.getByRole('menuitem')).toHaveText([
    'Open project in Cloud Console',
    'Copy resource name',
  ]);
  await expect(menu.getByRole('menuitem', { name: 'Open project in Cloud Console' })).toHaveAttribute(
    'href',
    PROJECT_HOME,
  );
});
