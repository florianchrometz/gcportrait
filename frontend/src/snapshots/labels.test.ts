// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
import { generateOrganization } from '@gcportrait/demo-data';
import { SnapshotSchema, TimestampSchema } from '@gcportrait/model';
import { describe, expect, it } from 'vitest';

import { DEMO_CHOICES } from '../diagram/demoChoices';
import type { SnapshotMeta } from '../storage/db';
import {
  DEMO_SIZE_INFO,
  demoAbout,
  demoLabel,
  distinctLabels,
  distinctNames,
  formatUtc,
  plural,
  scopeName,
  snapshotLabel,
} from './labels';
import { storedRecord } from './testing';

/** A stored demo snapshot's facts of example.com, read on 8 October, with `change`. */
const meta = (change: Partial<SnapshotMeta> = {}): SnapshotMeta => storedRecord('x', change).meta;

describe('plural labels', () => {
  it.each([
    [0, '0 assets were'],
    [1, '1 asset was'],
    [2, '2 assets were'],
    [1000, '1,000 assets were'],
    [-0, '-0 assets were'],
    [-1, '-1 assets were'],
    [1.0001, '1 assets were'],
    [Number.NaN, 'NaN assets were'],
    [Number.POSITIVE_INFINITY, '∞ assets were'],
    [Number.NEGATIVE_INFINITY, '-∞ assets were'],
  ])('formats %s without changing which phrase its exact value selects', (count, expected) => {
    expect(plural(count, 'asset was', 'assets were')).toBe(expected);
  });

  it('keeps caller-supplied phrases, including empty strings, verbatim', () => {
    expect(plural(1, 'organisation or project', 'different organisations or projects')).toBe(
      '1 organisation or project',
    );
    expect(plural(2, 'organisation or project', 'different organisations or projects')).toBe(
      '2 different organisations or projects',
    );
    expect(plural(1, '', 'many')).toBe('1 ');
    expect(plural(2, 'one', '')).toBe('2 ');
  });
});

describe('snapshot labels', () => {
  it.each([
    ['0000-01-01T00:00:00+01:00', '-000001-12-31 23:00 UTC'],
    ['9999-12-31T23:30:00-01:00', '+010000-01-01 00:30 UTC'],
  ])('formats model-accepted read time %s across the UTC year boundary', (readTime, expected) => {
    expect(TimestampSchema.safeParse(readTime).success).toBe(true);
    expect(
      SnapshotSchema.safeParse({
        id: '01J0000000000000000000000A',
        schemaVersion: 1,
        scope: { kind: 'project', id: 'demo-app-1' },
        readTime,
        source: { kind: 'export' },
        contentType: 'RESOURCE',
        assets: [],
        stats: { count: 0, byType: {}, bytes: 0 },
      }).success,
    ).toBe(true);
    expect(formatUtc(readTime)).toBe(expected);
    expect(snapshotLabel(meta({ readTime }))).toBe(`example.com, read ${expected}`);
  });

  it.each([
    ['2026-10-08T00:00:00Z', '2026-10-08 00:00 UTC'],
    ['2026-10-08T02:30:45.987654+02:00', '2026-10-08 00:30 UTC'],
    ['0000-01-01T00:00:00Z', '0000-01-01 00:00 UTC'],
    ['soon', 'soon'],
    ['', ''],
  ])('keeps the UTC display and invalid-string policy for %s', (readTime, expected) => {
    expect(formatUtc(readTime)).toBe(expected);
  });

  it('name a snapshot by its scope, read time and source detail', () => {
    expect(snapshotLabel(meta({ detail: 'demo:M' }))).toBe('example.com, read 2026-10-08 00:00 UTC, demo:M');
    expect(snapshotLabel(meta())).toBe('example.com, read 2026-10-08 00:00 UTC');
    expect(snapshotLabel(meta({ scope: { kind: 'project', id: 'p-1' } }))).toBe(
      'Project p-1, read 2026-10-08 00:00 UTC',
    );
    const many = Array.from({ length: 30 }, (_, index) => `Type${String(index)}.json`).join(', ');
    const label = snapshotLabel(meta({ detail: many }));
    expect(label.endsWith('…')).toBe(true);
    expect(label.length).toBeLessThan(110);
  });

  it('tell copies apart: by when they were stored, then by their place', () => {
    const records = [
      { id: 'demo:S', meta: meta({ detail: 'demo:S' }) },
      { id: 'demo:M', meta: meta({ detail: 'demo:M' }) },
      { id: 'A', meta: meta({ detail: 'copy.gcportrait.json', savedAt: '2026-10-10T12:00:00Z' }) },
      { id: 'B', meta: meta({ detail: 'copy.gcportrait.json', savedAt: '2026-10-10T13:00:00Z' }) },
      { id: 'C', meta: meta({ detail: 'copy.gcportrait.json', savedAt: '2026-10-10T13:00:30Z' }) },
    ];
    const labels = distinctLabels(records);
    expect([...labels.values()]).toEqual([
      'example.com, read 2026-10-08 00:00 UTC, demo:S',
      'example.com, read 2026-10-08 00:00 UTC, demo:M',
      'example.com, read 2026-10-08 00:00 UTC, copy.gcportrait.json, stored 2026-10-10 12:00 UTC',
      'example.com, read 2026-10-08 00:00 UTC, copy.gcportrait.json, stored 2026-10-10 13:00 UTC, copy 1',
      'example.com, read 2026-10-08 00:00 UTC, copy.gcportrait.json, stored 2026-10-10 13:00 UTC, copy 2',
    ]);
    expect(new Set(labels.values()).size).toBe(records.length);
  });

  it('number copies stored in the same minute in the order they were stored, for the rows to show', () => {
    // As the table lists them: the newest first.
    const records = [
      { id: 'Z', meta: meta({ detail: 'copy.gcportrait.json', savedAt: '2026-10-10T13:00:40Z' }) },
      { id: 'Y', meta: meta({ detail: 'copy.gcportrait.json', savedAt: '2026-10-10T13:00:30Z' }) },
      { id: 'X', meta: meta({ detail: 'copy.gcportrait.json', savedAt: '2026-10-10T13:00:30Z' }) },
      { id: 'A', meta: meta({ detail: 'demo:M' }) },
    ];
    const names = distinctNames(records);
    expect(names.get('X')).toEqual({
      label:
        'example.com, read 2026-10-08 00:00 UTC, copy.gcportrait.json, stored 2026-10-10 13:00 UTC, copy 1',
      copy: 1,
    });
    expect(names.get('Y')?.copy).toBe(2);
    expect(names.get('Z')?.copy).toBe(3);
    expect(names.get('A')).toEqual({ label: 'example.com, read 2026-10-08 00:00 UTC, demo:M' });
    expect([...distinctLabels(records).values()]).toEqual([...names.values()].map(({ label }) => label));
  });

  it('name a scope without a display name by its kind and id', () => {
    expect(scopeName({ kind: 'organization', id: '30000000001' })).toBe('Organisation 30000000001');
  });
});

describe('the demo sizes', () => {
  it('are named as the Snapshot menu names them', () => {
    for (const choice of DEMO_CHOICES) expect(demoLabel(choice.size)).toBe(choice.label);
    expect(demoLabel('XL')).toBe('Demo organisation XL (extra large)');
    expect(DEMO_SIZE_INFO.map((info) => info.size)).toEqual(['S', 'M', 'L', 'XL']);
  });

  it('are described in words', () => {
    expect(demoAbout('S')).toBe('about 100 assets, 1 business unit');
    expect(demoAbout('M')).toBe('about 1,000 assets, 3 business units');
    expect(demoAbout('XL')).toBe(
      'about 50,000 assets, 30 business units; it takes a while to generate and store',
    );
  });

  // The facts restate @gcportrait/demo-data's profiles; this fails when the generator drifts from them (XL takes
  // about 1.3 s to generate).
  it.each(DEMO_SIZE_INFO)(
    'match what the generator makes for $size',
    ({ size, assets, businessUnits }) => {
      const organisation = generateOrganization({ size });
      expect(Math.abs(organisation.assets.length - assets) / assets).toBeLessThan(0.25);
      const folders = organisation.assets.filter(
        (asset) => asset.assetType === 'cloudresourcemanager.googleapis.com/Folder',
      );
      const field = (data: unknown, key: string): unknown =>
        typeof data === 'object' && data !== null ? (data as Record<string, unknown>)[key] : undefined;
      const workloads = folders.find((folder) => field(folder.data, 'displayName') === 'Workloads');
      const units = folders.filter(
        (folder) => field(folder.data, 'parent') === field(workloads?.data, 'name'),
      );
      expect(units).toHaveLength(businessUnits);
    },
    20_000,
  );
});
