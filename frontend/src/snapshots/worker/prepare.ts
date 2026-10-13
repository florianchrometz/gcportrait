// SPDX-License-Identifier: MIT
/**
 * A snapshot made ready to store (`PreparedSnapshot`, protocol.ts): its documents encoded for IndexedDB (../codec.ts)
 * and its listing metadata. Shared by the snapshot worker's imports (handler.ts) and the demo job
 * (diagram/pipeline/demo.ts, run by the demo worker, demoRole.ts), which prepares the demo organisations because the
 * demo generator runs in the diagram's workers only (AGENTS.md, Architecture and code). Each step is reported as
 * it starts.
 */
import type { DemoHistory } from '@gcportrait/demo-data';
import type { Snapshot } from '@gcportrait/model';

import { encodeJson } from '../codec';
import type { JobProgress, PreparedSnapshot } from './protocol';

export type Report = (progress: JobProgress) => void;

export function metaOf(
  snapshot: Snapshot,
  bytes: number,
  detail: string | undefined,
  historyTicks?: number,
): PreparedSnapshot['meta'] {
  return {
    scope: snapshot.scope,
    readTime: snapshot.readTime,
    source: snapshot.source.kind,
    assetCount: snapshot.assets.length,
    bytes,
    schemaVersion: snapshot.schemaVersion,
    ...(detail === undefined ? {} : { detail }),
    ...(snapshot.readTimeSource === 'estimated-max-update-time' ? { estimatedReadTime: true } : {}),
    // Where an export's or a pull's read time came from (the timeline marks an estimate on its extra tick). A
    // demo organisation's is fixed by the generator, so its record keeps none.
    ...(snapshot.readTimeSource === undefined || snapshot.source.kind === 'demo'
      ? {}
      : { readTimeSource: snapshot.readTimeSource }),
    ...(historyTicks === undefined ? {} : { historyTicks }),
  };
}

export interface PrepareOptions {
  /** The record's ref: `demo:<size>` for a generated demo organisation, else the snapshot's id. */
  readonly id?: string;
  readonly detail?: string;
  readonly history?: DemoHistory;
}

export async function prepareSnapshot(
  snapshot: Snapshot,
  options: PrepareOptions,
  report: Report,
): Promise<PreparedSnapshot> {
  report({ stage: 'encode' });
  const blob = await encodeJson(snapshot);
  const history = options.history === undefined ? undefined : await encodeJson(options.history);
  const meta = metaOf(
    snapshot,
    blob.size + (history?.size ?? 0),
    options.detail,
    options.history?.ticks.length,
  );
  const id = options.id ?? snapshot.id;
  return history === undefined ? { id, meta, blob } : { id, meta, blob, history };
}
