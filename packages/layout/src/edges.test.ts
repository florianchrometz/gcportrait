// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import type { SceneEdge, SceneNode } from '@gcportrait/model';
import { edgeId, headsOf, isSymmetric, mergeEdges } from './edges.js';
import { normaliseScene } from './normalise.js';
import { layoutNode } from './testing/nodes.js';
import { ORGANISATION_ID, card, scene, zone } from './testing/scenes.js';

function merged(edges: SceneEdge[], children: SceneNode[] = [card('a'), card('b'), card('c')]) {
  const input = scene(children, edges);
  const normalised = normaliseScene(input);
  return mergeEdges(input, new Map(normalised.order.map((node) => [node.id, node])));
}

describe('mergeEdges', () => {
  it('keeps one edge per (from, to, kind), summing counts, in code-point order', () => {
    const result = merged([
      { from: 'b', to: 'c', kind: 'uses' },
      { from: 'a', to: 'b', kind: 'uses', count: 3 },
      { from: 'a', to: 'b', kind: 'uses' },
      { from: 'a', to: 'b', kind: 'routes' },
    ]);
    expect(result.edges.map((edge) => [edge.id, edge.count, edge.merged])).toEqual([
      ['a -routes-> b', 1, false],
      ['a -uses-> b', 4, true],
      ['b -uses-> c', 1, false],
    ]);
    expect(result.duplicatesMerged).toBe(1);
    expect(result.reciprocalMerged).toBe(0);
    expect(result.dropped).toBe(0);
  });

  it('turns reciprocal peers into one double-headed edge with ordered ends', () => {
    const result = merged([
      { from: 'b', to: 'a', kind: 'peers' },
      { from: 'a', to: 'b', kind: 'peers' },
      { from: 'c', to: 'a', kind: 'peers' },
    ]);
    expect(result.edges.map((edge) => [edge.id, edge.heads, edge.count, edge.merged])).toEqual([
      ['a -peers-> b', 'both', 2, true],
      ['a -peers-> c', 'both', 1, false],
    ]);
    expect(result.reciprocalMerged).toBe(1);
    expect(result.duplicatesMerged).toBe(1);
  });

  it('keeps the Scene’s merged flag (ends re-targeted to a chip by the Scene builder)', () => {
    const result = merged([{ from: 'a', to: 'b', kind: 'uses', count: 2, merged: true }]);
    expect(result.edges[0]).toMatchObject({ count: 2, merged: true });
  });

  it('drops edges that end at a dropped organisation zone and edges from a node to itself', () => {
    const result = merged(
      [
        { from: 'a', to: ORGANISATION_ID, kind: 'uses' },
        { from: 'a', to: 'a', kind: 'uses' },
        { from: 'a', to: 'b', kind: 'uses' },
      ],
      [zone(ORGANISATION_ID, 'folder', [card('a'), card('b')])],
    );
    expect(result.edges.map((edge) => edge.id)).toEqual(['a -uses-> b']);
    expect(result.dropped).toBe(2);
  });

  it('re-targets an end inside a collapsed zone to the outermost chip and drops edges inside one chip', () => {
    // A valid Scene has nothing inside a chip (the Scene builder re-targets first), so build the nodes by hand.
    const outer = layoutNode({ id: 'outer', role: 'chip' });
    const inner = layoutNode({ id: 'inner', role: 'chip', parent: outer });
    const deep = layoutNode({ id: 'deep', parent: inner });
    const other = layoutNode({ id: 'other', parent: inner });
    const loose = layoutNode({ id: 'loose' });
    const nodes = new Map([outer, inner, deep, other, loose].map((n) => [n.id, n]));
    const result = mergeEdges(
      scene(
        [],
        [
          { from: 'deep', to: 'loose', kind: 'uses' },
          { from: 'inner', to: 'loose', kind: 'uses' },
          { from: 'deep', to: 'other', kind: 'uses' },
        ],
      ),
      nodes,
    );
    expect(result.edges.map((edge) => [edge.id, edge.count, edge.merged])).toEqual([
      ['outer -uses-> loose', 2, true],
    ]);
    expect(result.dropped).toBe(1);
  });
});

describe('edge kinds', () => {
  it('reads heads and symmetry from the model’s relation table', () => {
    expect(headsOf('uses')).toBe('end');
    expect(headsOf('peers')).toBe('both');
    expect(headsOf('connects')).toBe('none');
    expect(headsOf('shares')).toBe('end');
    expect(isSymmetric('peers')).toBe(true);
    expect(isSymmetric('connects')).toBe(false);
    expect(edgeId('a', 'uses', 'b')).toBe('a -uses-> b');
  });
});
