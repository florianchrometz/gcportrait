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

/** A sheet holding a list that handles Escape itself while open, as the View sheet's Lens list does. */
function Sheet({ inline = false }: { readonly inline?: boolean }) {
  return (
    <Popover label="View" sheet inline={inline}>
      <input
        aria-label="Lens"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && event.currentTarget.value !== '') {
            event.preventDefault();
            event.currentTarget.value = '';
          }
        }}
      />
      <button type="button">Filters</button>
    </Popover>
  );
}

describe('Popover as a sheet', () => {
  it('in place: no button, the content where the popover stands, no dialog', () => {
    renderInPage(<Sheet inline />);
    expect(screen.queryByRole('button', { name: 'View' })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Lens' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Filters' })).toBeDefined();
  });

  it('folded: the content stays mounted while closed, out of reach until the sheet opens', async () => {
    renderInPage(<Sheet />);
    const button = screen.getByRole('button', { name: 'View' });
    const input = screen.getByRole('textbox', { name: 'Lens', hidden: true });
    expect(screen.queryByRole('textbox', { name: 'Lens' })).toBeNull();
    await userEvent.click(button);
    expect(screen.getByRole('dialog', { name: 'View' })).toBeDefined();
    // The same element, not a second one.
    expect(screen.getByRole('textbox', { name: 'Lens' })).toBe(input);
    await expectNoAxeViolations();
  });

  it('leaves an Escape its content handled alone, closes on the next onto its button', async () => {
    renderInPage(<Sheet />);
    const button = screen.getByRole('button', { name: 'View' });
    await userEvent.click(button);
    const input = screen.getByRole('textbox', { name: 'Lens' });
    await userEvent.type(input, 'net');
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: 'View' })).toBeDefined();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('stays open on a press while a modal dialog over it makes it inert', async () => {
    const { container } = renderInPage(<Sheet />);
    await userEvent.click(screen.getByRole('button', { name: 'View' }));
    const outside = document.createElement('div');
    document.body.append(outside);
    container.setAttribute('inert', '');
    fireEvent.pointerDown(outside);
    expect(screen.getByRole('dialog', { name: 'View', hidden: true })).toBeDefined();
    container.removeAttribute('inert');
    fireEvent.pointerDown(outside);
    expect(screen.queryByRole('dialog')).toBeNull();
    outside.remove();
  });
});
