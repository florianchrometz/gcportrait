// SPDX-License-Identifier: MIT
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';

import {
  boxOf,
  DEFAULT_SOURCE_URL,
  expectFooterLinkStyle,
  expectShellFooter,
  FOOTER_NOTICE,
  MAINTAINER_LINK_NAME,
  NOT_AFFILIATED,
  openDiagram,
  inside,
  primaryNav,
  recordApiRequests,
  ROUTES,
  scratchShot,
  SOURCE_LINK_TEXT,
  wcagContrast,
  WORDMARK,
} from './support.js';

/** gcportrait's mark, the one source of the website's and the app's favicon (brand/README.md). */
const BRAND_ICON = path.resolve(import.meta.dirname, '..', '..', 'brand', 'icon.svg');

test('the shell loads and shows the wordmark', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('banner').getByRole('link', { name: WORDMARK })).toBeVisible();
  await expect(page.getByTestId('demo-badge')).toHaveText('Demo mode');
  await expect(page.getByRole('heading', { level: 1, name: 'Connect' })).toBeVisible();
});

test('the Connect page offers only the demo, with the About block', async ({ page }) => {
  await page.goto('/');
  const sources = page.getByRole('region', { name: 'Demo mode' });
  await expect(sources.getByRole('button')).toHaveCount(1);
  // snapshots.spec.ts drives it.
  await expect(sources.getByRole('button', { name: 'Try the demo' })).toBeEnabled();
  await expect(page.getByRole('region', { name: 'About' })).toContainText('not affiliated with, endorsed by');
});

for (const { path, heading } of ROUTES) {
  test(`${path} renders inside the shell with the footer notice and the source link`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeAttached();
    // Demo mode has no backend: the link goes to the build-time URL (VITE_SOURCE_URL, unset here).
    await expectShellFooter(page, DEFAULT_SOURCE_URL);
  });
}

test('on the diagram the footer alone says it: not the title block, not the drawing’s <desc> (ADR 0018)', async ({
  page,
}) => {
  const svg = await openDiagram(page);
  await expectShellFooter(page, DEFAULT_SOURCE_URL);
  const title = svg.locator('.dg-title-block');
  await expect(title.locator('text')).toHaveCount(3);
  await expect(title).not.toContainText(/affiliated/i);
  await expect(svg.locator('desc').first()).toHaveText(/Drawn with gcportrait\.$/);
  expect(await svg.evaluate((element) => element.textContent)).not.toMatch(/affiliated/i);
  // On the whole page the line is written once: in the footer's notice.
  const text = await page.locator('body').innerText();
  expect(text.split(NOT_AFFILIATED)).toHaveLength(2);
  expect(text).toContain(FOOTER_NOTICE);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`the footer in the ${scheme} theme: readable, its links underlined, each with the focus ring`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/diagram');
    await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
    await expectShellFooter(page, DEFAULT_SOURCE_URL);
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    const footer = page.getByRole('contentinfo');
    for (const name of [MAINTAINER_LINK_NAME, SOURCE_LINK_TEXT]) {
      await expectFooterLinkStyle(page, footer.getByRole('link', { name, exact: true }), name);
      if (name === MAINTAINER_LINK_NAME) {
        await scratchShot(footer, 'footer', `footer-focused-maintainer-${scheme}`);
      }
    }
    await page.locator('main').focus();
    await scratchShot(footer, 'footer', `footer-${scheme}`);
  });
}

/** The colours `brand/icon.svg` gives a class's `fill`: the light one first, then the dark one. */
function brandFills(svg: string, className: string): string[] {
  return [...svg.matchAll(new RegExp(`\\.${className}\\{fill:(#[0-9a-f]{6})`, 'g'))].map(
    (match) => match[1] ?? '',
  );
}

function rgbOf(hex: string): number[] {
  return [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
}

test('the favicon is the brand icon as it is, drawn in the theme of each colour scheme', async ({ page }) => {
  const source = readFileSync(BRAND_ICON, 'utf8');
  await page.goto('/');
  const icons = page.locator('link[rel="icon"]');
  await expect(icons).toHaveCount(1);
  await expect(icons).toHaveAttribute('href', '/favicon.svg');
  await expect(icons).toHaveAttribute('type', 'image/svg+xml');
  const response = await page.request.get('/favicon.svg');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('image/svg+xml');
  expect(await response.text()).toBe(source);

  // One file for both themes: the browser draws the project zone in the light or the dark tint by the colour scheme.
  const fills = brandFills(source, 'p');
  expect(fills).toHaveLength(2);
  const drawn: number[][] = [];
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    drawn.push(
      await page.evaluate(async () => {
        const image = new Image();
        image.src = `/favicon.svg?${String(Date.now())}`;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = 48;
        canvas.height = 48;
        const context = canvas.getContext('2d');
        if (context === null) throw new Error('no 2D context');
        context.drawImage(image, 0, 0, 48, 48);
        return Array.from(context.getImageData(24, 17, 1, 1).data.slice(0, 3));
      }),
    );
  }
  expect(drawn).toEqual(fills.map(rgbOf));
});

test('the top bar shows the brand mark beside the wordmark: brand/icon.svg from the base path, in each colour scheme', async ({
  page,
}) => {
  const fills = brandFills(readFileSync(BRAND_ICON, 'utf8'), 'p');
  for (const [index, scheme] of (['light', 'dark'] as const).entries()) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
    // The home link keeps the wordmark as its name: the mark is decorative.
    const home = page.getByRole('banner').getByRole('link', { name: WORDMARK, exact: true });
    const mark = home.locator('img');
    await expect(mark).toHaveCount(1);
    await expect(mark).toHaveAttribute('src', '/favicon.svg');
    await expect(mark).toHaveAttribute('alt', '');
    await expect
      .poll(() => mark.evaluate((image: HTMLImageElement) => image.naturalWidth))
      .toBeGreaterThan(0);
    // A 24-pixel square, centred on the wordmark's line, before the name with the website header's gap (0.6rem),
    // inside the link.
    const geometry = await mark.evaluate((image) => {
      const box = image.getBoundingClientRect();
      const name = [...(image.parentElement?.childNodes ?? [])].find(
        (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '',
      );
      const range = document.createRange();
      if (name !== undefined) range.selectNodeContents(name);
      const text = range.getBoundingClientRect();
      const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
      return {
        box: { top: box.top, right: box.right, width: box.width, height: box.height },
        text: { left: text.left, top: text.top, bottom: text.bottom },
        rem,
      };
    });
    expect(geometry.box.width).toBeCloseTo(24, 1);
    expect(geometry.box.height).toBeCloseTo(24, 1);
    const markMiddle = geometry.box.top + geometry.box.height / 2;
    const nameMiddle = (geometry.text.top + geometry.text.bottom) / 2;
    expect(Math.abs(markMiddle - nameMiddle)).toBeLessThanOrEqual(1);
    expect(geometry.text.left - geometry.box.right).toBeCloseTo(0.6 * geometry.rem, 0);
    const markBox = await boxOf(mark);
    expect(inside(markBox, await boxOf(home))).toBe(true);
    // The file draws itself in the colour scheme's tints: the project zone's fill, light or dark.
    const drawn = await mark.evaluate((image: HTMLImageElement) => {
      const canvas = document.createElement('canvas');
      canvas.width = 48;
      canvas.height = 48;
      const context = canvas.getContext('2d');
      if (context === null) throw new Error('no 2D context');
      context.drawImage(image, 0, 0, 48, 48);
      return Array.from(context.getImageData(24, 17, 1, 1).data.slice(0, 3));
    });
    expect(drawn).toEqual(rgbOf(fills[index] ?? ''));
    await scratchShot(page.getByRole('banner'), 'topbar', `brand-mark-${scheme}`);
  }
});

test('the brand mark follows the theme chosen in the app, also against the system’s colour scheme', async ({
  browser,
  baseURL,
}) => {
  const fills = brandFills(readFileSync(BRAND_ICON, 'utf8'), 'p');
  // Magnified, so the project zone's fill is many pixels away from any edge.
  const context = await browser.newContext({
    colorScheme: 'light',
    deviceScaleFactor: 4,
    ...(baseURL === undefined ? {} : { baseURL }),
  });
  try {
    const page = await context.newPage();
    await page.goto('/');
    const banner = page.getByRole('banner');
    const mark = banner.getByRole('link', { name: WORDMARK, exact: true }).locator('img');
    for (const [index, theme] of (['Light', 'Dark'] as const).entries()) {
      await banner.getByRole('button', { name: 'Theme' }).click();
      await page.getByRole('menuitemradio', { name: theme }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme.toLowerCase());
      await expect.poll(() => mark.evaluate((image: HTMLImageElement) => image.complete)).toBe(true);
      const shot = PNG.sync.read(await mark.screenshot());
      const at = (Math.round((shot.height * 17) / 48) * shot.width + Math.round(shot.width / 2)) * 4;
      expect(Array.from(shot.data.subarray(at, at + 3)), theme).toEqual(rgbOf(fills[index] ?? ''));
    }
  } finally {
    await context.close();
  }
});

for (const scheme of ['light', 'dark'] as const) {
  test(`the Export button ends the top bar at its right edge, filled in the primary colour (${scheme}); its menu opens inside the window`, async ({
    page,
  }) => {
    // The smallest desktop window the app is built for (ADR 0011).
    const VIEWPORT = { width: 1280, height: 800 };
    await page.setViewportSize(VIEWPORT);
    await page.emulateMedia({ colorScheme: scheme });
    await openDiagram(page, '/diagram#snapshot=demo:S');
    await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
    const banner = page.getByRole('banner');
    const exportButton = banner.getByRole('button', { name: 'Export' });
    await expect(exportButton).not.toHaveAttribute('aria-disabled', 'true');

    // The last control of the app row, at its right edge, after the Theme menu.
    const row = await exportButton.evaluate((element) => {
      const appRow = element.closest('header')?.firstElementChild;
      if (!(appRow instanceof HTMLElement)) throw new Error('no app row');
      const rights = [...appRow.querySelectorAll('a[href], button')].map(
        (control) => control.getBoundingClientRect().right,
      );
      const box = appRow.getBoundingClientRect();
      return {
        rightmost: Math.max(...rights),
        contentRight: box.right - Number.parseFloat(getComputedStyle(appRow).paddingRight),
      };
    });
    const button = await boxOf(exportButton);
    const theme = await boxOf(banner.getByRole('button', { name: 'Theme' }));
    expect(button.x).toBeGreaterThan(theme.x + theme.width);
    expect(button.x + button.width).toBeCloseTo(row.rightmost, 1);
    expect(Math.abs(row.contentRight - (button.x + button.width))).toBeLessThanOrEqual(1);

    // The highlight: the chrome's primary token as the fill, on-primary as the text, at 4.5 : 1 or more.
    const colours = await exportButton.evaluate((element) => {
      const probe = document.createElement('span');
      probe.style.backgroundColor = 'var(--color-primary)';
      probe.style.color = 'var(--color-on-primary)';
      document.body.append(probe);
      const tokens = getComputedStyle(probe);
      const css = getComputedStyle(element);
      const result = {
        background: css.backgroundColor,
        text: css.color,
        primary: tokens.backgroundColor,
        onPrimary: tokens.color,
      };
      probe.remove();
      return result;
    });
    expect(colours.background).toBe(colours.primary);
    expect(colours.text).toBe(colours.onPrimary);
    expect(wcagContrast(colours.text, colours.background)).toBeGreaterThanOrEqual(4.5);

    // Reached by keyboard after the Theme menu, with the chrome's focus ring; its menu opens inside the window.
    await banner.getByRole('button', { name: 'Theme' }).focus();
    await page.keyboard.press('Tab');
    await expect(exportButton).toBeFocused();
    const ring = await exportButton.evaluate((element) => getComputedStyle(element).boxShadow);
    expect(ring.split(/,(?![^(]*\))/)).toHaveLength(2);
    await page.keyboard.press('Enter');
    const menu = page.getByRole('menu', { name: 'Export' });
    await expect(menu).toBeVisible();
    expect(inside(await boxOf(menu), { x: 0, y: 0, ...VIEWPORT })).toBe(true);
    await scratchShot(page, 'topbar', `export-menu-${scheme}`);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(exportButton).toBeFocused();
  });
}

test('demo mode never calls the backend', async ({ page }) => {
  const apiRequests = recordApiRequests(page);
  await page.goto('/');
  for (const { heading } of ROUTES) {
    await primaryNav(page).getByRole('link', { name: heading }).click();
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeAttached();
  }
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toBeAttached();
  expect(apiRequests).toEqual([]);
});

test('keyboard focus is visible on the navigation, including the current page link', async ({ page }) => {
  await page.goto('/settings');
  const nav = primaryNav(page);
  const ringWidth = async (link: ReturnType<typeof nav.getByRole>): Promise<number> => {
    await link.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(link).toBeFocused();
    // The focus ring is drawn as outer box-shadows; the widest spread radius is the ring itself. An inset
    // underline bar alone (the current-page marker) must not count as a ring.
    return link.evaluate((element) => {
      const shadows = getComputedStyle(element).boxShadow.split(/,(?![^(]*\))/);
      return Math.max(
        0,
        ...shadows
          .filter((shadow) => !shadow.includes('inset'))
          .map((shadow) => {
            const lengths = shadow
              .replace(/rgba?\([^)]*\)/, '')
              .trim()
              .split(/\s+/);
            return Number.parseFloat(lengths[3] ?? '0') || 0;
          }),
      );
    });
  };
  expect(await ringWidth(nav.getByRole('link', { name: 'Diagram' }))).toBeGreaterThanOrEqual(2);
  const current = nav.getByRole('link', { name: 'Settings' });
  await expect(current).toHaveAttribute('aria-current', 'page');
  expect(await ringWidth(current)).toBeGreaterThanOrEqual(2);
});

test('keyboard users reach the view controls; Export and Filters stay inert without a snapshot', async ({
  page,
}) => {
  await page.goto('/diagram');
  const banner = page.getByRole('banner');
  await primaryNav(page).getByRole('link', { name: 'Settings' }).focus();
  await page.keyboard.press('Tab');
  // The Snapshot menu: Enter opens it, Escape closes it and returns focus.
  const snapshot = banner.getByRole('button', { name: 'Snapshot' });
  await expect(snapshot).toBeFocused();
  expect(await snapshot.evaluate((element) => getComputedStyle(element).boxShadow)).not.toBe('none');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu', { name: 'Snapshot' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(snapshot).toBeFocused();

  // Saved views, Copy link and the Theme menu; Export ends the row.
  await page.keyboard.press('Tab');
  await expect(banner.getByRole('button', { name: 'Saved views' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(banner.getByRole('button', { name: 'Copy link' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(banner.getByRole('button', { name: 'Theme' })).toBeFocused();
  await page.keyboard.press('Tab');
  const exportButton = banner.getByRole('button', { name: 'Export' });
  await expect(exportButton).toBeFocused();
  await expect(exportButton).toHaveAttribute('aria-disabled', 'true');
  expect(await exportButton.evaluate((element) => getComputedStyle(element).boxShadow)).not.toBe('none');
  await page.keyboard.press('Enter');

  // The Filters popover waits for a snapshot.
  const filters = banner.getByRole('button', { name: 'Filters' });
  await filters.focus();
  await expect(filters).toBeFocused();
  await expect(filters).toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('Space');
  await expect(filters).toHaveAttribute('aria-expanded', 'false');

  const search = banner.getByRole('combobox', { name: 'Search assets' });
  await search.focus();
  await expect(search).toBeFocused();
  await page.keyboard.type('vpc');
  await page.keyboard.press('Enter');
  await expect(search).toHaveValue('');
  await expect(page).toHaveURL(/\/diagram$/);
});
