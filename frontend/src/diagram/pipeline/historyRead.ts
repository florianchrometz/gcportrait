// SPDX-License-Identifier: MIT
/**
 * One day of a history (a demo organisation's, or a stored one's) read as any export is read: its assets as CAI
 * NDJSON through `@gcportrait/ingest`. demo.ts reads a demo organisation's last day this way, and
 * timeline/worker/replay.ts every other day of a history.
 *
 * The days of a history share their assets. A day is the history's base with its daily mutations replayed
 * (`snapshotAt` of `@gcportrait/demo-data`), so an asset no mutation touched is the same object on every day, and
 * ingest reads each line on its own, so the same object always reads as the same Asset. So every history asset is
 * read through ingest once, the first time a day holds it, and that Asset is the one every later day's snapshot
 * holds:
 *
 * - The first day read (and any day that differs from the day read before it in more than a quarter of its assets)
 *   is read whole, and its assets are replaced by the ones read before for the same history assets.
 * - Any other day is read from its difference to the day read before: only the lines of the history assets not
 *   read before go through ingest, with the day's options, and the snapshot is that read's, with the day's assets
 *   in the day's order and the day's counts: `count`, `byType` in code-point order of the types, and `bytes`, the
 *   UTF-8 size of the day's whole NDJSON (the day before's, less the lines it lost, plus the lines it gained).
 *
 * Either way the snapshot is deep-equal to the day's whole NDJSON read by ingest (historyRead.test.ts checks every
 * day of demo S and M), the Graphs of a history's days share what the builder worked out per asset (`BuildMemo` of
 * `@gcportrait/graph`, dataHandler.ts), and the days the data worker keeps share their memory.
 */
import { toCaiNdjson } from '@gcportrait/demo-data';
import { ingest, type IngestOptions } from '@gcportrait/ingest';
import type { Asset, Snapshot } from '@gcportrait/model';

/** The Asset first read for each history asset (held weakly: a history no longer kept takes its own with it). */
const firstRead = new WeakMap<Asset, Asset>();

/** A day read: its history assets in order, and the UTF-8 size of its NDJSON (`stats.bytes`). */
interface DayRead {
  readonly sources: readonly Asset[];
  readonly bytes: number;
}

/** The day read last (of any history: two histories share no asset, so a day of another one is read whole). */
let lastDay: DayRead | null = null;

/** A day that differs from the day read before in more than this share of its assets is read whole. */
const MAX_DIFFERENCE = 0.25;

const encoder = new TextEncoder();

/** The UTF-8 size of a history asset's NDJSON line, its line feed included. */
function lineBytes(source: Asset): number {
  return encoder.encode(toCaiNdjson([source])).length;
}

/** Asset counts by type, the types in code-point order (as ingest counts a snapshot's `stats.byType`). */
function countByType(assets: readonly Asset[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const asset of assets) counts.set(asset.assetType, (counts.get(asset.assetType) ?? 0) + 1);
  return Object.fromEntries([...counts].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/**
 * The assets read, each replaced by the Asset read before for the same history asset. Ingest keeps the lines'
 * order and a history's names are unique, so the i-th asset read is the i-th one written; when that does not hold
 * (a line ingest refused), the assets are returned as read.
 */
function shareAssets(written: readonly Asset[], read: Asset[]): Asset[] {
  if (written.length !== read.length) return read;
  const assets: Asset[] = [];
  let replaced = 0;
  for (let index = 0; index < read.length; index += 1) {
    const source = written[index];
    const asset = read[index];
    if (source === undefined || asset === undefined || source.name !== asset.name) return read;
    const earlier = firstRead.get(source);
    if (earlier === undefined) firstRead.set(source, asset);
    else replaced += 1;
    assets.push(earlier ?? asset);
  }
  return replaced === 0 ? read : assets;
}

/** The day read whole. */
async function readWhole(sources: readonly Asset[], options: IngestOptions): Promise<Snapshot> {
  const { snapshot } = await ingest(toCaiNdjson(sources), options);
  const shared = shareAssets(sources, snapshot.assets);
  return shared === snapshot.assets ? snapshot : { ...snapshot, assets: shared };
}

/**
 * The day read from its difference to `last`, or null when it is to be read whole: it differs too much, or ingest
 * refused a line of it (the whole read reports and counts it as any read does).
 */
async function readDifference(
  last: DayRead,
  sources: readonly Asset[],
  options: IngestOptions,
): Promise<Snapshot | null> {
  const before = new Set(last.sources);
  const now = new Set(sources);
  const lost = last.sources.filter((source) => !now.has(source));
  const gained = sources.filter((source) => !before.has(source));
  if (lost.length + gained.length > sources.length * MAX_DIFFERENCE) return null;
  const unread = sources.filter((source) => !firstRead.has(source));
  const isUnread = new Set(unread);
  const { snapshot } = await ingest(toCaiNdjson(unread), options);
  const assets: Asset[] = [];
  let next = 0;
  for (const source of sources) {
    const asset = isUnread.has(source) ? snapshot.assets[next++] : firstRead.get(source);
    if (asset?.name !== source.name) return null;
    assets.push(asset);
  }
  if (next !== snapshot.assets.length) return null;
  unread.forEach((source, index) => {
    const asset = snapshot.assets[index];
    if (asset !== undefined && !firstRead.has(source)) firstRead.set(source, asset);
  });
  let bytes = last.bytes;
  for (const source of lost) bytes -= lineBytes(source);
  for (const source of gained) bytes += lineBytes(source);
  return { ...snapshot, assets, stats: { count: assets.length, byType: countByType(assets), bytes } };
}

/** The snapshot of a history's day, its assets shared with the days of the same history read before. */
export async function readHistoryDay(sources: readonly Asset[], options: IngestOptions): Promise<Snapshot> {
  const last = lastDay;
  const quick = last === null ? null : await readDifference(last, sources, options);
  const snapshot = quick ?? (await readWhole(sources, options));
  lastDay = { sources, bytes: snapshot.stats.bytes };
  return snapshot;
}
