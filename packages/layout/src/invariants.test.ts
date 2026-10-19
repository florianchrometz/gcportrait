// SPDX-License-Identifier: Apache-2.0
import {
  InvariantViolationSchema,
  type InvariantCode as ModelInvariantCode,
  type InvariantViolation as ModelInvariantViolation,
  type Scene,
} from '@gcportrait/model';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { packingAspects } from './aspects.js';
import {
  LayoutInvariantError,
  assertLayout,
  canvasContentBox,
  checkDeterminism,
  checkLayout,
  contentBox,
  type InvariantCode,
  type InvariantViolation,
} from './invariants.js';
import { layoutScene } from './layout.js';
import { thrownBy } from './testing/errors.js';
import { card, scene, zone } from './testing/scenes.js';
import type { EdgePath, Layout, LayoutRect } from './types.js';

/** The distinct codes `checkLayout` finds, sorted. */
const codesOf = (input: Scene, layout: Layout): InvariantCode[] =>
  [...new Set(checkLayout(input, layout).map((v) => v.code))].sort();

/** `base` with the rect `id` patched. */
function withRect(base: Layout, id: string, patch: Partial<LayoutRect>): Layout {
  const rect = base.rects[id];
  if (rect === undefined) throw new Error(id);
  return { ...base, rects: { ...base.rects, [id]: { ...rect, ...patch } } };
}

/** `base` with the edge `id` patched. */
function withEdge(base: Layout, id: string, patch: Partial<EdgePath>): Layout {
  const edge = base.edges[id];
  if (edge === undefined) throw new Error(id);
  return { ...base, edges: { ...base.edges, [id]: { ...edge, ...patch } } };
}

const input = scene([
  zone('p', 'project', [zone('v', 'vpc', [card('a'), card('b')]), card('c')]),
  zone('f', 'folder', [
    zone('chip', 'project', [], { collapsed: { resources: 1 } }),
    zone('e', 'subnet', []),
  ]),
]);
const layout = layoutScene(input);

const codes = (l: Layout): InvariantCode[] => codesOf(input, l);
const patched = (id: string, patch: Partial<LayoutRect>): Layout => withRect(layout, id, patch);

describe('checkLayout', () => {
  it('preserves public model types and validates reported violations against schema', () => {
    expectTypeOf<InvariantCode>().toEqualTypeOf<ModelInvariantCode>();
    expectTypeOf<InvariantViolation>().toEqualTypeOf<ModelInvariantViolation>();
    const violations = checkLayout(input, patched('a', { x: Number.NaN }));
    expect(violations.length).toBeGreaterThan(0);
    for (const v of violations) {
      expect(InvariantViolationSchema.parse(v)).toEqual(v);
      expect(InvariantViolationSchema.parse(JSON.parse(JSON.stringify(v)))).toEqual(v);
    }
  });

  it('finds nothing wrong with a real layout', () => {
    expect(checkLayout(input, layout)).toEqual([]);
    expect(() => {
      assertLayout(input, layout);
    }).not.toThrow();
  });

  it('finds a missing and an unexpected rect', () => {
    const rest = Object.fromEntries(Object.entries(layout.rects).filter(([id]) => id !== 'a'));
    expect(codes({ ...layout, rects: rest })).toEqual(['missing-rect']);
    expect(codes({ ...layout, rects: { ...layout.rects, ghost: layout.rects.a as LayoutRect } })).toContain(
      'unexpected-rect',
    );
  });

  it('finds non-finite and empty rects and a non-finite bounding box', () => {
    expect(codes(patched('a', { x: Number.NaN }))).toEqual(['non-finite']);
    expect(codes(patched('a', { width: 0 }))).toEqual(['non-finite']);
    expect(codes({ ...layout, bounds: { ...layout.bounds, width: Infinity } })).toContain('non-finite');
  });

  it('finds a wrong parent, depth, role or kind', () => {
    expect(codes(patched('a', { parent: 'p' }))).toContain('wrong-parent');
    expect(codes(patched('a', { depth: 7 }))).toEqual(['wrong-depth']);
    expect(codes(patched('a', { role: 'chip' }))).toContain('wrong-role');
    expect(codes(patched('a', { kind: 'vpc' }))).toEqual(['wrong-role']);
    expect(codes(patched('chip', { collapsed: false }))).toContain('wrong-role');
  });

  it('finds wrong sizes for cards, chips, empty zones and zone headers', () => {
    expect(codes(patched('a', { height: 50 }))).toContain('wrong-size');
    expect(codes(patched('a', { width: 300 }))).toContain('wrong-size');
    expect(codes(patched('e', { width: 100 }))).toContain('wrong-size');
    expect(codes(patched('chip', { width: 150 }))).toContain('wrong-size');
    expect(codes(patched('v', { headerHeight: 32 }))).toContain('wrong-size');
    expect(codes(patched('v', { padding: 10 }))).toContain('wrong-size');
    const v = layout.rects.v as LayoutRect;
    expect(codes(patched('v', { height: v.headerHeight }))).toContain('wrong-size');
  });

  it('finds a child outside its parent padding, a top-level rect in the margin, and a rect outside the bounds', () => {
    const v = layout.rects.v as LayoutRect;
    expect(codes(patched('a', { x: v.x + 2 }))).toContain('outside-parent');
    expect(codes(patched('a', { y: v.y + 4 }))).toContain('outside-parent'); // in the header
    expect(codes(patched('p', { x: 4 }))).toContain('outside-parent');
    expect(codes({ ...layout, bounds: { ...layout.bounds, width: 10 } })).toContain('outside-bounds');
  });

  it('finds overlapping cards and overlapping sibling zones', () => {
    const a = layout.rects.a as LayoutRect;
    expect(codes(patched('b', { x: a.x + 10, y: a.y }))).toContain('overlap');
    const p = layout.rects.p as LayoutRect;
    const overlapping = checkLayout(input, patched('f', { x: p.x + 20, y: p.y + 20 }));
    expect(overlapping.some((v) => v.code === 'overlap' && v.ids.includes('p') && v.ids.includes('f'))).toBe(
      true,
    );
  });

  it('finds missing, misfitting and stray arrangements', () => {
    const zones = { ...layout.arrangements.zones };
    delete zones.v;
    const broken: Layout = {
      ...layout,
      arrangements: {
        canvas: { cardColumns: 1, zoneRows: [2] },
        zones: { ...zones, f: { cardColumns: 0, zoneRows: [1] }, a: { cardColumns: 0, zoneRows: [] } },
      },
    };
    const found = checkLayout(input, broken).filter((v) => v.code === 'arrangement');
    expect(found.map((v) => v.ids)).toEqual([[], ['f'], ['v'], ['a']]);
    expect(found.map((v) => v.message)).toEqual([
      'the canvas: cardColumns 1 does not fit 0 card(s)',
      'f: zoneRows [1] do not split 2 zone(s)',
      'v: has no arrangement',
      'a has an arrangement but is not an open zone',
    ]);
  });

  it('finds a chip list that does not match the chip rects', () => {
    expect(codes({ ...layout, chips: [] })).toEqual(['chips']);
    expect(codes({ ...layout, chips: ['e'] })).toEqual(['chips']);
  });

  it.each([
    ['a single violation', ['a']],
    ['every violation at once', ['a', 'b']],
  ])('throws %s from assertLayout', (_, ids) => {
    const broken = ids.reduce((base, id) => withRect(base, id, { depth: 9 }), layout);
    const error = thrownBy(() => {
      assertLayout(input, broken);
    }, LayoutInvariantError);
    expect(error.violations.map((v) => v.ids)).toEqual(ids.map((id) => [id]));
    expect(error.message).toMatch(new RegExp(`^layout invariants violated \\(${String(ids.length)}\\):`));
  });

  it('shortens a long list of violations in the message', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      code: 'overlap' as const,
      ids: [],
      message: `m${String(i)}`,
    }));
    expect(new LayoutInvariantError(many).message).toMatch(/… and 2 more$/);
  });
});

describe('content boxes', () => {
  it('is the area inside the padding, below the header', () => {
    const v = layout.rects.v as LayoutRect;
    expect(contentBox(v)).toEqual({
      x: v.x + 16,
      y: v.y + 40 + 16,
      width: v.width - 32,
      height: v.height - 40 - 32,
    });
    expect(canvasContentBox(layout)).toEqual({
      x: 24,
      y: 24,
      width: layout.bounds.width - 48,
      height: layout.bounds.height - 48,
    });
  });
});

describe('checkDeterminism', () => {
  it('passes for the layout engine', () => {
    expect(checkDeterminism(input, { clock: () => 1 })).toEqual([]);
  });

  it('reports a layout that differs between runs and on a reordered Scene', () => {
    // Options whose card height changes every time they are read: each of the three runs differs.
    let reads = 0;
    const sizing = {
      get cardHeight(): number {
        reads += 1;
        return 44 + reads;
      },
    };
    expect(checkDeterminism(input, { sizing }).map((violation) => violation.message)).toEqual([
      'two runs gave different layouts',
      'reordering the Scene children gave a different layout',
    ]);
  });
});

describe('packingAspects', () => {
  it('measures each container’s children box against its target', () => {
    const aspects = packingAspects(layout);
    expect(aspects.map((aspect) => aspect.id)).toEqual([null, 'f', 'p', 'v']);
    const canvas = aspects[0];
    expect(canvas).toMatchObject({ id: null, children: 2, target: 1.75 });
    const v = aspects.find((aspect) => aspect.id === 'v');
    const a = layout.rects.a as LayoutRect;
    const b = layout.rects.b as LayoutRect;
    const width = Math.max(a.x + a.width, b.x + b.width) - Math.min(a.x, b.x);
    const height = Math.max(a.y + a.height, b.y + b.height) - Math.min(a.y, b.y);
    expect(v).toEqual({
      id: 'v',
      children: 2,
      width,
      height,
      aspect: width / height,
      target: 1.6,
      fill: (a.width * a.height + b.width * b.height) / (width * height),
      deviation: Math.abs(width / height - 1.6) / 1.6,
    });
    expect(packingAspects(layout, { targetAspect: 2, rootAspect: 3 })[0]?.target).toBe(3);
  });
});

describe('checkLayout: edges', () => {
  const routed = scene(
    [zone('p', 'project', [card('a'), card('b'), card('c')]), zone('q', 'project', [card('d'), card('e')])],
    [
      { from: 'a', to: 'b', kind: 'uses' },
      { from: 'd', to: 'p', kind: 'uses' },
      { from: 'a', to: 'e', kind: 'peers' },
    ],
  );
  const base = layoutScene(routed);
  const edgeCodes = (l: Layout): InvariantCode[] => codesOf(routed, l);
  const patched = (id: string, patch: Partial<EdgePath>): Layout => withEdge(base, id, patch);

  it('finds nothing wrong with routed edges', () => {
    expect(checkLayout(routed, base)).toEqual([]);
    // Sorted by from, then to, then kind.
    expect(Object.keys(base.edges)).toEqual(['a -uses-> b', 'a -peers-> e', 'd -uses-> p']);
  });

  it('finds a missing, an unexpected and a miscounted edge', () => {
    const rest = Object.fromEntries(Object.entries(base.edges).filter(([id]) => id !== 'a -uses-> b'));
    expect(edgeCodes({ ...base, edges: rest })).toEqual(['edge-missing']);
    const extra = base.edges['a -uses-> b'];
    if (extra === undefined) throw new Error('edge');
    expect(
      edgeCodes({ ...base, edges: { ...base.edges, 'b -uses-> a': { ...extra, from: 'b', to: 'a' } } }),
    ).toEqual(['edge-unexpected']);
    expect(edgeCodes(patched('a -uses-> b', { count: 3 }))).toEqual(['edge-missing']);
  });

  it('finds too few points, a diagonal segment and the wrong heads', () => {
    const edge = base.edges['a -uses-> b'];
    expect(edgeCodes(patched('a -uses-> b', { points: edge?.points.slice(0, 1) ?? [] }))).toEqual([
      'edge-shape',
    ]);
    expect(
      edgeCodes(
        patched('a -uses-> b', {
          points: [{ x: 0, y: 0 }, { x: 5, y: 5 }, ...(edge?.points.slice(1) ?? [])],
        }),
      ),
    ).toEqual(['edge-shape']);
    expect(edgeCodes(patched('a -uses-> b', { heads: 'both' }))).toContain('edge-shape');
  });

  it('finds a port off its rect’s border, on a zone’s header and beside it', () => {
    const edge = base.edges['d -uses-> p'];
    const p = base.rects.p;
    if (edge === undefined || p === undefined) throw new Error('setup');
    expect(edgeCodes(patched('d -uses-> p', { source: { ...edge.source, x: edge.source.x + 3 } }))).toContain(
      'edge-port',
    );
    expect(edgeCodes(patched('d -uses-> p', { target: { x: p.x + 20, y: p.y, side: 'top' } }))).toContain(
      'edge-port',
    );
    expect(edgeCodes(patched('d -uses-> p', { target: { x: p.x, y: p.y + 10, side: 'left' } }))).toContain(
      'edge-port',
    );
  });

  it('finds an end that is neither its port nor its arrowhead’s tip', () => {
    const edge = base.edges['a -uses-> b'];
    if (edge === undefined) throw new Error('setup');
    const points = [...edge.points];
    const last = points[points.length - 1];
    const before = points[points.length - 2];
    if (last === undefined || before === undefined) throw new Error('setup');
    // One px short of the tip, along the last segment (still orthogonal).
    points[points.length - 1] = {
      x: last.x - Math.sign(last.x - before.x),
      y: last.y - Math.sign(last.y - before.y),
    };
    expect(edgeCodes(patched('a -uses-> b', { points }))).toEqual(['edge-tip']);
  });

  it('finds a segment through a card and one through a zone header', () => {
    const edge = base.edges['a -uses-> b'];
    const c = base.rects.c;
    const q = base.rects.q;
    if (edge === undefined || c === undefined || q === undefined) throw new Error('setup');
    const [first, ...rest] = edge.points;
    if (first === undefined) throw new Error('setup');
    // Out through card c's middle and back.
    const throughCard = [
      first,
      { x: first.x, y: c.y + c.height / 2 },
      { x: c.x + c.width / 2, y: c.y + c.height / 2 },
      { x: c.x + c.width / 2, y: c.y + c.height / 2 },
      { x: first.x, y: c.y + c.height / 2 },
      first,
      ...rest,
    ];
    const crossing = checkLayout(routed, patched('a -uses-> b', { points: throughCard }));
    expect(crossing.map((v) => v.code)).toContain('edge-crossing');
    expect(crossing.find((v) => v.code === 'edge-crossing')?.ids).toContain('c');
    const headerY = q.y + q.headerHeight / 2;
    const throughHeader = [
      first,
      { x: first.x, y: headerY },
      { x: q.x + q.width / 2, y: headerY },
      { x: first.x, y: headerY },
      first,
      ...rest,
    ];
    const header = checkLayout(routed, patched('a -uses-> b', { points: throughHeader }));
    expect(header.find((v) => v.code === 'edge-crossing')?.message).toMatch(/crosses the header of [pq]/);
  });
});

describe('checkLayout: hub bundles', () => {
  const sources = ['s1', 's2', 's3', 's4'];
  const hub = scene(
    [
      card('hub'),
      zone(
        'z',
        'folder',
        sources.map((id) => card(id)),
      ),
    ],
    sources.map((id) => ({ from: id, to: 'hub', kind: 'uses' as const })),
  );
  const base = layoutScene(hub);
  const codes = (l: Layout): InvariantCode[] => codesOf(hub, l);
  const patched = (id: string, patch: Partial<EdgePath>): Layout => withEdge(base, id, patch);

  it('accepts members sharing their bundle’s port', () => {
    expect(Object.values(base.edges).every((edge) => edge.bundle?.size === 4)).toBe(true);
    expect(checkLayout(hub, base)).toEqual([]);
  });

  it('finds a member off its bundle’s port, a wrong size and a wrong end', () => {
    const edge = base.edges['s1 -uses-> hub'];
    if (edge?.bundle === undefined) throw new Error('bundle');
    const moved = {
      points: [...edge.points.slice(0, -2), ...edge.points.slice(-2).map((p) => ({ x: p.x + 12, y: p.y }))],
      target: { ...edge.target, x: edge.target.x + 12 },
    };
    expect(codes(patched('s1 -uses-> hub', moved))).toEqual(['edge-port']);
    expect(codes(patched('s1 -uses-> hub', { bundle: { ...edge.bundle, size: 3 } }))).toEqual(['edge-port']);
    expect(codes(patched('s1 -uses-> hub', { bundle: { ...edge.bundle, end: 'source' } }))).toEqual([
      'edge-port',
    ]);
  });
});

describe('checkLayout: padding reservations, arrowhead tips, port sides and ghost ends', () => {
  const routed = scene(
    [zone('p', 'project', [card('a'), card('b')]), zone('q', 'project', [card('d')])],
    [
      { from: 'd', to: 'p', kind: 'uses' },
      { from: 'a', to: 'b', kind: 'uses' },
    ],
  );
  const base = layoutScene(routed);
  const codes = (l: Layout): InvariantCode[] => codesOf(routed, l);

  it('finds extra padding on a side that the layout’s reservations do not account for', () => {
    const extra = { top: 0, right: 0, bottom: 4, left: 0 };
    expect(codes(withRect(base, 'p', { paddingExtra: extra }))).toContain('wrong-size');
  });

  it('finds an arrowhead whose tip enters a rect other than its target', () => {
    const edge = base.edges['d -uses-> p'];
    const a = base.rects.a;
    const p = base.rects.p;
    if (edge === undefined || a === undefined || p === undefined) throw new Error('setup');
    // Move card a against p's border where the head ends (only possible by hand: p's padding keeps it clear).
    const x =
      edge.target.side === 'left'
        ? p.x
        : edge.target.side === 'right'
          ? p.x + p.width - a.width
          : edge.target.x - 20;
    const y = edge.target.side === 'bottom' ? p.y + p.height - a.height : edge.target.y - 20;
    const moved = withRect(base, 'a', { x, y });
    const crossing = checkLayout(routed, moved).find(
      (v) => v.code === 'edge-crossing' && v.message.includes('arrowhead'),
    );
    expect(crossing?.ids).toContain('a');
  });

  it('finds a port off its side on a card’s top or bottom, and an edge ending where its port is not on the last segment', () => {
    const edge = base.edges['a -uses-> b'];
    if (edge === undefined) throw new Error('setup');
    const b = base.rects.b;
    if (b === undefined) throw new Error('setup');
    const patch = (target: EdgePath['target']): Layout => withEdge(base, 'a -uses-> b', { target });
    expect(codes(patch({ x: b.x + 10, y: b.y + 1, side: 'top' }))).toContain('edge-port');
    expect(codes(patch({ x: b.x + 10, y: b.y + b.height - 1, side: 'bottom' }))).toContain('edge-port');
    // The last segment ends at the tip but starts beyond it, inside the card: the port is not on it.
    const points = [...edge.points];
    const tip = points[points.length - 1];
    const before = points[points.length - 2];
    if (tip === undefined || before === undefined) throw new Error('setup');
    const inside = { x: tip.x + Math.sign(tip.x - before.x) * 5, y: tip.y + Math.sign(tip.y - before.y) * 5 };
    const broken = withEdge(base, 'a -uses-> b', { points: [...points.slice(0, -1), inside, tip] });
    expect(codes(broken)).toContain('edge-tip');
  });

  it('finds an expected edge drawn from a node that has no rect', () => {
    const ghost = withEdge(base, 'a -uses-> b', { from: 'ghost' });
    expect(checkLayout(routed, ghost).find((v) => v.code === 'edge-unexpected')?.message).toContain(
      'joins a node without a rect',
    );
  });

  it('expects an edge whose end lies inside a chip at the outermost chip (as the Scene builder re-targets)', () => {
    // Only a hand-made layout can hold a rect inside a chip.
    const input = scene(
      [zone('chip', 'project', [], { collapsed: { resources: 2 } }), card('x')],
      [{ from: 'x', to: 'chip', kind: 'uses' }],
    );
    const layout = layoutScene(input);
    const x = layout.rects.x;
    if (x === undefined) throw new Error('setup');
    const inner = scene(
      [zone('chip', 'project', [], { collapsed: { resources: 2 } }), card('x')],
      [{ from: 'x', to: 'inner', kind: 'uses' }],
    );
    const handMade = { ...layout, rects: { ...layout.rects, inner: { ...x, parent: 'chip' } } };
    const violations = checkLayout(inner, handMade);
    expect(violations.some((v) => v.code === 'edge-missing')).toBe(false);
  });
});
