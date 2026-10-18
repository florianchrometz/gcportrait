// SPDX-License-Identifier: Apache-2.0
/**
 * The zod-free normaliser's predicates against the schemas they stand in for: for valid values, near
 * misses and anything at all, each accepts exactly what its schema accepts. view-spec.test.ts covers
 * `normalizeViewSpec` field by field; view-hash.property.test.ts compares it with a zod-based reference.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type * as z from 'zod';
import {
  ASSET_TYPE_PATTERN_OR_GLOB,
  AssetTypePatternSchema,
  LOCATION_PATTERN,
  LocationSchema,
  NUMERIC_ID_PATTERN,
  NumericIdSchema,
  PROJECT_REF_PATTERN,
  ProjectRefSchema,
  TextSchema,
} from '../schemas/primitives.js';
import { TickSchema } from '../schemas/timeline.js';
import { TICK_CASES } from '../testing/fixtures.js';
import { DepthSchema, FlipIdSchema, FocusParamNameSchema } from '../schemas/view-spec.js';
import {
  FLIP_ID_PATTERN,
  FOCUS_PARAM_NAME_PATTERN,
  VIEW_SPEC_MAX_DEPTH,
  isAssetTypePattern,
  isDepth,
  isFlipId,
  isFocusParamName,
  isLocation,
  isNumericId,
  isProjectRef,
  isText,
  isTick,
  normalizeViewSpec,
} from './normalize.js';

function agreeOn(schema: z.ZodType, guard: (value: unknown) => boolean, values: fc.Arbitrary<unknown>): void {
  fc.assert(
    fc.property(values, (value) => {
      expect(guard(value)).toBe(schema.safeParse(value).success);
    }),
    { numRuns: 300 },
  );
}

const strings = fc.oneof(
  fc.string(),
  fc.string({ unit: 'binary' }),
  fc.constantFrom('', '\uD800', 'a\uDC00b', '😀', 'é'),
);

describe('the predicates agree with their schemas', () => {
  const patterned: [string, z.ZodType, (value: unknown) => boolean, RegExp][] = [
    ['location', LocationSchema, isLocation, LOCATION_PATTERN],
    ['project ref', ProjectRefSchema, isProjectRef, PROJECT_REF_PATTERN],
    ['numeric id', NumericIdSchema, isNumericId, NUMERIC_ID_PATTERN],
    ['asset type pattern', AssetTypePatternSchema, isAssetTypePattern, ASSET_TYPE_PATTERN_OR_GLOB],
    ['focus parameter name', FocusParamNameSchema, isFocusParamName, FOCUS_PARAM_NAME_PATTERN],
    ['flip id', FlipIdSchema, isFlipId, FLIP_ID_PATTERN],
  ];

  it.each(patterned)('%s', (_name, schema, guard, pattern) => {
    agreeOn(schema, guard, fc.oneof(fc.stringMatching(pattern), strings, fc.anything()));
  });

  it('text', () => {
    agreeOn(TextSchema, isText, fc.oneof(strings, fc.anything()));
  });

  it('depth', () => {
    expect([1, VIEW_SPEC_MAX_DEPTH].every(isDepth)).toBe(true);
    expect([0, VIEW_SPEC_MAX_DEPTH + 1, 1.5, '3', Number.NaN, Infinity].some(isDepth)).toBe(false);
    agreeOn(
      DepthSchema,
      isDepth,
      fc.oneof(fc.integer({ min: -3, max: VIEW_SPEC_MAX_DEPTH + 3 }), fc.double(), fc.anything()),
    );
  });

  it('tick: a calendar date that exists, leap days by the Gregorian rule, or a UTC time to the second on one', () => {
    for (const tick of [...TICK_CASES.days, ...TICK_CASES.times]) expect(isTick(tick)).toBe(true);
    for (const tick of TICK_CASES.invalid) expect(isTick(tick)).toBe(false);
    const parts = fc.tuple(
      fc.integer({ min: 0, max: 9999 }),
      fc.integer({ min: 0, max: 14 }),
      fc.integer({ min: 0, max: 32 }),
    );
    const dates = parts.map(
      ([year, month, day]) =>
        `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    );
    const times = fc
      .tuple(
        dates,
        fc.integer({ min: 0, max: 25 }),
        fc.integer({ min: 0, max: 61 }),
        fc.integer({ min: 0, max: 61 }),
        fc.constantFrom('Z', 'z', '', '.000Z', '+00:00'),
      )
      .map(
        ([date, hour, minute, second, zone]) =>
          `${date}T${[hour, minute, second].map((part) => String(part).padStart(2, '0')).join(':')}${zone}`,
      );
    agreeOn(TickSchema, isTick, fc.oneof(dates, times, strings, fc.anything()));
  });
});

describe('normalizeViewSpec reads plain objects only', () => {
  it('reads own fields of a plain object, with or without a prototype', () => {
    const bare = Object.assign(Object.create(null) as object, { lens: 'networking' });
    expect(normalizeViewSpec(bare).lens).toBe('networking');
    expect(normalizeViewSpec({ lens: 'data' }).lens).toBe('data');
  });

  it('treats arrays, class instances and inherited fields as no fields', () => {
    class Holder {
      lens = 'networking';
    }
    const inherited = Object.create({ lens: 'networking' }) as object;
    for (const input of [['networking'], new Holder(), inherited, new Date(0)])
      expect(normalizeViewSpec(input as never).lens).toBe('overview');
  });

  it('never takes a prototype from a __proto__ key', () => {
    const input = JSON.parse('{"__proto__": {"lens": "data"}, "detail": "all"}') as object;
    const spec = normalizeViewSpec(input);
    expect(spec.lens).toBe('overview');
    expect(spec.detail).toBe('all');
    expect(Object.getPrototypeOf(spec)).toBe(Object.prototype);
  });
});
