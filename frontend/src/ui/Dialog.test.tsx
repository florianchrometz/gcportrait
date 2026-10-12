// SPDX-License-Identifier: MIT
import { fireEvent, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { expectNoAxeViolations } from '../test/axe';
import { renderInPage } from '../test/page';
import { Dialog, type DialogCloseReason } from './Dialog';

function Owner({ onClose }: { readonly onClose?: (reason: DialogCloseReason) => void }): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
      >
        Delete snapshot
      </button>
      <Dialog
        open={open}
        title="Delete snapshot?"
        description="The snapshot is removed from this browser."
        onClose={(reason) => {
          onClose?.(reason);
          setOpen(false);
        }}
        actions={
          <button
            type="button"
            onClick={() => {
              setOpen(false);
            }}
          >
            Delete
          </button>
        }
      >
        <label>
          <input type="checkbox" /> Also delete its saved views
        </label>
      </Dialog>
    </>
  );
}

describe('Dialog (modal)', () => {
  it('is a labelled, described modal dialog; focus moves in, Tab stays in, the page behind is inert', async () => {
    const { container } = renderInPage(<Owner />);
    const opener = screen.getByRole('button', { name: 'Delete snapshot' });
    await userEvent.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Delete snapshot?' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-describedby')).not.toBeNull();
    expect(document.getElementById(dialog.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
      'The snapshot is removed from this browser.',
    );
    expect(container.hasAttribute('inert')).toBe(true);
    const checkbox = screen.getByRole('checkbox', { name: 'Also delete its saved views' });
    expect(document.activeElement).toBe(checkbox);
    await expectNoAxeViolations(dialog);
    await expectNoAxeViolations();
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Delete' }));
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
    await userEvent.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Delete' }));
  });

  it('closes with Escape, Close and the backdrop, giving focus back to its opener', async () => {
    const onClose = vi.fn();
    const { container } = renderInPage(<Owner onClose={onClose} />);
    const opener = screen.getByRole('button', { name: 'Delete snapshot' });
    await userEvent.click(opener);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(container.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(opener);
    await userEvent.click(opener);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await userEvent.click(opener);
    const backdrop = screen.getByRole('dialog').parentElement;
    if (backdrop === null) throw new Error('no backdrop');
    fireEvent.pointerDown(backdrop);
    expect(onClose.mock.calls).toEqual([['escape'], ['close'], ['backdrop']]);
    expect(document.activeElement).toBe(opener);
  });
});
