// SPDX-License-Identifier: MIT
/**
 * The WebAssembly rasteriser against the native binding: `@resvg/resvg-wasm` and `@resvg/resvg-js` (a dev
 * dependency, used here only) at the same version, with the same fonts, must give the same PNG bytes for six
 * demo views and for a capped geometry. Both are builds of one resvg release, so the first test holds them to
 * one version, each pinned exactly in package.json (pins.ts), and a bump of one without the other fails it
 * with that as the reason. The native side is set up step for step like the WebAssembly one: the faces
 * unwrapped to font files, system fonts off.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { normalizeViewSpec, type DemoSize, type LensId } from '@gcportrait/model';
import { Resvg as NativeResvg } from '@resvg/resvg-js';
import { afterAll, describe, expect, it } from 'vitest';

import {
  createDemoViews,
  drawPng,
  drawSvg,
  fontBuffers,
  fontFiles,
  framedSvg,
  PALETTES,
  pngGeometry,
  svgFrame,
  type DiagramTheme,
} from '../src/index.js';
import { exactPin } from './pins.js';

const fontDir = mkdtempSync(path.join(tmpdir(), 'gcportrait-render-parity-'));
afterAll(() => {
  rmSync(fontDir, { recursive: true, force: true });
});

/** The faces as files, in loading order, as the native binding loads them. */
const nativeFonts = fontBuffers(fontFiles().map((file) => readFileSync(file))).map((sfnt, index) => {
  const file = path.join(fontDir, `${String(index).padStart(2, '0')}.ttf`);
  writeFileSync(file, sfnt);
  return file;
});

function nativePng(svg: string, theme: DiagramTheme, scale: number, maxPixels?: number): Buffer {
  const frame = svgFrame(svg);
  const geometry = pngGeometry(frame, { scale, ...(maxPixels === undefined ? {} : { maxPixels }) });
  const image = new NativeResvg(framedSvg(svg, frame, geometry), {
    font: {
      loadSystemFonts: false,
      fontFiles: nativeFonts,
      defaultFontFamily: 'Roboto',
      sansSerifFamily: 'Roboto',
      serifFamily: 'Roboto',
      monospaceFamily: 'Roboto Mono',
    },
    fitTo: { mode: 'original' },
    background: PALETTES[theme].canvas,
    logLevel: 'error',
  }).render();
  return image.asPng();
}

const views = createDemoViews();
const spec = (fixture: DemoSize, lens: LensId) => normalizeViewSpec({ snapshot: `demo:${fixture}`, lens });

describe('resvg-wasm against the native binding', () => {
  it('compares the two builds at one version, each pinned exactly', () => {
    expect(exactPin('@resvg/resvg-js'), '@resvg/resvg-js at the version of @resvg/resvg-wasm').toBe(
      exactPin('@resvg/resvg-wasm'),
    );
  });

  it.each([
    ['S', 'overview', 'light', 2],
    ['S', 'overview', 'dark', 2],
    ['M', 'networking', 'light', 2],
    ['M', 'networking', 'dark', 1],
    ['M', 'security', 'dark', 3],
    ['L', 'overview', 'light', 3],
  ] as const)('draws %s %s %s at %i× to the same bytes', async (fixture, lens, theme, scale) => {
    const svg = drawSvg(await views.prepare(fixture, spec(fixture, lens)), theme);
    const wasm = drawPng(svg, theme, { scale });
    expect(wasm.capped).toBe(false);
    expect(wasm.png.equals(nativePng(svg, theme, scale))).toBe(true);
  });

  it('draws a capped PNG (the backend’s pixel limit) to the same bytes', async () => {
    const svg = drawSvg(await views.prepare('M', spec('M', 'overview')), 'light');
    const wasm = drawPng(svg, 'light', { scale: 3, maxPixels: 4_000_000 });
    expect(wasm.capped).toBe(true);
    expect(wasm.width * wasm.height).toBeLessThanOrEqual(4_000_000);
    expect(wasm.png.equals(nativePng(svg, 'light', 3, 4_000_000))).toBe(true);
  });
});
