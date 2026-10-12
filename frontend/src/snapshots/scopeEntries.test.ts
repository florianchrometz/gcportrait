// @vitest-environment node
// SPDX-License-Identifier: MIT
/**
 * What the Snapshots page shows of each scope's timeline (scopeEntries.ts): everything kept of a scope,
 * grouped by scope and in time order (snapshots with a history, exports and pulls as extra ticks, cached days, the
 * day before the extra tick read at its 00:00), copies of one extra tick counted, what each kind takes, a scope named
 * by its best stored snapshot or, with only cached days, by its kind and id.
 */
import { describe, expect, it } from 'vitest';

import { storedTick as day } from '../timeline/testing/fixtures';
import type { ListedSnapshot } from './repository';
import { isExtraRecord, scopeTimelines } from './scopeEntries';
import { storedRecord } from './testing';

const ORG = { kind: 'organization' as const, id: '30000000001', displayName: 'example.com' };

function listed(...args: Parameters<typeof storedRecord>): ListedSnapshot {
  return { record: storedRecord(...args), persisted: true };
}

describe('the timelines by scope', () => {
  const snapshots = [
    listed('demo:M', { detail: 'demo:M', historyTicks: 35, bytes: 300_000, scope: { ...ORG } }),
    listed('01J0000000000000000000000E', {
      source: 'export',
      readTime: '2026-10-05T14:30:12.5Z',
      bytes: 5_000,
      scope: { kind: 'organization', id: '30000000001' },
    }),
    listed('01J0000000000000000000000F', {
      source: 'export',
      readTime: '2026-10-05T14:30:12Z',
      bytes: 6_000,
      savedAt: '2026-10-10T13:00:00Z',
    }),
    listed('01J0000000000000000000000P', { source: 'api', readTime: '2026-10-07T00:00:00Z', bytes: 7_000 }),
    listed('01J0000000000000000000000Q', {
      source: 'export',
      readTime: '2026-10-01T00:00:00Z',
      scope: { kind: 'project', id: 'demo-net-1' },
      bytes: 9_000,
    }),
  ];
  const ticks = [
    day('organizations/30000000001', '2026-10-07', { bytes: 2_000 }),
    day('organizations/30000000001', '2026-10-06'),
    day('organizations/30000000001', '2026-10-10', {
      now: true,
      readTime: '2026-10-10T00:00:00Z',
      actualReadTime: '2026-10-10T09:15:00Z',
    }),
    day('folders/20000000001', '2026-10-02'),
  ];
  const timelines = scopeTimelines(snapshots, ticks);

  it('groups everything by scope, by name: stored snapshots name a scope, cached days alone by kind and id', () => {
    expect(timelines.map((timeline) => [timeline.scopePath, timeline.name, timeline.kindAndId])).toEqual([
      ['organizations/30000000001', 'example.com', 'Organisation 30000000001'],
      ['folders/20000000001', 'Folder 20000000001', 'Folder 20000000001'],
      ['projects/demo-net-1', 'Project demo-net-1', 'Project demo-net-1'],
    ]);
  });

  it('puts a scope’s entries in time order: the day before an extra tick read at its 00:00', () => {
    const [org] = timelines;
    expect(
      org?.entries.map((entry) =>
        entry.kind === 'day' ? `day ${entry.tick.day}` : `${entry.kind} ${entry.listed.record.id}`,
      ),
    ).toEqual([
      'extra 01J0000000000000000000000F',
      'extra 01J0000000000000000000000E',
      'day 2026-10-06',
      'day 2026-10-07',
      'extra 01J0000000000000000000000P',
      'snapshot demo:M',
      'day 2026-10-10',
    ]);
  });

  it('orders a day, a demo and an extra tick at the same instant as day, snapshot, extra tick', () => {
    const [org] = scopeTimelines(
      [listed('01J0000000000000000000000E', { source: 'export' }), listed('demo:M', { historyTicks: 35 })],
      [day('organizations/30000000001', '2026-10-08')],
    );
    expect(org?.entries.map((entry) => entry.kind)).toEqual(['day', 'snapshot', 'extra']);
  });

  it('counts the copies of one extra tick (read in the same second), and what each kind takes', () => {
    const [org] = timelines;
    const shared = org?.entries.flatMap((entry) => (entry.kind === 'extra' ? [entry.shared] : []));
    // E and F were read in the same second (14:30:12): one tick on the timeline.
    expect(shared).toEqual([1, 1, 0]);
    expect(org?.bytes).toEqual({ snapshots: 300_000, extras: 18_000, days: 4_000 });
    expect(org?.days.map((tick) => tick.day)).toEqual(['2026-10-06', '2026-10-07', '2026-10-10']);
  });

  it('takes exports and pulls as extra ticks, demos as snapshots', () => {
    expect(snapshots.map(({ record }) => isExtraRecord(record))).toEqual([false, true, true, true, true]);
  });

  it('keeps nothing when nothing is kept', () => {
    expect(scopeTimelines([], [])).toEqual([]);
  });
});
