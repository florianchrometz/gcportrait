// SPDX-License-Identifier: Apache-2.0
/**
 * Helpers for the export spec: where downloaded exports go, rendering an SVG with native resvg on the app's
 * own Roboto files, decoding and comparing PNGs. The headless renderer uses resvg's WebAssembly build instead;
 * their versions are pinned independently. Nothing here imports the app.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { inflateSync } from 'node:zlib';

import { Resvg } from '@resvg/resvg-js';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

export const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

/** Downloaded exports, resvg renders and diff images, for a person to look at (git-ignored). */
export const OUT_DIR = path.join(REPO_ROOT, 'out/export/e2e');

/** The renderer's committed SVG baselines: the drawings the headless renderer (`pnpm render`) rasterises. */
export const BASELINE_DIR = path.join(REPO_ROOT, 'e2e/baselines/diagram');

/**
 * The headless renderer's PNG of a demo view (`pnpm render`), written to `file`; null when this
 * checkout has no headless renderer.
 */
export function renderCliPng(
  view: { readonly fixture: string; readonly lens: string; readonly theme: 'light' | 'dark' },
  file: string,
): Buffer | null {
  if (!existsSync(path.join(REPO_ROOT, 'packages/render-cli/package.json'))) return null;
  mkdirSync(path.dirname(file), { recursive: true });
  execFileSync(
    'pnpm',
    [
      '--silent',
      'render',
      '--fixture',
      view.fixture,
      '--lens',
      view.lens,
      '--theme',
      view.theme,
      '--png',
      file,
    ],
    { cwd: REPO_ROOT, stdio: 'pipe', timeout: 120_000 },
  );
  return readFileSync(file);
}

/** The 24 px margin of a PNG export (drawing units). */
export const PNG_MARGIN = 24;

/**
 * A WOFF 1.0 file as the TrueType/OpenType file it wraps (W3C WOFF 1.0, section 5): each table is stored
 * zlib-compressed when that is smaller, and the sfnt header and table directory are rebuilt around them.
 * resvg reads only sfnt files; the app ships WOFF and WOFF2.
 */
export function woffToSfnt(woff: Buffer): Buffer {
  if (woff.readUInt32BE(0) !== 0x774f4646) throw new Error('not a WOFF 1.0 file');
  const flavor = woff.readUInt32BE(4);
  const count = woff.readUInt16BE(12);
  const tables = Array.from({ length: count }, (_, index) => {
    const entry = 44 + index * 20;
    const offset = woff.readUInt32BE(entry + 4);
    const stored = woff.readUInt32BE(entry + 8);
    const length = woff.readUInt32BE(entry + 12);
    const raw = woff.subarray(offset, offset + stored);
    const data = stored < length ? inflateSync(raw) : raw;
    if (data.length !== length) throw new Error('a WOFF table has the wrong length');
    return { tag: woff.readUInt32BE(entry), checksum: woff.readUInt32BE(entry + 16), data };
  });
  const power = 2 ** Math.floor(Math.log2(count));
  const header = Buffer.alloc(12 + 16 * count);
  header.writeUInt32BE(flavor, 0);
  header.writeUInt16BE(count, 4);
  header.writeUInt16BE(power * 16, 6);
  header.writeUInt16BE(Math.log2(power), 8);
  header.writeUInt16BE(count * 16 - power * 16, 10);
  const chunks: Buffer[] = [header];
  let offset = header.length;
  tables.forEach((table, index) => {
    const record = 12 + index * 16;
    header.writeUInt32BE(table.tag, record);
    header.writeUInt32BE(table.checksum, record + 4);
    header.writeUInt32BE(offset, record + 8);
    header.writeUInt32BE(table.data.length, record + 12);
    const padded = (table.data.length + 3) & ~3;
    chunks.push(table.data, Buffer.alloc(padded - table.data.length));
    offset += padded;
  });
  return Buffer.concat(chunks);
}

/** The faces the export embeds (Roboto 400/500/700, Roboto Mono 400, latin), as sfnt files for resvg. */
function resvgFontFiles(): string[] {
  const require = createRequire(path.join(REPO_ROOT, 'frontend/package.json'));
  const dir = path.join(OUT_DIR, 'fonts');
  mkdirSync(dir, { recursive: true });
  const faces = [
    '@fontsource/roboto/files/roboto-latin-400-normal.woff',
    '@fontsource/roboto/files/roboto-latin-500-normal.woff',
    '@fontsource/roboto/files/roboto-latin-700-normal.woff',
    '@fontsource/roboto-mono/files/roboto-mono-latin-400-normal.woff',
  ];
  return faces.map((face) => {
    const file = path.join(dir, `${path.basename(face, '.woff')}.ttf`);
    writeFileSync(file, woffToSfnt(readFileSync(require.resolve(face))));
    return file;
  });
}

let fonts: string[] | null = null;

export interface Bitmap {
  readonly width: number;
  readonly height: number;
  /** RGBA, row by row. */
  readonly data: Uint8Array;
}

/**
 * An SVG rendered by resvg at a zoom, on the app's Roboto files only (no system fonts), on a background colour
 * (transparent by default).
 */
export function renderWithResvg(
  svg: string,
  zoom = 1,
  background?: string,
): Bitmap & { readonly png: Buffer } {
  fonts ??= resvgFontFiles();
  const rendered = new Resvg(svg, {
    ...(background === undefined ? {} : { background }),
    font: {
      loadSystemFonts: false,
      fontFiles: fonts,
      defaultFontFamily: 'Roboto',
      sansSerifFamily: 'Roboto',
      monospaceFamily: 'Roboto Mono',
    },
    fitTo: zoom === 1 ? { mode: 'original' } : { mode: 'zoom', value: zoom },
  }).render();
  return { width: rendered.width, height: rendered.height, data: rendered.pixels, png: rendered.asPng() };
}

export function decodePng(bytes: Buffer): Bitmap {
  const png = PNG.sync.read(bytes);
  return { width: png.width, height: png.height, data: png.data };
}

/** The size in a PNG's header, without decoding it. */
export function pngSize(bytes: Buffer): { width: number; height: number } {
  if (bytes.toString('latin1', 1, 4) !== 'PNG' || bytes.toString('latin1', 12, 16) !== 'IHDR') {
    throw new Error('not a PNG');
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

export function crop(image: Bitmap, x: number, y: number, width: number, height: number): Bitmap {
  const data = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    const from = ((y + row) * image.width + x) * 4;
    data.set(image.data.subarray(from, from + width * 4), row * width * 4);
  }
  return { width, height, data };
}

/** The colour at a pixel, `#rrggbb` (alpha ignored). */
export function colourAt(image: Bitmap, x: number, y: number): string {
  const at = (y * image.width + x) * 4;
  return `#${[0, 1, 2]
    .map((channel) => (image.data[at + channel] ?? 0).toString(16).padStart(2, '0'))
    .join('')}`.toUpperCase();
}

/** Whether every pixel of a region has one colour. */
export function uniform(image: Bitmap, x: number, y: number, width: number, height: number): boolean {
  const first = colourAt(image, x, y);
  for (let row = y; row < y + height; row += 1) {
    for (let column = x; column < x + width; column += 1) {
      if (colourAt(image, column, row) !== first) return false;
    }
  }
  return true;
}

/**
 * Compares two equally sized bitmaps with pixelmatch (YIQ threshold 0.1, anti-aliased pixels not counted) and
 * writes the diff image next to the exports. Returns the share of mismatched pixels.
 */
export function mismatch(a: Bitmap, b: Bitmap, diffName: string): number {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(
      `size differs: ${String(a.width)}×${String(a.height)} vs ${String(b.width)}×${String(b.height)}`,
    );
  }
  const diff = new PNG({ width: a.width, height: a.height });
  const count = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1 });
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(path.join(OUT_DIR, diffName), PNG.sync.write(diff));
  return count / (a.width * a.height);
}
