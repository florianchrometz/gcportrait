// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { EdgeStyleIdSchema, RELATION_KINDS, RelationKindInfoSchema, RelationKindSchema } from './relation.js';

describe('RELATION_KINDS', () => {
  it('describes every kind, in the same order', () => {
    expect(Object.keys(RELATION_KINDS)).toEqual(RelationKindSchema.options);
  });

  it.each(RelationKindSchema.options)('%s matches RelationKindInfoSchema', (kind) => {
    expect(RelationKindInfoSchema.safeParse(RELATION_KINDS[kind]).success).toBe(true);
  });

  it('names lenses exactly for the kinds that are not drawn by default', () => {
    for (const info of Object.values(RELATION_KINDS)) {
      expect(info.lensOnly !== undefined).toBe(!info.drawnByDefault);
    }
  });

  it('records the relation-kind table’s visibility and style columns', () => {
    expect(RELATION_KINDS.contains).toMatchObject({ defaultStyle: 'nesting', drawnByDefault: true });
    expect(RELATION_KINDS.peers).toMatchObject({ direction: 'both', defaultStyle: 'dashed-double-headed' });
    expect(RELATION_KINDS.runsAs).toMatchObject({ drawnByDefault: false, lensOnly: ['identity'] });
    expect(RELATION_KINDS.encryptedBy).toMatchObject({ drawnByDefault: false, lensOnly: ['security'] });
    expect(RELATION_KINDS.secures).toMatchObject({
      defaultStyle: 'dashed-overlay-zone',
      drawnByDefault: false,
    });
    expect(RELATION_KINDS.shares).toMatchObject({
      direction: 'service project → host project',
      defaultStyle: 'dashed-arrow',
    });
  });

  it('uses every edge style', () => {
    const used = new Set(Object.values(RELATION_KINDS).map((info) => info.defaultStyle));
    expect([...used].sort()).toEqual([...EdgeStyleIdSchema.options].sort());
  });
});

describe('RelationKindInfoSchema', () => {
  const info = { meaning: 'm', direction: 'a → b', defaultStyle: 'solid-arrow', drawnByDefault: true };

  it.each([
    ['an unknown style', { ...info, defaultStyle: 'zigzag' }],
    ['an empty lens list', { ...info, lensOnly: [] }],
    ['an unknown lens', { ...info, lensOnly: ['nope'] }],
    ['an empty meaning', { ...info, meaning: '' }],
    ['an unknown key', { ...info, colour: 'red' }],
  ])('rejects %s', (_case, value) => {
    expect(RelationKindInfoSchema.safeParse(value).success).toBe(false);
  });
});
