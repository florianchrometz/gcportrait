// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { DEFAULT_ROUTING } from './constants.js';
import { mergeEdges } from './edges.js';
import { buildGutters, type GutterLine } from './gutters.js';
import { assertLayout, checkLayout } from './invariants.js';
import { layoutScene, placedTree } from './layout.js';
import { buildNetwork } from './network.js';
import { assignPorts } from './ports.js';
import { isPortPiece, portLines } from './portlines.js';
import { runEnds, type Span } from './route.js';
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

// Folder f, flush against the empty folder g, holds cards a and b above c and d, and a chip and a sub-folder
// below them; f's edge to its own card b leaves f's right side on the inside. With no padding, no gaps and no
// lane cost, b's way out to the right, from f's ring to the gap beside f, lies on f's border.
const FLUSH_FOLDER = scene(
  [
    zone('f', 'folder', [
      zone('sub', 'folder', [
        card('w'),
        card('wide', 'wide card, its label long enough for the widest card'),
      ]),
      card('c'),
      zone('chip', 'folder', [], { collapsed: { resources: 7 } }),
      card('d'),
      card('a'),
      card('b'),
    ]),
    zone('g', 'folder', []),
  ],
  [
    { from: 'c', to: 'b', kind: 'uses' },
    { from: 'chip', to: 'a', kind: 'uses' },
    { from: 'd', to: 'a', kind: 'uses' },
    { from: 'f', to: 'b', kind: 'uses' },
  ],
);
const NO_GAPS: LayoutOptions = {
  sizing: { gapHorizontal: 0, gapVertical: 0, zonePadding: 0 },
  routing: { lanePitch: 12, laneCost: 0, wideningRounds: 0 },
};

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

  it('gives no line to a port whose way out has no length: no padding, and no gap beside its zone', () => {
    // Card `b` is the last of its row in f: its right port's stub meets f's ring, which without padding lies
    // on f's border, as the gap between f and g does without a gap.
    const flush = scene(
      [zone('f', 'folder', [card('a'), card('b')]), zone('g', 'folder', [])],
      [{ from: 'b', to: 'g', kind: 'uses' }],
    );
    const exitOf = (sizing: LayoutOptions['sizing']) => {
      const options: LayoutOptions = {
        ...(sizing === undefined ? {} : { sizing }),
        arrangements: {
          canvas: { cardColumns: 0, zoneRows: [2] },
          zones: { f: { cardColumns: 2, zoneRows: [] } },
        },
      };
      const tree = placedTree(flush, options);
      const gutters = buildGutters(tree);
      const { edges } = mergeEdges(flush, new Map(tree.order.map((node) => [node.id, node] as const)));
      const ports = assignPorts(edges, gutters, DEFAULT_ROUTING);
      const exits = portLines(edges, ports, gutters, DEFAULT_ROUTING, gutters.lines.length);
      expect(ports[0]?.source.side).toBe('right');
      // Port lines are numbered after the gutter lines.
      return exits.lines[(exits.lineOf[0] ?? -1) - gutters.lines.length];
    };
    expect(exitOf({ zonePadding: 0, gapHorizontal: 0 })).toBeUndefined();
    // Padding or a gap gives the way out a length.
    for (const sizing of [
      { zonePadding: 2, gapHorizontal: 0 },
      { zonePadding: 0, gapHorizontal: 2 },
      undefined,
    ]) {
      const line = exitOf(sizing);
      expect((line?.b ?? 0) - (line?.a ?? 0)).toBeGreaterThan(0);
    }
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

  it('keeps a route out of a header where a port’s way out has no length (no padding, no gaps, no pressure)', () => {
    // b's right port has no port line (FLUSH_FOLDER): the route runs up f's border to b's stub.
    const layout = layoutScene(FLUSH_FOLDER, NO_GAPS);
    expect(checkLayout(FLUSH_FOLDER, layout, NO_GAPS)).toEqual([]);
    const f = layout.rects.f;
    const edge = layout.edges['f -uses-> b'];
    if (f === undefined || edge === undefined) throw new Error('f or its edge is missing');
    expect(edge.source).toMatchObject({ side: 'right', x: f.x + f.width });
    for (const point of edge.points) expect(point.y).toBeGreaterThanOrEqual(f.y + f.headerHeight);
    // The route reaches b along f's border and its stub runs straight in from there, at the port's height.
    expect(edge.points.slice(-2).map((point) => point.y)).toEqual([edge.target.y, edge.target.y]);
  });
});

describe('runEnds on a line of no length', () => {
  /**
   * FLUSH_FOLDER's routing graph with a horizontal line of no length at b's right port, on f's border where
   * f's ring and the gap beside f lie: b's port line, `owned` by the edge f -uses-> b, or else a line that
   * is no port line. It has a single node, where b's stub meets f's ring, so a run along it covers no
   * segment. The spans are a route of that edge: up f's ring from f's port to b's stub, then turning onto
   * that line there.
   */
  function routeOntoNoLength(owned: boolean) {
    const tree = placedTree(FLUSH_FOLDER, NO_GAPS);
    const gutters = buildGutters(tree);
    const nodes = new Map(tree.order.map((node) => [node.id, node] as const));
    const { edges } = mergeEdges(FLUSH_FOLDER, nodes);
    const routing = { ...DEFAULT_ROUTING, ...NO_GAPS.routing };
    const ports = assignPorts(edges, gutters, routing);
    const exits = portLines(edges, ports, gutters, routing, gutters.lines.length);
    const edge = edges.findIndex((drawn) => drawn.id === 'f -uses-> b');
    const own = ports[edge];
    const ring = gutters.lines[own?.target.line ?? -1];
    const b = nodes.get('b');
    if (own === undefined || ring === undefined || b === undefined) throw new Error('f -uses-> b is missing');
    // f's port and b's stub are both on f's ring, the vertical line on f's right border.
    expect(own.source.line).toBe(own.target.line);
    expect(exits.lineOf[edge * 2 + 1]).toBe(-1);
    const strip = 2 * routing.gutterBase;
    const span = { a: ring.c, b: ring.c, owner: gutters.parentOf[b.index] ?? 0, strip };
    const piece: GutterLine['pieces'][number] = owned
      ? { ...span, gap: { kind: 'port', key: `${String(edge)}.1` }, holder: own.holder }
      : { ...span, gap: { kind: 'row', index: 0 } };
    const lines: GutterLine[] = [
      ...gutters.lines,
      ...exits.lines,
      { horizontal: true, c: own.target.y, a: ring.c, b: ring.c, strip, pieces: [piece] },
    ];
    const line = lines.length - 1;
    const { network, attached } = buildNetwork(
      lines,
      ports.flatMap(({ source, target }) => [
        { line: source.line, t: source.t },
        { line: target.line, t: target.t },
      ]),
      routing.laneCost,
    );
    expect((network.start[line + 1] ?? 0) - (network.start[line] ?? 0)).toBe(1);
    const from = attached[edge * 2] ?? -1;
    const to = attached[edge * 2 + 1] ?? -1;
    const spans: Span[] = [
      { line: own.target.line, from: network.pos[from * 2 + 1] ?? -1, to: network.pos[to * 2 + 1] ?? -1 },
      { line, from: network.pos[to * 2] ?? -1, to: network.pos[to * 2] ?? -1 },
    ];
    return { network, spans, ports: own, edge };
  }

  /** The same route the other way round: from b's port onto the line, then down f's ring to f's port. */
  function reversed({ network, spans, ports, edge }: ReturnType<typeof routeOntoNoLength>) {
    const back = [...spans].reverse().map(({ line, from, to }) => ({ line, from: to, to: from }));
    return runEnds(network, back, { ...ports, source: ports.target, target: ports.source }, edge);
  }

  it('knows a run along its own port line for a port run where it covers no segment', () => {
    const route = routeOntoNoLength(true);
    const { source, target } = route.ports;
    // The run along the port line is held on lane 0 and ends at b's port: the stub is part of it.
    expect(runEnds(route.network, route.spans, route.ports, route.edge)).toEqual({
      portRun: [false, true],
      startsAtPort: false,
      endsAtPort: true,
      start: source.y,
      end: [target.y, target.x],
    });
    expect(reversed(route)).toMatchObject({ portRun: [true, false], startsAtPort: true, start: target.x });
  });

  it('starts and ends a run across a port’s gutter line at the port’s coordinate along its own line', () => {
    const route = routeOntoNoLength(false);
    const { source, target } = route.ports;
    // Along a horizontal line that is b's port's x, where the route's points turn into its stub; t is a y.
    expect(target.t).toBe(target.y);
    expect(target.x).not.toBe(target.y);
    expect(runEnds(route.network, route.spans, route.ports, route.edge)).toEqual({
      portRun: [false, false],
      startsAtPort: false,
      endsAtPort: false,
      start: source.y,
      end: [target.y, target.x],
    });
    expect(reversed(route)).toMatchObject({ portRun: [false, false], startsAtPort: false, start: target.x });
  });
});
