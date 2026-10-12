// SPDX-License-Identifier: MIT
/**
 * Demo organisation data for the tests, without building a Scene (demoScenes.ts does that): the ids of demo S that
 * its history's days add, remove and change, a day of demo S read as any export is read (ingest with a fixed
 * clock and entropy), and "Try the demo"'s prepared record, made once per size per test file (its Blobs are
 * immutable, so the tests that only need the record share it; demo.test.ts checks the preparation itself).
 */
import { DEMO_TODAY, historyFor, snapshotAt, toCaiNdjson, type DemoHistory } from '@gcportrait/demo-data';
import { ingest, type IngestOptions } from '@gcportrait/ingest';
import type { DemoSize, Snapshot } from '@gcportrait/model';

import type { PreparedSnapshot } from '../../snapshots/worker/protocol';
import { prepareDemo } from '../pipeline/demo';

/** Nodes of demo S that its history touches, as the diff tests and the baselines name them. */
export const DEMO_S = {
  /** Removed on 8 September. */
  scratchBucket: '//storage.googleapis.com/demo-data-1-scratch-1',
  /** Added on 8 September. */
  debugSubscription: '//pubsub.googleapis.com/projects/demo-svc-1/subscriptions/debug-2',
  /** Changed on 8 September (a label); holds the subscription. */
  servicesProject: '//cloudresourcemanager.googleapis.com/projects/10000000009',
  /** Held the scratch bucket. */
  dataProject: '//cloudresourcemanager.googleapis.com/projects/10000000010',
  /** Marked for deletion on 17 September, with what it holds. */
  reportsProject: '//cloudresourcemanager.googleapis.com/projects/10000000006',
  reportsVm: '//compute.googleapis.com/projects/demo-reports-1/zones/europe-west3-a/instances/report-vm-1',
  reportsNetwork: '//compute.googleapis.com/projects/demo-reports-1/global/networks/vpc-reports',
  /** A VM in the web project's subnet (the overview lens's selection baseline, a console link). */
  webVm: '//compute.googleapis.com/projects/demo-web-1/zones/europe-west3-a/instances/web-1mnl',
  /** The global forwarding rule of the load-balancing lens's chain. */
  forwardingRule: '//compute.googleapis.com/projects/demo-web-1/global/forwardingRules/web-https-fr',
} as const;

/** The organisation demo S is, as ingest names it. */
export const DEMO_SCOPE: Snapshot['scope'] = {
  kind: 'organization',
  id: '30000000001',
  displayName: 'example.com',
};

let history: DemoHistory | null = null;

/** Demo S's 35-day history, ending on the demo's day (the default seed), as the data worker replays it. */
export function demoSHistory(): DemoHistory {
  history ??= historyFor('S', undefined, DEMO_TODAY);
  return history;
}

/** How a demo day is read: the read time and the source; the scope (default: demo S's), clock and entropy. */
export interface DemoRead {
  readonly readTime: string;
  readonly source: Snapshot['source'];
  readonly scope?: Snapshot['scope'];
  readonly origin?: IngestOptions['readTimeOrigin'];
  /** The time ingest's clock says (it makes the snapshot id); default: the read time. */
  readonly now?: string;
}

/** Ingest's options for a demo read: fixed, so the same input always gives the same snapshot. */
export function demoReadOptions(read: DemoRead): IngestOptions {
  return {
    scope: read.scope ?? DEMO_SCOPE,
    source: read.source,
    readTime: read.readTime,
    ...(read.origin === undefined ? {} : { readTimeOrigin: read.origin }),
    clock: () => Date.parse(read.now ?? read.readTime),
    entropy: () => 0.5,
  };
}

/** Demo S's assets on `day` (`YYYY-MM-DD`), read as an export or a pull is read. */
export async function ingestDemoDay(day: string, read: DemoRead): Promise<Snapshot> {
  const assets = snapshotAt(demoSHistory(), day).assets;
  return (await ingest(toCaiNdjson(assets), demoReadOptions(read))).snapshot;
}

const prepared = new Map<DemoSize, Promise<PreparedSnapshot>>();

/** "Try the demo"'s record of demo organisation `size` with its history, prepared once per test file. */
export function preparedDemo(size: DemoSize): Promise<PreparedSnapshot> {
  let entry = prepared.get(size);
  if (entry === undefined) {
    entry = prepareDemo(size);
    prepared.set(size, entry);
  }
  return entry;
}
