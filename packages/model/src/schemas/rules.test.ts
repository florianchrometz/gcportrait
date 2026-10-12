// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { issuePaths } from '../testing/issues.js';
import type { Asset } from './asset.js';
import {
  AliasKeySchema,
  EvaluatedRelationSchema,
  ProjectIndexSchema,
  RelationTargetSchema,
  aliasKey,
  buildProjectIndex,
  projectIndexBuilder,
  projectPairOf,
} from './rules.js';

const PROJECT_TYPE = 'cloudresourcemanager.googleapis.com/Project';

function projectAsset(name: string, data: unknown, assetType = PROJECT_TYPE): Asset {
  return {
    name,
    assetType,
    ancestors: ['organizations/30000000001'],
    updateTime: '2026-10-01T08:00:00Z',
    data,
  };
}

const RM = '//cloudresourcemanager.googleapis.com/projects/';

describe('projectPairOf', () => {
  it('reads the number from the name, else from data.projectNumber, and the id from data.projectId', () => {
    expect(projectPairOf(projectAsset(`${RM}10000000001`, { projectId: 'demo-net-1' }))).toEqual({
      number: '10000000001',
      id: 'demo-net-1',
    });
    expect(
      projectPairOf(
        projectAsset(`${RM}demo-app-1`, { projectId: 'demo-app-1', projectNumber: '10000000002' }),
      ),
    ).toEqual({ number: '10000000002', id: 'demo-app-1' });
    expect(projectPairOf(projectAsset(`${RM}10000000003`, { projectNumber: '10000000004' }))).toEqual({
      number: '10000000003',
    });
  });

  it('declares only valid halves, and nothing for other assets', () => {
    expect(
      projectPairOf(projectAsset(`${RM}x`, { projectId: '10000000005', projectNumber: '0123' })),
    ).toEqual({});
    expect(projectPairOf(projectAsset(`${RM}x`, { projectId: 'Demo App', projectNumber: 7 }))).toEqual({});
    expect(projectPairOf(projectAsset(`${RM}10000000001`, null))).toEqual({});
    expect(projectPairOf(projectAsset(`${RM}10000000001`, ['demo-net-1']))).toEqual({});
    expect(
      projectPairOf(
        projectAsset(`${RM}10000000001`, { projectId: 'demo-net-1' }, 'compute.googleapis.com/Project'),
      ),
    ).toEqual({});
  });
});

describe('buildProjectIndex and projectIndexBuilder', () => {
  it('pairs numbers with ids, first claim wins, in sorted records that validate', () => {
    const index = buildProjectIndex([
      projectAsset(`${RM}10000000002`, { projectId: 'demo-b-1' }),
      projectAsset(`${RM}10000000001`, { projectId: 'demo-a-1' }),
      projectAsset(`${RM}10000000001`, { projectId: 'demo-c-1' }), // number already paired
      projectAsset(`${RM}10000000003`, { projectId: 'demo-a-1' }), // id already paired
      projectAsset(`${RM}9`, { projectId: 'demo-z-1' }),
      projectAsset(`${RM}10000000004`, {}), // half a pair
    ]);
    expect(index).toEqual({
      numberById: { 'demo-a-1': '10000000001', 'demo-b-1': '10000000002', 'demo-z-1': '9' },
      idByNumber: { '9': 'demo-z-1', '10000000001': 'demo-a-1', '10000000002': 'demo-b-1' },
    });
    expect(Object.keys(index.numberById)).toEqual(['demo-a-1', 'demo-b-1', 'demo-z-1']);
    expect(Object.keys(index.idByNumber)).toEqual(['9', '10000000001', '10000000002']);
    expect(ProjectIndexSchema.parse(index)).toEqual(index);
    expect(buildProjectIndex([])).toEqual({ numberById: {}, idByNumber: {} });
  });

  it('builds incrementally and returns what each asset declared', () => {
    const builder = projectIndexBuilder();
    expect(builder.add(projectAsset(`${RM}10000000001`, { projectId: 'demo-a-1' }))).toEqual({
      number: '10000000001',
      id: 'demo-a-1',
    });
    expect(builder.add(projectAsset(`${RM}10000000001`, { projectId: 'demo-b-1' }))).toEqual({
      number: '10000000001',
      id: 'demo-b-1',
    });
    expect(builder.index()).toEqual({
      numberById: { 'demo-a-1': '10000000001' },
      idByNumber: { '10000000001': 'demo-a-1' },
    });
    // Equal numbers of equal length sort as equal; ids sort in code-point order.
    builder.add(projectAsset(`${RM}10000000002`, { projectId: 'demo-a-0' }));
    expect(Object.keys(builder.index().numberById)).toEqual(['demo-a-0', 'demo-a-1']);
  });
});

describe('aliasKey', () => {
  it('trims and lower-cases, and refuses empty keys and inner whitespace', () => {
    expect(aliasKey(' Runner@Demo-App-1.iam.gserviceaccount.com ')).toBe(
      'runner@demo-app-1.iam.gserviceaccount.com',
    );
    expect(aliasKey('   ')).toBeUndefined();
    expect(aliasKey('two words')).toBeUndefined();
    expect(AliasKeySchema.safeParse(aliasKey('X@example.com')).success).toBe(true);
  });
});

describe('ProjectIndexSchema', () => {
  const index = {
    numberById: { 'demo-net': '10000000001', 'example.com:legacy': '10000000002' },
    idByNumber: { '10000000001': 'demo-net', '10000000002': 'example.com:legacy' },
  };

  it('accepts two records that are inverse of each other, and an empty index', () => {
    expect(issuePaths(ProjectIndexSchema, index)).toEqual([]);
    expect(issuePaths(ProjectIndexSchema, { numberById: {}, idByNumber: {} })).toEqual([]);
  });

  it('reports an id whose number does not map back', () => {
    const broken = { ...index, numberById: { ...index.numberById, 'demo-app': '10000000003' } };
    expect(issuePaths(ProjectIndexSchema, broken)).toEqual(['numberById.demo-app']);
  });

  it('reports a number whose id does not map back', () => {
    const broken = { ...index, idByNumber: { ...index.idByNumber, '10000000003': 'demo-net' } };
    expect(issuePaths(ProjectIndexSchema, broken)).toEqual(['idByNumber.10000000003']);
  });

  it('rejects malformed keys and values and unknown fields', () => {
    expect(issuePaths(ProjectIndexSchema, { numberById: { 'Demo Net': '1' }, idByNumber: {} })).toEqual([
      'numberById.Demo Net',
    ]);
    // A bad number is reported, and the record no longer maps back to the id either.
    const badNumber = issuePaths(ProjectIndexSchema, { numberById: { demo: '01' }, idByNumber: {} });
    expect(new Set(badNumber)).toEqual(new Set(['numberById.demo']));
    expect(issuePaths(ProjectIndexSchema, { numberById: {}, idByNumber: {}, ids: [] })).toEqual(['']);
  });
});

describe('RelationTargetSchema', () => {
  it.each([
    { by: 'name', name: '//compute.googleapis.com/projects/demo-net/global/networks/core' },
    { by: 'alias', alias: 'runner@demo-app-1.iam.gserviceaccount.com' },
  ])('accepts %j', (target) => {
    expect(issuePaths(RelationTargetSchema, target)).toEqual([]);
  });

  it.each([
    ['name', { by: 'name', name: 'projects/demo-net/global/networks/core' }],
    ['alias', { by: 'alias', alias: 'two words' }],
    ['by', { by: 'email', alias: 'a@example.com' }],
  ])('rejects a bad %s', (path, target) => {
    expect(issuePaths(RelationTargetSchema, target)).toEqual([path]);
  });

  it('keeps alias keys free of whitespace', () => {
    expect(AliasKeySchema.safeParse('').success).toBe(false);
    expect(AliasKeySchema.safeParse('sa@example.com').success).toBe(true);
  });
});

describe('EvaluatedRelationSchema', () => {
  const relation = {
    kind: 'attaches',
    rule: 0,
    raw: 'https://www.googleapis.com/compute/v1/projects/demo-net/regions/europe-west3/subnetworks/app',
    target: {
      by: 'name',
      name: '//compute.googleapis.com/projects/demo-net/regions/europe-west3/subnetworks/app',
    },
  };

  it('accepts a resolved, a weak and an unresolved relation', () => {
    expect(issuePaths(EvaluatedRelationSchema, relation)).toEqual([]);
    expect(issuePaths(EvaluatedRelationSchema, { ...relation, weak: true })).toEqual([]);
    expect(issuePaths(EvaluatedRelationSchema, { kind: 'uses', rule: 2, raw: '{"kind":"Job"}' })).toEqual([]);
  });

  it.each([
    ['kind', { ...relation, kind: 'shares' }],
    ['rule', { ...relation, rule: -1 }],
    ['weak', { ...relation, weak: false }],
    ['raw', { ...relation, raw: 7 }],
  ])('rejects a bad %s', (path, value) => {
    expect(issuePaths(EvaluatedRelationSchema, value)).toEqual([path]);
  });
});
