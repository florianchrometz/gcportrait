// SPDX-License-Identifier: MIT
/**
 * The demo organisations in the workers, the only places the demo generator runs (never on the UI thread, never in
 * the snapshot worker; agents.md, Architecture and code). The data worker's handler (dataHandler.ts)
 * imports this module on first use to draw a demo organisation, so a stored snapshot is drawn without loading the
 * generator at all; the demo worker (demoRole.ts), started for one "Try the demo" job, imports it to prepare one.
 *
 * - `demoSnapshot`: the snapshot of a history's last day, read the way any export is read (CAI NDJSON through
 *   `@gcportrait/ingest` at the demo's day, with a fixed clock and entropy), so the same organisation always gives
 *   the same snapshot, and so the same diagram.
 * - `prepareDemo`: "Try the demo" (the snapshot library's `tryDemo`): the 35-day history from
 *   `@gcportrait/demo-data` (the base and the daily mutations, never 35 copies) and that snapshot, both encoded for
 *   storage under the ref `demo:<size>` (../../snapshots/worker/prepare.ts), so the stored snapshot and the drawn
 *   one are the same document (demo.test.ts compares them).
 */
import {
  DEMO_ORGANIZATION_DOMAIN,
  DEMO_ORGANIZATION_IDS,
  DEMO_TODAY,
  historyFor,
  snapshotAt,
  type DemoHistory,
} from '@gcportrait/demo-data';
import type { DemoSize, Snapshot } from '@gcportrait/model';

import type { PreparedSnapshot } from '../../snapshots/worker/protocol';
import { prepareSnapshot, type Report } from '../../snapshots/worker/prepare';
import { readHistoryDay } from './historyRead';

// The last history generated: the timeline replays its days, so it is generated once per organisation.
let lastHistory: DemoHistory | null = null;

/** The history of demo organisation `size` (the default seed, ending on the demo's day); the last one is kept. */
export function demoHistory(size: DemoSize): DemoHistory {
  if (lastHistory?.size !== size) lastHistory = historyFor(size, undefined, DEMO_TODAY);
  return lastHistory;
}

/**
 * The snapshot of the history's last day, as the data worker draws `demo:<size>` (historyRead.ts: its assets are the
 * ones the history's other days share).
 */
export async function demoSnapshot(history: DemoHistory): Promise<Snapshot> {
  const organisation = snapshotAt(history, history.ticks.length - 1);
  const readTime = `${DEMO_TODAY}T00:00:00Z`;
  return readHistoryDay(organisation.assets, {
    // Each size its own organisation, so one size's exports are not extra ticks of another's timeline.
    scope: {
      kind: 'organization',
      id: DEMO_ORGANIZATION_IDS[history.size],
      displayName: DEMO_ORGANIZATION_DOMAIN,
    },
    source: { kind: 'demo', detail: `demo:${history.size}` },
    readTime,
    clock: () => Date.parse(readTime),
    entropy: () => 0.5,
  });
}

/** Demo organisation `size` with its history, ready to store as `demo:<size>`. */
export async function prepareDemo(
  size: DemoSize,
  report: Report = () => undefined,
): Promise<PreparedSnapshot> {
  report({ stage: 'generate' });
  const history = demoHistory(size);
  report({ stage: 'read' });
  const snapshot = await demoSnapshot(history);
  report({ stage: 'read', assets: snapshot.assets.length });
  const ref = `demo:${size}`;
  return prepareSnapshot(snapshot, { id: ref, detail: ref, history }, report);
}
