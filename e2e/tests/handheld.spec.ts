// SPDX-License-Identifier: MIT
import { readFileSync } from 'node:fs';

import { expect, test, type Locator, type Page } from '@playwright/test';

import { fold, openSheet, TABLET_FROM, TARGET } from './handheldSupport.js';
import {
  boxOf,
  cameraSettled,
  DEMO_M_DIAGRAM,
  drawingOf,
  drawnCanvas,
  expectNoAxeViolations,
  hashOf,
  openDiagram,
  redrawnCanvas,
  viewParam,
  type Box,
} from './support.js';
import {
  expectDrawn,
  playbackStopped,
  playUntil,
  recordHashes,
  stoppedPlayButton,
  timelineBar,
} from './timelineSupport.js';

/**
 * The app's flows by finger on a phone and on a tablet (AGENTS.md, Product rules: every control at every width, and
 * the touch model). The `chromium-phone` and `chromium-tablet` projects of playwright.config.ts run every test here,
 * each tagged `@phone` and `@tablet`, in Chromium emulating a touch device at 390 × 844 (the phone's layout) and
 * 820 × 1180 (the tablet's), against demo mode; the desktop's `chromium` project leaves them out. Every step is a tap
 * (Playwright's touchscreen) on the app's own controls, under the accessible names the desktop's specs use, with View
 * or More opened first where the desktop shows the control in its rows:
 *
 * - the top bar: View and More hold the controls of the desktop's two rows, each a target of 44 × 44 CSS pixels; a
 *   lens picked from the Lens list, the Filters panel opened and closed inside View, a theme picked in More's Theme
 *   menu (which closes More), the Saved views dialog opened and closed;
 * - the Connect and Snapshots pages through More: a demo opened on Connect, loaded again from Snapshots (a card per
 *   snapshot on a phone, a table row on a tablet);
 * - the details: a tap on a folder opens them over the canvas (a sheet over its lower half on a phone, a panel over at
 *   most half its width at its right on a tablet) with the folder's name and resource name, and their Details button
 *   drills in, as a double-click does with a mouse;
 * - search from the View sheet: a result tapped is selected, View closes onto its button, and the node is in the
 *   details and in the part of the canvas they leave in view;
 * - the disclosure bar's Expand all and Collapse all;
 * - the timeline: Previous day and Next day, and playback to the last day (on Playwright's clock);
 * - Export through More: the Export menu and an SVG download;
 * - axe in both themes, on the diagram at rest, with View open and with the details open, and on the Connect and
 *   Snapshots pages.
 *
 * The canvas's own gestures (one finger's pan, a pinch, taps, double taps, a long press) are touch.spec.ts's, and the
 * layouts' measures (overflow, targets, focus in sight, the canvas's room) mobile.spec.ts's, both in the `mobile`
 * project. Nothing here saves or compares a screenshot.
 */

/** Demo M's Retail web (prod) project, as search.spec.ts finds it by its id `demo-web-1`. */
const WEB_PROJECT = '//cloudresourcemanager.googleapis.com/projects/10000000009';

/** Fails unless `control` is at least 44 × 44 CSS pixels; `what` names it in the failure. */
async function expectTarget(control: Locator, what: string): Promise<void> {
  const box = await boxOf(control);
  expect(box.width, `${what}: width`).toBeGreaterThanOrEqual(TARGET);
  expect(box.height, `${what}: height`).toBeGreaterThanOrEqual(TARGET);
}

/** Whether the page has the phone's layout. */
function onPhone(page: Page): boolean {
  return (page.viewportSize()?.width ?? 0) < TABLET_FROM;
}

/** The details drawer. */
function details(page: Page): Locator {
  return page.getByRole('complementary', { name: 'Details' });
}

/** A point a finger can land on, and the node it lands on. */
interface Spot {
  readonly x: number;
  readonly y: number;
  readonly id: string;
  readonly name: string;
}

/**
 * A point in the upper half of the canvas (clear of a phone's details sheet) where a finger lands on a folder: within
 * `reach` pixels of it every point hits the same folder's zone, as the browser hit-tests it, and none hits its collapse
 * button. Fails when no folder has such a point.
 */
async function folderSpot(svg: Locator, reach = 10): Promise<Spot> {
  const spot = await svg.evaluate((element, around) => {
    const canvas = element.getBoundingClientRect();
    const lands = (x: number, y: number, node: Element): boolean => {
      const hit = element.ownerDocument.elementFromPoint(x, y);
      return (
        hit !== null &&
        element.contains(hit) &&
        hit.closest('.dg-collapse, .dg-console-action') === null &&
        hit.closest('[data-id]') === node
      );
    };
    for (const node of element.querySelectorAll('.dg-zone[data-id*="/folders/"]')) {
      const box = node.getBoundingClientRect();
      const top = Math.max(box.top, canvas.top);
      const bottom = Math.min(box.bottom, canvas.top + canvas.height / 2);
      const left = Math.max(box.left, canvas.left);
      const right = Math.min(box.right, canvas.right);
      for (let y = top + around + 2; y < bottom - around - 2; y += 4) {
        for (let x = left + around + 2; x < right - around - 2; x += 4) {
          let all = true;
          for (const dx of [-around, 0, around])
            for (const dy of [-around, 0, around]) if (all && !lands(x + dx, y + dy, node)) all = false;
          if (all)
            return {
              x,
              y,
              id: node.getAttribute('data-id') ?? '',
              name: node.getAttribute('aria-label') ?? '',
            };
        }
      }
    }
    return null;
  }, reach);
  if (spot === null) throw new Error('no folder to tap in the upper half of the canvas');
  return spot;
}

/** The part of the canvas the details leave in view: above a phone's sheet, left of a tablet's panel. */
async function uncovered(page: Page): Promise<Box> {
  const canvas = await boxOf(page.locator('#diagram-canvas'));
  const drawer = await boxOf(details(page));
  return onPhone(page)
    ? { x: canvas.x, y: canvas.y, width: canvas.width, height: drawer.y - canvas.y }
    : { x: canvas.x, y: canvas.y, width: drawer.x - canvas.x, height: canvas.height };
}

/**
 * Taps a folder of the drawing and waits for its details. Answers the folder. The camera stands still first: a sheet
 * closed just before fits the drawing to the canvas again in a short glide.
 */
async function tapAFolder(page: Page, svg: Locator): Promise<Spot> {
  await cameraSettled(svg);
  const folder = await folderSpot(svg);
  await page.touchscreen.tap(folder.x, folder.y);
  await expect.poll(() => viewParam(page, 'selection')).toBe(folder.id);
  await expect(details(page)).toBeVisible();
  return folder;
}

test.describe('by finger', { tag: ['@phone', '@tablet'] }, () => {
  // Demo M is generated and laid out in the browser; a cold dev server compiles the workers first.
  test.describe.configure({ timeout: 120_000 });

  test('View and More hold the desktop rows’ controls, 44-pixel targets a tap opens, picks from and closes', async ({
    page,
  }) => {
    await openDiagram(page, DEMO_M_DIAGRAM);
    for (const name of ['View', 'More'] as const) await expectTarget(fold(page, name).button, name);

    const view = await openSheet(page, 'View');
    const lens = view.getByRole('combobox', { name: 'Lens' });
    const filters = view.getByRole('button', { name: /^Filters/ });
    const controls: ReadonlyArray<readonly [string, Locator]> = [
      ['Lens', lens],
      ['Focus', view.getByRole('button', { name: /^Focus/ })],
      ['Filters', filters],
      ['Search assets', view.getByRole('combobox', { name: 'Search assets' })],
      ...(await view.getByRole('radiogroup', { name: 'Detail' }).getByRole('radio').all()).map(
        (radio, index) => [`Detail ${String(index + 1)}`, radio] as const,
      ),
    ];
    for (const [name, control] of controls) {
      await expect(control, name).toBeVisible();
      await expectTarget(control, name);
    }
    // A lens picked from the Lens list.
    await lens.tap();
    const lenses = page.getByRole('listbox', { name: 'Lens' });
    await expect(lenses).toBeVisible();
    const networking = lenses.getByRole('option', { name: 'Networking', exact: true });
    await expectTarget(networking, 'the Networking option');
    const overview = await drawingOf(page);
    await networking.tap();
    await expect.poll(() => viewParam(page, 'lens')).toBe('networking');
    await expect(lens).toContainText('Networking');
    await redrawnCanvas(page, overview);
    // The Filters panel opens inside the sheet; Escape closes it onto its button, then the sheet onto View.
    await filters.tap();
    await expect(view.getByRole('dialog', { name: 'Filters' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(view.getByRole('dialog', { name: 'Filters' })).toBeHidden();
    await expect(filters).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(view).toBeHidden();
    await expect(fold(page, 'View').button).toBeFocused();

    const more = await openSheet(page, 'More');
    for (const name of ['Connect', 'Diagram', 'Snapshots', 'Permissions', 'Settings']) {
      const link = more.getByRole('link', { name, exact: true });
      await expect(link, name).toBeVisible();
      await expectTarget(link, name);
    }
    for (const name of ['Snapshot', 'Saved views', 'Copy link', 'Theme', 'Export']) {
      const button = more.getByRole('button', { name, exact: true });
      await expect(button, name).toBeVisible();
      await expectTarget(button, name);
    }
    // A theme picked in the Theme menu, which opens in the sheet: the theme changes and More closes onto its button.
    await more.getByRole('button', { name: 'Theme', exact: true }).tap();
    const dark = page
      .getByRole('menu', { name: 'Theme' })
      .getByRole('menuitemradio', { name: 'Dark', exact: true });
    await expectTarget(dark, 'Dark');
    await dark.tap();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(more).toBeHidden();
    await expect(fold(page, 'More').button).toBeFocused();
    // The Saved views dialog, opened from More and closed again onto its button.
    await (await openSheet(page, 'More')).getByRole('button', { name: 'Saved views', exact: true }).tap();
    const saved = page.getByRole('dialog', { name: 'Saved views' });
    await expect(saved).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(saved).toBeHidden();
    await expect(more.getByRole('button', { name: 'Saved views', exact: true })).toBeFocused();
  });

  test('the Connect and Snapshots pages through More: a demo opened on Connect, loaded again from Snapshots', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Connect' })).toBeVisible();
    const card = page
      .getByRole('region', { name: 'Demo mode' })
      .getByRole('listitem')
      .filter({ has: page.getByRole('heading', { name: 'Demo organisations' }) });
    const small = card.getByRole('radio', { name: 'S', exact: true });
    await expectTarget(small, 'S');
    await small.tap();
    await expect(small).toHaveAttribute('aria-checked', 'true');
    const start = card.getByRole('button', { name: 'Try the demo' });
    await expectTarget(start, 'Try the demo');
    await start.tap();
    await expect(page).toHaveURL(/\/diagram#snapshot=demo:S$/, { timeout: 60_000 });
    await drawnCanvas(page);

    await (await openSheet(page, 'More')).getByRole('link', { name: 'Snapshots', exact: true }).tap();
    await expect(page.getByRole('heading', { level: 1, name: 'Snapshots' })).toBeVisible();
    await expect(fold(page, 'More').sheet).toBeHidden();
    // The stored demo: a card of the list on a phone, a row of the table on a tablet.
    const stored = page.getByRole(onPhone(page) ? 'list' : 'table', {
      name: 'Snapshots stored in this browser',
    });
    const load = stored.getByRole('button', { name: /^Load example\.com, read .*, demo:S$/ });
    await expectTarget(load, 'Load');
    await load.tap();
    await expect(page).toHaveURL(/\/diagram#snapshot=demo:S$/);
    await drawnCanvas(page);

    await (await openSheet(page, 'More')).getByRole('link', { name: 'Connect', exact: true }).tap();
    await expect(page.getByRole('heading', { level: 1, name: 'Connect' })).toBeVisible();
    await expect(fold(page, 'More').sheet).toBeHidden();
  });

  test('a tap on a folder opens its details over the canvas, with its names, and their Details button drills in', async ({
    page,
  }) => {
    const svg = await openDiagram(page, DEMO_M_DIAGRAM);
    const folder = await tapAFolder(page, svg);
    await expect(svg.locator(`.dg-zone[data-id="${folder.id}"]`)).toHaveClass(/\bis-selected\b/);
    // Over the canvas, never all of it: a sheet over its lower half on a phone, a panel over at most half its width
    // at its right on a tablet.
    const canvas = await boxOf(page.locator('#diagram-canvas'));
    const drawer = await boxOf(details(page));
    if (onPhone(page)) {
      await expect(details(page)).toHaveAttribute('data-sheet', 'half');
      expect(drawer.height).toBeCloseTo(canvas.height / 2, -1);
      expect(drawer.y + drawer.height).toBeCloseTo(canvas.y + canvas.height, 0);
      expect(drawer.width).toBeCloseTo(canvas.width, 0);
    } else {
      await expect(details(page)).not.toHaveAttribute('data-sheet');
      expect(drawer.width).toBeLessThanOrEqual(canvas.width / 2 + 0.5);
      expect(drawer.x + drawer.width).toBeCloseTo(canvas.x + canvas.width, 0);
      expect(drawer.y).toBeGreaterThanOrEqual(canvas.y - 0.5);
      expect(drawer.y + drawer.height).toBeLessThanOrEqual(canvas.y + canvas.height + 0.5);
    }
    // The folder's name as its accessible name has it ("Folder: Platform"), and its resource name.
    const heading = (await details(page).getByRole('heading', { level: 2 }).textContent())?.trim() ?? '';
    expect(heading).not.toBe('');
    expect(folder.name).toContain(heading);
    await expect(details(page).locator('code').first()).toHaveText(folder.id);
    await expectTarget(
      details(page).getByRole('button', { name: 'Copy resource name' }),
      'Copy resource name',
    );
    // Drill-in has no gesture of its own; the details offer it.
    const drill = details(page).getByRole('button', { name: 'Details', exact: true });
    await expectTarget(drill, 'Details');
    const organisation = await drawingOf(page);
    await drill.tap();
    await expect.poll(() => viewParam(page, 'root')).toBe(folder.id);
    await redrawnCanvas(page, organisation);
    await expect(page.getByRole('banner').getByRole('navigation', { name: 'Scope' })).toContainText(heading);
  });

  test('search from the View sheet: a result tapped is selected, in the details and in the canvas they leave in view', async ({
    page,
  }) => {
    const svg = await openDiagram(page, DEMO_M_DIAGRAM);
    const view = await openSheet(page, 'View');
    const box = view.getByRole('combobox', { name: 'Search assets' });
    await box.tap();
    await expect(box).toBeFocused();
    await box.fill('demo-web-1');
    const results = page.getByRole('listbox', { name: 'Search assets' });
    await expect(results).toBeVisible();
    await expect(results).not.toHaveAttribute('aria-busy', 'true');
    const first = results.getByRole('option').first();
    await expect(first).toHaveAccessibleName('Retail web (prod)');
    await expectTarget(first, 'the first result');
    await first.tap();
    await expect.poll(() => hashOf(page)).toContain(`selection=${WEB_PROJECT}`);
    const node = svg.locator(`[data-id="${WEB_PROJECT}"]`).first();
    await expect(node).toHaveAttribute('aria-pressed', 'true', { timeout: 20_000 });
    await expect(details(page)).toBeVisible();
    await expect(details(page).getByRole('heading', { level: 2 })).toHaveText('Retail web (prod)');
    // The details and a sheet are never open together: the pick closed View, focus back on its button.
    await expect(view).toBeHidden();
    await expect(fold(page, 'View').button).toBeFocused();
    // The camera brings the node into the part of the canvas the details leave in view.
    await expect
      .poll(async () => {
        const [room, at] = await Promise.all([uncovered(page), boxOf(node)]);
        const x = at.x + at.width / 2;
        const y = at.y + at.height / 2;
        return x > room.x && x < room.x + room.width && y > room.y && y < room.y + room.height;
      })
      .toBe(true);
  });

  test('the disclosure bar: Expand all opens more of the drawing, Collapse all brings it back', async ({
    page,
  }) => {
    await openDiagram(page, DEMO_M_DIAGRAM);
    const bar = page.getByRole('group', { name: 'Expand and collapse' });
    const count = bar.getByRole('status');
    await expect(count).toHaveText(/^[\d,]+ of [\d,]+ shown$/);
    const shown = async (): Promise<number> =>
      Number(/^([\d,]+) of/.exec((await count.textContent()) ?? '')?.[1]?.replaceAll(',', '') ?? NaN);
    const atRest = await shown();
    const expand = bar.getByRole('button', { name: 'Expand all' });
    await expectTarget(expand, 'Expand all');
    const collapsed = await drawingOf(page);
    await expand.tap();
    await expect.poll(shown, { timeout: 30_000 }).toBeGreaterThan(atRest);
    await redrawnCanvas(page, collapsed);
    const expanded = await drawingOf(page);
    const collapse = bar.getByRole('button', { name: 'Collapse all' });
    await expectTarget(collapse, 'Collapse all');
    await collapse.tap();
    await expect.poll(shown, { timeout: 30_000 }).toBe(atRest);
    await redrawnCanvas(page, expanded);
  });

  test.describe('the timeline', () => {
    test.use({ timezoneId: 'UTC', locale: 'en-GB' });

    test('Previous day and Next day step a day, and playback runs to the last day', async ({ page }) => {
      // Playwright's clock: a step's 0.5 s passes at once (playUntil).
      await page.clock.install();
      await openDiagram(page, `${DEMO_M_DIAGRAM}&tick=2026-10-05`);
      const bar = await timelineBar(page);
      await expectDrawn(bar, '2026-10-05');
      const previous = bar.getByRole('button', { name: 'Previous day' });
      const next = bar.getByRole('button', { name: 'Next day' });
      await expectTarget(previous, 'Previous day');
      await expectTarget(next, 'Next day');
      const fifth = await drawingOf(page);
      await previous.tap();
      await expect.poll(() => hashOf(page)).toBe('#snapshot=demo:M&tick=2026-10-04');
      await expectDrawn(bar, '2026-10-04', fifth);
      const fourth = await drawingOf(page);
      await next.tap();
      await expect.poll(() => hashOf(page)).toBe('#snapshot=demo:M&tick=2026-10-05');
      await expectDrawn(bar, '2026-10-05', fourth);

      const fast = bar.getByRole('radio', { name: /0\.5 s/ });
      await expectTarget(fast, '0.5 s');
      await fast.tap();
      await expect(fast).toBeChecked();
      const played = await recordHashes(page);
      const play = stoppedPlayButton(bar);
      await expectTarget(play, 'Play through the days');
      const fifthAgain = await drawingOf(page);
      await play.tap();
      await expect(bar.getByRole('button', { name: 'Pause playback' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await playUntil(page, () => playbackStopped(bar));
      expect(await played()).toEqual([
        '#snapshot=demo:M&tick=2026-10-06',
        '#snapshot=demo:M&tick=2026-10-07',
        '#snapshot=demo:M',
      ]);
      await expectDrawn(bar, '2026-10-08', fifthAgain);
    });
  });

  test('Export through More: the Export menu, and an SVG download', async ({ page }) => {
    await openDiagram(page, DEMO_M_DIAGRAM);
    const more = await openSheet(page, 'More');
    const button = more.getByRole('button', { name: 'Export', exact: true });
    await expectTarget(button, 'Export');
    await button.tap();
    const menu = page.getByRole('menu', { name: 'Export' });
    await expect(menu).toBeVisible();
    const svg = menu.getByRole('menuitem', { name: 'Download SVG' });
    await expectTarget(svg, 'Download SVG');
    const downloading = page.waitForEvent('download');
    await svg.tap();
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(/\.svg$/);
    const text = readFileSync(await download.path(), 'utf8');
    expect(text).toMatch(/^(?:<\?xml[^>]*\?>\s*)?<svg[\s>]/);
    await expect(
      page.getByRole('status', { name: 'Export status' }).filter({ hasText: /^Saved .*\.svg\.$/ }),
    ).toBeVisible();
  });

  for (const scheme of ['light', 'dark'] as const) {
    test.describe(`${scheme} theme`, () => {
      test.use({ colorScheme: scheme });

      test('axe on the diagram at rest, with View and with the details open, and on the Connect and Snapshots pages', async ({
        page,
      }) => {
        const svg = await openDiagram(page, DEMO_M_DIAGRAM);
        await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
        await expectNoAxeViolations(page);
        await openSheet(page, 'View');
        await expectNoAxeViolations(page);
        await page.keyboard.press('Escape');
        await expect(fold(page, 'View').sheet).toBeHidden();
        await tapAFolder(page, svg);
        await expectNoAxeViolations(page);
        for (const name of ['Snapshots', 'Connect'] as const) {
          await (await openSheet(page, 'More')).getByRole('link', { name, exact: true }).tap();
          await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
          await expect(fold(page, 'More').sheet).toBeHidden();
          await expectNoAxeViolations(page);
        }
      });
    });
  }
});
