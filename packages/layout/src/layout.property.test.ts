// SPDX-License-Identifier: Apache-2.0
/**
 * Property tests (fast-check) over random Scene trees: depth up to 8, up to 300 nodes, random kinds, chips,
 * empty zones, badges, odd labels and ids, random edges of every head style (between any two nodes: siblings,
 * cousins, a zone and its own descendant, duplicates, reciprocal pairs), sometimes wrapped in an organisation
 * zone. Every layout satisfies the invariants, edges included (no segment through a card, chip, empty zone or
 * header; ports on borders; at least two points; tips where they belong), never needs the fallback router, is
 * deterministic, does not depend on the order of the Scene's children or edges, and keeps pinned arrangements
 * under widened gutters. Wherever the router reports every lane inside its gutter and clear, no two edges (a
 * hub bundle's members count as one) run alongside each other closer than the lane pitch. The packing (routing
 * off) fills its rows: the router's widening keeps the arrangement, so a widened row may have room left for
 * its next child.
 *
 * Every run draws a fresh seed except on CI, where the seed is fixed, and under `FC_SEED`, which replays a
 * failure (test/fast-check-seed.ts); `pnpm --filter @gcportrait/layout explore` runs every property here
 * 1 000 times (`FC_RUNS`).
 */
import { SceneSchema, type Scene, type SceneEdge, type SceneNode } from '@gcportrait/model';
import { propertyRuns } from '@gcportrait/model/testing';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ROUTING } from './constants.js';
import { checkDeterminism, checkLayout } from './invariants.js';
import { layoutScene, layoutSceneWith } from './layout.js';
import { fullRowViolations } from './testing/rows.js';
import { laneSpacing } from './testing/spacing.js';
import { arbitraryScene, card, scene, zone } from './testing/scenes.js';
import type { LayoutOptions } from './types.js';

const RUNS = 120;

function shuffle(nodes: readonly SceneNode[], seed: number): SceneNode[] {
  // A deterministic permutation driven by the generated seed (no Math.random).
  const copy = nodes.map((node) =>
    node.type === 'zone' ? { ...node, children: shuffle(node.children, seed * 31 + 7) } : node,
  );
  let state = seed >>> 0;
  for (let i = copy.length - 1; i > 0; i -= 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const j = state % (i + 1);
    const a = copy[i] as SceneNode;
    copy[i] = copy[j] as SceneNode;
    copy[j] = a;
  }
  return copy;
}

const OPTIONS: fc.Arbitrary<LayoutOptions> = fc.record(
  {
    sizing: fc.record(
      {
        gapHorizontal: fc.integer({ min: 0, max: 40 }),
        gapVertical: fc.integer({ min: 0, max: 40 }),
        zonePadding: fc.integer({ min: 0, max: 30 }),
      },
      { requiredKeys: [] },
    ),
    targetAspect: fc.double({ min: 0.5, max: 4, noNaN: true }),
    rootAspect: fc.double({ min: 0.5, max: 4, noNaN: true }),
    aspectTolerance: fc.double({ min: 0, max: 0.9, noNaN: true }),
  },
  { requiredKeys: [] },
);

describe('fullRowViolations (the property tests’ row checker)', () => {
  const wide = scene([
    zone('p', 'project', [
      card('c1'),
      card('c2'),
      card('c3'),
      zone('a', 'subnet', []),
      zone('b', 'subnet', []),
      zone('z', 'vpc', [card('x')], {
        label: 'a VPC network whose label is long enough to make its zone wide',
      }),
    ]),
  ]);

  it('passes a packed layout', () => {
    expect(fullRowViolations(wide, layoutScene(wide))).toEqual([]);
  });

  it('finds a zone row and a card grid with room left, planted through pinned arrangements', () => {
    const planted = layoutScene(wide, {
      arrangements: { zones: { p: { cardColumns: 1, zoneRows: [1, 1, 1] } } },
    });
    // Row 0 holds the wide VPC alone and the box is exactly as wide, so it is full; rows 1 and 2 hold one
    // subnet each, although two fit side by side; the three cards stack although two columns fit.
    expect(fullRowViolations(wide, planted).map((v) => [v.container, v.message])).toEqual([
      ['p', 'zone row 1 has room for the next zone'],
      ['p', 'the card grid has room for column 2'],
    ]);
  });
});

describe('layoutScene over random Scenes', () => {
  it('generates valid Scenes', () => {
    fc.assert(
      fc.property(arbitraryScene(), (scene) => {
        expect(() => SceneSchema.parse(scene)).not.toThrow();
      }),
      { numRuns: propertyRuns(60) },
    );
  });

  it('always satisfies the invariants', () => {
    fc.assert(
      fc.property(arbitraryScene(), (scene) => {
        expect(checkLayout(scene, layoutScene(scene))).toEqual([]);
      }),
      { numRuns: propertyRuns(RUNS) },
    );
  });

  it('fills every row: no row but the last has room for the next child (packing rule 1)', () => {
    fc.assert(
      fc.property(arbitraryScene(), (scene) => {
        expect(fullRowViolations(scene, layoutScene(scene, { route: false }))).toEqual([]);
      }),
      { numRuns: propertyRuns(RUNS) },
    );
  });

  it('keeps pinned arrangements under random gutters, and pinning its own arrangements changes nothing', () => {
    fc.assert(
      fc.property(
        arbitraryScene({ maxNodes: 120 }),
        fc.record({ horizontal: fc.nat(40), vertical: fc.nat(40), ring: fc.nat(20) }),
        (scene, widening) => {
          const first = layoutScene(scene);
          expect(JSON.stringify(layoutScene(scene, { arrangements: first.arrangements }))).toBe(
            JSON.stringify(first),
          );
          const ids = Object.keys(first.arrangements.zones);
          const options: LayoutOptions = {
            gutters: { canvas: widening, zones: Object.fromEntries(ids.map((id) => [id, widening])) },
            arrangements: first.arrangements,
          };
          const repacked = layoutScene(scene, options);
          expect(repacked.arrangements).toEqual(first.arrangements);
          expect(checkLayout(scene, repacked, options)).toEqual([]);
        },
      ),
      { numRuns: propertyRuns(60) },
    );
  });

  it('satisfies the invariants under random sizing, gutters and aspect targets', () => {
    fc.assert(
      fc.property(
        arbitraryScene({ maxNodes: 120 }),
        OPTIONS,
        fc.record({ horizontal: fc.nat(30), vertical: fc.nat(30), ring: fc.nat(30) }),
        (scene, options, widening) => {
          const ids = Object.keys(layoutScene(scene).rects);
          const withGutters: LayoutOptions = {
            ...options,
            gutters: {
              canvas: widening,
              zones: Object.fromEntries(ids.filter((_, i) => i % 3 === 0).map((id) => [id, widening])),
            },
          };
          const result = layoutScene(scene, withGutters);
          expect(checkLayout(scene, result, withGutters)).toEqual([]);
          const packed = layoutScene(scene, { ...withGutters, route: false });
          expect(fullRowViolations(scene, packed, withGutters)).toEqual([]);
        },
      ),
      { numRuns: propertyRuns(60) },
    );
  });

  it('is deterministic and independent of the order of the children and edges', () => {
    fc.assert(
      fc.property(arbitraryScene({ maxNodes: 150 }), fc.nat(), (scene, seed) => {
        expect(checkDeterminism(scene)).toEqual([]);
        const edges = [...scene.edges];
        let state = seed >>> 0;
        for (let i = edges.length - 1; i > 0; i -= 1) {
          state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
          const j = state % (i + 1);
          [edges[i], edges[j]] = [edges[j] as SceneEdge, edges[i] as SceneEdge];
        }
        const shuffled: Scene = { ...scene, children: shuffle(scene.children, seed), edges };
        expect(JSON.stringify(layoutScene(shuffled))).toBe(JSON.stringify(layoutScene(scene)));
      }),
      { numRuns: propertyRuns(60) },
    );
  });
});

const ROUTING: fc.Arbitrary<LayoutOptions> = fc.record(
  {
    routing: fc.record(
      {
        lanePitch: fc.integer({ min: 1, max: 16 }),
        gutterBase: fc.integer({ min: 0, max: 16 }),
        bendCost: fc.integer({ min: 0, max: 200 }),
        laneCost: fc.integer({ min: 0, max: 1000 }),
        portSpacing: fc.integer({ min: 1, max: 30 }),
        portClearance: fc.integer({ min: 0, max: 20 }),
        // As often above 20 as up to it: up to 300, longer than most zones' left and right sides below their
        // headers (44 px and up) and than half their bottoms, which then keep their middle.
        zonePortClearance: fc.oneof(fc.integer({ min: 0, max: 20 }), fc.integer({ min: 21, max: 300 })),
        arrowInset: fc.integer({ min: 0, max: 6 }),
        wideningRounds: fc.integer({ min: 0, max: 3 }),
        bundleMin: fc.integer({ min: 2, max: 12 }),
      },
      { requiredKeys: [] },
    ),
    // Without padding a zone's ring lies on its border, and without gaps so do the gutters beside it: half of
    // the draws are 0, a corner a uniform draw from 0 to 40 seldom reaches for all three at once.
    sizing: fc.record(
      {
        gapHorizontal: fc.oneof(fc.constant(0), fc.integer({ min: 0, max: 40 })),
        gapVertical: fc.oneof(fc.constant(0), fc.integer({ min: 0, max: 40 })),
        zonePadding: fc.oneof(fc.constant(0), fc.integer({ min: 0, max: 30 })),
      },
      { requiredKeys: [] },
    ),
  },
  { requiredKeys: [] },
);

describe('routing over random Scenes', () => {
  it('keeps every edge out of cards, chips, empty zones and headers, with ports on borders, many edges', () => {
    fc.assert(
      fc.property(arbitraryScene({ maxNodes: 120, maxEdges: 200, denseEdges: true }), (scene) => {
        const layout = layoutScene(scene);
        expect(checkLayout(scene, layout)).toEqual([]);
        expect(layout.report.routing.fallbacks).toBe(0);
      }),
      { numRuns: propertyRuns(80) },
    );
  });

  it('keeps edges a lane pitch apart wherever they run alongside each other (a bundle’s members share)', () => {
    let checked = 0;
    fc.assert(
      fc.property(arbitraryScene({ maxNodes: 120, maxEdges: 200, denseEdges: true }), (scene) => {
        const layout = layoutScene(scene);
        const { squeezed, overlaps, fallbacks, edges } = layout.report.routing;
        // Only where the router reports every lane fitting its gutter and clear of the others.
        fc.pre(edges > 0 && squeezed === 0 && overlaps === 0 && fallbacks === 0);
        checked += 1;
        const spacing = laneSpacing(layout);
        expect(spacing.overlaps, spacing.examples.join('; ')).toBe(0);
        expect(spacing.closest).toBeGreaterThanOrEqual(DEFAULT_ROUTING.lanePitch);
        expect(spacing.closestStubs).toBeGreaterThanOrEqual(DEFAULT_ROUTING.portSpacing / 2);
      }),
      { numRuns: propertyRuns(80) },
    );
    expect(checked).toBeGreaterThan(40);
  });

  it('keeps the invariants under random routing constants and sizing', () => {
    fc.assert(
      fc.property(
        arbitraryScene({ maxNodes: 100, maxEdges: 80, denseEdges: true }),
        ROUTING,
        (scene, options) => {
          const layout = layoutScene(scene, options);
          expect(checkLayout(scene, layout, options)).toEqual([]);
          expect(layout.report.routing.fallbacks).toBe(0);
        },
      ),
      { numRuns: propertyRuns(80) },
    );
  });

  it('keeps the invariants in single-pass mode', () => {
    fc.assert(
      fc.property(arbitraryScene({ maxNodes: 120, maxEdges: 120, denseEdges: true }), (scene) => {
        const options: LayoutOptions = { routing: { singlePassWork: 0 } };
        const layout = layoutScene(scene, options);
        expect(checkLayout(scene, layout, options)).toEqual([]);
        if (layout.report.routing.edges > 0) expect(layout.report.routing.mode).toBe('single-pass');
        expect(layout.report.routing.wideningRounds).toBe(0);
      }),
      { numRuns: propertyRuns(40) },
    );
  });

  it('keeps the invariants when every edge goes through the coarse-grid fallback', () => {
    fc.assert(
      fc.property(arbitraryScene({ maxNodes: 40, maxEdges: 12, maxDepth: 4, denseEdges: true }), (scene) => {
        const layout = layoutSceneWith(scene, {}, { network: false });
        const routed = Object.values(layout.edges);
        expect(routed.every((edge) => edge.fallback)).toBe(true);
        // A grid route can only fail where no 8 px corridor exists, which the default sizing never leaves.
        expect(layout.report.routing.failed).toBe(0);
        expect(checkLayout(scene, layout)).toEqual([]);
      }),
      { numRuns: propertyRuns(25) },
    );
  });
});
