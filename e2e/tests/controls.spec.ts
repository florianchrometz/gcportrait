// SPDX-License-Identifier: MIT
import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  DEMO_M_DIAGRAM,
  drawingOf,
  drawnCanvas,
  expectNoAxeViolations,
  hashOf,
  openDiagram,
  redrawnCanvas,
  scratchShot,
} from './support.js';

/**
 * The top bar's view controls (the ViewSpec of @gcportrait/model; docs/lenses-and-filters.md) on demo
 * organisation M: each control writes the view into the URL hash as expected, and reloading that URL restores
 * it (the hash is the only state of a view). Lens (and the default-detail rule), detail, focus with its
 * parameter pickers, every filter, the breadcrumb's drill-in trail (and double-click drill-in), the Snapshot
 * menu, Copy link, saved views (IndexedDB, across a reload). Filters apply under a drill-in and under a focus
 * (filters, focus views and drill-in compose; AGENTS.md, Product rules). Axe on the open popovers and the
 * dialog in both themes.
 */

const FOLDERS = '//cloudresourcemanager.googleapis.com/folders/';
/** Workloads › Retail › Production in demo M. */
const WORKLOADS = `${FOLDERS}20000000005`;
const RETAIL = `${FOLDERS}20000000006`;
const RETAIL_PROD = `${FOLDERS}20000000007`;
const STOREFRONT = '//apphub.googleapis.com/projects/demo-mgmt-1/locations/global/applications/storefront';
const PERIMETER =
  '//accesscontextmanager.googleapis.com/accessPolicies/40000000001/servicePerimeters/data_perimeter';
const VM_CARDS = 'g.dg-node[aria-label^="Compute Engine instance: "]';

/** Waits until the view hash, decoded and without its `#`, is `expected`. */
async function expectHash(page: Page, expected: string): Promise<void> {
  await expect.poll(() => hashOf(page)).toBe(`#${expected}`);
}

function banner(page: Page): Locator {
  return page.getByRole('banner');
}

/** Reloads the page and waits for the diagram to be drawn again. */
async function reload(page: Page): Promise<Locator> {
  await page.reload();
  return drawnCanvas(page);
}

/**
 * Waits until the view in the hash is the one on screen: a drawing after `previous` (`drawingOf`, read before the view
 * changes) is on the canvas, and no request of the pipeline is pending. The page's loading line ("Building the view…",
 * "Laying out the diagram…") shows while a request is pending and goes in the commit that puts its drawing up, but it
 * is also absent before the pipeline has marked the last change's request pending, while the drawing from before the
 * changes is still on the canvas, ready: the number tells that drawing from a later one. The loading line in turn
 * tells the last change's drawing from one of an earlier change that came first, when several changes followed
 * `previous`.
 */
async function pipelineIdle(page: Page, previous: string): Promise<void> {
  await redrawnCanvas(page, previous);
  const pending = page.locator('section[aria-label="Diagram canvas"] [role="status"]', { hasText: '…' });
  await expect(pending).toHaveCount(0, { timeout: 60_000 });
}

async function chooseLens(page: Page, title: string): Promise<void> {
  await banner(page).getByRole('combobox', { name: 'Lens' }).click();
  await page.getByRole('listbox', { name: 'Lens' }).getByRole('option', { name: title, exact: true }).click();
}

function detail(page: Page): Locator {
  return banner(page).getByRole('radiogroup', { name: 'Detail' });
}

function focusButton(page: Page): Locator {
  return banner(page).getByRole('button', { name: /^Focus/ });
}

/** Opens the Focus popover (unless open) and chooses a kind. */
async function chooseFocusKind(page: Page, kind: string): Promise<Locator> {
  const popover = page.getByRole('dialog', { name: 'Focus' });
  if (!(await popover.isVisible())) await focusButton(page).click();
  await popover.getByRole('combobox', { name: 'Show' }).click();
  await popover.getByRole('option', { name: kind, exact: true }).click();
  return popover;
}

/** Picks a parameter in the Focus popover: types, then chooses the result named `name`. */
async function pickFocus(page: Page, field: string, text: string, name: string): Promise<void> {
  const input = page
    .getByRole('dialog', { name: 'Focus' })
    .getByRole('combobox', { name: `${field} to focus on` });
  await expect(input).not.toHaveAttribute('aria-disabled', 'true');
  await input.fill(text);
  await page.getByRole('option', { name, exact: true }).click();
}

function filtersButton(page: Page): Locator {
  return banner(page).getByRole('button', { name: /^Filters/ });
}

async function openFilters(page: Page): Promise<Locator> {
  await filtersButton(page).click();
  const dialog = page.getByRole('dialog', { name: 'Filters' });
  await expect(dialog.getByRole('combobox', { name: 'Add to regions' })).not.toHaveAttribute(
    'aria-disabled',
    'true',
  );
  return dialog;
}

/** Adds a value through one of the Filters popover's pickers. */
async function pickFilter(dialog: Locator, field: string, text: string, name: string): Promise<void> {
  await dialog.getByRole('combobox', { name: `Add to ${field}` }).fill(text);
  await dialog.getByRole('option', { name, exact: true }).click();
}

function scope(page: Page): Locator {
  return banner(page).getByRole('navigation', { name: 'Scope' });
}

test('the Lens picker opens a lens at auto, no deeper than its default; a chosen level stays; a reload restores both', async ({
  page,
}) => {
  await openDiagram(page, DEMO_M_DIAGRAM);
  await chooseLens(page, 'Networking');
  // The lens's default detail is the ceiling of auto, so the lens opens readable at any canvas size.
  await expectHash(page, 'snapshot=demo:M&lens=networking');
  await expect(page.locator('svg.dg-canvas > title')).toHaveText(
    'gcportrait diagram of example.com, Networking lens',
    { timeout: 30_000 },
  );
  const auto = detail(page).getByRole('radio', { name: /^Auto · / });
  await expect(auto).toHaveAttribute('aria-checked', 'true');
  await expect(auto).toHaveText(/^Auto · (folders|projects|networks)$/);
  await reload(page);
  await expect(banner(page).getByRole('combobox', { name: 'Lens' })).toContainText('Networking');
  await expect(detail(page).getByRole('radio', { name: /^Auto · / })).toHaveAttribute('aria-checked', 'true');

  // A level chosen against the lens's default stays across lens switches.
  await detail(page).getByRole('radio', { name: 'Projects' }).click();
  await chooseLens(page, 'Compute');
  await expectHash(page, 'snapshot=demo:M&lens=compute&detail=projects');
  await reload(page);
  await expect(banner(page).getByRole('combobox', { name: 'Lens' })).toContainText('Compute');
  await expect(detail(page).getByRole('radio', { name: 'Projects' })).toHaveAttribute('aria-checked', 'true');

  // The lens's own default level (as a link may hold it) follows the lens: the next switch opens at auto.
  await detail(page).getByRole('radio', { name: 'Networks' }).click();
  await expectHash(page, 'snapshot=demo:M&lens=compute&detail=networks');
  await chooseLens(page, 'Data');
  await expectHash(page, 'snapshot=demo:M&lens=data');
});

test('the detail control writes the level, names the one auto picked, and a reload restores it', async ({
  page,
}) => {
  await openDiagram(page, DEMO_M_DIAGRAM);
  // At 1440 × 900 demo M opens at the folder level (gcp-diagram-layout skill §6).
  await expect(detail(page).getByRole('radio', { name: /^Auto · / })).toHaveAttribute('aria-checked', 'true');
  const auto =
    (await detail(page)
      .getByRole('radio', { name: /^Auto · / })
      .textContent()) ?? '';
  expect(auto).toMatch(/Auto · (folders|projects|networks|all)$/);
  const atAuto = await drawingOf(page);
  await detail(page).getByRole('radio', { name: 'Networks' }).click();
  await expectHash(page, 'snapshot=demo:M&detail=networks');
  await page.keyboard.press('ArrowRight');
  await expectHash(page, 'snapshot=demo:M&detail=all');
  await expect(detail(page).getByRole('radio', { name: 'All' })).toBeFocused();
  await pipelineIdle(page, atAuto);
  await reload(page);
  await expect(detail(page).getByRole('radio', { name: 'All' })).toHaveAttribute('aria-checked', 'true');
  await page.goBack();
  await expectHash(page, 'snapshot=demo:M&detail=networks');
});

test('the Focus control picks a project, a host, a perimeter, an application and standalone projects; a reload restores it', async ({
  page,
}) => {
  await openDiagram(page, DEMO_M_DIAGRAM);
  const unfocused = await drawingOf(page);
  await chooseFocusKind(page, 'Single project');
  await pickFocus(page, 'Project', 'retail web', 'demo-web-1');
  await expectHash(page, 'snapshot=demo:M&focus=project&focus.project=demo-web-1');
  await expect(focusButton(page)).toHaveText(/^Focus: demo-web-1/);
  await pipelineIdle(page, unfocused);
  await reload(page);
  await expect(focusButton(page)).toHaveText(/^Focus: demo-web-1/);

  const project = await drawingOf(page);
  await chooseFocusKind(page, 'Shared VPC');
  await pickFocus(page, 'Host project', 'non-production', 'demo-net-2');
  await expectHash(page, 'snapshot=demo:M&focus=shared-vpc&focus.host=demo-net-2');

  await chooseFocusKind(page, 'Perimeter');
  await pickFocus(page, 'Perimeter', 'data', 'data_perimeter');
  await expectHash(page, `snapshot=demo:M&focus=perimeter&focus.perimeter=${PERIMETER}`);
  await expect(focusButton(page)).toHaveText(/^Focus: data_perimeter/);

  await chooseFocusKind(page, 'Application');
  await pickFocus(page, 'Application', 'app hub storefront', 'Storefront');
  await expectHash(page, `snapshot=demo:M&focus=application&focus.application=${STOREFRONT}`);
  await pipelineIdle(page, project);
  await reload(page);
  await expect(focusButton(page)).toHaveText(/^Focus: Storefront/);

  await chooseFocusKind(page, 'Standalone projects');
  await expectHash(page, 'snapshot=demo:M&focus=standalone-projects');
  await expect(page.getByRole('dialog', { name: 'Focus' })).toBeHidden();

  await focusButton(page).click();
  await page.getByRole('dialog', { name: 'Focus' }).getByRole('button', { name: 'Clear focus' }).click();
  await expectHash(page, 'snapshot=demo:M');
  await expect(focusButton(page)).toBeFocused();
});

test('the Filters popover writes every filter, counts them, a reload restores them, and Reset clears them', async ({
  page,
}) => {
  await openDiagram(page, DEMO_M_DIAGRAM);
  const unfiltered = await drawingOf(page);
  const dialog = await openFilters(page);
  for (const name of ['Empty projects', 'Empty folders', 'Disconnected resources']) {
    await dialog.getByRole('checkbox', { name }).check();
  }
  await expectHash(page, 'snapshot=demo:M&hide=empty-projects,empty-folders,disconnected');
  await pickFilter(dialog, 'regions', 'europe', 'europe-west3');
  await pickFilter(dialog, 'projects', 'retail web', 'demo-web-1');
  await pickFilter(dialog, 'folders', 'workloads', 'Workloads');
  await pickFilter(dialog, 'include types', 'service account', 'iam.googleapis.com/ServiceAccount');
  await pickFilter(dialog, 'exclude types', 'compute.googleapis.com/disk', 'compute.googleapis.com/Disk');
  // The depth slider reads shallow to deep, "No limit" at its right end: Home is depth 1, then one step.
  const depth = dialog.getByRole('slider', { name: 'Depth' });
  await expect(depth).toHaveAttribute('aria-valuetext', 'No limit');
  await depth.focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await expect(depth).toHaveAttribute('aria-valuetext', '2 levels below the root');
  await dialog.getByRole('radiogroup', { name: 'Region zones' }).getByRole('radio', { name: 'Show' }).click();
  await dialog.getByRole('radiogroup', { name: 'Identities' }).getByRole('radio', { name: 'Hide' }).click();
  const all =
    'snapshot=demo:M&hide=empty-projects,empty-folders,disconnected&regions=europe-west3&projects=demo-web-1' +
    `&folders=20000000005&include=iam.googleapis.com/ServiceAccount&exclude=compute.googleapis.com/Disk` +
    '&depth=2&show-regions=1&show-identities=0';
  await expectHash(page, all);
  await expect(filtersButton(page)).toHaveAccessibleName('Filters (11 active)');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(filtersButton(page)).toBeFocused();

  await pipelineIdle(page, unfiltered);
  await reload(page);
  expect(hashOf(page)).toBe(`#${all}`);
  await expect(filtersButton(page)).toHaveAccessibleName('Filters (11 active)');
  const restored = await openFilters(page);
  for (const name of ['Empty projects', 'Empty folders', 'Disconnected resources']) {
    await expect(restored.getByRole('checkbox', { name })).toBeChecked();
  }
  await expect(restored.getByRole('list', { name: 'Regions chosen' })).toHaveText(/europe-west3/);
  await expect(restored.getByRole('list', { name: 'Projects chosen' })).toHaveText(/demo-web-1/);
  await expect(restored.getByRole('list', { name: 'Folders chosen' })).toHaveText(/Workloads/);
  await expect(restored.getByRole('list', { name: 'Include types chosen' })).toHaveText(
    /iam\.googleapis\.com\/ServiceAccount/,
  );
  await expect(restored.getByRole('list', { name: 'Exclude types chosen' })).toHaveText(
    /compute\.googleapis\.com\/Disk/,
  );
  await expect(restored.getByRole('slider', { name: 'Depth' })).toHaveAttribute('aria-valuenow', '2');
  await expect(
    restored.getByRole('radiogroup', { name: 'Region zones' }).getByRole('radio', { name: 'Show' }),
  ).toHaveAttribute('aria-checked', 'true');
  await expect(
    restored.getByRole('radiogroup', { name: 'Identities' }).getByRole('radio', { name: 'Hide' }),
  ).toHaveAttribute('aria-checked', 'true');

  await restored.getByRole('button', { name: 'Remove europe-west3 from regions' }).click();
  await expect.poll(() => hashOf(page)).not.toContain('&regions=');
  await restored.getByRole('button', { name: 'Reset filters' }).click();
  await expectHash(page, 'snapshot=demo:M');
  await expect(filtersButton(page)).toHaveAccessibleName('Filters');
});

test('filters apply under a drill-in and under a focus', async ({ page }) => {
  // Drilled into Workloads: the compute lens draws VMs; excluding their type from the popover removes them all,
  // and the drill-in stays.
  const svg = await openDiagram(page, `/diagram#snapshot=demo:M&lens=compute&detail=all&root=${WORKLOADS}`);
  await expect.poll(() => svg.locator(VM_CARDS).count(), { timeout: 30_000 }).toBeGreaterThan(0);
  const withVms = await drawingOf(page);
  let dialog = await openFilters(page);
  await pickFilter(
    dialog,
    'exclude types',
    'compute.googleapis.com/instance',
    'compute.googleapis.com/Instance',
  );
  await expectHash(
    page,
    `snapshot=demo:M&lens=compute&root=${WORKLOADS}&detail=all&exclude=compute.googleapis.com/Instance`,
  );
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await pipelineIdle(page, withVms);
  await expect(svg.locator(VM_CARDS)).toHaveCount(0);
  await expect(scope(page).getByRole('listitem')).toHaveText(['example.com', 'Workloads']);

  // Under a Shared VPC focus: the region filter keeps only us-central1's resources, and hiding empty projects
  // then drops the projects left without any.
  // A page loaded afresh (about:blank first): its first drawing is this view's, so the counts below are read at once.
  await page.goto('about:blank');
  await openDiagram(
    page,
    '/diagram#snapshot=demo:M&lens=compute&detail=all&focus=shared-vpc&focus.host=demo-net-1',
  );
  const projects = svg.locator('g.dg-zone[aria-label^="Project: "]');
  const before = await projects.count();
  const vmsBefore = await svg.locator(VM_CARDS).count();
  expect(vmsBefore).toBeGreaterThan(0);
  const allRegions = await drawingOf(page);
  dialog = await openFilters(page);
  await pickFilter(dialog, 'regions', 'us-central', 'us-central1');
  await dialog.getByRole('checkbox', { name: 'Empty projects' }).check();
  await expectHash(
    page,
    'snapshot=demo:M&lens=compute&focus=shared-vpc&focus.host=demo-net-1&detail=all&hide=empty-projects&regions=us-central1',
  );
  await page.keyboard.press('Escape');
  await pipelineIdle(page, allRegions);
  await expect.poll(() => projects.count()).toBeLessThan(before);
  await expect.poll(() => svg.locator(VM_CARDS).count()).toBeLessThan(vmsBefore);
  await expect(focusButton(page)).toHaveText(/^Focus: demo-net-1/);
});

test('the breadcrumb shows the drill-in trail, its crumbs drill out, a double-click drills in, and a reload restores it', async ({
  page,
}) => {
  const svg = await openDiagram(page, DEMO_M_DIAGRAM);
  await expect(scope(page)).toHaveText('example.com');
  // A double-click on an open folder (in its body's padding, clear of its children) drills into it.
  const workloads = svg.locator(`g.dg-zone[data-id="${WORKLOADS}"]`);
  const body = workloads.locator('.dg-body').first();
  const box = await body.boundingBox();
  if (box === null) throw new Error('the folder has no box');
  await page.mouse.dblclick(box.x + 4, box.y + box.height - 4);
  await expectHash(page, `snapshot=demo:M&root=${WORKLOADS}`);
  await expect(scope(page).getByRole('listitem')).toHaveText(['example.com', 'Workloads']);
  await expect(scope(page).getByRole('listitem').last()).toHaveAttribute('aria-current', 'location');

  await page.goto('about:blank');
  await openDiagram(page, `/diagram#snapshot=demo:M&root=${RETAIL_PROD}`);
  await expect(scope(page).getByRole('listitem')).toHaveText([
    'example.com',
    'Workloads',
    'Retail',
    'Production',
  ]);
  await scope(page).getByRole('button', { name: 'Retail' }).click();
  await expectHash(page, `snapshot=demo:M&root=${RETAIL}`);
  await expect(scope(page).getByRole('listitem')).toHaveText(['example.com', 'Workloads', 'Retail']);
  await scope(page).getByRole('button', { name: 'example.com' }).click();
  await expectHash(page, 'snapshot=demo:M');
  await expect(scope(page)).toHaveText('example.com');
  await page.goBack();
  await expectHash(page, `snapshot=demo:M&root=${RETAIL}`);
});

test('the Snapshot menu says which snapshot is open, switches snapshots and opens the Snapshots page', async ({
  page,
}) => {
  await openDiagram(page, '/diagram#snapshot=demo:M&lens=networking&detail=all');
  const button = banner(page).getByRole('button', { name: 'Snapshot' });
  await button.click();
  const menu = page.getByRole('menu', { name: 'Snapshot' });
  await expect(menu.getByRole('menuitem').first()).toHaveText(
    'Open: example.com · read 2026-10-08 00:00 UTC · demo organisation',
  );
  await expect(menu.getByRole('menuitemradio', { name: 'Demo organisation M (medium)' })).toBeFocused();
  await menu.getByRole('menuitemradio', { name: 'Demo organisation S (small)' }).click();
  await expectHash(page, 'snapshot=demo:S&lens=networking&detail=all');
  await reload(page);
  await button.click();
  await expect(menu.getByRole('menuitemradio', { name: 'Demo organisation S (small)' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await menu.getByRole('menuitem', { name: 'Snapshots page' }).click();
  await expect(page).toHaveURL(/\/snapshots$/);
});

test('Copy link copies the URL with the view’s hash and says so', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openDiagram(page, `/diagram#snapshot=demo:M&lens=data&root=${WORKLOADS}`);
  await banner(page).getByRole('button', { name: 'Copy link' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Link copied to the clipboard.' })).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe(page.url());
  // The link opens the same view.
  const other = await context.newPage();
  await other.goto(copied);
  await drawnCanvas(other);
  await expect(other.getByRole('banner').getByRole('combobox', { name: 'Lens' })).toContainText('Data');
  await expect(other.getByRole('banner').getByRole('navigation', { name: 'Scope' })).toHaveText(/Workloads/);
});

test('saved views are saved in IndexedDB, survive a reload, apply, rename and delete', async ({ page }) => {
  const saved = `snapshot=demo:M&lens=networking&focus=shared-vpc&focus.host=demo-net-1&detail=networks`;
  await openDiagram(page, `/diagram#${saved}`);
  const views = banner(page).getByRole('button', { name: 'Saved views' });
  await views.click();
  let dialog = page.getByRole('dialog', { name: 'Saved views' });
  await dialog.getByRole('textbox', { name: 'Name' }).fill('Prod networks');
  await dialog.getByRole('button', { name: 'Save current view' }).click();
  await expect(dialog.getByRole('status')).toHaveText('Saved “Prod networks”.');
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(views).toBeFocused();

  // Stored in the browser's database, and listed after a reload.
  const stored = await page.evaluate(
    () =>
      new Promise<unknown>((resolve, reject) => {
        const request = indexedDB.open('gcportrait');
        request.onerror = () => {
          reject(new Error('no database'));
        };
        request.onsuccess = () => {
          const read = request.result.transaction('savedViews').objectStore('savedViews').getAll();
          read.onsuccess = () => {
            resolve(read.result);
          };
        };
      }),
  );
  expect(stored).toEqual([
    expect.objectContaining({ name: 'Prod networks', viewSpecHash: expect.any(String) }),
  ]);
  await chooseLens(page, 'Data');
  await reload(page);
  await views.click();
  dialog = page.getByRole('dialog', { name: 'Saved views' });
  await dialog.getByRole('button', { name: 'Apply Prod networks' }).click();
  await expectHash(page, saved);

  await views.click();
  await dialog.getByRole('button', { name: 'Rename Prod networks' }).click();
  await dialog.getByRole('textbox', { name: 'New name for Prod networks' }).fill('Production networks');
  await page.keyboard.press('Enter');
  await expect(dialog.getByRole('status')).toHaveText('Renamed “Prod networks” to “Production networks”.');
  await page.keyboard.press('Escape');
  await reload(page);
  await views.click();
  await dialog.getByRole('button', { name: 'Delete Production networks' }).click();
  await expect(dialog.getByText('No saved views yet.')).toBeVisible();
  await reload(page);
  await views.click();
  await expect(dialog.getByText('No saved views yet.')).toBeVisible();
});

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    test('axe finds nothing with the Focus and Filters popovers, the Lens list and the Saved views dialog open', async ({
      page,
    }) => {
      await openDiagram(page, `/diagram#snapshot=demo:M&root=${RETAIL_PROD}&hide=empty-projects`);
      await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
      await expectNoAxeViolations(page);
      await scratchShot(page, 'controls', `topbar-${scheme}`, {
        clip: { x: 0, y: 0, width: 1440, height: 110 },
      });

      await chooseFocusKind(page, 'Single project');
      const input = page
        .getByRole('dialog', { name: 'Focus' })
        .getByRole('combobox', { name: 'Project to focus on' });
      await expect(input).not.toHaveAttribute('aria-disabled', 'true');
      await input.press('ArrowDown');
      await expect(page.getByRole('option').first()).toBeVisible();
      await expectNoAxeViolations(page);
      await scratchShot(page, 'controls', `focus-${scheme}`);
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');

      const dialog = await openFilters(page);
      await dialog.getByRole('combobox', { name: 'Add to include types' }).fill('cloud run');
      await expect(dialog.getByRole('option').first()).toBeVisible();
      await expectNoAxeViolations(page);
      await scratchShot(page, 'controls', `filters-${scheme}`);
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');

      await banner(page).getByRole('combobox', { name: 'Lens' }).click();
      await expect(page.getByRole('listbox', { name: 'Lens' })).toBeVisible();
      await expectNoAxeViolations(page);
      await scratchShot(page, 'controls', `lens-${scheme}`);
      await page.keyboard.press('Escape');

      await banner(page).getByRole('button', { name: 'Saved views' }).click();
      await expect(page.getByRole('dialog', { name: 'Saved views' })).toBeVisible();
      await expectNoAxeViolations(page);
      await scratchShot(page, 'controls', `saved-views-${scheme}`);
    });
  });
}
