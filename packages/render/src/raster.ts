// SPDX-License-Identifier: MIT
/**
 * SVG → PNG with resvg, by the export rules of skill gcp-diagram-style §8: 2× by default (`scale` up to 3, or a
 * target `width` in pixels), on the theme's canvas colour, with a 24 px margin (drawing units) around the drawing.
 * The rasteriser is resvg's WebAssembly build (`@resvg/resvg-wasm`, pinned exactly: the pixels depend on its
 * version), so the same SVG gives the same pixels on every platform, in `pnpm render` and in the
 * backend alike. Text is set with the self-hosted Roboto faces only (no system fonts exist for wasm), so "Google
 * Sans" in the label stack falls through to Roboto, whose advances the layout measured.
 *
 * The geometry is the app's PNG export's: (frame + 2 × margin) × scale, rounded up to whole pixels (the
 * rounding only widens the right and bottom margin), and a diagram too large for the canvas limits browsers impose
 * (or for a smaller `maxPixels`, the backend's RENDER_MAX_PIXELS) is drawn at the largest two-decimal scale that
 * fits, so nothing draws a PNG the app could not.
 *
 * `initRasteriser` must have finished once per thread before `rasterise` runs: it instantiates the WebAssembly
 * module and unwraps the fonts. The module's memory grows with the largest PNG drawn and is never given back
 * while the thread lives (about 10 bytes per pixel), which is why the backend draws each render in a fresh worker.
 */
import { Resvg, initWasm } from '@resvg/resvg-wasm';
import { pngGeometry as sharedPngGeometry, PngGeometryError } from '@gcportrait/frontend';
import { RENDER_PNG_LIMITS, type PngGeometry as SharedPngGeometry } from '@gcportrait/model';

import { packageAssets, type RenderAssets } from './assets.js';
import { fontBuffers } from './fonts.js';

/** The largest PNG: 16 384 px a side and 2^27 px in all, the limits of the app's export canvas. */
export const RASTER_LIMITS = RENDER_PNG_LIMITS;

export interface RasterOptions {
  /** The theme's canvas colour, under everything and in the margin. */
  readonly background: string;
  /** Pixels per drawing unit; default 2. Ignored when `width` is given. */
  readonly scale?: number;
  /** The PNG's width in pixels, margin included; the height follows the drawing's aspect. */
  readonly width?: number;
  /** Drawing units of background around the drawing; default 24. */
  readonly margin?: number;
  /** At most this many pixels in all (never more than `RASTER_LIMITS.area`); default `RASTER_LIMITS.area`. */
  readonly maxPixels?: number;
}

export interface Raster {
  readonly png: Buffer;
  readonly width: number;
  readonly height: number;
  /** Pixels per drawing unit actually used. */
  readonly scale: number;
  readonly margin: number;
  /** The request was larger than the limits and was drawn smaller. */
  readonly capped: boolean;
}

export class RasterError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RasterError';
  }
}

/** The drawing's frame: the root element's viewBox (or its size, from the origin, without one). */
export interface Frame {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const ROOT = /<svg\b[^>]*>/;
const attribute = (tag: string, name: string): string | undefined =>
  new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

/** The frame of an SVG document, read from its root element. */
export function svgFrame(svg: string): Frame {
  const root = ROOT.exec(svg)?.[0];
  if (root === undefined) throw new RasterError('no <svg> root element');
  const viewBox = attribute(root, 'viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  const [x, y, width, height] =
    viewBox?.length === 4
      ? viewBox
      : [0, 0, Number(attribute(root, 'width')), Number(attribute(root, 'height'))];
  if (
    ![x, y, width, height].every((value) => Number.isFinite(value)) ||
    !((width ?? 0) > 0) ||
    !((height ?? 0) > 0)
  ) {
    throw new RasterError('the SVG root element has no positive size');
  }
  return { x: x ?? 0, y: y ?? 0, width: width ?? 0, height: height ?? 0 };
}

export type PngGeometry = Omit<SharedPngGeometry, 'reduced'> & { readonly capped: boolean };

/** The PNG's pixel size and scale for a frame (see the module comment). */
export function pngGeometry(
  frame: Pick<Frame, 'width' | 'height'>,
  options: Pick<RasterOptions, 'scale' | 'width' | 'margin' | 'maxPixels'> = {},
): PngGeometry {
  try {
    const { reduced, ...geometry } = sharedPngGeometry(frame, options);
    return { ...geometry, capped: reduced };
  } catch (error) {
    if (error instanceof PngGeometryError) throw new RasterError(error.message, { cause: error });
    throw error;
  }
}

/**
 * The SVG with its root sized to the PNG's pixels and its viewBox grown by the margin (only the right and bottom
 * margin take up the rounding); nothing inside the root changes.
 */
export function framedSvg(svg: string, frame: Frame, geometry: PngGeometry): string {
  const box = {
    x: frame.x - geometry.margin,
    y: frame.y - geometry.margin,
    width: geometry.width / geometry.scale,
    height: geometry.height / geometry.scale,
  };
  return svg.replace(ROOT, (root) => {
    const kept = root
      .replace(/\s(?:width|height|viewBox|preserveAspectRatio)="[^"]*"/g, '')
      .replace(/^<svg\b/, '')
      .replace(/\/?>$/, '');
    const selfClosing = root.endsWith('/>') ? '/' : '';
    return (
      `<svg width="${String(geometry.width)}" height="${String(geometry.height)}" ` +
      `viewBox="${String(box.x)} ${String(box.y)} ${String(box.width)} ${String(box.height)}" ` +
      `preserveAspectRatio="none"${kept}${selfClosing}>`
    );
  });
}

/** The thread's rasteriser: the WebAssembly module instantiated and the faces unwrapped, once. */
let started: Promise<void> | undefined;
let faces: Uint8Array[] | undefined;

/**
 * Starts the rasteriser in this thread with `assets` (default: the installed packages). Idempotent: later calls
 * return the first call's promise, whatever assets they name.
 */
export function initRasteriser(assets?: RenderAssets): Promise<void> {
  started ??= (async () => {
    const source = assets ?? packageAssets();
    await initWasm(source.wasm);
    faces = fontBuffers(source.fonts);
  })();
  return started;
}

export function rasterise(svg: string, options: RasterOptions): Raster {
  if (faces === undefined) throw new RasterError('the rasteriser has not been started (initRasteriser)');
  const frame = svgFrame(svg);
  const geometry = pngGeometry(frame, options);
  const resvg = new Resvg(framedSvg(svg, frame, geometry), {
    font: {
      fontBuffers: faces,
      defaultFontFamily: 'Roboto',
      sansSerifFamily: 'Roboto',
      serifFamily: 'Roboto',
      monospaceFamily: 'Roboto Mono',
    },
    fitTo: { mode: 'original' },
    background: options.background,
  });
  try {
    const image = resvg.render();
    try {
      if (image.width !== geometry.width || image.height !== geometry.height) {
        throw new RasterError(
          `resvg drew ${String(image.width)}×${String(image.height)} px instead of ${String(geometry.width)}×${String(geometry.height)}`,
        );
      }
      const png = image.asPng();
      return { png: Buffer.from(png.buffer, png.byteOffset, png.byteLength), ...geometry };
    } finally {
      image.free();
    }
  } finally {
    resvg.free();
  }
}
