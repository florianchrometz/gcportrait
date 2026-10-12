// @vitest-environment node
// SPDX-License-Identifier: MIT
/**
 * What changed about one node between two days (changes.ts), on demo organisation S's history from
 * 7 to 8 September: a changed project with its update times and the field that differs, an added subscription, a
 * removed bucket named as it was, what changed inside a container, an unchanged node, the caps.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { demoDayGraph } from '../diagram/testing/demoScenes';
import { nodeChanges, type ChangesDay } from './changes';

beforeAll(async () => {
  await import('../diagram/pipeline/demo');
});

const SERVICES_PROJECT = '//cloudresourcemanager.googleapis.com/projects/10000000009';
const DATA_PROJECT = '//cloudresourcemanager.googleapis.com/projects/10000000010';
const DEBUG_SUBSCRIPTION = '//pubsub.googleapis.com/projects/demo-svc-1/subscriptions/debug-2';
const SCRATCH_BUCKET = '//storage.googleapis.com/demo-data-1-scratch-1';
const LAKE_BUCKET = '//storage.googleapis.com/demo-data-1-lake';

async function day(tick: string): Promise<ChangesDay> {
  const { snapshot, graph, console: source } = await demoDayGraph('S', tick);
  return { snapshot, graph, assets: source.assets, tick };
}

describe('what changed about a node between two days', () => {
  it('gives a changed asset’s update time on both days and the fields of its data that differ', async () => {
    const [before, after] = await Promise.all([day('2026-09-07'), day('2026-09-08')]);
    const changes = nodeChanges(before, after, SERVICES_PROJECT);
    expect(changes).toMatchObject({
      since: { tick: '2026-09-07', readTime: '2026-09-07T00:00:00Z' },
      readTime: '2026-09-08T00:00:00Z',
      status: 'changed',
      fields: { entries: [{ path: 'labels.cost-center', kind: 'changed' }], more: 0 },
    });
    expect(changes?.updateTime.before).toBe(before.assets.get(SERVICES_PROJECT)?.updateTime);
    expect(changes?.updateTime.after).toBe(after.assets.get(SERVICES_PROJECT)?.updateTime);
    expect(changes?.updateTime.before).not.toBe(changes?.updateTime.after);
    // What changed inside the project: the new subscription.
    expect(changes?.inside.added.entries.map((entry) => entry.id)).toContain(DEBUG_SUBSCRIPTION);
  });

  it('names an added node with its update time on the drawn day only', async () => {
    const [before, after] = await Promise.all([day('2026-09-07'), day('2026-09-08')]);
    const changes = nodeChanges(before, after, DEBUG_SUBSCRIPTION);
    expect(changes).toMatchObject({ status: 'added', label: 'debug-2' });
    expect(changes?.updateTime).toEqual({ after: after.assets.get(DEBUG_SUBSCRIPTION)?.updateTime });
    expect(changes?.fields).toBeUndefined();
  });

  it('names a removed node as the earlier day had it, and lists it as removed inside its container', async () => {
    const [before, after] = await Promise.all([day('2026-09-07'), day('2026-09-08')]);
    const changes = nodeChanges(before, after, SCRATCH_BUCKET);
    expect(changes).toMatchObject({ status: 'removed', label: 'demo-data-1-scratch-1' });
    expect(changes?.typeName).not.toBe('');
    expect(changes?.updateTime).toEqual({ before: before.assets.get(SCRATCH_BUCKET)?.updateTime });
    const project = nodeChanges(before, after, DATA_PROJECT);
    expect(project?.status).toBe('unchanged');
    expect(project?.inside.removed.entries.map((entry) => entry.id)).toEqual([SCRATCH_BUCKET]);
    expect(project?.inside.added.entries).toEqual([]);
  });

  it('says an untouched node is unchanged, with the same update time on both days and no fields', async () => {
    const [before, after] = await Promise.all([day('2026-09-07'), day('2026-09-08')]);
    const changes = nodeChanges(before, after, LAKE_BUCKET);
    expect(changes?.status).toBe('unchanged');
    expect(changes?.updateTime.before).toBe(changes?.updateTime.after);
    expect(changes?.fields).toBeUndefined();
  });

  it('works the other way round, and names the snapshot’s own day without a tick', async () => {
    const [later, earlier] = await Promise.all([day('2026-09-08'), day('2026-09-07')]);
    expect(nodeChanges(later, earlier, SCRATCH_BUCKET)?.status).toBe('added');
    expect(nodeChanges(later, earlier, DEBUG_SUBSCRIPTION)?.status).toBe('removed');
    const own = await day('2026-10-08');
    const withoutTick: ChangesDay = { snapshot: own.snapshot, graph: own.graph, assets: own.assets };
    expect(nodeChanges(withoutTick, await day('2026-10-07'), LAKE_BUCKET)?.since).toEqual({
      readTime: '2026-10-08T00:00:00Z',
    });
  });

  it('answers null for a name neither day has, and caps the lists inside a container', async () => {
    const [before, after] = await Promise.all([day('2026-09-04'), day('2026-10-08')]);
    expect(nodeChanges(before, after, '//example.com/nothing')).toBeNull();
    const org = '//cloudresourcemanager.googleapis.com/organizations/30000000001';
    const full = nodeChanges(before, after, org);
    const capped = nodeChanges(before, after, org, 2);
    const total = (full?.inside.changed.entries.length ?? 0) + (full?.inside.changed.more ?? 0);
    expect(total).toBeGreaterThan(2);
    expect(capped?.inside.changed.entries).toHaveLength(2);
    expect(capped?.inside.changed.more).toBe(total - 2);
    // By label, then id.
    const labels = full?.inside.changed.entries.map((entry) => entry.label) ?? [];
    expect([...labels].sort()).toEqual(labels);
  });
});
