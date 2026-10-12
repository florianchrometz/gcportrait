// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';

import { fitTransform } from './viewport';

describe('fitTransform', () => {
  it('centres a drawing smaller than the canvas at 100 %', () => {
    expect(fitTransform({ x: 0, y: -78, width: 400, height: 300 }, 1000, 800)).toEqual({
      k: 1,
      x: 300,
      y: 328,
    });
  });

  it('shrinks a large drawing to fit inside the padding, centred', () => {
    const fit = fitTransform({ x: 0, y: 0, width: 4000, height: 1000 }, 1000, 800, 16);
    expect(fit.k).toBeCloseTo(968 / 4000);
    expect(fit.x).toBeCloseTo(16);
    expect(fit.y).toBeCloseTo((800 - 1000 * fit.k) / 2);
  });

  it('never goes below the smallest scale, 5 %', () => {
    expect(fitTransform({ x: 0, y: 0, width: 1e7, height: 10 }, 1000, 800).k).toBe(0.05);
  });
});
