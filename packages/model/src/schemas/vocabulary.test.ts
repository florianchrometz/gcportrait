// SPDX-License-Identifier: MIT
/**
 * The zod-free vocabularies: each tuple and its schema list the specified values, in their order
 * (consumers such as the render CLI's help text read the schema's options), and each guard accepts exactly what
 * its schema accepts, for the members, near misses and anything at all.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type * as z from 'zod';
import { DetailLevelSchema, LensIdSchema } from './lens.js';
import { RelationKindSchema } from './relation.js';
import { DemoSizeSchema, FocusKindSchema, SnapshotRefSchema } from './view-spec.js';
import {
  DEMO_SIZES,
  DETAIL_LEVEL_IDS,
  FOCUS_KIND_IDS,
  LARGE_SNAPSHOT_ASSETS,
  LENS_IDS,
  RELATION_KIND_IDS,
  isDemoSize,
  isDetailLevel,
  isFocusKind,
  isLensId,
  isRelationKind,
  isSnapshotRef,
} from './vocabulary.js';

/** [what is specified, the tuple, its schema, the literal list in the specified order] */
const SPEC: [string, readonly string[], { readonly options: readonly string[] }, readonly string[]][] = [
  [
    'the eleven lenses, in menu order',
    LENS_IDS,
    LensIdSchema,
    [
      'overview',
      'networking',
      'load-balancing',
      'compute',
      'serverless',
      'kubernetes',
      'data',
      'security',
      'identity',
      'operations',
      'everything',
    ],
  ],
  [
    'auto and the four detail levels from coarse to fine',
    DETAIL_LEVEL_IDS,
    DetailLevelSchema,
    ['auto', 'folders', 'projects', 'networks', 'all'],
  ],
  [
    'the thirteen relation kinds, in the order of the relation-kind table',
    RELATION_KIND_IDS,
    RelationKindSchema,
    [
      'contains',
      'attaches',
      'routes',
      'uses',
      'peers',
      'connects',
      'memberOf',
      'runsAs',
      'encryptedBy',
      'secures',
      'triggers',
      'replicates',
      'shares',
    ],
  ],
  [
    'the five focus views',
    FOCUS_KIND_IDS,
    FocusKindSchema,
    ['project', 'shared-vpc', 'standalone-projects', 'perimeter', 'application'],
  ],
  ['the demo organisations, smallest first', DEMO_SIZES, DemoSizeSchema, ['S', 'M', 'L', 'XL']],
];

it.each(SPEC)('lists %s, in the tuple and in its schema', (_name, tuple, schema, expected) => {
  expect(tuple).toEqual(expected);
  expect(schema.options).toEqual(expected);
});

const enums: [string, readonly string[], z.ZodType, (v: unknown) => boolean][] = [
  ['lens ids', LENS_IDS, LensIdSchema, isLensId],
  ['detail levels', DETAIL_LEVEL_IDS, DetailLevelSchema, isDetailLevel],
  ['relation kinds', RELATION_KIND_IDS, RelationKindSchema, isRelationKind],
  ['focus kinds', FOCUS_KIND_IDS, FocusKindSchema, isFocusKind],
  ['demo sizes', DEMO_SIZES, DemoSizeSchema, isDemoSize],
];

function agrees(schema: z.ZodType, guard: (value: unknown) => boolean, value: unknown): void {
  expect(guard(value)).toBe(schema.safeParse(value).success);
}

describe.each(enums)('%s', (_name, tuple, schema, guard) => {
  it('accepts every member and nothing else', () => {
    for (const member of tuple) expect(guard(member)).toBe(true);
    const first = tuple[0] ?? '';
    const flipped = first === first.toUpperCase() ? first.toLowerCase() : first.toUpperCase();
    for (const miss of ['', ' ', flipped, `${first} `, `${first}x`, 1, null, undefined, [first]])
      expect(guard(miss)).toBe(false);
  });

  it('agrees with the schema on anything at all', () => {
    fc.assert(
      fc.property(fc.oneof(fc.constantFrom(...tuple), fc.anything()), (value) => {
        agrees(schema, guard, value);
      }),
    );
  });
});

describe('isSnapshotRef', () => {
  const ACCEPTED = ['', '01J9Z3K5Q8XW2V4N6P7R8S9T0A', 'demo:S', 'demo:M', 'demo:L', 'demo:XL'];
  const REJECTED = [
    'demo:Q',
    'demo:',
    'demo:m',
    'demo:XXL',
    'DEMO:M',
    ' demo:M',
    '01j9z3k5q8xw2v4n6p7r8s9t0a',
    'latest',
    0,
    null,
  ];

  it('accepts none chosen, a ULID and every demo size', () => {
    for (const ref of ACCEPTED) expect(isSnapshotRef(ref)).toBe(true);
  });

  it('rejects malformed refs and other values', () => {
    for (const ref of REJECTED) expect(isSnapshotRef(ref)).toBe(false);
  });

  it('agrees with SnapshotRefSchema on the refs above, near misses and anything at all', () => {
    const nearMiss = fc.oneof(
      fc.constantFrom('', 'demo:', 'demo:S', 'demo:XL', 'demo:XXL'),
      fc.string().map((tail) => `demo:${tail}`),
      fc.stringMatching(/^[0-9A-Z]{24,27}$/),
      fc.anything(),
    );
    fc.assert(
      fc.property(nearMiss, (value) => {
        agrees(SnapshotRefSchema, isSnapshotRef, value);
      }),
      { numRuns: 500, examples: [...ACCEPTED, ...REJECTED].map((ref): [unknown] => [ref]) },
    );
  });
});

describe('LARGE_SNAPSHOT_ASSETS', () => {
  it('is the 10 000 assets the guide names, a whole positive count', () => {
    expect(LARGE_SNAPSHOT_ASSETS).toBe(10_000);
    expect(Number.isSafeInteger(LARGE_SNAPSHOT_ASSETS)).toBe(true);
  });
});
