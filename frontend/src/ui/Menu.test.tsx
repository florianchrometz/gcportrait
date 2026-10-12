// SPDX-License-Identifier: MIT
import { fireEvent, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, onTestFinished, vi } from 'vitest';

import { expectNoAxeViolations } from '../test/axe';
import { renderInPage } from '../test/page';
import { Menu, type MenuItem } from './Menu';
import { TYPEAHEAD_MS } from './typeahead';

function setup(items?: MenuItem[]) {
  const onClose = vi.fn();
  const copy = vi.fn();
  const drill = vi.fn();
  const list: MenuItem[] = items ?? [
    { id: 'console', label: 'Open in Cloud Console', href: 'https://console.cloud.google.com/x' },
    { id: 'copy', label: 'Copy resource name', onSelect: copy },
    { id: 'drill', label: 'Drill in', onSelect: drill },
  ];
  renderInPage(<Menu label="Actions for web-1" items={list} at={{ x: 40, y: 50 }} onClose={onClose} />);
  return { onClose, copy, drill };
}

describe('Menu (the minimal accessible menu primitive)', () => {
  it('is a named menu of items at the given point, the first item focused', () => {
    setup();
    const menu = screen.getByRole('menu', { name: 'Actions for web-1' });
    expect(menu.style.left).toBe('40px');
    expect(menu.style.top).toBe('50px');
    const items = screen.getAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'Open in Cloud Console',
      'Copy resource name',
      'Drill in',
    ]);
    expect(document.activeElement).toBe(items[0]);
    expect(items.map((item) => item.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
  });

  it('opens a link item only when activated, in a new tab, without an opener', () => {
    setup();
    const link = screen.getByRole('menuitem', { name: 'Open in Cloud Console' });
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('https://console.cloud.google.com/x');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('moves with the arrows (wrapping), Home and End, and activates with Enter', async () => {
    const { onClose, copy, drill } = setup();
    const items = screen.getAllByRole('menuitem');
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(items[1]);
    await userEvent.keyboard('{End}');
    expect(document.activeElement).toBe(items[2]);
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(items[0]);
    await userEvent.keyboard('{ArrowUp}{Home}{ArrowDown}');
    expect(document.activeElement).toBe(items[1]);
    await userEvent.keyboard('{Enter}');
    expect(copy).toHaveBeenCalledTimes(1);
    expect(drill).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledWith('select');
  });

  it('closes with Escape, with Tab and with a press outside', async () => {
    const { onClose } = setup();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenLastCalledWith('escape');
    await userEvent.keyboard('{Tab}');
    expect(onClose).toHaveBeenLastCalledWith('tab');
    fireEvent.pointerDown(screen.getByRole('button', { name: 'outside' }));
    expect(onClose).toHaveBeenLastCalledWith('outside');
  });
});

describe('Menu (item kinds, type-ahead, anchoring)', () => {
  it('has radio and checkbox items with aria-checked, keeps open for options, skips disabled items', async () => {
    const onClose = vi.fn();
    const chosen: string[] = [];
    render(
      <main>
        <h1>Menus</h1>
        <Menu
          label="Export"
          items={[
            {
              id: 'a',
              label: 'Light',
              kind: 'radio',
              checked: true,
              keepOpen: true,
              onSelect: () => chosen.push('a'),
            },
            {
              id: 'b',
              label: 'Dark',
              kind: 'radio',
              checked: false,
              keepOpen: true,
              onSelect: () => chosen.push('b'),
            },
            { id: 'c', label: 'Embed fonts', kind: 'checkbox', checked: false, keepOpen: true },
            { id: 'd', label: 'Download', disabled: true, onSelect: () => chosen.push('d') },
          ]}
          onClose={onClose}
        />
      </main>,
    );
    const menu = screen.getByRole('menu', { name: 'Export' });
    // Anchored under a trigger: no fixed position.
    expect(menu.style.left).toBe('');
    expect(screen.getAllByRole('menuitemradio').map((item) => item.getAttribute('aria-checked'))).toEqual([
      'true',
      'false',
    ]);
    expect(screen.getByRole('menuitemcheckbox', { name: 'Embed fonts' }).getAttribute('aria-checked')).toBe(
      'false',
    );
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(chosen).toEqual(['b']);
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.keyboard('{End}{Enter}');
    expect(chosen).toEqual(['b']);
    expect(screen.getByRole('menuitem', { name: 'Download' }).getAttribute('aria-disabled')).toBe('true');
    expect(onClose).not.toHaveBeenCalled();
    await expectNoAxeViolations();
  });

  it('moves to the next item starting with the typed characters (type-ahead)', async () => {
    // The typed text is kept for TYPEAHEAD_MS by the clock (Date.now): the test moves the clock, never waits.
    vi.useFakeTimers({ toFake: ['Date'] });
    onTestFinished(() => {
      vi.useRealTimers();
    });
    render(
      <Menu
        label="Lenses"
        items={['Overview', 'Networking', 'Load balancing', 'Data', 'Security', 'Serverless'].map(
          (label) => ({
            id: label,
            label,
          }),
        )}
        onClose={() => undefined}
      />,
    );
    const focused = (): string | null | undefined => document.activeElement?.textContent;
    await userEvent.keyboard('s');
    expect(focused()).toBe('Security');
    await userEvent.keyboard('s');
    expect(focused()).toBe('Serverless');
    await userEvent.keyboard('s');
    expect(focused()).toBe('Security');
    vi.setSystemTime(Date.now() + TYPEAHEAD_MS + 1);
    await userEvent.keyboard('lo');
    expect(focused()).toBe('Load balancing');
    await userEvent.keyboard('x');
    expect(focused()).toBe('Load balancing');
  });

  it('passes axe as a context menu at a point', async () => {
    setup();
    await expectNoAxeViolations();
  });
});
