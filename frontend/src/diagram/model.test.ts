// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';

import { ancestorChain, solidIds } from './model';
import { denseScene, modelOf, smallScene } from './testing/scenes';
import { DIM_THRESHOLD } from './theme/styles';

describe('buildDiagramModel', () => {
  const model = modelOf(
    smallScene([
      ['run/api', 'run/web', 'uses'],
      ['run/jobs', 'pools/default', 'routes'],
      ['run/web', 'projects/data', 'triggers'],
      ['clusters/gke', 'networks/vpc', 'secures'],
    ]),
  );

  it('keeps the rects in paint order with their parents and children', () => {
    expect(model.rects[0]?.[0]).toBe('folders/1');
    expect(model.parent.get('run/api')).toBe('subnets/a');
    expect(model.parent.get('folders/1')).toBeNull();
    expect(model.children.get('projects/web')).toEqual(['networks/vpc', 'clusters/gke', 'run/jobs']);
  });

  it('splits secures edges off as overlays and indexes the lines by their ends', () => {
    expect(model.overlayEdges.map((edge) => edge.path.kind)).toEqual(['secures']);
    expect(model.lines.map((edge) => edge.path.kind).sort()).toEqual(['routes', 'triggers', 'uses']);
    expect(model.edgesAt.get('run/web')?.length).toBe(2);
    expect(model.dim).toBe(false);
  });

  it('walks the ancestor chain, innermost first', () => {
    expect(ancestorChain(model, 'run/api')).toEqual([
      'run/api',
      'subnets/a',
      'networks/vpc',
      'projects/web',
      'folders/1',
    ]);
    expect(ancestorChain(model, 'nowhere')).toEqual([]);
  });

  it('lists the solid nodes (cards, chips, card-sized zones) for the tab stop', () => {
    expect(solidIds(model)).toContain('projects/data');
    expect(solidIds(model)).not.toContain('projects/web');
  });

  it(`dims above ${String(DIM_THRESHOLD)} drawn lines (skill §5)`, () => {
    expect(modelOf(denseScene(DIM_THRESHOLD)).dim).toBe(false);
    expect(modelOf(denseScene(DIM_THRESHOLD + 1)).dim).toBe(true);
  });
});
