// @vitest-environment node
// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';

import { rejectedSnapshotRef } from './snapshotRef';

describe('rejectedSnapshotRef', () => {
  it('names a snapshot value the codec rejected', () => {
    expect(rejectedSnapshotRef('snapshot=demo:Q')).toBe('demo:Q');
    expect(rejectedSnapshotRef('lens=networking&snapshot=not%20a%20ref')).toBe('not a ref');
    expect(rejectedSnapshotRef('snapshot=%E0')).toBe('%E0');
  });

  it('is null for a valid snapshot, an empty one and none', () => {
    expect(rejectedSnapshotRef('snapshot=demo:M')).toBeNull();
    expect(rejectedSnapshotRef('snapshot=01J9Z3K5Q8XW2V4N6P7R8S9T0A')).toBeNull();
    expect(rejectedSnapshotRef('snapshot=')).toBeNull();
    expect(rejectedSnapshotRef('lens=networking')).toBeNull();
    expect(rejectedSnapshotRef('')).toBeNull();
  });
});
