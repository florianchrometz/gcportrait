// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import type { EdgePath, Layout, LayoutRect, Point } from '../types.js';
import { overshootOf, routeQuality } from './quality.js';

function rect(
  x: number,
  y: number,
  width: number,
  height: number,
  role: LayoutRect['role'] = 'card',
): LayoutRect {
  return {
    x,
    y,
    width,
    height,
    parent: null,
    role,
    kind: role === 'card' ? 'card' : 'folder',
    depth: 1,
    headerHeight: role === 'zone' ? 40 : 0,
    padding: role === 'zone' ? 16 : 0,
    collapsed: false,
  };
}

function edge(points: Point[], bundle?: string): EdgePath {
  const first = points[0] as Point;
  const last = points[points.length - 1] as Point;
  return {
    from: 'a',
    to: 'b',
    kind: 'uses',
    count: 1,
    merged: false,
    heads: 'end',
    source: { ...first, side: 'right' },
    target: { ...last, side: 'left' },
    points,
    elbowRadius: 6,
    fallback: false,
    ...(bundle === undefined ? {} : { bundle: { id: bundle, end: 'target', size: 2 } }),
  };
}

function edgeOf(layout: Layout, id: string): EdgePath {
  const found = layout.edges[id];
  if (found === undefined) throw new Error(`no edge ${id}`);
  return found;
}

function layoutOf(rects: Record<string, LayoutRect>, edges: Record<string, EdgePath>): Layout {
  return {
    rects,
    edges,
    chips: [],
    bounds: { x: 0, y: 0, width: 1000, height: 1000 },
    arrangements: { canvas: { cardColumns: 0, zoneRows: [] }, zones: {} },
    gutters: {},
    report: {
      counts: {
        rects: 0,
        zones: 0,
        chips: 0,
        emptyZones: 0,
        cards: 0,
        edges: 0,
        maxDepth: 0,
        organisationZonesDropped: 0,
        truncatedLabels: 0,
        cappedTitles: 0,
        headerWidened: 0,
      },
      routing: {
        mode: 'none',
        passes: 0,
        edges: 0,
        holders: 0,
        work: 0,
        duplicatesMerged: 0,
        reciprocalMerged: 0,
        bundles: 0,
        bundledEdges: 0,
        dropped: 0,
        fallbacks: 0,
        failed: 0,
        bends: [],
        maxLanes: 0,
        widened: 0,
        wideningRounds: 0,
        squeezed: 0,
        overlaps: 0,
      },
      warnings: [],
    },
  };
}

describe('routeQuality', () => {
  it('measures length and bends, counting a bundle’s coinciding trunk once', () => {
    const quality = routeQuality(
      layoutOf(
        {},
        {
          one: edge(
            [
              { x: 100, y: 100 },
              { x: 300, y: 100 },
              { x: 300, y: 300 },
            ],
            'hub',
          ),
          two: edge(
            [
              { x: 200, y: 100 },
              { x: 300, y: 100 },
              { x: 300, y: 300 },
            ],
            'hub',
          ),
        },
      ),
    );
    expect(quality).toMatchObject({ edges: 2, length: 400, bends: 2, crossings: 0, detours: 0 });
  });

  it('counts running along the canvas margin and along a single border as hugging, not running between two boxes', () => {
    const rects = {
      top: rect(100, 100, 300, 44),
      bottom: rect(100, 164, 300, 44),
      lone: rect(500, 100, 200, 44),
    };
    const layout = layoutOf(rects, {
      margin: edge([
        { x: 50, y: 10 },
        { x: 950, y: 10 },
      ]),
      between: edge([
        { x: 100, y: 154 },
        { x: 400, y: 154 },
      ]),
      along: edge([
        { x: 500, y: 154 },
        { x: 700, y: 154 },
      ]),
    });
    // The margin is 24 wide; a segment 10 below a lone card's border with nothing below it hugs that border
    // (within HUG_DISTANCE, 20 px).
    expect(routeQuality(layout).hugging).toBe(900 + 200);
  });

  it('measures the length in the canvas margin, outside the box around the top-level rects, and its edges', () => {
    const rects = { left: rect(100, 100, 300, 200, 'zone'), right: rect(500, 100, 300, 600, 'zone') };
    const layout = layoutOf(rects, {
      // Down the gap between the two zones: inside the box.
      gap: edge([
        { x: 450, y: 150 },
        { x: 450, y: 650 },
      ]),
      // Down past the box's bottom (700) into the margin, across and back up: 2 × 40 + 100 outside.
      uturn: edge([
        { x: 450, y: 600 },
        { x: 450, y: 740 },
        { x: 350, y: 740 },
        { x: 350, y: 320 },
      ]),
      // Along the left margin, wholly outside.
      side: edge([
        { x: 50, y: 150 },
        { x: 50, y: 250 },
      ]),
    });
    expect(routeQuality(layout)).toMatchObject({ margin: 180 + 100, marginEdges: 2 });
    expect(routeQuality(layoutOf({}, layout.edges))).toMatchObject({ margin: 0, marginEdges: 0 });
  });

  it('counts crossings between different holders and long detours', () => {
    const layout = layoutOf(
      {},
      {
        h: edge([
          { x: 0, y: 500 },
          { x: 1000, y: 500 },
        ]),
        v: edge([
          { x: 500, y: 0 },
          { x: 500, y: 1000 },
        ]),
        detour: edge([
          { x: 100, y: 700 },
          { x: 100, y: 990 },
          { x: 200, y: 990 },
          { x: 200, y: 700 },
        ]),
      },
    );
    const quality = routeQuality(layout);
    expect(quality.crossings).toBe(1);
    expect(quality.detours).toBe(1);
    expect(quality.worstDetour).toBe(6.8);
  });

  it('measures how far a route runs past both of its ends, which the detour ratio misses when they are far apart', () => {
    const layout = layoutOf(
      {},
      {
        // 9 000 px apart; the route drops 2 200 px below both ends and climbs back: a ratio of only 1.49.
        uturn: edge([
          { x: 9500, y: 500 },
          { x: 9500, y: 2700 },
          { x: 500, y: 2700 },
          { x: 500, y: 500 },
        ]),
        // Within the box around its ends.
        straight: edge([
          { x: 0, y: 0 },
          { x: 0, y: 300 },
          { x: 400, y: 300 },
        ]),
        // 600 px past its target, under OVERSHOOT_LIMIT (1 000 px): measured, not counted.
        short: edge([
          { x: 0, y: 3000 },
          { x: 1600, y: 3000 },
          { x: 1600, y: 3200 },
          { x: 1000, y: 3200 },
        ]),
      },
    );
    expect(overshootOf(edgeOf(layout, 'straight'))).toBe(0);
    expect(overshootOf(edgeOf(layout, 'short'))).toBe(600);
    expect(routeQuality(layout)).toMatchObject({ detours: 0, overshoots: 1, worstOvershoot: 2200 });
  });
});
