// SPDX-License-Identifier: MIT
import { expect, test, type Locator, type Page } from '@playwright/test';

import { cameraSettled, detailsDrawer, drawingOf, openDiagram, redrawnCanvas, viewParam } from './support.js';
import { Fingers, type Point } from './touchSupport.js';

/**
 * The canvas by finger (frontend/AGENTS.md, Phones, tablets and desktops, the touch model; frontend/src/diagram/touch.ts), run by the `mobile`
 * project of playwright.config.ts with mobile.spec.ts: Chromium emulating a touch device at 390 × 844 (a phone's
 * layout), against demo mode. Fingers come as Playwright's taps and, for drags, pinches and presses, as touch events
 * through the Chrome DevTools Protocol; the browser makes its own pointer, mouse and click events of them, as on a
 * phone. On demo M, at the overview (folders, project chips) and drilled in to a project (cards):
 *
 * - one finger dragged from a card pans the drawing by exactly the drag, what it touched staying under it, and
 *   selects nothing;
 * - two fingers pinched apart zoom in by the ratio of their distances, what was drawn at their midpoint staying there;
 * - a tap on a card selects it and opens the details, and a tap on the bare canvas clears the selection;
 * - a double tap on the bare canvas zooms in two times about its point; on a chip it opens the chip in place, as one
 *   tap does, and neither drills in nor selects;
 * - a long press on a card shows what hover shows a mouse (the card's path ring) and the card's name by the finger
 *   (inside the canvas, clear of the finger), selects nothing and opens no menu, and the next tap takes it away;
 * - a mouse on the same page keeps its drag, and its double-click on a chip drills in;
 * - only the canvas keeps the browser's own gestures off: the page pinch-zooms as the browser does.
 */

test.use({ isMobile: true, hasTouch: true, deviceScaleFactor: 2, viewport: { width: 390, height: 844 } });
// Demo M is generated and laid out in the browser; a cold dev server compiles the workers first.
test.describe.configure({ timeout: 120_000 });

const OVERVIEW = '/diagram#snapshot=demo:M';
/** Demo M drilled in to one project: thirteen cards, large enough on a phone to land a finger on one. */
const PROJECT = `/diagram#snapshot=demo:M&root=${encodeURIComponent('//cloudresourcemanager.googleapis.com/projects/10000000025')}`;

/** The camera: the viewport group's translation and scale. */
interface Camera {
  readonly x: number;
  readonly y: number;
  readonly k: number;
}

/** What a finger lands on: a chip, a card, or nothing drawn. */
type Landing = 'chip' | 'card' | 'bare';

/**
 * A point in the canvas's upper half where a finger lands on `kind` (as the browser hit-tests it), with the node's id
 * and accessible name; fails when there is none. Everything within `reach` pixels of the point is the same node, or
 * nothing drawn for `bare` (the title block and the legend count as nothing drawn: no node).
 */
async function pointOn(
  svg: Locator,
  kind: Landing,
  reach: number,
): Promise<Point & { id: string; name: string }> {
  const found = await svg.evaluate(
    (element, [wanted, around]) => {
      const box = element.getBoundingClientRect();
      const nodeAt = (x: number, y: number): Element | null | undefined => {
        const hit = document.elementFromPoint(x, y);
        if (hit === null || !element.contains(hit)) return undefined;
        if (hit.closest('[data-ghost], .dg-console-action, .dg-collapse') !== null) return undefined;
        return hit.closest('[data-id]');
      };
      const selector = wanted === 'chip' ? '.dg-chip' : '.dg-card';
      for (let y = box.top + around + 4; y < box.top + box.height / 2; y += 2) {
        for (let x = box.left + around + 4; x < box.right - around - 4; x += 2) {
          const node = nodeAt(x, y);
          if (node === undefined) continue;
          if (wanted === 'bare' ? node !== null : node?.matches(selector) !== true) continue;
          let same = true;
          for (const dx of [-around, 0, around])
            for (const dy of [-around, 0, around]) if (nodeAt(x + dx, y + dy) !== node) same = false;
          if (!same) continue;
          return {
            x,
            y,
            id: node?.getAttribute('data-id') ?? '',
            name: node?.getAttribute('aria-label') ?? '',
          };
        }
      }
      return null;
    },
    [kind, reach] as const,
  );
  if (found === null) throw new Error(`no ${kind} in the canvas's upper half`);
  return found;
}

/** The camera once it stands still (a glide of 200 ms has ended). */
async function cameraOf(svg: Locator): Promise<Camera> {
  await cameraSettled(svg);
  const transform = await svg.evaluate(
    (element) => element.querySelector('.dg-viewport')?.getAttribute('transform') ?? '',
  );
  const [x = NaN, y = NaN] =
    /translate\(([-\d.e]+),\s*([-\d.e]+)\)/.exec(transform)?.slice(1).map(Number) ?? [];
  const k = Number(/scale\(([-\d.e]+)\)/.exec(transform)?.[1] ?? 1);
  return { x, y, k };
}

/** The canvas's top-left corner on the screen: a camera's point (0, 0). */
async function originOf(page: Page): Promise<Point> {
  const box = await page.locator('#diagram-canvas').boundingBox();
  if (box === null) throw new Error('no canvas');
  return { x: box.x, y: box.y };
}

/** The drawing's point (drawing units) that `camera` shows at the screen point `at`. */
function drawingPoint(camera: Camera, origin: Point, at: Point): Point {
  return { x: (at.x - origin.x - camera.x) / camera.k, y: (at.y - origin.y - camera.y) / camera.k };
}

/** What a long press shows by the finger. */
function heldHint(page: Page): Locator {
  return page.locator('#diagram-canvas > p[aria-hidden="true"]');
}

test('one finger dragged from a card pans the drawing by the drag, what it touched under it, and selects nothing', async ({
  page,
}) => {
  const svg = await openDiagram(page, PROJECT);
  const fingers = await Fingers.on(page);
  const origin = await originOf(page);
  const start = await pointOn(svg, 'card', 6);
  const before = await cameraOf(svg);
  const end = { x: start.x + 60, y: start.y + 40 };
  await fingers.drag(start, end);
  const after = await cameraOf(svg);
  expect(after.k).toBeCloseTo(before.k, 6);
  expect(after.x - before.x).toBeCloseTo(60, 0);
  expect(after.y - before.y).toBeCloseTo(40, 0);
  const touched = drawingPoint(before, origin, start);
  const under = drawingPoint(after, origin, end);
  expect(under.x).toBeCloseTo(touched.x, 0);
  expect(under.y).toBeCloseTo(touched.y, 0);
  expect(viewParam(page, 'selection')).toBeNull();
  await expect(detailsDrawer(page)).toBeHidden();
});

test('two fingers pinched apart zoom in by the ratio of their distances, about a midpoint that stays put', async ({
  page,
}) => {
  const svg = await openDiagram(page, OVERVIEW);
  const fingers = await Fingers.on(page);
  const origin = await originOf(page);
  const box = await page.locator('#diagram-canvas').boundingBox();
  if (box === null) throw new Error('no canvas');
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 3 };
  const before = await cameraOf(svg);
  const drawn = drawingPoint(before, origin, centre);
  await fingers.pinch(centre, 60, 180);
  const after = await cameraOf(svg);
  expect(after.k / before.k).toBeCloseTo(3, 1);
  const still = drawingPoint(after, origin, centre);
  expect((still.x - drawn.x) * after.k).toBeCloseTo(0, 0);
  expect((still.y - drawn.y) * after.k).toBeCloseTo(0, 0);
  expect(viewParam(page, 'selection')).toBeNull();
});

test('a tap on a card selects it and opens the details; a tap on the bare canvas clears the selection', async ({
  page,
}) => {
  const svg = await openDiagram(page, PROJECT);
  const target = await pointOn(svg, 'card', 6);
  await page.touchscreen.tap(target.x, target.y);
  await expect.poll(() => viewParam(page, 'selection')).toBe(target.id);
  await expect(svg.locator(`[data-id="${target.id}"].is-selected`)).toHaveCount(1);
  const drawer = detailsDrawer(page);
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('heading', { level: 2 })).not.toBeEmpty();
  // The camera keeps the card clear of the sheet; then a tap on nothing drawn, above the sheet.
  await cameraOf(svg);
  const bare = await pointOn(svg, 'bare', 8);
  await page.touchscreen.tap(bare.x, bare.y);
  await expect.poll(() => viewParam(page, 'selection')).toBeNull();
  await expect(drawer).toBeHidden();
});

test('a double tap on the bare canvas zooms in two times about its point', async ({ page }) => {
  const svg = await openDiagram(page, OVERVIEW);
  const origin = await originOf(page);
  const bare = await pointOn(svg, 'bare', 8);
  const before = await cameraOf(svg);
  const drawn = drawingPoint(before, origin, bare);
  await page.touchscreen.tap(bare.x, bare.y);
  await page.touchscreen.tap(bare.x, bare.y);
  await expect.poll(async () => (await cameraOf(svg)).k / before.k).toBeCloseTo(2, 3);
  const after = await cameraOf(svg);
  const still = drawingPoint(after, origin, bare);
  expect((still.x - drawn.x) * after.k).toBeCloseTo(0, 0);
  expect((still.y - drawn.y) * after.k).toBeCloseTo(0, 0);
  expect(viewParam(page, 'selection')).toBeNull();
});

test('a double tap on a chip opens it in place, as one tap does, and neither drills in nor selects', async ({
  page,
}) => {
  const svg = await openDiagram(page, OVERVIEW);
  const chip = await pointOn(svg, 'chip', 2);
  await page.touchscreen.tap(chip.x, chip.y);
  await page.touchscreen.tap(chip.x, chip.y);
  await expect.poll(() => viewParam(page, 'flips')).not.toBeNull();
  await expect(svg.locator(`.dg-zone[data-id="${chip.id}"]`)).toHaveCount(1, { timeout: 30_000 });
  await expect(svg.locator(`.dg-chip[data-id="${chip.id}"]`)).toHaveCount(0);
  expect(viewParam(page, 'root')).toBeNull();
  expect(viewParam(page, 'selection')).toBeNull();
});

test('a long press on a card shows what hover shows and its name by the finger, and selects nothing', async ({
  page,
}) => {
  const svg = await openDiagram(page, PROJECT);
  const fingers = await Fingers.on(page);
  const card = await pointOn(svg, 'card', 6);
  await fingers.hold(card);
  // While the finger rests: the card's hover preview (its path ring) and its name.
  await expect(heldHint(page)).toHaveText(card.name);
  await expect(svg.locator(`[data-id="${card.id}"].is-path`)).toHaveCount(1);
  await fingers.lift();
  // Lifted: nothing selected and no menu, the preview and the name still there, the name inside the canvas and
  // clear of the finger (above it, or below it where the canvas has no room above).
  await expect(heldHint(page)).toBeVisible();
  expect(viewParam(page, 'selection')).toBeNull();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(detailsDrawer(page)).toBeHidden();
  await expect(svg.locator(`[data-id="${card.id}"].is-path`)).toHaveCount(1);
  const hint = await heldHint(page).boundingBox();
  const canvas = await page.locator('#diagram-canvas').boundingBox();
  if (hint === null || canvas === null) throw new Error('no hint or canvas');
  expect(hint.y + hint.height <= card.y || hint.y >= card.y).toBe(true);
  expect(hint.x).toBeGreaterThanOrEqual(canvas.x);
  expect(hint.x + hint.width).toBeLessThanOrEqual(canvas.x + canvas.width);
  expect(hint.y).toBeGreaterThanOrEqual(canvas.y);
  expect(hint.y + hint.height).toBeLessThanOrEqual(canvas.y + canvas.height);
  // The next tap, on nothing drawn, takes it away.
  const bare = await pointOn(svg, 'bare', 8);
  await page.touchscreen.tap(bare.x, bare.y);
  await expect(heldHint(page)).toHaveCount(0);
  await expect(svg.locator('.is-path')).toHaveCount(0);
});

test('a mouse on the same page keeps its drag, and its double-click on a chip drills in', async ({
  page,
}) => {
  const svg = await openDiagram(page, OVERVIEW);
  const bare = await pointOn(svg, 'bare', 8);
  const before = await cameraOf(svg);
  await page.mouse.move(bare.x, bare.y);
  await page.mouse.down();
  await page.mouse.move(bare.x + 50, bare.y + 30, { steps: 5 });
  await page.mouse.up();
  const after = await cameraOf(svg);
  expect(after.k).toBeCloseTo(before.k, 6);
  expect(after.x - before.x).toBeCloseTo(50, 0);
  expect(after.y - before.y).toBeCloseTo(30, 0);
  const chip = await pointOn(svg, 'chip', 2);
  const overview = await drawingOf(page);
  await page.mouse.dblclick(chip.x, chip.y);
  await expect.poll(() => viewParam(page, 'root'), { timeout: 30_000 }).toBe(chip.id);
  expect(viewParam(page, 'flips')).toBeNull();
  await redrawnCanvas(page, overview);
});

test('only the canvas keeps the browser’s gestures off: the page pinch-zooms as the browser does', async ({
  page,
}) => {
  const svg = await openDiagram(page, OVERVIEW);
  const viewport = await page.locator('meta[name="viewport"]').getAttribute('content');
  expect(viewport).not.toMatch(/user-scalable\s*=\s*(no|0)|maximum-scale/);
  const touchAction = (locator: Locator): Promise<string> =>
    locator.evaluate((element) => getComputedStyle(element).touchAction);
  expect(await touchAction(svg)).toBe('none');
  for (const outside of [page.locator('body'), page.getByRole('banner'), page.locator('main')])
    expect(await touchAction(outside)).toBe('auto');
});
