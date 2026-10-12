// @vitest-environment node
// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';

import { EMBEDDED_FACES } from './fonts';
import { CANVAS_LIMITS, pngGeometry, PNG_MARGIN, scaleLabel, sentinelBand, sentinelBoxes } from './raster';

describe('pngGeometry', () => {
  it('is (frame + 2 × 24) × scale, rounded up to whole pixels', () => {
    expect(pngGeometry({ width: 2333, height: 1326 }, 2)).toEqual({
      width: 4762,
      height: 2748,
      scale: 2,
      margin: 24,
      reduced: false,
    });
    expect(pngGeometry({ width: 2333, height: 1326 }, 3)).toMatchObject({
      width: 7143,
      height: 4122,
      scale: 3,
    });
    expect(pngGeometry({ width: 100.3, height: 50.2 }, 3)).toMatchObject({ width: 445, height: 295 });
  });

  it('lowers the scale to the largest two-decimal value within the canvas limits, and says so', () => {
    const huge = pngGeometry({ width: 8755, height: 4482 }, 3);
    expect(huge.reduced).toBe(true);
    expect(huge.scale).toBeLessThan(3);
    expect(huge.scale * 100).toBe(Math.round(huge.scale * 100));
    expect(huge.width).toBeLessThanOrEqual(CANVAS_LIMITS.side);
    expect(huge.height).toBeLessThanOrEqual(CANVAS_LIMITS.side);
    expect(huge.width * huge.height).toBeLessThanOrEqual(CANVAS_LIMITS.area);
    // One step larger would not fit.
    const next = pngGeometry({ width: 8755, height: 4482 }, huge.scale + 0.01);
    expect(next.reduced).toBe(true);
    const side = pngGeometry({ width: 1000, height: 100 }, 2, 24, { side: 1000, area: 1e9 });
    expect(side).toMatchObject({ reduced: true, scale: 0.95, width: 996 });
  });

  it('labels a scale with the multiplication sign', () => {
    expect(scaleLabel(2)).toBe('2×');
    expect(scaleLabel(1.8349)).toBe('1.83×');
  });
});

describe('the font sentinels', () => {
  it('lie in the top margin band, one per embedded face, side by side', () => {
    for (const scale of [1, 2, 3]) {
      const geometry = pngGeometry({ width: 400, height: 300 }, scale);
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
