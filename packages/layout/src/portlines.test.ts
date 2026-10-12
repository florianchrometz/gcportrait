// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { DEFAULT_ROUTING } from './constants.js';
import { mergeEdges } from './edges.js';
import { buildGutters } from './gutters.js';
import { assertLayout } from './invariants.js';
import { layoutScene, placedTree } from './layout.js';
import { assignPorts } from './ports.js';
import { isPortPiece, portLines } from './portlines.js';
import { card, scene, zone } from './testing/scenes.js';
import type { LayoutOptions, Point } from './types.js';

// Folder f holds project p (a chip `a` in its last row, nothing beside it) beside folder g, which holds a card
// `b` far to the right: `a`'s right port has a straight way out through p's and f's padding to the gap between
// f and g.
const input = scene(
  [
    zone('f', 'folder', [zone('p', 'project', [zone('a', 'project', [], { collapsed: { resources: 2 } })])]),
    zone('g', 'folder', [card('b')]),
  ],
  [{ from: 'a', to: 'b', kind: 'uses' }],
);
const SIDE_BY_SIDE: LayoutOptions = { arrangements: { canvas: { cardColumns: 0, zoneRows: [2] } } };

function linesOf(options: LayoutOptions = SIDE_BY_SIDE) {
  const tree = placedTree(input, options);
  const gutters = buildGutters(tree);
  const nodes = new Map(tree.order.map((node) => [node.id, node] as const));
  const { edges } = mergeEdges(input, nodes);
  const ports = assignPorts(edges, gutters, DEFAULT_ROUTING);
  return {
    tree,
    gutters,
    nodes,
    ports,
    exits: portLines(edges, ports, gutters, DEFAULT_ROUTING, gutters.lines.length),
  };
}

describe('portLines', () => {
  it('runs a line from a port straight out through every zone it is the last of, to the first gap beside one', () => {
    const { gutters, nodes, ports, exits } = linesOf();
    const [a, p, f, g] = ['a', 'p', 'f', 'g'].map((id) => nodes.get(id));
    const source = ports[0]?.source;
    expect(source?.side).toBe('right');
    const index = exits.lineOf[0] ?? -1;
    expect(index).toBe(gutters.lines.length);
    const line = exits.lines[0];
    expect(line).toMatchObject({ horizontal: true, c: source?.y });
    // From the stub's gutter (p's ring) out to the gap between f and g, one piece per container crossed.
    expect(line?.a).toBe(gutters.around[(a?.index ?? 0) * 4 + 1]);
    expect(line?.b).toBe(((f?.x ?? 0) + (f?.width ?? 0) + (g?.x ?? 0)) / 2);
    expect(line?.pieces.map((piece) => piece.owner)).toEqual([
      gutters.containerOf[p?.index ?? 0],
      gutters.containerOf[f?.index ?? 0],
      0,
    ]);
    expect(line?.pieces.every((piece) => isPortPiece(piece) && piece.holder === 0)).toBe(true);
    // The target's left port faces the gap from g's side: g's card is first in its row, so it has one too.
    expect(exits.lineOf[1]).toBeGreaterThanOrEqual(gutters.lines.length);
  });

  it('gives no line to a port that something stands beside', () => {
    // Chip `a` has chip `c` to its right in p's row: its right port's stub ends in the gap between them.
    const crowded = scene(
      [
        zone('p', 'project', [
          zone('a', 'project', [], { collapsed: { resources: 2 } }),
          zone('c', 'project', [], { collapsed: { resources: 3 } }),
        ]),
        zone('q', 'project', [card('b')]),
      ],
      [{ from: 'a', to: 'b', kind: 'uses' }],
    );
    const options: LayoutOptions = {
      arrangements: {
        canvas: { cardColumns: 0, zoneRows: [2] },
        zones: { p: { cardColumns: 0, zoneRows: [2] } },
      },
    };
    const tree = placedTree(crowded, options);
    const gutters = buildGutters(tree);
    const { edges } = mergeEdges(crowded, new Map(tree.order.map((node) => [node.id, node] as const)));
    const ports = assignPorts(edges, gutters, DEFAULT_ROUTING);
    const exits = portLines(edges, ports, gutters, DEFAULT_ROUTING, gutters.lines.length);
    expect(ports[0]?.source.side).toBe('right');
    expect(exits.lineOf[0]).toBe(-1);
  });
});

describe('routing along port lines', () => {
  it('leaves a nested chip in one straight run instead of turning along its zones’ padding rings', () => {
    const layout = layoutScene(input, SIDE_BY_SIDE);
    assertLayout(input, layout, SIDE_BY_SIDE);
    const edge = layout.edges['a -uses-> b'];
    const points = edge?.points ?? [];
    const first = points[0] as Point;
    const second = points[1] as Point;
    // The first segment is horizontal and runs out of f (beyond its right border).
    expect(second.y).toBe(first.y);
    const f = layout.rects.f;
    expect(second.x).toBeGreaterThan((f?.x ?? 0) + (f?.width ?? 0));
    expect(points.length - 2).toBeLessThanOrEqual(2);
  });
});
