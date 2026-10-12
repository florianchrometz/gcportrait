// SPDX-License-Identifier: MIT
import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  boxOf,
  cameraSettled,
  drawnCanvas,
  expectNoAxeViolations,
  inside,
  openDiagram,
  scratchShot,
} from './support.js';

/**
 * Progressive disclosure (gcp-diagram-layout skill §6) in Chromium, on demo organisation L, which opens collapsed:
 * its projects are chips at the folder level. A click on a project chip expands it in place (a flip in the hash; the
 * camera keeps its place and glides to the zone), its networks show as chips, a network opens too, "Expand all"
 * opens the projects level and keeps the network open, "N of M shown" follows, and a reload keeps the flips. Also:
 * the keyboard (Enter on a chip, then on the collapse button it moves to), the pointer's collapse button on an open
 * zone's header, "Collapse all", the notices (the 48-flip cap; Auto changing level when the window grows), and axe
 * in both themes. The counts are read from the page and compared, never pinned: they follow the demo generator and
 * the catalog. Screenshots go to e2e/.scratch/ (git-ignored).
 */
const DEMO_L = '/diagram#snapshot=demo:L';

function bar(page: Page): Locator {
  return page.getByRole('group', { name: 'Expand and collapse' });
}

function shownCount(page: Page): Locator {
  return bar(page).getByRole('status');
}

/** "164 of 2,497 shown": what is shown and the whole. */
interface Shown {
  readonly shown: number;
  readonly total: number;
}

/** The "N of M shown" status as numbers, once it reads so. */
async function shownOf(page: Page): Promise<Shown> {
  await expect(shownCount(page)).toHaveText(/^[\d,]+ of [\d,]+ shown$/);
  const [, shown = 'NaN', total = 'NaN'] =
    /^([\d,]+) of ([\d,]+) shown$/.exec((await shownCount(page).textContent()) ?? '') ?? [];
  return { shown: Number(shown.replaceAll(',', '')), total: Number(total.replaceAll(',', '')) };
}

/** The status's text for these counts, as the page writes it. */
function shownText({ shown, total }: Shown): string {
  return `${shown.toLocaleString('en')} of ${total.toLocaleString('en')} shown`;
}

function flipsOf(page: Page): string[] {
  const hash = new URL(page.url()).hash.slice(1);
  const value = new URLSearchParams(hash).get('flips');
  return value === null || value === '' ? [] : value.split(',');
}

/** Waits until the drawing on screen shows `id` as an open zone (the new layout has arrived). */
async function zoneOpen(svg: Locator, id: string): Promise<Locator> {
  const zone = svg.locator(`.dg-zone[data-id="${id}"]`);
  await expect(zone).toHaveCount(1, { timeout: 30_000 });
  await expect(svg.locator(`.dg-chip[data-id="${id}"]`)).toHaveCount(0);
  return zone;
}

test('demo L: expand a project chip, see its networks as chips, expand all, and a reload keeps the flips', async ({
  page,
}) => {
  const svg = await openDiagram(page, DEMO_L);
  // Collapsed at the folder level: every project a chip, none an open zone.
  const atFolders = await shownOf(page);
  expect(atFolders.shown).toBeLessThan(atFolders.total);
  await expect(svg.locator('.dg-chip[aria-label^="Project: "]')).not.toHaveCount(0);
  await expect(svg.locator('.dg-zone[aria-label^="Project: "]')).toHaveCount(0);
  await expect(bar(page).getByRole('button', { name: 'Collapse all' })).toHaveAttribute(
    'aria-disabled',
    'true',
  );

  // A project chip that holds networks ("… networks · …" in its name).
  const chip = svg.locator('.dg-chip[aria-label^="Project: "][aria-label*=" network"]').first();
  const project = (await chip.getAttribute('data-id')) ?? '';
  expect(project).toMatch(/^\/\/cloudresourcemanager\.googleapis\.com\/projects\/\d+$/);
  const viewport = svg.locator('.dg-viewport');
  const before = await viewport.getAttribute('transform');
  await chip.click();
  await expect.poll(() => flipsOf(page)).toHaveLength(1);
  const zone = await zoneOpen(svg, project);
  // The camera glided (200 ms) from where it was to frame the zone, which is now in view.
  await expect(viewport).not.toHaveAttribute('transform', before ?? '');
  await cameraSettled(svg);
  expect(inside(await boxOf(zone.locator('.dg-body')), await boxOf(svg), 1)).toBe(true);
  await expect.poll(async () => (await shownOf(page)).shown).toBeGreaterThan(atFolders.shown);
  const expanded = await shownOf(page);
  expect(expanded.total).toBe(atFolders.total);

  // Its networks are chips inside it.
  const zoneBox = await boxOf(zone.locator('.dg-body'));
  const networks = svg.locator('.dg-chip[data-id*="/global/networks/"]');
  const inZone: string[] = [];
  for (const network of await networks.all())
    if (inside(await boxOf(network.locator('.dg-body')), zoneBox, 1))
      inZone.push((await network.getAttribute('data-id')) ?? '');
  expect(inZone.length).toBeGreaterThan(0);
  await scratchShot(page, '.', 'disclosure-L-project-expanded-light');

  // Open one of its networks as well: a flip the projects level still needs.
  const network = inZone[0] ?? '';
  await svg.locator(`.dg-chip[data-id="${network}"]`).click();
  await expect.poll(() => flipsOf(page)).toHaveLength(2);
  await zoneOpen(svg, network);
  await expect.poll(async () => (await shownOf(page)).shown).toBeGreaterThan(expanded.shown);
  const withNetwork = await shownOf(page);

  // Expand all: the projects level; the project's flip is redundant there, the network's stays.
  await bar(page).getByRole('button', { name: 'Expand all' }).click();
  await expect(page).toHaveURL(/detail=projects/);
  await expect.poll(() => flipsOf(page)).toHaveLength(1);
  await zoneOpen(svg, project);
  await zoneOpen(svg, network);
  await expect
    .poll(async () => (await shownOf(page)).shown, { timeout: 30_000 })
    .toBeGreaterThan(withNetwork.shown);
  const all = await shownOf(page);
  expect(all.total).toBe(atFolders.total);
  // Every project is open at the projects level: none is left a chip.
  await expect(svg.locator('.dg-chip[aria-label^="Project: "]')).toHaveCount(0);
  await expect(bar(page).getByRole('button', { name: 'Collapse all' })).not.toHaveAttribute('aria-disabled');
  await scratchShot(page, '.', 'disclosure-L-expand-all-light');

  // A reload keeps the view, flips included.
  const hash = new URL(page.url()).hash;
  await page.reload();
  const again = await drawnCanvas(page);
  expect(new URL(page.url()).hash).toBe(hash);
  await zoneOpen(again, network);
  await expect(shownCount(page)).toHaveText(shownText(all));

  // Collapse all: back to Auto (folders) with no flips.
  await bar(page).getByRole('button', { name: 'Collapse all' }).click();
  await expect(page).toHaveURL(/#snapshot=demo:L$/);
  await expect(shownCount(page)).toHaveText(shownText(atFolders), { timeout: 30_000 });
});

test('keyboard: Enter on a chip expands it and focus moves to its collapse button; Enter there collapses it', async ({
  page,
}) => {
  const svg = await openDiagram(page, DEMO_L);
  const stop = svg.locator('.dg-chip[tabindex="0"]');
  await expect(stop).toHaveCount(1);
  const id = (await stop.getAttribute('data-id')) ?? '';
  await stop.focus();
  await page.keyboard.press('Enter');
  await zoneOpen(svg, id);
  const button = svg.locator(`.dg-collapse[data-collapse="${id}"]`);
  await expect(button).toBeFocused();
  await expect(button).toHaveAttribute('tabindex', '0');
  await expect(button).toHaveAttribute('aria-label', /^Collapse Project: /);
  // Its face shows on keyboard focus.
  await expect(button.locator('.dg-collapse-face')).toHaveCSS('opacity', '1');
  await page.keyboard.press('Enter');
  await expect(svg.locator(`.dg-chip[data-id="${id}"]`)).toBeFocused({ timeout: 30_000 });
  await expect.poll(() => flipsOf(page)).toEqual([]);
  // Space works as well.
  await page.keyboard.press(' ');
  await zoneOpen(svg, id);
});

test('the collapse button on an open zone’s header collapses it (the inverse flip); the chip expands it back', async ({
  page,
}) => {
  const svg = await openDiagram(page, DEMO_L);
  const atFolders = await shownOf(page);
  const folder = svg.locator('.dg-zone').first();
  const id = (await folder.getAttribute('data-id')) ?? '';
  const button = svg.locator(`.dg-collapse[data-collapse="${id}"]`);
  const face = button.locator('.dg-collapse-face');
  await expect(face).toHaveCSS('opacity', '0');
  await button.hover();
  await expect(face).toHaveCSS('opacity', '1');
  await button.click();
  await expect.poll(() => flipsOf(page)).toHaveLength(1);
  await expect(svg.locator(`.dg-chip[data-id="${id}"]`)).toHaveCount(1, { timeout: 30_000 });
  await expect.poll(async () => (await shownOf(page)).shown).toBeLessThan(atFolders.shown);
  await svg.locator(`.dg-chip[data-id="${id}"]`).click();
  await zoneOpen(svg, id);
  await expect.poll(() => flipsOf(page)).toEqual([]);
  await expect(shownCount(page)).toHaveText(shownText(atFolders));
});

test('a 49th flip drops the oldest, and the page says so until dismissed', async ({ page }) => {
  const flips = Array.from({ length: 48 }, (_, index) => `t${String(index)}`).join(',');
  const svg = await openDiagram(page, `${DEMO_L}&flips=${flips}`);
  await svg.locator('.dg-chip').first().click();
  const notice = page.getByText(/^At most 48 zones keep an expand or collapse made by hand/);
  await expect(notice).toBeVisible();
  await expect.poll(() => flipsOf(page)).toHaveLength(48);
  expect(flipsOf(page)).not.toContain('t0');
  await page.getByRole('button', { name: 'Dismiss' }).click();
  await expect(notice).toBeHidden();
});

test('when the window grows, Auto may open a deeper level, and the page says why', async ({ page }) => {
  // Demo M's networking lens: the folder level at 1440 × 900, the projects level at 1920 × 1080.
  await openDiagram(page, '/diagram#snapshot=demo:M&lens=networking');
  const atFolders = await shownOf(page);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await expect(page.getByText(/^The diagram area got larger, so Auto detail now shows Projects/)).toBeVisible(
    {
      timeout: 30_000,
    },
  );
  await expect.poll(async () => (await shownOf(page)).shown).toBeGreaterThan(atFolders.shown);
  expect((await shownOf(page)).total).toBe(atFolders.total);
  // The view itself did not change: the hash still says auto.
  expect(new URL(page.url()).hash).toBe('#snapshot=demo:M&lens=networking');
});

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    test(`axe finds nothing with a zone expanded, its collapse button focused and a notice shown (${scheme})`, async ({
      page,
    }) => {
      const flips = Array.from({ length: 48 }, (_, index) => `t${String(index)}`).join(',');
      const svg = await openDiagram(page, `${DEMO_L}&flips=${flips}`);
      await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
      const stop = svg.locator('.dg-chip[tabindex="0"]');
      const id = (await stop.getAttribute('data-id')) ?? '';
      await stop.focus();
      await page.keyboard.press('Enter');
      await zoneOpen(svg, id);
      await expect(svg.locator(`.dg-collapse[data-collapse="${id}"]`)).toBeFocused();
      await expect(page.getByText(/^At most 48 zones/)).toBeVisible();
      await expectNoAxeViolations(page);
      await scratchShot(page, '.', `disclosure-L-keyboard-${scheme}`);
    });
  });
}
