// @vitest-environment node
// SPDX-License-Identifier: MIT
/**
 * The diff overlay through the data worker's handler (diagram/pipeline/dataHandler.ts), on demo S's
 * history: a Scene request naming the day to compare with answers with the diff of the two days and the Scene with
 * its ghosts; none without one, for the same day, or for a day the timeline does not have; a malformed day is a
 * protocol error. A `changes` request answers what changed about one node between the two days it names.
 */
import { normalizeViewSpec } from '@gcportrait/model';
import { beforeAll, describe, expect, it } from 'vitest';

import { dataHarness, TEST_VIEWPORT } from '../testing/dataHarness';
import { DEMO_S } from '../testing/demoData';

beforeAll(async () => {
  await import('../pipeline/demo');
  await import('../../timeline/worker/replay');
});

const { scratchBucket: SCRATCH_BUCKET, servicesProject: SERVICES_PROJECT } = DEMO_S;

describe('a Scene request with a day to compare with', () => {
  it('answers with the diff of the two days and the Scene with the ghosts', async () => {
    const { scene } = dataHarness();
    const answer = await scene({ snapshot: 'demo:S', tick: '2026-09-08' }, { tick: '2026-09-07' });
    expect(answer.source.tick).toBe('2026-09-08');
    expect(answer.diff?.since).toEqual({ tick: '2026-09-07', readTime: '2026-09-07T00:00:00Z' });
    expect(answer.diff?.changed).toEqual([SERVICES_PROJECT]);
    expect(answer.diff?.ghosts).toEqual({ [SCRATCH_BUCKET]: 'removed' });
    expect(JSON.stringify(answer.scene)).toContain(SCRATCH_BUCKET);
    // The ghost's icon comes with the Scene, as every node's does.
    expect(Object.keys(answer.icons).length).toBeGreaterThan(0);
  });

  it('compares with the snapshot’s own day (null), and the snapshot’s own day with a tick', async () => {
    const { scene } = dataHarness();
    const back = await scene({ snapshot: 'demo:S', tick: '2026-10-07' }, { tick: null });
    expect(back.diff?.since).toEqual({ readTime: '2026-10-08T00:00:00Z' });
    const forward = await scene({ snapshot: 'demo:S' }, { tick: '2026-10-07' });
    expect(forward.source.tick).toBeUndefined();
    expect(forward.diff?.since.tick).toBe('2026-10-07');
  });

  it('answers without a diff when none is asked for, for the same day, and for a day the timeline lacks', async () => {
    const { scene } = dataHarness();
    expect((await scene({ snapshot: 'demo:S', tick: '2026-09-08' })).diff).toBeUndefined();
    expect(
      (await scene({ snapshot: 'demo:S', tick: '2026-09-08' }, { tick: '2026-09-08' })).diff,
    ).toBeUndefined();
    const outside = await scene({ snapshot: 'demo:S', tick: '2026-09-08' }, { tick: '2025-01-01' });
    expect(outside.diff).toBeUndefined();
    expect(JSON.stringify(outside.scene)).not.toContain(SCRATCH_BUCKET);
  });

  it('refuses a malformed day to compare with', async () => {
    const { ask } = dataHarness();
    for (const diffFrom of [{ tick: 7 }, 'yesterday', { tick: '' }]) {
      const answer = await ask({
        type: 'scene',
        spec: normalizeViewSpec({ snapshot: 'demo:S' }),
        viewport: TEST_VIEWPORT,
        diffFrom,
      });
      expect(answer).toMatchObject({ type: 'error', error: { code: 'protocol' } });
    }
  });
});

describe('a changes request', () => {
  it('answers what changed about a node between the two days it names', async () => {
    const { ask } = dataHarness();
    const answer = await ask({
      type: 'changes',
      snapshot: 'demo:S',
      node: SERVICES_PROJECT,
      since: { tick: '2026-09-07' },
      day: { tick: '2026-09-08' },
    });
    expect(answer).toMatchObject({
      type: 'changes',
      changes: {
        status: 'changed',
        since: { tick: '2026-09-07' },
        readTime: '2026-09-08T00:00:00Z',
        fields: { entries: [{ path: 'labels.cost-center' }] },
      },
    });
    const removed = await ask({
      type: 'changes',
      snapshot: 'demo:S',
      node: SCRATCH_BUCKET,
      since: { tick: '2026-09-07' },
      day: { tick: '2026-09-08' },
    });
    expect(removed).toMatchObject({ type: 'changes', changes: { status: 'removed' } });
  });

  it('answers null for a day the timeline lacks, and refuses malformed days', async () => {
    const { ask } = dataHarness();
    const outside = await ask({
      type: 'changes',
      snapshot: 'demo:S',
      node: SERVICES_PROJECT,
      since: { tick: '2025-01-01' },
      day: { tick: null },
    });
    expect(outside).toMatchObject({ type: 'changes', changes: null });
    const malformed = await ask({
      type: 'changes',
      snapshot: 'demo:S',
      node: SERVICES_PROJECT,
      since: { tick: '2026-09-07' },
    });
    expect(malformed).toMatchObject({ type: 'error', error: { code: 'protocol' } });
  });
});
