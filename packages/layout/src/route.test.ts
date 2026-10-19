// SPDX-License-Identifier: Apache-2.0
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  EdgePathSchema,
  type EdgeBundle,
  type EdgeHeads,
  type EdgePath as ModelEdgePath,
  type EdgePort,
  type Scene,
  type SceneEdge,
  type SceneNode,
  type Side,
} from '@gcportrait/model';
import type {
  EdgeBundle as LayoutEdgeBundle,
  EdgeHeads as LayoutEdgeHeads,
  EdgePath as PublicEdgePath,
  EdgePort as LayoutEdgePort,
  Side as LayoutSide,
} from './index.js';
import { DEFAULT_ROUTING } from './constants.js';
import { assertLayout, checkLayout } from './invariants.js';
import { layoutScene } from './layout.js';
import type { GutterLine } from './gutters.js';
import { buildNetwork } from './network.js';
import { accumulate, addWidening, hugFactors, laneSlot, type Widening } from './route.js';
import { laneSpacing } from './testing/spacing.js';
import { card, scene, zone } from './testing/scenes.js';
import type { EdgePath, Layout, LayoutOptions } from './types.js';

function edgeOf(layout: Layout, id: string): EdgePath {
  const edge = layout.edges[id];
  if (edge === undefined) throw new Error(`no edge ${id}`);
  return edge;
}

const SIDE_BY_SIDE: LayoutOptions = { arrangements: { canvas: { cardColumns: 2, zoneRows: [] } } };

describe('hugFactors', () => {
  it('charges a ring side hugFactor per px up to hugCap over the side, and the canvas margin marginFactor', () => {
    const piece = (
      a: number,
      b: number,
      hug: [number, number],
      margin = false,
    ): GutterLine['pieces'][number] => ({
      a,
      b,
      owner: margin ? 0 : 1,
      strip: 24,
      gap: { kind: 'ring', side: 'top' },
      hugSpans: [hug],
      ...(margin ? { margin: true } : {}),
    });
    // Three horizontal lines, each cut into one segment by two vertical lines at x = 0 and x = 400: a ring
    // side 400 px long, one 2 000 px long (the segment covers 400 px of it), and the canvas margin.
    const horizontal = (c: number, p: GutterLine['pieces'][number]): GutterLine => ({
      horizontal: true,
      c,
      a: 0,
      b: 400,
      strip: 24,
      pieces: [p],
    });
    const lines: GutterLine[] = [
      horizontal(0, piece(0, 400, [0, 400])),
      horizontal(50, piece(0, 400, [0, 2000])),
      horizontal(100, piece(0, 400, [0, 400], true)),
      ...[0, 400].map((x): GutterLine => ({
        horizontal: false,
        c: x,
        a: -10,
        b: 110,
        strip: 24,
        pieces: [{ a: -10, b: 110, owner: 1, strip: 24, gap: { kind: 'row', index: 0 } }],
      })),
    ];
    const { network } = buildNetwork(lines, [], DEFAULT_ROUTING.laneCost);
    const factors = hugFactors(network, DEFAULT_ROUTING);
    const at = (l: number): number => factors[network.segment[l] ?? 0] ?? 0;
    expect(at(0)).toBe(DEFAULT_ROUTING.hugFactor);
    // 320 px of surcharge over 2 000 px: 0.16 per px.
    expect(at(1)).toBeCloseTo(1 + DEFAULT_ROUTING.hugCap / 2000, 10);
    expect(at(2)).toBe(DEFAULT_ROUTING.marginFactor);
    // The vertical lines are gaps: their length.
    expect(at(3)).toBe(1);
    const uncapped = hugFactors(network, { ...DEFAULT_ROUTING, hugCap: 1e9 });
    expect(uncapped[network.segment[1] ?? 0]).toBe(DEFAULT_ROUTING.hugFactor);
  });
});

describe('laneSlot', () => {
  it('puts lane 0 on the centre-line and the others alternately either side of it', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(laneSlot)).toEqual([0, 1, -1, 2, -2, 3, -3]);
  });
});

describe('routing', () => {
  it('keeps the public layout edge types compatible with their model contracts', () => {
    expectTypeOf<LayoutSide>().toEqualTypeOf<Side>();
    expectTypeOf<LayoutEdgePort>().toEqualTypeOf<EdgePort>();
    expectTypeOf<LayoutEdgeHeads>().toEqualTypeOf<EdgeHeads>();
    expectTypeOf<LayoutEdgeBundle>().toEqualTypeOf<EdgeBundle>();
    expectTypeOf<PublicEdgePath>().toEqualTypeOf<ModelEdgePath>();
  });

  it('draws two neighbouring cards’ edge straight across the gap, the head 2 px inside the target', () => {
    const input = scene([card('a'), card('b')], [{ from: 'a', to: 'b', kind: 'uses' }]);
    const layout = layoutScene(input, SIDE_BY_SIDE);
    assertLayout(input, layout, SIDE_BY_SIDE);
    const edge = edgeOf(layout, 'a -uses-> b');
    expect(EdgePathSchema.parse(edge)).toEqual(edge);
    expect(EdgePathSchema.parse(JSON.parse(JSON.stringify(edge)))).toEqual(edge);
    const [a, b] = [layout.rects.a, layout.rects.b];
    expect(edge.source).toMatchObject({ side: 'right', x: (a?.x ?? 0) + (a?.width ?? 0) });
    expect(edge.target).toMatchObject({ side: 'left', x: b?.x });
    expect(edge.points[0]).toEqual({ x: edge.source.x, y: edge.source.y });
    expect(edge.points[edge.points.length - 1]).toEqual({ x: edge.target.x + 2, y: edge.target.y });
    expect(edge).toMatchObject({ heads: 'end', count: 1, merged: false, fallback: false });
    // The two ports are on different slot grids (half a spacing apart), so the line steps once in the gap.
    expect(edge.points.length - 2).toBeLessThanOrEqual(2);
    expect(edge.elbowRadius).toBe(edge.points.length > 2 ? 6 : 0);
    expect(layout.report.routing).toMatchObject({ mode: 'three-pass', edges: 1, fallbacks: 0 });
  });

  it('draws a double-headed peering with a tip at each end, and a connection without heads', () => {
    const input = scene(
      [card('a'), card('b')],
      [
        { from: 'b', to: 'a', kind: 'peers' },
        { from: 'a', to: 'b', kind: 'peers' },
        { from: 'a', to: 'b', kind: 'connects' },
      ],
    );
    const layout = layoutScene(input, SIDE_BY_SIDE);
    assertLayout(input, layout, SIDE_BY_SIDE);
    const peering = edgeOf(layout, 'a -peers-> b');
    expect(peering).toMatchObject({ heads: 'both', count: 2, merged: true });
    expect(peering.points[0]).toEqual({ x: peering.source.x - 2, y: peering.source.y });
    const connection = edgeOf(layout, 'a -connects-> b');
    for (const edge of [peering, connection]) {
      expect(EdgePathSchema.parse(edge)).toEqual(edge);
      expect(EdgePathSchema.parse(JSON.parse(JSON.stringify(edge)))).toEqual(edge);
    }
    expect(connection.heads).toBe('none');
    expect(connection.points[connection.points.length - 1]).toEqual({
      x: connection.target.x,
      y: connection.target.y,
    });
    expect(layout.report.routing).toMatchObject({ reciprocalMerged: 1, duplicatesMerged: 1 });
  });

  it('ends an edge to a zone on its border below the header, and starts a containing zone’s edge inside it', () => {
    const input = scene(
      [zone('p', 'project', [card('c1'), card('c2'), card('c3')]), zone('q', 'project', [card('d1')])],
      [
        { from: 'd1', to: 'p', kind: 'uses' },
        { from: 'p', to: 'c3', kind: 'uses' },
        { from: 'c2', to: 'p', kind: 'uses' },
      ],
    );
    const layout = layoutScene(input);
    assertLayout(input, layout);
    const p = layout.rects.p;
    const into = edgeOf(layout, 'd1 -uses-> p');
    expect(['left', 'right', 'bottom']).toContain(into.target.side);
    if (into.target.side !== 'bottom')
      expect(into.target.y).toBeGreaterThan((p?.y ?? 0) + (p?.headerHeight ?? 0));
    const out = edgeOf(layout, 'p -uses-> c3');
    // A port on the inside of the containing zone: the route starts at the border itself (no head there).
    expect(out.points[0]).toEqual({ x: out.source.x, y: out.source.y });
    const back = edgeOf(layout, 'c2 -uses-> p');
    expect(back.points[back.points.length - 1]).toEqual({ x: back.target.x, y: back.target.y });
  });

  it('spaces parallel edges in lanes 8 px apart and widens a gutter whose lanes do not fit', () => {
    // Six cards in a column on the left, six on the right: every edge crosses the gap between the columns.
    const left = Array.from({ length: 6 }, (_, i) => card(`l${String(i)}`));
    const right = Array.from({ length: 6 }, (_, i) => card(`r${String(i)}`));
    const edges: SceneEdge[] = left.map((node, i) => ({
      from: node.id,
      to: `r${String(5 - i)}`,
      kind: 'uses',
    }));
    const input = scene([zone('a', 'project', left), zone('b', 'project', right)], edges);
    const layout = layoutScene(input);
    assertLayout(input, layout);
    const spacing = laneSpacing(layout);
    expect(spacing.overlaps).toBe(0);
    expect(spacing.closest).toBeGreaterThanOrEqual(DEFAULT_ROUTING.lanePitch);
    expect(layout.report.routing.widened).toBeGreaterThan(0);
    expect(layout.report.routing.wideningRounds).toBeGreaterThan(0);
    expect(layout.report.routing.passes).toBe(layout.report.routing.wideningRounds + 1);
    expect(layout.report.routing.squeezed).toBe(0);
    expect(layout.report.routing.overlaps).toBe(0);
    // The widening is reported and drives the re-pack: the same scene unwidened is narrower.
    expect(layout.gutters).not.toEqual({});
    const packed = layoutScene(input, { route: false });
    expect(layout.bounds.width * layout.bounds.height).toBeGreaterThan(
      packed.bounds.width * packed.bounds.height,
    );
    expect(layout.arrangements).toEqual(packed.arrangements);
  });

  it('bundles a hub’s edges of one kind into one trunk ending at one shared head', () => {
    // Ten cards in a folder below a hub use it: one bundle, one port on the hub's bottom, shared lanes.
    const sources = Array.from({ length: 10 }, (_, i) => card(`s${String(i)}`));
    const input = scene(
      [card('hub'), zone('z', 'folder', sources)],
      sources.map((node) => ({ from: node.id, to: 'hub', kind: 'uses' })),
    );
    const layout = layoutScene(input);
    assertLayout(input, layout);
    const members = Object.values(layout.edges);
    expect(members).toHaveLength(10);
    expect(layout.report.routing).toMatchObject({ bundles: 1, bundledEdges: 10, overlaps: 0, squeezed: 0 });
    for (const edge of members) {
      expect(edge.bundle).toEqual({ id: 'hub <-uses- * (bottom)', end: 'target', size: 10 });
      expect(edge.target).toEqual(members[0]?.target);
      // Every member ends on the same last segment: the trunk into the shared head.
      expect(edge.points.slice(-2)).toEqual(members[0]?.points.slice(-2));
    }
    // A trunk, not ten lanes: the members use far fewer distinct lanes than there are of them.
    expect(layout.report.routing.maxLanes).toBeLessThan(5);
    // Members share their lanes; nothing else runs alongside them.
    expect(laneSpacing(layout).overlaps).toBe(0);
  });

  it('gives each kind at a hub its own bundle and port, and leaves a small fan-in unbundled', () => {
    const sources = Array.from({ length: 4 }, (_, i) => card(`s${String(i)}`));
    const edges: SceneEdge[] = [
      ...sources.map((node) => ({ from: node.id, to: 'hub', kind: 'attaches' as const })),
      ...sources.map((node) => ({ from: node.id, to: 'hub', kind: 'shares' as const })),
      { from: 's0', to: 'other', kind: 'uses' },
      { from: 's1', to: 'other', kind: 'uses' },
    ];
    const input = scene([card('hub'), card('other'), zone('z', 'folder', sources)], edges);
    const layout = layoutScene(input);
    assertLayout(input, layout);
    const ids = new Set(Object.values(layout.edges).map((edge) => edge.bundle?.id ?? 'none'));
    expect(ids).toEqual(new Set(['hub <-attaches- * (bottom)', 'hub <-shares- * (bottom)', 'none']));
    const heads = new Set(
      Object.values(layout.edges)
        .filter((edge) => edge.to === 'hub')
        .map((edge) => edge.target.x),
    );
    expect(heads.size).toBe(2);
    const [left = 0, right = 0] = [...heads].sort((a, b) => a - b);
    expect(right - left).toBeGreaterThanOrEqual(DEFAULT_ROUTING.portSpacing);
    expect(layout.edges['s0 -uses-> other']?.bundle).toBeUndefined();
    for (const edge of Object.values(layout.edges)) {
      expect(EdgePathSchema.parse(edge)).toEqual(edge);
      expect(EdgePathSchema.parse(JSON.parse(JSON.stringify(edge)))).toEqual(edge);
    }
  });

  it('re-routes by laying the first routes onto the widened gutters, keeping every lane inside them', () => {
    // Eight cards in two projects, every one joined to every card of the other project: busy gutters.
    const left = Array.from({ length: 4 }, (_, i) => card(`l${String(i)}`));
    const right = Array.from({ length: 4 }, (_, i) => card(`r${String(i)}`));
    const edges: SceneEdge[] = left.flatMap((a, i) =>
      right.map((b, j): SceneEdge => ({ from: a.id, to: b.id, kind: (i + j) % 2 === 0 ? 'uses' : 'routes' })),
    );
    const input = scene([zone('a', 'project', left), zone('b', 'project', right)], edges);
    const layout = layoutScene(input, { routing: { bundleMin: 100 } });
    assertLayout(input, layout);
    const { routing } = layout.report;
    expect(routing.passes).toBeGreaterThanOrEqual(2);
    expect(routing.squeezed).toBe(0);
    expect(routing.overlaps).toBe(0);
    expect(laneSpacing(layout).closest).toBeGreaterThanOrEqual(DEFAULT_ROUTING.lanePitch);
    // With no widening round the first route is final, and its lanes are squeezed into the base gutters.
    const once = layoutScene(input, { routing: { bundleMin: 100, wideningRounds: 0 } });
    expect(once.report.routing).toMatchObject({ passes: 1, wideningRounds: 0 });
    expect(once.report.routing.squeezed).toBeGreaterThan(0);
    expect(once.report.warnings.some((warning) => warning.includes('squeezed'))).toBe(true);
  });

  it('stays within the containers an edge has to cross', () => {
    // An edge between two cards of one project never leaves it, although the canvas gutters are open.
    const input = scene(
      [zone('p', 'project', [card('a'), card('b'), card('c'), card('d')]), zone('q', 'project', [card('e')])],
      [{ from: 'a', to: 'd', kind: 'uses' }],
    );
    const layout = layoutScene(input);
    const p = layout.rects.p;
    for (const point of edgeOf(layout, 'a -uses-> d').points) {
      expect(point.x).toBeGreaterThanOrEqual(p?.x ?? 0);
      expect(point.x).toBeLessThanOrEqual((p?.x ?? 0) + (p?.width ?? 0));
      expect(point.y).toBeGreaterThanOrEqual(p?.y ?? 0);
      expect(point.y).toBeLessThanOrEqual((p?.y ?? 0) + (p?.height ?? 0));
    }
  });

  it('goes straight up the gap beside a tall folder, never round through the canvas margin', () => {
    // A short folder beside a tall one: below the short one the gap between them has a child on one side only,
    // beside the free space where the short folder's ring side runs on down to the margin. An edge from the
    // bottom of the tall folder to a chip in the short one takes the gap, not a U-turn through the margin to
    // the parallel line.
    const cards = Array.from({ length: 140 }, (_, i) => card(`c${String(i).padStart(3, '0')}`));
    const counts = { networks: 1, subnets: 2, containers: 0, resources: 3 };
    const input = scene(
      [
        zone('a', 'folder', [zone('h', 'project', [], { collapsed: counts })]),
        zone('b', 'folder', [zone('q', 'project', cards)]),
      ],
      [{ from: 'c135', to: 'h', kind: 'uses' }],
    );
    const layout = layoutScene(input);
    assertLayout(input, layout);
    const [a, b, source] = [layout.rects.a, layout.rects.b, layout.rects.c135];
    if (a === undefined || b === undefined || source === undefined) throw new Error('missing rect');
    // c135 is the first card of q's last row, far below the short folder.
    expect(source.x).toBe(Math.min(...cards.map((c) => layout.rects[c.id]?.x ?? Infinity)));
    expect(source.y).toBeGreaterThan(a.y + a.height + 500);
    const edge = edgeOf(layout, 'c135 -uses-> h');
    expect(Math.max(...edge.points.map((point) => point.y))).toBeLessThanOrEqual(edge.source.y);
    for (const point of edge.points) {
      expect(point.x).toBeGreaterThanOrEqual(a.x);
      expect(point.y).toBeLessThanOrEqual(b.y + b.height);
    }
    const gapX = (a.x + a.width + b.x) / 2;
    expect(edge.points.some((point) => Math.abs(point.x - gapX) <= DEFAULT_ROUTING.lanePitch)).toBe(true);
  });

  it('runs along a long ring side rather than dropping to a row gap far below and climbing back', () => {
    // A wide folder w with a row of tall sub-folders: from a card at the top of the rightmost one to a chip
    // in the folder to the left of w, the shortest way runs along w's ring top (under its header); the only
    // gap-only way drops below the row of sub-folders and climbs back up. Charging the ring top 1.5 × over
    // its whole length would make the drop cheaper; the surcharge is capped per ring side (`hugCap`), so the
    // route stays above its source.
    const counts = { networks: 1, subnets: 2, containers: 0, resources: 3 };
    const sub = (i: number): SceneNode => {
      const at = String(i).padStart(2, '0');
      return zone(`f${at}`, 'folder', [
        zone(
          `p${at}`,
          'project',
          Array.from({ length: 10 }, (_, k) => card(`c${at}${String(k)}`)),
        ),
      ]);
    };
    const input = scene(
      [
        zone('a', 'folder', [zone('h', 'project', [], { collapsed: counts })]),
        zone('w', 'folder', [
          ...Array.from({ length: 12 }, (_, i) => sub(i)),
          zone('z', 'folder', [card('zz')]),
        ]),
      ],
      [{ from: 'c110', to: 'h', kind: 'uses' }],
    );
    const arrangements = {
      canvas: { cardColumns: 0, zoneRows: [2] },
      zones: { w: { cardColumns: 0, zoneRows: [12, 1] } },
    };
    const layout = layoutScene(input, { arrangements });
    assertLayout(input, layout);
    const edge = edgeOf(layout, 'c110 -uses-> h');
    const lowest = (path: EdgePath): number => Math.max(...path.points.map((point) => point.y));
    expect(lowest(edge)).toBeLessThanOrEqual(edge.source.y);
    const w = layout.rects.w;
    if (w === undefined) throw new Error('missing rect');
    // Without the cap (the round-2 rule) the same route drops below the row of sub-folders.
    const uncapped = layoutScene(input, { arrangements, routing: { hugCap: 1e9 } });
    const row = layout.rects.f00;
    if (row === undefined) throw new Error('missing rect');
    expect(lowest(edgeOf(uncapped, 'c110 -uses-> h'))).toBeGreaterThan(row.y + row.height);
    expect(w.width).toBeGreaterThan(4000);
  });

  it('leaves the edges out with route: false, and reports nothing to route for a Scene without edges', () => {
    const input = scene([card('a'), card('b')], [{ from: 'a', to: 'b', kind: 'uses' }]);
    const off = layoutScene(input, { route: false });
    expect(off.edges).toEqual({});
    expect(off.report.routing.mode).toBe('none');
    expect(checkLayout(input, off, { route: false })).toEqual([]);
    expect(checkLayout(input, off).map((v) => v.code)).toEqual(['edge-missing']);
  });
});

/** A Scene of `projects` projects with `cards` cards each and `count` distinct edges between them. */
function manyEdges(projects: number, cards: number, count: number): Scene {
  const children: SceneNode[] = Array.from({ length: projects }, (_, p) =>
    zone(
      `p${String(p)}`,
      'project',
      Array.from({ length: cards }, (_, c) => card(`p${String(p)}c${String(c)}`)),
    ),
  );
  const ids = Array.from(
    { length: projects * cards },
    (_, i) => `p${String(Math.floor(i / cards))}c${String(i % cards)}`,
  );
  const edges: SceneEdge[] = [];
  const seen = new Set<string>();
  // Deterministic pairs: within a project mostly, sometimes across (a fixed linear congruential walk).
  let state = 12345;
  while (edges.length < count) {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    const from = ids[state % ids.length] ?? '';
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    const near = state % 4 !== 0;
    const base = Math.floor(ids.indexOf(from) / cards) * cards;
    const to = near ? (ids[base + (state % cards)] ?? '') : (ids[state % ids.length] ?? '');
    const key = `${from}>${to}`;
    if (from === to || seen.has(key)) continue;
    seen.add(key);
    edges.push({ from, to, kind: 'uses' });
  }
  return scene(children, edges);
}

describe('single-pass mode (decided by the first pass’s search work)', () => {
  // Lane holders: an edge routed on its own, or a hub bundle once (its members share their lanes).
  const input = manyEdges(40, 25, 2000);
  const unlimited = { singlePassWork: Number.MAX_SAFE_INTEGER, oneRoundWork: Number.MAX_SAFE_INTEGER };
  const full = layoutScene(input, { routing: unlimited });
  const { holders, work } = full.report.routing;

  it('counts lane holders: edges on their own plus hub bundles', () => {
    const { edges, bundledEdges, bundles } = full.report.routing;
    expect(holders).toBe(edges - bundledEdges + bundles);
    expect(bundles).toBeGreaterThan(0);
    expect(holders).toBeLessThan(edges);
  });

  it('measures the first pass’s work as the states its searches settle, the same on every run', () => {
    expect(full.report.routing.mode).toBe('three-pass');
    // At least the start and the goal of every edge's search.
    expect(work).toBeGreaterThan(2 * 2000);
    expect(layoutScene(input, { routing: unlimited }).report.routing.work).toBe(work);
    // The edges' order in the Scene does not change it (they are routed shortest first, then by id).
    const reversed = { ...input, edges: [...input.edges].reverse() };
    expect(layoutScene(reversed, { routing: unlimited }).report.routing.work).toBe(work);
  });

  it('searches the rest of the first pass weighted once its work reaches the budget, and stops there', () => {
    const budget = Math.floor(work / 2);
    const layout = layoutScene(input, { routing: { singlePassWork: budget } });
    expect(layout.report.routing).toMatchObject({
      mode: 'single-pass',
      edges: 2000,
      holders,
      widened: 0,
      wideningRounds: 0,
      fallbacks: 0,
    });
    // The first half was searched exactly; the weighted rest settles fewer states than the exact search.
    expect(layout.report.routing.work).toBeGreaterThanOrEqual(budget);
    expect(layout.report.routing.work).toBeLessThan(work);
    expect(layout.gutters).toEqual({});
    expect(checkLayout(input, layout)).toEqual([]);
    // Without widening the busy gutters' lanes are squeezed, and the report says so.
    expect(layout.report.routing.squeezed).toBeGreaterThan(0);
    expect(layout.report.warnings.some((warning) => warning.startsWith('single-pass mode'))).toBe(true);
  });

  it('routes a first pass whose whole work is the budget in three passes (the switch needs work left)', () => {
    const layout = layoutScene(input, { routing: { singlePassWork: work } });
    expect(layout.report.routing.mode).toBe('three-pass');
    expect(layout.report.routing.work).toBe(work);
    expect(layout.report.routing.edges).toBe(2000);
    expect(checkLayout(input, layout)).toEqual([]);
  });

  it('stays in three-pass mode in the band above oneRoundWork, widening at most once', () => {
    // (test/golden.test.ts shows the band cutting M networking at `all` from three rounds to one.)
    expect(full.report.routing.wideningRounds).toBeGreaterThan(0);
    const banded = layoutScene(input, { routing: { ...unlimited, oneRoundWork: work - 1 } });
    expect(banded.report.routing).toMatchObject({ mode: 'three-pass', wideningRounds: 1, passes: 2 });
    expect(checkLayout(input, banded)).toEqual([]);
  });

  it('takes its budgets from the routing options (the defaults: src/constants.test.ts)', () => {
    const small = manyEdges(4, 6, 30);
    const smallWork = layoutScene(small).report.routing.work;
    expect(smallWork).toBeLessThan(DEFAULT_ROUTING.oneRoundWork);
    // 0: every edge searched weighted; 1: all but the first; the whole work: none.
    expect(layoutScene(small, { routing: { singlePassWork: 0 } }).report.routing.mode).toBe('single-pass');
    expect(layoutScene(small, { routing: { singlePassWork: 1 } }).report.routing.mode).toBe('single-pass');
    expect(layoutScene(small, { routing: { singlePassWork: smallWork } }).report.routing.mode).toBe(
      'three-pass',
    );
  });
});

describe('widening reservations', () => {
  const extra = (patch: Partial<Widening>): Widening => ({
    ringSides: { top: 0, right: 0, bottom: 0, left: 0 },
    cardColumns: [],
    zoneColumns: [],
    rows: [],
    stacks: [],
    ...patch,
  });

  it('accumulates widening rounds container by container and gap by gap', () => {
    const total = new Map<number, Widening>();
    accumulate(
      total,
      new Map([[0, extra({ rows: [8], ringSides: { top: 0, right: 8, bottom: 0, left: 0 } })]]),
    );
    accumulate(
      total,
      new Map([
        [0, extra({ rows: [0, 16], zoneColumns: [[], [4]] })],
        [2, extra({ cardColumns: [2] })],
      ]),
    );
    expect(total.get(0)).toEqual(
      extra({ rows: [8, 16], zoneColumns: [[], [4]], ringSides: { top: 0, right: 8, bottom: 0, left: 0 } }),
    );
    expect(total.get(2)).toEqual(extra({ cardColumns: [2] }));
  });
});

describe('addWidening', () => {
  it('adds the router’s widening to the caller’s reservations, keeping the caller’s uniform values', () => {
    const input = scene(
      [zone('p', 'project', [card('a'), card('b')])],
      [{ from: 'a', to: 'b', kind: 'uses' }],
    );
    const gutters = {
      canvas: { horizontal: 4, ringSides: { left: 2 } },
      zones: { p: { ring: 6, gaps: { rows: [1] } } },
    };
    const layout = layoutScene(input, { gutters });
    expect(layout.gutters.canvas).toMatchObject({ horizontal: 4, ringSides: { left: 2 } });
    expect(layout.gutters.zones?.p).toMatchObject({ ring: 6 });
    expect(layout.rects.p?.padding).toBe(24 + 6);
    assertLayout(input, layout, { gutters });
    expect(addWidening({}, new Map(), { containers: [] } as never)).toEqual({});
  });
});
