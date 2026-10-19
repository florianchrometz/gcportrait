// SPDX-License-Identifier: Apache-2.0
import { fireEvent, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { expectNoAxeViolations } from '../test/axe';
import { expectInertButFocusable } from '../test/inert';
import { renderInPage } from '../test/page';
import type { MenuItem } from './Menu';
import { MenuButton } from './MenuButton';

function sizes(onPick: (size: string) => void, current = 'M'): MenuItem[] {
  return ['S', 'M', 'L'].map((size) => ({
    id: size,
    label: `Demo ${size}`,
    kind: 'radio' as const,
    checked: size === current,
    onSelect: () => {
      onPick(size);
    },
  }));
}

describe('MenuButton', () => {
  it('opens on the checked item with Enter, names its menu, and closes on Escape back to the button', async () => {
    renderInPage(<MenuButton label="Snapshot" items={sizes(() => undefined)} />);
    const button = screen.getByRole('button', { name: 'Snapshot' });
    expect(button.getAttribute('aria-haspopup')).toBe('menu');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.getAttribute('aria-controls')).toBeNull();
    button.focus();
    await userEvent.keyboard('{Enter}');
    const menu = screen.getByRole('menu', { name: 'Snapshot' });
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.getAttribute('aria-controls')).toBe(menu.id);
    expect(document.activeElement?.textContent).toBe('Demo M');
    await expectNoAxeViolations();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('opens on the last item with ↑, chooses with Enter and gives focus back', async () => {
    const pick = vi.fn();
    renderInPage(<MenuButton label="Snapshot" items={sizes(pick)} />);
    const button = screen.getByRole('button', { name: 'Snapshot' });
    button.focus();
    await userEvent.keyboard('{ArrowUp}');
    expect(document.activeElement?.textContent).toBe('Demo L');
    await userEvent.keyboard('{ArrowUp}{Enter}');
    expect(pick).toHaveBeenCalledWith('M');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('toggles on a click, closes on a press outside and on Tab', async () => {
    renderInPage(<MenuButton label="Theme" items={sizes(() => undefined)} />);
    const button = screen.getByRole('button', { name: 'Theme' });
    await userEvent.click(button);
    expect(screen.getByRole('menu')).toBeDefined();
    await userEvent.click(button);
    expect(screen.queryByRole('menu')).toBeNull();
    await userEvent.click(button);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'outside' }));
    expect(screen.queryByRole('menu')).toBeNull();
    await userEvent.click(button);
    await userEvent.tab();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('can leave its open state to the caller', async () => {
    const changes: boolean[] = [];
    function Owner(): ReactElement {
      const [open, setOpen] = useState(false);
      return (
        <MenuButton
          label="Snapshot"
          items={sizes(() => undefined)}
          open={open}
          onOpenChange={(next) => {
            changes.push(next);
            setOpen(next);
          }}
        />
      );
    }
    renderInPage(<Owner />);
    await userEvent.click(screen.getByRole('button', { name: 'Snapshot' }));
    await userEvent.keyboard('{Escape}');
    expect(changes).toEqual([true, false]);
  });

  it('is inert when disabled: focusable, announced unavailable, never opens', async () => {
    renderInPage(<MenuButton label="Theme" items={sizes(() => undefined)} disabled="Arrives later" />);
    const button = screen.getByRole('button', { name: 'Theme' });
    expectInertButFocusable(button);
    expect(button.getAttribute('title')).toBe('Arrives later');
    await userEvent.click(button);
    button.focus();
    await userEvent.keyboard('{Enter}{ArrowDown}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(button.getAttribute('aria-expanded')).toBe('false');
    await expectNoAxeViolations();
  });
});
