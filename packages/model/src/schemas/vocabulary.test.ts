// SPDX-License-Identifier: Apache-2.0
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
import { FontFaceKeySchema } from './layout.js';
import { ScopeKindSchema } from './snapshot.js';
import { DemoSizeSchema, FocusKindSchema, SnapshotRefSchema } from './view-spec.js';
import {
  DAY_MS,
  DEMO_SIZES,
  DETAIL_LEVEL_IDS,
  FOCUS_KIND_IDS,
  FONT_FACE_KEYS,
  LARGE_SNAPSHOT_ASSETS,
  LENS_IDS,
  RELATION_KIND_IDS,
  RESOURCE_MANAGER_FOLDER,
  RESOURCE_MANAGER_ORGANIZATION,
  RESOURCE_MANAGER_PROJECT,
  SCOPE_COLLECTIONS,
  SCOPE_KINDS,
  TIMELINE_DAYS,
  addDays,
  dayOfReadTime,
  dayReadTime,
  dayStart,
  demoRefOfSize,
  demoSizeOfRef,
  isDay,
  isDemoSize,
  isDetailLevel,
  isFocusKind,
  isLensId,
  isRelationKind,
  isRfc3339Timestamp,
  isScopeKind,
  isSnapshotRef,
  scopePathOf,
  utcDayOf,
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
  ['the three scope kinds', SCOPE_KINDS, ScopeKindSchema, ['organization', 'folder', 'project']],
];

it.each(SPEC)('lists %s, in the tuple and in its schema', (_name, tuple, schema, expected) => {
  expect(tuple).toEqual(expected);
  expect(schema.options).toEqual(expected);
});

it('freezes the four font face keys shared by metrics and their schema', () => {
  expect(FONT_FACE_KEYS).toEqual(['sans-400', 'sans-500', 'sans-700', 'mono-400']);
  expect(FontFaceKeySchema.options).toEqual(FONT_FACE_KEYS);
  expect(Object.isFrozen(FONT_FACE_KEYS)).toBe(true);
});

const enums: [string, readonly string[], z.ZodType, (v: unknown) => boolean][] = [
  ['lens ids', LENS_IDS, LensIdSchema, isLensId],
  ['detail levels', DETAIL_LEVEL_IDS, DetailLevelSchema, isDetailLevel],
  ['relation kinds', RELATION_KIND_IDS, RelationKindSchema, isRelationKind],
  ['focus kinds', FOCUS_KIND_IDS, FocusKindSchema, isFocusKind],
  ['demo sizes', DEMO_SIZES, DemoSizeSchema, isDemoSize],
  ['scope kinds', SCOPE_KINDS, ScopeKindSchema, isScopeKind],
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

describe('Google Cloud resource manager types', () => {
  it('defines the three resource manager asset types', () => {
    expect(RESOURCE_MANAGER_ORGANIZATION).toBe('cloudresourcemanager.googleapis.com/Organization');
    expect(RESOURCE_MANAGER_FOLDER).toBe('cloudresourcemanager.googleapis.com/Folder');
    expect(RESOURCE_MANAGER_PROJECT).toBe('cloudresourcemanager.googleapis.com/Project');
  });
});

describe('SCOPE_COLLECTIONS and scopePathOf', () => {
  it('maps each scope kind to its URL path collection segment', () => {
    expect(SCOPE_COLLECTIONS).toEqual({
      organization: 'organizations',
      folder: 'folders',
      project: 'projects',
    });
  });

  it('formats the URL path of a scope', () => {
    expect(scopePathOf({ kind: 'organization', id: '123456789012' })).toBe('organizations/123456789012');
    expect(scopePathOf({ kind: 'folder', id: '456' })).toBe('folders/456');
    expect(scopePathOf({ kind: 'project', id: 'my-proj' })).toBe('projects/my-proj');
  });
});

describe('demoSizeOfRef and demoRefOfSize', () => {
  it('extracts the size from valid demo refs', () => {
    expect(demoSizeOfRef('demo:S')).toBe('S');
    expect(demoSizeOfRef('demo:M')).toBe('M');
    expect(demoSizeOfRef('demo:L')).toBe('L');
    expect(demoSizeOfRef('demo:XL')).toBe('XL');
  });

  it('returns null for non-demo or invalid demo refs', () => {
    expect(demoSizeOfRef('')).toBeNull();
    expect(demoSizeOfRef('demo:')).toBeNull();
    expect(demoSizeOfRef('demo:XXL')).toBeNull();
    expect(demoSizeOfRef('01J9Z3K5Q8XW2V4N6P7R8S9T0A')).toBeNull();
    expect(demoSizeOfRef(123)).toBeNull();
    expect(demoSizeOfRef(null)).toBeNull();
  });

  it('constructs a demo ref from size', () => {
    for (const size of DEMO_SIZES) {
      expect(demoRefOfSize(size)).toBe(`demo:${size}`);
      expect(demoSizeOfRef(demoRefOfSize(size))).toBe(size);
    }
  });
});

describe('timeline days and time helpers', () => {
  it('specifies the 35 timeline days and 24h millisecond constant', () => {
    expect(TIMELINE_DAYS).toBe(35);
    expect(DAY_MS).toBe(86_400_000);
  });

  it('formats UTC day string and checks isDay', () => {
    const epoch = Date.UTC(2026, 9, 19, 12, 34, 56);
    expect(utcDayOf(epoch)).toBe('2026-10-19');
    expect(isDay('2026-10-19')).toBe(true);
    expect(isDay('2026-1-1')).toBe(false);
    expect(isDay('invalid')).toBe(false);
  });

  it('computes day boundaries and read times', () => {
    const day = '2026-10-19';
    const start = dayStart(day);
    expect(start).toBe(Date.UTC(2026, 9, 19, 0, 0, 0, 0));
    expect(dayReadTime(day)).toBe('2026-10-19T00:00:00Z');
    expect(dayOfReadTime('2026-10-19T14:30:00Z')).toBe(day);
    expect(dayOfReadTime('2026-10-10T01:00:00+02:00')).toBe('2026-10-09');
    expect(dayOfReadTime('2026-02-30T00:00:00Z')).toBeNull();
    expect(dayOfReadTime('not a time')).toBeNull();
    expect(dayOfReadTime('2026-10-19')).toBeNull();
    expect(dayOfReadTime('October 19, 2026')).toBeNull();
    expect(addDays(day, 1)).toBe('2026-10-20');
    expect(addDays(day, -1)).toBe('2026-10-18');
  });

  it('validates RFC 3339 timestamps with isRfc3339Timestamp', () => {
    expect(isRfc3339Timestamp('2026-10-19T14:30:00Z')).toBe(true);
    expect(isRfc3339Timestamp('2026-10-19t14:30:00z')).toBe(true);
    expect(isRfc3339Timestamp('2026-10-19T14:30:00.123456Z')).toBe(true);
    expect(isRfc3339Timestamp('2026-10-10T01:00:00+02:00')).toBe(true);
    expect(isRfc3339Timestamp('2026-10-10T01:00:00-05:00')).toBe(true);
    expect(isRfc3339Timestamp('2024-02-29T12:00:00Z')).toBe(true);
    // Invalid calendar dates or formats
    expect(isRfc3339Timestamp('2026-02-30T00:00:00Z')).toBe(false);
    expect(isRfc3339Timestamp('2026-02-29T00:00:00Z')).toBe(false);
    expect(isRfc3339Timestamp('2026-13-01T00:00:00Z')).toBe(false);
    expect(isRfc3339Timestamp('2026-04-31T00:00:00Z')).toBe(false);
    expect(isRfc3339Timestamp('2026-10-19T25:00:00Z')).toBe(false);
    expect(isRfc3339Timestamp('2026-10-19T14:60:00Z')).toBe(false);
    expect(isRfc3339Timestamp('2026-10-19')).toBe(false);
    expect(isRfc3339Timestamp('October 19, 2026')).toBe(false);
    expect(isRfc3339Timestamp(12345)).toBe(false);
    expect(isRfc3339Timestamp(null)).toBe(false);
    expect(isRfc3339Timestamp(undefined)).toBe(false);
  });
});
