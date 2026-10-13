// SPDX-License-Identifier: MIT
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { saveFile } from '../export/deliver';
import { fakeLibrary, storedRecord } from '../snapshots/testing';
import { SnapshotJobError } from '../snapshots/worker/client';
import { DAMAGED_RECORD } from '../snapshots/worker/protocol';
import { expectNoAxeViolations } from '../test/axe';
import { currentLocation, renderApp } from '../test/renderApp';

vi.mock('../export/deliver', () => ({ saveFile: vi.fn() }));

beforeEach(() => {
  // Each test sees only its own saves.
  vi.mocked(saveFile).mockClear();
});

/** The page's file input (the import's "Choose files…"). */
function fileInput(container: HTMLElement): HTMLInputElement {
  const input = container.ownerDocument.querySelector<HTMLInputElement>('input[type="file"]');
  if (input === null) throw new Error('the file input');
  return input;
}

const IMPORTED = '01J9Z3K5Q8XW2V4N6P7R8S9T0A';

function library(options: Parameters<typeof fakeLibrary>[0] = {}) {
  return fakeLibrary({
    records: [
      storedRecord('demo:M', { detail: 'demo:M', historyTicks: 35, savedAt: '2026-10-10T11:00:00Z' }),
      storedRecord(IMPORTED, {
        source: 'export',
        detail: 'export.json',
        estimatedReadTime: true,
        assetCount: 51_242,
        bytes: 17_300_000,
        readTime: '2026-10-07T18:22:41Z',
        savedAt: '2026-10-10T12:00:00Z',
      }),
    ],
    use: { usage: 18_000_000, quota: 120_000_000_000 },
    ...options,
  });
}

async function openPage(snapshots = library()) {
  const view = renderApp('/snapshots', { snapshots });
  const table = await screen.findByRole('table', { name: 'Snapshots stored in this browser' });
  return { ...view, table, snapshots };
}

function rows(table: HTMLElement): string[][] {
  return within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) => [...row.querySelectorAll('th, td')].map((cell) => cell.textContent));
}

describe('the Snapshots page', () => {
  it('lists the stored snapshots with scope, read time, source, assets, size and stored date', async () => {
    const { table } = await openPage();
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['Scope', 'Read', 'Source', 'Assets', 'Size', 'Stored', 'Actions']);
    expect(rows(table).map((cells) => cells.slice(0, 6))).toEqual([
      [
        'example.comOrganisation 30000000001',
        '2026-10-07 18:22 UTCestimated from the latest change',
        'Export fileexport.json',
        '51,242',
        '17.3 MB',
        '2026-10-10 12:00 UTC',
      ],
      [
        'example.comOrganisation 30000000001',
        '2026-10-08 00:00 UTC',
        'Demodemo:M · 35-day history',
        '952',
        '123 kB',
        '2026-10-10 11:00 UTC',
      ],
    ]);
    expect(screen.getByText('2 snapshots take 17.4 MB in this browser.')).toBeDefined();
    expect(
      await screen.findByText(
        'The browser estimates that this site uses about 18.0 MB in all, of the 120 GB it allows. Its estimate ' +
          'can lag behind recent changes.',
      ),
    ).toBeDefined();
    await expectNoAxeViolations();
  });

  it('loads a snapshot into the diagram through the hash, a large one once the person has said so', async () => {
    const { container, table } = await openPage();
    await userEvent.click(
      within(table).getByRole('button', { name: 'Load example.com, read 2026-10-08 00:00 UTC, demo:M' }),
    );
    expect(currentLocation(container)).toBe('/diagram#snapshot=demo:M');
    await userEvent.click(screen.getByRole('link', { name: 'Snapshots' }));
    const again = await screen.findByRole('table', { name: 'Snapshots stored in this browser' });
    // 51,242 assets: the large-snapshot guard asks first (snapshots/LargeSnapshotGuard.test.tsx).
    await userEvent.click(
      within(again).getByRole('button', { name: 'Load example.com, read 2026-10-07 18:22 UTC, export.json' }),
    );
    expect(currentLocation(container)).toBe('/snapshots');
    await userEvent.click(
      within(screen.getByRole('alertdialog', { name: 'Draw a large snapshot?' })).getByRole('button', {
        name: 'Draw it anyway',
      }),
    );
    await waitFor(() => {
      expect(currentLocation(container)).toBe(`/diagram#snapshot=${IMPORTED}`);
    });
  });

  it('exports a snapshot as a file', async () => {
    const { table, snapshots } = await openPage();
    await userEvent.click(
      within(table).getByRole('button', { name: 'Export example.com, read 2026-10-08 00:00 UTC, demo:M' }),
    );
    await waitFor(() => {
      expect(saveFile).toHaveBeenCalledWith(expect.any(Blob), 'demo:M.gcportrait.json');
    });
    expect(snapshots.calls).toContain('exportFile demo:M');
    expect(
      screen.getByText(
        /Exported example\.com, read 2026-10-08 00:00 UTC, demo:M as demo:M\.gcportrait\.json\./,
      ),
    ).toBeDefined();
  });

  it('shows why a snapshot could not be exported, with the reason', async () => {
    const { table } = await openPage(
      library({
        exportError: new SnapshotJobError(DAMAGED_RECORD, ['The snapshot is not valid JSON.']),
      }),
    );
    await userEvent.click(
      within(table).getByRole('button', { name: 'Export example.com, read 2026-10-08 00:00 UTC, demo:M' }),
    );
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(
      `The snapshot could not be exported.${DAMAGED_RECORD}The snapshot is not valid JSON.`,
    );
    expect(saveFile).not.toHaveBeenCalled();
    await expectNoAxeViolations();
  });

  it('deletes a snapshot only after confirmation, and puts focus on the section heading', async () => {
    const { table, snapshots } = await openPage();
    const remove = within(table).getByRole('button', {
      name: 'Delete example.com, read 2026-10-08 00:00 UTC, demo:M',
    });
    await userEvent.click(remove);
    let dialog = screen.getByRole('dialog', { name: 'Delete this snapshot?' });
    expect(dialog.textContent).toContain('example.com, read 2026-10-08 00:00 UTC, demo:M, 952 assets.');
    await expectNoAxeViolations();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(snapshots.calls).not.toContain('remove demo:M');

    await userEvent.click(remove);
    dialog = screen.getByRole('dialog', { name: 'Delete this snapshot?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => {
      expect(rows(table)).toHaveLength(1);
    });
    expect(snapshots.calls).toContain('remove demo:M');
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Stored snapshots' }));
    expect(screen.getByText('Deleted example.com, read 2026-10-08 00:00 UTC, demo:M.')).toBeDefined();
  });

  it('deletes every snapshot after confirmation', async () => {
    const { snapshots } = await openPage();
    await userEvent.click(screen.getByRole('button', { name: 'Delete all snapshots…' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete all snapshots?' });
    expect(dialog.textContent).toContain('All 2 snapshots stored in this browser (17.4 MB) are removed.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete all' }));
    expect(await screen.findByText(/No snapshots are stored in this browser yet\./)).toBeDefined();
    expect(snapshots.calls).toContain('clear');
    expect(screen.getByRole('button', { name: 'Delete all snapshots…' }).getAttribute('aria-disabled')).toBe(
      'true',
    );
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Storage' }));
  });

  it('imports files with progress, then lists and announces them with their notes', async () => {
    const { table, snapshots, container } = await openPage();
    const input = fileInput(container);
    const file = new File(['{}'], 'org-export.json');
    fireEvent.change(input, { target: { files: [file] } });
    expect(snapshots.calls).toContain('importFiles org-export.json');
    act(() => {
      snapshots.pending()?.onProgress?.({ stage: 'read', done: 2_000_000, total: 8_000_000, assets: 1200 });
    });
    expect(screen.getByText('Reading org-export.json: 2.0 MB of 8.0 MB, 1,200 assets…')).toBeDefined();
    const progress = screen.getByRole('progressbar', { name: 'Importing' });
    expect(progress.getAttribute('value')).toBe('2000000');
    await expectNoAxeViolations();
    const record = storedRecord('01J9Z3K5Q8XW2V4N6P7R8S9T0B', {
      source: 'export',
      readTime: '2026-10-01T00:00:00Z',
    });
    await act(() =>
      snapshots.answer({
        ok: { refs: [record.id], records: [record], warnings: ['3 lines could not be read.'] },
      }),
    );
    expect(
      await screen.findByText('Imported example.com, read 2026-10-01 00:00 UTC (952 assets).'),
    ).toBeDefined();
    expect(screen.getByText('3 lines could not be read.')).toBeDefined();
    await waitFor(() => {
      expect(rows(table)).toHaveLength(3);
    });
  });

  it('shows why an import failed, with the problems found', async () => {
    const { snapshots, container } = await openPage();
    const input = fileInput(container);
    fireEvent.change(input, { target: { files: [new File(['x'], 'broken.json')] } });
    await act(() =>
      snapshots.answer({
        error: new SnapshotJobError('No assets were found in broken.json.', [
          'broken.json, line 1: not JSON',
        ]),
      }),
    );
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(
      'Nothing was imported from broken.json.No assets were found in broken.json.broken.json, line 1: not JSON',
    );
    await expectNoAxeViolations();
  });

  it('imports an export with the read time typed for it, and refuses one it cannot use', async () => {
    const { snapshots, container } = await openPage();
    const input = fileInput(container);
    const field = screen.getByRole('textbox', { name: 'When the export was taken (UTC, optional)' });
    await userEvent.type(field, '2026-10-05 25:00');
    fireEvent.change(input, { target: { files: [new File(['{}'], 'org-export.json')] } });
    expect(snapshots.calls.filter((call) => call.startsWith('importFiles'))).toEqual([]);
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Nothing was imported from org-export.json.Type the read time as 2026-10-05 14:30 (UTC), or leave it empty.',
    );
    await userEvent.clear(field);
    await userEvent.type(field, '2026-10-05 14:30');
    fireEvent.change(input, { target: { files: [new File(['{}'], 'org-export.json')] } });
    expect(snapshots.calls).toContain('importFiles org-export.json at 2026-10-05T14:30:00Z');
    await expectNoAxeViolations();
  });

  it('marks a read time typed in at the import', async () => {
    const snapshots = fakeLibrary({
      records: [
        storedRecord(IMPORTED, {
          source: 'export',
          detail: 'export.json',
          readTime: '2026-10-05T14:30:00Z',
          readTimeSource: 'user',
        }),
      ],
    });
    const { table } = await openPage(snapshots);
    expect(rows(table)[0]?.[1]).toBe('2026-10-05 14:30 UTCentered when it was imported');
  });

  it('takes dropped files', async () => {
    const { snapshots } = await openPage();
    const zone = screen.getByTestId('snapshot-drop-zone');
    const file = new File(['{}'], 'dropped.json');
    fireEvent.dragOver(zone, { dataTransfer: { types: ['Files'], files: [file], dropEffect: 'none' } });
    fireEvent.drop(zone, { dataTransfer: { types: ['Files'], files: [file] } });
    expect(snapshots.calls).toContain('importFiles dropped.json');
  });

  it('takes no dropped file from the browser while importing is off, so a drop cannot open it', async () => {
    const snapshots = fakeLibrary({
      persistent: false,
      records: [storedRecord('demo:S', { detail: 'demo:S' })],
    });
    renderApp('/snapshots', { snapshots });
    const zone = await screen.findByTestId('snapshot-drop-zone');
    const file = new File(['{}'], 'dropped.json');
    // fireEvent answers false when the handler cancelled the browser's default action (opening the file).
    expect(
      fireEvent.dragOver(zone, { dataTransfer: { types: ['Files'], files: [file], dropEffect: 'copy' } }),
    ).toBe(false);
    expect(fireEvent.drop(zone, { dataTransfer: { types: ['Files'], files: [file] } })).toBe(false);
    expect(snapshots.calls.filter((call) => call.startsWith('importFiles'))).toEqual([]);
  });

  it('says which snapshots are kept in memory when IndexedDB refused them', async () => {
    const snapshots = library();
    const kept = storedRecord('demo:S', { detail: 'demo:S', bytes: 40_000, savedAt: '2026-10-10T13:00:00Z' });
    snapshots.records.set('demo:S', { record: kept, persisted: false });
    await openPage(snapshots);
    expect(
      screen.getByText(
        '2 snapshots take 17.4 MB in this browser; 1 more takes 40.0 kB in memory, until this page is reloaded ' +
          'or closed.',
      ),
    ).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: 'Delete all snapshots…' }));
    expect(screen.getByRole('dialog', { name: 'Delete all snapshots?' }).textContent).toContain(
      'All 3 snapshots kept in this browser and in memory (17.5 MB) are removed.',
    );
  });

  it('explains when the browser keeps nothing, and turns importing off', async () => {
    renderApp('/snapshots', {
      snapshots: fakeLibrary({ persistent: false, records: [storedRecord('demo:S', { detail: 'demo:S' })] }),
    });
    expect((await screen.findByTestId('snapshots-memory-notice')).textContent).toContain(
      'This browser does not let gcportrait store data here',
    );
    const stored = await screen.findByRole('table', { name: 'Snapshots stored in this browser' });
    expect(within(stored).getByText('in memory')).toBeDefined();
    const choose = screen.getByRole('button', { name: 'Choose files…' });
    expect(choose.getAttribute('aria-disabled')).toBe('true');
    expect(
      screen.getByText('1 snapshot takes 123 kB in memory, until this page is reloaded or closed.'),
    ).toBeDefined();
    expect(screen.queryByText(/The browser estimates/)).toBeNull();
    await expectNoAxeViolations();
  });

  it('offers the stored snapshots in the Snapshot menu', async () => {
    await openPage();
    await userEvent.click(within(screen.getByRole('banner')).getByRole('button', { name: 'Snapshot' }));
    const menu = screen.getByRole('menu', { name: 'Snapshot' });
    expect(
      within(menu)
        .getAllByRole('menuitemradio')
        .map((item) => item.textContent),
    ).toEqual([
      'Demo organisation S (small)',
      'Demo organisation M (medium)',
      'Demo organisation L (large)',
      'example.com, read 2026-10-07 18:22 UTC, export.json',
    ]);
  });

  it('gives copies of one file different names and rows, and names a scope without a display name once', async () => {
    const copy = (id: string, savedAt: string) =>
      storedRecord(id, { source: 'export', detail: 'copy.gcportrait.json', savedAt });
    const { table } = await openPage(
      fakeLibrary({
        records: [
          copy('01J9Z3K5Q8XW2V4N6P7R8S9T0C', '2026-10-10T12:00:00Z'),
          copy('01J9Z3K5Q8XW2V4N6P7R8S9T0D', '2026-10-10T12:30:00Z'),
          copy('01J9Z3K5Q8XW2V4N6P7R8S9T0E', '2026-10-10T12:30:20Z'),
          storedRecord(IMPORTED, { scope: { kind: 'project', id: 'p-1' }, source: 'export' }),
        ],
      }),
    );
    const loads = within(table)
      .getAllByRole('button', { name: /^Load / })
      .map((button) => button.getAttribute('aria-label'));
    expect(loads).toEqual([
      'Load example.com, read 2026-10-08 00:00 UTC, copy.gcportrait.json, stored 2026-10-10 12:30 UTC, copy 2',
      'Load example.com, read 2026-10-08 00:00 UTC, copy.gcportrait.json, stored 2026-10-10 12:30 UTC, copy 1',
      'Load example.com, read 2026-10-08 00:00 UTC, copy.gcportrait.json, stored 2026-10-10 12:00 UTC',
      'Load Project p-1, read 2026-10-08 00:00 UTC',
    ]);
    expect(rows(table).map((cells) => cells[0])).toEqual([
      'example.comOrganisation 30000000001',
      'example.comOrganisation 30000000001',
      'example.comOrganisation 30000000001',
      'Project p-1',
    ]);
    // The copies stored in the same minute show their number, so no two rows look the same.
    expect(rows(table).map((cells) => cells[5])).toEqual([
      '2026-10-10 12:30 UTCcopy 2',
      '2026-10-10 12:30 UTCcopy 1',
      '2026-10-10 12:00 UTC',
      '2026-10-10 12:00 UTC',
    ]);
    expect(new Set(rows(table).map((cells) => cells.slice(0, 6).join('|'))).size).toBe(4);
    await userEvent.click(within(screen.getByRole('banner')).getByRole('button', { name: 'Snapshot' }));
    const items = within(screen.getByRole('menu', { name: 'Snapshot' }))
      .getAllByRole('menuitemradio')
      .map((item) => item.textContent);
    expect(new Set(items).size).toBe(items.length);
  });
});
