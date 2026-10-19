// SPDX-License-Identifier: Apache-2.0
import { act, fireEvent, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { MemoryRouter } from '../router';

import { AppStateProvider } from '../state';
import { fakeLibrary, storedRecord, type FakeLibrary } from '../snapshots/testing';
import { SnapshotLibraryProvider } from '../snapshots/SnapshotLibraryProvider';
import { SnapshotJobError } from '../snapshots/worker/client';
import { useFileImport, type UseFileImportOptions } from './useFileImport';

function TestImportComponent({
  options,
}: {
  readonly options?: UseFileImportOptions | undefined;
}): ReactElement {
  const fileImport = useFileImport(options);

  return (
    <div data-testid="drop-zone" {...fileImport.dropHandlers}>
      <button
        ref={fileImport.chooseButton}
        type="button"
        data-testid="choose-button"
        onClick={fileImport.openFilePicker}
      >
        Choose files…
      </button>
      <input
        ref={fileImport.fileInput}
        type="file"
        data-testid="file-input"
        onChange={fileImport.onFileInputChange}
      />
      <div data-testid="dropping">{String(fileImport.dropping)}</div>
      <div data-testid="busy">{String(fileImport.busy)}</div>
      <div data-testid="usable">{String(fileImport.usable)}</div>
      <div data-testid="state-kind">{fileImport.state.kind}</div>
      <div data-testid="subject">{fileImport.subject}</div>
      {fileImport.state.kind === 'failed' ? (
        <div data-testid="failed-title">{fileImport.state.title}</div>
      ) : null}
      {fileImport.state.kind === 'idle' ? (
        <div data-testid="idle-message">{fileImport.state.message ?? ''}</div>
      ) : null}
      <button type="button" data-testid="cancel-button" onClick={fileImport.cancel}>
        Cancel
      </button>
    </div>
  );
}

function renderComponent(library: FakeLibrary, options?: UseFileImportOptions) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <AppStateProvider>
        <SnapshotLibraryProvider library={library}>
          <TestImportComponent options={options} />
        </SnapshotLibraryProvider>
      </AppStateProvider>
    </MemoryRouter>,
  );
}

describe('useFileImport', () => {
  it('starts an import on drop and updates state to idle with summary on success', async () => {
    const library = fakeLibrary();
    renderComponent(library);

    const zone = screen.getByTestId('drop-zone');
    const file = new File(['{}'], 'export.json');
    fireEvent.dragOver(zone, { dataTransfer: { types: ['Files'], files: [file], dropEffect: 'none' } });
    expect(screen.getByTestId('dropping').textContent).toBe('true');

    fireEvent.drop(zone, { dataTransfer: { types: ['Files'], files: [file] } });
    expect(screen.getByTestId('dropping').textContent).toBe('false');
    expect(library.calls).toEqual(['importFiles export.json']);
    expect(screen.getByTestId('state-kind').textContent).toBe('busy');

    const record = storedRecord('01J9Z3K5Q8XW2V4N6P7R8S9T0A', { source: 'export' });
    await act(() => library.answer({ ok: { refs: [record.id], records: [record], warnings: [] } }));

    expect(screen.getByTestId('state-kind').textContent).toBe('idle');
    expect(screen.getByTestId('idle-message').textContent).toContain('Imported example.com');
  });

  it('calls onDone callback when provided', async () => {
    const library = fakeLibrary();
    const onDone = vi.fn();
    renderComponent(library, { onDone });

    const file = new File(['{}'], 'test.json');
    fireEvent.change(screen.getByTestId('file-input'), { target: { files: [file] } });

    const record = storedRecord('01J9Z3K5Q8XW2V4N6P7R8S9T0B');
    await act(() => library.answer({ ok: { refs: [record.id], records: [record], warnings: ['note 1'] } }));

    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith(
      expect.objectContaining({
        refs: [record.id],
        warnings: ['note 1'],
      }),
    );
  });

  it('sets cancelled state when confirm declines', async () => {
    const library = fakeLibrary();
    renderComponent(library, {
      confirm: () => () => Promise.resolve(false),
    });

    const file = new File(['{}'], 'declined.json');
    fireEvent.change(screen.getByTestId('file-input'), { target: { files: [file] } });

    await act(() => library.answer({ ok: { refs: [], records: [], warnings: [], declined: true } }));

    expect(screen.getByTestId('state-kind').textContent).toBe('idle');
    expect(screen.getByTestId('idle-message').textContent).toBe('Cancelled. Nothing was stored.');
  });

  it('sets failed state with custom title on error', async () => {
    const library = fakeLibrary();
    renderComponent(library, {
      title: 'Failed to import files.',
    });

    const file = new File(['bad'], 'bad.json');
    fireEvent.change(screen.getByTestId('file-input'), { target: { files: [file] } });

    await act(() =>
      library.answer({
        error: new SnapshotJobError('Parse failure', ['line 1: bad']),
      }),
    );

    expect(screen.getByTestId('state-kind').textContent).toBe('failed');
    expect(screen.getByTestId('failed-title').textContent).toBe('Failed to import files.');
  });

  it('cancels and focuses choose button on cancel', async () => {
    const library = fakeLibrary();
    renderComponent(library);

    const file = new File(['{}'], 'cancel.json');
    fireEvent.change(screen.getByTestId('file-input'), { target: { files: [file] } });
    expect(library.pending()).not.toBeNull();

    await userEvent.click(screen.getByTestId('cancel-button'));
    expect(document.activeElement).toBe(screen.getByTestId('choose-button'));
  });

  it('refuses drag and drop when unusable or busy', () => {
    const library = fakeLibrary();
    renderComponent(library, { usable: false });

    const zone = screen.getByTestId('drop-zone');
    const file = new File(['{}'], 'test.json');

    expect(
      fireEvent.dragOver(zone, { dataTransfer: { types: ['Files'], files: [file], dropEffect: 'copy' } }),
    ).toBe(false);
    expect(screen.getByTestId('dropping').textContent).toBe('false');

    fireEvent.drop(zone, { dataTransfer: { types: ['Files'], files: [file] } });
    expect(library.calls).toEqual([]);
  });
});
