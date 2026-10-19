// SPDX-License-Identifier: Apache-2.0
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  ArrangementSchema,
  ArrangementsSchema,
  GutterReservationsSchema,
  GutterWideningSchema,
  LayoutRectSchema,
  LayoutReportSchema,
  LayoutSchema,
  LayoutWorkerOptionsSchema,
  type Arrangement,
  type Arrangements,
  type GapWidening,
  type GutterReservations,
  type GutterWidening,
  type Layout,
  type LayoutCounts,
  type LayoutReport,
  type LayoutWorkerOptions,
  type RoutingReport,
  type Scene,
  type StageTimings,
} from '@gcportrait/model';
import type {
  Arrangement as PublicArrangement,
  Arrangements as PublicArrangements,
  GapWidening as PublicGapWidening,
  GutterReservations as PublicGutterReservations,
  GutterWidening as PublicGutterWidening,
  Layout as PublicLayout,
  LayoutCounts as PublicLayoutCounts,
  LayoutReport as PublicLayoutReport,
  LayoutOptions,
  LayoutWorkerOptions as PublicLayoutWorkerOptions,
  RoutingReport as PublicRoutingReport,
  StageTimings as PublicStageTimings,
} from './index.js';
import { DEFAULT_ROUTING, DEFAULT_SIZING, MAX_SCENE_DEPTH } from './constants.js';
import { LayoutInputError } from './errors.js';
import { packingAspects } from './aspects.js';
import { assertLayout } from './invariants.js';
import { layoutScene, resolveOptions } from './layout.js';
import { FONT_FACE_KEYS, defaultFontMetrics, type FontMetricsTable } from './metrics.js';
import { thrownBy } from './testing/errors.js';
import { fullRowViolations } from './testing/rows.js';
import { ORGANISATION_ID, card, nestedChain, scene, zone } from './testing/scenes.js';

const small = scene(
  [
    zone(
      'p',
      'project',
      [
        zone('v', 'vpc', [zone('s', 'subnet', [card('vm1'), card('vm2')])]),
        card('run', 'orders-api', 'europe-west3'),
      ],
      { label: 'Retail web (prod)', subtitle: 'demo-web-1', badges: ['1 hidden'] },
    ),
    zone('f', 'folder', [
      zone('chip', 'project', [], { collapsed: { resources: 4 } }),
      zone('empty', 'project', []),
    ]),
    card('loose'),
  ],
  [{ from: 'vm1', to: 'run', kind: 'uses' }],
);

describe('layoutScene', () => {
  const layout = layoutScene(small);

  it('emits the complete model contract unchanged through JSON', () => {
    expect(LayoutSchema.parse(layout)).toEqual(layout);
    expect(LayoutSchema.parse(JSON.parse(JSON.stringify(layout)))).toEqual(layout);
    expect(JSON.stringify(LayoutSchema.parse(layout))).toBe(JSON.stringify(layout));
    expectTypeOf<PublicLayout>().toEqualTypeOf<Layout>();
  });

  it('places every node, parents before children, with integer coordinates', () => {
    expect(Object.keys(layout.rects)).toEqual([
      'f',
      'chip',
      'empty',
      'p',
      'v',
      's',
      'vm1',
      'vm2',
      'run',
      'loose',
    ]);
    for (const rect of Object.values(layout.rects)) {
      for (const value of [rect.x, rect.y, rect.width, rect.height])
        expect(Number.isInteger(value)).toBe(true);
    }
    assertLayout(small, layout);
  });

  it('describes each rect: parent, role, kind, depth, header, padding, collapsed', () => {
    expect(layout.rects.p).toMatchObject({
      parent: null,
      role: 'zone',
      kind: 'project',
      depth: 1,
      headerHeight: 40,
      padding: 24,
      collapsed: false,
    });
    expect(layout.rects.s).toMatchObject({ parent: 'v', depth: 3, headerHeight: 32, padding: 16 });
    expect(layout.rects.chip).toMatchObject({
      role: 'chip',
      collapsed: true,
      width: 148,
      height: 44,
      headerHeight: 0,
    });
    expect(layout.rects.empty).toMatchObject({ role: 'empty', kind: 'project', height: 44, padding: 0 });
    expect(layout.rects.run).toMatchObject({ role: 'card', kind: 'card', parent: 'p', depth: 2, height: 44 });
    expect(layout.chips).toEqual(['chip']);
    expect(Object.keys(layout.edges)).toEqual(['vm1 -uses-> run']);
  });

  it('puts cards above zones inside a zone, and the canvas margin around the top level', () => {
    const { p, v, run, f } = layout.rects;
    expect(run?.y).toBe((p?.y ?? 0) + 40 + 24);
    expect(v?.y).toBe((run?.y ?? 0) + 44 + 20);
    expect(Math.min(...Object.values(layout.rects).map((rect) => rect.x))).toBe(24);
    // The loose card sits in the canvas's card row; the zones start one row gap below it.
    expect(layout.rects.loose?.y).toBe(24);
    expect(f?.y).toBe(24 + 44 + 20);
  });

  it('emits model-owned rect shapes unchanged, including optional padding and every role', () => {
    const widened = layoutScene(small, {
      gutters: { zones: { p: { ringSides: { left: 10, bottom: 6 } } } },
    });
    expect(new Set(Object.values(layout.rects).map((rect) => rect.role))).toEqual(
      new Set(['zone', 'chip', 'empty', 'card']),
    );
    expect(widened.rects.p?.paddingExtra).toEqual({ top: 0, right: 0, bottom: 6, left: 10 });
    for (const output of [layout, widened]) {
      for (const rect of Object.values(output.rects)) {
        expect(LayoutRectSchema.parse(rect)).toEqual(rect);
        expect(LayoutRectSchema.parse(JSON.parse(JSON.stringify(rect)))).toEqual(rect);
      }
    }
  });

  it('carries each chip count line through shared sibling widths without adding it to other rects', () => {
    const input = scene([
      zone('full', 'project', [], { collapsed: { networks: 1, subnets: 1, resources: 3 } }),
      zone('short', 'project', [], {
        collapsed: {
          folders: 12,
          projects: 140,
          networks: 31,
          subnets: 412,
          containers: 96,
          resources: 4821,
        },
      }),
      zone('nothing', 'project', [], { collapsed: {} }),
      zone('empty', 'project', [], { label: 'A very wide empty project beside the collapsed projects' }),
      zone('open', 'project', [card('resource')]),
    ]);
    const output = layoutScene(input);
    expect(output.rects.full?.chipCountLine).toBe('1 network · 1 subnet · 3 resources');
    expect(output.rects.short?.chipCountLine).toBe('12 fld · 140 prj · 31 net · 412 sub · 96 ctr · 4821 res');
    expect(output.rects.nothing?.chipCountLine).toBe('');
    for (const rect of Object.values(output.rects)) {
      if (rect.role === 'chip') {
        expect(rect.width).toBe(DEFAULT_SIZING.chipMaxWidth);
        expect(rect).toHaveProperty('chipCountLine');
        expect(LayoutRectSchema.parse(JSON.parse(JSON.stringify(rect)))).toEqual(rect);
      } else expect(rect).not.toHaveProperty('chipCountLine');
    }
  });

  it('reports each container’s arrangement: the canvas and every open zone, in paint order', () => {
    expect(Object.keys(layout.arrangements.zones)).toEqual(['f', 'p', 'v', 's']);
    expect(layout.arrangements.zones.s).toEqual({ cardColumns: 1, zoneRows: [] }); // 148 × 108, 1.37
    expect(layout.arrangements.zones.f).toMatchObject({ cardColumns: 0 });
    expect(layout.arrangements.canvas.cardColumns).toBe(1);
    expect(layout.arrangements.canvas.zoneRows.reduce((a, b) => a + b, 0)).toBe(2);
    // A prototype-free record: no inherited keys.
    expect(Object.getPrototypeOf(layout.arrangements.zones)).toBeNull();
  });

  it('reports counts and no timings without a clock', () => {
    expect(LayoutReportSchema.parse(layout.report)).toEqual(layout.report);
    expect(LayoutReportSchema.parse(JSON.parse(JSON.stringify(layout.report)))).toEqual(layout.report);
    expect(layout.report).toEqual({
      counts: {
        rects: 10,
        zones: 4,
        chips: 1,
        emptyZones: 1,
        cards: 4,
        edges: 1,
        maxDepth: 4,
        organisationZonesDropped: 0,
        truncatedLabels: 0,
        cappedTitles: 0,
        headerWidened: layout.report.counts.headerWidened,
      },
      routing: {
        mode: 'three-pass',
        passes: 1,
        edges: 1,
        holders: 1,
        work: layout.report.routing.work,
        duplicatesMerged: 0,
        reciprocalMerged: 0,
        bundles: 0,
        bundledEdges: 0,
        dropped: 0,
        fallbacks: 0,
        failed: 0,
        bends: layout.report.routing.bends,
        maxLanes: 1,
        widened: 0,
        wideningRounds: 0,
        squeezed: 0,
        overlaps: 0,
      },
      warnings: [],
    });
    // One edge's search settles a handful of states, at least its start and its goal.
    expect(layout.report.routing.work).toBeGreaterThanOrEqual(2);
    expect(layout.report.routing.work).toBeLessThan(100);
  });

  it('reports stage timings from the clock it is given', () => {
    let now = 0;
    const timed = layoutScene(small, { clock: () => (now += 1) });
    expect(LayoutReportSchema.parse(timed.report)).toEqual(timed.report);
    expect(LayoutReportSchema.parse(JSON.parse(JSON.stringify(timed.report)))).toEqual(timed.report);
    expect(timed.report.timings).toEqual({ normalise: 1, size: 1, pack: 1, route: 1, total: 5 });
    expect({ ...timed, report: { ...timed.report, timings: undefined } }).toEqual({
      ...layout,
      report: { ...layout.report, timings: undefined },
    });
  });

  it('lays out an empty Scene as an empty canvas', () => {
    const empty = layoutScene(scene([]));
    expect(LayoutReportSchema.parse(empty.report)).toEqual(empty.report);
    expect(LayoutReportSchema.parse(JSON.parse(JSON.stringify(empty.report)))).toEqual(empty.report);
    expect(empty.rects).toEqual({});
    expect(empty.edges).toEqual({});
    expect(empty.report.routing.mode).toBe('none');
    expect(empty.bounds).toEqual({ x: 0, y: 0, width: 48, height: 48 });
    expect(empty.report.counts.maxDepth).toBe(0);
  });

  it('keeps the public layout report types compatible with their model contracts', () => {
    expectTypeOf<PublicStageTimings>().toEqualTypeOf<StageTimings>();
    expectTypeOf<PublicLayoutCounts>().toEqualTypeOf<LayoutCounts>();
    expectTypeOf<PublicRoutingReport>().toEqualTypeOf<RoutingReport>();
    expectTypeOf<PublicLayoutReport>().toEqualTypeOf<LayoutReport>();
  });

  it('preserves negative fractional durations from the caller clock', () => {
    let now = 0;
    const timed = layoutScene(small, { clock: () => (now -= 0.25) });
    expect(timed.report.timings).toEqual({
      normalise: -0.25,
      size: -0.25,
      pack: -0.25,
      route: -0.25,
      total: -1.25,
    });
    expect(LayoutReportSchema.parse(timed.report)).toEqual(timed.report);
    expect(LayoutReportSchema.parse(JSON.parse(JSON.stringify(timed.report)))).toEqual(timed.report);
  });

  it.each([
    ['none', { route: false }],
    ['single-pass', { routing: { singlePassWork: 0 } }],
  ] as const)('preserves emitted %s routing reports', (mode, options) => {
    const output = layoutScene(small, options);
    expect(output.report.routing.mode).toBe(mode);
    expect(LayoutReportSchema.parse(output.report)).toEqual(output.report);
    expect(LayoutReportSchema.parse(JSON.parse(JSON.stringify(output.report)))).toEqual(output.report);
  });

  it('counts zones widened by their header and labels too long for a card', () => {
    const wide = layoutScene(
      scene([
        zone('z', 'project', [card('a', 'eventarc-europe-west3-orders-handler-614468-sub-400')], {
          label: 'A project with a remarkably long display name',
          subtitle: 'demo-project-with-a-long-id',
        }),
      ]),
    );
    expect(wide.report.counts).toMatchObject({ headerWidened: 1, truncatedLabels: 1 });
    expect(wide.rects.z?.width).toBeGreaterThan((wide.rects.a?.width ?? 0) + 2 * 24);
  });

  it('drops an organisation zone and warns about edges that end at it', () => {
    const org = scene(
      [zone(ORGANISATION_ID, 'folder', [card('a'), card('b')])],
      [{ from: 'a', to: ORGANISATION_ID, kind: 'uses' }],
    );
    const result = layoutScene(org);
    expect(Object.keys(result.rects)).toEqual(['a', 'b']);
    expect(result.rects.a?.depth).toBe(1);
    expect(result.report.counts.organisationZonesDropped).toBe(1);
    // Sorted in code-point order, so the report does not depend on the order of the Scene's children.
    expect(result.report.warnings).toEqual([
      '1 edge(s) end at a dropped organisation zone (the canvas) and cannot be routed',
      `organisation zone ${ORGANISATION_ID} dropped: the canvas is the organisation`,
    ]);
    assertLayout(org, result);
  });

  it('reports the same warnings, byte for byte, whatever the order of the Scene children', () => {
    const second = '//cloudresourcemanager.googleapis.com/organizations/2';
    const two = scene(
      [zone(ORGANISATION_ID, 'folder', [card('a')]), zone(second, 'folder', [card('b')])],
      [
        { from: 'a', to: ORGANISATION_ID, kind: 'uses' },
        { from: 'b', to: second, kind: 'uses' },
      ],
    );
    const reversed: Scene = {
      ...two,
      children: [...two.children].reverse(),
      edges: [...two.edges].reverse(),
    };
    expect(JSON.stringify(layoutScene(reversed).report)).toBe(JSON.stringify(layoutScene(two).report));
    expect(layoutScene(two).report.warnings).toEqual([
      '2 edge(s) end at a dropped organisation zone (the canvas) and cannot be routed',
      `organisation zone ${second} dropped: the canvas is the organisation`,
      `organisation zone ${ORGANISATION_ID} dropped: the canvas is the organisation`,
    ]);
  });

  it('treats ids like __proto__ as ordinary keys', () => {
    const odd = scene([zone('__proto__', 'project', [card('constructor')])]);
    const gutters = { zones: Object.fromEntries([['__proto__', { ring: 4 }]]) };
    const result = layoutScene(odd, { gutters });
    expect(Object.keys(result.rects)).toEqual(['__proto__', 'constructor']);
    expect(JSON.stringify(result.rects)).toMatch(/^\{"__proto__":\{"x":24,/);
    expect(Object.entries(result.rects).find(([id]) => id === 'constructor')?.[1].parent).toBe('__proto__');
    expect(Object.hasOwn(result.arrangements.zones, '__proto__')).toBe(true);
    expect(Object.hasOwn(result.gutters.zones ?? {}, '__proto__')).toBe(true);
    expect(ArrangementsSchema.parse(result.arrangements)).toEqual(result.arrangements);
    expect(GutterReservationsSchema.parse(result.gutters)).toEqual(result.gutters);
    expect(LayoutSchema.parse(result)).toEqual(result);
    expect(LayoutSchema.parse(JSON.parse(JSON.stringify(result)))).toEqual(result);
    expect(ArrangementsSchema.parse(JSON.parse(JSON.stringify(result.arrangements)))).toEqual(
      result.arrangements,
    );
    expect(GutterReservationsSchema.parse(JSON.parse(JSON.stringify(result.gutters)))).toEqual(
      result.gutters,
    );
    assertLayout(odd, result, { gutters });
  });

  it('never reads the Scene’s metadata, so the memo key may leave it out (hash.ts)', () => {
    const other: Scene = {
      ...small,
      metadata: {
        rootLabel: 'another root',
        lens: 'networking',
        readTime: '2026-09-17T00:00:00Z',
        rectCount: small.metadata.rectCount,
        focusError: { code: 'unknown-project', message: 'No such project.' },
        rootError: { code: 'unknown-root', message: 'No such node.' },
      },
    };
    expect(JSON.stringify(layoutScene(other))).toBe(JSON.stringify(layout));
  });

  it('lays out a Scene nested to the depth limit within the invariants', () => {
    // The refusal one level deeper is normaliseScene's (src/normalise.test.ts).
    const deepest = nestedChain(MAX_SCENE_DEPTH - 1);
    const result = layoutScene(deepest);
    expect(result.report.counts.maxDepth).toBe(MAX_SCENE_DEPTH);
    assertLayout(deepest, result);
  });
});

describe('large mixed containers (skill §9, "huge empty zones")', () => {
  it.each([
    [15, 8],
    [40, 10],
    [2000, 2000],
  ])('packs %i cards and %i card-sized zones near the target without an empty box', (cards, zones) => {
    const input = scene([
      zone('p', 'project', [
        ...Array.from({ length: cards }, (_, i) => card(`c${String(i)}`)),
        ...Array.from({ length: zones }, (_, i) => zone(`e${String(i)}`, 'subnet', [])),
      ]),
    ]);
    const result = layoutScene(input);
    const box = packingAspects(result).find((aspect) => aspect.id === 'p');
    // Equal 148 × 44 boxes with 24 / 20 gaps cover at most about 60 % of a grid's box.
    expect(box?.fill).toBeGreaterThan(0.5);
    expect(box?.deviation).toBeLessThanOrEqual(0.2);
    expect(fullRowViolations(input, result)).toEqual([]);
  });
});

describe('options', () => {
  it('widens gaps, padding rings and the canvas margin through the gutter hook', () => {
    const base = layoutScene(small);
    const widened = layoutScene(small, {
      gutters: { canvas: { ring: 10, horizontal: 16 }, zones: { p: { ring: 8, vertical: 12 } } },
    });
    assertLayout(small, widened, {
      gutters: { canvas: { ring: 10, horizontal: 16 }, zones: { p: { ring: 8, vertical: 12 } } },
    });
    expect(widened.rects.p?.padding).toBe(32);
    expect(widened.rects.loose?.y).toBe(34);
    const gap = (l: typeof base) => (l.rects.v?.y ?? 0) - ((l.rects.run?.y ?? 0) + 44);
    expect(gap(base)).toBe(20);
    expect(gap(widened)).toBe(32);
    expect(widened.bounds.width).toBeGreaterThan(base.bounds.width);
  });

  it('keeps pinned arrangements, so a re-pack with wider gutters keeps every row and column', () => {
    const wide = scene([
      zone('p', 'project', [
        ...Array.from({ length: 7 }, (_, i) => card(`c${String(i)}`)),
        ...Array.from({ length: 5 }, (_, i) => zone(`e${String(i)}`, 'subnet', [])),
      ]),
    ]);
    const first = layoutScene(wide);
    const gutters = { zones: { p: { horizontal: 60, vertical: 40 } } };
    const pinned = layoutScene(wide, { gutters, arrangements: first.arrangements });
    expect(pinned.arrangements).toEqual(first.arrangements);
    assertLayout(wide, pinned, { gutters });
    // Pinning a layout's own arrangements changes nothing.
    expect(JSON.stringify(layoutScene(wide, { arrangements: first.arrangements }))).toBe(
      JSON.stringify(first),
    );
    // Another arrangement is followed as given.
    const stacked = layoutScene(wide, { arrangements: { zones: { p: { cardColumns: 1, zoneRows: [5] } } } });
    expect(stacked.arrangements.zones.p).toEqual({ cardColumns: 1, zoneRows: [5] });
    expect(new Set(Array.from({ length: 7 }, (_, i) => stacked.rects[`c${String(i)}`]?.x)).size).toBe(1);
  });

  it('applies sizing overrides and aspect targets', () => {
    const sizing = { cardHeight: 50, chipMinWidth: 160, gapHorizontal: 30, canvasMargin: 10 };
    const result = layoutScene(small, { sizing, targetAspect: 1, rootAspect: 3 });
    assertLayout(small, result, { sizing, targetAspect: 1, rootAspect: 3 });
    expect(result.rects.run?.height).toBe(50);
    expect(result.rects.chip?.width).toBe(160);
    expect(Math.min(...Object.values(result.rects).map((rect) => rect.y))).toBe(10);
  });

  it('measures with a font metrics table passed in', () => {
    const face = {
      family: 'T',
      weight: 400,
      unitsPerEm: 1,
      ascent: 1,
      descent: 0,
      lineGap: 0,
      fallback: 1,
      runs: [],
    };
    const tiny: FontMetricsTable = {
      format: 1,
      sources: {},
      faces: Object.fromEntries(
        FONT_FACE_KEYS.map((key) => [key, face]),
      ) as unknown as FontMetricsTable['faces'],
    };
    const result = layoutScene(scene([card('a', 'x'.repeat(100))]), { fontMetrics: tiny });
    expect(result.rects.a?.width).toBe(220);
    expect(layoutScene(scene([card('a', 'xx')]), { fontMetrics: tiny }).rects.a?.width).toBe(148);
    // A validated table is remembered.
    expect(() => layoutScene(scene([]), { fontMetrics: tiny })).not.toThrow();
  });

  it.each([
    ['a negative gap', { sizing: { gapHorizontal: -1 } }, 'sizing.gapHorizontal'],
    ['a zero card height', { sizing: { cardHeight: 0 } }, 'sizing.cardHeight'],
    ['an infinite padding', { sizing: { zonePadding: Infinity } }, 'sizing.zonePadding'],
    ['an inverted card width range', { sizing: { cardMinWidth: 300 } }, 'sizing.cardMinWidth'],
    ['a zero target aspect', { targetAspect: 0 }, 'targetAspect'],
    ['a NaN root aspect', { rootAspect: Number.NaN }, 'rootAspect'],
    ['a negative canvas ring', { gutters: { canvas: { ring: -2 } } }, 'gutters.canvas.ring'],
    ['a negative zone gap', { gutters: { zones: { p: { vertical: -1 } } } }, 'gutters.zones.p.vertical'],
    ['a negative tolerance', { aspectTolerance: -0.1 }, 'aspectTolerance'],
    ['a zero lane pitch', { routing: { lanePitch: 0 } }, 'routing.lanePitch'],
    ['a zero port spacing', { routing: { portSpacing: 0 } }, 'routing.portSpacing'],
    ['a negative lane cost', { routing: { laneCost: -1 } }, 'routing.laneCost'],
    [
      'a negative ring side',
      { gutters: { canvas: { ringSides: { left: -1 } } } },
      'gutters.canvas.ringSides.left',
    ],
    [
      'a negative row gap',
      { gutters: { zones: { p: { gaps: { rows: [0, -2] } } } } },
      'gutters.zones.p.gaps.rows.1',
    ],
    [
      'a NaN card column gap',
      { gutters: { zones: { p: { gaps: { cardColumns: [Number.NaN] } } } } },
      'gutters.zones.p.gaps.cardColumns.0',
    ],
    [
      'a negative zone gap',
      { gutters: { canvas: { gaps: { zoneColumns: [[], [3, -3]] } } } },
      'gutters.canvas.gaps.zoneColumns.1.1',
    ],
    [
      'a negative stack gap',
      { gutters: { zones: { p: { gaps: { stacks: [[[], [0, -4]]] } } } } },
      'gutters.zones.p.gaps.stacks.0.1.1',
    ],
    ['a chip minimum above its maximum', { sizing: { chipMinWidth: 300 } }, 'sizing.chipMinWidth'],
    ['a tolerance of 1', { aspectTolerance: 1 }, 'aspectTolerance'],
    [
      'a malformed metrics table',
      { fontMetrics: { format: 2 } as unknown as FontMetricsTable },
      'fontMetrics',
    ],
  ])('refuses %s', (_name, options, id) => {
    const error = thrownBy(() => resolveOptions(options), LayoutInputError);
    expect(error.code).toBe('invalid-option');
    expect(error.ids).toContain(id);
  });

  it.each([
    ['too many card columns', { canvas: { cardColumns: 3, zoneRows: [2] } }, 'arrangements.canvas'],
    ['rows that do not add up', { zones: { p: { cardColumns: 1, zoneRows: [2] } } }, 'arrangements.zones.p'],
  ])('refuses a pinned arrangement with %s', (_name, arrangements, id) => {
    const error = thrownBy(() => layoutScene(small, { arrangements }), LayoutInputError);
    expect(error.code).toBe('invalid-option');
    expect(error.ids).toEqual([id]);
  });

  it('widens single gaps and single sides of a padding ring (the router’s per-gap widening)', () => {
    const grid = scene([
      zone('p', 'project', [
        card('c1'),
        card('c2'),
        card('c3'),
        card('c4'),
        zone('z1', 'subnet', []),
        zone('z2', 'subnet', []),
      ]),
    ]);
    const first = layoutScene(grid, { route: false });
    const arrangement = { cardColumns: 2, zoneRows: [2] };
    const pinned = { zones: { p: arrangement } };
    const plain = layoutScene(grid, { route: false, arrangements: pinned });
    const gutters = {
      zones: {
        p: {
          ringSides: { left: 10, bottom: 6 },
          gaps: { cardColumns: [8], rows: [4, 12], zoneColumns: [[16]] },
        },
      },
    };
    const wide = layoutScene(grid, { route: false, arrangements: pinned, gutters });
    assertLayout(grid, wide, { route: false, gutters });
    const at = (l: typeof plain, id: string) => l.rects[id] ?? { x: 0, y: 0, width: 0, height: 0 };
    const p0 = at(plain, 'p');
    const p1 = at(wide, 'p');
    expect(wide.rects.p?.paddingExtra).toEqual({ top: 0, right: 0, bottom: 6, left: 10 });
    expect(plain.rects.p?.paddingExtra).toBeUndefined();
    // Children move right by the extra left padding; the second column by the widened column gap too.
    expect(at(wide, 'c1').x - p1.x).toBe(at(plain, 'c1').x - p0.x + 10);
    expect(at(wide, 'c2').x - at(wide, 'c1').x).toBe(at(plain, 'c2').x - at(plain, 'c1').x + 8);
    // Row gaps: below card row 0 (+4), below card row 1, the card/zone gap (+12).
    expect(at(wide, 'c3').y - at(wide, 'c1').y).toBe(at(plain, 'c3').y - at(plain, 'c1').y + 4);
    expect(at(wide, 'z1').y - at(wide, 'c3').y).toBe(at(plain, 'z1').y - at(plain, 'c3').y + 12);
    expect(at(wide, 'z2').x - at(wide, 'z1').x).toBe(at(plain, 'z2').x - at(plain, 'z1').x + 16);
    expect(p1.height).toBe(p0.height + 4 + 12 + 6);
    expect(wide.gutters.zones?.p).toEqual(gutters.zones.p);
    expect(GutterWideningSchema.parse(wide.gutters.zones?.p)).toEqual(wide.gutters.zones?.p);
    expect(GutterWideningSchema.parse(JSON.parse(JSON.stringify(wide.gutters.zones?.p)))).toEqual(
      wide.gutters.zones?.p,
    );
    expect(ArrangementSchema.parse(wide.arrangements.zones.p)).toEqual(wide.arrangements.zones.p);
    expect(first.arrangements.zones.p).toBeDefined();
    // The canvas's margin, side by side.
    const canvas = layoutScene(grid, {
      route: false,
      gutters: { canvas: { ringSides: { top: 5, right: 7 } } },
    });
    expect(canvas.rects.p?.y).toBe(24 + 5);
    expect(canvas.bounds.width).toBe(first.bounds.width + 7);
    expect(GutterWideningSchema.parse(canvas.gutters.canvas)).toEqual(canvas.gutters.canvas);
  });

  it('preserves emitted stacked arrangements and deeply nested widening gaps', () => {
    const input = scene([zone('a', 'project', []), zone('b', 'project', []), zone('c', 'project', [])]);
    const stacked = { cardColumns: 0, zoneRows: [3], zoneStacks: [[1, 2]] };
    const gutters = { canvas: { gaps: { stacks: [[[], [6]]], zoneColumns: [[4]] } } };
    const output = layoutScene(input, { route: false, arrangements: { canvas: stacked }, gutters });
    expect(output.arrangements.canvas).toEqual(stacked);
    expect(output.gutters.canvas).toEqual(gutters.canvas);
    expect(ArrangementSchema.parse(output.arrangements.canvas)).toEqual(stacked);
    expect(ArrangementSchema.parse(JSON.parse(JSON.stringify(output.arrangements.canvas)))).toEqual(stacked);
    expect(GutterWideningSchema.parse(output.gutters.canvas)).toEqual(gutters.canvas);
    expect(GutterWideningSchema.parse(JSON.parse(JSON.stringify(output.gutters.canvas)))).toEqual(
      gutters.canvas,
    );
  });

  it('keeps public packing types compatible with their model contracts', () => {
    expectTypeOf<PublicArrangement>().toEqualTypeOf<Arrangement>();
    expectTypeOf<PublicArrangements>().toEqualTypeOf<Arrangements>();
    expectTypeOf<PublicGutterReservations>().toEqualTypeOf<GutterReservations>();
    expectTypeOf<PublicGapWidening>().toEqualTypeOf<GapWidening>();
    expectTypeOf<PublicGutterWidening>().toEqualTypeOf<GutterWidening>();
  });

  it('resolves the defaults', () => {
    expect(resolveOptions()).toMatchObject({
      sizing: DEFAULT_SIZING,
      targetAspect: 1.6,
      rootAspect: 1.75,
      aspectTolerance: 0.2,
      gutters: {},
      arrangements: {},
      route: true,
      routing: DEFAULT_ROUTING,
    });
  });

  it('keeps worker options compatible with local clock options and actual layout output', () => {
    expectTypeOf<PublicLayoutWorkerOptions>().toEqualTypeOf<LayoutWorkerOptions>();
    expectTypeOf<Omit<LayoutOptions, 'clock'>>().toEqualTypeOf<LayoutWorkerOptions>();
    expectTypeOf<LayoutOptions['clock']>().toEqualTypeOf<(() => number) | undefined>();
    const previous = layoutScene(small, { route: false });
    const options: LayoutWorkerOptions = {
      sizing: { cardHeight: 44.5 },
      targetAspect: 1.6,
      rootAspect: 1.75,
      aspectTolerance: 0.2,
      arrangements: previous.arrangements,
      fontMetrics: defaultFontMetrics(),
      gutters: previous.gutters,
      route: false,
      routing: { lanePitch: 8.5 },
    };
    const parsed = LayoutWorkerOptionsSchema.parse(options);
    expect(parsed).toEqual(options);
    const roundtrip = LayoutWorkerOptionsSchema.parse(JSON.parse(JSON.stringify(options)));
    expect(roundtrip).toEqual(options);
    const expected = JSON.stringify(layoutScene(small, options));
    expect(JSON.stringify(layoutScene(small, parsed))).toBe(expected);
    expect(JSON.stringify(layoutScene(small, roundtrip))).toBe(expected);
    expect(resolveOptions(LayoutWorkerOptionsSchema.parse({}))).toEqual(resolveOptions());
    const clock = () => 1;
    const local: LayoutOptions = { ...options, clock };
    expect(layoutScene(small, local).report.timings).toBeDefined();
    expect(LayoutWorkerOptionsSchema.safeParse(local).success).toBe(false);
  });

  it.each([
    [{ targetAspect: -0.5 }, 'targetAspect'],
    [{ rootAspect: 0 }, 'rootAspect'],
    [{ aspectTolerance: 1.5 }, 'aspectTolerance'],
    [{ sizing: { cardMinWidth: 300 } }, 'sizing.cardMinWidth'],
    [{ routing: { lanePitch: 0 } }, 'routing.lanePitch'],
    [{ gutters: { canvas: { ring: -1 } } }, 'gutters.canvas.ring'],
  ] as const)('leaves operational refusal to resolveOptions for %j', (options, field) => {
    expect(LayoutWorkerOptionsSchema.parse(options)).toEqual(options);
    const error = thrownBy(() => resolveOptions(options), LayoutInputError);
    expect(error.code).toBe('invalid-option');
    expect(error.ids).toContain(field);
  });
});
