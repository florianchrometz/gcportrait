// SPDX-License-Identifier: Apache-2.0
/**
 * scripts/lib/branding-text.mjs: loads branding strings from frontend/src/branding.ts.
 */
import { describe, expect, it } from 'vitest';

import { REPO, createTempTree } from '../testing/temp-tree.js';
import { NON_AFFILIATION_LONG, loadNonAffiliationLong } from './branding-text.mjs';

describe('loadNonAffiliationLong', () => {
  it('loads the non-affiliation statement from the repository’s frontend/src/branding.ts', () => {
    const text = loadNonAffiliationLong(REPO);
    expect(text).toBe(NON_AFFILIATION_LONG);
    expect(text).toContain('is not affiliated with, endorsed by, or sponsored by Google');
  });

  it('throws when frontend/src/branding.ts has no NON_AFFILIATION_LONG export', () => {
    const tree = createTempTree('branding-test');
    try {
      tree.write('frontend/src/branding.ts', 'export const WORDMARK = "gcportrait";\n');
      expect(() => loadNonAffiliationLong(tree.root)).toThrow(
        'frontend/src/branding.ts exports no NON_AFFILIATION_LONG string.',
      );
    } finally {
      tree.remove();
    }
  });
});
