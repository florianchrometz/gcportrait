// SPDX-License-Identifier: Apache-2.0
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useEffect, useState, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { expectNoAxeViolations } from '../test/axe';
import { expectInertButFocusable } from '../test/inert';
import { renderInPage } from '../test/page';
import { Combobox, type ComboboxOption } from './Combobox';

const NODES: readonly ComboboxOption[] = [
  { key: 'a', label: 'web-1', description: 'Compute Engine instance · demo-web' },
  { key: 'b', label: 'web-2', description: 'Compute Engine instance · demo-web' },
  { key: 'c', label: 'vpc-shared', description: 'VPC network · demo-net' },
];

function Search({ onChoose }: { readonly onChoose: (option: ComboboxOption) => void }): ReactElement {
  const [text, setText] = useState('');
  const results = text === '' ? [] : NODES.filter((node) => node.label.includes(text));
  return (
    <Combobox
      label="Search assets"
      placeholder="Search assets"
      value={text}
      onValueChange={setText}
      options={results}
      onChoose={onChoose}
    />
  );
}

/** How long the late search below takes to answer (ms). */
const ANSWER_MS = 150;

/**
 * Results that arrive later (a worker's answer, as for the search box): the options are the last answered text's,
 * `busy` while the current text's answer is on its way.
 */
function LateSearch({ onChoose }: { readonly onChoose: (option: ComboboxOption) => void }): ReactElement {
  const [text, setText] = useState('');
  const [answered, setAnswered] = useState<{ text: string; options: readonly ComboboxOption[] }>({
    text: '',
    options: [],
  });
  useEffect(() => {
    const timer = setTimeout(() => {
      setAnswered({ text, options: NODES.filter((node) => node.label.includes(text)) });
    }, ANSWER_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [text]);
  const busy = text !== '' && answered.text !== text;
  return (
    <Combobox
      label="Search assets"
      value={text}
      onValueChange={setText}
      options={text === '' ? [] : answered.options}
      onChoose={onChoose}
      busy={busy}
      enterChoosesFirst
      {...(busy ? { status: '' } : {})}
    />
  );
}

const activeText = (input: HTMLElement): string | null | undefined =>
  document.getElementById(input.getAttribute('aria-activedescendant') ?? '')?.textContent;

describe('Combobox (editable, results listbox)', () => {
  it('shows results while typing, moves with the arrows, chooses with Enter', async () => {
    const chosen = vi.fn();
    renderInPage(<Search onChoose={chosen} />);
    const input = screen.getByRole('combobox', { name: 'Search assets' });
    expect(input.getAttribute('aria-autocomplete')).toBe('list');
    expect(input.getAttribute('aria-expanded')).toBe('false');
    await userEvent.type(input, 'web');
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByRole('option')).toHaveLength(2);
    expect(screen.getByRole('status').textContent).toBe('2 results');
    expect(input.getAttribute('aria-activedescendant')).toBeNull();
    await userEvent.keyboard('{ArrowDown}');
    expect(activeText(input)).toContain('web-1');
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    expect(activeText(input)).toContain('web-1');
    expect(screen.getAllByRole('option')[0]?.getAttribute('aria-selected')).toBe('true');
    await expectNoAxeViolations();
    await userEvent.keyboard('{ArrowUp}{Enter}');
    expect(chosen).toHaveBeenCalledWith(NODES[1]);
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(input);
  });

  it('closes with Escape, then clears the text with a second Escape; says when nothing matches', async () => {
    renderInPage(<Search onChoose={() => undefined} />);
    const input = screen.getByRole<HTMLInputElement>('combobox', { name: 'Search assets' });
    await userEvent.type(input, 'vpc');
    await userEvent.keyboard('{Escape}');
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(input.value).toBe('vpc');
    await userEvent.keyboard('{Escape}');
    expect(input.value).toBe('');
    await userEvent.type(input, 'zzz');
    expect(screen.getByRole('status').textContent).toBe('No results');
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });

  it('leaves an Escape with nothing to close or clear to what holds the box', async () => {
    const seen: boolean[] = [];
    renderInPage(
      <div
        onKeyDown={(event) => {
          if (event.key === 'Escape') seen.push(event.defaultPrevented);
        }}
      >
        <Search onChoose={() => undefined} />
      </div>,
    );
    const input = screen.getByRole<HTMLInputElement>('combobox', { name: 'Search assets' });
    await userEvent.type(input, 'vpc');
    await userEvent.keyboard('{Escape}');
    await userEvent.keyboard('{Escape}');
    await userEvent.keyboard('{Escape}');
    // Closed the list, cleared the text, then nothing of its own: the last one is not prevented.
    expect(seen).toEqual([true, true, false]);
  });

  it('chooses a result with a click without losing focus', async () => {
    const chosen = vi.fn();
    renderInPage(<Search onChoose={chosen} />);
    const input = screen.getByRole('combobox', { name: 'Search assets' });
    await userEvent.type(input, 'vpc');
    await userEvent.click(screen.getByRole('option', { name: /vpc-shared/ }));
    expect(chosen).toHaveBeenCalledWith(NODES[2]);
    expect(document.activeElement).toBe(input);
  });

  it('keeps busy options greyed and unchoosable, and applies Enter to the options that arrive', async () => {
    const chosen = vi.fn();
    renderInPage(<LateSearch onChoose={chosen} />);
    const input = screen.getByRole('combobox', { name: 'Search assets' });
    await userEvent.type(input, 'web');
    await waitFor(() => {
      expect(screen.getAllByRole('option')).toHaveLength(2);
    });
    const list = screen.getByRole('listbox', { name: 'Search assets' });
    expect(list.getAttribute('aria-busy')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('2 results');
    // Enter with no active option chooses the first (enterChoosesFirst).
    await userEvent.keyboard('{Enter}');
    expect(chosen).toHaveBeenLastCalledWith(NODES[0]);

    // A new text, and Enter at once: the earlier text's options stay listed but busy, and are not chosen.
    fireEvent.change(input, { target: { value: 'vpc' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(list.getAttribute('aria-busy')).toBe('true');
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'web-1Compute Engine instance · demo-web',
      'web-2Compute Engine instance · demo-web',
    ]);
    expect(input.getAttribute('aria-activedescendant')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('');
    expect(chosen).toHaveBeenCalledTimes(1);
    // The Enter applies to the new text's options once they arrive.
    await waitFor(() => {
      expect(chosen).toHaveBeenCalledTimes(2);
    });
    expect(chosen).toHaveBeenLastCalledWith(NODES[2]);
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });

  it('ignores a pointer on busy options, and moves to the new first option for a ↓ pressed while busy', async () => {
    const chosen = vi.fn();
    renderInPage(<LateSearch onChoose={chosen} />);
    const input = screen.getByRole('combobox', { name: 'Search assets' });
    await userEvent.type(input, 'web');
    await waitFor(() => {
      expect(screen.getAllByRole('option')).toHaveLength(2);
    });
    fireEvent.change(input, { target: { value: 'web-2' } });
    const stale = screen.getAllByRole('option')[0];
    expect(stale?.textContent).toContain('web-1');
    if (stale !== undefined) {
      fireEvent.pointerMove(stale);
      fireEvent.click(stale);
    }
    expect(chosen).not.toHaveBeenCalled();
    expect(input.getAttribute('aria-activedescendant')).toBeNull();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    await waitFor(() => {
      expect(activeText(input)).toContain('web-2');
    });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(chosen).not.toHaveBeenCalled();
    await userEvent.keyboard('{Enter}');
    expect(chosen).toHaveBeenCalledWith(NODES[1]);
  });

  it('opens the list again on a press on the focused input', async () => {
    renderInPage(<Search onChoose={() => undefined} />);
    const input = screen.getByRole('combobox', { name: 'Search assets' });
    await userEvent.type(input, 'web');
    await userEvent.keyboard('{Escape}');
    expect(input.getAttribute('aria-expanded')).toBe('false');
    await userEvent.click(input);
    expect(input.getAttribute('aria-expanded')).toBe('true');
  });

  it('is inert when disabled', async () => {
    renderInPage(
      <Combobox
        label="Search assets"
        value=""
        onValueChange={() => undefined}
        options={NODES}
        onChoose={() => undefined}
        disabled
      />,
    );
    const input = screen.getByRole<HTMLInputElement>('combobox', { name: 'Search assets' });
    expectInertButFocusable(input);
    expect(input.readOnly).toBe(true);
    await userEvent.type(input, 'web{ArrowDown}');
    expect(input.getAttribute('aria-expanded')).toBe('false');
    await expectNoAxeViolations();
  });
});
