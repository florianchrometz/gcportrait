// SPDX-License-Identifier: Apache-2.0
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  BASELINE_DIR,
  colourAt,
  crop,
  decodePng,
  mismatch,
  OUT_DIR,
  PNG_MARGIN,
  pngSize,
  renderCliPng,
  renderWithResvg,
  uniform,
} from './exportSupport.js';
import { expectNoAxeViolations, openDiagram, TAGLINE } from './support.js';

/**
 * The Export menu in demo mode: downloads of the SVG and the PNG (whole diagram and current viewport,
 * light and dark, 2× and 3×) checked as files; the SVG parsed and opened in the browser; the PNG's size, theme
 * background and margin; the copy to the clipboard. Faithfulness, in three checks: the exported SVG rendered
 * by resvg matches resvg's render of the renderer's own SVG for the same view (the committed baseline, which
 * the headless renderer draws); the PNG Chromium draws matches the PNG the headless renderer draws of the
 * same view (`pnpm render`, resvg); and the PNG Chromium draws matches resvg's render of the exported SVG.
 *
 * Demo S at detail `auto` is fully open whatever the canvas size, so its view is the S overview baseline. The
 * read time is shown at the viewer's offset; the suite runs at UTC, as the baselines are written.
 */
test.use({ timezoneId: 'UTC', acceptDownloads: true });

const DEMO_S = '/diagram#snapshot=demo:S';
const LIGHT_CANVAS = '#FFFFFF';
const DARK_CANVAS = '#1F1F1F';
const FILE_NAME = /^gcportrait_example\.com_overview_20261008T000000Z\.(svg|png)$/;
const COPY_UNSUPPORTED = 'This browser cannot copy images to the clipboard. Use Download PNG instead.';

interface Saved {
  readonly name: string;
  readonly file: string;
  readonly bytes: Buffer;
}

function exportButton(page: Page): Locator {
  return page.getByRole('banner').getByRole('button', { name: 'Export' });
}

function exportStatus(page: Page): Locator {
  return page.getByRole('status', { name: 'Export status' });
}

/** Opens the menu, picks the options (radio or checkbox items by name), runs an action, saves the download. */
async function exportVia(
  page: Page,
  action: 'Download SVG' | 'Download PNG',
  options: readonly string[],
  label: string,
): Promise<Saved> {
  await exportButton(page).click();
  const menu = page.getByRole('menu', { name: 'Export' });
  await expect(menu).toBeVisible();
  for (const option of options) {
    const role = option === 'Embed fonts' ? 'menuitemcheckbox' : 'menuitemradio';
    await menu.getByRole(role, { name: option, exact: true }).click();
  }
  const pending = page.waitForEvent('download');
  await menu.getByRole('menuitem', { name: action }).click();
  const download = await pending;
  mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `${label}-${download.suggestedFilename()}`);
  await download.saveAs(file);
  await expect(exportStatus(page).filter({ hasText: 'Saved' })).toBeVisible();
  return { name: download.suggestedFilename(), file, bytes: readFileSync(file) };
}

/** The exported SVG parsed by the browser's XML parser: its frame, document text and a few facts. */
async function parseInBrowser(page: Page, svg: string) {
  return page.evaluate((text) => {
    const document = new DOMParser().parseFromString(text, 'image/svg+xml');
    const root = document.documentElement;
    const number = (name: string) => Number(root.getAttribute(name));
    const uses = [...document.querySelectorAll('use')];
    const clipRect = document.querySelector('clipPath rect');
    const clipNumber = (name: string) => Number(clipRect?.getAttribute(name));
    return {
      errors: document.getElementsByTagName('parsererror').length,
      root: root.localName,
      width: number('width'),
      height: number('height'),
      viewBox: (root.getAttribute('viewBox') ?? '').split(' ').map(Number),
      theme: root.getAttribute('data-theme'),
      title: document.querySelector('svg > title')?.textContent ?? '',
      desc: document.querySelector('svg > desc')?.textContent ?? '',
      titleBlock: document.querySelector('.dg-title-block')?.textContent ?? '',
      titleLines: [...document.querySelectorAll('.dg-title-block text')].map((line) => line.textContent),
      legend: document.querySelector('.dg-legend')?.textContent ?? '',
      background: document.querySelector('.dg-background')?.getAttribute('fill') ?? '',
      uses: uses.length,
      xlinkUses: uses.filter(
        (use) => use.getAttributeNS('http://www.w3.org/1999/xlink', 'href') === use.getAttribute('href'),
      ).length,
      clip:
        clipRect === null
          ? null
          : {
              x: clipNumber('x'),
              y: clipNumber('y'),
              width: clipNumber('width'),
              height: clipNumber('height'),
            },
      interactive: document.querySelectorAll('.dg-marks, .dg-edges-top, [tabindex], [role]').length,
    };
  }, svg);
}

test('is inert until a diagram is drawn, then a keyboard-operable menu, accessible in both themes', async ({
  page,
}) => {
  await page.goto('/diagram');
  await expect(exportButton(page)).toHaveAttribute('aria-disabled', 'true');
  await exportButton(page).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu')).toHaveCount(0);

  await openDiagram(page, DEMO_S);
  const button = exportButton(page);
  await expect(button).not.toHaveAttribute('aria-disabled', 'true');
  await button.focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu', { name: 'Export' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitemradio', { name: 'Whole diagram' })).toBeFocused();
  // The focused item shows a ring (inset, so neighbours never cover it).
  const ring = await menu
    .getByRole('menuitemradio', { name: 'Whole diagram' })
    .evaluate((element) => getComputedStyle(element).boxShadow);
  expect(ring).toContain('inset');
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitemradio', { name: 'Current viewport' })).toBeFocused();
  await page.keyboard.press('End');
  await expect(menu.getByRole('menuitem', { name: 'Copy PNG' })).toBeFocused();
  await expectNoAxeViolations(page);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(button).toBeFocused();

  await page.emulateMedia({ colorScheme: 'dark' });
  await openDiagram(page, DEMO_S);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await exportButton(page).click();
  await expect(page.getByRole('menu', { name: 'Export' })).toBeVisible();
  // The theme option follows the app until the person picks one.
  await expect(page.getByRole('menuitemradio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true');
  await expectNoAxeViolations(page);
});

test('downloads the whole diagram as SVG: well-formed, titled, with the legend, no affiliation line, no CSS variables', async ({
  page,
}) => {
  await openDiagram(page, DEMO_S);
  const svg = await exportVia(page, 'Download SVG', [], 'whole-light');
  expect(svg.name).toMatch(FILE_NAME);
  expect(svg.name.endsWith('.svg')).toBe(true);
  expect(svg.bytes.length).toBeGreaterThan(10_000);
  const text = svg.bytes.toString('utf8');
  expect(text.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<svg')).toBe(true);
  expect(text).not.toContain('var(');
  expect(text).not.toContain('@font-face');
  const parsed = await parseInBrowser(page, text);
  expect(parsed).toMatchObject({
    errors: 0,
    root: 'svg',
    theme: 'light',
    background: LIGHT_CANVAS,
    interactive: 0,
  });
  expect(parsed.viewBox.slice(2)).toEqual([parsed.width, parsed.height]);
  expect(parsed.title).toBe('gcportrait diagram of example.com, Overview lens');
  expect(parsed.desc).toBe(
    'example.com, Overview lens, read 2026-10-08T00:00:00+00:00. Drawn with gcportrait.',
  );
  expect(parsed.titleBlock).toContain('Overview lens · read 2026-10-08T00:00:00+00:00');
  // The canvas's three lines, ending with the tagline; the statement is in the app footer only, never in a
  // drawing (title block or <desc>; AGENTS.md, Non-affiliation, brand and legal).
  expect(parsed.titleLines).toEqual([
    'example.com',
    'Overview lens · read 2026-10-08T00:00:00+00:00',
    TAGLINE,
  ]);
  expect(text).not.toMatch(/affiliated/i);
  expect(parsed.legend).toContain('Legend');
  expect(parsed.uses).toBeGreaterThan(10);
  expect(parsed.xlinkUses).toBe(parsed.uses);

  // The file opens in the browser on its own, at its own size.
  await page.setViewportSize({ width: parsed.width, height: parsed.height });
  await page.goto(`file://${svg.file}`);
  await expect(page.locator('svg > title')).toHaveText('gcportrait diagram of example.com, Overview lens');
  const box = await page.locator(':root').boundingBox();
  expect([box?.width, box?.height]).toEqual([parsed.width, parsed.height]);
  writeFileSync(path.join(OUT_DIR, 'whole-light-opened-in-chromium.png'), await page.screenshot());
});

test('downloads PNGs at 2× and 3× on the theme background with a 24 px margin, in either theme', async ({
  page,
}) => {
  await openDiagram(page, DEMO_S);
  const svg = await parseInBrowser(
    page,
    (await exportVia(page, 'Download SVG', [], 'frame')).bytes.toString('utf8'),
  );
  const cases = [
    { theme: 'Light', scale: '2×', factor: 2, canvas: LIGHT_CANVAS },
    { theme: 'Dark', scale: '3×', factor: 3, canvas: DARK_CANVAS },
  ] as const;
  for (const { theme, scale, factor, canvas } of cases) {
    const png = await exportVia(page, 'Download PNG', [theme, scale], `whole-${theme.toLowerCase()}`);
    expect(png.name).toMatch(FILE_NAME);
    expect(png.name.endsWith('.png')).toBe(true);
    expect(png.bytes.length).toBeGreaterThan(10_000);
    // PNG size = (exported frame + 2 × 24 px) × scale.
    const size = pngSize(png.bytes);
    expect(size).toEqual({
      width: Math.ceil((svg.width + 2 * PNG_MARGIN) * factor),
      height: Math.ceil((svg.height + 2 * PNG_MARGIN) * factor),
    });
    await expect(exportStatus(page)).toHaveText(
      `Saved ${png.name} (${String(size.width)} × ${String(size.height)} px).`,
    );
    const image = decodePng(png.bytes);
    const margin = PNG_MARGIN * factor;
    // The margin is the theme's canvas colour all round (the font sentinels painted over, top left).
    for (const [x, y, width, height] of [
      [0, 0, image.width, margin],
      [0, image.height - margin, image.width, margin],
      [0, 0, margin, image.height],
      [image.width - margin, 0, margin, image.height],
    ] as const) {
      expect(uniform(image, x, y, width, height)).toBe(true);
      expect(colourAt(image, x, y)).toBe(canvas);
    }
    // The title block's scope line is drawn (in the embedded Roboto), 24 px inside the frame.
    const inset = (PNG_MARGIN + 24) * factor;
    expect(uniform(image, inset, inset, 200 * factor, 20 * factor)).toBe(false);
  }
  const dark = await parseInBrowser(
    page,
    (await exportVia(page, 'Download SVG', ['Dark'], 'whole-dark')).bytes.toString('utf8'),
  );
  // The app is light; the export is drawn in the dark theme's own tokens.
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(dark).toMatchObject({ errors: 0, theme: 'dark', background: DARK_CANVAS, width: svg.width });
  expect(dark.titleLines.at(-1)).toBe(TAGLINE);
  expect(dark.titleBlock).not.toMatch(/affiliated/i);
  expect(dark.desc).not.toMatch(/affiliated/i);
});

for (const theme of ['light', 'dark'] as const) {
  test(`exports what the headless renderer draws for the same view (${theme})`, async ({ page }) => {
    test.setTimeout(120_000);
    await openDiagram(page, DEMO_S);
    const label = theme === 'light' ? 'Light' : 'Dark';
    const svg = await exportVia(page, 'Download SVG', [label], `faithful-${theme}`);
    const png = await exportVia(page, 'Download PNG', [label, '2×'], `faithful-${theme}`);

    // The exported SVG in resvg against the renderer's own SVG of this view: the baseline the frontend's
    // Vitest suite writes (frontend/src/diagram/baselines.test.tsx), whose bytes the CLI draws too.
    const reference = readFileSync(path.join(BASELINE_DIR, `S-overview-auto-${theme}.svg`), 'utf8');
    const ours = renderWithResvg(svg.bytes.toString('utf8'));
    const theirs = renderWithResvg(reference);
    writeFileSync(path.join(OUT_DIR, `faithful-${theme}-export.resvg.png`), ours.png);
    expect([ours.width, ours.height]).toEqual([theirs.width, theirs.height]);
    const svgRatio = mismatch(ours, theirs, `faithful-${theme}-svg-diff.png`);
    console.log(
      `exported SVG vs the renderer's SVG (both in resvg, ${theme}): ${(svgRatio * 100).toFixed(4)} % of pixels differ`,
    );
    expect(svgRatio).toBeLessThanOrEqual(0.0005);

    // The PNG the app drew in Chromium against the CLI's PNG of the same view (resvg): same size, same picture.
    const cli = renderCliPng(
      { fixture: 'S', lens: 'overview', theme },
      path.join(OUT_DIR, `faithful-${theme}-cli.png`),
    );
    test.skip(cli === null, 'this checkout has no headless renderer (pnpm render)');
    if (cli === null) return;
    expect(pngSize(png.bytes)).toEqual(pngSize(cli));
    const pngRatio = mismatch(decodePng(png.bytes), decodePng(cli), `faithful-${theme}-png-diff.png`);
    console.log(
      `app PNG (Chromium) vs CLI PNG (resvg, ${theme}): ${(pngRatio * 100).toFixed(4)} % of pixels differ`,
    );
    expect(pngRatio).toBeLessThanOrEqual(0.01);
  });
}

test('the PNG Chromium draws matches resvg drawing the exported SVG at the same scale', async ({ page }) => {
  await openDiagram(page, DEMO_S);
  const svg = await exportVia(page, 'Download SVG', [], 'chromium');
  const png = decodePng((await exportVia(page, 'Download PNG', ['2×'], 'chromium')).bytes);
  const resvg = renderWithResvg(svg.bytes.toString('utf8'), 2);
  writeFileSync(path.join(OUT_DIR, 'chromium-export.resvg.png'), resvg.png);
  const margin = PNG_MARGIN * 2;
  const inner = crop(png, margin, margin, resvg.width, resvg.height);
  const ratio = mismatch(inner, resvg, 'chromium-vs-resvg-diff.png');
  console.log(`Chromium PNG vs resvg at 2×: ${(ratio * 100).toFixed(4)} % of pixels differ`);
  expect(ratio).toBeLessThanOrEqual(0.01);
});

test('exports the current viewport: clipped to what the canvas shows, title block and legend kept', async ({
  page,
}) => {
  const canvas = await openDiagram(page, DEMO_S);
  const whole = await parseInBrowser(
    page,
    (await exportVia(page, 'Download SVG', [], 'viewport-whole')).bytes.toString('utf8'),
  );
  const box = await canvas.boundingBox();
  if (box === null) throw new Error('no canvas');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -1200);
  await expect.poll(async () => Number(await canvas.getAttribute('data-scale'))).toBeGreaterThan(1.5);
  // What the canvas shows, in drawing coordinates, from its camera.
  const visible = await canvas.evaluate((svg) => {
    const transform = svg.querySelector('.dg-viewport')?.getAttribute('transform') ?? '';
    const [x = 0, y = 0, k = 1] = (
      /translate\(([-\d.e]+),([-\d.e]+)\) scale\(([-\d.e]+)\)/.exec(transform) ?? []
    )
      .slice(1)
      .map(Number);
    return { x: -x / k, y: -y / k, width: svg.clientWidth / k, height: svg.clientHeight / k };
  });
  const svg = await exportVia(page, 'Download SVG', ['Current viewport'], 'viewport');
  const parsed = await parseInBrowser(page, svg.bytes.toString('utf8'));
  expect(parsed.errors).toBe(0);
  expect(parsed.width).toBeLessThan(whole.width);
  expect(parsed.titleLines.at(-1)).toBe(TAGLINE);
  expect(parsed.titleBlock).not.toMatch(/affiliated/i);
  expect(parsed.legend).toContain('Legend');
  // Zoomed in on the middle, the visible area lies inside the diagram: the clip is exactly that area.
  const { clip } = parsed;
  if (clip === null) throw new Error('the viewport export has no clip');
  expect(clip.x).toBeCloseTo(visible.x, 1);
  expect(clip.y).toBeCloseTo(visible.y, 1);
  expect(clip.width).toBeCloseTo(visible.width, 1);
  expect(clip.height).toBeCloseTo(visible.height, 1);
  const png = await exportVia(page, 'Download PNG', ['Current viewport'], 'viewport');
  expect(pngSize(png.bytes)).toEqual({
    width: Math.ceil((parsed.width + 2 * PNG_MARGIN) * 2),
    height: Math.ceil((parsed.height + 2 * PNG_MARGIN) * 2),
  });
});

test('copies the PNG to the clipboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openDiagram(page, DEMO_S);
  await exportButton(page).click();
  await page.getByRole('menuitem', { name: 'Copy PNG' }).click();
  const status = exportStatus(page);
  await expect(status).toHaveText(/^Copied the PNG to the clipboard \((\d+) × (\d+) px\)\.$/);
  const [, width, height] = /\((\d+) × (\d+) px\)/.exec((await status.textContent()) ?? '') ?? [];
  const pasted = await page.evaluate(async () => {
    const [item] = await navigator.clipboard.read();
    if (item === undefined) return null;
    const blob = await item.getType('image/png');
    const bitmap = await createImageBitmap(blob);
    return { types: item.types, size: blob.size, width: bitmap.width, height: bitmap.height };
  });
  expect(pasted?.types).toContain('image/png');
  expect(pasted?.size).toBeGreaterThan(10_000);
  expect([pasted?.width, pasted?.height]).toEqual([Number(width), Number(height)]);
});

test('says plainly when the browser cannot copy images', async ({ page }) => {
  await page.addInitScript(() => {
    Reflect.deleteProperty(window, 'ClipboardItem');
  });
  await openDiagram(page, DEMO_S);
  await exportButton(page).click();
  await page.getByRole('menuitem', { name: 'Copy PNG' }).click();
  await expect(exportStatus(page)).toHaveText(COPY_UNSUPPORTED);
  await expect(exportButton(page)).toBeFocused();
});
