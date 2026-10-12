// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import type { SceneEdge } from '@gcportrait/model';
import { DEFAULT_ROUTING } from './constants.js';
import { mergeEdges } from './edges.js';
import { buildGutters } from './gutters.js';
import { placedTree } from './layout.js';
import type { LayoutNode } from './normalise.js';
import {
  assignPorts,
  candidateSlots,
  crossingsOf,
  facingSide,
  innerSide,
  sideIntervals,
  slotPositions,
} from './ports.js';
import { layoutNode } from './testing/nodes.js';
import { card, scene, zone } from './testing/scenes.js';
import type { SceneNode } from '@gcportrait/model';
import type { LayoutOptions } from './types.js';

function setup(children: SceneNode[], edges: SceneEdge[], options: LayoutOptions = {}) {
  const input = scene(children, edges);
  const tree = placedTree(input, options);
  const gutters = buildGutters(tree);
  const nodes = new Map(tree.order.map((node) => [node.id, node]));
  const merged = mergeEdges(input, nodes);
  const ports = assignPorts(merged.edges, gutters, { ...DEFAULT_ROUTING, ...options.routing });
  const node = (id: string): LayoutNode => {
    const found = nodes.get(id);
    if (found === undefined) throw new Error(id);
    return found;
  };
  return { ports, edges: merged.edges, gutters, node };
}

/** A box at (x, y): a card, or a zone with its 40 px header and 16 px padding. */
function box(
  x: number,
  y: number,
  width: number,
  height: number,
  role: LayoutNode['role'] = 'card',
): LayoutNode {
  const isZone = role === 'zone';
  return layoutNode({
    id: `${String(x)},${String(y)}`,
    role,
    x,
    y,
    width,
    height,
    headerHeight: isZone ? 40 : 0,
    padding: isZone ? 16 : 0,
  });
}

describe('facingSide and innerSide', () => {
  const card0 = box(100, 100, 150, 44);
  it('takes the side along the axis on which the rects are further apart', () => {
    expect(facingSide(card0, box(400, 110, 150, 44), true)).toBe('right');
    expect(facingSide(card0, box(-300, 90, 150, 44), true)).toBe('left');
    expect(facingSide(card0, box(120, 300, 150, 44), true)).toBe('bottom');
    expect(facingSide(card0, box(120, -100, 150, 44), true)).toBe('top');
    // Diagonal: 150 px apart horizontally, 56 vertically.
    expect(facingSide(card0, box(400, 200, 150, 44), true)).toBe('right');
  });

  it('never faces up from an open zone (its header): left or right instead', () => {
    expect(facingSide(card0, box(80, -100, 150, 44), false)).toBe('left');
    expect(facingSide(card0, box(160, -100, 150, 44), false)).toBe('right');
  });

  it('turns a containing zone’s port to its side nearest the inner end', () => {
    const outer = box(0, 0, 1000, 400, 'zone');
    expect(innerSide(outer, box(20, 100, 150, 44))).toBe('left');
    expect(innerSide(outer, box(800, 100, 150, 44))).toBe('right');
    expect(innerSide(outer, box(400, 340, 150, 44))).toBe('bottom');
  });
});

describe('sideIntervals', () => {
  it('keeps a card’s ports clear of its corners', () => {
    expect(sideIntervals(box(0, 0, 160, 44), 'left', DEFAULT_ROUTING)).toEqual([[8, 36]]);
    expect(sideIntervals(box(0, 0, 160, 44), 'bottom', DEFAULT_ROUTING)).toEqual([[8, 152]]);
  });

  it('keeps an open zone’s ports below its header and out of every gutter that passes through its border', () => {
    const { node, gutters } = setup(
      [zone('p', 'project', [card('c1'), card('c2'), card('c3'), zone('v', 'vpc', [card('x')])])],
      [],
    );
    const p = node('p');
    const crossings = crossingsOf(gutters.lines);
    for (const side of ['left', 'right', 'bottom'] as const) {
      const intervals = sideIntervals(p, side, DEFAULT_ROUTING, crossings);
      expect(intervals.length).toBeGreaterThan(0);
      const vertical = side !== 'bottom';
      const border = side === 'left' ? p.x : side === 'right' ? p.x + p.width : p.y + p.height;
      for (const [lo, hi] of intervals) {
        expect(hi).toBeGreaterThan(lo);
        if (vertical) expect(lo).toBeGreaterThan(p.y + p.headerHeight);
        for (const line of gutters.lines) {
          if (line.horizontal !== vertical || line.a >= border || line.b <= border) continue;
          // No port within the strip of a gutter crossing this side.
          const strip = Math.max(...line.pieces.map((piece) => piece.strip));
          expect(hi <= line.c - strip / 2 + 1e-6 || lo >= line.c + strip / 2 - 1e-6).toBe(true);
        }
      }
    }
    // Without the gutters, the whole stretch below the header and clear of the corners.
    expect(sideIntervals(p, 'left', DEFAULT_ROUTING)).toEqual([[p.y + 40 + 12, p.y + p.height - 12]]);
  });
});

describe('assignPorts', () => {
  it('starts and ends on facing sides, at the middle, and meets the gutter between them', () => {
    const { ports, gutters, node } = setup([card('a'), card('b')], [{ from: 'a', to: 'b', kind: 'uses' }], {
      arrangements: { canvas: { cardColumns: 2, zoneRows: [] } },
    });
    const [a, b] = [node('a'), node('b')];
    const { source, target } = ports[0] ?? { source: undefined, target: undefined };
    expect(source).toMatchObject({ side: 'right', x: a.x + a.width, y: a.y + 22, inward: false, inset: 2 });
    expect(target).toMatchObject({ side: 'left', x: b.x, inset: 2 });
    // Left sides use the slot grid shifted by half a spacing: 16 or 28 on a 44 px card, not the middle.
    expect([b.y + 16, b.y + 28]).toContain(target?.y);
    const line = gutters.lines[source?.line ?? -1];
    expect(line?.horizontal).toBe(false);
    expect(line?.c).toBe((a.x + a.width + b.x) / 2);
  });

  it('spaces the ports on one side 12 px apart, ordered by where their other ends lie', () => {
    const others = ['t1', 't2', 't3'];
    const { ports } = setup(
      [
        card('a'),
        zone(
          'z',
          'folder',
          others.map((id) => card(id)),
        ),
      ],
      others.map((id) => ({ from: 'a', to: id, kind: 'uses' as const })),
      { routing: { bundleMin: 4 } },
    );
    const sides = new Set(ports.map((port) => port.source.side));
    expect(sides.size).toBe(1);
    const along = (port: { x: number; y: number; side: string }): number =>
      port.side === 'left' || port.side === 'right' ? port.y : port.x;
    const ys = ports.map((port) => along(port.source));
    // In the order of the other ends along the side.
    const far = ports.map((port) => along(port.target));
    expect(ys.map((_, i) => i).sort((i, j) => (ys[i] ?? 0) - (ys[j] ?? 0))).toEqual(
      far.map((_, i) => i).sort((i, j) => (far[i] ?? 0) - (far[j] ?? 0)),
    );
    const sorted = [...ys].sort((p, q) => p - q);
    expect((sorted[1] ?? 0) - (sorted[0] ?? 0)).toBe(12);
    expect((sorted[2] ?? 0) - (sorted[1] ?? 0)).toBe(12);
  });

  it('bundles a hub’s edges of one kind onto one port, on the side most of them face', () => {
    // The hub sits above the folder: twenty uses edges face its bottom side, which holds eleven ports.
    const targets = Array.from({ length: 20 }, (_, i) => `t${String(i)}`);
    const { ports, edges } = setup(
      [
        card('hub'),
        zone(
          'z',
          'folder',
          targets.map((id) => card(id)),
        ),
      ],
      targets.map((id) => ({ from: id, to: 'hub', kind: 'uses' as const })),
    );
    const bundle = ports[0]?.bundle;
    expect(bundle).toMatchObject({ end: 1, size: 20, id: 'hub <-uses- * (bottom)' });
    for (const port of ports) {
      expect(port.bundle).toBe(bundle);
      expect(port.holder).toBe(edges.length + (bundle?.index ?? -1));
      expect(port.target).toEqual(ports[0]?.target);
    }
    // The other ends keep their own ports.
    expect(new Set(ports.map((port) => `${String(port.source.x)},${String(port.source.y)}`)).size).toBe(20);
  });

  it('bundles from bundleMin on, and below it keeps one port per edge', () => {
    const children = [
      card('hub'),
      zone(
        'z',
        'folder',
        ['a', 'b', 'c'].map((id) => card(id)),
      ),
    ];
    const edges = ['a', 'b', 'c'].map((id) => ({ from: id, to: 'hub', kind: 'uses' as const }));
    const input = scene(children, edges);
    const tree = placedTree(input);
    const gutters = buildGutters(tree);
    const nodes = new Map(tree.order.map((node) => [node.id, node]));
    const merged = mergeEdges(input, nodes);
    const own = assignPorts(merged.edges, gutters, { ...DEFAULT_ROUTING, bundleMin: 4 });
    expect(own.every((port) => port.bundle === null)).toBe(true);
    expect(own.map((port) => port.holder)).toEqual([0, 1, 2]);
    expect(new Set(own.map((port) => port.target.x)).size).toBe(3);
    const bundled = assignPorts(merged.edges, gutters, { ...DEFAULT_ROUTING, bundleMin: 3 });
    expect(bundled.every((port) => port.bundle?.size === 3)).toBe(true);
    expect(new Set(bundled.map((port) => port.target.x)).size).toBe(1);
  });

  it('bundles the ends of one kind on a side more ports face than it holds', () => {
    // A card's right side holds three ports; six edges of two kinds face it, three of each.
    // The hub's project and the sources' folder side by side in one zone row.
    const sources = ['s1', 's2', 's3', 's4', 's5', 's6'];
    const { ports } = setup(
      [
        zone('h', 'project', [card('hub')]),
        zone(
          'z',
          'folder',
          sources.map((id) => card(id)),
        ),
      ],
      sources.map((id, i) => ({
        from: id,
        to: 'hub',
        kind: i < 3 ? ('attaches' as const) : ('shares' as const),
      })),
      {
        arrangements: {
          canvas: { cardColumns: 0, zoneRows: [2] },
          zones: { z: { cardColumns: 6, zoneRows: [] } },
        },
        routing: { bundleMin: 10 },
      },
    );
    // The folder ranks before the project: the sources lie to the left of the hub, level with it.
    const sides = new Set(ports.map((port) => port.target.side));
    expect(sides).toEqual(new Set(['left']));
    const ids = new Set(ports.map((port) => port.bundle?.id));
    expect(ids.size).toBe(2);
    expect(
      new Set(
        ports.map((port) =>
          port.target.side === 'left' || port.target.side === 'right' ? port.target.y : port.target.x,
        ),
      ).size,
    ).toBe(2);
  });

  it('moves ports that do not fit a side to the neighbouring sides, then to the opposite side', () => {
    // Nineteen edges of different kinds and directions (nothing to bundle) face the hub's bottom and right
    // sides, which hold eleven and three ports: the rest move to the left side (two slots) and to the top.
    const kinds = [
      'routes',
      'uses',
      'triggers',
      'attaches',
      'connects',
      'memberOf',
      'runsAs',
      'encryptedBy',
      'replicates',
      'shares',
    ] as const;
    const others = Array.from({ length: 19 }, (_, i) => `t${String(i).padStart(2, '0')}`);
    const { ports, edges } = setup(
      [
        card('hub'),
        zone(
          'z',
          'folder',
          others.map((id) => card(id)),
        ),
      ],
      others.map((id, i) => {
        const kind = kinds[i % kinds.length] ?? 'uses';
        return i < kinds.length ? { from: id, to: 'hub', kind } : { from: 'hub', to: id, kind };
      }),
    );
    const hubEnds = ports.map((port, i) => (edges[i]?.from.id === 'hub' ? port.source : port.target));
    const count = (side: string): number => hubEnds.filter((port) => port.side === side).length;
    expect(ports.every((port) => port.bundle === null)).toBe(true);
    expect(count('bottom')).toBe(11);
    expect(count('right')).toBe(3);
    expect(count('left')).toBeGreaterThanOrEqual(1);
    expect(count('left')).toBeLessThanOrEqual(2);
    expect(count('top')).toBe(19 - 11 - 3 - count('left'));
    const bySide = new Map<string, number[]>();
    for (const port of hubEnds)
      bySide.set(port.side, [
        ...(bySide.get(port.side) ?? []),
        port.side === 'left' || port.side === 'right' ? port.y : port.x,
      ]);
    for (const positions of bySide.values()) {
      const sorted = [...positions].sort((p, q) => p - q);
      for (let i = 1; i < sorted.length; i += 1)
        expect((sorted[i] ?? 0) - (sorted[i - 1] ?? 0)).toBeGreaterThanOrEqual(12);
    }
  });

  it('keeps the previous pass’s sides and bundles, and places the slots anew', () => {
    const targets = Array.from({ length: 6 }, (_, i) => `t${String(i)}`);
    const input = scene(
      [
        card('hub'),
        zone(
          'z',
          'folder',
          targets.map((id) => card(id)),
        ),
      ],
      targets.map((id) => ({ from: id, to: 'hub', kind: 'uses' as const })),
    );
    const tree = placedTree(input);
    const gutters = buildGutters(tree);
    const nodes = new Map(tree.order.map((node) => [node.id, node]));
    const merged = mergeEdges(input, nodes);
    const first = assignPorts(merged.edges, gutters, DEFAULT_ROUTING);
    // Pretend the previous pass put every source on its left side and bundled nothing.
    const previous = first.map((port, i) => ({
      ...port,
      source: { ...port.source, side: 'left' as const },
      holder: i,
      bundle: null,
    }));
    const again = assignPorts(merged.edges, gutters, DEFAULT_ROUTING, previous);
    expect(again.map((port) => port.source.side)).toEqual(targets.map(() => 'left'));
    expect(again.every((port) => port.bundle === null)).toBe(true);
    expect(again.map((port) => port.target.side)).toEqual(first.map((port) => port.target.side));
    const kept = assignPorts(merged.edges, gutters, DEFAULT_ROUTING, first);
    expect(kept).toEqual(first);
  });

  it('puts a containing zone’s port on the inside of its border, on its own ring, with no inset', () => {
    const { ports, gutters, node } = setup(
      [zone('p', 'project', [card('c1'), card('c2')])],
      [{ from: 'p', to: 'c1', kind: 'uses' }],
    );
    const p = node('p');
    const { source, target } = ports[0] ?? { source: undefined, target: undefined };
    expect(source).toMatchObject({ inward: true, inset: 0 });
    expect(['left', 'right', 'bottom']).toContain(source?.side);
    expect(target?.side).toBe(source?.side);
    const ring = gutters.containers[gutters.containerOf[p.index] ?? -1];
    const line = gutters.lines[source?.line ?? -1];
    expect([ring?.ringLeft, ring?.ringRight, ring?.ringBottom]).toContain(line?.c);
  });
});

describe('slots', () => {
  it('keeps the middle of a side too short for its clearance, and of a zone with no room beside children', () => {
    expect(sideIntervals(box(0, 0, 160, 44), 'left', { ...DEFAULT_ROUTING, portClearance: 30 })).toEqual([
      [22, 22],
    ]);
    const everywhere = { bands: (): [number, number][] => [[-1e9, 1e9]] };
    const lo = 40 + 8;
    const hi = 200 - 12;
    expect(sideIntervals(box(0, 0, 300, 200, 'zone'), 'left', DEFAULT_ROUTING, everywhere)).toEqual([
      [(lo + hi) / 2, (lo + hi) / 2],
    ]);
    expect(sideIntervals(box(0, 0, 300, 200, 'zone'), 'bottom', DEFAULT_ROUTING, everywhere)).toEqual([
      [150, 150],
    ]);
  });

  it('puts unshifted slots on the middle and whole spacings, shifted ones on half spacings', () => {
    expect(candidateSlots([[0, 28]], 12, false)).toEqual([2, 14, 26]);
    expect(candidateSlots([[0, 28]], 12, true)).toEqual([8, 20]);
    expect(candidateSlots([[0, 36]], 12, true)).toEqual([0, 12, 24, 36]);
    // Shorter than one spacing: the middle only, either way.
    expect(candidateSlots([[0, 8]], 12, true)).toEqual([4]);
    expect(candidateSlots([[0, 8]], 12, false)).toEqual([4]);
  });

  it('takes the slots nearest the middle when they fit, else spreads the ports over the intervals', () => {
    expect(slotPositions([[0, 100]], 3, 12, false)).toEqual([38, 50, 62]);
    // Two intervals of 20 px hold 2 + 2 slots; six ports spread evenly over the 40 px they cover.
    const spread = slotPositions(
      [
        [0, 20],
        [100, 120],
      ],
      6,
      12,
      false,
    );
    expect(spread).toHaveLength(6);
    expect(spread.slice(0, 3).every((p) => p >= 0 && p <= 20)).toBe(true);
    expect(spread.slice(3).every((p) => p >= 100 && p <= 120)).toBe(true);
  });
});

describe('bundle names', () => {
  it('names an outer and an inner bundle of one kind on one side apart', () => {
    // A zone's own children and three cards outside it all route to it: both groups share the zone's bottom.
    const children = [
      zone(
        'z',
        'folder',
        ['i1', 'i2'].map((id) => card(id)),
      ),
      card('o1'),
      card('o2'),
    ];
    const edges = ['i1', 'i2', 'o1', 'o2'].map((id) => ({ from: id, to: 'z', kind: 'routes' as const }));
    const { ports } = setup(children, edges, {
      arrangements: { canvas: { cardColumns: 2, zoneRows: [1] } },
      routing: { bundleMin: 2 },
    });
    const ids = new Map<string, number>();
    for (const port of ports) {
      const id = port.bundle?.id ?? '';
      ids.set(id, (ids.get(id) ?? 0) + 1);
    }
    for (const port of ports) expect(ids.get(port.bundle?.id ?? '')).toBe(port.bundle?.size);
    expect([...ids.keys()].some((id) => id.endsWith(', inside)'))).toBe(true);
  });
});
