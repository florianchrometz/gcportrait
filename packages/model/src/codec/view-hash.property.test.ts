// SPDX-License-Identifier: Apache-2.0
/**
 * Property tests for the URL-hash codec. The arbitraries are built from the schemas themselves: enum options
 * come from the zod enums, constrained strings from the same patterns the schemas use, so a schema change
 * changes what is generated. A first property checks that every generated view is valid by the schema.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DetailLevelSchema, LensIdSchema } from '../schemas/lens.js';
import {
  ASSET_TYPE_PATTERN_OR_GLOB,
  LOCATION_PATTERN,
  NUMERIC_ID_PATTERN,
  PROJECT_REF_PATTERN,
  ULID_PATTERN,
} from '../schemas/primitives.js';
import {
  DemoSizeSchema,
  FLIP_ID_PATTERN,
  FOCUS_PARAM_NAME_PATTERN,
  FocusKindSchema,
  VIEW_SPEC_MAX_DEPTH,
  VIEW_SPEC_MAX_FLIPS,
  ViewSpecSchema,
  normalizeViewSpec,
} from '../schemas/view-spec.js';
import { decodeViewSpec, encodeViewSpec } from './view-hash.js';
import { referenceNormalize } from '../testing/reference-normalize.js';

/** Characters with a meaning in the hash grammar, in URLs or in form encoding, plus multi-byte ones. */
const AWKWARD = [
  '&',
  '=',
  ',',
  '+',
  '%',
  '#',
  ' ',
  '!',
  "'",
  '(',
  ')',
  '*',
  '/',
  ':',
  '@',
  '~',
  '?',
  '%2C',
  'é',
  '😀',
  '\u0000',
];

const text = fc.string({
  unit: fc.oneof(fc.constantFrom(...AWKWARD), fc.string({ unit: 'grapheme', minLength: 1, maxLength: 1 })),
  minLength: 1,
  maxLength: 12,
});
const snapshotRef = fc.oneof(
  fc.constant(''),
  fc.stringMatching(ULID_PATTERN),
  fc.constantFrom(...DemoSizeSchema.options.map((size) => `demo:${size}`)),
);
const instant = fc.date({
  min: new Date('1970-01-01T00:00:00Z'),
  max: new Date('2999-12-31T00:00:00Z'),
  noInvalidDate: true,
});
// A day tick, or an extra tick: a read time to the second in UTC.
const tick = fc.oneof(
  instant.map((date) => date.toISOString().slice(0, 10)),
  instant.map((date) => `${date.toISOString().slice(0, 19)}Z`),
);
const lens = fc.constantFrom(...LensIdSchema.options);
const detail = fc.constantFrom(...DetailLevelSchema.options);
const focus = fc.record({
  kind: fc.constantFrom(...FocusKindSchema.options),
  params: fc.dictionary(fc.stringMatching(FOCUS_PARAM_NAME_PATTERN), text, { maxKeys: 4 }),
});
const flipId = fc.stringMatching(FLIP_ID_PATTERN);
const list = (pattern: RegExp) => fc.array(fc.stringMatching(pattern), { maxLength: 4 });

const filters = fc.record(
  {
    hideEmptyProjects: fc.boolean(),
    hideEmptyFolders: fc.boolean(),
    hideDisconnected: fc.boolean(),
    regions: list(LOCATION_PATTERN),
    projects: list(PROJECT_REF_PATTERN),
    folders: list(NUMERIC_ID_PATTERN),
    includeTypes: list(ASSET_TYPE_PATTERN_OR_GLOB),
    excludeTypes: list(ASSET_TYPE_PATTERN_OR_GLOB),
    depth: fc.integer({ min: 1, max: VIEW_SPEC_MAX_DEPTH }),
    showRegions: fc.boolean(),
    showIdentities: fc.boolean(),
  },
  { requiredKeys: ['hideEmptyProjects', 'hideEmptyFolders', 'hideDisconnected'] },
);

/** Views the schema accepts: every field valid, optional fields present or absent. */
const validSpec = fc.record(
  {
    snapshot: snapshotRef,
    tick,
    lens,
    focus,
    root: text,
    filters,
    detail,
    flips: fc.array(flipId, { maxLength: VIEW_SPEC_MAX_FLIPS }),
    selection: text,
    highlight: text,
  },
  { requiredKeys: ['snapshot', 'lens', 'filters', 'detail', 'flips'] },
);

/**
 * Anything at all in every field, valid values included: what an untyped caller or an old hash might hold.
 */
const junk = fc.anything({ maxDepth: 2 });
const either = <T>(valid: fc.Arbitrary<T>) => fc.oneof(valid, junk);
const looseList = (pattern: RegExp) => fc.array(fc.oneof(fc.stringMatching(pattern), junk), { maxLength: 6 });
const looseSpec = fc.record(
  {
    snapshot: either(snapshotRef),
    tick: either(tick),
    lens: either(lens),
    focus: either(
      fc.record({
        kind: either(fc.constantFrom(...FocusKindSchema.options)),
        params: either(fc.dictionary(fc.string(), either(text))),
      }),
    ),
    root: either(text),
    filters: either(
      fc.record({
        hideEmptyProjects: either(fc.boolean()),
        regions: either(looseList(LOCATION_PATTERN)),
        depth: either(fc.integer({ min: -5, max: VIEW_SPEC_MAX_DEPTH + 5 })),
        showRegions: either(fc.boolean()),
      }),
    ),
    detail: either(detail),
    flips: either(fc.array(fc.oneof(flipId, flipId, junk), { maxLength: 70 })),
    selection: either(text),
    highlight: either(text),
  },
  { requiredKeys: [] },
);

/** Hash-shaped strings: known and unknown keys, values from awkward characters and escapes. */
const hashLike = fc
  .array(
    fc.tuple(
      fc.constantFrom(
        'snapshot',
        'tick',
        'lens',
        'focus',
        'focus.project',
        'root',
        'detail',
        'hide',
        'regions',
        'depth',
        'show-regions',
        'flips',
        'selection',
        'x',
        '',
      ),
      fc.string({ unit: fc.constantFrom(...AWKWARD, 'a', '1', '%E0', '%ZZ', '%25', '-'), maxLength: 8 }),
    ),
    { maxLength: 8 },
  )
  .map((fields) => fields.map(([key, value]) => `${key}=${value}`).join('&'));

/**
 * Hashes that once needed care, always tried first: stray separators and escapes, a `__proto__` focus
 * parameter (which hashLike cannot generate) and lone surrogates.
 */
const ADVERSARIAL_HASHES = [
  '%',
  '&&&',
  '=',
  '#&=&',
  '#%23',
  'focus.__proto__=x&focus=project',
  '\uD800=\uDC00',
  'a=b=c',
];

// Each property takes up to about 2 s on its own and over 5 s in a full run under parallel load, so the block
// gets its own timeout rather than fewer runs.
describe('URL-hash codec properties', { timeout: 30_000 }, () => {
  it('generates only views the schema accepts', () => {
    fc.assert(
      fc.property(validSpec, (spec) => {
        expect(ViewSpecSchema.safeParse(spec).success).toBe(true);
      }),
    );
  });

  it('round-trips every valid view: decode(encode(spec)) equals normalizeViewSpec(spec)', () => {
    fc.assert(
      fc.property(validSpec, (spec) => {
        expect(decodeViewSpec(encodeViewSpec(spec))).toEqual(normalizeViewSpec(spec));
      }),
      { numRuns: 500 },
    );
  });

  it('round-trips any input whatsoever, and the result is always valid', () => {
    fc.assert(
      fc.property(looseSpec, (input) => {
        const normalized = normalizeViewSpec(input);
        expect(ViewSpecSchema.safeParse(normalized).success).toBe(true);
        expect(decodeViewSpec(encodeViewSpec(input))).toEqual(normalized);
      }),
      { numRuns: 300 },
    );
  });

  it('normalises exactly as the zod-based reference does (no zod on the parse path)', () => {
    fc.assert(
      fc.property(fc.oneof(looseSpec, validSpec, junk), (input) => {
        expect(normalizeViewSpec(input as never)).toEqual(referenceNormalize(input));
      }),
      { numRuns: 1000 },
    );
  });

  it('normalises idempotently and encodes canonically', () => {
    fc.assert(
      fc.property(validSpec, (spec) => {
        const hash = encodeViewSpec(spec);
        expect(normalizeViewSpec(normalizeViewSpec(spec))).toEqual(normalizeViewSpec(spec));
        expect(encodeViewSpec(decodeViewSpec(hash))).toBe(hash);
      }),
    );
  });

  it('writes only unreserved URL characters and the grammar’s separators', () => {
    fc.assert(
      fc.property(validSpec, (spec) => {
        expect(encodeViewSpec(spec)).toMatch(/^[A-Za-z0-9\-._~*/:@%=&,]*$/);
      }),
    );
  });

  it('decodes any string without throwing, to a valid view', () => {
    fc.assert(
      fc.property(fc.oneof(hashLike, fc.string({ unit: 'binary' })), (hash) => {
        expect(ViewSpecSchema.safeParse(decodeViewSpec(hash)).success).toBe(true);
      }),
      { numRuns: 500, examples: ADVERSARIAL_HASHES.map((hash): [string] => [hash]) },
    );
  });
});
