// SPDX-License-Identifier: Apache-2.0
import { ProjectIndexSchema, type Asset } from '@gcportrait/model';
import { describe, expect, it } from 'vitest';
import { summariseProjects, type ProjectSummary, type UnresolvedProjects } from './project-index.js';
import { clone } from './testing/helpers.js';

const UPDATED = '2026-10-07T00:00:00Z';
const ORG = 'organizations/30000000001';

function project(
  number: string,
  data: unknown,
  name = `//cloudresourcemanager.googleapis.com/projects/${number}`,
): Asset {
  return {
    name,
    assetType: 'cloudresourcemanager.googleapis.com/Project',
    parent: '//cloudresourcemanager.googleapis.com/organizations/30000000001',
    ancestors: [`projects/${number}`, ORG],
    updateTime: UPDATED,
    data,
  };
}

function asset(
  name: string,
  number: string | undefined,
  data: unknown = {},
  assetType = 'compute.googleapis.com/Disk',
): Asset {
  return {
    name,
    assetType,
    ...(number === undefined ? {} : { parent: `//cloudresourcemanager.googleapis.com/projects/${number}` }),
    ancestors: number === undefined ? [ORG] : [`projects/${number}`, ORG],
    updateTime: UPDATED,
    data,
  };
}

const NOTHING_UNRESOLVED: UnresolvedProjects = { numbers: [], ids: [], referencedIds: [], inferred: {} };

/** Summarises and checks that the index is a valid model ProjectIndex (inverse records, valid keys). */
function summarise(assets: readonly Asset[]): ProjectSummary {
  const summary = summariseProjects(assets);
  expect(ProjectIndexSchema.parse(summary.index)).toEqual(summary.index);
  return summary;
}

describe('summariseProjects: the index', () => {
  it('is empty for no assets, and for organisations and folders only', () => {
    const empty = { index: { numberById: {}, idByNumber: {} }, unresolved: NOTHING_UNRESOLVED };
    expect(summarise([])).toEqual(empty);
    expect(
      summarise([
        asset(
          '//cloudresourcemanager.googleapis.com/folders/20000000001',
          undefined,
          {},
          'cloudresourcemanager.googleapis.com/Folder',
        ),
      ]),
    ).toEqual(empty);
  });

  it.each([
    ['the number in the name', project('10000000001', { projectId: 'demo-a' })],
    [
      'the number in the name, which wins over data.projectNumber',
      project('10000000001', { projectId: 'demo-a', projectNumber: '10000000009' }),
    ],
    [
      'data.projectNumber when the name carries no number',
      project(
        '10000000001',
        { projectId: 'demo-a', projectNumber: '10000000001' },
        '//cloudresourcemanager.googleapis.com/projects/demo-a',
      ),
    ],
  ])('pairs a Project asset through %s', (_name, projectAsset) => {
    const { index, unresolved } = summarise([projectAsset]);
    expect(index).toEqual({
      numberById: { 'demo-a': '10000000001' },
      idByNumber: { '10000000001': 'demo-a' },
    });
    expect(unresolved).toEqual(NOTHING_UNRESOLVED);
  });

  it.each([
    ['no data', null],
    ['data that is not an object', 'x'],
    ['no projectId', {}],
    ['a projectId that is not a string', { projectId: 42 }],
    ['a projectId that is not a project id', { projectId: 'Not A Valid Id' }],
    ['a numeric projectId', { projectId: '10000000001' }],
  ])('leaves a Project asset with %s unpaired and reports its number', (_name, data) => {
    const { index, unresolved } = summarise([project('10000000001', data)]);
    expect(index).toEqual({ numberById: {}, idByNumber: {} });
    expect(unresolved).toEqual({ ...NOTHING_UNRESOLVED, numbers: ['10000000001'] });
  });

  it.each([
    ['a number', 10000000001],
    ['a malformed string', '0001'],
  ])('ignores data.projectNumber as %s when the name carries no number', (_name, projectNumber) => {
    const { index, unresolved } = summarise([
      {
        ...project(
          '10000000001',
          { projectId: 'demo-a', projectNumber },
          '//cloudresourcemanager.googleapis.com/projects/demo-a',
        ),
        ancestors: [ORG],
      },
    ]);
    expect(index).toEqual({ numberById: {}, idByNumber: {} });
    expect(unresolved).toEqual({ ...NOTHING_UNRESOLVED, ids: ['demo-a'] });
  });

  it('keeps the first of two conflicting claims, so that the records stay inverse', () => {
    const { index, unresolved } = summarise([
      project('10000000001', { projectId: 'demo-a' }),
      project('10000000001', { projectId: 'demo-b' }),
      project('10000000002', { projectId: 'demo-a' }),
    ]);
    expect(index).toEqual({
      numberById: { 'demo-a': '10000000001' },
      idByNumber: { '10000000001': 'demo-a' },
    });
    expect(unresolved).toEqual({ ...NOTHING_UNRESOLVED, numbers: ['10000000002'], ids: ['demo-b'] });
  });

  it('never pairs from Compute names: a Compute name and its ancestor are only a hint', () => {
    const { index, unresolved } = summarise([
      asset('//compute.googleapis.com/projects/demo-batch-1/zones/europe-west3-a/disks/d1', '10000000005'),
    ]);
    expect(index).toEqual({ numberById: {}, idByNumber: {} });
    expect(unresolved).toEqual({
      numbers: ['10000000005'],
      ids: ['demo-batch-1'],
      referencedIds: [],
      inferred: { '10000000005': 'demo-batch-1' },
    });
  });

  it('accepts legacy domain-scoped project ids', () => {
    const { index } = summarise([project('10000000001', { projectId: 'example.com:demo-a' })]);
    expect(index).toEqual({
      numberById: { 'example.com:demo-a': '10000000001' },
      idByNumber: { '10000000001': 'example.com:demo-a' },
    });
  });

  it('survives structuredClone and JSON unchanged', () => {
    const summary = summarise([
      project('10000000001', { projectId: 'demo-a' }),
      asset('//compute.googleapis.com/projects/demo-b/global/networks/n', '10000000002'),
    ]);
    expect(clone(summary)).toEqual(summary);
    expect(JSON.parse(JSON.stringify(summary))).toEqual(summary);
  });
});

describe('summariseProjects: what stays unresolved', () => {
  it('splits ids of projects in the snapshot from ids that only self-links refer to', () => {
    const data = {
      networkInterfaces: [
        {
          subnetwork:
            'https://www.googleapis.com/compute/v1/projects/demo-host-9/regions/europe-west3/subnetworks/app',
          network: 'https://compute.googleapis.com/compute/beta/projects/demo-host-9/global/networks/core',
        },
      ],
      disks: [
        { licenses: ['https://www.googleapis.com/compute/alpha/projects/demo-images/global/licenses/base'] },
        // A self-link into the asset's own project is not a reference to another project.
        { source: 'https://www.googleapis.com/compute/v1/projects/demo-app-2/zones/z/disks/boot' },
      ],
      legacy: {
        deeper: { network: 'https://www.googleapis.com/compute/v1/projects/10000000007/global/networks/old' },
      },
      relative: 'projects/demo-not-a-self-link/global/networks/x',
      unrelated: 'https://www.googleapis.com/storage/v1/b/demo-bucket',
      count: 3,
      flag: true,
      nothing: null,
    };
    const { unresolved } = summarise([
      asset('//compute.googleapis.com/projects/demo-app-2/zones/z/instances/i', '10000000004', data),
    ]);
    expect(unresolved).toEqual({
      numbers: ['10000000004', '10000000007'],
      ids: ['demo-app-2'],
      referencedIds: ['demo-host-9', 'demo-images'],
      inferred: { '10000000004': 'demo-app-2' },
    });
  });

  it('drops everything the index resolves, references included', () => {
    const host = project('10000000009', { projectId: 'demo-host-9' });
    const instance = asset(
      '//compute.googleapis.com/projects/demo-app-2/zones/z/instances/i',
      '10000000004',
      {
        network: 'https://www.googleapis.com/compute/v1/projects/demo-host-9/global/networks/shared',
      },
    );
    const app = project('10000000004', { projectId: 'demo-app-2' });
    expect(summarise([host, instance, app]).unresolved).toEqual(NOTHING_UNRESOLVED);
  });

  it('records numbers from parents and numeric Compute names, and ids from names without a project ancestor', () => {
    const { index, unresolved } = summarise([
      asset('//pubsub.googleapis.com/projects/demo-queue-1/topics/t', '10000000006'),
      asset('//compute.googleapis.com/projects/10000000008/global/networks/n', undefined),
      asset('//compute.googleapis.com/projects/demo-orphan/global/networks/n', undefined),
      {
        ...asset('//logging.googleapis.com/projects/10000000009/sinks/s', undefined),
        parent: '//cloudresourcemanager.googleapis.com/projects/10000000009',
      },
      {
        ...asset('//logging.googleapis.com/projects/demo-named-parent/sinks/s', undefined),
        parent: '//cloudresourcemanager.googleapis.com/projects/demo-named-parent',
      },
    ]);
    expect(index).toEqual({ numberById: {}, idByNumber: {} });
    expect(unresolved).toEqual({
      numbers: ['10000000006', '10000000008', '10000000009'],
      ids: ['demo-named-parent', 'demo-orphan'],
      referencedIds: [],
      inferred: {},
    });
  });

  it('keeps hints one-to-one, first one wins, drops hints the index contradicts, and sorts them by number', () => {
    const { unresolved } = summarise([
      asset('//compute.googleapis.com/projects/demo-z/global/networks/e', '10000000011'),
      asset('//compute.googleapis.com/projects/demo-x/global/networks/a', '10000000001'),
      asset('//compute.googleapis.com/projects/demo-y/global/networks/b', '10000000001'),
      asset('//compute.googleapis.com/projects/demo-x/global/networks/c', '10000000002'),
      asset('//compute.googleapis.com/projects/demo-paired/global/networks/d', '10000000003'),
      project('10000000004', { projectId: 'demo-paired' }),
    ]);
    expect(unresolved.inferred).toEqual({ '10000000001': 'demo-x', '10000000011': 'demo-z' });
    expect(Object.keys(unresolved.inferred)).toEqual(['10000000001', '10000000011']);
    expect(unresolved.numbers).toEqual(['10000000001', '10000000002', '10000000003', '10000000011']);
    expect(unresolved.ids).toEqual(['demo-x', 'demo-y', 'demo-z']);
  });

  it('ignores a Compute name segment that is no project reference', () => {
    const { unresolved } = summarise([
      asset('//compute.googleapis.com/projects/Bad_Ref/global/networks/n', undefined),
    ]);
    expect(unresolved).toEqual(NOTHING_UNRESOLVED);
  });

  it('reads a Compute name that ends with the project segment', () => {
    const { unresolved } = summarise([asset('//compute.googleapis.com/projects/demo-edge', '10000000010')]);
    expect(unresolved.inferred).toEqual({ '10000000010': 'demo-edge' });
  });
});
