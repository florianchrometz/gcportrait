// SPDX-License-Identifier: Apache-2.0
import { normalizeViewSpec } from '@gcportrait/model';
import { describe, expect, it } from 'vitest';

import { createDataClient, DataWorkerError, isDataCancelled } from './dataClient';
import type { DataRequest } from './protocol';

const spec = normalizeViewSpec({ snapshot: 'demo:S' });
const viewport = { width: 1280, height: 800 };

describe('the data client', () => {
  it('resolves an answer, passes progress on, and maps errors', async () => {
    const sent: DataRequest[] = [];
    const client = createDataClient((request) => sent.push(request));
    const stages: string[] = [];
    const scene = client.scene(spec, viewport, { onProgress: (stage) => stages.push(stage) });
    client.receive({ type: 'progress', id: 1, stage: 'graph' });
    client.receive({ type: 'scene', id: 1, answer: { lensTitle: 'Overview' } });
    await expect(scene).resolves.toEqual({ lensTitle: 'Overview' });
    expect(stages).toEqual(['graph']);
    expect(sent[0]).toEqual({ type: 'scene', id: 1, spec, viewport });

    const lenses = client.lenses();
    client.receive({ type: 'error', id: 2, error: { code: 'internal', message: 'boom' } });
    await expect(lenses).rejects.toBeInstanceOf(DataWorkerError);
  });

  it('cancels an older Scene request when a newer one is sent, and on abort', async () => {
    const client = createDataClient(() => undefined);
    const older = client.scene(spec, viewport);
    const lenses = client.lenses();
    const newer = client.scene(spec, viewport);
    await expect(older).rejects.toSatisfy(isDataCancelled);
    client.receive({ type: 'lenses', id: 2, lenses: [] });
    await expect(lenses).resolves.toEqual([]);
    const controller = new AbortController();
    const aborted = client.scene(spec, viewport, { signal: controller.signal });
    await expect(newer).rejects.toSatisfy(isDataCancelled);
    controller.abort();
    await expect(aborted).rejects.toSatisfy(isDataCancelled);
    // A late answer to a cancelled request is ignored.
    client.receive({ type: 'scene', id: 4, answer: {} });
  });

  it('keeps a jump link’s locates apart from a search’s: a newer locate supersedes only one of its own family', async () => {
    const sent: DataRequest[] = [];
    const client = createDataClient((request) => sent.push(request));
    const query = { spec, day: { tick: null }, viewport, node: 'x' };
    // A search hit's locate, a jump link's typed at the same moment, the next search hit's, the next jump link's.
    const search = client.locate({ ...query, offers: true });
    const jump = client.locate({ ...query, offers: false });
    const nextSearch = client.locate({ ...query, offers: true });
    const nextJump = client.locate({ ...query, offers: false });
    // Only the older search hit's is cancelled; neither jump link's is, nor does one cancel a search's.
    await expect(search).rejects.toSatisfy(isDataCancelled);
    client.receive({ type: 'locate', id: 2, answer: { kind: 'missing' } });
    client.receive({ type: 'locate', id: 3, answer: { kind: 'shown' } });
    client.receive({ type: 'locate', id: 4, answer: { kind: 'missing' } });
    await expect(jump).resolves.toEqual({ kind: 'missing' });
    await expect(nextSearch).resolves.toEqual({ kind: 'shown' });
    await expect(nextJump).resolves.toEqual({ kind: 'missing' });
    expect(sent.map((request) => (request.type === 'locate' ? request.query.offers : null))).toEqual([
      true,
      false,
      true,
      false,
    ]);
    // An aborted signal still cancels a jump link's.
    const controller = new AbortController();
    const aborted = client.locate({ ...query, offers: false }, { signal: controller.signal });
    controller.abort();
    await expect(aborted).rejects.toSatisfy(isDataCancelled);
  });

  it('rejects everything when the worker fails or the client is disposed', async () => {
    const client = createDataClient(() => undefined);
    const pending = client.scene(spec, viewport);
    client.fail('worker died');
    await expect(pending).rejects.toThrow('worker died');
    client.dispose();
    await expect(client.lenses()).rejects.toSatisfy(isDataCancelled);
    client.receive('junk');
  });
});
