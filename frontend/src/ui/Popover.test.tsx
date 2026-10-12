// SPDX-License-Identifier: MIT
import { fireEvent, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { expectNoAxeViolations } from '../test/axe';
import { renderInPage } from '../test/page';
import { Popover } from './Popover';

function Filters() {
  return (
    <Popover label="Filters" title="View filters">
      {(close) => (
        <>
          <label>
            <input type="checkbox" /> Hide empty projects
          </label>
          <label>
            <input type="checkbox" /> Hide disconnected
          </label>
          <button type="button" onClick={close}>
            Apply
          </button>
        </>
      )}
    </Popover>
  );
}

describe('Popover', () => {
  it('opens a named dialog it controls, moves focus in and traps Tab inside', async () => {
    renderInPage(<Filters />);
    const button = screen.getByRole('button', { name: 'Filters' });
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
    await userEvent.click(button);
    const dialog = screen.getByRole('dialog', { name: 'View filters' });
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.getAttribute('aria-controls')).toBe(dialog.id);
    expect(dialog.getAttribute('aria-modal')).toBeNull();
    const first = screen.getByRole('checkbox', { name: 'Hide empty projects' });
    expect(document.activeElement).toBe(first);
    await expectNoAxeViolations();
    await userEvent.tab();
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Apply' }));
    await userEvent.tab();
    expect(document.activeElement).toBe(first);
    await userEvent.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Apply' }));
  });

  it('closes with Escape (focus back on the button), with its own action, and on a press outside', async () => {
    renderInPage(<Filters />);
    const button = screen.getByRole('button', { name: 'Filters' });
    await userEvent.click(button);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    await userEvent.click(button);
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(button);
    await userEvent.click(button);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'outside' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('is inert when disabled', async () => {
    renderInPage(
      <Popover label="Focus" disabled>
        <p>never shown</p>
      </Popover>,
    );
    const button = screen.getByRole('button', { name: 'Focus' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    await userEvent.click(button);
    expect(screen.queryByRole('dialog')).toBeNull();
    await expectNoAxeViolations();
  });
});
