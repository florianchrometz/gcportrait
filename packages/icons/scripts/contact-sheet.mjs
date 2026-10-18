#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// @ts-check
/**
 * Writes a contact sheet of every icon the package resolves: each key at 24 px and at 16 px, on a light card
 * and on a dark card, the dark row following the style skill §2 (Google's colour and grey marks on the light
 * plate, `#FFFFFF` at 92 % opacity with radius 4; two-tone blue icons and own drawings straight on the card).
 * Own drawings are outlined in amber and the legibility decisions at 16 px (README) are marked, so a reviewer
 * can check both at a glance.
 *
 * Output, in out/ at the repository root (git-ignored): icons-contact-sheet.svg; icons-contact-sheet.png (2x,
 * through headless Chromium); icons-legibility-16px.png, the legibility check list of mapping.json rendered at
 * 16 and 24 px with one device pixel per CSS pixel and magnified six times, which is what the 16 px decisions
 * in README.md were made on. The PNGs are skipped with a note when no browser is installed.
 *
 * Usage: node scripts/contact-sheet.mjs [--out <dir>] [--scale <n>]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';

import { PACKAGE_DIR } from './lib/catalog-keys.mjs';
import { collectIcons } from './lib/icon-module.mjs';
import { loadMapping } from './lib/mapping.mjs';
import { dataUri, svgToPng, withPage } from './lib/render.mjs';

/** Theme colours from the style skill §2 (cards) and §9 (chrome text). */
const LIGHT = { canvas: '#F8F9FA', card: '#FFFFFF', stroke: '#DADCE0', ink: '#202124', muted: '#5F6368' };
const DARK = { canvas: '#1F1F1F', card: '#2B2C2F', stroke: '#5F6368', ink: '#E8EAED', muted: '#9AA0A6' };
const PLATE = { fill: '#FFFFFF', opacity: 0.92, radius: 4 };
const OWN_OUTLINE = '#F9AB00';
const COLUMNS = 6;
const CELL_WIDTH = 236;
const CELL_HEIGHT = 92;
const MARGIN = 24;
const HEADER = 96;

/**
 * @param {string} text
 * @param {number} max
 * @returns {string}
 */
const truncate = (text, max) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

/**
 * @param {string} text
 * @returns {string}
 */
const escape = (text) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');

/**
 * The icon as a nested <svg> at (x, y) with a `size` box.
 * @param {string} svg
 * @param {number} x
 * @param {number} y
 * @param {number} size
 * @returns {string}
 */
const place = (svg, x, y, size) =>
  svg.replace(
    /^<svg\b/,
    `<svg x="${String(x)}" y="${String(y)}" width="${String(size)}" height="${String(size)}"`,
  );

/**
 * One icon on one theme's card: 24 px and 16 px, with the plate where the rules ask for it.
 * @param {import('./lib/icon-module.mjs').IconEntry} icon
 * @param {typeof LIGHT} theme
 * @param {boolean} dark
 * @param {number} x
 * @param {number} y
 * @returns {string}
 */
function sample(icon, theme, dark, x, y) {
  const parts = [
    `<rect x="${String(x)}" y="${String(y)}" width="72" height="36" rx="6" fill="${theme.card}" stroke="${theme.stroke}"/>`,
  ];
  for (const [size, left] of /** @type {const} */ ([
    [24, 8],
    [16, 44],
  ])) {
    const iconX = x + left;
    const iconY = y + (36 - size) / 2;
    if (dark && icon.plateOnDark) {
      parts.push(
        `<rect x="${String(iconX - 2)}" y="${String(iconY - 2)}" width="${String(size + 4)}" height="${String(size + 4)}" rx="${String(PLATE.radius)}" fill="${PLATE.fill}" fill-opacity="${String(PLATE.opacity)}"/>`,
      );
    }
    parts.push(place(icon.svg, iconX, iconY, size));
  }
  return parts.join('');
}

/**
 * The second line under a key: kind and set, the artwork file when it is not named after the key, and a mark
 * for the keys on the 16 px check list.
 * @param {import('./lib/icon-module.mjs').IconEntry} icon
 * @param {boolean} checked
 * @returns {string}
 */
function caption(icon, checked) {
  const base = path.posix.basename(icon.file);
  const file = base === `${icon.key}.svg` ? '' : ` → ${base.replace(/\.svg$/, '')}`;
  return `${checked ? '16 px ✓ · ' : ''}${icon.kind} · ${icon.set}${file}`;
}

/**
 * @returns {{ svg: string, width: number, height: number }}
 */
function contactSheet() {
  const icons = collectIcons();
  const checked = new Set(loadMapping().legibility16.map((row) => row.key));
  const rows = Math.ceil(icons.length / COLUMNS);
  const width = MARGIN * 2 + COLUMNS * CELL_WIDTH;
  const height = MARGIN * 2 + HEADER + rows * CELL_HEIGHT;
  const font = 'font-family="Roboto, system-ui, sans-serif"';
  const counts = icons.reduce(
    (all, icon) => ({ ...all, [icon.kind]: (all[icon.kind] ?? 0) + 1 }),
    /** @type {Record<string, number>} */ ({}),
  );
  /** @type {string[]} */
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${String(width)}" height="${String(height)}" viewBox="0 0 ${String(width)} ${String(height)}" ${font}>`,
    `<rect width="${String(width)}" height="${String(height)}" fill="${LIGHT.canvas}"/>`,
    `<text x="${String(MARGIN)}" y="${String(MARGIN + 20)}" font-size="20" font-weight="700" fill="${LIGHT.ink}">gcportrait icons: ${String(icons.length)} keys (${Object.entries(
      counts,
    )
      .sort()
      .map(([kind, count]) => `${kind} ${String(count)}`)
      .join(', ')})</text>`,
    `<text x="${String(MARGIN)}" y="${String(MARGIN + 42)}" font-size="12" fill="${LIGHT.muted}">Each key at 24 px and 16 px on the light card (left) and the dark card (right; colour and grey marks on the light plate). Amber outline: own drawing, not a Google icon.</text>`,
    `<text x="${String(MARGIN)}" y="${String(MARGIN + 60)}" font-size="12" fill="${LIGHT.muted}">The Google Cloud product icons are Google Cloud's (https://cloud.google.com/icons), used as provided; Google Cloud and the icons are trademarks of Google.</text>`,
  ];
  icons.forEach((icon, index) => {
    const x = MARGIN + (index % COLUMNS) * CELL_WIDTH;
    const y = MARGIN + HEADER + Math.floor(index / COLUMNS) * CELL_HEIGHT;
    const own = icon.kind === 'own';
    parts.push(
      `<rect x="${String(x)}" y="${String(y)}" width="${String(CELL_WIDTH - 8)}" height="${String(CELL_HEIGHT - 8)}" rx="8" fill="${DARK.canvas}" fill-opacity="0"${own ? ` stroke="${OWN_OUTLINE}" stroke-width="2"` : ''}/>`,
      `<rect x="${String(x + 114)}" y="${String(y)}" width="${String(CELL_WIDTH - 122)}" height="48" rx="8" fill="${DARK.canvas}"/>`,
      sample(icon, LIGHT, false, x + 8, y + 6),
      sample(icon, DARK, true, x + 122, y + 6),
      `<text x="${String(x + 8)}" y="${String(y + 62)}" font-size="11" font-weight="500" fill="${LIGHT.ink}">${escape(truncate(icon.key, 38))}</text>`,
      `<text x="${String(x + 8)}" y="${String(y + 76)}" font-size="10.5" fill="${LIGHT.muted}">${escape(truncate(caption(icon, checked.has(icon.key)), 40))}</text>`,
    );
  });
  parts.push('</svg>');
  return { svg: parts.join('\n'), width, height };
}

const MAGNIFY = 6;

/**
 * The legibility check list rendered at 16 and 24 px with one device pixel per CSS pixel, then magnified
 * without smoothing, with each decision written under its glyph.
 * @returns {Promise<Buffer>}
 */
async function legibilityPng() {
  const rows = loadMapping().legibility16;
  const icons = new Map(collectIcons().map((icon) => [icon.key, icon]));
  const cell = 48;
  const small = rows
    .map((row) => {
      const svg = icons.get(row.key)?.svg ?? '';
      return `<div style="display:inline-block;width:${String(cell)}px;height:28px"><img src="${dataUri(svg)}" width="16" height="16"> <img src="${dataUri(svg)}" width="24" height="24"></div>`;
    })
    .join('');
  const width = cell * rows.length;
  const raster = await withPage(
    async (page) => {
      await page.setContent(
        `<!doctype html><style>body{margin:0;background:#fff;line-height:0}</style>${small}`,
      );
      return page.screenshot({ clip: { x: 0, y: 0, width, height: 28 } });
    },
    { width, height: 28, scale: 1 },
  );
  const labels = rows
    .map(
      (row) =>
        `<div style="display:inline-block;vertical-align:top;box-sizing:border-box;width:${String(cell * MAGNIFY)}px;padding:8px 12px 0 0"><b>${escape(row.subject)}</b> · <code>${escape(row.key)}</code><br>${row.decision === 'own' ? 'own drawing' : 'official glyph kept'}<br><span style="color:#5F6368">${escape(row.note)}</span></div>`,
    )
    .join('');
  const pageWidth = cell * MAGNIFY * rows.length + 32;
  return withPage(
    async (page) => {
      await page.setContent(
        `<!doctype html><style>body{margin:16px;font:13px Roboto,system-ui,sans-serif;color:#202124;background:#fff}</style>` +
          `<div style="font-size:16px;font-weight:700;margin-bottom:4px">16 px legibility check list (each glyph at 16 px, then 24 px; one CSS pixel per device pixel, magnified ${String(MAGNIFY)}×)</div>` +
          `<div style="color:#5F6368;margin-bottom:12px">The Google Cloud product icons are Google Cloud's (https://cloud.google.com/icons), used as provided; Google Cloud and the icons are trademarks of Google.</div>` +
          `<img style="image-rendering:pixelated;width:${String(width * MAGNIFY)}px;height:${String(28 * MAGNIFY)}px" src="data:image/png;base64,${raster.toString('base64')}"><div>${labels}</div>`,
      );
      return page.screenshot({ fullPage: true });
    },
    { width: pageWidth, height: 400, scale: 1 },
  );
}

/**
 * @param {readonly string[]} argv
 * @returns {Promise<number>}
 */
async function main(argv) {
  const { values } = parseArgs({
    args: [...argv],
    options: { out: { type: 'string' }, scale: { type: 'string', default: '2' } },
    strict: true,
  });
  const outDir = path.resolve(values.out ?? path.join(PACKAGE_DIR, '..', '..', 'out'));
  mkdirSync(outDir, { recursive: true });
  const { svg, width, height } = contactSheet();
  const svgPath = path.join(outDir, 'icons-contact-sheet.svg');
  writeFileSync(svgPath, `${svg}\n`);
  process.stdout.write(`contact sheet: wrote ${svgPath}\n`);
  try {
    const png = await svgToPng(svg, width, height, Number(values.scale));
    const pngPath = path.join(outDir, 'icons-contact-sheet.png');
    writeFileSync(pngPath, png);
    process.stdout.write(`contact sheet: wrote ${pngPath}\n`);
    const legibilityPath = path.join(outDir, 'icons-legibility-16px.png');
    writeFileSync(legibilityPath, await legibilityPng());
    process.stdout.write(`contact sheet: wrote ${legibilityPath}\n`);
  } catch (error) {
    process.stderr.write(
      `contact sheet: PNG skipped: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
  return 0;
}

process.exitCode = await main(process.argv.slice(2));
