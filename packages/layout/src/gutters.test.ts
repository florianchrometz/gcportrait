// SPDX-License-Identifier: MIT
import { propertyRuns } from '@gcportrait/model/testing';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ObstacleIndex, type Obstacle } from './geometry.js';
import { ABOVE, BELOW, LEFT, RIGHT, buildGutters, type GutterLine } from './gutters.js';
import { placedTree } from './layout.js';
import type { LayoutNode } from './normalise.js';
import type { LayoutOptions } from './types.js';
import { arbitraryScene, card, scene, zone } from './testing/scenes.js';

function setup(input: ReturnType<typeof scene>, options: LayoutOptions = {}) {
  const tree = placedTree(input, options);
  const gutters = buildGutters(tree);
  const byId = new Map(tree.order.map((node) => [node.id, node]));
  const node = (id: string): LayoutNode => {
    const found = byId.get(id);
    if (found === undefined) throw new Error(id);
    return found;
  };
  const line = (horizontal: boolean, c: number, t: number): GutterLine => {
    const found = gutters.lines[gutters.find(horizontal, c, t)];
    if (found === undefined)
      throw new Error(
        `no ${horizontal ? 'horizontal' : 'vertical'} line at ${String(c)} through ${String(t)}`,
      );
    return found;
  };
  return { tree, gutters, node, line };
}

// Two root projects side by side, each with a 2 × 2 card grid; the second also holds a VPC below its cards.
const twoProjects = scene([
  zone('a', 'project', [card('a1'), card('a2'), card('a3'), card('a4')]),
  zone('b', 'project', [card('b1'), card('b2'), zone('v', 'vpc', [card('v1')])]),
]);

describe('buildGutters', () => {
  it('puts a ring at the middle of every container’s padding, below its header', () => {
    const { gutters, node, line, tree } = setup(twoProjects);
    const canvas = gutters.containers[0];
    expect(canvas?.node).toBeNull();
    expect(canvas).toMatchObject({ ringLeft: 12, ringTop: 12, ringRight: tree.bounds.width - 12 });
    const a = node('a');
    const ring = gutters.containers[gutters.containerOf[a.index] ?? -1];
    expect(ring).toMatchObject({
      ringLeft: a.x + 12,
      ringRight: a.x + a.width - 12,
      ringTop: a.y + 40 + 12,
      ringBottom: a.y + a.height - 12,
    });
    expect(line(true, a.y + 52, a.x + 100).pieces.some((piece) => piece.gap.kind === 'ring')).toBe(true);
    expect(line(false, a.x + 12, a.y + 100).strip).toBe(24);
  });

  it('makes the gaps between rows and columns gutters, with their widths as strips and their gap references', () => {
    const { node, line } = setup(twoProjects);
    const [a1, a2, a3] = [node('a1'), node('a2'), node('a3')];
    const column = line(false, a1.x + a1.width + 12, a1.y + 10);
    expect(column.strip).toBe(24);
    expect(column.pieces[0]?.gap).toEqual({ kind: 'card-column', index: 0 });
    expect(column.b).toBeGreaterThan(a3.y + a3.height); // down to the ring bottom (no zones below)
    const row = line(true, a1.y + 44 + 10, a2.x);
    expect(row.strip).toBe(20);
    expect(row.pieces.find((piece) => piece.owner !== 0)?.gap).toEqual({ kind: 'row', index: 0 });
    // In b, the gap between its card row and its VPC is the gap below card row 0.
    const [b1, v] = [node('b1'), node('v')];
    const cardsToZones = line(true, (b1.y + 44 + v.y) / 2, b1.x);
    expect(cardsToZones.pieces.some((piece) => piece.gap.kind === 'row' && piece.gap.index === 0)).toBe(true);
  });

  it('records the gutters around every child: its column and row gaps, or its container’s ring', () => {
    const { gutters, node } = setup(twoProjects);
    const a = node('a');
    const a1 = node('a1');
    const around = (n: LayoutNode, side: number): number => gutters.around[n.index * 4 + side] ?? NaN;
    expect(around(a1, LEFT)).toBe(a.x + 12);
    expect(around(a1, RIGHT)).toBe(a1.x + a1.width + 12);
    expect(around(a1, ABOVE)).toBe(a.y + 52);
    expect(around(a1, BELOW)).toBe(a1.y + 44 + 10);
    // Top-level zones sit in the canvas's row: the gap between them on one side, the ring on the other.
    expect(around(a, LEFT)).toBe(12);
    expect(around(a, RIGHT)).toBe(a.x + a.width + 12);
  });

  it('runs a zone’s horizontal gutters out to its parent’s gutters, and merges collinear ones', () => {
    const { node, line } = setup(twoProjects);
    const a = node('a');
    const b = node('b');
    // Both root projects share their top edge, header and padding: their ring tops form one line across the gap.
    const top = line(true, a.y + 52, a.x + 50);
    expect(top.a).toBe(12);
    expect(top.b).toBe(b.x + b.width + 12);
    expect(new Set(top.pieces.map((piece) => piece.owner)).size).toBe(2);
  });

  it('runs a zone’s gutters straight through ancestors where nothing stands beside or below it, never up', () => {
    const nested = scene([
      zone('f', 'folder', [zone('p', 'project', [zone('s', 'subnet', [card('c1'), card('c2')])])]),
      card('x'),
    ]);
    const { node, line, tree } = setup(nested);
    const s = node('s');
    // s is alone in p, p alone in f: its ring top runs out to the canvas ring on both sides.
    const top = line(true, s.y + 32 + 8, s.x + 10);
    expect(top.a).toBe(12);
    expect(top.b).toBe(tree.bounds.width - 12);
    // Its ring sides run down to the canvas ring bottom (s is in the last row of p, p of f, f of the canvas).
    const left = line(false, s.x + 8, s.y + 60);
    expect(left.a).toBe(s.y + 40);
    expect(left.b).toBe(tree.bounds.height - 12);
  });

  it('runs a gutter between the zones of a stack, out to the gutters beside the stack', () => {
    // A tall VPC and two short empty zones after it: the two stack beside the VPC.
    const stacked = scene([
      zone('p', 'project', [
        zone('v', 'vpc', [card('c1'), card('c2'), card('c3'), card('c4'), card('c5'), card('c6')]),
        zone('x', 'subnet', [], { label: 'x-subnet' }),
        zone('y', 'subnet', [], { label: 'y-subnet' }),
      ]),
    ]);
    const { tree, gutters, node, line } = setup(stacked, {
      arrangements: { zones: { p: { cardColumns: 0, zoneRows: [3], zoneStacks: [[1, 2]] } } },
    });
    expect(tree.arrangements.get(node('p'))?.zoneStacks).toEqual([[1, 2]]);
    const [v, x, y] = [node('v'), node('x'), node('y')];
    expect(x.x).toBe(y.x);
    const between = line(true, (x.y + x.height + y.y) / 2, x.x + 10);
    expect(between.pieces[0]?.gap).toEqual({ kind: 'stack', row: 0, cell: 1, index: 0 });
    expect(between.strip).toBe(y.y - (x.y + x.height));
    // From the gap beside the VPC out through the project's right padding (nothing stands right of it).
    expect(between.a).toBeLessThanOrEqual((v.x + v.width + x.x) / 2);
    expect(between.b).toBeGreaterThanOrEqual(node('p').x + node('p').width);
    expect(gutters.around[x.index * 4 + BELOW]).toBe(between.c);
    expect(gutters.around[y.index * 4 + ABOVE]).toBe(between.c);
  });

  it('marks the stretches of a gutter that run along a border inside a padding band', () => {
    const { tree, node, line } = setup(twoProjects);
    // A ring side hugs its zone's border between the zone's corners; the canvas ring (the margin) everywhere.
    const a = node('a');
    const top = line(true, a.y + 52, a.x + 100);
    const ring = top.pieces.find((piece) => piece.owner !== 0);
    expect(ring?.hugSpans).toEqual([[a.x, a.x + a.width]]);
    expect(ring?.margin).toBeUndefined();
    const canvasTop = line(true, 12, 30);
    expect(canvasTop.pieces[0]?.hugSpans).toEqual([[12, tree.bounds.width - 12]]);
    expect(canvasTop.pieces[0]?.margin).toBe(true);
    // A gap never hugs, whether a child borders it on both sides or on one: the gap between project b's cards
    // and its VPC runs on beside the VPC where the VPC is wider than the card row.
    const [b1, v] = [node('b1'), node('v')];
    const gap = line(true, (b1.y + b1.height + v.y) / 2, v.x + 1);
    const piece = gap.pieces.find((entry) => entry.gap.kind === 'row');
    expect(piece).toBeDefined();
    expect(piece?.hugSpans).toBeUndefined();
    expect(piece?.margin).toBeUndefined();
  });

  it('answers whether a line runs alongside a span within its strip and a clearance', () => {
    const { gutters, node } = setup(twoProjects);
    const a = node('a');
    const ringTop = a.y + 52;
    expect(gutters.alongside(true, ringTop + 4, a.x + 50, a.x + 60, 8)).toBe(true);
    expect(gutters.alongside(true, ringTop + 30, a.x + 50, a.x + 60, 8)).toBe(false);
    expect(gutters.alongside(false, a.x + 12 + 4, a.y + 100, a.y + 110, 8)).toBe(true);
  });

  it('finds nothing where no line runs', () => {
    const { gutters } = setup(twoProjects);
    expect(gutters.find(true, -5, 0)).toBe(-1);
    expect(gutters.find(true, 12, -1000)).toBe(-1);
  });

  it('lays every gutter through free space: no line crosses a card, chip, empty zone or header (random Scenes)', () => {
    fc.assert(
      fc.property(arbitraryScene({ maxNodes: 150 }), (input) => {
        const tree = placedTree(input);
        const gutters = buildGutters(tree);
        const obstacles: Obstacle[] = tree.order.map((n) => ({
          id: n.id,
          header: n.role === 'zone',
          x: n.x,
          y: n.y,
          width: n.width,
          height: n.role === 'zone' ? n.headerHeight : n.height,
        }));
        const index = new ObstacleIndex(obstacles);
        for (const entry of gutters.lines) {
          const p = entry.horizontal ? { x: entry.a, y: entry.c } : { x: entry.c, y: entry.a };
          const q = entry.horizontal ? { x: entry.b, y: entry.c } : { x: entry.c, y: entry.b };
          expect(index.hits(p, q).map((o) => o.id)).toEqual([]);
        }
      }),
      { numRuns: propertyRuns(80) },
    );
  });
});
