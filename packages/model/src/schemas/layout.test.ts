// SPDX-License-Identifier: Apache-2.0
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  ArrangementSchema,
  ArrangementsSchema,
  EdgeBundleSchema,
  EdgeHeadsSchema,
  EdgePathSchema,
  EdgePortSchema,
  FONT_FACE_KEYS,
  FontFaceKeySchema,
  FontFaceMetricsSchema,
  FontMetricsTableSchema,
  GapWideningSchema,
  GutterReservationsSchema,
  GutterWideningSchema,
  InsetsSchema,
  LayoutCancelReasonSchema,
  LayoutCancelledReasonSchema,
  LayoutCountsSchema,
  LayoutInputErrorCodeSchema,
  LayoutProgressSchema,
  LayoutRectSchema,
  LayoutReportSchema,
  LayoutResultSchema,
  LayoutSchema,
  LayoutStageSchema,
  LayoutWorkerErrorCodeSchema,
  LayoutWorkerErrorInfoSchema,
  LayoutWorkerOptionsSchema,
  LayoutWorkerResponseSchema,
  PointSchema,
  RectRoleSchema,
  RectSchema,
  RelationKindSchema,
  RoutingReportSchema,
  RoutingSchema,
  SideSchema,
  SizingSchema,
  StageTimingsSchema,
  type Arrangement,
  type Arrangements,
  type EdgeBundle,
  type EdgeHeads,
  type EdgePath,
  type EdgePort,
  type FontFaceKey,
  type FontFaceMetrics,
  type FontMetricsTable,
  type GapWidening,
  type GutterReservations,
  type GutterWidening,
  type Insets,
  type Layout,
  type LayoutCancelReason,
  type LayoutCancelledReason,
  type LayoutCounts,
  type LayoutInputErrorCode,
  type LayoutProgress,
  type LayoutRect,
  type LayoutReport,
  type LayoutResult,
  type LayoutStage,
  type LayoutWorkerErrorCode,
  type LayoutWorkerErrorInfo,
  type LayoutWorkerOptions,
  type LayoutWorkerResponse,
  type Point,
  type Rect,
  type RectRole,
  type RoutingReport,
  type Routing,
  type Side,
  type Sizing,
  type StageTimings,
} from '../index.js';

const point = { x: -1.25, y: 0.5 };
const arrangement = { cardColumns: -1.5, zoneRows: [0, 2.25], zoneStacks: [[], [-0.5, 0]] };
const gaps = { cardColumns: [-1.5], zoneColumns: [[], [0, 2.25]], stacks: [[[], [-0.5]]], rows: [0] };
const widening = { horizontal: -1.5, vertical: 0, ring: 2.25, ringSides: { left: -0.5 }, gaps };

describe('layout font metrics contracts', () => {
  const keys = ['sans-400', 'sans-500', 'sans-700', 'mono-400'] as const;
  const face = {
    family: '',
    weight: -0.5,
    unitsPerEm: 0,
    ascent: -1.25,
    descent: 2.5,
    lineGap: -3,
    fallback: 0.25,
    runs: [[], [100], [2, -0.5], [1, 2.25]],
  };
  const faces = Object.fromEntries(keys.map((key) => [key, face]));
  const sources = Object.fromEntries([
    ['__proto__', ''],
    ['constructor', 'v1'],
    ['', 'v2'],
  ]);
  const input = { format: 1, sources, faces };

  it('uses exactly the shared four face keys', () => {
    expect(FontFaceKeySchema.options).toEqual(keys);
    expect(FONT_FACE_KEYS).toEqual(keys);
    for (const key of keys) expect(FontFaceKeySchema.parse(key)).toBe(key);
    for (const key of ['mono-500', 'sans-900', '', '__proto__', null, 400, undefined]) {
      expect(FontFaceKeySchema.safeParse(key).success).toBe(false);
    }
    expectTypeOf<FontFaceKey>().toEqualTypeOf<(typeof keys)[number]>();
  });

  it('preserves the readonly shape without operational font or run refinements', () => {
    const parsed = FontMetricsTableSchema.parse(input);
    expect(parsed).toEqual(input);
    expect(Object.keys(parsed)).toEqual(['format', 'sources', 'faces']);
    expect(Object.keys(parsed.faces)).toEqual(keys);
    expect(Object.keys(parsed.faces['sans-400'])).toEqual(Object.keys(face));
    expect(FontMetricsTableSchema.parse(JSON.parse(JSON.stringify(input)))).toEqual(input);
    expectTypeOf<FontFaceMetrics>().toEqualTypeOf<
      Readonly<{
        family: string;
        weight: number;
        unitsPerEm: number;
        ascent: number;
        descent: number;
        lineGap: number;
        fallback: number;
        runs: readonly (readonly number[])[];
      }>
    >();
    expectTypeOf<FontMetricsTable>().toEqualTypeOf<
      Readonly<{
        format: 1;
        sources: Readonly<Record<string, string>>;
        faces: Readonly<Record<FontFaceKey, FontFaceMetrics>>;
      }>
    >();
    for (const value of [
      parsed,
      parsed.sources,
      parsed.faces,
      parsed.faces['sans-400'],
      parsed.faces['sans-400'].runs,
      ...parsed.faces['sans-400'].runs,
    ]) {
      expect(Object.isFrozen(value)).toBe(true);
    }
    expect(Object.isFrozen(input)).toBe(false);
  });

  it('preserves every own source key in plain and null-prototype maps', () => {
    const nullPrototype = Object.assign(Object.create(null) as Record<string, string>, sources);
    for (const sourceMap of [sources, nullPrototype, {}]) {
      const parsed = FontMetricsTableSchema.parse({ ...input, sources: sourceMap });
      expect(Object.keys(parsed.sources)).toEqual(Object.keys(sourceMap));
      expect(JSON.stringify(parsed.sources)).toBe(JSON.stringify(sourceMap));
      for (const key of Object.keys(sourceMap)) {
        expect(Object.hasOwn(parsed.sources, key)).toBe(true);
        expect(parsed.sources[key]).toBe(sourceMap[key]);
      }
    }
    for (const key of Object.keys(sources)) {
      const invalidSources: unknown = Object.fromEntries([...Object.entries(sources), [key, 1]]);
      const invalid = FontMetricsTableSchema.safeParse({
        ...input,
        sources: invalidSources,
      });
      expect(invalid.success).toBe(false);
      if (!invalid.success)
        expect(invalid.error.issues.map((issue) => issue.path)).toEqual([['sources', key]]);
    }
    for (const sourceMap of [null, [], new Date(0), { [Symbol('source')]: 'v1' }]) {
      expect(FontMetricsTableSchema.safeParse({ ...input, sources: sourceMap }).success).toBe(false);
    }
  });

  it('requires every declared field and face and rejects extra keys', () => {
    for (const key of Object.keys(face)) {
      const missing = Object.fromEntries(Object.entries(face).filter(([name]) => name !== key));
      expect(FontFaceMetricsSchema.safeParse(missing).success).toBe(false);
      expect(FontFaceMetricsSchema.safeParse({ ...face, [key]: undefined }).success).toBe(false);
    }
    for (const key of Object.keys(input)) {
      const missing = Object.fromEntries(Object.entries(input).filter(([name]) => name !== key));
      expect(FontMetricsTableSchema.safeParse(missing).success).toBe(false);
    }
    for (const key of keys) {
      const missing = Object.fromEntries(Object.entries(faces).filter(([name]) => name !== key));
      expect(FontMetricsTableSchema.safeParse({ ...input, faces: missing }).success).toBe(false);
    }
    expect(FontFaceMetricsSchema.safeParse({ ...face, extra: true }).success).toBe(false);
    for (const invalid of [
      { ...input, extra: true },
      { ...input, format: 2 },
      { ...input, faces: { ...faces, 'mono-500': face } },
      { ...input, faces: Object.fromEntries([...Object.entries(faces), ['__proto__', face]]) },
    ]) {
      expect(FontMetricsTableSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it('rejects nonfinite metrics and run entries without losing nested paths', () => {
    for (const key of ['weight', 'unitsPerEm', 'ascent', 'descent', 'lineGap', 'fallback']) {
      for (const value of [Infinity, -Infinity, NaN, '1', null]) {
        const invalid = FontFaceMetricsSchema.safeParse({ ...face, [key]: value });
        expect(invalid.success).toBe(false);
        if (!invalid.success) expect(invalid.error.issues.map((issue) => issue.path)).toEqual([[key]]);
      }
    }
    for (const invalid of [
      { ...face, family: 1 },
      { ...face, runs: null },
      { ...face, runs: [1] },
    ]) {
      expect(FontFaceMetricsSchema.safeParse(invalid).success).toBe(false);
    }
    const invalid = FontMetricsTableSchema.safeParse({
      ...input,
      faces: { ...faces, 'sans-400': { ...face, runs: [[1, Infinity]] } },
    });
    expect(invalid.success).toBe(false);
    if (!invalid.success)
      expect(invalid.error.issues.map((issue) => issue.path)).toEqual([['faces', 'sans-400', 'runs', 0, 1]]);
  });
});

describe('layout sizing and routing contracts', () => {
  const sizingKeys = [
    'cardHeight',
    'cardMinWidth',
    'cardMaxWidth',
    'cardIcon',
    'cardPadding',
    'chipHeight',
    'chipMinWidth',
    'chipMaxWidth',
    'chipGlyph',
    'chipGlyphGap',
    'headerHeight',
    'deepHeaderHeight',
    'shallowHeaderMaxDepth',
    'zonePadding',
    'rootProjectPadding',
    'gapHorizontal',
    'gapVertical',
    'canvasMargin',
    'headerIcon',
    'headerIconGap',
    'headerBadgeGap',
    'badgePaddingX',
    'badgeSpacing',
    'cardTitleSize',
    'cardSubtitleSize',
    'zoneTitleSize',
    'deepZoneTitleSize',
    'largeTitleMaxDepth',
    'zoneTitleMaxWidth',
    'badgeTextSize',
  ] as const;
  const routingKeys = [
    'lanePitch',
    'gutterBase',
    'bendCost',
    'laneCost',
    'portSpacing',
    'portClearance',
    'zonePortClearance',
    'arrowInset',
    'elbowRadius',
    'singlePassWork',
    'oneRoundWork',
    'wideningRounds',
    'lateRoundsUpTo',
    'bundleMin',
    'fallbackGrid',
    'hugFactor',
    'hugCap',
    'marginFactor',
  ] as const;

  it('infers exactly the existing readonly numeric fields', () => {
    expectTypeOf<Sizing>().toEqualTypeOf<Readonly<Record<(typeof sizingKeys)[number], number>>>();
    expectTypeOf<Routing>().toEqualTypeOf<Readonly<Record<(typeof routingKeys)[number], number>>>();
  });

  describe.each([
    ['sizing', () => SizingSchema, sizingKeys],
    ['routing', () => RoutingSchema, routingKeys],
  ] as const)('%s', (_name, schemaOf, keys) => {
    it('preserves every field and its order through JSON without adding ranges', () => {
      const schema = schemaOf();
      expect(Object.keys(schema.unwrap().shape)).toEqual(keys);
      for (const value of [-1.25, 0, 0.5, 2.75]) {
        const input = Object.fromEntries(keys.map((key) => [key, value]));
        const parsed = schema.parse(input);
        expect(parsed).toEqual(input);
        expect(Object.keys(parsed)).toEqual(keys);
        expect(JSON.stringify(parsed)).toBe(JSON.stringify(input));
        expect(schema.parse(JSON.parse(JSON.stringify(input)))).toEqual(input);
        expect(Object.isFrozen(parsed)).toBe(true);
        expect(Object.isFrozen(input)).toBe(false);
      }
    });

    it('requires every field, rejects unknown fields and reports invalid numbers by key', () => {
      const schema = schemaOf();
      const input = Object.fromEntries(keys.map((key) => [key, 1]));
      for (const key of keys) {
        const missing = Object.fromEntries(Object.entries(input).filter(([name]) => name !== key));
        expect(schema.safeParse(missing).success).toBe(false);
        for (const value of [NaN, Infinity, -Infinity, undefined, null, '1', false]) {
          const invalid = schema.safeParse({ ...input, [key]: value });
          expect(invalid.success).toBe(false);
          if (!invalid.success) expect(invalid.error.issues.map((issue) => issue.path)).toEqual([[key]]);
        }
      }
      expect(schema.safeParse({ ...input, extra: 1 }).success).toBe(false);
      for (const invalid of [null, [], 'sizing', 1]) expect(schema.safeParse(invalid).success).toBe(false);
    });
  });

  it('does not make operational range relationships part of the shape', () => {
    const sizing = {
      ...Object.fromEntries(sizingKeys.map((key) => [key, 1])),
      cardMinWidth: 3,
      chipMinWidth: 4,
    };
    expect(SizingSchema.parse(sizing)).toEqual(sizing);
    const routing = { ...Object.fromEntries(routingKeys.map((key) => [key, 1])), oneRoundWork: 3 };
    expect(RoutingSchema.parse(routing)).toEqual(routing);
  });
});

describe('layout worker error contracts', () => {
  const inputCodes = [
    'duplicate-id',
    'unknown-endpoint',
    'cycle',
    'collapsed-with-children',
    'too-deep',
    'invalid-option',
  ] as const;
  const workerCodes = [...inputCodes, 'protocol', 'internal'] as const;

  it('has exactly the existing six input codes and eight worker codes', () => {
    expect(LayoutInputErrorCodeSchema.options).toEqual(inputCodes);
    expect(LayoutWorkerErrorCodeSchema.options).toEqual(workerCodes);
    for (const code of inputCodes) expect(LayoutInputErrorCodeSchema.parse(code)).toBe(code);
    for (const code of ['protocol', 'internal', '', 'unknown', null, 1, undefined]) {
      expect(LayoutInputErrorCodeSchema.safeParse(code).success).toBe(false);
    }
    for (const code of ['', 'unknown', null, 1, undefined]) {
      expect(LayoutWorkerErrorCodeSchema.safeParse(code).success).toBe(false);
    }
  });

  it.each(workerCodes)('preserves %s payloads, empty text and unsorted duplicate ids', (code) => {
    expect(LayoutWorkerErrorCodeSchema.parse(code)).toBe(code);
    for (const ids of [[], ['z', '', '__proto__', 'z', 'a']]) {
      const error = { code, message: '', ids };
      const parsed = LayoutWorkerErrorInfoSchema.parse(error);
      expect(parsed).toEqual(error);
      expect(JSON.stringify(parsed)).toBe(JSON.stringify(error));
      expect(LayoutWorkerErrorInfoSchema.parse(JSON.parse(JSON.stringify(error)))).toEqual(error);
      expect(Object.isFrozen(parsed)).toBe(true);
      expect(Object.isFrozen(parsed.ids)).toBe(true);
      expect(Object.isFrozen(error)).toBe(false);
      expect(Object.isFrozen(ids)).toBe(false);
    }
  });

  it('requires every field and rejects unknown fields and wrong types with complete paths', () => {
    const error = { code: 'protocol', message: 'invalid request', ids: ['node'] };
    for (const key of Object.keys(error)) {
      const missing = Object.fromEntries(Object.entries(error).filter(([name]) => name !== key));
      expect(LayoutWorkerErrorInfoSchema.safeParse(missing).success).toBe(false);
      expect(LayoutWorkerErrorInfoSchema.safeParse({ ...error, [key]: undefined }).success).toBe(false);
    }
    for (const invalid of [
      { ...error, extra: 1 },
      { ...error, code: 'unknown' },
      { ...error, message: 1 },
      { ...error, ids: null },
    ]) {
      expect(LayoutWorkerErrorInfoSchema.safeParse(invalid).success).toBe(false);
    }
    const parsed = LayoutWorkerErrorInfoSchema.safeParse({ ...error, ids: ['node', 1] });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues.map((issue) => issue.path)).toEqual([['ids', 1]]);
  });

  it('infers the unchanged code unions and readonly payload fields', () => {
    expectTypeOf<LayoutInputErrorCode>().toEqualTypeOf<(typeof inputCodes)[number]>();
    expectTypeOf<LayoutWorkerErrorCode>().toEqualTypeOf<(typeof workerCodes)[number]>();
    expectTypeOf<LayoutWorkerErrorInfo>().toEqualTypeOf<
      Readonly<{ code: LayoutWorkerErrorCode; message: string; ids: readonly string[] }>
    >();
  });
});

describe('layout progress contracts', () => {
  it.each(['normalise', 'size', 'pack', 'route', 'widen'] as const)('preserves the %s stage', (stage) => {
    const progress = { stage, pass: -1.25, routed: 2.5, edges: 0 };
    expect(LayoutStageSchema.parse(stage)).toBe(stage);
    expect(LayoutProgressSchema.parse(progress)).toEqual(progress);
    expect(LayoutProgressSchema.parse(JSON.parse(JSON.stringify(progress)))).toEqual(progress);
  });

  it('has exactly the five existing stage values', () => {
    expect(LayoutStageSchema.options).toEqual(['normalise', 'size', 'pack', 'route', 'widen']);
    for (const stage of ['', 'done', 1, null, undefined]) {
      expect(LayoutStageSchema.safeParse(stage).success).toBe(false);
      expect(LayoutProgressSchema.safeParse({ stage, pass: 0, routed: 0, edges: 0 }).success).toBe(false);
    }
  });

  it.each([NaN, Infinity, -Infinity, '1', undefined])('rejects invalid progress numbers: %s', (value) => {
    for (const key of ['pass', 'routed', 'edges']) {
      const parsed = LayoutProgressSchema.safeParse({
        stage: 'route',
        pass: 0,
        routed: 0,
        edges: 0,
        [key]: value,
      });
      expect(parsed.success).toBe(false);
      if (!parsed.success) expect(parsed.error.issues.map((issue) => issue.path)).toEqual([[key]]);
    }
  });

  it('requires every field and refuses unknown fields', () => {
    const progress = { stage: 'route', pass: 0, routed: 0, edges: 0 };
    for (const key of Object.keys(progress)) {
      const missing = Object.fromEntries(Object.entries(progress).filter(([name]) => name !== key));
      expect(LayoutProgressSchema.safeParse(missing).success).toBe(false);
    }
    expect(LayoutProgressSchema.safeParse({ ...progress, extra: 1 }).success).toBe(false);
  });

  it('preserves the readonly inferred fields without timing or stage-dependent constraints', () => {
    expectTypeOf<LayoutStage>().toEqualTypeOf<'normalise' | 'size' | 'pack' | 'route' | 'widen'>();
    expectTypeOf<LayoutProgress>().toEqualTypeOf<
      Readonly<{ stage: LayoutStage; pass: number; routed: number; edges: number }>
    >();
    const progress = { stage: 'normalise', pass: -0.5, routed: 4.25, edges: -1 };
    const parsed = LayoutProgressSchema.parse(progress);
    expect(parsed).toEqual(progress);
    expect(Object.keys(parsed)).toEqual(['stage', 'pass', 'routed', 'edges']);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(progress)).toBe(false);
  });
});

describe('layout container records', () => {
  it.each(['plain', 'null prototype'] as const)('preserves every own string key in a %s map', (kind) => {
    const keys = ['2', '10', 'zone', '__proto__', 'constructor', ''];
    const entries = keys.map((key) => [key, arrangement] as const);
    const zones: Record<string, Arrangement> =
      kind === 'plain'
        ? Object.fromEntries(entries)
        : Object.assign(Object.create(null) as Record<string, Arrangement>, Object.fromEntries(entries));
    const parsed = ArrangementsSchema.parse({ canvas: arrangement, zones });
    expect(Object.keys(parsed.zones)).toEqual(keys);
    for (const key of keys) {
      expect(Object.hasOwn(parsed.zones, key)).toBe(true);
      expect(parsed.zones[key]).toEqual(arrangement);
    }
    expect(Object.getPrototypeOf(parsed.zones)).toBe(Object.prototype);
    expect(Object.isFrozen(zones)).toBe(false);
    expect(Object.isFrozen(arrangement)).toBe(false);
    expect(JSON.stringify(parsed.zones)).toBe(JSON.stringify(zones));
    expect(ArrangementsSchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
    const gutterEntries = Object.fromEntries(keys.map((key) => [key, widening]));
    const gutterZones =
      kind === 'plain'
        ? gutterEntries
        : Object.assign(Object.create(null) as Record<string, GutterWidening>, gutterEntries);
    const reservations = GutterReservationsSchema.parse({ zones: gutterZones });
    expect(Object.keys(reservations.zones ?? {})).toEqual(keys);
    expect(GutterReservationsSchema.parse(JSON.parse(JSON.stringify(reservations)))).toEqual(reservations);
  });

  it('keeps empty maps and exact optional fields without adding defaults', () => {
    expect(ArrangementsSchema.parse({ canvas: arrangement, zones: {} })).toEqual({
      canvas: arrangement,
      zones: {},
    });
    expect(GutterReservationsSchema.parse({})).toEqual({});
    expect(GutterReservationsSchema.parse({ canvas: {}, zones: {} })).toEqual({ canvas: {}, zones: {} });
    for (const key of ['canvas', 'zones']) {
      expect(GutterReservationsSchema.safeParse({ [key]: undefined }).success).toBe(false);
      expect(ArrangementsSchema.safeParse({ canvas: arrangement, zones: {}, [key]: undefined }).success).toBe(
        false,
      );
    }
    expect(ArrangementsSchema.safeParse({ canvas: arrangement }).success).toBe(false);
    expect(ArrangementsSchema.safeParse({ zones: {} }).success).toBe(false);
    expect(ArrangementsSchema.safeParse({ canvas: arrangement, zones: {}, extra: 1 }).success).toBe(false);
    expect(GutterReservationsSchema.safeParse({ extra: 1 }).success).toBe(false);
  });

  it.each(['__proto__', 'constructor', ''])(
    'rejects invalid values under %j with their complete paths',
    (key) => {
      const parsed = ArrangementsSchema.safeParse({
        canvas: arrangement,
        zones: Object.fromEntries<unknown>([
          ['valid', arrangement],
          [key, { ...arrangement, zoneRows: [Infinity] }],
        ]),
      });
      expect(parsed.success).toBe(false);
      if (!parsed.success)
        expect(parsed.error.issues.map((issue) => issue.path)).toEqual([['zones', key, 'zoneRows', 0]]);
      const reservations = GutterReservationsSchema.safeParse({
        zones: Object.fromEntries<unknown>([
          ['valid', widening],
          [key, { ringSides: { left: undefined } }],
        ]),
      });
      expect(reservations.success).toBe(false);
      if (!reservations.success)
        expect(reservations.error.issues.map((issue) => issue.path)).toEqual([
          ['zones', key, 'ringSides', 'left'],
        ]);
    },
  );

  it('reports all invalid record entries rather than returning a partial map', () => {
    const parsed = ArrangementsSchema.safeParse({
      canvas: arrangement,
      zones: Object.fromEntries<unknown>([
        ['__proto__', { ...arrangement, cardColumns: NaN }],
        ['constructor', { ...arrangement, cardColumns: undefined }],
      ]),
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success)
      expect(parsed.error.issues.map((issue) => issue.path)).toEqual([
        ['zones', '__proto__', 'cardColumns'],
        ['zones', 'constructor', 'cardColumns'],
      ]);
  });

  it.each([
    null,
    undefined,
    [],
    [arrangement],
    Object.setPrototypeOf([], null) as unknown,
    'record',
    1,
    true,
    () => ({}),
    new Map(),
    new Set(),
    new Date(0),
    new (class {
      readonly value = arrangement;
    })(),
    Object.create({ inherited: arrangement }) as unknown,
  ])('refuses a non-record input: %s', (zones) => {
    expect(ArrangementsSchema.safeParse({ canvas: arrangement, zones }).success).toBe(false);
    expect(GutterReservationsSchema.safeParse({ zones }).success).toBe(false);
  });

  it('refuses enumerable symbol keys and ignores nonenumerable properties', () => {
    expect(
      ArrangementsSchema.safeParse({ canvas: arrangement, zones: { [Symbol('zone')]: arrangement } }).success,
    ).toBe(false);
    const zones = Object.defineProperty({ zone: arrangement }, 'hidden', { value: null, enumerable: false });
    const parsed = ArrangementsSchema.parse({ canvas: arrangement, zones });
    expect(Object.keys(parsed.zones)).toEqual(['zone']);
    expect(Object.hasOwn(parsed.zones, 'toString')).toBe(false);
    expect(Object.hasOwn(parsed.zones, 'hidden')).toBe(false);
  });

  it('preserves readonly nested records and exact optionality in the inferred types', () => {
    expectTypeOf<Arrangements>().toEqualTypeOf<
      Readonly<{ canvas: Arrangement; zones: Readonly<Record<string, Arrangement>> }>
    >();
    expectTypeOf<GutterReservations>().toEqualTypeOf<
      Readonly<{ canvas?: GutterWidening; zones?: Readonly<Record<string, GutterWidening>> }>
    >();
    const parsed = ArrangementsSchema.parse({ canvas: arrangement, zones: { zone: arrangement } });
    const reservations = GutterReservationsSchema.parse({ canvas: widening, zones: { zone: widening } });
    for (const value of [
      parsed,
      parsed.canvas,
      parsed.zones,
      parsed.zones.zone,
      parsed.zones.zone?.zoneRows,
      reservations,
      reservations.canvas,
      reservations.zones,
      reservations.zones?.zone,
      reservations.zones?.zone?.gaps?.stacks?.[0]?.[1],
    ]) {
      expect(Object.isFrozen(value)).toBe(true);
    }
  });
});

describe('layout packing contracts', () => {
  it('preserves finite negative and fractional values without packing refinements', () => {
    expect(ArrangementSchema.parse(arrangement)).toEqual(arrangement);
    expect(GapWideningSchema.parse(gaps)).toEqual(gaps);
    expect(GutterWideningSchema.parse(widening)).toEqual(widening);
    expect(GutterWideningSchema.parse(JSON.parse(JSON.stringify(widening)))).toEqual(widening);
  });

  it('keeps absent options absent, and accepts empty arrays and partial padding', () => {
    expect(ArrangementSchema.parse({ cardColumns: 0, zoneRows: [] })).not.toHaveProperty('zoneStacks');
    expect(GapWideningSchema.parse({})).toEqual({});
    expect(GutterWideningSchema.parse({})).toEqual({});
    expect(ArrangementSchema.parse({ cardColumns: 0, zoneRows: [], zoneStacks: [] }).zoneStacks).toEqual([]);
    const emptyGaps = { cardColumns: [], zoneColumns: [], stacks: [], rows: [] };
    expect(GapWideningSchema.parse(emptyGaps)).toEqual(emptyGaps);
    for (const ringSides of [{}, { top: 0 }, { right: 2.25, bottom: -0.5 }]) {
      expect(GutterWideningSchema.parse({ ringSides })).toEqual({ ringSides });
    }
  });

  it('refuses explicitly undefined optional fields at every level', () => {
    expect(ArrangementSchema.safeParse({ ...arrangement, zoneStacks: undefined }).success).toBe(false);
    for (const key of Object.keys(gaps)) {
      expect(GapWideningSchema.safeParse({ [key]: undefined }).success).toBe(false);
    }
    for (const key of Object.keys(widening)) {
      expect(GutterWideningSchema.safeParse({ [key]: undefined }).success).toBe(false);
    }
    for (const side of ['top', 'right', 'bottom', 'left']) {
      expect(GutterWideningSchema.safeParse({ ringSides: { [side]: undefined } }).success).toBe(false);
    }
  });

  it.each([Number.NaN, Infinity, -Infinity, '1', undefined])(
    'refuses invalid numeric values: %s',
    (value) => {
      expect(ArrangementSchema.safeParse({ ...arrangement, cardColumns: value }).success).toBe(false);
      expect(ArrangementSchema.safeParse({ ...arrangement, zoneRows: [value] }).success).toBe(false);
      expect(ArrangementSchema.safeParse({ ...arrangement, zoneStacks: [[value]] }).success).toBe(false);
      for (const key of ['cardColumns', 'rows']) {
        expect(GapWideningSchema.safeParse({ [key]: [value] }).success).toBe(false);
      }
      expect(GapWideningSchema.safeParse({ zoneColumns: [[value]] }).success).toBe(false);
      expect(GapWideningSchema.safeParse({ stacks: [[[value]]] }).success).toBe(false);
      for (const key of ['horizontal', 'vertical', 'ring']) {
        expect(GutterWideningSchema.safeParse({ [key]: value }).success).toBe(false);
      }
      expect(GutterWideningSchema.safeParse({ ringSides: { left: value } }).success).toBe(false);
    },
  );

  it('refuses missing fields, malformed nested arrays and unknown fields', () => {
    expect(ArrangementSchema.safeParse({ zoneRows: [] }).success).toBe(false);
    expect(ArrangementSchema.safeParse({ ...arrangement, extra: 1 }).success).toBe(false);
    expect(GapWideningSchema.safeParse({ zoneColumns: [1] }).success).toBe(false);
    expect(GapWideningSchema.safeParse({ stacks: [[1]] }).success).toBe(false);
    expect(GapWideningSchema.safeParse({ extra: 1 }).success).toBe(false);
    expect(GutterWideningSchema.safeParse({ ringSides: { extra: 1 } }).success).toBe(false);
    expect(GutterWideningSchema.safeParse({ gaps: null }).success).toBe(false);
    expect(GutterWideningSchema.safeParse({ extra: 1 }).success).toBe(false);
  });

  it('preserves readonly nested arrays and exact optional partial Insets', () => {
    expectTypeOf<Arrangement>().toEqualTypeOf<
      Readonly<{
        cardColumns: number;
        zoneRows: readonly number[];
        zoneStacks?: readonly (readonly number[])[];
      }>
    >();
    expectTypeOf<GapWidening>().toEqualTypeOf<
      Readonly<{
        cardColumns?: readonly number[];
        zoneColumns?: readonly (readonly number[])[];
        stacks?: readonly (readonly (readonly number[])[])[];
        rows?: readonly number[];
      }>
    >();
    expectTypeOf<GutterWidening>().toEqualTypeOf<
      Readonly<{
        horizontal?: number;
        vertical?: number;
        ring?: number;
        ringSides?: Partial<Insets>;
        gaps?: GapWidening;
      }>
    >();
    const parsed = GutterWideningSchema.parse(widening);
    const packed = ArrangementSchema.parse(arrangement);
    for (const value of [
      parsed,
      parsed.ringSides,
      parsed.gaps,
      parsed.gaps?.cardColumns,
      parsed.gaps?.zoneColumns,
      parsed.gaps?.zoneColumns?.[1],
      parsed.gaps?.stacks,
      parsed.gaps?.stacks?.[0],
      parsed.gaps?.stacks?.[0]?.[1],
      parsed.gaps?.rows,
      packed,
      packed.zoneRows,
      packed.zoneStacks,
      packed.zoneStacks?.[1],
    ]) {
      expect(Object.isFrozen(value)).toBe(true);
    }
  });
});

const timings = { normalise: -1.25, size: 0, pack: 2.5, route: -0.5, total: 0.75 };
const counts = {
  rects: 1,
  zones: 2,
  chips: 3,
  emptyZones: 4,
  cards: 5,
  edges: 6,
  maxDepth: 7,
  organisationZonesDropped: 8,
  truncatedLabels: 9,
  cappedTitles: 10,
  headerWidened: 11,
};
const routingNumbers = {
  passes: 1,
  edges: 2,
  holders: 3,
  work: 4,
  duplicatesMerged: 5,
  reciprocalMerged: 6,
  bundles: 7,
  bundledEdges: 8,
  dropped: 9,
  fallbacks: 10,
  failed: 11,
  maxLanes: 12,
  widened: 13,
  wideningRounds: 14,
  squeezed: 15,
  overlaps: 16,
};
const routing = { ...routingNumbers, mode: 'none', bends: [0, -1.25, 2.5] } as const;
const report = { counts, routing, warnings: ['z', '', 'a', 'z'] };

describe('layout report contracts', () => {
  it.each(['none', 'single-pass', 'three-pass'] as const)('preserves routing mode %s', (mode) => {
    expect(RoutingReportSchema.parse({ ...routing, mode })).toEqual({ ...routing, mode });
  });

  it.each([-1.25, 0, 2.5])('preserves every numeric field without range refinements: %s', (value) => {
    for (const key of Object.keys(timings)) {
      const sample = { ...timings, [key]: value };
      expect(StageTimingsSchema.parse(sample)).toEqual(sample);
    }
    for (const key of Object.keys(counts)) {
      const sample = { ...counts, [key]: value };
      expect(LayoutCountsSchema.parse(sample)).toEqual(sample);
    }
    for (const key of Object.keys(routingNumbers)) {
      const sample = { ...routing, [key]: value };
      expect(RoutingReportSchema.parse(sample)).toEqual(sample);
    }
  });

  it('preserves warning order, duplicates and empty strings without report refinements', () => {
    expect(LayoutReportSchema.parse(report)).toEqual(report);
    expect(LayoutReportSchema.parse(JSON.parse(JSON.stringify(report)))).toEqual(report);
    const empty = { ...report, routing: { ...routing, bends: [] }, warnings: [] };
    expect(LayoutReportSchema.parse(empty)).toEqual(empty);
  });

  it('keeps timings absent or complete, never explicitly undefined', () => {
    expect(LayoutReportSchema.parse(report)).not.toHaveProperty('timings');
    const timed = { ...report, timings };
    expect(LayoutReportSchema.parse(timed)).toEqual(timed);
    expect(LayoutReportSchema.parse(JSON.parse(JSON.stringify(timed)))).toEqual(timed);
    for (const invalid of [undefined, null, {}, { ...timings, total: undefined }]) {
      expect(LayoutReportSchema.safeParse({ ...report, timings: invalid }).success).toBe(false);
    }
  });

  it.each([Number.NaN, Infinity, -Infinity, '1', undefined])(
    'refuses invalid numeric values: %s',
    (value) => {
      for (const key of Object.keys(timings)) {
        expect(StageTimingsSchema.safeParse({ ...timings, [key]: value }).success).toBe(false);
      }
      for (const key of Object.keys(counts)) {
        expect(LayoutCountsSchema.safeParse({ ...counts, [key]: value }).success).toBe(false);
      }
      for (const key of Object.keys(routingNumbers)) {
        expect(RoutingReportSchema.safeParse({ ...routing, [key]: value }).success).toBe(false);
      }
      expect(RoutingReportSchema.safeParse({ ...routing, bends: [value] }).success).toBe(false);
    },
  );

  it('refuses missing objects, unknown fields, invalid modes and non-string warnings', () => {
    expect(StageTimingsSchema.safeParse({ ...timings, extra: 1 }).success).toBe(false);
    expect(LayoutCountsSchema.safeParse({ ...counts, extra: 1 }).success).toBe(false);
    expect(RoutingReportSchema.safeParse({ ...routing, extra: 1 }).success).toBe(false);
    expect(RoutingReportSchema.safeParse({ ...routing, mode: 'unknown' }).success).toBe(false);
    expect(LayoutReportSchema.safeParse({ ...report, counts: undefined }).success).toBe(false);
    expect(LayoutReportSchema.safeParse({ ...report, routing: undefined }).success).toBe(false);
    expect(LayoutReportSchema.safeParse({ ...report, warnings: [1] }).success).toBe(false);
    expect(LayoutReportSchema.safeParse({ ...report, extra: 1 }).success).toBe(false);
  });

  it('preserves readonly fields, nested arrays and exact optionality in the inferred types', () => {
    expectTypeOf<StageTimings>().toEqualTypeOf<Readonly<typeof timings>>();
    expectTypeOf<LayoutCounts>().toEqualTypeOf<Readonly<typeof counts>>();
    expectTypeOf<RoutingReport>().toEqualTypeOf<
      Readonly<
        typeof routingNumbers & {
          mode: 'none' | 'single-pass' | 'three-pass';
          bends: readonly number[];
        }
      >
    >();
    expectTypeOf<LayoutReport>().toEqualTypeOf<
      Readonly<{
        timings?: StageTimings;
        counts: LayoutCounts;
        routing: RoutingReport;
        warnings: readonly string[];
      }>
    >();
    const parsed = LayoutReportSchema.parse({ ...report, timings });
    for (const value of [
      parsed,
      parsed.timings,
      parsed.counts,
      parsed.routing,
      parsed.routing.bends,
      parsed.warnings,
    ]) {
      expect(Object.isFrozen(value)).toBe(true);
    }
  });
});

const rect = { ...point, width: -2.75, height: 0 };
const insets = { top: -3.5, right: 0, bottom: 4.25, left: -1 };
const layoutRect = {
  ...rect,
  parent: null,
  role: 'card',
  kind: 'card',
  depth: -0.5,
  headerHeight: -2.25,
  padding: -1.5,
  collapsed: true,
} as const;

describe('layout geometry contracts', () => {
  it('preserves finite negative, fractional and zero geometry without role refinements', () => {
    expect(PointSchema.parse(point)).toEqual(point);
    expect(RectSchema.parse(rect)).toEqual(rect);
    expect(InsetsSchema.parse(insets)).toEqual(insets);
    expect(LayoutRectSchema.parse(layoutRect)).toEqual(layoutRect);
  });

  it.each(['zone', 'chip', 'empty', 'card'] as const)('accepts the %s rect role', (role) => {
    expect(RectRoleSchema.parse(role)).toBe(role);
    expect(LayoutRectSchema.parse({ ...layoutRect, role }).role).toBe(role);
  });

  it.each(['folder', 'project', 'vpc', 'subnet', 'region', 'product-container', 'group', 'card'])(
    'accepts the existing %s rect kind',
    (kind) => {
      expect(LayoutRectSchema.parse({ ...layoutRect, kind }).kind).toBe(kind);
    },
  );

  it.each([null, '', 'parent/example.com'])('preserves the parent %j', (parent) => {
    expect(LayoutRectSchema.parse({ ...layoutRect, parent }).parent).toBe(parent);
  });

  it('keeps optional padding absent, or preserves every side when present', () => {
    expect(LayoutRectSchema.parse(layoutRect)).not.toHaveProperty('paddingExtra');
    const padded = { ...layoutRect, paddingExtra: insets };
    expect(LayoutRectSchema.parse(padded)).toEqual(padded);
    expect(LayoutRectSchema.parse(JSON.parse(JSON.stringify(padded)))).toEqual(padded);
  });

  it.each([undefined, null, {}, { ...insets, top: undefined }])(
    'refuses invalid explicit optional padding %j',
    (paddingExtra) => {
      expect(LayoutRectSchema.safeParse({ ...layoutRect, paddingExtra }).success).toBe(false);
    },
  );

  it.each([Number.NaN, Infinity, -Infinity])('refuses non-finite geometry %s', (value) => {
    expect(PointSchema.safeParse({ ...point, x: value }).success).toBe(false);
    expect(RectSchema.safeParse({ ...rect, width: value }).success).toBe(false);
    expect(InsetsSchema.safeParse({ ...insets, top: value }).success).toBe(false);
    expect(LayoutRectSchema.safeParse({ ...layoutRect, depth: value }).success).toBe(false);
  });

  it('refuses missing fields, wrong scalar types and unknown fields', () => {
    expect(PointSchema.safeParse({ x: 1 }).success).toBe(false);
    expect(RectSchema.safeParse({ ...rect, width: '2' }).success).toBe(false);
    expect(InsetsSchema.safeParse({ ...insets, extra: 1 }).success).toBe(false);
    expect(RectRoleSchema.safeParse('unknown')).toMatchObject({ success: false });
    expect(LayoutRectSchema.safeParse({ ...layoutRect, kind: 'unknown' }).success).toBe(false);
    expect(LayoutRectSchema.safeParse({ ...layoutRect, collapsed: 1 }).success).toBe(false);
    expect(LayoutRectSchema.safeParse({ ...layoutRect, extra: 1 }).success).toBe(false);
  });

  it('preserves readonly fields and exact optionality in the inferred types', () => {
    expectTypeOf<Point>().toEqualTypeOf<Readonly<{ x: number; y: number }>>();
    expectTypeOf<Rect>().toEqualTypeOf<Readonly<{ x: number; y: number; width: number; height: number }>>();
    expectTypeOf<Insets>().toEqualTypeOf<
      Readonly<{ top: number; right: number; bottom: number; left: number }>
    >();
    expectTypeOf<RectRole>().toEqualTypeOf<'zone' | 'chip' | 'empty' | 'card'>();
    expectTypeOf<Pick<LayoutRect, 'parent'>>().toEqualTypeOf<Readonly<{ parent: string | null }>>();
    expectTypeOf<Pick<LayoutRect, 'paddingExtra'>>().toEqualTypeOf<Readonly<{ paddingExtra?: Insets }>>();
    expectTypeOf<Pick<LayoutRect, 'chipCountLine'>>().toEqualTypeOf<Readonly<{ chipCountLine?: string }>>();
  });

  it.each(['', '2 networks · 39 resources', '2 net · 39 res'])(
    'preserves the optional chosen chip count line %j',
    (chipCountLine) => {
      const chip = { ...layoutRect, role: 'chip', chipCountLine };
      expect(LayoutRectSchema.parse(chip)).toEqual(chip);
    },
  );

  it('keeps chip count metadata absent or a string, never explicitly undefined', () => {
    expect(LayoutRectSchema.parse(layoutRect)).not.toHaveProperty('chipCountLine');
    expect(LayoutRectSchema.safeParse({ ...layoutRect, chipCountLine: undefined }).success).toBe(false);
    expect(LayoutRectSchema.safeParse({ ...layoutRect, chipCountLine: 2 }).success).toBe(false);
  });
});

const port = { ...point, side: 'left' } as const;
const bundle = { id: '', end: 'source', size: -0.5 } as const;
const edgePath = {
  from: '',
  to: 'target/example.com',
  kind: 'uses',
  count: -1.5,
  merged: false,
  heads: 'end',
  source: port,
  target: { ...port, side: 'right' },
  points: [point],
  elbowRadius: -2.25,
  fallback: true,
} as const;

describe('layout edge contracts', () => {
  it.each(['top', 'right', 'bottom', 'left'] as const)('preserves the %s port side', (side) => {
    expect(SideSchema.parse(side)).toBe(side);
    expect(EdgePortSchema.parse({ ...port, side })).toEqual({ ...port, side });
  });

  it.each(['end', 'both', 'none'] as const)('preserves %s arrowheads', (heads) => {
    expect(EdgeHeadsSchema.parse(heads)).toBe(heads);
    expect(EdgePathSchema.parse({ ...edgePath, heads }).heads).toBe(heads);
  });

  it.each(RelationKindSchema.options)('preserves the %s relation kind', (kind) => {
    expect(EdgePathSchema.parse({ ...edgePath, kind }).kind).toBe(kind);
  });

  it.each(['source', 'target'] as const)('preserves a bundle at the %s end', (end) => {
    const bundled = { ...edgePath, bundle: { ...bundle, end } };
    expect(EdgeBundleSchema.parse(bundled.bundle)).toEqual(bundled.bundle);
    expect(EdgePathSchema.parse(bundled)).toEqual(bundled);
    expect(EdgePathSchema.parse(JSON.parse(JSON.stringify(bundled)))).toEqual(bundled);
  });

  it.each([-1.5, 0, 2.25])('preserves finite geometry and counts without range refinements: %s', (value) => {
    expect(EdgePortSchema.parse({ ...port, x: value, y: value })).toEqual({ ...port, x: value, y: value });
    expect(EdgeBundleSchema.parse({ ...bundle, size: value }).size).toBe(value);
    const edge = { ...edgePath, count: value, elbowRadius: value };
    expect(EdgePathSchema.parse(edge)).toEqual(edge);
  });

  it('preserves empty identifiers and point lists without routing refinements', () => {
    const edge = { ...edgePath, from: '', to: '', points: [] };
    expect(EdgePathSchema.parse(edge)).toEqual(edge);
    expect(EdgeBundleSchema.parse(bundle).id).toBe('');
  });

  it('keeps a bundle absent or complete, never explicitly undefined', () => {
    expect(EdgePathSchema.parse(edgePath)).not.toHaveProperty('bundle');
    for (const invalid of [undefined, null, {}, { ...bundle, end: undefined }]) {
      expect(EdgePathSchema.safeParse({ ...edgePath, bundle: invalid }).success).toBe(false);
    }
  });

  it.each([Number.NaN, Infinity, -Infinity])('refuses non-finite geometry and counts: %s', (value) => {
    expect(EdgePortSchema.safeParse({ ...port, x: value }).success).toBe(false);
    expect(EdgeBundleSchema.safeParse({ ...bundle, size: value }).success).toBe(false);
    expect(EdgePathSchema.safeParse({ ...edgePath, count: value }).success).toBe(false);
    expect(EdgePathSchema.safeParse({ ...edgePath, elbowRadius: value }).success).toBe(false);
    expect(EdgePathSchema.safeParse({ ...edgePath, points: [{ ...point, y: value }] }).success).toBe(false);
  });

  it('refuses unknown enums, missing fields, wrong scalar types and unknown fields', () => {
    expect(SideSchema.safeParse('middle').success).toBe(false);
    expect(EdgeHeadsSchema.safeParse('start').success).toBe(false);
    expect(EdgePortSchema.safeParse(point).success).toBe(false);
    expect(EdgePortSchema.safeParse({ ...port, extra: 1 }).success).toBe(false);
    expect(EdgeBundleSchema.safeParse({ ...bundle, end: 'both' }).success).toBe(false);
    expect(EdgeBundleSchema.safeParse({ ...bundle, size: '1' }).success).toBe(false);
    expect(EdgeBundleSchema.safeParse({ ...bundle, extra: 1 }).success).toBe(false);
    expect(EdgePathSchema.safeParse({ ...edgePath, kind: 'unknown' }).success).toBe(false);
    expect(EdgePathSchema.safeParse({ ...edgePath, merged: 1 }).success).toBe(false);
    expect(EdgePathSchema.safeParse({ ...edgePath, source: undefined }).success).toBe(false);
    expect(EdgePathSchema.safeParse({ ...edgePath, extra: 1 }).success).toBe(false);
  });

  it('preserves readonly fields, nested arrays and exact optionality in the inferred types', () => {
    expectTypeOf<Side>().toEqualTypeOf<'top' | 'right' | 'bottom' | 'left'>();
    expectTypeOf<EdgeHeads>().toEqualTypeOf<'end' | 'both' | 'none'>();
    expectTypeOf<EdgePort>().toEqualTypeOf<Readonly<{ x: number; y: number; side: Side }>>();
    expectTypeOf<EdgeBundle>().toEqualTypeOf<
      Readonly<{ id: string; end: 'source' | 'target'; size: number }>
    >();
    expectTypeOf<Pick<EdgePath, 'source' | 'target'>>().toEqualTypeOf<
      Readonly<{ source: EdgePort; target: EdgePort }>
    >();
    expectTypeOf<Pick<EdgePath, 'points'>>().toEqualTypeOf<Readonly<{ points: readonly Point[] }>>();
    expectTypeOf<Pick<EdgePath, 'bundle'>>().toEqualTypeOf<Readonly<{ bundle?: EdgeBundle }>>();
    const parsed = EdgePathSchema.parse({ ...edgePath, bundle });
    for (const value of [
      parsed,
      parsed.source,
      parsed.target,
      parsed.points,
      parsed.points[0],
      parsed.bundle,
    ]) {
      expect(Object.isFrozen(value)).toBe(true);
    }
  });
});

const completeLayout = {
  rects: Object.fromEntries([
    ['__proto__', layoutRect],
    ['constructor', layoutRect],
    ['', layoutRect],
  ]),
  edges: Object.fromEntries([
    ['__proto__', edgePath],
    ['constructor', edgePath],
    ['', edgePath],
  ]),
  chips: ['constructor', '', 'constructor'],
  bounds: rect,
  arrangements: { canvas: arrangement, zones: { zone: arrangement } },
  gutters: { canvas: widening, zones: { zone: widening } },
  report,
};

describe('complete layout contract', () => {
  it('composes the seven fields without cross-field refinements or reordered record keys', () => {
    const parsed = LayoutSchema.parse(completeLayout);
    expect(parsed).toEqual(completeLayout);
    expect(Object.keys(parsed)).toEqual([
      'rects',
      'edges',
      'chips',
      'bounds',
      'arrangements',
      'gutters',
      'report',
    ]);
    expect(Object.keys(parsed.rects)).toEqual(['__proto__', 'constructor', '']);
    expect(Object.keys(parsed.edges)).toEqual(['__proto__', 'constructor', '']);
    expect(JSON.stringify(parsed.rects)).toBe(JSON.stringify(completeLayout.rects));
    expect(JSON.stringify(parsed.edges)).toBe(JSON.stringify(completeLayout.edges));
    expect(LayoutSchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
    expect(Object.isFrozen(completeLayout)).toBe(false);
  });

  it('accepts empty records and chip lists without adding optional data', () => {
    const empty = {
      ...completeLayout,
      rects: {},
      edges: {},
      chips: [],
      arrangements: { canvas: { cardColumns: 0, zoneRows: [] }, zones: {} },
      gutters: {},
    };
    const parsed = LayoutSchema.parse(empty);
    expect(parsed).toEqual(empty);
    expect(parsed.report).not.toHaveProperty('timings');
    expect(parsed.arrangements.canvas).not.toHaveProperty('zoneStacks');
  });

  it.each(Object.keys(completeLayout))('requires the %s field', (key) => {
    const missing = Object.fromEntries(Object.entries(completeLayout).filter(([name]) => name !== key));
    expect(LayoutSchema.safeParse(missing).success).toBe(false);
    expect(LayoutSchema.safeParse({ ...completeLayout, [key]: undefined }).success).toBe(false);
  });

  it('rejects unknown fields, wrong collection shapes and explicitly undefined nested options', () => {
    for (const invalid of [
      { ...completeLayout, extra: 1 },
      { ...completeLayout, rects: [] },
      { ...completeLayout, edges: null },
      { ...completeLayout, chips: [1] },
      { ...completeLayout, gutters: { zones: undefined } },
      { ...completeLayout, report: { ...report, timings: undefined } },
      { ...completeLayout, rects: { node: { ...layoutRect, chipCountLine: undefined } } },
    ])
      expect(LayoutSchema.safeParse(invalid).success).toBe(false);
  });

  it('keeps nested record validation errors rooted at the complete field path', () => {
    const parsed = LayoutSchema.safeParse({
      ...completeLayout,
      rects: Object.fromEntries([['__proto__', { ...layoutRect, width: Infinity }]]),
      edges: Object.fromEntries([['', { ...edgePath, points: [{ x: NaN, y: 0 }] }]]),
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success)
      expect(parsed.error.issues.map((issue) => issue.path)).toEqual([
        ['rects', '__proto__', 'width'],
        ['edges', '', 'points', 0, 'x'],
      ]);
  });

  it('preserves readonly fields and each nested contract in the inferred type', () => {
    expectTypeOf<Layout>().toEqualTypeOf<
      Readonly<{
        rects: Readonly<Record<string, LayoutRect>>;
        edges: Readonly<Record<string, EdgePath>>;
        chips: readonly string[];
        bounds: Rect;
        arrangements: Arrangements;
        gutters: GutterReservations;
        report: LayoutReport;
      }>
    >();
    const parsed = LayoutSchema.parse(completeLayout);
    for (const value of [
      parsed,
      parsed.rects,
      parsed.rects['__proto__'],
      parsed.edges,
      parsed.edges[''],
      parsed.edges['']?.points,
      parsed.chips,
      parsed.bounds,
      parsed.arrangements,
      parsed.gutters,
      parsed.report,
    ])
      expect(Object.isFrozen(value)).toBe(true);
  });
});

describe('layout client result contract', () => {
  it.each([null, '', 'memo-key'])('preserves the nullable memo key %j and both cache states', (key) => {
    for (const cached of [false, true]) {
      const result = { id: 1, key, cached, layout: completeLayout };
      const parsed = LayoutResultSchema.parse(result);
      expect(parsed).toEqual(result);
      expect(Object.keys(parsed)).toEqual(['id', 'key', 'cached', 'layout']);
      expect(LayoutResultSchema.parse(JSON.parse(JSON.stringify(result)))).toEqual(result);
    }
  });

  it.each([-1.25, 0, 2.5])('preserves finite id %s without a new range constraint', (id) => {
    const result = { id, key: null, cached: false, layout: completeLayout };
    expect(LayoutResultSchema.parse(result)).toEqual(result);
  });

  it.each([NaN, Infinity, -Infinity, '1', undefined])('refuses an invalid id: %s', (id) => {
    expect(
      LayoutResultSchema.safeParse({ id, key: null, cached: false, layout: completeLayout }).success,
    ).toBe(false);
  });

  it('requires all four fields and rejects unknown fields and wrong scalar types', () => {
    const result = { id: 1, key: null, cached: false, layout: completeLayout };
    for (const key of Object.keys(result)) {
      const missing = Object.fromEntries(Object.entries(result).filter(([name]) => name !== key));
      expect(LayoutResultSchema.safeParse(missing).success).toBe(false);
      expect(LayoutResultSchema.safeParse({ ...result, [key]: undefined }).success).toBe(false);
    }
    for (const invalid of [
      { ...result, key: 1 },
      { ...result, cached: 1 },
      { ...result, layout: null },
      { ...result, type: 'result' },
    ]) {
      expect(LayoutResultSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it('keeps nested Layout error paths and every readonly field', () => {
    expectTypeOf<LayoutResult>().toEqualTypeOf<
      Readonly<{ id: number; key: string | null; cached: boolean; layout: Layout }>
    >();
    const result = { id: 1, key: '', cached: true, layout: completeLayout };
    const parsed = LayoutResultSchema.parse(result);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.layout)).toBe(true);
    expect(Object.isFrozen(result)).toBe(false);
    const invalid = LayoutResultSchema.safeParse({
      ...result,
      layout: {
        ...completeLayout,
        rects: Object.fromEntries([['__proto__', { ...layoutRect, width: Infinity }]]),
      },
    });
    expect(invalid.success).toBe(false);
    if (!invalid.success)
      expect(invalid.error.issues.map((issue) => issue.path)).toEqual([
        ['layout', 'rects', '__proto__', 'width'],
      ]);
  });
});

describe('layout worker response contract', () => {
  const progress = { stage: 'route', pass: -0.5, routed: 1.25, edges: 2 } as const;
  const error = { code: 'protocol', message: '', ids: ['', '__proto__', ''] } as const;
  const responses = [
    { type: 'progress', id: 1, progress },
    { type: 'result', id: 1, key: null, cached: false, layout: completeLayout },
    { type: 'cancelled', id: 1, reason: 'superseded' },
    { type: 'error', id: null, error },
  ] as const;

  it('keeps two worker reasons and derives the third client reason', () => {
    expect(LayoutCancelReasonSchema.options).toEqual(['superseded', 'cancelled']);
    expect(LayoutCancelledReasonSchema.options).toEqual(['superseded', 'cancelled', 'aborted']);
    for (const reason of LayoutCancelledReasonSchema.options) {
      expect(LayoutCancelledReasonSchema.parse(reason)).toBe(reason);
      expect(LayoutCancelReasonSchema.safeParse(reason).success).toBe(reason !== 'aborted');
    }
    for (const reason of ['', 'unknown', null, undefined, 1]) {
      expect(LayoutCancelReasonSchema.safeParse(reason).success).toBe(false);
      expect(LayoutCancelledReasonSchema.safeParse(reason).success).toBe(false);
    }
    expectTypeOf<LayoutCancelReason>().toEqualTypeOf<'superseded' | 'cancelled'>();
    expectTypeOf<LayoutCancelledReason>().toEqualTypeOf<LayoutCancelReason | 'aborted'>();
  });

  it.each(responses)('preserves the $type arm, its field order and JSON roundtrip', (response) => {
    const parsed = LayoutWorkerResponseSchema.parse(response);
    expect(parsed).toEqual(response);
    expect(Object.keys(parsed)).toEqual(Object.keys(response));
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(LayoutWorkerResponseSchema.parse(JSON.parse(JSON.stringify(response)))).toEqual(response);
  });

  it.each(responses)('keeps finite ids without new ranges in $type', (response) => {
    for (const id of [-1.25, 0, 2.5]) {
      expect(LayoutWorkerResponseSchema.parse({ ...response, id })).toEqual({ ...response, id });
    }
    expect(LayoutWorkerResponseSchema.safeParse({ ...response, id: null }).success).toBe(
      response.type === 'error',
    );
    for (const id of [NaN, Infinity, -Infinity, '1', undefined]) {
      expect(LayoutWorkerResponseSchema.safeParse({ ...response, id }).success).toBe(false);
    }
  });

  it.each(responses)('requires exactly the $type fields', (response) => {
    for (const key of Object.keys(response)) {
      const missing = Object.fromEntries(Object.entries(response).filter(([name]) => name !== key));
      expect(LayoutWorkerResponseSchema.safeParse(missing).success).toBe(false);
      expect(LayoutWorkerResponseSchema.safeParse({ ...response, [key]: undefined }).success).toBe(false);
    }
    expect(LayoutWorkerResponseSchema.safeParse({ ...response, extra: true }).success).toBe(false);
    expect(LayoutWorkerResponseSchema.safeParse({ ...response, type: 'unknown' }).success).toBe(false);
  });

  it('composes the existing result, progress and error payload contracts', () => {
    for (const key of [null, '', 'memo-key']) {
      for (const cached of [false, true]) {
        const response = { type: 'result', id: 1, key, cached, layout: completeLayout };
        expect(LayoutWorkerResponseSchema.parse(response)).toEqual(response);
      }
    }
    for (const reason of LayoutCancelReasonSchema.options) {
      const response = { type: 'cancelled', id: 1, reason };
      expect(LayoutWorkerResponseSchema.parse(response)).toEqual(response);
    }
    for (const invalid of [
      { ...responses[0], progress: { ...progress, pass: Infinity } },
      { ...responses[1], key: 1 },
      { ...responses[1], cached: 1 },
      { ...responses[1], layout: null },
      { ...responses[2], reason: 'aborted' },
      { ...responses[3], error: { ...error, code: 'unknown' } },
    ]) {
      expect(LayoutWorkerResponseSchema.safeParse(invalid).success).toBe(false);
    }
    const invalid = LayoutWorkerResponseSchema.safeParse({
      ...responses[1],
      layout: {
        ...completeLayout,
        rects: Object.fromEntries([['__proto__', { ...layoutRect, width: Infinity }]]),
      },
    });
    expect(invalid.success).toBe(false);
    if (!invalid.success)
      expect(invalid.error.issues.map((issue) => issue.path)).toEqual([
        ['layout', 'rects', '__proto__', 'width'],
      ]);
  });

  it('infers the existing readonly discriminated union', () => {
    expectTypeOf<LayoutWorkerResponse>().toEqualTypeOf<
      | Readonly<{ type: 'progress'; id: number; progress: LayoutProgress }>
      | Readonly<{ type: 'result'; id: number; key: string | null; cached: boolean; layout: Layout }>
      | Readonly<{ type: 'cancelled'; id: number; reason: LayoutCancelReason }>
      | Readonly<{ type: 'error'; id: number | null; error: LayoutWorkerErrorInfo }>
    >();
    for (const response of responses) {
      const parsed = LayoutWorkerResponseSchema.parse(response);
      if (parsed.type === 'progress') expect(Object.isFrozen(parsed.progress)).toBe(true);
      if (parsed.type === 'result') expect(Object.isFrozen(parsed.layout)).toBe(true);
      if (parsed.type === 'error') {
        expect(Object.isFrozen(parsed.error)).toBe(true);
        expect(Object.isFrozen(parsed.error.ids)).toBe(true);
      }
    }
  });
});

describe('layout worker options contract', () => {
  const face = {
    family: '',
    weight: -0.5,
    unitsPerEm: 0,
    ascent: 1,
    descent: 1,
    lineGap: 0,
    fallback: 0,
    runs: [[]],
  };
  const options = {
    sizing: { cardHeight: -0.5 },
    targetAspect: -1.25,
    rootAspect: 0,
    aspectTolerance: 2.5,
    arrangements: completeLayout.arrangements,
    fontMetrics: {
      format: 1,
      sources: Object.fromEntries([
        ['__proto__', ''],
        ['constructor', 'v1'],
        ['', 'v2'],
      ]),
      faces: Object.fromEntries(FONT_FACE_KEYS.map((key) => [key, face])),
    },
    gutters: completeLayout.gutters,
    route: false,
    routing: { lanePitch: -0.25 },
  };

  it('preserves the nine readonly exact-optional fields without defaults or operational refinements', () => {
    expectTypeOf<LayoutWorkerOptions>().toEqualTypeOf<
      Readonly<{
        sizing?: Partial<Sizing>;
        targetAspect?: number;
        rootAspect?: number;
        aspectTolerance?: number;
        arrangements?: Readonly<{ canvas?: Arrangement; zones?: Readonly<Record<string, Arrangement>> }>;
        fontMetrics?: FontMetricsTable;
        gutters?: GutterReservations;
        route?: boolean;
        routing?: Partial<Routing>;
      }>
    >();
    const parsed = LayoutWorkerOptionsSchema.parse(options);
    expect(parsed).toEqual(options);
    expect(Object.keys(parsed)).toEqual(Object.keys(options));
    expect(LayoutWorkerOptionsSchema.parse(JSON.parse(JSON.stringify(options)))).toEqual(options);
    expect(LayoutWorkerOptionsSchema.parse({})).toEqual({});
    expect(Object.isFrozen(parsed)).toBe(true);
    for (const value of [
      parsed.sizing,
      parsed.routing,
      parsed.arrangements,
      parsed.arrangements?.zones,
      parsed.fontMetrics,
      parsed.gutters,
    ])
      expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(options)).toBe(false);
  });

  it('accepts each absent or partial override without filling missing fields', () => {
    for (const [key, value] of Object.entries(options)) {
      const partial = { [key]: value };
      expect(LayoutWorkerOptionsSchema.parse(partial)).toEqual(partial);
      const missing = Object.fromEntries(Object.entries(options).filter(([name]) => name !== key));
      expect(LayoutWorkerOptionsSchema.parse(missing)).toEqual(missing);
      expect(LayoutWorkerOptionsSchema.safeParse({ [key]: undefined }).success).toBe(false);
    }
    for (const partial of [
      { sizing: {} },
      { routing: {} },
      { arrangements: {} },
      { gutters: {} },
      { arrangements: { canvas: arrangement } },
      { arrangements: { zones: {} } },
      { sizing: { cardMinWidth: 300 } },
      { routing: { wideningRounds: 0.5 } },
    ])
      expect(LayoutWorkerOptionsSchema.parse(partial)).toEqual(partial);
  });

  it('rejects explicit undefined and unknown fields inside partial overrides', () => {
    for (const [name, keys] of [
      ['sizing', Object.keys(SizingSchema.unwrap().shape)],
      ['routing', Object.keys(RoutingSchema.unwrap().shape)],
      ['arrangements', ['canvas', 'zones']],
    ] as const) {
      for (const key of keys) {
        const invalid = LayoutWorkerOptionsSchema.safeParse({ [name]: { [key]: undefined } });
        expect(invalid.success).toBe(false);
        if (!invalid.success) expect(invalid.error.issues.map((issue) => issue.path)).toEqual([[name, key]]);
      }
      expect(LayoutWorkerOptionsSchema.safeParse({ [name]: { unknown: 1 } }).success).toBe(false);
    }
    for (const invalid of [
      null,
      [],
      { unknown: true },
      { clock: () => 1 },
      { clock: undefined },
      { route: 1 },
      { route: null },
      { fontMetrics: {} },
      { gutters: null },
    ]) {
      expect(LayoutWorkerOptionsSchema.safeParse(invalid).success).toBe(false);
    }
    for (const name of ['targetAspect', 'rootAspect', 'aspectTolerance']) {
      for (const value of [NaN, Infinity, -Infinity, '1', null]) {
        expect(LayoutWorkerOptionsSchema.safeParse({ [name]: value }).success).toBe(false);
      }
    }
  });

  it('preserves special record keys and full nested error paths', () => {
    const parsed = LayoutWorkerOptionsSchema.parse(options);
    expect(Object.keys(parsed.arrangements?.zones ?? {})).toEqual(Object.keys(options.arrangements.zones));
    expect(JSON.stringify(parsed.arrangements?.zones)).toBe(JSON.stringify(options.arrangements.zones));
    expect(JSON.stringify(parsed.fontMetrics?.sources)).toBe(JSON.stringify(options.fontMetrics.sources));
    const invalid = LayoutWorkerOptionsSchema.safeParse({
      arrangements: { zones: Object.fromEntries([['__proto__', { ...arrangement, cardColumns: Infinity }]]) },
    });
    expect(invalid.success).toBe(false);
    if (!invalid.success)
      expect(invalid.error.issues.map((issue) => issue.path)).toEqual([
        ['arrangements', 'zones', '__proto__', 'cardColumns'],
      ]);
  });
});
