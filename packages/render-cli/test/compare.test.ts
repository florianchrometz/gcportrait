// SPDX-License-Identifier: MIT
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { checkGolden, comparePng, decodePng, encodePng, samePixels } from '../src/index.js';
import { tempDirs } from './helpers.js';

function solid(width: number, height: number, rgba: readonly number[]): Buffer {
  const data = new Uint8Array(width * height * 4);
  for (let at = 0; at < data.length; at += 4) data.set(rgba, at);
  return encodePng({ width, height, data });
}

function withPixel(png: Buffer, x: number, rgba: readonly number[]): Buffer {
  const image = decodePng(png);
  const data = image.data.slice();
  data.set(rgba, x * 4);
  return encodePng({ ...image, data });
}

const white = solid(8, 4, [255, 255, 255, 255]);
const tempDir = tempDirs('gcportrait-render-golden-');

describe('PNG comparison', () => {
  it('round-trips through the decoder and encoder', () => {
    const image = decodePng(white);
    expect(image).toMatchObject({ width: 8, height: 4 });
    expect(samePixels(encodePng(image), white)).toBe(true);
  });

  it('is tolerance-free in samePixels, even for one channel step', () => {
    expect(samePixels(white, withPixel(white, 3, [255, 255, 254, 255]))).toBe(false);
    expect(samePixels(white, solid(8, 5, [255, 255, 255, 255]))).toBe(false);
  });

  it('counts differing pixels with pixelmatch and draws them', () => {
    const changed = withPixel(withPixel(white, 1, [0, 0, 0, 255]), 6, [32, 33, 36, 255]);
    const diff = comparePng(changed, white, { diffImage: true });
    expect(diff).toMatchObject({ width: 8, height: 4, sizeMismatch: false, diffPixels: 2, ratio: 2 / 32 });
    expect(decodePng(diff.diff ?? Buffer.alloc(0))).toMatchObject({ width: 8, height: 4 });
    expect(comparePng(white, white)).toMatchObject({ diffPixels: 0, ratio: 0 });
    expect(comparePng(white, solid(9, 4, [255, 255, 255, 255]))).toMatchObject({
      sizeMismatch: true,
      diffPixels: 36,
      ratio: 1,
    });
    // A faint difference passes a lenient threshold and fails the default (0).
    const faint = withPixel(white, 2, [250, 250, 250, 255]);
    expect(comparePng(faint, white).diffPixels).toBe(1);
    expect(comparePng(faint, white, { threshold: 0.2 }).diffPixels).toBe(0);
  });
});

describe('checkGolden', () => {
  it('writes a golden in update mode and matches it exactly afterwards', () => {
    const dir = tempDir();
    const golden = path.join(dir, 'nested/S-overview-auto-light.png');
    expect(checkGolden(white, golden).status).toBe('missing');
    expect(checkGolden(white, golden, { update: true }).status).toBe('updated');
    expect(readFileSync(golden).equals(white)).toBe(true);
    expect(checkGolden(white, golden)).toMatchObject({
      status: 'match',
      message: 'S-overview-auto-light: identical pixels',
    });
  });

  it('fails an exact check on any difference and leaves the actual image and the differences', () => {
    const dir = tempDir();
    const golden = path.join(dir, 'g.png');
    checkGolden(white, golden, { update: true });
    const result = checkGolden(withPixel(white, 0, [0, 0, 0, 255]), golden, {
      failureDir: path.join(dir, 'failed'),
    });
    expect(result.status).toBe('mismatch');
    expect(result.message).toMatch(/1 of 32 pixels differ \(tolerance-free\)/);
    expect(result.artefacts?.actual).toBe(path.join(dir, 'failed/g.actual.png'));
    expect(decodePng(readFileSync(result.artefacts?.diff ?? ''))).toMatchObject({ width: 8, height: 4 });
    const size = checkGolden(solid(2, 2, [0, 0, 0, 255]), golden);
    expect(size).toMatchObject({ status: 'mismatch' });
    expect(size.artefacts).toBeUndefined();
    expect(size.message).toMatch(/size 8×4 differs/);
  });

  it.each([
    ['one colour step', withPixel(white, 0, [255, 255, 254, 255])],
    ['one alpha step', withPixel(white, 0, [255, 255, 255, 254])],
    ['two pixels', withPixel(withPixel(white, 0, [0, 0, 0, 255]), 5, [0, 0, 0, 255])],
  ])('rejects %s even when an older caller supplies tolerance options', (_name, changed) => {
    const dir = tempDir();
    const golden = path.join(dir, 'g.png');
    checkGolden(white, golden, { update: true });
    const options = {
      exact: false,
      maxDiffPixels: 2,
      threshold: 0.2,
      failureDir: path.join(dir, 'failed'),
    };
    const result = checkGolden(changed, golden, options);
    expect(result.status).toBe('mismatch');
    expect(result.message).not.toContain('allowed');
    expect(readFileSync(result.artefacts?.actual ?? '').equals(changed)).toBe(true);
  });
});
