// SPDX-License-Identifier: MIT
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  ArrangementSchema,
  EdgeBundleSchema,
  EdgeHeadsSchema,
  EdgePathSchema,
  EdgePortSchema,
  GapWideningSchema,
  GutterWideningSchema,
  InsetsSchema,
  LayoutCountsSchema,
  LayoutRectSchema,
  LayoutReportSchema,
  PointSchema,
  RectRoleSchema,
  RectSchema,
  RelationKindSchema,
  RoutingReportSchema,
  SideSchema,
  StageTimingsSchema,
  type Arrangement,
  type EdgeBundle,
  type EdgeHeads,
  type EdgePath,
  type EdgePort,
  type GapWidening,
  type GutterWidening,
  type Insets,
  type LayoutCounts,
  type LayoutRect,
  type LayoutReport,
  type Point,
  type Rect,
  type RectRole,
  type RoutingReport,
  type Side,
  type StageTimings,
} from '../index.js';

const point = { x: -1.25, y: 0.5 };
const arrangement = { cardColumns: -1.5, zoneRows: [0, 2.25], zoneStacks: [[], [-0.5, 0]] };
const gaps = { cardColumns: [-1.5], zoneColumns: [[], [0, 2.25]], stacks: [[[], [-0.5]]], rows: [0] };
const widening = { horizontal: -1.5, vertical: 0, ring: 2.25, ringSides: { left: -0.5 }, gaps };

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
