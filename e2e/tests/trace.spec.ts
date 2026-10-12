// SPDX-License-Identifier: MIT
import { expect, test, type Locator } from '@playwright/test';

import { hashOf, openDiagram } from './support.js';

/**
 * The selection trace (gcp-diagram-style skill §6, the "Select" state) in a real browser, on demo organisation M:
 * selecting a VM keeps its path to the root and its NIC/subnet and disk lines highlighted; selecting a global
 * forwarding rule keeps its load balancer's chain to the backend instance groups and network endpoint groups
 * highlighted; both persist until the selection changes (across zoom and hover), and hover previews a trace
 * without changing the selection. What the trace paints is read from the classes the painter sets: `.is-path`
 * on the zones to the root, `.is-focus` on the traced copies of the lines (keyed `<from> -<kind>-> <to>`),
 * `.is-reached` on the nodes the trace reaches.
 */

const VM = '//compute.googleapis.com/projects/demo-vm-1/zones/europe-west3-a/instances/bastion';
const RULE = '//compute.googleapis.com/projects/demo-web-1/global/forwardingRules/web-https-fr';
const WEB = '//compute.googleapis.com/projects/demo-web-1';

/** demo M, every zone open, in a lens that draws what the trace is about. */
const COMPUTE_ALL = '/diagram#snapshot=demo:M&lens=compute&detail=all';
const LOAD_BALANCING_ALL = '/diagram#snapshot=demo:M&lens=load-balancing&detail=all';

function node(svg: Locator, id: string): Locator {
  return svg.locator(`[data-id="${id}"]`);
}

/** The keys of the traced lines on screen. */
async function traced(svg: Locator): Promise<string[]> {
  const keys = await svg
    .locator('.dg-edge-top.is-focus')
    .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-edge') ?? ''));
  return keys.sort();
}

async function ids(svg: Locator, selector: string): Promise<string[]> {
  const found = await svg
    .locator(selector)
    .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-id') ?? ''));
  return found.sort();
}

/** The accessible names of the zones on the path to the root. */
async function pathNames(svg: Locator): Promise<string[]> {
  return svg
    .locator('.dg-zone.is-path')
    .evaluateAll((elements) => elements.map((element) => element.getAttribute('aria-label') ?? ''));
}

test('selecting a VM highlights its path to the root and its NIC, subnet and disk lines', async ({
  page,
}) => {
  const svg = await openDiagram(page, COMPUTE_ALL);
  const vm = node(svg, VM);
  await vm.click();
  await expect(vm).toHaveAttribute('aria-pressed', 'true');

  // The path to the root: every zone around it, up to a top-level folder, each with a ring on its border.
  const names = await pathNames(svg);
  expect(names.some((name) => name.startsWith('Project: '))).toBe(true);
  expect(names.some((name) => name.startsWith('Folder: '))).toBe(true);
  const zones = await svg.locator('.dg-zone.is-path').count();
  await expect(svg.locator('.dg-path-ring:not([display])')).toHaveCount(zones);
  // The VM itself carries the selection ring, not a path ring.
  await expect(vm).not.toHaveClass(/is-path/);
  await expect(svg.locator('.dg-select-ring')).not.toHaveAttribute('display', 'none');

  // Its lines: the NIC's subnet and its disk, drawn again on top.
  const lines = await traced(svg);
  expect(lines.some((key) => key.startsWith(`${VM} -attaches-> `) && key.includes('/subnetworks/'))).toBe(
    true,
  );
  expect(lines.some((key) => key.startsWith(`${VM} -uses-> `) && key.includes('/disks/'))).toBe(true);
  for (const key of lines) expect(key.includes(VM), key).toBe(true);
  const reached = await ids(svg, '.is-reached');
  expect(reached.some((id) => id.includes('/subnetworks/'))).toBe(true);
  expect(reached.some((id) => id.includes('/disks/'))).toBe(true);
  // The legend explains it while something is selected.
  await expect(svg.locator('.dg-legend-trace')).not.toHaveAttribute('display', 'none');
  await expect(svg.locator('.dg-legend-trace')).toContainText('path to root');
});

test('selecting a global forwarding rule highlights the load balancer chain to its backends', async ({
  page,
}) => {
  const svg = await openDiagram(page, LOAD_BALANCING_ALL);
  const rule = node(svg, RULE);
  await rule.click();
  await expect(rule).toHaveAttribute('aria-pressed', 'true');
  const lines = await traced(svg);
  const routes = lines.filter((key) => key.includes(' -routes-> '));
  // forwarding rule → target HTTPS proxy → URL map → backend services → instance group / serverless NEG.
  for (const hop of [
    '/targetHttpsProxies/',
    '/urlMaps/',
    '/backendServices/',
    '/instanceGroups/',
    '/networkEndpointGroups/',
  ]) {
    expect(
      routes.some((key) => key.split(' -routes-> ')[1]?.includes(hop) === true),
      hop,
    ).toBe(true);
  }
  const reached = await ids(svg, '.is-reached');
  expect(reached.some((id) => id.startsWith(`${WEB}/zones/`) && id.includes('/instanceGroups/'))).toBe(true);
  expect(reached.some((id) => id.includes('/networkEndpointGroups/'))).toBe(true);
  await expect(svg.locator('.dg-reach-rings')).not.toHaveAttribute('display', 'none');
  expect((await pathNames(svg)).some((name) => name.startsWith('Folder: '))).toBe(true);
});

test('hover previews a trace without changing the selection; the selection persists across zoom', async ({
  page,
}) => {
  const svg = await openDiagram(page, LOAD_BALANCING_ALL);
  // Without a selection, hover previews: the node's own path starts at it.
  const rule = node(svg, RULE);
  await rule.hover();
  await expect(rule).toHaveClass(/is-path/);
  await expect.poll(async () => (await traced(svg)).length).toBeGreaterThan(3);
  await page.mouse.move(2, 2);
  await expect(svg.locator('.dg-edge-top.is-focus')).toHaveCount(0);

  await rule.click();
  await expect(rule).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await traced(svg)).length).toBeGreaterThan(3);
  const selected = await traced(svg);
  // Hovering another card previews its trace; the selection stays, and comes back when the pointer leaves.
  const other = svg.locator(`.dg-card:not([data-id="${RULE}"])`).first();
  await other.hover();
  await expect(rule).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => traced(svg)).not.toEqual(selected);
  await page.mouse.move(2, 2);
  await expect.poll(() => traced(svg)).toEqual(selected);
  expect(hashOf(page)).toContain(`selection=${RULE}`);

  // Zoom: the camera moves, the trace stays (it is kept by id, not by element).
  const viewport = svg.locator('.dg-viewport');
  const before = await viewport.getAttribute('transform');
  const box = await svg.boundingBox();
  if (box === null) throw new Error('the canvas has no box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -500);
  await expect(viewport).not.toHaveAttribute('transform', before ?? '');
  await page.mouse.move(2, 2);
  await expect.poll(() => traced(svg)).toEqual(selected);
  await expect(rule).toHaveAttribute('aria-pressed', 'true');

  // Selecting nothing clears it.
  await page.keyboard.press('Escape');
  await expect(svg.locator('.dg-edge-top.is-focus')).toHaveCount(0);
  await expect(svg.locator('.is-reached')).toHaveCount(0);
});

test('the selection comes back with the trace after a reload (the hash keeps the id)', async ({ page }) => {
  const svg = await openDiagram(page, `${COMPUTE_ALL}&selection=${encodeURIComponent(VM)}`);
  await expect(node(svg, VM)).toHaveAttribute('aria-pressed', 'true');
  expect((await traced(svg)).some((key) => key.includes('/disks/'))).toBe(true);
});
