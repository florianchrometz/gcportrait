// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';

import { levelOfDetail, lodClasses } from './lod';

describe('level of detail (style skill §3, §5)', () => {
  // The skill's thresholds, at and either side of each: labels from 0.35, subtitles from 0.55, thin strokes above 2.
  it.each([
    [0.05, false, false, false],
    [0.349, false, false, false],
    [0.35, false, true, false],
    [0.549, false, true, false],
    [0.55, true, true, false],
    [1, true, true, false],
    [2, true, true, false],
    [2.001, true, true, true],
    [200, true, true, true],
  ])('at scale %s: subtitles %s, labels %s, thin strokes %s', (scale, subtitles, labels, thinStrokes) => {
    expect(levelOfDetail(scale)).toEqual({ subtitles, labels, thinStrokes });
  });

  it('turns a level into the canvas classes', () => {
    expect(lodClasses(levelOfDetail(1))).toEqual([]);
    expect(lodClasses(levelOfDetail(0.5))).toEqual(['dg-lod-nosub']);
    expect(lodClasses(levelOfDetail(0.2))).toEqual(['dg-lod-nosub', 'dg-lod-nolabel']);
    expect(lodClasses(levelOfDetail(3))).toEqual(['dg-lod-thin']);
  });
});
