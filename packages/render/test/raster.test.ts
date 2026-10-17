// SPDX-License-Identifier: MIT
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { defaultFontMetrics, measureText } from '@gcportrait/layout';
import { pngGeometry as appPngGeometry } from '@gcportrait/frontend';
import { PNG } from 'pngjs';
import { beforeAll, describe, expect, it } from 'vitest';

import { faceFiles, FONT_FACES, fontBuffers, fontFiles, fontPackageVersions } from '../src/fonts.js';
import { initRasteriser, svgFrame } from '../src/index.js';
import { framedSvg, pngGeometry, RasterError, rasterise } from '../src/raster.js';

beforeAll(async () => {
  await initRasteriser();
});

describe('PNG geometry boundaries', () => {
  it.each([
    [{ width: 52, height: 6570 }, { scale: 3 }],
    [{ width: 352, height: 52 }, { width: 999 }],
    [
      { width: 2333, height: 1326.5 },
      { scale: 3, maxPixels: 2 ** 24 },
    ],
  ])('uses exactly the browser geometry for capped scales and requested widths', (frame, options) => {
    const { reduced, ...expected } = appPngGeometry(frame, options);
    expect(pngGeometry(frame, options)).toEqual({ ...expected, capped: reduced });
  });

  it.each([
    [{ width: 2_000_000, height: 1_000_000 }, {}],
    [{ width: 53, height: 53 }, { maxPixels: 2 }],
  ])('refuses a frame with no positive capped scale within the limits', (frame, options) => {
    expect(() => pngGeometry(frame, { scale: 3, ...options })).toThrow(RasterError);
    expect(() => pngGeometry(frame, { scale: 3, ...options })).toThrow(/cannot fit.*PNG.*limits/i);
  });
});

function decodePng(bytes: Uint8Array): { width: number; height: number; data: Uint8Array } {
  const png = PNG.sync.read(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  return { width: png.width, height: png.height, data: new Uint8Array(png.data) };
}

const svgWith = (body: string, width = 200, height = 40): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${String(width)}" height="${String(height)}" viewBox="0 0 ${String(width)} ${String(height)}">${body}</svg>`;

/** The leftmost and rightmost columns holding a dark pixel. */
function inkColumns(png: Buffer): { first: number; last: number } {
  const image = decodePng(png);
  let first = image.width;
  let last = -1;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if ((image.data[(y * image.width + x) * 4] ?? 255) < 128) {
        first = Math.min(first, x);
        last = Math.max(last, x);
      }
    }
  }
  return { first, last };
}

describe('fonts', () => {
  it('uses the font package versions the layout metrics table was generated from', () => {
    expect(fontPackageVersions()).toEqual(defaultFontMetrics().sources);
  });

  it('loads the Latin subset of every face first', () => {
    for (const face of FONT_FACES) {
      const files = faceFiles(face).map((file) => path.basename(file));
      expect(files[0]).toBe(`${face.prefix}-latin-${String(face.weight)}-normal.woff`);
      expect(files[1]).toBe(`${face.prefix}-latin-ext-${String(face.weight)}-normal.woff`);
      expect(files.length).toBeGreaterThan(4);
    }
  });

  it('unwraps every face in memory, in loading order, TrueType throughout', () => {
    const files = fontFiles();
    expect(files.length).toBe(FONT_FACES.reduce((sum, face) => sum + faceFiles(face).length, 0));
    expect(path.basename(files[0] ?? '')).toBe('roboto-latin-400-normal.woff');
    const buffers = fontBuffers(files.map((file) => readFileSync(file)));
    expect(buffers).toHaveLength(files.length);
    for (const sfnt of buffers)
      expect(new DataView(sfnt.buffer, sfnt.byteOffset, 4).getUint32(0)).toBe(0x00010000);
  });
});

describe('rasterise', () => {
  it('draws text in Roboto with the advances the layout measured, not in a system font', () => {
    const text = 'gcportrait demo-web-1';
    const expected = measureText(text, 700, 20);
    const draw = (x: number, anchor: 'start' | 'end'): { first: number; last: number } =>
      inkColumns(
        rasterise(
          svgWith(
            `<text x="${String(x)}" y="28" font-size="20" font-weight="700" text-anchor="${anchor}" ` +
              `font-family="'Google Sans', Roboto, system-ui, sans-serif">${text}</text>`,
            300,
          ),
          { background: '#FFFFFF', scale: 1, margin: 0 },
        ).png,
      );
    // Anchored at its end `expected` px further right, the text starts where the start-anchored one does when
    // the rasteriser's advances are the table's (give or take Roboto's kerning, which the table leaves out and
    // the rasteriser applies, as a browser does).
    const atStart = draw(10, 'start');
    const atEnd = draw(10 + expected, 'end');
    expect(atStart.first).toBeGreaterThanOrEqual(10);
    expect(Math.abs(atEnd.first - atStart.first)).toBeLessThanOrEqual(1);
    expect(Math.abs(atEnd.last - atStart.last)).toBeLessThanOrEqual(1);
    // Any other face would be far off: Roboto Mono, for one, sets the same text much wider.
    expect(measureText(text, 400, 20, { family: 'mono' }) - expected).toBeGreaterThan(20);
  });

  it('draws at 2× by default with a 24 px margin, at the given scale, or at the given width', () => {
    const svg = svgWith('<rect x="0" y="0" width="100" height="20" fill="#202124"/>');
    expect(rasterise(svg, { background: '#FFFFFF' })).toMatchObject({
      width: (200 + 48) * 2,
      height: (40 + 48) * 2,
      scale: 2,
      margin: 24,
      capped: false,
    });
    expect(rasterise(svg, { background: '#FFFFFF', scale: 3, margin: 0 })).toMatchObject({
      width: 600,
      height: 120,
    });
    const sized = rasterise(svg, { background: '#1F1F1F', width: 500 });
    expect(sized).toMatchObject({ width: 500, height: Math.ceil((88 * 500) / 248), scale: 500 / 248 });
    const image = decodePng(sized.png);
    // The margin is the background colour; the drawing starts 24 units in.
    expect(Array.from(image.data.subarray(0, 4))).toEqual([0x1f, 0x1f, 0x1f, 255]);
    const inside = Math.ceil(25 * sized.scale);
    expect(
      Array.from(
        image.data.subarray((inside * image.width + inside) * 4, (inside * image.width + inside) * 4 + 4),
      ),
    ).toEqual([0x20, 0x21, 0x24, 255]);
  });

  it('reads the frame from the root, grows only the root by the margin, and lowers a scale past the limits', () => {
    const root =
      '<svg xmlns="http://www.w3.org/2000/svg" width="2333" height="1326.5" viewBox="0 -78 2333 1326.5" data-theme="light">';
    const svg = `<?xml version="1.0"?>\n${root}<rect width="1" height="1" stroke-width="2"/></svg>`;
    const frame = svgFrame(svg);
    expect(frame).toEqual({ x: 0, y: -78, width: 2333, height: 1326.5 });
    expect(svgFrame('<svg width="10" height="20">')).toEqual({ x: 0, y: 0, width: 10, height: 20 });
    expect(() => svgFrame('<svg viewBox="0 0 10">')).toThrow(RasterError);
    expect(() => svgFrame('<svg width="0" height="10">')).toThrow(RasterError);
    expect(() => svgFrame('<g/>')).toThrow(RasterError);
    const geometry = pngGeometry(frame);
    expect(geometry).toEqual({ width: 4762, height: 2749, scale: 2, margin: 24, capped: false });
    expect(framedSvg(svg, frame, geometry)).toBe(
      '<?xml version="1.0"?>\n<svg width="4762" height="2749" viewBox="-24 -102 2381 1374.5" preserveAspectRatio="none" ' +
        'xmlns="http://www.w3.org/2000/svg" data-theme="light"><rect width="1" height="1" stroke-width="2"/></svg>',
    );
    expect(() => pngGeometry({ width: 400, height: 100 }, { scale: 0 })).toThrow(RasterError);
    expect(() => pngGeometry({ width: 10, height: 10 }, { maxPixels: 0 })).toThrow(RasterError);
  });
});
