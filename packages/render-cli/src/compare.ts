// SPDX-License-Identifier: MIT
/**
 * PNG comparison for the render goldens and for agents' before/after checks. `samePixels` is the
 * tolerance-free check (same size, same RGBA bytes); `comparePng` counts differing pixels with pixelmatch
 * (`threshold` 0 = any colour difference counts) and can draw the differences, for renders too large to keep
 * as committed goldens.
 */
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

export interface DecodedPng {
  readonly width: number;
  readonly height: number;
  /** RGBA, row by row. */
  readonly data: Uint8Array;
}

export function decodePng(bytes: Uint8Array): DecodedPng {
  const png = PNG.sync.read(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  return { width: png.width, height: png.height, data: new Uint8Array(png.data) };
}

export function encodePng(image: DecodedPng): Buffer {
  const png = new PNG({ width: image.width, height: image.height });
  png.data = Buffer.from(image.data);
  return PNG.sync.write(png);
}

/** Tolerance-free: the two PNGs decode to the same size and the same RGBA bytes. */
export function samePixels(actual: Uint8Array, expected: Uint8Array): boolean {
  const a = decodePng(actual);
  const b = decodePng(expected);
  return a.width === b.width && a.height === b.height && Buffer.from(a.data).equals(Buffer.from(b.data));
}

export interface CompareOptions {
  /** pixelmatch's colour threshold, 0–1; default 0 (any difference counts). */
  readonly threshold?: number;
  /** Count anti-aliased pixels as differences too; default true (pixelmatch's own default skips them). */
  readonly includeAA?: boolean;
  /** Also return an image with the differing pixels marked. */
  readonly diffImage?: boolean;
}

export interface PngDiff {
  readonly width: number;
  readonly height: number;
  /** The sizes differ; nothing else was compared and `diffPixels` counts every pixel of the larger area. */
  readonly sizeMismatch: boolean;
  readonly diffPixels: number;
  /** `diffPixels` over the number of pixels compared. */
  readonly ratio: number;
  readonly diff?: Buffer;
}

export function comparePng(actual: Uint8Array, expected: Uint8Array, options: CompareOptions = {}): PngDiff {
  const a = decodePng(actual);
  const b = decodePng(expected);
  if (a.width !== b.width || a.height !== b.height) {
    const width = Math.max(a.width, b.width);
    const height = Math.max(a.height, b.height);
    return { width, height, sizeMismatch: true, diffPixels: width * height, ratio: 1 };
  }
  const output = options.diffImage === true ? new Uint8Array(a.data.length) : undefined;
  const diffPixels = pixelmatch(a.data, b.data, output, a.width, a.height, {
    threshold: options.threshold ?? 0,
    includeAA: options.includeAA ?? true,
  });
  const result = {
    width: a.width,
    height: a.height,
    sizeMismatch: false,
    diffPixels,
    ratio: a.width * a.height === 0 ? 0 : diffPixels / (a.width * a.height),
  };
  return output === undefined
    ? result
    : { ...result, diff: encodePng({ width: a.width, height: a.height, data: output }) };
}
