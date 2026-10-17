// SPDX-License-Identifier: MIT
/**
 * The snapshot readers against the app's own import: a demo organisation's assets as a Cloud Asset
 * Inventory export and as a live pull's frames, and as a `.gcportrait.json` bundle, give back the snapshot the demo
 * loader reads, so a render of either is the demo's drawing. Refusals carry the app's messages. Synthetic data only.
 */
import { DEMO_ORGANIZATION_IDS, DEMO_TODAY, toCaiAsset, toCaiNdjson } from '@gcportrait/demo-data';
import { RenderOptionsSchema, type Snapshot } from '@gcportrait/model';
import { describe, expect, it } from 'vitest';

import {
  checkAssetCount,
  createSnapshotReader,
  renderView,
  snapshotFromBundle,
  snapshotFromDemo,
  SnapshotInputError,
} from '../src/index.js';
import type { NdjsonSettings } from '../src/snapshot.js';

const READ_TIME = `${DEMO_TODAY}T00:00:00Z`;
const encoder = new TextEncoder();

/** Pushes `text` in chunks of `size` bytes, splitting lines anywhere. */
async function read(text: string, settings: Partial<NdjsonSettings> = {}, size = 4096): Promise<Snapshot> {
  const reader = createSnapshotReader({
    kind: 'export',
    scope: null,
    detail: 'upload',
    maxAssets: 60_000,
    clock: () => Date.parse(READ_TIME),
    entropy: () => 0.5,
    ...settings,
  });
  const bytes = encoder.encode(text);
  for (let at = 0; at < bytes.byteLength; at += size) reader.push(bytes.subarray(at, at + size));
  return reader.end();
}

async function failure(promise: Promise<unknown>): Promise<SnapshotInputError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof SnapshotInputError) return error;
    throw error;
  }
  throw new Error('expected a SnapshotInputError');
}

const svgOf = (snapshot: Snapshot): string =>
  new TextDecoder().decode(renderView(snapshot, RenderOptionsSchema.parse({ format: 'svg' })).bytes);

describe('NDJSON, read by the app’s import handler', () => {
  it('reads an export into the snapshot the demo draws: scope inferred, read time given', async () => {
    const demo = await snapshotFromDemo('S');
    const snapshot = await read(toCaiNdjson(demo.assets), {
      readTime: READ_TIME,
    });
    expect(snapshot.assets).toHaveLength(96);
    expect(snapshot.scope).toEqual({
      kind: 'organization',
      id: DEMO_ORGANIZATION_IDS.S,
      displayName: 'example.com',
    });
    expect(snapshot.source).toEqual({ kind: 'export', detail: 'upload' });
    expect(snapshot.readTime).toBe(READ_TIME);
    expect(svgOf(snapshot)).toBe(svgOf(demo));
  });

  it('reads a live pull’s frames, and refuses a pull cut short or ended by an error frame', async () => {
    const demo = await snapshotFromDemo('S');
    const page = JSON.stringify({ t: 'page', assets: demo.assets.map(toCaiAsset) });
    const frames = (end: string): string =>
      `{"t":"progress","pages":0,"assets":0}\n${page}\n{"t":"progress","pages":1,"assets":96}\n${end}`;
    const pull: Partial<NdjsonSettings> = {
      kind: 'pull',
      scope: { kind: 'organization', id: DEMO_ORGANIZATION_IDS.S },
      detail: 'live pull',
    };
    const snapshot = await read(frames(`{"t":"done","assets":96,"readTime":"${READ_TIME}"}\n`), pull, 1000);
    expect(snapshot.scope.displayName).toBe('example.com');
    expect(snapshot.source.kind).toBe('api');
    expect(svgOf(snapshot)).toBe(svgOf(demo));
    expect((await failure(read(frames(''), pull))).code).toBe('CUT_SHORT');
    const refused = await failure(
      read(
        frames(
          '{"t":"error","message":"Denied.","status":403,"code":"PERMISSION_DENIED","reason":"IAM_PERMISSION_DENIED"}\n',
        ),
        pull,
      ),
    );
    expect(refused).toMatchObject({
      code: 'UPSTREAM',
      message: 'Denied.',
      upstream: { status: 403, code: 'PERMISSION_DENIED', reason: 'IAM_PERMISSION_DENIED' },
    });
  });

  it('refuses no assets, a bundle sent as NDJSON, and more assets than the limit', async () => {
    expect((await failure(read('\n\n'))).code).toBe('EMPTY_SNAPSHOT');
    const bundle = await failure(read('{"format":"gcportrait.snapshot","version":1}'));
    expect(bundle.code).toBe('INVALID_FILE');
    expect(bundle.message).toMatch(/source kind bundle/);
    const demo = await snapshotFromDemo('S');
    expect((await failure(read(toCaiNdjson(demo.assets), { maxAssets: 10 }, 512))).code).toBe(
      'TOO_MANY_ASSETS',
    );
    const reader = createSnapshotReader({ kind: 'export', scope: null, detail: 'x', maxAssets: 10 });
    reader.cancel();
    expect((await failure(reader.end())).code).toBe('CANCELLED');
  });
});

describe('bundles and limits', () => {
  it('reads a bundle’s snapshot, and refuses what is not one, with the app’s messages', async () => {
    const demo = await snapshotFromDemo('S');
    const text = JSON.stringify({
      format: 'gcportrait.snapshot',
      version: 1,
      exportedAt: READ_TIME,
      generator: 'gcportrait',
      snapshot: demo,
    });
    expect(svgOf(snapshotFromBundle(text))).toBe(svgOf(demo));
    expect(() => snapshotFromBundle('{"name":"//x/1","assetType":"x/y"}\n')).toThrow(/source kind ndjson/);
    expect(() => snapshotFromBundle('{"format":"gcportrait.snapshot","version":9,"snapshot":{}}')).toThrow(
      /uses version 9/,
    );
    expect(() => snapshotFromBundle('{"format":"gcportrait.snapshot","version":1,"snapshot":{}}')).toThrow(
      SnapshotInputError,
    );
    expect(() => checkAssetCount(demo, 95)).toThrow(/more than 95 assets/);
    expect(checkAssetCount(demo, 96)).toBe(demo);
    expect(() => checkAssetCount({ ...demo, assets: [] }, 96)).toThrow(/no assets/);
  });
});
