// SPDX-License-Identifier: Apache-2.0
/**
 * Fillable commands in React: the fields of a variable share one value across every command and the Variables panel,
 * prefilled from what the app store knows and editable; Copy copies the command with the values (an unfilled one as
 * its token) and says so; the button's note counts what is still to fill; a value of the wrong format is marked on
 * leaving its field; the values outlive a reload in the tab's sessionStorage, never a secret; axe finds nothing.
 */
import { act, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { signedInSession } from '../auth/testing';
import { SIGNED_OUT_SESSION } from '../auth/types';
import { renderImport } from '../import/testing';
import { CommandBlock } from '../preflight/CommandBlock';
import { PermissionsReference } from '../preflight/PermissionsGuide';
import { fakeLibrary } from '../snapshots/testing';
import type { ConnectSlice } from '../state';
import { expectNoAxeViolations } from '../test/axe';
import { publicConfig } from '../test/backend';
import { stubClipboard } from '../test/clipboard';
import { checkVariable, clearVariables, resetVariablesForTests, setVariable } from './store';
import { STORAGE_KEY } from './values';
import { VariablesPanel } from './VariablesPanel';

const EXPORT =
  'gcloud asset export --folder=YOUR_FOLDER_ID --content-type=resource --output-path=gs://YOUR_BUCKET/export.json';
const COPY = 'gcloud storage cp gs://YOUR_BUCKET/export.json .';

let writeText: ReturnType<typeof stubClipboard>;

beforeEach(() => {
  window.sessionStorage.clear();
  resetVariablesForTests();
  writeText = stubClipboard();
});

afterEach(() => {
  window.sessionStorage.clear();
  resetVariablesForTests();
});

function renderCommands(connect: Partial<ConnectSlice> = { session: SIGNED_OUT_SESSION }) {
  return renderImport(
    <>
      <VariablesPanel commands={[EXPORT, COPY]} heading="h2" />
      <CommandBlock command={EXPORT} />
      <CommandBlock command={COPY} />
    </>,
    { connect, library: fakeLibrary() },
  );
}

function fields(name: string): HTMLInputElement[] {
  return screen
    .getAllByRole('textbox', { name })
    .filter((element): element is HTMLInputElement => element instanceof HTMLInputElement);
}

function block(purpose: RegExp): HTMLElement {
  const button = screen.getByRole('button', { name: purpose });
  const root = button.parentElement;
  if (root === null) throw new Error('no command block');
  return root;
}

describe('a command’s variables', () => {
  it('are labelled fields that share one value across every command and the panel', async () => {
    renderCommands();
    // Two commands and the panel: three fields for the bucket, two for the folder.
    expect(fields('Bucket')).toHaveLength(3);
    expect(fields('Folder number')).toHaveLength(2);
    for (const field of fields('Bucket')) {
      expect(field.value).toBe('');
      expect(field.getAttribute('placeholder') ?? 'YOUR_BUCKET').toBe('YOUR_BUCKET');
    }
    const [first] = fields('Bucket');
    if (first === undefined) throw new Error('no field');
    await userEvent.type(first, 'demo-exports-1');
    expect(fields('Bucket').map((field) => field.value)).toEqual([
      'demo-exports-1',
      'demo-exports-1',
      'demo-exports-1',
    ]);
    // In the code the field is as wide as its text.
    expect(fields('Bucket')[1]?.style.width).toBe('14ch');
    await expectNoAxeViolations();
  });

  it('copies the command with the values, an unfilled one as its token, and says so', async () => {
    renderCommands();
    const exportBlock = block(/^Copy the command that exports/);
    const copy = within(exportBlock).getByRole('button', { name: /^Copy/ });
    // Described by what is still to fill.
    const note = document.getElementById(copy.getAttribute('aria-describedby') ?? '');
    expect(note?.textContent).toBe('2 values to fill');

    const [panelBucket] = fields('Bucket');
    if (panelBucket === undefined) throw new Error('no field');
    await userEvent.type(panelBucket, 'demo-exports-1');
    expect(note?.textContent).toBe('1 value to fill');
    await userEvent.click(copy);
    expect(writeText).toHaveBeenLastCalledWith(
      'gcloud asset export --folder=YOUR_FOLDER_ID --content-type=resource --output-path=gs://demo-exports-1/export.json',
    );
    expect(within(exportBlock).getByRole('status').textContent).toBe(
      'Copied, with 1 value still to fill: YOUR_FOLDER_ID.',
    );

    const copyBlock = block(/^Copy the command that copies the export/);
    const button = within(copyBlock).getByRole('button', { name: /^Copy/ });
    expect(button.getAttribute('aria-describedby')).toBeNull();
    await userEvent.click(button);
    expect(writeText).toHaveBeenLastCalledWith('gcloud storage cp gs://demo-exports-1/export.json .');
    expect(within(copyBlock).getByRole('status').textContent).toBe('Copied.');
  });

  it('are prefilled with what the app knows, editable, and follow a new fact', async () => {
    const view = renderCommands({
      session: SIGNED_OUT_SESSION,
      scope: { kind: 'folder', scope: 'folders/20000000001', id: '20000000001' },
    });
    expect(fields('Folder number').map((field) => field.value)).toEqual(['20000000001', '20000000001']);
    const copy = within(block(/^Copy the command that exports/)).getByRole('button', { name: /^Copy/ });
    await userEvent.click(copy);
    expect(writeText).toHaveBeenLastCalledWith(
      'gcloud asset export --folder=20000000001 --content-type=resource --output-path=gs://YOUR_BUCKET/export.json',
    );
    const [inCode] = fields('Folder number').slice(1);
    if (inCode === undefined) throw new Error('no field');
    await userEvent.clear(inCode);
    await userEvent.type(inCode, '20000000002');
    expect(fields('Folder number').map((field) => field.value)).toEqual(['20000000002', '20000000002']);
    view.unmount();

    // Another folder picked: the app's new fact shows; the same one again keeps what was typed.
    renderCommands({
      session: SIGNED_OUT_SESSION,
      scope: { kind: 'folder', scope: 'folders/20000000003', id: '20000000003' },
    });
    expect(fields('Folder number')[0]?.value).toBe('20000000003');
  });

  it('are prefilled with the signed-in account and the instance’s service account, in the reference table too', () => {
    const account = 'gcportrait-backend@demo-host.iam.gserviceaccount.com';
    renderImport(<PermissionsReference scope={null} serviceAccount={account} />, {
      connect: {
        session: signedInSession(),
        backend: { status: 'ready', config: publicConfig({ saMode: true, backendServiceAccount: account }) },
      },
      library: fakeLibrary(),
    });
    // The panel's field and one per command that names the variable.
    expect(fields('Your e-mail').map((field) => field.value)).toEqual([
      'ada@example.com',
      'ada@example.com',
      'ada@example.com',
    ]);
    expect(fields('Service account').map((field) => field.value)).toEqual([account, account]);
    expect(fields('Organisation number').every((field) => field.value === '')).toBe(true);
  });

  it('marks a value of the wrong format on leaving its field, and says how it should look', async () => {
    renderCommands();
    const [, inCode] = fields('Folder number');
    if (inCode === undefined) throw new Error('no field');
    await userEvent.type(inCode, 'folders/2');
    expect(inCode.getAttribute('aria-invalid')).toBeNull();
    await userEvent.tab();
    expect(inCode.getAttribute('aria-invalid')).toBe('true');
    const exportBlock = block(/^Copy the command that exports/);
    const button = within(exportBlock).getByRole('button', { name: /^Copy/ });
    const note = document.getElementById(button.getAttribute('aria-describedby') ?? '');
    expect(note?.textContent).toBe('Check Folder number: digits only.');
    expect(inCode.getAttribute('aria-describedby')).toBe(note?.id);
    // The panel says it too.
    expect(screen.getByText('Expected: digits only.')).toBeDefined();
    await expectNoAxeViolations();
    // Corrected, the mark goes as soon as the value fits.
    await userEvent.clear(inCode);
    await userEvent.type(inCode, '2');
    expect(inCode.getAttribute('aria-invalid')).toBeNull();
    expect(note?.textContent).toBe('1 value to fill');
  });

  it('clears stale invalid marks and typed status when a fact changes', async () => {
    const view = renderCommands({
      session: SIGNED_OUT_SESSION,
      scope: { kind: 'folder', scope: 'folders/20000000001', id: '20000000001' },
    });
    const [, inCode] = fields('Folder number');
    if (inCode === undefined) throw new Error('no field');
    await userEvent.clear(inCode);
    await userEvent.type(inCode, 'folders/2');
    await userEvent.tab();
    expect(inCode.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('Expected: digits only.')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Clear values' }).getAttribute('aria-disabled')).toBeNull();
    view.unmount();

    // Facts change: another folder is picked. The invalid mark and typed flag are cleared.
    const secondView = renderCommands({
      session: SIGNED_OUT_SESSION,
      scope: { kind: 'folder', scope: 'folders/20000000003', id: '20000000003' },
    });
    const [panelField, inCodeAfter] = fields('Folder number');
    expect(panelField?.value).toBe('20000000003');
    expect(panelField?.getAttribute('aria-invalid')).toBeNull();
    expect(inCodeAfter?.getAttribute('aria-invalid')).toBeNull();
    expect(screen.queryByText('Expected: digits only.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Clear values' }).getAttribute('aria-disabled')).toBe('true');
    secondView.unmount();

    // With an active typed value on another variable, typed stays true while the stale invalid mark is cleared.
    const thirdView = renderCommands({
      session: SIGNED_OUT_SESSION,
      scope: { kind: 'folder', scope: 'folders/20000000001', id: '20000000001' },
    });
    const [bucketInput] = fields('Bucket');
    if (bucketInput === undefined) throw new Error('no field');
    await userEvent.type(bucketInput, 'demo-exports-1');
    const [, inCodeThird] = fields('Folder number');
    if (inCodeThird === undefined) throw new Error('no field');
    await userEvent.clear(inCodeThird);
    await userEvent.type(inCodeThird, 'folders/2');
    await userEvent.tab();
    thirdView.unmount();

    renderCommands({
      session: SIGNED_OUT_SESSION,
      scope: { kind: 'folder', scope: 'folders/20000000004', id: '20000000004' },
    });
    const [panelFolderFourth, inCodeFourth] = fields('Folder number');
    expect(panelFolderFourth?.value).toBe('20000000004');
    expect(panelFolderFourth?.getAttribute('aria-invalid')).toBeNull();
    expect(inCodeFourth?.getAttribute('aria-invalid')).toBeNull();
    expect(screen.queryByText('Expected: digits only.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Clear values' }).getAttribute('aria-disabled')).toBeNull();
  });

  it('keep their values for the tab’s session: a reload shows them again; Clear values forgets them', async () => {
    const view = renderCommands();
    const [bucket] = fields('Bucket');
    if (bucket === undefined) throw new Error('no field');
    await userEvent.type(bucket, 'demo-exports-1');
    expect(JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? 'null')).toEqual({
      YOUR_BUCKET: { value: 'demo-exports-1', basis: '' },
    });
    view.unmount();
    resetVariablesForTests();
    renderCommands();
    expect(fields('Bucket').map((field) => field.value)).toEqual([
      'demo-exports-1',
      'demo-exports-1',
      'demo-exports-1',
    ]);
    await userEvent.click(screen.getByRole('button', { name: 'Clear values' }));
    expect(fields('Bucket')[0]?.value).toBe('');
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(screen.getByRole('button', { name: 'Clear values' }).getAttribute('aria-disabled')).toBe('true');
  });

  it('never keep a secret, and work where storage is blocked', () => {
    act(() => {
      setVariable('YOUR_ACCESS_TOKEN', 'ya29.example-token', undefined);
    });
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    const blocked = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'QuotaExceededError');
    });
    act(() => {
      setVariable('YOUR_BUCKET', 'demo-exports-1', undefined);
      checkVariable('YOUR_BUCKET', 'demo-exports-1');
    });
    blocked.mockRestore();
    render(<CommandBlock command={COPY} />);
    expect(fields('Bucket')[0]?.value).toBe('demo-exports-1');
    act(() => {
      clearVariables();
    });
    expect(fields('Bucket')[0]?.value).toBe('');
  });

  it('start empty outside the app store, and leave text without registered tokens as it is', () => {
    render(
      <>
        <CommandBlock command={EXPORT} />
        <CommandBlock command='gcloud projects add-iam-policy-binding demo-app-1 --role="roles/browser"' />
      </>,
    );
    expect(fields('Folder number')[0]?.value).toBe('');
    expect(
      screen.getByRole('button', {
        name: 'Copy the command that grants roles/browser on demo-app-1',
      }),
    ).toBeDefined();
  });
});
