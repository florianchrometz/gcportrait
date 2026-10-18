// SPDX-License-Identifier: Apache-2.0
import { generateOrganization, toCaiAsset } from '@gcportrait/demo-data';
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TEST_TOKEN } from '../auth/testing';
import { readyConnect } from '../preflight/testing';
import { useLargeSnapshotGuard } from '../snapshots/LargeSnapshotGuard';
import { fakeLibrary } from '../snapshots/testing';
import { expectNoAxeViolations } from '../test/axe';
import { stubBackend } from '../test/backend';
import { currentLocation, hashOf } from '../test/location';
import { PullNow } from './PullNow';
import { controlledBody, line, renderImport } from './testing';

const READ_TIME = '2026-10-10T11:59:58Z';
const ASSETS = generateOrganization({ size: 'S' }).assets.map(toCaiAsset);
/** Signed in, example.com checked and ready. */
const READY = readyConnect();

/** A backend whose every answer is `answer()`; the requests it was sent. */
function backend(answer: () => Response): ReturnType<typeof stubBackend>['calls'] {
  return stubBackend({ otherwise: answer }).calls;
}

function button(): HTMLElement {
  return screen.getByRole('button', { name: 'Pull now' });
}

/** Whether the guard would ask before drawing 50 000 assets of the snapshot the location names. */
function GuardProbe(): ReactElement {
  const guard = useLargeSnapshotGuard();
  const ref = hashOf(useLocation().hash).replace(/^snapshot=/, '');
  return <p data-testid="guard-probe">{ref === '' ? '' : String(guard.asks(50_000, ref))}</p>;
}

beforeEach(() => {
  // jsdom's Blob cannot stream, so the snapshot is stored as plain JSON (the codec's fallback).
  vi.stubGlobal('CompressionStream', undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Pull now', () => {
  it('waits, with the reason, until the permission check says the scope is ready', async () => {
    renderImport(<PullNow />, { connect: { ...READY, scope: null }, library: fakeLibrary() });
    expect(button().getAttribute('aria-disabled')).toBe('true');
    const hint = document.getElementById(button().getAttribute('aria-describedby') ?? '');
    expect(hint?.textContent).toBe('Choose a scope first.');
    expect(screen.queryByRole('link', { name: 'Check permissions' })).toBeNull();
    await expectNoAxeViolations();
  });

  it('links the permission check while that is what it waits for', async () => {
    renderImport(<PullNow />, {
      connect: { ...READY, preflight: { status: 'idle' } },
      library: fakeLibrary(),
    });
    const hint = document.getElementById(button().getAttribute('aria-describedby') ?? '');
    expect(hint?.textContent).toBe('Check the permissions for this scope first.');
    expect(screen.getByRole('link', { name: 'Check permissions' }).getAttribute('href')).toBe('/permissions');
    await expectNoAxeViolations();
  });

  it('pulls with progress, then opens the diagram on the stored snapshot', async () => {
    const body = controlledBody();
    const requests = backend(() => new Response(body.stream));
    const library = fakeLibrary();
    const { container } = renderImport(<PullNow />, { connect: READY, library });
    const hint = document.getElementById(button().getAttribute('aria-describedby') ?? '');
    expect(hint?.textContent).toBe(
      'Reads example.com with your account; requests use the quota of demo-quota-1. The diagram shows the ' +
        'inventory as of the pull.',
    );
    await userEvent.click(button());
    expect(requests).toHaveLength(1);
    expect(requests[0]?.headers.get('x-gcportrait-token')).toBe(TEST_TOKEN); // gcportrait's own header
    expect(requests[0]?.body).toEqual({
      scope: 'organizations/30000000001',
      contentType: 'RESOURCE',
      mode: 'user',
      quotaProject: 'demo-quota-1',
    });

    body.send(line({ t: 'progress', pages: 0, assets: 0 }));
    body.send(line({ t: 'page', assets: ASSETS.slice(0, 50) }));
    body.send(line({ t: 'progress', pages: 1, assets: 50 }));
    const status = screen.getByRole('status');
    await waitFor(() => {
      expect(status.textContent).toBe('Reading Cloud Asset Inventory…');
    });
    await waitFor(() => {
      expect(screen.getByTestId('import-counters').textContent).toMatch(
        /^1 page · 50 assets · [\d.]+ kB · 0:0\d$/,
      );
    });
    expect(screen.getByRole('progressbar', { name: 'Pulling from Cloud Asset Inventory' })).toBeDefined();
    expect(button().getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDefined();
    await expectNoAxeViolations();

    body.send(line({ t: 'page', assets: ASSETS.slice(50) }));
    body.send(line({ t: 'progress', pages: 2, assets: ASSETS.length }));
    body.send(line({ t: 'done', assets: ASSETS.length, readTime: READ_TIME }));
    body.end();
    await waitFor(() => {
      expect(currentLocation(container)).toMatch(/^\/diagram#snapshot=[0-9A-HJKMNP-TV-Z]{26}$/);
    });
    const ref = currentLocation(container).split('snapshot=')[1] ?? '';
    expect(library.records.get(ref)?.record.meta).toMatchObject({
      source: 'api',
      assetCount: ASSETS.length,
      readTime: READ_TIME,
      scope: { kind: 'organization', id: '30000000001', displayName: 'example.com' },
    });
  });

  it('cancels: nothing is stored, and it can pull again', async () => {
    const body = controlledBody();
    backend(() => new Response(body.stream));
    const library = fakeLibrary();
    renderImport(<PullNow />, { connect: READY, library });
    await userEvent.click(button());
    body.send(line({ t: 'progress', pages: 0, assets: 0 }));
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe('Cancelled. Nothing was stored.');
    });
    expect(library.calls).toEqual([]);
    expect(button().getAttribute('aria-disabled')).toBeNull();
  });

  it('says what Google refused and links the permission check', async () => {
    const message = 'Request denied by Cloud IAM. Missing required IAM permission on requested scope.';
    backend(
      () =>
        new Response(
          line({ t: 'progress', pages: 0, assets: 0 }) +
            line({ t: 'error', message, status: 403, code: 'PERMISSION_DENIED' }),
        ),
    );
    const library = fakeLibrary();
    renderImport(<PullNow />, { connect: READY, library });
    await userEvent.click(button());
    const alert = await screen.findByRole('alert');
    expect(
      within(alert).getByText('You cannot list assets in example.com, or it does not exist.'),
    ).toBeDefined();
    expect(within(alert).getByText(message)).toBeDefined();
    expect(within(alert).getByRole('link', { name: 'Check permissions' }).getAttribute('href')).toBe(
      '/permissions',
    );
    expect(library.calls).toEqual([]);
    await expectNoAxeViolations();
  });

  it('offers Try again when Google was only busy', async () => {
    let answers = 0;
    backend(() => {
      answers += 1;
      return new Response(
        line({ t: 'error', message: 'Busy.', status: 503, code: 'UNAVAILABLE', retryable: true }),
      );
    });
    renderImport(<PullNow />, { connect: READY, library: fakeLibrary() });
    await userEvent.click(button());
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    await waitFor(() => {
      expect(answers).toBe(2);
    });
  });

  it('asks once, as soon as the count passes 10 000; Cancel stops the pull and stores nothing', async () => {
    const body = controlledBody();
    backend(() => new Response(body.stream));
    const library = fakeLibrary();
    const { container } = renderImport(<PullNow />, { connect: READY, library });
    await userEvent.click(button());
    body.send(line({ t: 'progress', pages: 0, assets: 0 }));
    body.send(line({ t: 'page', assets: ASSETS.slice(0, 50) }));
    body.send(line({ t: 'progress', pages: 21, assets: 10_500 }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Draw a large snapshot?' });
    expect(document.getElementById(dialog.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
      'This pull has read 10,500 assets so far, and there may be more. Drawing more than 10,000 assets at ' +
        'once is slow and heavy on memory; the diagram will still work. Cancel stops the pull; nothing is stored.',
    );
    // The stream goes on while the person decides: one question, however far the count goes.
    body.send(line({ t: 'progress', pages: 22, assets: 11_000 }));
    await waitFor(() => {
      expect(screen.getByTestId('import-counters').textContent).toMatch(/^22 pages · 11,000 assets/);
    });
    expect(screen.getAllByRole('alertdialog')).toHaveLength(1);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe('Cancelled. Nothing was stored.');
    });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(library.calls).toEqual([]);
    expect(currentLocation(container)).toBe('/');
  });

  it('"Draw it anyway" goes on, stores it and opens the diagram, which does not ask again', async () => {
    const body = controlledBody();
    backend(() => new Response(body.stream));
    const library = fakeLibrary();
    const { container } = renderImport(
      <>
        <PullNow />
        <GuardProbe />
      </>,
      { connect: READY, library },
    );
    await userEvent.click(button());
    body.send(line({ t: 'progress', pages: 0, assets: 0 }));
    body.send(line({ t: 'progress', pages: 21, assets: 10_500 }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Draw a large snapshot?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Draw it anyway' }));
    body.send(line({ t: 'page', assets: ASSETS }));
    body.send(line({ t: 'done', assets: ASSETS.length, readTime: READ_TIME }));
    body.end();
    await waitFor(() => {
      expect(currentLocation(container)).toMatch(/^\/diagram#snapshot=[0-9A-HJKMNP-TV-Z]{26}$/);
    });
    expect(library.calls).toEqual(['storePrepared api']);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByTestId('guard-probe').textContent).toBe('false');
  });

  it('holds the stored snapshot until the person has answered, when the pull ends first', async () => {
    const body = controlledBody();
    backend(() => new Response(body.stream));
    const library = fakeLibrary();
    const { container } = renderImport(<PullNow />, { connect: READY, library });
    await userEvent.click(button());
    body.send(line({ t: 'progress', pages: 21, assets: 10_500 }));
    body.send(line({ t: 'page', assets: ASSETS }));
    body.send(line({ t: 'done', assets: ASSETS.length, readTime: READ_TIME }));
    body.end();
    const dialog = await screen.findByRole('alertdialog', { name: 'Draw a large snapshot?' });
    // Read in full, and nothing stored while the question is open.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(library.calls).toEqual([]);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Draw it anyway' }));
    await waitFor(() => {
      expect(currentLocation(container)).toMatch(/^\/diagram#snapshot=/);
    });
    expect(library.calls).toEqual(['storePrepared api']);
  });

  it('takes the question back when the pull fails while it is open', async () => {
    const body = controlledBody();
    backend(() => new Response(body.stream));
    renderImport(<PullNow />, { connect: READY, library: fakeLibrary() });
    await userEvent.click(button());
    body.send(line({ t: 'progress', pages: 21, assets: 10_500 }));
    await screen.findByRole('alertdialog', { name: 'Draw a large snapshot?' });
    body.send(line({ t: 'error', message: 'Busy.', status: 503, code: 'UNAVAILABLE', retryable: true }));
    body.end();
    expect(await screen.findByRole('alert')).toBeDefined();
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
  });
});
