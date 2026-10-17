// @vitest-environment node
// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { PngGeometrySchema } from '@gcportrait/model';
import { pngGeometry } from './pngGeometry';

import { EMBEDDED_FACES } from './fonts';
import {
  CANVAS_LIMITS,
  pngGeometry as browserPngGeometry,
  PNG_MARGIN,
  scaleLabel,
  sentinelBand,
  sentinelBoxes,
} from './raster';

describe('pngGeometry', () => {
  it('refuses a positive scale whose inverse frame cannot be represented', () => {
    expect(() => pngGeometry({ width: 400, height: 100 }, { scale: Number.MIN_VALUE })).toThrow(
      /cannot be represented/,
    );
  });

  it.each([1, 247, 301, 999, 16_384])(
    'honours a target width of %s without rounding up by a pixel',
    (width) => {
      const geometry = pngGeometry({ width: 52, height: 1 }, { width });
      expect(geometry).toMatchObject({ width, scale: width / 100, reduced: false });
      expect(PngGeometrySchema.safeParse(geometry).success).toBe(true);
    },
  );

  it.each([0.001, 1e-20])('keeps a valid explicit scale %s positive', (scale) => {
    const geometry = pngGeometry({ width: 400, height: 100 }, { scale });
    expect(geometry).toMatchObject({ width: 1, height: 1, scale, reduced: false });
    expect(PngGeometrySchema.safeParse(geometry).success).toBe(true);
  });

  it('keeps a capped decimal scale on the intended whole-pixel boundary', () => {
    expect(pngGeometry({ width: 52, height: 6570 }, { scale: 3 })).toEqual({
      width: 247,
      height: 16347,
      scale: 2.47,
      margin: 24,
      reduced: true,
    });
  });

  it.each([
    [{ width: 2_000_000, height: 1_000_000 }, CANVAS_LIMITS],
    [
      { width: 53, height: 53 },
      { side: 16_384, area: 2 },
    ],
  ])('refuses a frame with no positive capped scale within the limits', (frame, limits) => {
    expect(() =>
      pngGeometry(frame, { scale: 3, margin: 24, maxSide: limits.side, maxPixels: limits.area }),
    ).toThrow(/cannot fit.*PNG.*limits/i);
  });

  it('is (frame + 2 × 24) × scale, rounded up to whole pixels', () => {
    expect(pngGeometry({ width: 2333, height: 1326 })).toEqual({
      width: 4762,
      height: 2748,
      scale: 2,
      margin: 24,
      reduced: false,
    });
    expect(pngGeometry({ width: 2333, height: 1326 }, { scale: 3 })).toMatchObject({
      width: 7143,
      height: 4122,
      scale: 3,
    });
    expect(pngGeometry({ width: 100.3, height: 50.2 }, { scale: 3 })).toMatchObject({
      width: 445,
      height: 295,
    });
  });

  it('lowers the scale to the largest two-decimal value within the canvas limits, and says so', () => {
    const huge = pngGeometry({ width: 8755, height: 4482 }, { scale: 3 });
    expect(huge.reduced).toBe(true);
    expect(huge.scale).toBeLessThan(3);
    expect(huge.scale * 100).toBe(Math.round(huge.scale * 100));
    expect(huge.width).toBeLessThanOrEqual(CANVAS_LIMITS.side);
    expect(huge.height).toBeLessThanOrEqual(CANVAS_LIMITS.side);
    expect(huge.width * huge.height).toBeLessThanOrEqual(CANVAS_LIMITS.area);
    // One step larger would not fit.
    const next = pngGeometry({ width: 8755, height: 4482 }, { scale: huge.scale + 0.01 });
    expect(next.reduced).toBe(true);
    const side = pngGeometry({ width: 1000, height: 100 }, { scale: 2, maxSide: 1000 });
    expect(side).toMatchObject({ reduced: true, scale: 0.95, width: 996 });
    const frame = { width: 2333, height: 1326.5 };
    const limited = pngGeometry(frame, { scale: 3, maxPixels: 2 ** 24 });
    expect(limited.reduced).toBe(true);
    expect(limited.width * limited.height).toBeLessThanOrEqual(2 ** 24);
    expect(pngGeometry(frame, { scale: limited.scale })).toEqual({ ...limited, reduced: false });
  });

  it.each([{ scale: 0 }, { maxPixels: 0 }, { maxSide: 0 }, { margin: -1 }])(
    'refuses invalid geometry options %s',
    (options) => {
      expect(() => pngGeometry({ width: 400, height: 100 }, options)).toThrow();
    },
  );

  it('keeps the browser adapter equal to the shared geometry', () => {
    const frame = { width: 52, height: 6570 };
    expect(browserPngGeometry(frame, 3, 24, CANVAS_LIMITS)).toEqual(
      pngGeometry(frame, {
        scale: 3,
        margin: 24,
        maxSide: CANVAS_LIMITS.side,
        maxPixels: CANVAS_LIMITS.area,
      }),
    );
  });

  it('labels a scale with the multiplication sign', () => {
    expect(scaleLabel(2)).toBe('2×');
    expect(scaleLabel(1.8349)).toBe('1.83×');
  });
});

describe('the font sentinels', () => {
  it('lie in the top margin band, one per embedded face, side by side', () => {
    for (const scale of [1, 2, 3]) {
      const geometry = pngGeometry({ width: 400, height: 300 }, { scale });
      const band = sentinelBand(geometry);
      const boxes = sentinelBoxes(geometry);
      expect(boxes).toHaveLength(EMBEDDED_FACES.length);
      // Inside the margin: the diagram's frame starts at margin × scale.
      expect(band.height).toBeLessThan(PNG_MARGIN * scale);
      expect(band.width).toBeLessThan(geometry.width);
      for (const [index, box] of boxes.entries()) {
        expect(box.x + box.width).toBeLessThanOrEqual(band.width + scale);
        expect(box.height).toBe(band.height);
        if (index > 0) expect(box.x).toBeGreaterThan(boxes[index - 1]?.x ?? 0);
      }
    }
  });
});
