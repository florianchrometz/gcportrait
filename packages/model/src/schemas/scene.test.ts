// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { FOLDER, INSTANCE, NETWORK, PROJECT, sampleScene } from '../testing/fixtures.js';
import { issuePaths, present, withChange } from '../testing/issues.js';
import { SceneNodeSchema, SceneSchema, ZoneKindSchema, type Scene, type SceneZone } from './scene.js';

/** The sample scene, changed; `project` is the project zone inside its folder. */
const sceneWith = (change: (scene: Scene, project: SceneZone) => void): Scene =>
  withChange(sampleScene, (scene) => {
    change(scene, (scene.children[0] as SceneZone).children[0] as SceneZone);
  });

describe('SceneSchema', () => {
  it('accepts a nested scene with a collapsed zone', () => {
    expect(issuePaths(SceneSchema, sampleScene())).toEqual([]);
  });

  it('accepts an empty scene', () => {
    const empty = {
      ...sampleScene(),
      children: [],
      edges: [],
      metadata: { ...sampleScene().metadata, rectCount: 0 },
    };
    expect(issuePaths(SceneSchema, empty)).toEqual([]);
  });

  it('rejects duplicate ids anywhere in the tree', () => {
    const scene = sceneWith((_scene, project) => {
      project.children.push({ ...present(project.children[1]), subtitle: 'again' });
    });
    expect(issuePaths(SceneSchema, { ...scene, metadata: { ...scene.metadata, rectCount: 4 } })).toEqual([
      'children.0.children.0.children.2.id',
    ]);
  });

  it('rejects children inside a collapsed zone', () => {
    const scene = sceneWith((_scene, project) => {
      project.collapsed = { networks: 1 };
    });
    expect(issuePaths(SceneSchema, scene)).toEqual(['children.0.children.0.children']);
  });

  it('rejects edges whose ends are not in the scene, and self-loops', () => {
    const scene = sceneWith((s) => {
      s.edges.push(
        { from: 'nowhere', to: 'elsewhere', kind: 'uses' },
        { from: INSTANCE, to: INSTANCE, kind: 'uses' },
      );
    });
    expect(issuePaths(SceneSchema, scene)).toEqual(['edges.1.from', 'edges.1.to', 'edges.2']);
  });

  it('carries a refused focus or root in its metadata', () => {
    const scene = sceneWith((s) => {
      s.metadata.focusError = { code: 'unknown-project', param: 'project', message: 'No such project.' };
      s.metadata.rootError = { code: 'not-a-container', message: 'Not a container.' };
    });
    expect(issuePaths(SceneSchema, scene)).toEqual([]);
    expect(
      issuePaths(SceneSchema, {
        ...scene,
        metadata: {
          ...scene.metadata,
          focusError: { code: 'lost', message: 'x' },
          rootError: { code: 'unknown-root' },
        },
      }),
    ).toEqual(['metadata.focusError.code', 'metadata.rootError.message']);
  });

  it('rejects a rect count that does not match the tree', () => {
    const scene = sceneWith((s) => {
      s.metadata.rectCount = 3;
    });
    expect(issuePaths(SceneSchema, scene)).toEqual(['metadata.rectCount']);
  });

  it.each([
    ['edges.0.count', (s: Scene) => Object.assign(present(s.edges[0]), { count: 1 })],
    ['edges.0.kind', (s: Scene) => Object.assign(present(s.edges[0]), { kind: 'flows' })],
    ['metadata.lens', (s: Scene) => Object.assign(s.metadata, { lens: 'everything-else' })],
    ['metadata.readTime', (s: Scene) => Object.assign(s.metadata, { readTime: '2026-10-08' })],
    ['children.0.kind', (s: Scene) => Object.assign(present(s.children[0]), { kind: 'organization' })],
    ['children.0.badges.0', (s: Scene) => Object.assign(present(s.children[0]), { badges: [''] })],
  ])('rejects a bad %s', (path, change) => {
    const scene = sampleScene();
    change(scene);
    expect(issuePaths(SceneSchema, scene)).toEqual([path]);
  });
});

describe('SceneNodeSchema', () => {
  const card = {
    type: 'card',
    id: INSTANCE,
    label: 'web-1',
    icon: 'compute_engine',
    product: 'Compute Engine',
    assetType: 'compute.googleapis.com/Instance',
  };

  it.each(ZoneKindSchema.options)('accepts a %s zone', (kind) => {
    expect(
      issuePaths(SceneNodeSchema, {
        type: 'zone',
        id: FOLDER,
        kind,
        label: 'x',
        badges: [],
        children: [card],
      }),
    ).toEqual([]);
  });

  it('accepts a zone with a header icon, and rejects a malformed one', () => {
    const zone = { type: 'zone', id: NETWORK, kind: 'vpc', label: 'core', badges: [], children: [card] };
    expect(issuePaths(SceneNodeSchema, { ...zone, icon: 'virtual_private_cloud' })).toEqual([]);
    expect(issuePaths(SceneNodeSchema, { ...zone, icon: 'Virtual Private Cloud' })).toEqual(['icon']);
  });

  it('accepts zones nested to any depth', () => {
    const deep = (depth: number): unknown =>
      depth === 0
        ? card
        : {
            type: 'zone',
            id: `zone-${String(depth)}`,
            kind: 'group',
            label: 'g',
            badges: [],
            children: [deep(depth - 1)],
          };
    expect(issuePaths(SceneNodeSchema, deep(6))).toEqual([]);
  });

  it.each([
    ['type', { ...card, type: 'edge' }],
    ['icon', { ...card, icon: 'Compute Engine' }],
    ['assetType', { ...card, assetType: 'Instance' }],
    ['', { ...card, children: [] }],
    [
      'collapsed.resources',
      {
        type: 'zone',
        id: NETWORK,
        kind: 'vpc',
        label: 'core',
        badges: [],
        collapsed: { resources: 0 },
        children: [],
      },
    ],
    [
      'collapsed',
      {
        type: 'zone',
        id: PROJECT,
        kind: 'project',
        label: 'p',
        badges: [],
        collapsed: { clusters: 2 },
        children: [],
      },
    ],
    [
      'children.0.label',
      {
        type: 'zone',
        id: PROJECT,
        kind: 'project',
        label: 'p',
        badges: [],
        children: [{ ...card, label: '' }],
      },
    ],
  ])('rejects a bad %s', (path, value) => {
    expect(issuePaths(SceneNodeSchema, value)).toEqual([path]);
  });
});
