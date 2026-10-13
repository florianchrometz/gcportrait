// SPDX-License-Identifier: MIT
/**
 * The tuning constants AGENTS.md, the skills and the README state as numbers, pinned in one place so a change
 * is deliberate and lands with its documentation. The behaviour tests use the constants by name; this table
 * holds their values.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_ROUTING, DEFAULT_SIZING } from './constants.js';
import { MEMO_CAPACITY } from './memo.js';
import { NEAR_TIE } from './pack.js';
import { HUG_DISTANCE, OVERSHOOT_LIMIT } from './testing/quality.js';

describe('documented constants', () => {
  it.each([
    ['NEAR_TIE (skill gcp-diagram-layout §4: near ties within 2 %)', NEAR_TIE, 0.02],
    [
      'DEFAULT_ROUTING.singlePassWork (skill gcp-diagram-layout §5: 420 000 settled states)',
      DEFAULT_ROUTING.singlePassWork,
      420_000,
    ],
    [
      'DEFAULT_ROUTING.oneRoundWork (skill gcp-diagram-layout §5: 340 000 settled states)',
      DEFAULT_ROUTING.oneRoundWork,
      340_000,
    ],
    ['MEMO_CAPACITY (README "Worker": the last eight Layouts)', MEMO_CAPACITY, 8],
    [
      'DEFAULT_SIZING.zoneTitleMaxWidth (skill gcp-diagram-layout §3: 660 px, 3 × the widest card)',
      DEFAULT_SIZING.zoneTitleMaxWidth,
      3 * DEFAULT_SIZING.cardMaxWidth,
    ],
    ['HUG_DISTANCE (src/testing/quality.ts: a segment within 20 px of a border hugs it)', HUG_DISTANCE, 20],
    ['OVERSHOOT_LIMIT (README: routes more than 1 000 px past both ends)', OVERSHOOT_LIMIT, 1000],
  ])('%s', (_name, value, documented) => {
    expect(value).toBe(documented);
  });
});
