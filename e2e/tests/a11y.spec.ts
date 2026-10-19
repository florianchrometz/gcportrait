// SPDX-License-Identifier: Apache-2.0
import { expect, test, type Locator, type Page } from '@playwright/test';

import { detailsDrawer, expectNoAxeViolations, openDiagram } from './support.js';

/**
 * axe-core (all non-experimental rules, best practices included) on every page of the app in demo mode, in
 * light and dark (WCAG 2.2 AA; AGENTS.md, Style and accessibility; e2e/AGENTS.md, Widths, gestures and axe;
 * the gcp-diagram-style skill's accessibility rules): the Connect, Diagram (empty), Snapshots,
 * Settings and not-found pages;
 * the diagram with demo organisations S, M and L drawn, at rest, with the keyboard inside a zone, and with a
 * node's menu and the details drawer open; the Snapshot menu open. Every node of each drawing is a named
 * control or graphics object (type + label), and the lines are hidden from assistive technology. The
 * live-mode Connect page is checked in live.spec.ts; the other popups and dialogs in their own specs
 * (controls, with the Lens list; search, drawer, export, snapshots, disclosure).
 */
const PAGES = [
  { path: '/', heading: 'Connect' },
  { path: '/diagram', heading: 'Diagram' },
  { path: '/snapshots', heading: 'Snapshots' },
  { path: '/settings', heading: 'Settings' },
  { path: '/no-such-page', heading: 'Page not found' },
] as const;

const SIZES = ['S', 'M', 'L'] as const;

// Demo L is generated and laid out in the browser; a cold dev server compiles the workers first.
test.describe.configure({ timeout: 120_000 });

/** Moves focus to the drawing's tab stop the way a keyboard user does: the skip link. */
async function skipToDiagram(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Skip to the diagram' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('svg.dg-canvas :focus')).toHaveCount(1);
}

/** Every solid node is a named button ("Type: label"), every open zone a named graphics object; lines are hidden. */
async function expectNamedNodes(svg: Locator): Promise<void> {
  const report = await svg.evaluate((element) => {
    const nodes = [...element.querySelectorAll('.dg-node')];
    const zones = [...element.querySelectorAll('.dg-zone')];
    const unnamed = [...nodes, ...zones]
      .filter((node) => !/^[^:]+: \S/.test(node.getAttribute('aria-label') ?? ''))
      .map((node) => node.getAttribute('data-id'));
    return {
      nodes: nodes.length,
      buttons: nodes.filter((node) => node.getAttribute('role') === 'button').length,
      zones: zones.length,
      objects: zones.filter((zone) => zone.getAttribute('role') === 'graphics-object').length,
      unnamed,
      linesHidden: [...element.querySelectorAll('.dg-edges, .dg-edges-top')].every(
        (group) => group.getAttribute('aria-hidden') === 'true',
      ),
    };
  });
  expect(report.nodes + report.zones).toBeGreaterThan(0);
  expect(report.buttons).toBe(report.nodes);
  expect(report.objects).toBe(report.zones);
  expect(report.unnamed).toEqual([]);
  expect(report.linesHidden).toBe(true);
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    for (const { path, heading } of PAGES) {
      test(`axe reports no violations on ${path}`, async ({ page }) => {
        await page.goto(path);
        await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
        await expect(page.getByRole('heading', { level: 1, name: heading })).toBeAttached();
        await expectNoAxeViolations(page);
      });
    }

    for (const size of SIZES) {
      test(`axe reports no violations on the diagram with demo ${size} drawn: at rest, in a zone, with a menu and the drawer open`, async ({
        page,
      }) => {
        const svg = await openDiagram(page, `/diagram#snapshot=demo:${size}`);
        await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
        await expectNamedNodes(svg);
        await expectNoAxeViolations(page);

        // The keyboard inside the drawing: an arrow, then Escape out to the zone around (its collapse button).
        await skipToDiagram(page);
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('Escape');
        await expect(svg.locator('.dg-collapse:focus')).toHaveCount(1);
        await expectNoAxeViolations(page);

        // A node's menu (Shift+F10) selects it: the drawer opens beside the menu.
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Shift+F10');
        await expect(page.getByRole('menu')).toBeVisible();
        await expect(detailsDrawer(page)).toBeVisible();
        await expectNoAxeViolations(page);
        await page.keyboard.press('Escape');
        await expect(page.getByRole('menu')).toHaveCount(0);
        await expectNoAxeViolations(page);
      });
    }

    test('axe reports no violations with the Snapshot menu open', async ({ page }) => {
      await openDiagram(page, '/diagram#snapshot=demo:M');
      const banner = page.getByRole('banner');
      await banner.getByRole('button', { name: 'Snapshot' }).click();
      await expect(page.getByRole('menu', { name: 'Snapshot' })).toBeVisible();
      await expectNoAxeViolations(page);
    });
  });
}
