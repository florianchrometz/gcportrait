// SPDX-License-Identifier: MIT
import { expect, type BrowserContext, type Locator, type Page } from '@playwright/test';

import { openDiagram } from './support.js';

/**
 * Helpers for the specs around the bastion VM of demo M and its Cloud Console page (console-link, drawer): no request
 * reaches Google, the Cloud Console is a stub page.
 */

/** The bastion VM of demo M. */
export const VM = '//compute.googleapis.com/projects/demo-vm-1/zones/europe-west3-a/instances/bastion';
/** Its Cloud Console page, from the catalog's console template. */
export const VM_PAGE =
  'https://console.cloud.google.com/compute/instancesDetail/zones/europe-west3-a/instances/bastion?project=demo-vm-1';
/** Demo M in the compute lens with every zone open. */
export const COMPUTE_ALL = '/diagram#snapshot=demo:M&lens=compute&detail=all';

/** Answers every Cloud Console request with a stub page, and counts the pages the browser opens. */
export async function stubConsole(context: BrowserContext): Promise<{ opened: () => number }> {
  await context.route('https://console.cloud.google.com/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Cloud Console stub</title>' }),
  );
  let opened = 0;
  context.on('page', () => {
    opened += 1;
  });
  return { opened: () => opened };
}

/** Opens demo M's compute lens at every detail and selects the bastion VM with a click. */
export async function selectVm(page: Page): Promise<{ svg: Locator; vm: Locator }> {
  const svg = await openDiagram(page, COMPUTE_ALL);
  const vm = svg.locator(`[data-id="${VM}"]`);
  await vm.click();
  await expect(vm).toHaveAttribute('aria-pressed', 'true');
  return { svg, vm };
}
