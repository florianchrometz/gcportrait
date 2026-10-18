// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';

import { FEATURES, featureCopy } from './features.js';

describe('the features’ copy', () => {
  it('names every feature once, so a page asks for one and gets one', () => {
    const ids = FEATURES.map((feature) => feature.id);
    expect(ids.length).toBeGreaterThanOrEqual(10);
    expect(new Set(ids).size).toBe(ids.length);
    for (const feature of FEATURES) expect(featureCopy(feature.id)).toBe(feature);
  });

  it('gives each feature a heading and a paragraph of plain prose, the README’s cell saying the same', () => {
    for (const feature of FEATURES) {
      expect(feature.title).not.toBe('');
      expect(feature.title).not.toMatch(/[.;]$/);
      expect(feature.blurb.length).toBeGreaterThan(60);
      expect(feature.blurb).toMatch(/\.$/);
      // Only `<code>` is markup: the README's cells and the landing page's paragraph carry the same text, and
      // links belong to whichever page shows the feature.
      expect(feature.blurb.match(/<(?!\/?code>)[^>]*>/g) ?? []).toEqual([]);
      expect(feature.blurb).not.toMatch(/<a\b/);
    }
  });

  it('fails loudly on an id the list does not have, rather than drawing an empty feature', () => {
    expect(() => featureCopy('no-such-feature')).toThrow(/no feature no-such-feature/);
  });
});
