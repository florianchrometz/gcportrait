// SPDX-License-Identifier: MIT
import { expect, test } from '@playwright/test';

import { cameraSettled, hashOf, openDiagram, TAGLINE } from './support.js';

/** Demo organisation S, which opens fully (at most 100 rects never collapse): cards, no chips. */
const DEMO_S_DIAGRAM = '/diagram#snapshot=demo:S';

/**
 * The diagram renderer in a real browser, on demo organisation M in demo mode: the page draws it through both
 * workers, hover paints, a theme change leaves no stale highlight, the wheel zooms (and double-click does
 * not), selection opens the drawer (a click that wobbled a few pixels selects, a drag pans and selects
 * nothing), the legend and the title block are in the SVG (where the non-affiliation statement is not:
 * shell.spec.ts; the Lens picker: controls.spec.ts). Pixels are not compared here: the visual baselines are
 * SVG text (e2e/baselines/diagram/, checked by the frontend's unit tests), because screenshots differ between
 * platforms.
 */
test('draws demo M with zones, chips and edges, named for assistive technology', async ({ page }) => {
  const svg = await openDiagram(page);
  await expect(svg).toHaveAttribute('role', 'graphics-document');
  // The drawing's own title (the console action and secures overlays carry tooltips of their own).
  await expect(svg.locator(':scope > title')).toHaveText('gcportrait diagram of example.com, Overview lens');
  expect(await svg.locator('.dg-zone').count()).toBeGreaterThan(5);
  expect(await svg.locator('.dg-chip').count()).toBeGreaterThan(5);
  expect(await svg.locator('.dg-edges path').count()).toBeGreaterThan(30);
  // More than 30 edges: dim mode (style skill §5).
  await expect(svg).toHaveAttribute('data-dim', 'true');
  const named = svg.locator('.dg-node[role="button"]');
  expect(await named.count()).toBeGreaterThan(5);
  await expect(named.first()).toHaveAttribute('aria-label', /^(Project|Folder|Container|.+ \w+): .+/);
  await expect(page.getByRole('navigation', { name: 'Scope' })).toHaveText('example.com');
});

test('the title block carries the scope, the lens, the read time and the tagline', async ({ page }) => {
  const svg = await openDiagram(page);
  const title = svg.locator('.dg-title-block');
  await expect(title).toContainText('example.com');
  await expect(title).toContainText(/Overview lens · read 2026-10-0\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d/);
  await expect(title.locator('text').nth(2)).toHaveText(TAGLINE);
});

test('the legend lists what is drawn, dim mode included, and nothing else', async ({ page }) => {
  const svg = await openDiagram(page);
  const legend = svg.locator('.dg-legend');
  await expect(legend).toContainText('Folder');
  await expect(legend).toContainText('Project');
  await expect(legend).toContainText('Collapsed zone');
  await expect(legend).toContainText('shares — Shared VPC');
  await expect(legend).toContainText('dim = not focused');
  // No subnets are open at the folder level, so no subnet tint is listed.
  await expect(legend).not.toContainText('Subnetwork');
});

test('hover paints the ancestor chain and focuses the edges, without a new layout', async ({ page }) => {
  const svg = await openDiagram(page);
  // The drawing without the painter's marks (path, selection and focus rings, which it positions) and without
  // classes: what a new layout would change.
  const geometry = () =>
    svg.locator('.dg-viewport').evaluate((element) => {
      const copy = element.cloneNode(true) as Element;
      copy.querySelector('.dg-marks')?.remove();
      // The traced lines the painter puts on top while a trace is shown are its marks too.
      for (const traced of copy.querySelectorAll('.dg-edge-top')) traced.remove();
      return copy.innerHTML.replace(/ class="[^"]*"/g, '');
    });
  const before = await geometry();
  const chip = svg.locator('.dg-chip').first();
  await chip.hover();
  await expect(chip).toHaveClass(/is-path/);
  const chain = svg.locator('.dg-zone.is-path');
  await expect(chain).not.toHaveCount(0);
  // One path ring per node of the chain (the chip and every zone around it), shown on its border.
  await expect(svg.locator('.dg-path-ring:not([display])')).toHaveCount((await chain.count()) + 1);
  await expect(svg.locator('.dg-edge-top.is-focus')).not.toHaveCount(0);
  // The highlight is classes and the rings' attributes only: the drawing's geometry is unchanged.
  expect(await geometry()).toBe(before);
  await page.mouse.move(2, 2);
  await expect(svg.locator('.is-path')).toHaveCount(0);
  await expect(svg.locator('.dg-path-ring:not([display])')).toHaveCount(0);
  await expect(svg.locator('.dg-edge-top')).toHaveCount(0);
});

test('a theme change under the pointer leaves no stale highlight, and keyboard focus keeps its ring', async ({
  page,
}) => {
  const svg = await openDiagram(page);
  await svg.locator('.dg-chip').first().hover();
  await expect(svg.locator('.is-path')).not.toHaveCount(0);
  // The operating system turns dark while the pointer rests on the chip ("System" follows it).
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(svg).toHaveAttribute('data-theme', 'dark');
  await expect(svg.locator('.is-path')).toHaveCount(0);
  await expect(svg.locator('.dg-path-ring:not([display])')).toHaveCount(0);
  await page.mouse.move(2, 2);
  await expect(svg.locator('.is-path')).toHaveCount(0);

  await page.getByRole('combobox', { name: 'Search assets' }).focus();
  await page.keyboard.press('Tab');
  const stop = svg.locator('.dg-node[tabindex="0"]');
  await expect(stop).toBeFocused();
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(svg).toHaveAttribute('data-theme', 'light');
  await expect(stop).toBeFocused();
  await expect(stop).toHaveCount(1);
  await expect(svg.locator('.dg-focus-ring')).not.toHaveAttribute('display', 'none');
});

test('the wheel zooms (changing the transform and the level of detail); double-click does not', async ({
  page,
}) => {
  const svg = await openDiagram(page);
  const viewport = svg.locator('.dg-viewport');
  const fitted = await viewport.getAttribute('transform');
  const box = await svg.boundingBox();
  if (box === null) throw new Error('the canvas has no box');
  // On bare canvas: a click on a chip (also a double-click's first) expands it and frames it.
  await page.mouse.dblclick(box.x + 4, box.y + 4);
  expect(await viewport.getAttribute('transform')).toBe(fitted);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -600);
  await expect(viewport).not.toHaveAttribute('transform', fitted ?? '');
  const scale = Number(await svg.getAttribute('data-scale'));
  expect(scale).toBeGreaterThan(0.55);
  await expect(svg).not.toHaveClass(/dg-lod-nosub/);
  await page.mouse.wheel(0, 2400);
  await expect(svg).toHaveClass(/dg-lod-nolabel/);
});

test('a click selects: the ring pulses, the drawer opens with the node id, the hash keeps it', async ({
  page,
}) => {
  // A click on a chip expands it (disclosure.spec.ts): demo S, fully open, has cards to select.
  const svg = await openDiagram(page, DEMO_S_DIAGRAM);
  const card = svg.locator('.dg-card').first();
  const id = await card.getAttribute('data-id');
  await card.click();
  const drawer = page.getByRole('complementary', { name: 'Details' });
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText(id ?? '');
  await expect(card).toHaveAttribute('aria-pressed', 'true');
  await expect(svg.locator('.dg-select-ring')).not.toHaveAttribute('display', 'none');
  expect(decodeURIComponent(new URL(page.url()).hash)).toContain(`selection=${id ?? ''}`);
  await drawer.getByRole('button', { name: 'Close' }).click();
  await expect(drawer).toBeHidden();
});

test('a click that wobbled 2 px still selects; a drag of 10 px pans the drawing and selects nothing', async ({
  page,
}) => {
  const svg = await openDiagram(page, DEMO_S_DIAGRAM);
  const card = svg.locator('.dg-card').first();
  const id = await card.getAttribute('data-id');
  const start = await card.boundingBox();
  if (start === null) throw new Error('the card has no box');
  const x = start.x + start.width / 2;
  const y = start.y + start.height / 2;
  // A drag from the card: the drawing follows the mouse, and the click the browser makes of it selects nothing.
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 10, y, { steps: 5 });
  await page.mouse.up();
  await cameraSettled(svg);
  const dragged = await card.boundingBox();
  expect(dragged?.x).toBeCloseTo(start.x + 10, 0);
  expect(dragged?.y).toBeCloseTo(start.y, 0);
  await expect(card).toHaveAttribute('aria-pressed', 'false');
  expect(hashOf(page)).not.toContain('selection=');
  // A hand's wobble of 2 px between the press and the release is a click, which selects.
  await page.mouse.move(x + 10, y);
  await page.mouse.down();
  await page.mouse.move(x + 12, y + 1, { steps: 2 });
  await page.mouse.up();
  await expect(card).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('complementary', { name: 'Details' })).toContainText(id ?? '');
  expect(hashOf(page)).toContain(`selection=${id ?? ''}`);
});

test('keyboard users reach a node with Tab, see its focus ring and open it with Enter', async ({ page }) => {
  // Enter on a chip expands it: demo S's first tab stop is a card.
  const svg = await openDiagram(page, DEMO_S_DIAGRAM);
  const stop = svg.locator('.dg-node[tabindex="0"]');
  await expect(stop).toHaveCount(1);
  await page.getByRole('combobox', { name: 'Search assets' }).focus();
  await page.keyboard.press('Tab');
  await expect(stop).toBeFocused();
  await expect(svg.locator('.dg-focus-ring')).not.toHaveAttribute('display', 'none');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('complementary', { name: 'Details' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('complementary', { name: 'Details' })).toBeHidden();
});
