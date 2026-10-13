// SPDX-License-Identifier: MIT
import { generateOrganization, toCaiNdjson } from '@gcportrait/demo-data';
import { act, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { signedInSession } from '../auth/testing';
import { SIGNED_OUT_SESSION } from '../auth/types';
import { fakeLibrary, storedRecord } from '../snapshots/testing';
import type { ConnectSlice } from '../state';
import { expectNoAxeViolations } from '../test/axe';
import { stubBackend } from '../test/backend';
import { currentLocation } from '../test/location';
import { LoadExport, isGcsUri } from './LoadExport';
import { line, renderImport } from './testing';

const LINES = toCaiNdjson(generateOrganization({ size: 'S' }).assets, 'export');
const OPERATION = JSON.stringify({
  name: 'organizations/30000000001/operations/ExportAssets/RESOURCE/42',
  metadata: {
    '@type': 'type.googleapis.com/google.cloud.asset.v1.ExportAssetsRequest',
    parent: 'organizations/30000000001',
  },
  done: true,
  response: {
    '@type': 'type.googleapis.com/google.cloud.asset.v1.ExportAssetsResponse',
    readTime: '2026-10-08T06:00:01Z',
  },
});
const SIGNED_IN: Partial<ConnectSlice> = { session: signedInSession(), scope: null };

function readButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Read from Cloud Storage' });
}

beforeEach(() => {
  vi.stubGlobal('CompressionStream', undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isGcsUri', () => {
  it('takes gs://BUCKET/… only', () => {
    expect(isGcsUri('gs://demo-exports/export.json')).toBe(true);
    expect(isGcsUri(' gs://demo-exports/prefix/ ')).toBe(true);
    expect(isGcsUri('gs://demo-exports')).toBe(true);
    for (const text of [
      '',
      'gs://',
      'demo-exports/x',
      'https://storage.googleapis.com/demo-exports/x',
      'gs://UP/x',
    ])
      expect(isGcsUri(text), text).toBe(false);
  });
});

describe('Load export', () => {
  it('offers files and Cloud Storage, and shows the gcloud commands', async () => {
    renderImport(<LoadExport />, { connect: { session: SIGNED_OUT_SESSION }, library: fakeLibrary() });
    expect(screen.getByRole('button', { name: 'Choose files…' }).getAttribute('aria-disabled')).toBeNull();
    expect(readButton().getAttribute('aria-disabled')).toBe('true');
    expect(readButton().getAttribute('title')).toBe('Sign in with Google first');
    await userEvent.click(screen.getByText('How to make an export with gcloud'));
    // Each command's variables are fields (an organisation's number without a scope picked), each with a Copy button.
    const exportBlock = screen.getByRole('button', {
      name: 'Copy the command that exports the scope’s assets to Cloud Storage',
    }).parentElement;
    if (exportBlock === null) throw new Error('no export command');
    expect(exportBlock.querySelector('code')?.textContent).toBe(
      'gcloud asset export --organization= --content-type=resource --output-path=gs:///export.json',
    );
    expect(within(exportBlock).getByRole('textbox', { name: 'Organisation number' })).toBeDefined();
    expect(screen.getAllByRole('textbox', { name: 'Bucket' })).toHaveLength(2);
    expect(screen.getByRole('textbox', { name: 'Export operation' }).getAttribute('placeholder')).toBe(
      'YOUR_OPERATION_NAME',
    );
    expect(
      screen.getByRole('button', { name: 'Copy the command that saves the export’s operation' }),
    ).toBeDefined();
    expect(
      screen.getByRole('button', { name: 'Copy the command that copies the export to this computer' }),
    ).toBeDefined();
    await expectNoAxeViolations();
  });

  it('imports dropped files through the Snapshots page’s import, then opens the diagram', async () => {
    const library = fakeLibrary();
    const { container } = renderImport(<LoadExport />, { connect: SIGNED_IN, library });
    const files = [new File([LINES], 'export.json'), new File([OPERATION], 'operation.json')];
    await userEvent.upload(screen.getByTestId('export-files'), files);
    expect(library.calls).toEqual(['importFiles export.json,operation.json']);
    expect(screen.getByRole('progressbar', { name: 'Importing the export' })).toBeDefined();
    const record = storedRecord('01J9Z3K5Q8XW2V4N6P7R8S9T0A', { source: 'export' });
    await act(() => library.answer({ ok: { refs: [record.id], records: [record], warnings: [] } }));
    await waitFor(() => {
      expect(currentLocation(container)).toBe('/diagram#snapshot=01J9Z3K5Q8XW2V4N6P7R8S9T0A');
    });
  });

  it('imports dropped files with the read time typed for them, and refuses one it cannot use', async () => {
    const library = fakeLibrary();
    renderImport(<LoadExport />, { connect: SIGNED_IN, library });
    const field = screen.getByRole('textbox', { name: 'When the export was taken (UTC, optional)' });
    await userEvent.type(field, 'yesterday');
    expect(field.getAttribute('aria-invalid')).toBe('true');
    const problem = 'Type the read time as 2026-10-05 14:30 (UTC), or leave it empty.';
    expect(field.getAttribute('aria-describedby')).toContain(screen.getByText(problem).id);
    await userEvent.upload(screen.getByTestId('export-files'), [new File([LINES], 'export.json')]);
    expect(library.calls).toEqual([]);
    expect(screen.getByRole('alert').textContent).toContain(problem);
    // Nor is a gs:// export read with it.
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Or read it from Cloud Storage' }),
      'gs://demo-exports/x',
    );
    expect(readButton().getAttribute('aria-disabled')).toBe('true');
    expect(readButton().getAttribute('title')).toBe('Correct the read time first');
    await userEvent.clear(field);
    await userEvent.type(field, '2026-10-05 14:30');
    expect(field.getAttribute('aria-invalid')).toBeNull();
    await userEvent.upload(screen.getByTestId('export-files'), [new File([LINES], 'export.json')]);
    expect(library.calls).toEqual(['importFiles export.json at 2026-10-05T14:30:00Z']);
    await expectNoAxeViolations();
  });

  it('shows the notes an import left before opening the diagram', async () => {
    const library = fakeLibrary();
    const { container } = renderImport(<LoadExport />, { connect: SIGNED_IN, library });
    await userEvent.upload(screen.getByTestId('export-files'), [new File([LINES], 'export.json')]);
    const record = storedRecord('01J9Z3K5Q8XW2V4N6P7R8S9T0B', { source: 'export' });
    const note = 'The export does not say when it was taken, so its read time is the latest asset change.';
    await act(() => library.answer({ ok: { refs: [record.id], records: [record], warnings: [note] } }));
    expect(await screen.findByText(note)).toBeDefined();
    expect(currentLocation(container)).toBe('/');
    await expectNoAxeViolations();
    await userEvent.click(screen.getByRole('button', { name: 'Open the diagram' }));
    expect(currentLocation(container)).toBe('/diagram#snapshot=01J9Z3K5Q8XW2V4N6P7R8S9T0B');
  });

  it('reads a gs:// export through the backend, with the operation.json added here', async () => {
    const backend = stubBackend({
      routes: {
        '/api/export/read': () =>
          new Response(LINES, { headers: { 'x-gcportrait-export-bytes': String(LINES.length) } }),
      },
    });
    const library = fakeLibrary();
    const { container } = renderImport(<LoadExport />, { connect: SIGNED_IN, library });
    expect(readButton().getAttribute('title')).toBe('Type a gs:// URI first');
    await userEvent.type(
      screen.getByLabelText('Or read it from Cloud Storage'),
      'gs://demo-exports/export.json',
    );
    await userEvent.upload(screen.getByTestId('export-sidecar'), new File([OPERATION], 'operation.json'));
    expect(
      await screen.findByText(/^operation\.json: read time 2026-10-08 06:00 UTC, organization 30000000001\./),
    ).toBeDefined();
    expect(readButton().getAttribute('aria-disabled')).toBeNull();
    await userEvent.click(readButton());
    await waitFor(() => {
      expect(currentLocation(container)).toMatch(/^\/diagram#snapshot=[0-9A-HJKMNP-TV-Z]{26}$/);
    });
    expect(backend.calls.map(({ url, body }) => ({ url, body }))).toEqual([
      { url: '/api/export/read', body: { gcsUri: 'gs://demo-exports/export.json' } },
    ]);
    const ref = currentLocation(container).split('snapshot=')[1] ?? '';
    expect(library.records.get(ref)?.record.meta).toMatchObject({
      source: 'export',
      detail: 'gs://demo-exports/export.json',
      readTime: '2026-10-08T06:00:01Z',
      scope: { kind: 'organization', id: '30000000001' },
    });
  });

  it('says when a chosen file is not an export’s operation', async () => {
    renderImport(<LoadExport />, { connect: SIGNED_IN, library: fakeLibrary() });
    await userEvent.upload(screen.getByTestId('export-sidecar'), new File([LINES], 'operation.json'));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('operation.json is not the operation of an asset export.');
  });

  it('shows Cloud Storage’s refusal', async () => {
    const message =
      'ada@example.com does not have storage.objects.get access to the Google Cloud Storage object.';
    stubBackend({
      routes: {
        '/api/export/read': () =>
          new Response(line({ t: 'error', message, status: 403, code: 'PERMISSION_DENIED' })),
      },
    });
    renderImport(<LoadExport />, { connect: SIGNED_IN, library: fakeLibrary() });
    await userEvent.type(
      screen.getByLabelText('Or read it from Cloud Storage'),
      'gs://demo-exports/x.json{Enter}',
    );
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('You cannot read gs://demo-exports/x.json.')).toBeDefined();
    expect(within(alert).getByText(message)).toBeDefined();
    await expectNoAxeViolations();
  });

  it('asks before drawing a large export it read from files; Cancel keeps it stored and undrawn', async () => {
    const library = fakeLibrary();
    const { container } = renderImport(<LoadExport />, { connect: SIGNED_IN, library });
    await userEvent.upload(screen.getByTestId('export-files'), [new File([LINES], 'export.json')]);
    const record = storedRecord('01J9Z3K5Q8XW2V4N6P7R8S9T0C', { source: 'export', assetCount: 12_345 });
    await act(() => library.answer({ ok: { refs: [record.id], records: [record], warnings: [] } }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Draw a large snapshot?' });
    expect(document.getElementById(dialog.getAttribute('aria-describedby') ?? '')?.textContent).toMatch(
      /^This snapshot has 12,345 assets\. /,
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(currentLocation(container)).toBe('/');
    expect(
      await screen.findByText(
        'The snapshot of 12,345 assets is stored in this browser and was not drawn; Load it from the Snapshots ' +
          'page to draw it.',
      ),
    ).toBeDefined();
    // Stored once, never imported again.
    expect(library.calls).toEqual(['importFiles export.json']);
    expect(library.records.has(record.id)).toBe(true);
  });

  it('opens a large export once the person says so, after its notes too', async () => {
    const library = fakeLibrary();
    const { container } = renderImport(<LoadExport />, { connect: SIGNED_IN, library });
    await userEvent.upload(screen.getByTestId('export-files'), [new File([LINES], 'export.json')]);
    const record = storedRecord('01J9Z3K5Q8XW2V4N6P7R8S9T0D', { source: 'export', assetCount: 12_345 });
    const note = 'The export does not say when it was taken, so its read time is the latest asset change.';
    await act(() => library.answer({ ok: { refs: [record.id], records: [record], warnings: [note] } }));
    await userEvent.click(await screen.findByRole('button', { name: 'Open the diagram' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Draw a large snapshot?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Draw it anyway' }));
    await waitFor(() => {
      expect(currentLocation(container)).toBe(`/diagram#snapshot=${record.id}`);
    });
  });

  it('asks while a Cloud Storage read passes 10 000 assets; Cancel stops reading it', async () => {
    const big = line({ t: 'progress', pages: 0, assets: 10_500 });
    stubBackend({ routes: { '/api/export/read': () => new Response(big + LINES) } });
    const library = fakeLibrary();
    renderImport(<LoadExport />, { connect: SIGNED_IN, library });
    await userEvent.type(
      screen.getByLabelText('Or read it from Cloud Storage'),
      'gs://demo-exports/export.json{Enter}',
    );
    const dialog = await screen.findByRole('alertdialog', { name: 'Draw a large snapshot?' });
    expect(document.getElementById(dialog.getAttribute('aria-describedby') ?? '')?.textContent).toMatch(
      /^This export has 10,500 assets so far, .* Cancel stops reading it; nothing is stored\.$/,
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.getAllByRole('status').map((status) => status.textContent)).toContain(
        'Cancelled. Nothing was stored.',
      );
    });
    expect(library.calls).toEqual([]);
  });
});
