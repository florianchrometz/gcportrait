// SPDX-License-Identifier: MIT
import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { expectNoAxeViolations } from '../test/axe';
import { renderInPage } from '../test/page';
import { Tooltip } from './Tooltip';

function Trigger() {
  return (
    <Tooltip content="Copy a link to this view">
      {(describedBy) => (
        <button type="button" aria-describedby={describedBy}>
          Copy link
        </button>
      )}
    </Tooltip>
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe('Tooltip', () => {
  it('describes its trigger, shows at once on focus and goes on blur', async () => {
    renderInPage(<Trigger />);
    const button = screen.getByRole('button', { name: 'Copy link' });
    const tooltip = document.getElementById(button.getAttribute('aria-describedby') ?? '');
    expect(tooltip?.getAttribute('role')).toBe('tooltip');
    expect(tooltip?.hidden).toBe(true);
    act(() => {
      button.focus();
    });
    expect(screen.getByRole('tooltip').textContent).toBe('Copy a link to this view');
    await expectNoAxeViolations();
    act(() => {
      button.blur();
    });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('shows after the pointer rests, stays while it moves onto the tooltip, and goes on Escape', () => {
    vi.useFakeTimers();
    renderInPage(<Trigger />);
    const anchor = screen.getByRole('button', { name: 'Copy link' }).parentElement;
    if (anchor === null) throw new Error('no anchor');
    fireEvent.pointerEnter(anchor);
    expect(screen.queryByRole('tooltip')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.getByRole('tooltip')).toBeDefined();
    // The tooltip is inside the anchor: moving onto it does not leave.
    fireEvent.pointerEnter(screen.getByRole('tooltip'));
    expect(screen.getByRole('tooltip')).toBeDefined();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.pointerEnter(anchor);
    fireEvent.pointerLeave(anchor);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
