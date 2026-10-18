// SPDX-License-Identifier: Apache-2.0
/**
 * The Snapshots page's "Timelines by scope" (ScopeTimelines.tsx), with a fake snapshot library and the
 * real tick cache over fake-indexeddb: each scope this browser keeps something of, its snapshots, its exports and
 * pulls (extra ticks, an estimated read time marked) and its cached days in time order with their sizes and a
 * summary; deleting an extra tick (after a confirmation), a cached day (at once) and a scope's cached days (after a
 * confirmation), each followed by focus on the scope's heading, or the section's when the scope is gone, and a
 * status; no "Delete the cached days" without any; axe.
 */
import 'fake-indexeddb/auto';

import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { createDatabaseConnection } from '../storage/connection';
import type { StoredTick } from '../storage/db';
import * as storage from '../storage/db';
import { createTickCacheStore } from '../storage/tickCache';
import { expectNoAxeViolations } from '../test/axe';
import { TEST_OPEN_TIMEOUT_MS, useFreshIndexedDb } from '../test/indexedDb';
import { renderApp, WHOLE_APP_TIMEOUT } from '../test/renderApp';
import { storedTick } from '../timeline/testing/fixtures';
import { fakeLibrary, storedRecord } from './testing';

const EXPORT = '01J0000000000000000000000E';
const PULL = '01J0000000000000000000000P';

const { closeAfter, database } = useFreshIndexedDb();

/** Day `date` of `scope` in the tick cache, taking `bytes`. */
const day = (scope: string, date: string, bytes = 1_500): StoredTick => storedTick(scope, date, { bytes });

async function openPage(ticks: readonly StoredTick[] = []) {
  const connection = createDatabaseConnection((onClose) =>
    storage.openDatabase(TEST_OPEN_TIMEOUT_MS, onClose),
  );
  closeAfter(async () => {
    (await connection.database())?.close();
  });
  const cache = createTickCacheStore(connection.database);
  for (const tick of ticks) await cache.put(tick, '2026-10-10');
  const snapshots = fakeLibrary({
    records: [
      storedRecord('demo:M', {
        detail: 'demo:M',
        historyTicks: 35,
        bytes: 300_000,
        savedAt: '2026-10-10T11:00:00Z',
      }),
      storedRecord(EXPORT, {
        source: 'export',
        detail: 'export.json',
        readTime: '2026-10-05T14:30:00Z',
        readTimeSource: 'export-sidecar',
        bytes: 120_000,
        assetCount: 955,
      }),
      storedRecord(PULL, {
        source: 'api',
        detail: 'live pull',
        readTime: '2026-10-07T09:12:00Z',
        readTimeSource: 'estimated-max-update-time',
        estimatedReadTime: true,
        bytes: 80_000,
      }),
    ],
  });
  const view = renderApp('/snapshots', { snapshots, database: connection });
  const section = await screen.findByRole('region', { name: 'Timelines by scope' });
  return { ...view, section, snapshots, cache };
}

function scopeRegion(section: HTMLElement, name: RegExp): HTMLElement {
  return within(section).getByRole('region', { name });
}

function rowsOf(region: HTMLElement): string[][] {
  return within(region)
    .getAllByRole('row')
    .slice(1)
    .map((row) => [...row.querySelectorAll('th, td')].slice(0, 4).map((cell) => cell.textContent));
}

describe('the timelines by scope', () => {
  it(
    'opens its explicit connection with the test timeout and persists its ticks',
    WHOLE_APP_TIMEOUT,
    async () => {
      const open = vi.spyOn(storage, 'openDatabase');
      try {
        const tick = day('organizations/30000000001', '2026-10-06');
        const app = await openPage([tick]);
        expect(open).toHaveBeenCalledExactlyOnceWith(TEST_OPEN_TIMEOUT_MS, expect.any(Function));
        expect(await app.cache.persistent()).toBe(true);
        app.unmount();
        expect(await (await database()).get('tickCache', tick.key)).toMatchObject({
          key: tick.key,
          scope: tick.scope,
          day: tick.day,
          bytes: tick.bytes,
          assetCount: tick.assetCount,
        });
      } finally {
        open.mockRestore();
      }
    },
  );

  it('lists each scope’s snapshots, extra ticks and cached days in time order, with sizes and a summary', async () => {
    const { section } = await openPage([
      day('organizations/30000000001', '2026-10-06'),
      day('organizations/30000000001', '2026-10-09', 2_500),
      day('folders/20000000001', '2026-10-02'),
    ]);
    const org = await waitFor(() => scopeRegion(section, /^example\.com/));
    expect(within(org).getByRole('heading', { level: 3 }).textContent).toBe(
      'example.comOrganisation 30000000001',
    );
    expect(rowsOf(org)).toEqual([
      [
        '2026-10-05 14:30 UTC',
        "Extra tick · Export fileread time from the export's operation.json · export.json",
        '955',
        '120 kB',
      ],
      [
        '2026-10-06 00:00 UTC',
        'Cached dayread from Cloud Asset Inventory on 2026-10-10 12:00 UTC',
        '40',
        '1.5 kB',
      ],
      [
        '2026-10-07 09:12 UTCestimated',
        'Extra tick · API pullread time estimated from the latest asset change · live pull',
        '952',
        '80.0 kB',
      ],
      ['2026-10-08 00:00 UTC', 'Snapshot · Demo · 35-day historydemo:M', '952', '300 kB'],
      [
        '2026-10-09 00:00 UTC',
        'Cached dayread from Cloud Asset Inventory on 2026-10-10 12:00 UTC',
        '40',
        '2.5 kB',
      ],
    ]);
    expect(
      within(org).getByText('1 snapshot, 2 extra ticks and 2 cached days: 504 kB in this browser.'),
    ).toBeDefined();
    const folder = scopeRegion(section, /^Folder 20000000001/);
    expect(within(folder).getByText('1 cached day: 1.5 kB in this browser.')).toBeDefined();
    expect(within(folder).getAllByRole('row')).toHaveLength(2);
    await expectNoAxeViolations(section);
  }, 20_000);

  it('deletes an extra tick after a confirmation, then focuses the scope', async () => {
    const { section, snapshots } = await openPage();
    const org = await waitFor(() => scopeRegion(section, /^example\.com/));
    const button = within(org).getByRole('button', {
      name: /^Delete the extra tick example\.com, read 2026-10-05 14:30 UTC/,
    });
    await userEvent.click(button);
    const dialog = screen.getByRole('dialog', { name: 'Delete this extra tick?' });
    expect(dialog.textContent).toContain('955 assets');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(snapshots.calls).not.toContain(`remove ${EXPORT}`);
    await userEvent.click(button);
    await userEvent.click(
      within(screen.getByRole('dialog', { name: 'Delete this extra tick?' })).getByRole('button', {
        name: 'Delete',
      }),
    );
    await waitFor(() => {
      expect(snapshots.calls).toContain(`remove ${EXPORT}`);
      expect(within(section).getByRole('status').textContent).toMatch(
        /^Deleted the extra tick example\.com, read 2026-10-05 14:30 UTC/,
      );
    });
    expect(document.activeElement).toBe(
      within(scopeRegion(section, /^example\.com/)).getByRole('heading', { level: 3 }),
    );
    await waitFor(() => {
      expect(rowsOf(scopeRegion(section, /^example\.com/))).toHaveLength(2);
    });
  }, 20_000);

  it('deletes a cached day at once, and a scope’s cached days after a confirmation', async () => {
    const { section, cache } = await openPage([
      day('organizations/30000000001', '2026-10-06'),
      day('organizations/30000000001', '2026-10-09'),
      day('folders/20000000001', '2026-10-02'),
      day('folders/20000000001', '2026-10-03'),
    ]);
    const org = await waitFor(() => scopeRegion(section, /^example\.com/));
    await userEvent.click(
      within(org).getByRole('button', {
        name: 'Delete the cached day 2026-10-06 of example.com (Organisation 30000000001)',
      }),
    );
    await waitFor(() => {
      expect(within(section).getByRole('status').textContent).toBe(
        'Deleted the cached day 2026-10-06 of example.com.',
      );
    });
    expect((await cache.list()).map((tick) => tick.day).sort()).toEqual([
      '2026-10-02',
      '2026-10-03',
      '2026-10-09',
    ]);
    await waitFor(() => {
      expect(rowsOf(scopeRegion(section, /^example\.com/))).toHaveLength(4);
    });

    // The folder keeps nothing but cached days: deleting them all takes its part away; focus goes to the section.
    const folder = scopeRegion(section, /^Folder 20000000001/);
    await userEvent.click(
      within(folder).getByRole('button', { name: 'Delete the cached days of Folder 20000000001…' }),
    );
    const dialog = screen.getByRole('dialog', { name: 'Delete the cached days?' });
    expect(dialog.textContent).toContain(
      '2 days of Folder 20000000001 read from Cloud Asset Inventory (3.0 kB)',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    // The part goes in the render that closes the dialog, the message in the next one: wait for both.
    await waitFor(() => {
      expect(within(section).queryByRole('region', { name: /^Folder 20000000001/ })).toBeNull();
      expect(within(section).getByRole('status').textContent).toBe(
        'Deleted 2 cached days of Folder 20000000001.',
      );
    });
    expect(document.activeElement).toBe(
      screen.getByRole('heading', { level: 2, name: 'Timelines by scope' }),
    );
    expect((await cache.list()).map((tick) => tick.day)).toEqual(['2026-10-09']);
  }, 20_000);

  it('offers no "Delete the cached days" for a scope without any', async () => {
    const { section } = await openPage();
    const org = await waitFor(() => scopeRegion(section, /^example\.com/));
    expect(within(org).queryByRole('button', { name: /^Delete the cached days/ })).toBeNull();
    expect(within(org).getByText('1 snapshot and 2 extra ticks: 500 kB in this browser.')).toBeDefined();
  });
});
