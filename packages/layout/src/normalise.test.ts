// SPDX-License-Identifier: Apache-2.0
import type { Scene, SceneNode, SceneZone } from '@gcportrait/model';
import { SceneSchema } from '@gcportrait/model';
import { describe, expect, it } from 'vitest';
import { MAX_SCENE_DEPTH } from './constants.js';
import { LayoutInputError } from './errors.js';
import { normaliseScene } from './normalise.js';
import { thrownBy } from './testing/errors.js';
import { ORGANISATION_ID, card, nestedChain, scene, zone } from './testing/scenes.js';

const thrown = (fn: () => unknown): LayoutInputError => thrownBy(fn, LayoutInputError);

describe('normaliseScene', () => {
  const input = scene([
    card('c-b', 'beta'),
    zone('p2', 'project', [card('x', 'x')], { label: 'b' }),
    zone('p1', 'project', [zone('v', 'vpc', [zone('s', 'subnet', [card('vm', 'vm')])]), card('k', 'k')], {
      label: 'a',
    }),
    zone('f', 'folder', [
      zone('chip', 'project', [], { collapsed: { resources: 3 } }),
      zone('empty', 'project', []),
    ]),
    card('c-a', 'alpha'),
  ]);

  it('accepts a valid Scene (the fixture itself passes SceneSchema)', () => {
    expect(() => SceneSchema.parse(input)).not.toThrow();
  });

  it('computes depth from the canvas (top level = 1), roles and sibling order', () => {
    const { roots, order, droppedOrganisations, edgeCount } = normaliseScene(input);
    expect(roots.map((node) => node.id)).toEqual(['f', 'p1', 'p2', 'c-a', 'c-b']);
    expect(order.map((node) => `${node.id}:${String(node.depth)}:${node.role}`)).toEqual([
      'f:1:zone',
      'chip:2:chip',
      'empty:2:empty',
      'p1:1:zone',
      'v:2:zone',
      's:3:zone',
      'vm:4:card',
      'k:2:card',
      'p2:1:zone',
      'x:2:card',
      'c-a:1:card',
      'c-b:1:card',
    ]);
    expect(order.find((node) => node.id === 'vm')?.parent?.id).toBe('s');
    expect(roots[0]?.parent).toBeNull();
    expect(droppedOrganisations).toEqual([]);
    expect(edgeCount).toBe(0);
  });

  it('does not depend on the order of the children in the Scene', () => {
    const reversed = (nodes: SceneNode[]): SceneNode[] =>
      [...nodes]
        .reverse()
        .map((node) => (node.type === 'zone' ? { ...node, children: reversed(node.children) } : node));
    const ids = (s: Scene): string[] => normaliseScene(s).order.map((node) => node.id);
    expect(ids({ ...input, children: reversed(input.children) })).toEqual(ids(input));
  });

  it('unwraps an organisation zone at the top level: the canvas is the organisation', () => {
    const org = zone(ORGANISATION_ID, 'folder', [zone('f', 'folder', [card('a')]), card('b')]);
    const result = normaliseScene(
      scene([org, card('c')], [{ from: 'b', to: ORGANISATION_ID, kind: 'uses' }]),
    );
    expect(result.droppedOrganisations).toEqual([ORGANISATION_ID]);
    expect(result.roots.map((node) => `${node.id}:${String(node.depth)}`)).toEqual(['f:1', 'b:1', 'c:1']);
    expect(result.order.some((node) => node.id === ORGANISATION_ID)).toBe(false);
    expect(result.edgesAtCanvas).toBe(1);
  });

  it('keeps an organisation-like zone below the top level', () => {
    const nested = zone('f', 'folder', [zone(ORGANISATION_ID, 'folder', [card('a')])]);
    expect(normaliseScene(scene([nested])).order.map((node) => node.id)).toEqual(['f', ORGANISATION_ID, 'a']);
  });

  it('refuses duplicate ids', () => {
    const error = thrown(() => normaliseScene(scene([card('a'), zone('z', 'project', [card('a')])])));
    expect(error.code).toBe('duplicate-id');
    expect(error.ids).toEqual(['a']);
  });

  it('refuses an edge whose end is not in the Scene, naming both ends', () => {
    const error = thrown(() =>
      normaliseScene(scene([card('a')], [{ from: 'a', to: 'ghost', kind: 'uses' }])),
    );
    expect(error.code).toBe('unknown-endpoint');
    expect(error.ids).toEqual(['a', 'ghost']);
    expect(error.message).toContain('ghost');
  });

  it('refuses a tree that contains itself, naming the ids around the cycle', () => {
    const inner: SceneZone = zone('inner', 'vpc', []);
    const outer: SceneZone = zone('outer', 'project', [inner]);
    inner.children.push(outer);
    const cyclic: Scene = { ...scene([]), children: [zone('top', 'folder', [outer])] };
    const error = thrown(() => normaliseScene(cyclic));
    expect(error.code).toBe('cycle');
    expect(error.ids).toEqual(['outer', 'inner', 'outer']);
    expect(error.name).toBe('LayoutInputError');
  });

  it('refuses a collapsed zone that still has children', () => {
    const chip = zone('chip', 'project', [card('a')], { collapsed: { resources: 1 } });
    const error = thrown(() => normaliseScene(scene([chip])));
    expect(error.code).toBe('collapsed-with-children');
    expect(error.ids).toEqual(['chip', 'a']);
  });

  it(`accepts nesting up to MAX_SCENE_DEPTH (${String(MAX_SCENE_DEPTH)}) levels`, () => {
    const { order } = normaliseScene(nestedChain(MAX_SCENE_DEPTH - 1));
    expect(order).toHaveLength(MAX_SCENE_DEPTH);
    expect(order[order.length - 1]?.depth).toBe(MAX_SCENE_DEPTH);
  });

  it('refuses deeper nesting with a typed error naming the top-level node and the node past the limit, even far beyond the call stack', () => {
    const error = thrown(() => normaliseScene(nestedChain(MAX_SCENE_DEPTH)));
    expect(error.code).toBe('too-deep');
    expect(error.ids).toEqual(['z1', 'leaf']);
    expect(error.message).toContain(String(MAX_SCENE_DEPTH));
    const abyss = thrown(() => normaliseScene(nestedChain(20000)));
    expect(abyss.code).toBe('too-deep');
    expect(abyss.ids).toEqual(['z1', `z${String(MAX_SCENE_DEPTH + 1)}`]);
  });
});
