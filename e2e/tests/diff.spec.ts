// SPDX-License-Identifier: MIT
import { expect, test, type Locator, type Page } from '@playwright/test';

import { expectNoAxeViolations, hashOf, openDiagram, scratchShot } from './support.js';
import { expectDrawn, scrubTo, timelineBar } from './timelineSupport.js';

/**
 * The timeline's diff overlay (docs/timeline.md; skill gcp-diagram-style §6, §7) in Chromium on demo
 * organisation M, in the compute lens with every zone open, on 24 September, the day the web group scaled out,
 * reached from the 23rd (time zone UTC, so the days read the same on every machine):
 *
 * - a link opened on a day compares it with nothing: no markers;
 * - scrubbing one day on draws what changed since the day on screen: the new VM outlined, the test VM removed that
 *   day as a ghost where it was, the group manager's changed dot, the legend's three rows, the names saying so;
 * - the changed manager's drawer says what changed: both update times and the fields that differ (`targetSize`);
 * - `[` back to the 23rd compares it with the 24th ("compared with"); a lens change keeps the day's markers;
 * - axe in light and dark with the markers and the drawer.
 *
 * Screenshots go to e2e/.scratch/diff/ (git-ignored).
 */
const DAY_BEFORE = '/diagram#snapshot=demo:M&tick=2026-09-23&lens=compute&detail=all';
/** One of the two VMs the web group's scale-out added on the 24th. */
const NEW_VM = '//compute.googleapis.com/projects/demo-web-1/zones/europe-west3-a/instances/web-f9fq';
/** A transient test VM, deleted on the 24th. */
const REMOVED_VM = '//compute.googleapis.com/projects/demo-web-1/zones/europe-west3-a/instances/test-vm-29';
/** The web group's manager: its target size grew on the 24th. */
const MANAGER =
  '//compute.googleapis.com/projects/demo-web-1/zones/europe-west3-a/instanceGroupManagers/web-mig';

test.use({ timezoneId: 'UTC', locale: 'en-GB' });
test.describe.configure({ timeout: 120_000 });

/** Opens the 23rd and scrubs to the 24th, which is then drawn compared with the 23rd. */
async function scrubbedToTheScaleOut(page: Page): Promise<{ svg: Locator; bar: Locator }> {
  const svg = await openDiagram(page, DAY_BEFORE);
  const bar = await timelineBar(page);
  await expectDrawn(bar, '2026-09-23');
  // Opened from a link: compared with nothing, so no markers.
  await expect(svg.locator('.dg-diff, .dg-ghosts')).toHaveCount(0);
  await scrubTo(page, bar, '2026-09-24', 6);
  await expect.poll(() => hashOf(page)).toBe('#snapshot=demo:M&tick=2026-09-24&lens=compute&detail=all');
  await expectDrawn(bar, '2026-09-24');
  await expect(svg.locator(`.dg-ghost[data-ghost="${REMOVED_VM}"]`)).toHaveCount(1, { timeout: 60_000 });
  return { svg, bar };
}

test('scrubbing to the scale-out day draws what changed since the day before, with its legend rows', async ({
  page,
}) => {
  const { svg } = await scrubbedToTheScaleOut(page);
  // Added: the new VM outlined in accent.peer.
  await expect(svg.locator(`.dg-added-lines path[data-added="${NEW_VM}"]`)).toHaveCount(1);
  await expect(svg.locator('.dg-added-lines')).toHaveAttribute('stroke', '#188038');
  await expect(svg.locator(`[data-id="${NEW_VM}"]`)).toHaveAttribute(
    'aria-label',
    /: web-f9fq, added since 2026-09-23$/,
  );
  // Removed: the test VM as a ghost where it was, dashed accent.removed, its body at 50 %, no node.
  const ghost = svg.locator(`.dg-ghost[data-ghost="${REMOVED_VM}"]`);
  await expect(ghost).toBeVisible();
  await expect(ghost).toHaveAttribute('data-reason', 'removed');
  await expect(ghost).toHaveAttribute(
    'aria-label',
    'Removed since 2026-09-23: Compute Engine instance: test-vm-29',
  );
  await expect(ghost.locator('.dg-ghost-line')).toHaveAttribute('stroke-dasharray', '5 3');
  await expect(ghost.locator('.dg-ghost-line')).toHaveAttribute('stroke', '#D93025');
  await expect(ghost.locator('g[opacity="0.5"]')).toHaveCount(1);
  await expect(svg.locator(`[data-id="${REMOVED_VM}"]`)).toHaveCount(0);
  // Changed: the manager's dot on its top-right corner.
  await expect(svg.locator(`.dg-changed[data-changed="${MANAGER}"] circle`)).toHaveCount(2);
  await expect(svg.locator(`[data-id="${MANAGER}"]`)).toHaveAttribute(
    'aria-label',
    /, changed since 2026-09-23$/,
  );
  // The legend's rows, only while the day is compared with another.
  const legend = svg.locator('.dg-legend');
  for (const row of ['added since 2026-09-23', 'removed since 2026-09-23', 'changed since 2026-09-23'])
    await expect(legend.getByText(row, { exact: true })).toBeVisible();
  await scratchShot(page, 'diff', 'diff-M-compute-2026-09-24-light');
  await scratchShot(ghost, 'diff', 'diff-M-ghost-light');
});

test('the drawer of the changed manager says what changed: both update times and the fields', async ({
  page,
}) => {
  const { svg } = await scrubbedToTheScaleOut(page);
  await svg.locator(`[data-id="${MANAGER}"]`).click();
  const drawer = page.getByRole('complementary', { name: 'Details' });
  await expect(drawer).toBeVisible();
  const section = drawer.getByTestId('what-changed');
  await expect(section.getByRole('heading', { level: 3 })).toHaveText('What changed since 2026-09-23');
  await expect(section.locator('[data-status]')).toHaveText(
    'Changed since 2026-09-23: its update time moved.',
  );
  await expect(section.locator('[data-update-time] h4')).toHaveText('updateTime');
  await expect(section.locator('dt')).toHaveText(['2026-09-23', '2026-09-24']);
  const times = await section.locator('dd code').allTextContents();
  expect(times).toHaveLength(2);
  expect(times[0]).not.toBe(times[1]);
  // The manager's target size and its version's grew from 2 to 4.
  await expect(section.locator('[data-fields] li')).toHaveText([
    'targetSize 2 → 4',
    'versions[0].targetSize.calculated 2 → 4',
  ]);
  // Selecting asked for no new diagram: the markers are still there.
  await expect(svg.locator(`.dg-ghost[data-ghost="${REMOVED_VM}"]`)).toHaveCount(1);
  await scratchShot(drawer, 'diff', 'diff-M-drawer-light');
});

test('stepping back compares with the later day; another lens keeps the day’s markers', async ({ page }) => {
  const { svg, bar } = await scrubbedToTheScaleOut(page);
  await page.locator('main').focus();
  await page.keyboard.press('[');
  await expect.poll(() => hashOf(page)).toBe('#snapshot=demo:M&tick=2026-09-23&lens=compute&detail=all');
  await expectDrawn(bar, '2026-09-23');
  // The 23rd compared with the 24th: the scale-out's VMs are the ghosts now, the test VM is "added".
  await expect(svg.locator(`.dg-ghost[data-ghost="${NEW_VM}"]`)).toHaveCount(1, { timeout: 60_000 });
  await expect(svg.locator(`.dg-added-lines path[data-added="${REMOVED_VM}"]`)).toHaveCount(1);
  await expect(
    svg.locator('.dg-legend').getByText('removed compared with 2026-09-24', { exact: true }),
  ).toBeVisible();
  // Another lens on the same day: still compared with the 24th.
  await page.evaluate(() => {
    window.location.hash = '#snapshot=demo:M&tick=2026-09-23&lens=overview&detail=all';
  });
  await expect(svg.locator('.dg-title-block')).toContainText('Overview lens', { timeout: 60_000 });
  await expect(svg.locator('.dg-legend')).toContainText('compared with 2026-09-24', { timeout: 60_000 });
  await expect(svg.locator(`.dg-ghost[data-ghost="${NEW_VM}"]`)).toHaveCount(1);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`the diff day with the drawer open passes axe in ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    const { svg } = await scrubbedToTheScaleOut(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
    await svg.locator(`[data-id="${MANAGER}"]`).click();
    await expect(
      page.getByRole('complementary', { name: 'Details' }).getByTestId('what-changed'),
    ).toContainText('targetSize');
    await expectNoAxeViolations(page);
    await scratchShot(page, 'diff', `diff-M-compute-2026-09-24-drawer-${scheme}`);
  });
}
