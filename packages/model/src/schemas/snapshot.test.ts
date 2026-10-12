// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { sampleAsset, sampleSnapshot } from '../testing/fixtures.js';
import { issuePaths, without } from '../testing/issues.js';
import {
  ScopeKindSchema,
  SnapshotFormatError,
  SnapshotSchema,
  SnapshotReadTimeSourceSchema,
  SnapshotSourceKindSchema,
  migrateSnapshot,
} from './snapshot.js';

describe('SnapshotSchema', () => {
  it('accepts a consistent snapshot', () => {
    expect(issuePaths(SnapshotSchema, sampleSnapshot())).toEqual([]);
  });

  it('accepts an empty snapshot', () => {
    expect(
      issuePaths(SnapshotSchema, {
        ...sampleSnapshot(),
        assets: [],
        stats: { count: 0, byType: {}, bytes: 0 },
      }),
    ).toEqual([]);
  });

  it.each(ScopeKindSchema.options)('accepts scope kind %s', (kind) => {
    const snapshot = sampleSnapshot();
    expect(issuePaths(SnapshotSchema, { ...snapshot, scope: { kind, id: 'demo-net' } })).toEqual([]);
  });

  it.each(SnapshotSourceKindSchema.options)('accepts source kind %s', (kind) => {
    expect(issuePaths(SnapshotSchema, { ...sampleSnapshot(), source: { kind } })).toEqual([]);
  });

  it.each(SnapshotReadTimeSourceSchema.options)('accepts read time source %s', (readTimeSource) => {
    expect(issuePaths(SnapshotSchema, { ...sampleSnapshot(), readTimeSource })).toEqual([]);
  });

  it.each([
    ['id', { id: 'not-a-ulid' }],
    ['schemaVersion', { schemaVersion: 2 }],
    ['scope.kind', { scope: { kind: 'billingAccount', id: '1' } }],
    ['scope.id', { scope: { kind: 'project', id: 'Demo Net' } }],
    ['scope.displayName', { scope: { kind: 'project', id: 'demo-net', displayName: '' } }],
    ['readTime', { readTime: 'now' }],
    ['readTimeSource', { readTimeSource: 'clock' }],
    ['source.kind', { source: { kind: 'upload' } }],
    ['source.detail', { source: { kind: 'api', detail: '' } }],
    ['contentType', { contentType: 'IAM_POLICY' }],
    ['stats.bytes', { stats: { ...sampleSnapshot().stats, bytes: -1 } }],
  ])('rejects a bad %s', (path, patch) => {
    expect(issuePaths(SnapshotSchema, { ...sampleSnapshot(), ...patch })).toEqual([path]);
  });

  it('rejects a per-type count below one', () => {
    const snapshot = sampleSnapshot();
    const byType = { ...snapshot.stats.byType, 'compute.googleapis.com/Instance': 0 };
    expect(issuePaths(SnapshotSchema, { ...snapshot, stats: { ...snapshot.stats, byType } })).toContain(
      'stats.byType.compute.googleapis.com/Instance',
    );
  });

  it('rejects duplicate asset names', () => {
    const snapshot = sampleSnapshot();
    const assets = [...snapshot.assets, sampleAsset()];
    const stats = {
      ...snapshot.stats,
      count: 3,
      byType: { ...snapshot.stats.byType, 'compute.googleapis.com/Instance': 2 },
    };
    expect(issuePaths(SnapshotSchema, { ...snapshot, assets, stats })).toEqual(['assets.2.name']);
  });

  it('rejects a count that differs from the number of assets', () => {
    const snapshot = sampleSnapshot();
    expect(issuePaths(SnapshotSchema, { ...snapshot, stats: { ...snapshot.stats, count: 3 } })).toEqual([
      'stats.count',
    ]);
  });

  it('rejects per-type counts that disagree with the assets', () => {
    const snapshot = sampleSnapshot();
    const wrongCount = { ...snapshot.stats.byType, 'compute.googleapis.com/Instance': 2 };
    const extraType = { ...snapshot.stats.byType, 'compute.googleapis.com/Disk': 1 };
    const missingType = without(snapshot.stats.byType, 'compute.googleapis.com/Instance');
    for (const byType of [wrongCount, extraType, missingType]) {
      expect(issuePaths(SnapshotSchema, { ...snapshot, stats: { ...snapshot.stats, byType } })).toEqual([
        'stats.byType',
      ]);
    }
  });
});

describe('migrateSnapshot', () => {
  it('returns a valid current-version snapshot, with unknown keys stripped', () => {
    const snapshot = sampleSnapshot();
    expect(migrateSnapshot(JSON.parse(JSON.stringify({ ...snapshot, savedBy: 'test' })))).toEqual(snapshot);
  });

  const failure = (input: unknown): SnapshotFormatError => {
    try {
      migrateSnapshot(input);
    } catch (error) {
      if (error instanceof SnapshotFormatError) return error;
      throw error;
    }
    throw new Error('migrateSnapshot accepted the input');
  };

  it.each([
    ['a string', 'snapshot'],
    ['null', null],
    ['an array', [sampleSnapshot()]],
  ])('refuses %s', (_case, input) => {
    const error = failure(input);
    expect(error).toMatchObject({ name: 'SnapshotFormatError', problem: 'not-an-object', issues: [] });
    expect(error).toBeInstanceOf(Error);
  });

  it.each([
    ['missing', undefined],
    ['zero', 0],
    ['fractional', 1.5],
    ['a string', '1'],
  ])('refuses a %s schemaVersion', (_case, schemaVersion) => {
    expect(failure({ ...sampleSnapshot(), schemaVersion }).problem).toBe('unknown-version');
  });

  it('refuses a snapshot written by a newer build and says so', () => {
    const error = failure({ ...sampleSnapshot(), schemaVersion: 2 });
    expect(error.problem).toBe('newer-version');
    expect(error.message).toContain('version 2');
  });

  it('refuses an invalid current-version snapshot and lists the issues', () => {
    const error = failure({ ...sampleSnapshot(), readTime: 'now' });
    expect(error.problem).toBe('invalid');
    expect(error.issues.map((issue) => issue.path.join('.'))).toEqual(['readTime']);
  });
});
