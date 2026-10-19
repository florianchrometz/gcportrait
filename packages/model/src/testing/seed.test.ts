// SPDX-License-Identifier: Apache-2.0
/**
 * The property tests' seed and number of runs (seed.ts): `FC_SEED` when set, the fixed seed on CI, else none
 * (fast-check draws one); `FC_RUNS` in place of a property's own runs.
 */
import { describe, expect, it } from 'vitest';
import { CI_PROPERTY_SEED, propertyRuns, propertySeed } from './seed.js';

describe('propertySeed', () => {
  it('takes FC_SEED wherever it runs', () => {
    expect(propertySeed({ FC_SEED: '1467391504' }, false)).toBe(1467391504);
    expect(propertySeed({ FC_SEED: '-7' }, true)).toBe(-7);
    expect(propertySeed({ FC_SEED: ' 12 ' }, true)).toBe(12);
  });

  it('fixes the seed on CI and leaves it to fast-check elsewhere', () => {
    expect(propertySeed({}, true)).toBe(CI_PROPERTY_SEED);
    expect(propertySeed({ FC_SEED: '' }, true)).toBe(CI_PROPERTY_SEED);
    expect(propertySeed({}, false)).toBeUndefined();
    expect(propertySeed({ FC_SEED: '  ' }, false)).toBeUndefined();
  });

  it('refuses an FC_SEED that is not an integer', () => {
    for (const text of ['abc', '1.5', '1e400', '9007199254740993']) {
      expect(() => propertySeed({ FC_SEED: text }, false)).toThrow(
        `FC_SEED must be an integer, not "${text}"`,
      );
    }
  });

  it('reads the process environment by default', () => {
    const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process
      .env;
    const before = env['FC_SEED'];
    env['FC_SEED'] = '31';
    try {
      expect(propertySeed()).toBe(31);
    } finally {
      if (before === undefined) delete env['FC_SEED'];
      else env['FC_SEED'] = before;
    }
  });
});

describe('propertyRuns', () => {
  it('keeps a property’s own runs unless FC_RUNS replaces them', () => {
    expect(propertyRuns(80, {})).toBe(80);
    expect(propertyRuns(80, { FC_RUNS: '' })).toBe(80);
    expect(propertyRuns(80, { FC_RUNS: '1000' })).toBe(1000);
  });

  it('refuses an FC_RUNS that is not a positive integer', () => {
    for (const text of ['0', '-1', '2.5', 'many']) {
      expect(() => propertyRuns(80, { FC_RUNS: text })).toThrow(
        `FC_RUNS must be a positive integer, not "${text}"`,
      );
    }
  });
});
