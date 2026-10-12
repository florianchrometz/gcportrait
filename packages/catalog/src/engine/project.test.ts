// SPDX-License-Identifier: MIT
import type { Asset } from '@gcportrait/model';
import { describe, expect, it } from 'vitest';
import { asset, PROJECTS, RUN_SERVICE } from '../testing/assets.js';
import { assetProject, EMPTY_PROJECT_INDEX, projectSegment, resolveProject } from './project.js';

describe('resolveProject', () => {
  it.each([
    ['10000000002', { id: 'demo-app-1', number: '10000000002' }],
    ['projects/10000000002', { id: 'demo-app-1', number: '10000000002' }],
    ['demo-app-1', { id: 'demo-app-1', number: '10000000002' }],
    ['10000000099', { number: '10000000099' }],
    ['demo-unknown-1', { id: 'demo-unknown-1' }],
    ['Bad Project', {}],
  ])('%s', (ref, expected) => {
    expect(resolveProject(ref, PROJECTS)).toEqual(expected);
  });
});

describe('assetProject', () => {
  it('uses the ancestors and the name, completed through the index', () => {
    expect(assetProject(RUN_SERVICE, PROJECTS)).toEqual({ id: 'demo-app-1', number: '10000000002' });
    expect(assetProject(RUN_SERVICE, EMPTY_PROJECT_INDEX)).toEqual({
      id: 'demo-app-1',
      number: '10000000002',
    });
  });

  it('falls back to the name when there is no project ancestor', () => {
    const orphan = asset(
      '//spanner.googleapis.com/projects/demo-data-1/instances/ledger',
      'spanner.googleapis.com/Instance',
      {},
      {
        ancestors: [],
      },
    );
    expect(assetProject(orphan, PROJECTS)).toEqual({ id: 'demo-data-1', number: '10000000003' });
  });

  it('knows no project for organisation-level assets', () => {
    const folder: Asset = {
      name: '//cloudresourcemanager.googleapis.com/folders/20000000001',
      assetType: 'cloudresourcemanager.googleapis.com/Folder',
      ancestors: ['folders/20000000001', 'organizations/30000000001'],
      updateTime: '2026-10-01T08:00:00Z',
      data: {},
    };
    expect(assetProject(folder, PROJECTS)).toEqual({});
  });

  it('finds the projects segment of a name', () => {
    expect(projectSegment('//x.googleapis.com/projects/p/locations/l')).toBe('p');
    expect(projectSegment('projects/p')).toBe('p');
    expect(projectSegment('//x.googleapis.com/folders/1')).toBeUndefined();
  });
});
