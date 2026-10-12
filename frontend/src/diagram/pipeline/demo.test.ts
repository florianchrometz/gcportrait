// @vitest-environment node
// SPDX-License-Identifier: MIT
/**
 * The demo organisations in the workers (ADR 0029 as amended on 2026-10-11: the demo generator runs in workers only):
 * "Try the demo" prepares demo S as the data worker draws it, with its 35-day history, through the data protocol's
 * `demo` request (which the demo worker answers in the app, demoRole.ts) with the snapshot library's progress stages.
 */
import { historyFor } from '@gcportrait/demo-data';
import { migrateSnapshot, type DemoSize } from '@gcportrait/model';
import { describe, expect, it } from 'vitest';

import { decodeJson } from '../../snapshots/codec';
import type { JobProgress } from '../../snapshots/worker/protocol';
import { loadDemoSnapshot } from './dataHandler';
import { prepareDemo } from './demo';
import { createInProcessWorkers } from './inProcess';

describe('the demo job (data worker)', () => {
  it('prepares demo S as the data worker draws it, with its 35-day history', async () => {
    const stages: JobProgress[] = [];
    const prepared = await prepareDemo('S', (progress) => stages.push(progress));
    expect(prepared.id).toBe('demo:S');
    const drawn = await loadDemoSnapshot('demo:S', () => undefined);
    expect(migrateSnapshot(await decodeJson(prepared.blob))).toEqual(drawn);
    if (prepared.history === undefined) throw new Error('a demo carries its history');
    expect(await decodeJson(prepared.history)).toEqual(JSON.parse(JSON.stringify(historyFor('S'))));
    expect(prepared.meta).toEqual({
      scope: { kind: 'organization', id: '30000000001', displayName: 'example.com' },
      readTime: '2026-10-08T00:00:00Z',
      source: 'demo',
      assetCount: drawn.assets.length,
      bytes: prepared.blob.size + prepared.history.size,
      schemaVersion: 1,
      detail: 'demo:S',
      historyTicks: 35,
    });
    expect(stages.map((progress) => progress.stage)).toEqual(['generate', 'read', 'read', 'encode']);
    expect(stages[2]).toEqual({ stage: 'read', assets: drawn.assets.length });
  });

  it('is what the data client’s `demo` resolves to through the worker protocol, its progress forwarded', async () => {
    const workers = createInProcessWorkers();
    try {
      const stages: JobProgress['stage'][] = [];
      const prepared = await workers.data.demo('S', (progress) => stages.push(progress.stage));
      expect(prepared.id).toBe('demo:S');
      expect(stages).toEqual(['generate', 'read', 'read', 'encode']);
      // A size there is none of is refused by the handler as a protocol error, which the client passes on.
      await expect(workers.data.demo('Q' as DemoSize)).rejects.toMatchObject({
        name: 'DataWorkerError',
        code: 'protocol',
        message: 'no demo organisation of size "Q"',
      });
    } finally {
      workers.dispose();
    }
  });
});
