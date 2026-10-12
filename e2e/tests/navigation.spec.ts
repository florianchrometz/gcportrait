// SPDX-License-Identifier: MIT
import { expect, test } from '@playwright/test';

import { primaryNav } from './support.js';

/** The URL hash on /diagram is the ViewSpec (@gcportrait/model); the router must never drop or rewrite it. */
const VIEW_HASH = '#lens=networking&root=folders%2F123';

test('the ViewSpec hash survives leaving /diagram and coming back', async ({ page }) => {
  await page.goto(`/diagram${VIEW_HASH}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Diagram' })).toBeAttached();
  expect(new URL(page.url()).hash).toBe(VIEW_HASH);

  await primaryNav(page).getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL(/\/settings$/);

  await primaryNav(page).getByRole('link', { name: 'Diagram' }).click();
  await expect(page).toHaveURL(/\/diagram#/);
  expect(new URL(page.url()).hash).toBe(VIEW_HASH);

  await page.goBack();
  await expect(page).toHaveURL(/\/settings$/);
  await page.goBack();
  expect(new URL(page.url()).hash).toBe(VIEW_HASH);
});

test('the hash survives a reload and a click on the current Diagram link', async ({ page }) => {
  await page.goto(`/diagram${VIEW_HASH}`);
  await page.reload();
  expect(new URL(page.url()).hash).toBe(VIEW_HASH);
  await primaryNav(page).getByRole('link', { name: 'Diagram' }).click();
  expect(new URL(page.url()).hash).toBe(VIEW_HASH);
});

test('the skip link moves focus to the content without touching the hash', async ({ page }) => {
  await page.goto(`/diagram${VIEW_HASH}`);
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
  expect(new URL(page.url()).hash).toBe(VIEW_HASH);
});

test('the details drawer is closed and the timeline bar is present on /diagram', async ({ page }) => {
  await page.goto('/diagram');
  await expect(page.getByRole('region', { name: 'Diagram canvas' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Details' })).toBeHidden();
  const timeline = page.getByRole('region', { name: 'Timeline' });
  await expect(timeline).toBeVisible();
  const slider = timeline.getByRole('slider', { name: 'Timeline' });
  // No snapshot is open (the timeline is the open snapshot's).
  await expect(slider).toHaveAttribute('aria-disabled', 'true');
  await expect(timeline.getByRole('status')).toHaveText('Open a snapshot to use the timeline.');

  // Inert, not disabled: the keyboard reaches it, but the arrow keys do not move it.
  const value = await slider.getAttribute('aria-valuenow');
  await slider.focus();
  await expect(slider).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Home');
  await expect(slider).toHaveAttribute('aria-valuenow', value ?? '');
});
