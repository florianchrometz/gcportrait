// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { sampleAsset } from '../testing/fixtures.js';
import { issuePaths } from '../testing/issues.js';
import { DemoHistorySchema, HistoryTickSchema, MutationSchema } from './demo-history.js';

const ADDED = '//compute.googleapis.com/projects/demo-net/zones/europe-west3-a/disks/extra';

/** A three-day history whose last day is `today`, with one change of each kind. */
function sampleHistory() {
  return {
    size: 'S',
    seed: 42,
    today: '2026-10-08',
    base: [sampleAsset()],
    ticks: [
      { tick: '2026-10-06', readTime: '2026-10-06T00:00:00Z', mutations: [] },
      {
        tick: '2026-10-07',
        readTime: '2026-10-07T00:00:00Z',
        mutations: [{ kind: 'add', asset: { ...sampleAsset(), name: ADDED } }],
      },
      {
        tick: '2026-10-08',
        readTime: '2026-10-08T00:00:00Z',
        mutations: [
          { kind: 'change', asset: sampleAsset(), fields: ['data.status'] },
          { kind: 'remove', name: ADDED, assetType: 'compute.googleapis.com/Disk' },
        ],
      },
    ],
  };
}

/** The sample with its last tick moved off its own day. */
function mismatchedHistory() {
  const history = sampleHistory();
  const last = history.ticks.length - 1;
  return {
    ...history,
    ticks: history.ticks.map((tick, index) => (index === last ? { ...tick, tick: '2026-10-09' } : tick)),
  };
}

describe('MutationSchema', () => {
  it('accepts an add, a change and a remove', () => {
    expect(issuePaths(MutationSchema, { kind: 'add', asset: sampleAsset() })).toEqual([]);
    expect(
      issuePaths(MutationSchema, { kind: 'change', asset: sampleAsset(), fields: ['data.status'] }),
    ).toEqual([]);
    expect(issuePaths(MutationSchema, { kind: 'change', asset: sampleAsset(), fields: [] })).toEqual([]);
    expect(
      issuePaths(MutationSchema, { kind: 'remove', name: ADDED, assetType: 'compute.googleapis.com/Disk' }),
    ).toEqual([]);
  });

  it('rejects an unknown kind, a missing asset and fields that are not text', () => {
    expect(issuePaths(MutationSchema, { kind: 'rename' })).toEqual(['kind']);
    expect(issuePaths(MutationSchema, { kind: 'add' })).toEqual(['asset']);
    expect(issuePaths(MutationSchema, { kind: 'change', asset: sampleAsset(), fields: ['data', 1] })).toEqual(
      ['fields.1'],
    );
    expect(issuePaths(MutationSchema, { kind: 'remove', name: 42, assetType: '' })).toEqual(['name']);
  });

  it('rejects an asset that is not one, at its own place', () => {
    expect(issuePaths(MutationSchema, { kind: 'add', asset: { name: 'x' } }).sort()).toEqual(
      ['asset.name', 'asset.assetType', 'asset.ancestors', 'asset.updateTime', 'asset.data'].sort(),
    );
  });
});

describe('HistoryTickSchema', () => {
  it('accepts a day with its read time and no changes', () => {
    expect(
      issuePaths(HistoryTickSchema, { tick: '2026-10-08', readTime: '2026-10-08T00:00:00Z', mutations: [] }),
    ).toEqual([]);
  });

  it('rejects a tick that is a read time rather than a day (a history is 35 days)', () => {
    expect(
      issuePaths(HistoryTickSchema, {
        tick: '2026-10-08T00:00:00Z',
        readTime: '2026-10-08T00:00:00Z',
        mutations: [],
      }),
    ).toEqual(['tick']);
  });

  it('rejects a tick without a read time or with an invalid change', () => {
    expect(issuePaths(HistoryTickSchema, { tick: '2026-10-08', mutations: [] })).toEqual(['readTime']);
    expect(
      issuePaths(HistoryTickSchema, {
        tick: '2026-10-08',
        readTime: '2026-10-08T00:00:00Z',
        mutations: [{ kind: 'rename' }],
      }),
    ).toEqual(['mutations.0.kind']);
  });
});

describe('DemoHistorySchema', () => {
  it('accepts a history whose last tick is its own day', () => {
    expect(issuePaths(DemoHistorySchema, sampleHistory())).toEqual([]);
  });

  it('accepts an empty base, and strips a key it does not know', () => {
    expect(issuePaths(DemoHistorySchema, { ...sampleHistory(), base: [] })).toEqual([]);
    expect(issuePaths(DemoHistorySchema, { ...sampleHistory(), comment: 'by hand' })).toEqual([]);
    expect(DemoHistorySchema.parse({ ...sampleHistory(), comment: 'by hand' })).not.toHaveProperty('comment');
  });

  it('rejects a size, seed or day that is not one', () => {
    expect(issuePaths(DemoHistorySchema, { ...sampleHistory(), size: 'XXL' })).toEqual(['size']);
    expect(issuePaths(DemoHistorySchema, { ...sampleHistory(), seed: 1.5 })).toEqual(['seed']);
    expect(issuePaths(DemoHistorySchema, { ...sampleHistory(), seed: '42' })).toEqual(['seed']);
    expect(issuePaths(DemoHistorySchema, { ...sampleHistory(), today: '2026-10-08T00:00:00Z' })).toEqual([
      'today',
    ]);
    expect(issuePaths(DemoHistorySchema, { ...sampleHistory(), today: '2026-02-29' })).toEqual(['today']);
  });

  it('rejects a missing base or no ticks', () => {
    expect(issuePaths(DemoHistorySchema, { ...sampleHistory(), ticks: [] })).toEqual(['ticks']);
    expect(issuePaths(DemoHistorySchema, { ...sampleHistory(), base: 'none' })).toEqual(['base']);
  });

  it('rejects a base asset that is not one, at its place', () => {
    expect(
      issuePaths(DemoHistorySchema, { ...sampleHistory(), base: [{ ...sampleAsset(), name: 'x' }] }),
    ).toEqual(['base.0.name']);
  });

  it('rejects a last tick that is not the history day', () => {
    expect(issuePaths(DemoHistorySchema, { ...sampleHistory(), today: '2026-10-09' })).toEqual(['ticks']);
    expect(issuePaths(DemoHistorySchema, mismatchedHistory())).toEqual(['ticks']);
  });

  it('rejects a value that is no object', () => {
    expect(issuePaths(DemoHistorySchema, null)).toEqual(['']);
    expect(issuePaths(DemoHistorySchema, [])).toEqual(['']);
    expect(issuePaths(DemoHistorySchema, 'history')).toEqual(['']);
  });
});
