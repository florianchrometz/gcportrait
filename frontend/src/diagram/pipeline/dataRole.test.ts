// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
import 'fake-indexeddb/auto';

import type { Snapshot } from '@gcportrait/model';
import { beforeAll, describe, expect, it } from 'vitest';

import { encodeJson } from '../../snapshots/codec';
import { loadAnySnapshot, loadStoredHistory } from '../../snapshots/load';
import { metaOf } from '../../snapshots/worker/prepare';
import type { StoredSnapshot } from '../../storage/db';
import { useFreshIndexedDb } from '../../test/indexedDb';
import { TEST_VIEWPORT } from '../testing/dataHarness';
import { demoSHistory } from '../testing/demoData';
import { loadDemoSnapshot } from './dataHandler';
import { startRole } from './dataRole';
import type { DataResponse } from './protocol';

const HISTORY = demoSHistory();

beforeAll(async () => {
  await import('./demo');
});

const { database } = useFreshIndexedDb({ resetSnapshots: true });

async function storeDemoRecord(
  id: string,
  snapshot: Snapshot,
  historyBlob?: Blob,
): Promise<StoredSnapshot> {
  const db = await database();
  const blob = await encodeJson({ ...snapshot, id });
  const record: StoredSnapshot = {
    id,
    meta: { ...metaOf(snapshot, blob.size, id), savedAt: '2026-10-10T12:00:00Z' },
    blob,
    ...(historyBlob !== undefined ? { history: historyBlob } : {}),
  };
  await db.put('snapshots', record);
  return record;
}

function roleHarness() {
  const responses: DataResponse[] = [];
  const waiting = new Map<number, Array<(response: DataResponse) => void>>();
  const handle = startRole((response) => {
    responses.push(response);
    if (response.type !== 'progress' && response.type !== 'job-progress') {
      const waiters = waiting.get(response.id);
      waiting.delete(response.id);
      for (const resolve of waiters ?? []) resolve(response);
    }
  });
  let nextId = 0;
  return {
    responses,
    ask(request: Readonly<Record<string, unknown>>) {
      nextId += 1;
      const id = nextId;
      return new Promise<DataResponse>((resolve) => {
        const list = waiting.get(id) ?? [];
        list.push(resolve);
        waiting.set(id, list);
        handle({ ...request, id });
      });
    },
    stages(id: number): string[] {
      return responses
        .filter((r) => r.type === 'progress' && r.id === id)
        .map((r) => (r as { stage: string }).stage);
    },
  };
}

describe('the data worker role with demo snapshots', () => {
  it('reads a stored demo snapshot from IndexedDB without generating it', async () => {
    const original = await loadDemoSnapshot('demo:S', () => undefined);
    await storeDemoRecord('demo:S', original);

    const stages: string[] = [];
    const loaded = await loadAnySnapshot('demo:S', (stage) => stages.push(stage));

    expect(stages).toEqual(['ingest']);
    expect(loaded.id).toBe('demo:S');
    expect(loaded.assets.length).toBe(original.assets.length);
  });

  it('falls back to generating when a demo organisation is not stored', async () => {
    const stages: string[] = [];
    const loaded = await loadAnySnapshot('demo:S', (stage) => stages.push(stage));

    expect(stages).toEqual(['generate', 'ingest']);
    expect(loaded.id).toBe('demo:S');
  });

  it('falls back to generating when a stored demo snapshot is damaged', async () => {
    const db = await database();
    const record: StoredSnapshot = {
      id: 'demo:S',
      meta: {
        savedAt: '2026-10-10T12:00:00Z',
        scopePath: 'organizations/30000000001',
        assetCount: 0,
        bytes: 10,
        source: 'api',
        detail: 'demo:S',
      },
      blob: new Blob(['invalid json'], { type: 'application/json' }),
    };
    await db.put('snapshots', record);

    const stages: string[] = [];
    const loaded = await loadAnySnapshot('demo:S', (stage) => stages.push(stage));

    expect(stages).toEqual(['generate', 'ingest']);
    expect(loaded.id).toBe('demo:S');
  });

  it('startRole answers scene requests for stored demo without generate stage', async () => {
    const original = await loadDemoSnapshot('demo:S', () => undefined);
    const historyBlob = await encodeJson(HISTORY);
    await storeDemoRecord('demo:S', original, historyBlob);

    const harness = roleHarness();
    const answer = await harness.ask({
      type: 'scene',
      view: { snapshot: 'demo:S' },
      viewport: TEST_VIEWPORT,
    });

    expect(answer.type).toBe('scene');
    expect(harness.stages(1)).toEqual(['ingest', 'graph', 'scene']);

    // Check stored history can be read
    const storedHistory = await loadStoredHistory('demo:S');
    expect(storedHistory).not.toBeNull();
    expect(storedHistory?.today).toBe(HISTORY.today);

    // Timeline request
    const timeline = await harness.ask({ type: 'timeline', snapshot: 'demo:S' });
    expect(timeline).toMatchObject({
      type: 'timeline',
      info: { kind: 'history', today: HISTORY.today },
    });
  });

  it('startRole generates demo and history when not stored', async () => {
    const harness = roleHarness();
    const answer = await harness.ask({
      type: 'scene',
      view: { snapshot: 'demo:S' },
      viewport: TEST_VIEWPORT,
    });

    expect(answer.type).toBe('scene');
    expect(harness.stages(1)).toEqual(['generate', 'ingest', 'graph', 'scene']);

    const timeline = await harness.ask({ type: 'timeline', snapshot: 'demo:S' });
    expect(timeline).toMatchObject({
      type: 'timeline',
      info: { kind: 'history', today: HISTORY.today },
    });
  });
});
