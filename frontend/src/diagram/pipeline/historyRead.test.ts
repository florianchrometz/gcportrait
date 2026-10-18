// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
/**
 * A history's day read as any export is read, its unchanged assets shared with the days read before: whether
 * read whole or from its difference to the day read before, the snapshot is the one ingest reads from the day's whole
 * NDJSON, and an asset no mutation touched is the very Asset an earlier day read.
 */
import {
  DEMO_TODAY,
  historyFor,
  snapshotAt,
  toCaiNdjson,
  type DemoOrganization,
} from '@gcportrait/demo-data';
import { ingest, type IngestOptions } from '@gcportrait/ingest';
import type { Asset } from '@gcportrait/model';
import { describe, expect, it, vi } from 'vitest';

import { demoReadOptions } from '../testing/demoData';
import { readHistoryDay } from './historyRead';

// The real ingest, watched: a day read from its difference sends only the lines not read before through it.
vi.mock('@gcportrait/ingest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@gcportrait/ingest')>();
  return { ...actual, ingest: vi.fn(actual.ingest) };
});

/** How a demo organisation's day is read: at the day's read time, with a fixed clock and entropy. */
function options(organisation: DemoOrganization): IngestOptions {
  return demoReadOptions({
    readTime: organisation.readTime,
    source: { kind: 'demo', detail: `demo:${organisation.size}` },
  });
}

async function plainRead(organisation: DemoOrganization, assets: readonly Asset[] = organisation.assets) {
  return (await ingest(toCaiNdjson(assets), options(organisation))).snapshot;
}

describe('readHistoryDay', () => {
  // Under 2 s each on an idle machine, several times that on a loaded one or under coverage: hence the timeout.
  it.each(['S', 'M'] as const)(
    'reads every day of demo %s as ingest reads its whole NDJSON, stepping back and jumping',
    async (size) => {
      const days = historyFor(size, undefined, DEMO_TODAY);
      const back = days.ticks.map((_, index) => days.ticks.length - 1 - index);
      for (const index of [...back, 10, 30, 0, 34, 33, 12, 12]) {
        const day = snapshotAt(days, index);
        expect(await readHistoryDay(day.assets, options(day)), `${size} ${day.tick}`).toEqual(
          await plainRead(day),
        );
      }
    },
    30_000,
  );

  it('sends through ingest only the lines of the assets no day read before', async () => {
    const days = historyFor('M', undefined, DEMO_TODAY);
    const lines = (): number[] =>
      vi
        .mocked(ingest)
        .mock.calls.map(([input]) => (typeof input === 'string' ? input.split('\n').length - 1 : -1));
    const lastDay = snapshotAt(days, days.ticks.length - 1);
    const dayBefore = snapshotAt(days, days.ticks.length - 2);
    vi.mocked(ingest).mockClear();
    await readHistoryDay(lastDay.assets, options(lastDay));
    await readHistoryDay(dayBefore.assets, options(dayBefore));
    await readHistoryDay(lastDay.assets, options(lastDay));
    const unchanged = new Set(lastDay.assets);
    // Read whole (another history was read last), then the day before's new assets only, then none at all.
    expect(lines()).toEqual([
      lastDay.assets.length,
      dayBefore.assets.filter((asset) => !unchanged.has(asset)).length,
      0,
    ]);
  });

  const history = historyFor('S', undefined, DEMO_TODAY);
  const last = snapshotAt(history, history.ticks.length - 1);
  // The latest earlier day that differs from the last one.
  const earlier = history.ticks
    .map((_, index) => snapshotAt(history, index))
    .reverse()
    .find((day) => day.assets.some((asset) => !last.assets.includes(asset)));

  it('reads a day as ingest reads its NDJSON, and shares the assets an earlier day read', async () => {
    if (earlier === undefined) throw new Error('demo S has a day that differs from its last');
    const lastRead = await readHistoryDay(last.assets, options(last));
    const earlierRead = await readHistoryDay(earlier.assets, options(earlier));
    expect(lastRead).toEqual(await plainRead(last));
    expect(earlierRead).toEqual(await plainRead(earlier));
    const readLast = new Map(lastRead.assets.map((asset) => [asset.name, asset]));
    const unchanged = new Set(last.assets);
    let shared = 0;
    let own = 0;
    earlier.assets.forEach((source, index) => {
      const asset = earlierRead.assets[index];
      if (unchanged.has(source)) {
        expect(asset).toBe(readLast.get(source.name));
        shared += 1;
      } else {
        if (readLast.has(source.name)) expect(asset).not.toBe(readLast.get(source.name));
        own += 1;
      }
    });
    expect(shared).toBeGreaterThan(0);
    expect(own).toBeGreaterThan(0);
    // Read again, a day is the same snapshot with the same assets.
    const again = await readHistoryDay(earlier.assets, options(earlier));
    expect(again.assets).toEqual(earlierRead.assets);
    again.assets.forEach((asset, index) => {
      expect(asset).toBe(earlierRead.assets[index]);
    });
  });

  it('shares nothing when ingest refuses a line, so the assets read stay in step with the lines', async () => {
    const before = await readHistoryDay(last.assets, options(last));
    const [first, ...rest] = last.assets;
    if (first === undefined) throw new Error('demo S has assets');
    const broken: Asset = { ...first, ancestors: ['nowhere/1'] };
    const read = await readHistoryDay([broken, ...rest], options(last));
    expect(read).toEqual(await plainRead(last, [broken, ...rest]));
    expect(read.assets).toHaveLength(rest.length);
    read.assets.forEach((asset, index) => {
      expect(asset).not.toBe(before.assets[index + 1]);
    });
  });
});
