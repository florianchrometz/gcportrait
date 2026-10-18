// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';

import { flipIdOf, toggleFlipToken } from './flip.js';

describe('flipIdOf', () => {
  it('computes deterministic base-36 tokens', () => {
    expect(flipIdOf('folders/1')).toBe(flipIdOf('folders/1'));
    expect(flipIdOf('folders/1')).not.toBe(flipIdOf('folders/2'));
  });
});

describe('toggleFlipToken', () => {
  it('appends the token when absent, and removes it when present', () => {
    const token = flipIdOf('folders/1');
    const added = toggleFlipToken([], 'folders/1');
    expect(added).toEqual([token]);
    const removed = toggleFlipToken(['other', token], 'folders/1');
    expect(removed).toEqual(['other']);
  });
});
