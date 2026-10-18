// SPDX-License-Identifier: Apache-2.0
/**
 * One day of a stored history as a snapshot, in the data worker (docs/timeline.md): `snapshotAt` of
 * `@gcportrait/demo-data` (the generator-free replay) applies the daily mutations up to the day, and the
 * assets are read as any export is read, CAI NDJSON through `@gcportrait/ingest`, with the snapshot's own scope and
 * source and a clock fixed at the day's read time, exactly as diagram/pipeline/demo.ts reads a demo organisation's
 * last day. So a demo day is the same snapshot every time, and the last day is the snapshot itself. The days of a
 * history share the assets no mutation touched (diagram/pipeline/historyRead.ts). Loaded on the first tick a
 * history is asked for (timeline/worker/source.ts).
 */
import { snapshotAt, type DemoHistory } from '@gcportrait/demo-data';
import type { Snapshot } from '@gcportrait/model';

import { readHistoryDay } from '../../diagram/pipeline/historyRead';

/** The snapshot of `base`'s scope on `day` of its history (its unchanged assets shared with the other days). */
export function historySnapshot(history: DemoHistory, day: string, base: Snapshot): Promise<Snapshot> {
  const organisation = snapshotAt(history, day);
  const readTime = organisation.readTime;
  return readHistoryDay(organisation.assets, {
    scope: base.scope,
    source: base.source,
    readTime,
    clock: () => Date.parse(readTime),
    entropy: () => 0.5,
  });
}
