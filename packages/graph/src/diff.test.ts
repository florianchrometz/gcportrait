// SPDX-License-Identifier: MIT
import { DiffSchema, type Asset } from '@gcportrait/model';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { diffSnapshots } from './diff.js';

function asset(name: string, updateTime: string): Asset {
  return {
    name: `//storage.googleapis.com/${name}`,
    assetType: 'storage.googleapis.com/Bucket',
    ancestors: [],
    updateTime,
    data: {},
  };
}

const T1 = '2026-10-01T08:00:00.000000Z';
const T2 = '2026-10-02T08:00:00.000000Z';

describe('diffSnapshots', () => {
  it('lists added, removed and changed names, sorted', () => {
    const before = { assets: [asset('kept', T1), asset('gone', T1), asset('edited', T1)] };
    const after = {
      assets: [asset('new-b', T2), asset('edited', T2), asset('kept', T1), asset('new-a', T2)],
    };
    expect(diffSnapshots(before, after)).toEqual({
      added: ['//storage.googleapis.com/new-a', '//storage.googleapis.com/new-b'],
      removed: ['//storage.googleapis.com/gone'],
      changed: ['//storage.googleapis.com/edited'],
    });
  });

  it('does not count a different spelling of the same instant as a change', () => {
    const before = { assets: [asset('x', '2026-10-07T18:22:41.5Z')] };
    const after = { assets: [asset('x', '2026-10-07T20:22:41.500000+02:00')] };
    expect(diffSnapshots(before, after)).toEqual({ added: [], removed: [], changed: [] });
  });

  it('counts a name repeated inside one snapshot once, with its latest updateTime', () => {
    const before = { assets: [asset('x', T2), asset('x', T1)] };
    expect(diffSnapshots(before, { assets: [asset('x', T2)] }).changed).toEqual([]);
    expect(diffSnapshots(before, { assets: [asset('x', T1)] }).changed).toEqual([
      '//storage.googleapis.com/x',
    ]);
  });

  const names = fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f');
  const times = fc.constantFrom(T1, T2, '2026-10-02T10:00:00+02:00');
  const snapshot = fc
    .uniqueArray(fc.tuple(names, times), { selector: ([name]) => name, maxLength: 6 })
    .map((entries) => ({ assets: entries.map(([name, time]) => asset(name, time)) }));

  it('is valid, independent of asset order, and antisymmetric (property)', () => {
    fc.assert(
      fc.property(snapshot, snapshot, (a, b) => {
        const diff = diffSnapshots(a, b);
        DiffSchema.parse(diff);
        const reversed = diffSnapshots(
          { assets: [...a.assets].reverse() },
          { assets: [...b.assets].reverse() },
        );
        expect(reversed).toEqual(diff);
        const back = diffSnapshots(b, a);
        expect(back.added).toEqual(diff.removed);
        expect(back.removed).toEqual(diff.added);
        expect(back.changed).toEqual(diff.changed);
        expect(diffSnapshots(a, a)).toEqual({ added: [], removed: [], changed: [] });
      }),
    );
  });
});
