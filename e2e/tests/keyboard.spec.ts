// SPDX-License-Identifier: MIT
import { expect, test, type Locator, type Page } from '@playwright/test';
import { PNG } from 'pngjs';

import {
  cameraSettled,
  contrastRatio,
  expectNoAxeViolations,
  hashOf,
  openDiagram,
  relativeLuminance,
  scratchShot,
  wcagContrast,
} from './support.js';

/**
 * The keyboard model (the gcp-diagram-style skill's accessibility rules) in Chromium, without the mouse:
 *
 * - a keyboard-only walkthrough (no pointer event reaches the page): open demo M from the Connect page, Tab on to
 *   the drawing, move between the items of a zone with the arrow keys, out to the zone with Escape and back in
 *   with ↓, expand a chip, change the lens, search with `/`, open the drawer for a card with Enter, drill in from a
 *   project's menu, export an SVG, and press `[` (the timeline moves one day back);
 * - the Tab order through the header controls, then the canvas's one tab stop;
 * - "Skip to the diagram" lands on the drawing's tab stop;
 * - every focus indicator met while tabbing through the diagram page (the chrome ring, the drawing's focus ring,
 *   the collapse button's plate on a project and the console action's pill) and through the other pages reaches
 *   3 : 1 against the colours next to it, in both themes;
 * - the focus indicator as rendered, pixel by pixel (WCAG 2.4.13's measure: the focused and the unfocused screen
 *   differ by 3 : 1 over at least a 2 px ring), on demo L zoomed out to fit (scale 0.07: a card is 10 × 3 px), in
 *   both themes: after the skip link, after an arrow (which zooms in to the label scale), on an open zone (Escape)
 *   and on a card in a project, the light tint where the chrome's primary alone reaches only 2.62 : 1;
 * - the zoom keys `+`, `-` and `0`, from the keyboard only;
 * - `[` and `]` as German layouts type them (Option+5 on a Mac, AltGr+8 on a PC): the timeline moves, and says
 *   why when it cannot;
 * - focus after a drill-in from the details drawer (the new view's tab stop) and after a drill-out from the
 *   breadcrumb (the crumb that is now current, its ring unclipped);
 * - reduced motion: no pulse and no glide (and without it, both).
 *
 * axe with the keyboard inside a zone: a11y.spec.ts. Screenshots of the walkthrough go to e2e/.scratch/keyboard/
 * (git-ignored).
 */
const DEMO_S = '/diagram#snapshot=demo:S';

test.describe.configure({ timeout: 120_000 });

/** What has focus: its tag, role, accessible name (as the app sets it) and a few markers. */
interface Focused {
  readonly tag: string;
  readonly role: string | null;
  readonly name: string;
  readonly inCanvas: boolean;
  readonly classes: string;
}

async function focused(page: Page): Promise<Focused> {
  return page.evaluate(() => {
    const element = document.activeElement;
    if (element === null || element === document.body)
      return { tag: 'none', role: null, name: '', inCanvas: false, classes: '' };
    // The accessible name as the app gives it: aria-label, aria-labelledby, a label, else the visible text
    // without what is hidden from assistive technology (carets, check marks).
    const text = (node: Element): string => {
      const copy = node.cloneNode(true);
      if (copy instanceof Element)
        for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
      return copy.textContent ?? '';
    };
    const labelledBy = element.getAttribute('aria-labelledby');
    const labelled =
      labelledBy === null
        ? null
        : labelledBy
            .split(' ')
            .map((id) => {
              const target = document.getElementById(id);
              return target === null ? '' : text(target);
            })
            .join(' ');
    const label =
      element.getAttribute('aria-label') ??
      labelled ??
      (element instanceof HTMLInputElement && element.labels !== null && element.labels[0] !== undefined
        ? text(element.labels[0])
        : null) ??
      text(element);
    return {
      tag: element.tagName.toLowerCase(),
      role: element.getAttribute('role'),
      name: label.replace(/\s+/g, ' ').trim(),
      inCanvas: element.closest('svg.dg-canvas') !== null,
      classes: element.getAttribute('class') ?? '',
    };
  });
}

/** Presses Tab (or Shift+Tab) until `matches` holds for what has focus; fails after `max` presses. */
async function tabTo(
  page: Page,
  matches: (at: Focused) => boolean,
  { backwards = false, max = 60 }: { backwards?: boolean; max?: number } = {},
): Promise<Focused> {
  for (let presses = 0; presses < max; presses += 1) {
    await page.keyboard.press(backwards ? 'Shift+Tab' : 'Tab');
    const at = await focused(page);
    if (matches(at)) return at;
  }
  throw new Error(`nothing matching was reached within ${String(max)} presses of Tab`);
}

/** Records every pointer, mouse and wheel event a person's device would make; a keyboard click has detail 0. */
async function recordPointer(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const seen: string[] = [];
    Object.defineProperty(window, 'pointerEventsSeen', { value: seen });
    const types = [
      'pointerover',
      'pointerdown',
      'pointerup',
      'pointermove',
      'mousedown',
      'mouseup',
      'mousemove',
      'wheel',
      'dblclick',
      'click',
    ];
    for (const type of types) {
      window.addEventListener(
        type,
        (event) => {
          if (!event.isTrusted) return;
          if (type === 'click' && event instanceof MouseEvent && event.detail === 0) return;
          seen.push(type);
        },
        true,
      );
    }
  });
}

async function pointerEventsSeen(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const value: unknown = Reflect.get(window, 'pointerEventsSeen');
    return Array.isArray(value) ? value.map(String) : ['(not recorded)'];
  });
}

function canvas(page: Page): Locator {
  return page.locator('svg.dg-canvas[data-diagram-ready="true"]');
}

/** The canvas's one tab stop among its items (a node, or an open zone's collapse button). */
function tabStop(page: Page): Locator {
  return canvas(page).locator('.dg-zones [tabindex="0"], .dg-nodes [tabindex="0"]');
}

function shot(page: Page, name: string): Promise<Buffer> {
  return scratchShot(page, 'keyboard', name);
}

/** A close-up of what has focus and its surroundings, at the device's pixels (for a person to look at). */
async function closeUp(page: Page, name: string): Promise<void> {
  // The camera pans 200 ms to show what the keyboard moved to.
  await expect(page.locator(':focus')).toBeInViewport();
  await cameraSettled(canvas(page));
  const box = await page.locator(':focus').boundingBox();
  if (box === null) return;
  const pad = 40;
  await scratchShot(page, 'keyboard', name, {
    clip: {
      x: Math.max(0, box.x - pad),
      y: Math.max(0, box.y - pad),
      width: box.width + 4 * pad,
      height: box.height + 2 * pad,
    },
  });
}

test('a keyboard-only walkthrough: demo, arrows, chip, lens, search, drawer, drill-in, export, timeline', async ({
  page,
}) => {
  await recordPointer(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Connect' })).toBeVisible();

  // Open demo M from the Connect page: the size radio group, then "Try the demo".
  await tabTo(page, (at) => at.role === 'radio' && at.name === 'S');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: 'M', exact: true })).toHaveAttribute('aria-checked', 'true');
  await tabTo(page, (at) => at.name === 'Try the demo');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/diagram#snapshot=demo:M$/, { timeout: 60_000 });
  await expect(canvas(page)).toBeVisible({ timeout: 60_000 });

  // Focus was on the button that opened the demo; Tab goes on to the drawing's one tab stop.
  const first = await tabTo(page, (at) => at.inCanvas);
  await expect(tabStop(page)).toBeFocused();
  await expect(canvas(page).locator('.dg-focus-ring')).not.toHaveAttribute('display', 'none');

  // The arrow keys move between the items of the zone, keeping one tab stop; Escape returns to the zone, and ↓
  // goes back inside it, to its first item.
  await page.keyboard.press('ArrowDown');
  const moved = await focused(page);
  expect(moved.inCanvas).toBe(true);
  expect(moved.name).not.toBe(first.name);
  await expect(tabStop(page)).toHaveCount(1);
  await page.keyboard.press('Escape');
  const zone = await focused(page);
  expect(zone.classes).toContain('dg-collapse');
  expect(zone.name).toMatch(/^Collapse Folder: /);
  await page.keyboard.press('ArrowDown');
  const inside = await focused(page);
  expect(inside.inCanvas).toBe(true);
  await page.keyboard.press('End');
  await page.keyboard.press('Home');
  expect((await focused(page)).name).toBe(inside.name);
  await shot(page, 'walkthrough-1-arrows');

  // Expand a chip: Enter on it flips it open, and focus follows the zone to its collapse button.
  expect(inside.classes).toContain('dg-chip');
  const chipName = inside.name.replace(/, collapsed, .*$/, '');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/flips=/);
  await expect.poll(async () => (await focused(page)).name, { timeout: 30_000 }).toBe(`Collapse ${chipName}`);
  // The camera glides 200 ms to frame the zone.
  await cameraSettled(canvas(page));
  await shot(page, 'walkthrough-2-chip-expanded');

  // Change the lens: back to the Lens picker, open it, type-ahead to Compute, choose it.
  await tabTo(page, (at) => at.role === 'combobox' && at.name.startsWith('Lens'), { backwards: true });
  await page.keyboard.press('Enter');
  await expect(page.getByRole('listbox', { name: 'Lens' })).toBeVisible();
  await page.keyboard.type('Comp');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/lens=compute/);
  await expect(page.locator('svg.dg-canvas > title')).toHaveText(
    'gcportrait diagram of example.com, Compute lens',
    { timeout: 30_000 },
  );

  // Search: `/` from outside a text field, type, Enter lands on the best result (selected, drawer open).
  await page.keyboard.press('/');
  const box = page.getByRole('combobox', { name: 'Search assets' });
  await expect(box).toBeFocused();
  await page.keyboard.type('bastion');
  await expect(page.getByRole('listbox', { name: 'Search assets' })).not.toHaveAttribute('aria-busy', 'true');
  await page.keyboard.press('Enter');
  await expect.poll(() => hashOf(page)).toContain('selection=//compute.googleapis.com/');
  const drawer = page.getByRole('complementary', { name: 'Details' });
  await expect(drawer).toBeVisible({ timeout: 30_000 });
  await expect(drawer.getByRole('heading', { level: 2, name: 'bastion' })).toBeVisible();

  // Open the drawer for another card: Tab reaches the canvas at the selected card; an arrow, then Enter.
  await tabTo(page, (at) => at.inCanvas);
  expect((await focused(page)).name).toMatch(/: bastion$/);
  let neighbour: Focused | null = null;
  for (const key of ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp']) {
    await page.keyboard.press(key);
    const at = await focused(page);
    if (
      at.inCanvas &&
      at.role === 'button' &&
      !at.classes.includes('dg-collapse') &&
      !at.name.endsWith(': bastion')
    ) {
      neighbour = at;
      break;
    }
  }
  if (neighbour === null) throw new Error('no card beside the bastion');
  await page.keyboard.press('Enter');
  const neighbourLabel = neighbour.name
    .slice(neighbour.name.indexOf(': ') + 2)
    .replace(/, collapsed, .*$/, '');
  await expect(drawer.getByRole('heading', { level: 2 })).toHaveText(neighbourLabel);
  await shot(page, 'walkthrough-3-drawer');

  // Drill in: Escape clears the selection, then each Escape goes out one zone, up to the project; its menu
  // (Shift+F10) offers "Drill in".
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  let project: Focused | null = null;
  for (let presses = 0; presses < 6 && project === null; presses += 1) {
    await page.keyboard.press('Escape');
    const at = await focused(page);
    if (at.name.startsWith('Collapse Project: ')) project = at;
  }
  if (project === null) throw new Error('Escape never reached the project around the card');
  await page.keyboard.press('Shift+F10');
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await page.keyboard.press('d');
  await expect(menu.getByRole('menuitem', { name: 'Details' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(() => hashOf(page)).toContain('root=//cloudresourcemanager.googleapis.com/projects/');
  await expect(page.getByRole('navigation', { name: 'Scope' })).toContainText(
    project.name.replace(/^Collapse Project: /, '').replace(/ \(.*\)$/, ''),
    { timeout: 30_000 },
  );
  // The new view is fitted: its first card is on screen (a pan from the keyboard moves just before never carries
  // the camera off it); focus waited on the canvas and is on the new drawing's tab stop.
  await expect(canvas(page).locator('.dg-node').first()).toBeInViewport();
  await expect(tabStop(page)).toBeFocused();
  await shot(page, 'walkthrough-4-drilled-in');

  // Export an SVG from the Export menu.
  await tabTo(page, (at) => at.name.startsWith('Export'), { backwards: true });
  await page.keyboard.press('Enter');
  const exportMenu = page.getByRole('menu', { name: 'Export' });
  await expect(exportMenu).toBeVisible();
  // From the last action, Copy PNG, up past Download draw.io and Download PNG.
  await page.keyboard.press('End');
  for (let step = 0; step < 3; step += 1) await page.keyboard.press('ArrowUp');
  await expect(exportMenu.getByRole('menuitem', { name: 'Download SVG' })).toBeFocused();
  const download = page.waitForEvent('download');
  await page.keyboard.press('Enter');
  // Named after the drilled-in project, the lens and the read time.
  expect((await download).suggestedFilename()).toMatch(
    /^gcportrait_[A-Za-z0-9.-]+_compute_\d{8}T\d{6}Z\.svg$/,
  );

  // The timeline keys: one day back from the demo's last day.
  await page.keyboard.press('[');
  await expect.poll(() => hashOf(page)).toContain('tick=2026-10-07');

  expect(await pointerEventsSeen(page)).toEqual([]);
});

test('"Skip to the diagram" moves focus from the top of the page to the drawing’s tab stop', async ({
  page,
}) => {
  await openDiagram(page, DEMO_S);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Tab');
  const link = page.getByRole('link', { name: 'Skip to the diagram' });
  await expect(link).toBeFocused();
  await expect(link).toBeInViewport();
  const hash = new URL(page.url()).hash;
  await page.keyboard.press('Enter');
  await expect(tabStop(page)).toBeFocused();
  await expect(canvas(page).locator('.dg-focus-ring')).not.toHaveAttribute('display', 'none');
  expect(new URL(page.url()).hash).toBe(hash);
  await shot(page, 'skip-to-the-diagram');
});

test('Tab goes through the skip links, the navigation, the app actions and the view controls, then the canvas', async ({
  page,
}) => {
  await openDiagram(page, DEMO_S);
  await page.locator('body').evaluate((body) => {
    (body.ownerDocument.activeElement as HTMLElement | null)?.blur();
  });
  const order: string[] = [];
  for (let presses = 0; presses < 40; presses += 1) {
    await page.keyboard.press('Tab');
    const at = await focused(page);
    if (at.inCanvas) {
      order.push('(canvas)');
      break;
    }
    order.push(at.name);
  }
  const expected = [
    'Skip to content',
    'Skip to the diagram',
    'gcportrait',
    'Connect',
    'Diagram',
    'Snapshots',
    'Permissions',
    'Settings',
    'Snapshot',
    'Saved views',
    'Copy link',
    'Theme',
    'Export',
    'Lens',
    'Focus',
    'Filters',
    'Search assets',
    '(canvas)',
  ];
  // Every expected stop, in this order (other stops may sit between them); a name may carry a summary after it.
  const named = (stop: string, name: string): boolean =>
    stop === name || stop.startsWith(`${name} `) || stop.startsWith(`${name}:`);
  const positions = expected.map((name) => order.findIndex((stop) => named(stop, name)));
  expect(
    positions.every((position) => position >= 0),
    order.join(' | '),
  ).toBe(true);
  expect(
    [...positions].sort((a, b) => a - b),
    order.join(' | '),
  ).toEqual(positions);
  // The canvas is one tab stop: the next Tab leaves the drawing.
  await page.keyboard.press('Tab');
  expect((await focused(page)).inCanvas).toBe(false);
});

/** A colour as `#rrggbb` from a computed `rgb()`/`rgba()` value; null when transparent. */
function hex(value: string): string | null {
  const match = /rgba?\(([^)]+)\)/.exec(value);
  if (match?.[1] === undefined) return null;
  const parts = match[1]
    .split(/[\s,/]+/)
    .filter((part) => part !== '')
    .map(Number);
  const [r = 0, g = 0, b = 0, a = 1] = parts;
  if (a === 0) return null;
  return `#${[r, g, b].map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`;
}

/** The focus indicator of what has focus: its colour and the colours next to it. */
interface Indicator {
  readonly name: string;
  readonly kind: string;
  readonly indicator: string | null;
  readonly beside: ReadonlyArray<string | null>;
}

async function indicatorOf(page: Page): Promise<Indicator> {
  return page.evaluate(() => {
    const element = document.activeElement;
    const name = (element?.getAttribute('aria-label') ?? element?.textContent ?? '').trim().slice(0, 60);
    if (element === null || element === document.body)
      return { name, kind: 'none', indicator: null, beside: [] };
    const style = (selector: string): CSSStyleDeclaration | null => {
      const found = element.ownerDocument.querySelector(selector);
      return found === null ? null : getComputedStyle(found);
    };
    const backgroundBehind = (from: Element | null): string => {
      for (let at = from; at !== null; at = at.parentElement) {
        const colour = getComputedStyle(at).backgroundColor;
        if (!/rgba\([^)]*,\s*0\)$/.test(colour) && colour !== 'transparent') return colour;
      }
      return 'rgb(255, 255, 255)';
    };
    // A filled shape's indicator (its fill) touches its rim when it has one, else the node it sits in.
    const filled = (
      shape: Element | null | undefined,
      behind: Element | null,
    ): readonly (string | null)[] => {
      if (shape === null || shape === undefined) return [null];
      const css = getComputedStyle(shape);
      const rim = Number.parseFloat(css.strokeWidth) > 0 && css.stroke !== 'none' && css.stroke !== css.fill;
      return [rim ? css.stroke : behind === null ? null : getComputedStyle(behind).fill];
    };
    if (element.closest('svg.dg-canvas') !== null) {
      if (element.classList.contains('dg-collapse')) {
        const plate = element.querySelector('.dg-collapse-plate');
        const zone = element.closest('.dg-zone')?.querySelector('.dg-body') ?? null;
        const fill = plate === null ? null : getComputedStyle(plate).fill;
        return { name, kind: 'collapse plate', indicator: fill, beside: filled(plate, zone) };
      }
      if (element.classList.contains('dg-console-action')) {
        const variant = [...element.querySelectorAll('.dg-console-variant')].find(
          (candidate) => candidate.getAttribute('display') !== 'none',
        );
        const pill = [...(variant?.querySelectorAll('.dg-console-pill') ?? [])].find(
          (candidate) => candidate.getBoundingClientRect().width > 0,
        );
        const node = element.ownerDocument.querySelector('svg.dg-canvas .is-selected .dg-body');
        const fill = pill === undefined ? null : getComputedStyle(pill).fill;
        return { name, kind: 'console pill', indicator: fill, beside: filled(pill, node) };
      }
      const ring = element.ownerDocument.querySelector('.dg-focus-ring');
      const shown = ring !== null && ring.getAttribute('display') !== 'none';
      return {
        name,
        kind: 'canvas ring',
        indicator: shown ? (style('.dg-focus-ring .dg-ring')?.stroke ?? null) : null,
        beside: [style('.dg-focus-ring .dg-ring-gap')?.stroke ?? null],
      };
    }
    const css = getComputedStyle(element);
    const shadows =
      css.boxShadow === 'none' ? [] : css.boxShadow.split(/,(?![^(]*\))/).map((part) => part.trim());
    const inset = shadows.filter((shadow) => shadow.includes('inset') && !shadow.includes('0px -2px'));
    const outer = shadows.filter((shadow) => !shadow.includes('inset'));
    const colourOf = (shadow: string | undefined): string | null =>
      /rgba?\([^)]*\)/.exec(shadow ?? '')?.[0] ?? null;
    if (outer.length >= 2) {
      // The ring (the widest shadow) outside its gap (the next one).
      return {
        name,
        kind: 'chrome ring',
        indicator: colourOf(outer[outer.length - 1]),
        beside: [colourOf(outer[outer.length - 2]), backgroundBehind(element.parentElement)],
      };
    }
    if (inset.length >= 1) {
      return {
        name,
        kind: 'inset ring',
        indicator: colourOf(inset[0]),
        beside: [backgroundBehind(element)],
      };
    }
    const outline = css.outlineStyle !== 'none' && css.outlineWidth !== '0px' ? css.outlineColor : null;
    return { name, kind: 'outline', indicator: outline, beside: [backgroundBehind(element.parentElement)] };
  });
}

/** Every focus indicator met while tabbing once through the page, from its first stop (the skip link). */
async function tabThrough(page: Page): Promise<Indicator[]> {
  await page.getByRole('link', { name: 'Skip to content' }).focus();
  const seen: Indicator[] = [await indicatorOf(page)];
  for (let presses = 0; presses < 80; presses += 1) {
    await page.keyboard.press('Tab');
    const at = await indicatorOf(page);
    if (at.kind === 'none' || at.name === seen[0]?.name) break;
    seen.push(at);
  }
  return seen;
}

/** The indicators below 3 : 1 against a colour beside them, or with none at all, as readable lines. */
function belowThreeToOne(seen: readonly Indicator[]): string[] {
  const failures: string[] = [];
  for (const at of seen) {
    const indicator = at.indicator === null ? null : hex(at.indicator);
    if (indicator === null) {
      failures.push(`${at.name} (${at.kind}): no indicator`);
      continue;
    }
    for (const beside of at.beside) {
      const colour = beside === null ? null : hex(beside);
      if (colour === null) continue;
      const ratio = wcagContrast(indicator, colour);
      if (ratio < 3)
        failures.push(`${at.name} (${at.kind}): ${indicator} on ${colour} = ${ratio.toFixed(2)}`);
    }
  }
  return failures;
}

for (const scheme of ['light', 'dark'] as const) {
  test(`${scheme}: every focus indicator on the diagram page reaches 3 : 1 against the colours beside it`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme });
    const svg = await openDiagram(page, DEMO_S);
    await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
    // A project's collapse button (the light project tint is where the focus colour alone is below 3 : 1): a
    // VM found by search, then Escape (the selection) and Escape again, zone by zone, out to its project.
    await page.locator('main').focus();
    await page.keyboard.press('/');
    await page.keyboard.type('web-1mnl');
    await expect(page.getByRole('listbox', { name: 'Search assets' })).not.toHaveAttribute(
      'aria-busy',
      'true',
    );
    await page.keyboard.press('Enter');
    await expect(page.getByRole('complementary', { name: 'Details' })).toBeVisible();
    // Let the 200 ms glide to the card end (at 100 %: the project's header is then out of view, and the keyboard
    // moving there pans the camera to show it).
    await cameraSettled(canvas(page));
    await tabTo(page, (at) => at.inCanvas);
    await page.keyboard.press('Escape');
    let plate: Indicator | null = null;
    for (let presses = 0; presses < 6 && plate === null; presses += 1) {
      await page.keyboard.press('Escape');
      const at = await indicatorOf(page);
      if (at.name.startsWith('Collapse Project: ')) plate = at;
    }
    if (plate === null) throw new Error('Escape never reached a project');
    expect(plate.kind).toBe('collapse plate');
    await closeUp(page, `focus-collapse-plate-${scheme}`);
    // Back into the project, to a card, and select it.
    await page.keyboard.press('ArrowDown');
    for (let presses = 0; presses < 6; presses += 1) {
      const at = await focused(page);
      if (!at.classes.includes('dg-collapse')) break;
      await page.keyboard.press('ArrowDown');
    }
    await page.keyboard.press('Enter');
    await expect(page.getByRole('complementary', { name: 'Details' })).toBeVisible();
    const seen: Indicator[] = [plate, ...(await tabThrough(page))];
    expect(seen.length).toBeGreaterThan(20);
    for (const kind of ['chrome ring', 'canvas ring', 'collapse plate', 'console pill']) {
      expect(
        seen.some((at) => at.kind === kind),
        `${kind} among ${seen.map((at) => at.kind).join(', ')}`,
      ).toBe(true);
    }
    expect(belowThreeToOne(seen)).toEqual([]);
    await expect(svg).toBeVisible();
  });

  test(`${scheme}: every focus indicator on the other pages reaches 3 : 1 against the colours beside it`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme });
    for (const path of ['/', '/snapshots', '/permissions', '/settings']) {
      await page.goto(path);
      await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const seen = await tabThrough(page);
      expect(seen.length, path).toBeGreaterThan(10);
      expect(belowThreeToOne(seen), path).toEqual([]);
    }
  });
}

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`${
    reducedMotion === 'reduce'
      ? 'reduced motion: no pulse, and the camera jumps'
      : 'motion: the selection pulses and the camera glides'
  } to a search hit`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    const svg = await openDiagram(page, '/diagram#snapshot=demo:M&lens=compute&detail=all');
    // Count the camera's steps (the viewport's transform) while the search hit is glided to.
    await page.evaluate(() => {
      const viewport = document.querySelector('svg.dg-canvas .dg-viewport');
      const seen: string[] = [];
      Object.defineProperty(window, 'cameraSteps', { value: seen });
      if (viewport === null) return;
      new MutationObserver(() => {
        seen.push(viewport.getAttribute('transform') ?? '');
      }).observe(viewport, { attributes: true, attributeFilter: ['transform'] });
    });
    await page.locator('main').focus();
    await page.keyboard.press('/');
    await page.keyboard.type('bastion');
    await expect(page.getByRole('listbox', { name: 'Search assets' })).not.toHaveAttribute(
      'aria-busy',
      'true',
    );
    await page.keyboard.press('Enter');
    await expect.poll(() => hashOf(page)).toContain('selection=');
    const ring = svg.locator('.dg-select-ring');
    await expect(ring).not.toHaveAttribute('display', 'none');
    const stepsSeen = (): Promise<number> =>
      page.evaluate(() => {
        const value: unknown = Reflect.get(window, 'cameraSteps');
        return Array.isArray(value) ? value.length : -1;
      });
    const animation = await ring.evaluate((element) => getComputedStyle(element).animationName);
    if (reducedMotion === 'reduce') {
      expect(animation).toBe('none');
      // The jump: once the camera stands still, it has taken one step (two at most).
      await cameraSettled(svg);
      const steps = await stepsSeen();
      expect(steps).toBeGreaterThanOrEqual(1);
      expect(steps).toBeLessThanOrEqual(2);
    } else {
      expect(animation).toBe('dg-pulse');
      // The glide: step after step, however slowly the frames come.
      await expect.poll(stepsSeen).toBeGreaterThan(3);
    }
  });
}

/** The camera's scale as the canvas reports it (`data-scale`, rounded to 0.001). */
async function scaleOf(page: Page): Promise<number> {
  return Number(await canvas(page).getAttribute('data-scale'));
}

/**
 * The focus indicator as rendered: the screen with focus where it is, against the same screen with focus taken off
 * (the camera stays), pixel by pixel. `best` is the largest contrast between the two renderings of one pixel,
 * `strong` the number of pixels that differ by 3 : 1 or more. Focus is put back afterwards.
 */
async function renderedFocusContrast(page: Page): Promise<{ best: number; strong: number }> {
  const focusedOne = page.locator(':focus');
  await expect(focusedOne).toHaveCount(1);
  await expect(focusedOne).toBeInViewport();
  const withFocus = PNG.sync.read(await page.screenshot());
  const element = await focusedOne.elementHandle();
  await page.evaluate(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement || active instanceof SVGElement) active.blur();
  });
  await expect(page.locator('svg.dg-canvas .dg-focus-ring')).toHaveAttribute('display', 'none');
  const without = PNG.sync.read(await page.screenshot());
  await element.evaluate((target) => {
    if (target instanceof HTMLElement || target instanceof SVGElement) target.focus({ preventScroll: true });
  });
  let best = 1;
  let strong = 0;
  for (let index = 0; index < withFocus.data.length; index += 4) {
    const a = relativeLuminance(
      withFocus.data[index] ?? 0,
      withFocus.data[index + 1] ?? 0,
      withFocus.data[index + 2] ?? 0,
    );
    const b = relativeLuminance(
      without.data[index] ?? 0,
      without.data[index + 1] ?? 0,
      without.data[index + 2] ?? 0,
    );
    const ratio = contrastRatio(a, b);
    if (ratio > best) best = ratio;
    if (ratio >= 3) strong += 1;
  }
  return { best, strong };
}

/** A focused item's on-screen box (CSS px). */
async function focusedBox(page: Page): Promise<{ width: number; height: number }> {
  const box = await page.locator(':focus').boundingBox();
  if (box === null) throw new Error('nothing focused on screen');
  return box;
}

for (const scheme of ['light', 'dark'] as const) {
  test(`${scheme}: the focus indicator stays visible on demo L zoomed out, and a keyboard move zooms in to read it`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await openDiagram(page, '/diagram#snapshot=demo:L&lens=compute&detail=all');
    await page.mouse.move(0, 0);
    const fitted = await scaleOf(page);
    expect(fitted).toBeLessThan(0.1);

    // The skip link: the top-left card, a few pixels wide; its ring keeps 2 px on screen with its gaps.
    await page.getByRole('link', { name: 'Skip to the diagram' }).focus();
    await page.keyboard.press('Enter');
    await expect(tabStop(page)).toBeFocused();
    const tiny = await focusedBox(page);
    expect(tiny.height).toBeLessThan(5);
    const atFit = await renderedFocusContrast(page);
    expect(atFit.best, 'at fit').toBeGreaterThanOrEqual(3);
    // A ring all around the card: at least its perimeter in pixels that change by 3 : 1 (the 2 px line lies across
    // pixel edges at this scale, so about one row of it changes fully, the rest is antialiased).
    expect(atFit.strong, 'at fit').toBeGreaterThanOrEqual(2 * (tiny.width + tiny.height));
    await closeUp(page, `L-fit-skip-${scheme}`);

    // An arrow: the camera zooms in to the scale subtitles are drawn at (0.55), the card in view.
    await page.keyboard.press('ArrowRight');
    expect(await cameraSettled(canvas(page))).toBeGreaterThanOrEqual(0.55);
    await expect(canvas(page)).not.toHaveClass(/dg-lod-nolabel/);
    await expect(canvas(page)).not.toHaveClass(/dg-lod-nosub/);
    const moved = await renderedFocusContrast(page);
    expect(moved.best, 'after an arrow').toBeGreaterThanOrEqual(3);
    expect((await focusedBox(page)).height).toBeGreaterThan(14);

    // `0` fits the drawing again; Escape there reaches the zone around (its collapse button; a keyboard move, so
    // the camera zooms in to the subtitle scale again), and the ring goes around the zone too.
    await page.keyboard.press('0');
    expect(await cameraSettled(canvas(page))).toBeCloseTo(fitted, 2);
    await page.keyboard.press('Escape');
    await expect(page.locator('svg.dg-canvas .dg-collapse:focus')).toHaveCount(1);
    await cameraSettled(canvas(page));
    const zoneFocus = await renderedFocusContrast(page);
    expect(zoneFocus.best, 'an open zone').toBeGreaterThanOrEqual(3);
    expect(zoneFocus.strong, 'an open zone').toBeGreaterThan(100);
    await closeUp(page, `L-zone-${scheme}`);
  });

  test(`${scheme}: a focused card in a project differs from its unfocused rendering by 3 : 1 at any scale`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme });
    // Demo M's compute lens at every detail: cards on the project tint, fitted at about 0.22.
    await openDiagram(page, '/diagram#snapshot=demo:M&lens=compute&detail=all');
    await page.mouse.move(0, 0);
    await page.getByRole('link', { name: 'Skip to the diagram' }).focus();
    await page.keyboard.press('Enter');
    // The tab stop (the top-left card) lies inside a project, on its tint.
    const inProject = await tabStop(page).evaluate((element) => {
      const card = element.getBoundingClientRect();
      return [...document.querySelectorAll('svg.dg-canvas .dg-zone')].some((zone) => {
        if (zone.getAttribute('aria-label')?.startsWith('Project: ') !== true) return false;
        const box = zone.getBoundingClientRect();
        return (
          box.left <= card.left && box.top <= card.top && box.right >= card.right && box.bottom >= card.bottom
        );
      });
    });
    expect(inProject).toBe(true);
    expect((await renderedFocusContrast(page)).best).toBeGreaterThanOrEqual(3);
    // Closer in, with the zoom keys: the ring grows with the drawing and still differs by 3 : 1.
    for (const key of ['+', '+', '+', '+', '+']) await page.keyboard.press(key);
    expect(await cameraSettled(canvas(page))).toBeGreaterThan(1);
    expect((await renderedFocusContrast(page)).best).toBeGreaterThanOrEqual(3);
    await closeUp(page, `M-compute-zoomed-${scheme}`);
  });
}

test('the zoom keys: + and - zoom about the focused item, 0 fits, and Ctrl+- is left to the browser', async ({
  page,
}) => {
  await recordPointer(page);
  await openDiagram(page, '/diagram#snapshot=demo:M');
  await page.getByRole('link', { name: 'Skip to the diagram' }).focus();
  await page.keyboard.press('Enter');
  const fitted = await cameraSettled(canvas(page));
  await page.keyboard.press('+');
  const closer = await cameraSettled(canvas(page));
  expect(closer).toBeCloseTo(fitted * 1.5, 2);
  await expect(page.locator(':focus')).toBeInViewport();
  await page.keyboard.press('=');
  expect(await cameraSettled(canvas(page))).toBeCloseTo(fitted * 2.25, 2);
  await page.keyboard.press('-');
  expect(await cameraSettled(canvas(page))).toBeCloseTo(closer, 2);
  // Ctrl+- is the browser's page zoom: the canvas leaves it alone (and stops nothing).
  const defaultPrevented = await page.evaluate(() => {
    const target = document.activeElement ?? document.body;
    const event = new KeyboardEvent('keydown', { key: '-', ctrlKey: true, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(defaultPrevented).toBe(false);
  expect(await cameraSettled(canvas(page))).toBeCloseTo(closer, 2);
  await page.keyboard.press('0');
  expect(await cameraSettled(canvas(page))).toBeCloseTo(fitted, 2);
  expect(await pointerEventsSeen(page)).toEqual([]);
});

test('[ and ] reach the timeline as German layouts type them: Option+5 on a Mac, AltGr+8 on a PC', async ({
  page,
}) => {
  await openDiagram(page, DEMO_S);
  await expect(page.getByRole('region', { name: 'Timeline' })).toHaveAttribute('data-ready', 'true');
  const status = page.getByTestId('timeline-keys-status');
  interface KeyInit {
    readonly key: string;
    readonly code?: string;
    readonly altKey?: boolean;
    readonly ctrlKey?: boolean;
    readonly metaKey?: boolean;
    readonly modifierAltGraph?: boolean;
  }
  const press = (init: KeyInit): Promise<void> =>
    page.evaluate((options: KeyInit) => {
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { ...options, bubbles: true, cancelable: true }),
      );
    }, init);
  // macOS German: Option+5 types `[` (altKey): one day back.
  await press({ key: '[', code: 'Digit5', altKey: true });
  await expect.poll(() => hashOf(page)).toBe('#snapshot=demo:S&tick=2026-10-07');
  // Windows German: AltGr+8 types `]`, reported as Ctrl+Alt with the AltGraph modifier: back to the last day,
  // the snapshot itself (no tick); once more, and the timeline cannot move: the status says why, once per press.
  await press({ key: ']', code: 'Digit9', ctrlKey: true, altKey: true, modifierAltGraph: true });
  await expect.poll(() => hashOf(page)).toBe('#snapshot=demo:S');
  await press({ key: ']', code: 'Digit9', ctrlKey: true, altKey: true, modifierAltGraph: true });
  await expect(status).toHaveText(/^This is the latest day of the timeline/);
  const first = await status.locator('span').getAttribute('data-count');
  await press({ key: ']', code: 'Digit9', ctrlKey: true, altKey: true, modifierAltGraph: true });
  await expect(status.locator('span')).not.toHaveAttribute('data-count', first ?? '');
  // A US layout's plain key, and not Cmd+[ (the browser's Back).
  await page.locator('main').focus();
  await page.keyboard.press('[');
  await expect.poll(() => hashOf(page)).toBe('#snapshot=demo:S&tick=2026-10-07');
  await press({ key: '[', metaKey: true });
  expect(hashOf(page)).toBe('#snapshot=demo:S&tick=2026-10-07');
});

test('focus after a drill-in from the drawer goes to the new view, and after a drill-out to the current crumb', async ({
  page,
}) => {
  await recordPointer(page);
  // A VM selected in the link: the skip link lands on it (the tab stop), Escape clears the selection.
  await openDiagram(
    page,
    `${DEMO_S}&selection=//compute.googleapis.com/projects/demo-web-1/zones/europe-west3-a/instances/web-1mnl`,
  );
  await page.getByRole('link', { name: 'Skip to the diagram' }).focus();
  await page.keyboard.press('Enter');
  expect((await focused(page)).name).toMatch(/: web-1mnl$/);
  // Out to its project (Escape, zone by zone), select it with its menu, close the menu: the drawer is open.
  let project: Focused | null = null;
  for (let presses = 0; presses < 6 && project === null; presses += 1) {
    await page.keyboard.press('Escape');
    const at = await focused(page);
    if (at.name.startsWith('Collapse Project: ')) project = at;
  }
  if (project === null) throw new Error('Escape never reached a project');
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  const drawer = page.getByRole('complementary', { name: 'Details' });
  await expect(drawer).toBeVisible();
  // The drawer's "Drill in", by keyboard.
  await tabTo(page, (at) => at.name === 'Details');
  await page.keyboard.press('Enter');
  await expect.poll(() => hashOf(page)).toContain('root=');
  await expect(tabStop(page)).toBeFocused({ timeout: 30_000 });
  await expect(canvas(page)).not.toHaveAttribute('data-focus-parked', 'true');

  // Back out with the breadcrumb's scope crumb: it becomes the current crumb (no button) and takes focus.
  const scope = page.getByRole('navigation', { name: 'Scope' });
  await tabTo(page, (at) => at.name === 'example.com' && at.tag === 'button', { backwards: true });
  await page.keyboard.press('Enter');
  await expect.poll(() => hashOf(page)).not.toContain('root=');
  const current = scope.locator('[tabindex="-1"]');
  await expect(current).toBeFocused();
  await expect(current).toHaveText('example.com');
  // Its ring is drawn whole: the breadcrumb's clipped box leaves room for it.
  const clip = await scope.evaluate((nav) => {
    const box = nav.getBoundingClientRect();
    const crumb = nav.querySelector('[tabindex="-1"]')?.getBoundingClientRect();
    return crumb === undefined ? null : { left: crumb.left - box.left, top: crumb.top - box.top };
  });
  expect(clip?.left).toBeGreaterThanOrEqual(4);
  expect(clip?.top).toBeGreaterThanOrEqual(4);
  await shot(page, 'breadcrumb-drill-out');
  await expectNoAxeViolations(page);
  // The next Tab carries on in the top bar.
  await page.keyboard.press('Tab');
  expect((await focused(page)).inCanvas).toBe(false);
  expect(await pointerEventsSeen(page)).toEqual([]);
});
