// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { DISK, INSTANCE, SUBNET, TICK_CASES } from '../testing/fixtures.js';
import { issuePaths } from '../testing/issues.js';
import { DiffSchema, TickSchema } from './timeline.js';

describe('TickSchema', () => {
  it.each(TICK_CASES.days)('accepts the day tick %s', (tick) => {
    expect(TickSchema.safeParse(tick).success).toBe(true);
  });
  it.each(TICK_CASES.times)('accepts the extra tick %s (a read time to the second, in UTC)', (tick) => {
    expect(TickSchema.safeParse(tick).success).toBe(true);
  });
  it.each(TICK_CASES.invalid)('rejects %j', (tick) => {
    expect(TickSchema.safeParse(tick).success).toBe(false);
  });
});

describe('DiffSchema', () => {
  it('accepts disjoint lists, empty ones included', () => {
    expect(issuePaths(DiffSchema, { added: [INSTANCE], removed: [DISK], changed: [SUBNET] })).toEqual([]);
    expect(issuePaths(DiffSchema, { added: [], removed: [], changed: [] })).toEqual([]);
  });

  it('rejects a name listed twice, in one list or across lists', () => {
    expect(issuePaths(DiffSchema, { added: [INSTANCE, INSTANCE], removed: [], changed: [] })).toEqual([
      'added.1',
    ]);
    expect(issuePaths(DiffSchema, { added: [INSTANCE], removed: [], changed: [INSTANCE] })).toEqual([
      'changed.0',
    ]);
  });

  it('rejects names that are not full resource names, and unknown keys', () => {
    expect(issuePaths(DiffSchema, { added: ['web-1'], removed: [], changed: [] })).toEqual(['added.0']);
    expect(issuePaths(DiffSchema, { added: [], removed: [], changed: [], moved: [] })).toEqual(['']);
  });
});
