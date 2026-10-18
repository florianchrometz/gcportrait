// SPDX-License-Identifier: Apache-2.0
import { fireEvent, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { expectNoAxeViolations } from '../test/axe';
import { expectInertButFocusable } from '../test/inert';
import { renderInPage } from '../test/page';
import { Select, type SelectOption } from './Select';

type Level = 'auto' | 'folders' | 'projects' | 'networks' | 'all';
const LEVELS: readonly SelectOption<Level>[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'folders', label: 'Folders' },
  { value: 'projects', label: 'Projects' },
  { value: 'networks', label: 'Networks' },
  { value: 'all', label: 'All' },
];

function Picker({ onChange }: { readonly onChange?: (value: Level) => void }): ReactElement {
  const [value, setValue] = useState<Level>('projects');
  return (
    <Select
      label="Detail"
      options={LEVELS}
      value={value}
      onChange={(next) => {
        onChange?.(next);
        setValue(next);
      }}
    />
  );
}

const activeText = (combobox: HTMLElement): string | null | undefined =>
  document.getElementById(combobox.getAttribute('aria-activedescendant') ?? '')?.textContent;

describe('Select (select-only combobox)', () => {
  it('is a combobox named by its label, showing the value; its listbox is in the DOM, hidden', async () => {
    renderInPage(<Picker />);
    const combobox = screen.getByRole('combobox', { name: 'Detail' });
    expect(combobox.textContent).toContain('Projects');
    expect(combobox.getAttribute('aria-haspopup')).toBe('listbox');
    expect(combobox.getAttribute('aria-expanded')).toBe('false');
    const list = document.getElementById(combobox.getAttribute('aria-controls') ?? '');
    expect(list?.getAttribute('role')).toBe('listbox');
    expect(list?.hidden).toBe(true);
    await expectNoAxeViolations();
  });

  it('opens on the current option, moves without wrapping, chooses with Enter, keeps focus on the combobox', async () => {
    const changed = vi.fn();
    renderInPage(<Picker onChange={changed} />);
    const combobox = screen.getByRole('combobox', { name: 'Detail' });
    combobox.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(combobox.getAttribute('aria-expanded')).toBe('true');
    expect(activeText(combobox)).toBe('Projects');
    expect(screen.getByRole('listbox', { name: 'Detail' })).toBeDefined();
    expect(screen.getByRole('option', { name: 'Projects' }).getAttribute('aria-selected')).toBe('true');
    await expectNoAxeViolations();
    await userEvent.keyboard('{End}{ArrowDown}');
    expect(activeText(combobox)).toBe('All');
    await userEvent.keyboard('{Home}{ArrowUp}{ArrowDown}{Enter}');
    expect(changed).toHaveBeenCalledWith('folders');
    expect(combobox.textContent).toContain('Folders');
    expect(combobox.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(combobox);
  });

  it('types ahead, chooses with Tab, closes with Escape without choosing, and never re-chooses the value', async () => {
    const changed = vi.fn();
    renderInPage(<Picker onChange={changed} />);
    const combobox = screen.getByRole('combobox', { name: 'Detail' });
    combobox.focus();
    await userEvent.keyboard('n');
    expect(combobox.getAttribute('aria-expanded')).toBe('true');
    expect(activeText(combobox)).toBe('Networks');
    await userEvent.keyboard('{Escape}');
    expect(changed).not.toHaveBeenCalled();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard('{Enter}');
    expect(changed).not.toHaveBeenCalled();
    await userEvent.keyboard('{Enter}{ArrowDown}');
    await userEvent.tab();
    expect(changed).toHaveBeenCalledWith('networks');
  });

  it('chooses with a click, and closes on a press outside', async () => {
    const changed = vi.fn();
    renderInPage(<Picker onChange={changed} />);
    const combobox = screen.getByRole('combobox', { name: 'Detail' });
    await userEvent.click(combobox);
    await userEvent.click(screen.getByRole('option', { name: 'All' }));
    expect(changed).toHaveBeenCalledWith('all');
    await userEvent.click(combobox);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'outside' }));
    expect(combobox.getAttribute('aria-expanded')).toBe('false');
  });

  it('is inert when disabled', async () => {
    renderInPage(<Select label="Lens" options={LEVELS} value="auto" onChange={() => undefined} disabled />);
    const combobox = screen.getByRole('combobox', { name: 'Lens' });
    expectInertButFocusable(combobox);
    await userEvent.click(combobox);
    combobox.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(combobox.getAttribute('aria-expanded')).toBe('false');
    await expectNoAxeViolations();
  });
});
