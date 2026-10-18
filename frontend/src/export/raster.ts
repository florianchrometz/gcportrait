// SPDX-License-Identifier: MIT
/**
 * PNG export (skill gcp-diagram-style §8): the export SVG drawn on a canvas at 2× (3× on request), on the
 * theme's canvas colour, with a 24 px margin (drawing units, so 48 px at 2×). Browsers cap a canvas's side and
 * area; a diagram too large for the asked scale is drawn at the largest scale that fits, and the caller says so.
 *
 * Fonts: an SVG drawn as an image cannot use the page's fonts, so the PNG's SVG embeds the Roboto faces
 * (fonts.ts). Chromium loads those inside the image asynchronously, after `decode()` has resolved, and paints
 * text invisible until then. So the PNG's SVG carries one small "sentinel" glyph per embedded face in its top
 * margin band; the canvas draws only that band until every sentinel shows, then draws the image, and paints the
 * band over with the background again (it lies in the margin, outside the diagram's frame).
 */
import type { Rect } from '@gcportrait/layout';
import {
  RENDER_DEFAULT_SCALE,
  RENDER_MAX_SCALE,
  RENDER_PNG_LIMITS,
  RENDER_PNG_MARGIN,
  type PngGeometry,
} from '@gcportrait/model';

import { parseHex } from '../diagram/theme/contrast';
import { EMBEDDED_FACES, type EmbeddedFace } from './fonts';
import { pngGeometry as sharedPngGeometry } from './pngGeometry';
import { svgChild, type PreparedSvg } from './serialize';

/** Space around the exported frame, in drawing units. */
export const PNG_MARGIN = RENDER_PNG_MARGIN;

export const PNG_SCALES = [RENDER_DEFAULT_SCALE, RENDER_MAX_SCALE] as const;
export type PngScale = (typeof PNG_SCALES)[number];

/**
 * The largest canvas this app draws: 16 384 px a side (the smallest per-side cap of the desktop browsers) and
 * 2^27 px in all (half Chromium's area cap, about 512 MB of pixels).
 */
export const CANVAS_LIMITS = RENDER_PNG_LIMITS;
export type { PngGeometry } from '@gcportrait/model';

/**
 * The PNG for a frame of `frame.width` × `frame.height` drawing units at `scale`: (frame + 2 × margin) × scale,
 * rounded up to whole pixels. When that exceeds the limits, the scale drops to the largest two-decimal value
 * that fits.
 */
export function pngGeometry(
  frame: Pick<Rect, 'width' | 'height'>,
  scale: number,
  margin: number = PNG_MARGIN,
  limits: { readonly side: number; readonly area: number } = CANVAS_LIMITS,
): PngGeometry {
  return sharedPngGeometry(frame, { scale, margin, maxSide: limits.side, maxPixels: limits.area });
}

/** "2×", "1.83×". */
export function scaleLabel(scale: number): string {
  return `${String(Math.round(scale * 100) / 100)}×`;
}

/** The sentinels' glyph, size and spacing in drawing units; the band they sit in is `SENTINEL_BAND` tall. */
const SENTINEL = Object.freeze({ glyph: 'M', size: 10, pitch: 12, left: 2, baseline: 12, colour: '#7F7F7F' });
const SENTINEL_BAND = 14;

/** Where each face's sentinel lands on the canvas, in pixels (from the image's top-left corner). */
export function sentinelBoxes(
  geometry: PngGeometry,
  faces: readonly EmbeddedFace[] = EMBEDDED_FACES,
): Rect[] {
  return faces.map((_, index) => ({
    x: Math.floor((SENTINEL.left + index * SENTINEL.pitch) * geometry.scale),
    y: 0,
    width: Math.ceil(SENTINEL.pitch * geometry.scale),
    height: Math.ceil(SENTINEL_BAND * geometry.scale),
  }));
}

/** The band the sentinels occupy, painted over once the image is drawn. Inside the top margin. */
export function sentinelBand(geometry: PngGeometry, faces: readonly EmbeddedFace[] = EMBEDDED_FACES): Rect {
  return {
    x: 0,
    y: 0,
    width: Math.ceil((SENTINEL.left + faces.length * SENTINEL.pitch) * geometry.scale),
    height: Math.ceil(SENTINEL_BAND * geometry.scale),
  };
}

/**
 * Turns a prepared export into the PNG's source: the frame grown by the margin on every side and filled with
 * the theme's canvas colour, the root sized in pixels so the image is drawn at the geometry's scale (rounding
 * the pixel size up only widens the right and bottom margin, never stretches the drawing), and the font
 * sentinels in the top margin.
 */
export function addRasterFrame(prepared: PreparedSvg, geometry: PngGeometry, background: string): void {
  const { svg, frame } = prepared;
  const document = svg.ownerDocument;
  const box: Rect = {
    x: frame.x - geometry.margin,
    y: frame.y - geometry.margin,
    width: geometry.width / geometry.scale,
    height: geometry.height / geometry.scale,
  };
  svg.setAttribute('width', String(geometry.width));
  svg.setAttribute('height', String(geometry.height));
  svg.setAttribute('viewBox', `${String(box.x)} ${String(box.y)} ${String(box.width)} ${String(box.height)}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  const fill = svgChild(document, 'rect', {
    class: 'dg-export-margin',
    x: String(box.x),
    y: String(box.y),
    width: String(box.width),
    height: String(box.height),
    fill: background,
  });
  const sentinels = svgChild(document, 'g', { class: 'dg-font-sentinels', 'aria-hidden': 'true' });
  EMBEDDED_FACES.forEach((face, index) => {
    const text = svgChild(document, 'text', {
      x: String(box.x + SENTINEL.left + index * SENTINEL.pitch),
      y: String(box.y + SENTINEL.baseline),
      'font-family': `'${face.family}'`,
      'font-weight': String(face.weight),
      'font-size': String(SENTINEL.size),
      fill: SENTINEL.colour,
    });
    text.textContent = SENTINEL.glyph;
    sentinels.append(text);
  });
  const drawing = svg.querySelector('.dg-drawing');
  if (drawing === null) svg.append(fill, sentinels);
  else drawing.before(fill, sentinels);
}

/** How long to wait for the embedded fonts before drawing anyway (the browser then shows its fallback font). */
const FONT_WAIT_MS = 5_000;
const FONT_POLL_MS = 20;

/** Whether a canvas region has a pixel that differs from the background (a painted glyph). */
function painted(context: CanvasRenderingContext2D, box: Rect, background: readonly number[]): boolean {
  const { data } = context.getImageData(box.x, box.y, Math.max(1, box.width), Math.max(1, box.height));
  for (let at = 0; at < data.length; at += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      if (Math.abs((data[at + channel] ?? 0) - (background[channel] ?? 0)) > 16) return true;
    }
  }
  return false;
}

const pause = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Draws the PNG's SVG (from `addRasterFrame`) on a canvas filled with `background` and encodes it as PNG. The SVG
 * goes in as a `data:` URL: the production CSP allows images from `data:`, and an SVG image drawn from one does
 * not taint the canvas.
 */
export async function rasterizeSvg(
  svgText: string,
  geometry: PngGeometry,
  background: string,
): Promise<Blob> {
  const image = new Image();
  image.decoding = 'async';
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
  await image.decode();
  const rgb = parseHex(background);
  const band = sentinelBand(geometry);
  const boxes = sentinelBoxes(geometry);
  // The sentinels are polled on a canvas of the band's size; the image itself is drawn once, on the PNG's.
  const probe = document.createElement('canvas');
  probe.width = band.width;
  probe.height = band.height;
  const probeContext = probe.getContext('2d', { willReadFrequently: true });
  if (probeContext === null) throw new Error('This browser cannot draw the PNG (no 2D canvas).');
  const started = performance.now();
  for (;;) {
    probeContext.fillStyle = background;
    probeContext.fillRect(0, 0, band.width, band.height);
    probeContext.drawImage(image, band.x, band.y, band.width, band.height, 0, 0, band.width, band.height);
    if (boxes.every((box) => painted(probeContext, box, rgb))) break;
    if (performance.now() - started > FONT_WAIT_MS) break;
    await pause(FONT_POLL_MS);
  }
  const canvas = document.createElement('canvas');
  canvas.width = geometry.width;
  canvas.height = geometry.height;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('This browser cannot draw the PNG (no 2D canvas).');
  context.fillStyle = background;
  context.fillRect(0, 0, geometry.width, geometry.height);
  context.drawImage(image, 0, 0, geometry.width, geometry.height);
  context.fillRect(band.x, band.y, band.width, band.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) reject(new Error('The browser could not encode the PNG.'));
      else resolve(blob);
    }, 'image/png');
  });
}
