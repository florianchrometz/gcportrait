// SPDX-License-Identifier: MIT
/**
 * The stepped layout (steps.ts, `layoutSteps`): driven to completion it is `layoutScene`, byte for byte; it
 * yields after normalisation, sizing and packing, every `ROUTE_STEP` edges of a routing pass and after each
 * pass and widening; it throws Scene and option errors from its first step, not before; and two layouts in
 * flight at once do not disturb each other (nothing is shared between generators).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { LayoutInputError } from './errors.js';
import { layoutScene, layoutSteps } from './layout.js';
import { ROUTE_STEP, drain } from './steps.js';
import { arbitraryScene, busyScene, card, scene, zone } from './testing/scenes.js';
import type { Layout, LayoutProgress } from './types.js';

function run(steps: Generator<LayoutProgress, Layout, undefined>): {
  progress: LayoutProgress[];
  layout: Layout;
} {
  const progress: LayoutProgress[] = [];
  for (;;) {
    const next = steps.next();
    if (next.done === true) return { progress, layout: next.value };
    progress.push(next.value);
  }
}

describe('layoutSteps', () => {
  it('computes exactly what layoutScene does (property)', () => {
    fc.assert(
      fc.property(arbitraryScene({ maxNodes: 80, maxEdges: 40 }), (input) => {
        expect(JSON.stringify(run(layoutSteps(input)).layout)).toBe(JSON.stringify(layoutScene(input)));
      }),
      { numRuns: 40, seed: 4242 },
    );
  });

  it('yields after each stage, every ROUTE_STEP edges and after each routing pass', () => {
    const input = busyScene(4, 12, 6); // 288 edges
    const { progress, layout } = run(layoutSteps(input));
    const edges = layout.report.routing.edges;
    expect(edges).toBe(288);
    expect(progress.slice(0, 3)).toEqual([
      { stage: 'normalise', pass: 0, routed: 0, edges: 0 },
      { stage: 'size', pass: 0, routed: 0, edges: 0 },
      { stage: 'pack', pass: 0, routed: 0, edges: 0 },
    ]);
    const firstPass = progress.filter((step) => step.stage === 'route' && step.pass === 1);
    expect(firstPass.map((step) => step.routed)).toEqual([ROUTE_STEP, 2 * ROUTE_STEP, edges]);
    expect(firstPass.every((step) => step.edges === edges)).toBe(true);
    // Every widening round re-packs, then lays the routes again in a pass of its own.
    const passes = layout.report.routing.passes;
    expect(passes).toBeGreaterThanOrEqual(2);
    for (let pass = 2; pass <= passes; pass += 1) {
      const widen = progress.findIndex((step) => step.stage === 'widen' && step.pass === pass);
      expect(widen).toBeGreaterThan(0);
      expect(progress.at(-1)?.stage).toBe('route');
      const route = progress.filter((step) => step.stage === 'route' && step.pass === pass);
      expect(route.at(-1)).toEqual({ stage: 'route', pass, routed: edges, edges });
    }
    expect(progress.filter((step) => step.stage === 'widen')).toHaveLength(passes - 1);
  });

  it('yields only the three placement steps without edges or routing', () => {
    const plain = scene([zone('p', 'project', [card('a'), card('b')])]);
    expect(run(layoutSteps(plain)).progress.map((step) => step.stage)).toEqual(['normalise', 'size', 'pack']);
    const edged = scene(
      [zone('p', 'project', [card('a'), card('b')])],
      [{ from: 'a', to: 'b', kind: 'uses' }],
    );
    expect(run(layoutSteps(edged, { route: false })).progress.map((step) => step.stage)).toEqual([
      'normalise',
      'size',
      'pack',
    ]);
  });

  it('throws Scene and option errors from its first step, not when created', () => {
    const duplicate = scene([card('a'), card('a')]);
    const steps = layoutSteps(duplicate);
    expect(() => steps.next()).toThrow(LayoutInputError);
    const badOption = layoutSteps(scene([card('a')]), { targetAspect: -1 });
    expect(() => badOption.next()).toThrow(LayoutInputError);
  });

  it('runs two layouts interleaved step by step as if each ran alone', () => {
    const a = busyScene(3, 10, 5);
    const b = busyScene(5, 6, 3);
    const stepsA = layoutSteps(a);
    const stepsB = layoutSteps(b);
    let resultA: Layout | undefined;
    let resultB: Layout | undefined;
    while (resultA === undefined || resultB === undefined) {
      if (resultA === undefined) {
        const next = stepsA.next();
        if (next.done === true) resultA = next.value;
      }
      if (resultB === undefined) {
        const next = stepsB.next();
        if (next.done === true) resultB = next.value;
      }
    }
    expect(JSON.stringify(resultA)).toBe(JSON.stringify(layoutScene(a)));
    expect(JSON.stringify(resultB)).toBe(JSON.stringify(layoutScene(b)));
  });

  it('can be dropped at any step (a superseded layout) without affecting the next one', () => {
    const input = busyScene(4, 12, 6);
    const dropped = layoutSteps(input);
    for (let i = 0; i < 5; i += 1) dropped.next();
    expect(JSON.stringify(drain(layoutSteps(input)))).toBe(JSON.stringify(layoutScene(input)));
  });
});
