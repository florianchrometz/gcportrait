// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';

import { cameraAttribute, fitTransform, IDENTITY_CAMERA } from './viewport';

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

describe('cameraAttribute', () => {
  it('writes the camera as the viewport group’s translate and scale, each number as JavaScript writes it', () => {
    expect(cameraAttribute({ k: 0.5095729013254786, x: 121.50662739322536, y: -55.75 })).toBe(
      'translate(121.50662739322536,-55.75) scale(0.5095729013254786)',
    );
    expect(cameraAttribute({ k: 200, x: 1e-7, y: 0 })).toBe('translate(1e-7,0) scale(200)');
    expect(cameraAttribute(IDENTITY_CAMERA)).toBe('translate(0,0) scale(1)');
  });
});
