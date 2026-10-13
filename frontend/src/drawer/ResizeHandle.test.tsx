// SPDX-License-Identifier: MIT
/**
 * The resize handle as the phone's sheet uses it (`axis="height"`; the drawer's width: DetailsDrawer.test.tsx): a
 * horizontal splitter named as on a desktop, its value the sheet's height in percent of the canvas's, half or full;
 * the pointer moves the edge freely (upwards heightens, downwards below half too) and, let go, the sheet settles at
 * the nearer of the two heights; ↑ and End take it to full, ↓ and Home to half; a drag let go well below half closes
 * the sheet.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  dismissing,
  DISMISS_BELOW,
  heightText,
  ResizeHandle,
  settleHeight,
  SHEET_HEIGHT,
} from './ResizeHandle';

function handle(value: number) {
  const onChange = vi.fn<(value: number) => void>();
  const onCommit = vi.fn<(value: number) => void>();
  const onDismiss = vi.fn<() => void>();
  render(
    <ResizeHandle
      axis="height"
      value={value}
      controls="drawer"
      pixelsPerUnit={() => 4}
      onChange={onChange}
      onCommit={onCommit}
      onDismiss={onDismiss}
    />,
  );
  return {
    element: screen.getByRole('separator', { name: 'Resize the details drawer' }),
    onChange,
    onCommit,
    onDismiss,
  };
}

describe('the phone sheet’s handle', () => {
  it('is a horizontal splitter from half to full, its value in words', () => {
    const { element } = handle(SHEET_HEIGHT.min);
    expect(element.getAttribute('aria-orientation')).toBe('horizontal');
    expect(element.getAttribute('aria-valuemin')).toBe('50');
    expect(element.getAttribute('aria-valuemax')).toBe('100');
    expect(element.getAttribute('aria-valuetext')).toBe('half the canvas high');
    expect(heightText(70)).toBe('70 percent of the canvas high');
    expect(heightText(100)).toBe('the canvas’s full height');
  });

  it('follows the pointer upwards, never past full, and settles at the nearer of half and full when let go', () => {
    const { element, onChange, onCommit } = handle(50);
    fireEvent.pointerDown(element, { button: 0, pointerId: 1, clientY: 400 });
    // 100 px up at 4 px per percent: 25 percent more.
    fireEvent.pointerMove(element, { pointerId: 1, clientY: 300 });
    expect(onChange).toHaveBeenLastCalledWith(75);
    fireEvent.pointerMove(element, { pointerId: 1, clientY: 0 });
    expect(onChange).toHaveBeenLastCalledWith(100);
    fireEvent.pointerUp(element, { pointerId: 1, clientY: 280 });
    expect(onCommit).toHaveBeenLastCalledWith(100);
    fireEvent.pointerDown(element, { button: 0, pointerId: 2, clientY: 400 });
    fireEvent.pointerUp(element, { pointerId: 2, clientY: 360 });
    expect(onCommit).toHaveBeenLastCalledWith(50);
    expect([60, 74, 75, 99].map(settleHeight)).toEqual([50, 50, 100, 100]);
  });

  it('goes to full with ↑ and End, and to half with ↓ and Home', () => {
    const { element, onCommit } = handle(50);
    fireEvent.keyDown(element, { key: 'ArrowUp' });
    expect(onCommit).toHaveBeenLastCalledWith(100);
    fireEvent.keyDown(element, { key: 'ArrowDown' });
    expect(onCommit).toHaveBeenLastCalledWith(50);
    fireEvent.keyDown(element, { key: 'End' });
    expect(onCommit).toHaveBeenLastCalledWith(100);
    fireEvent.keyDown(element, { key: 'Home' });
    expect(onCommit).toHaveBeenLastCalledWith(50);
  });

  it('follows the pointer below half, back to half when let go a little below, and closes the sheet when let go well below', () => {
    const { element, onChange, onCommit, onDismiss } = handle(50);
    fireEvent.pointerDown(element, { button: 0, pointerId: 1, clientY: 400 });
    // 40 px down at 4 px per percent: 10 percent less, and never under nothing.
    fireEvent.pointerMove(element, { pointerId: 1, clientY: 440 });
    expect(onChange).toHaveBeenLastCalledWith(40);
    expect(dismissing(40)).toBe(false);
    fireEvent.pointerMove(element, { pointerId: 1, clientY: 400 + (DISMISS_BELOW + 5) * 4 });
    expect(onChange).toHaveBeenLastCalledWith(SHEET_HEIGHT.min - DISMISS_BELOW - 5);
    expect(dismissing(SHEET_HEIGHT.min - DISMISS_BELOW - 5)).toBe(true);
    fireEvent.pointerMove(element, { pointerId: 1, clientY: 1000 });
    expect(onChange).toHaveBeenLastCalledWith(0);
    fireEvent.pointerUp(element, { pointerId: 1, clientY: 400 + (DISMISS_BELOW - 5) * 4 });
    expect(onCommit).toHaveBeenLastCalledWith(50);
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.pointerDown(element, { button: 0, pointerId: 2, clientY: 400 });
    fireEvent.pointerUp(element, { pointerId: 2, clientY: 400 + (DISMISS_BELOW + 5) * 4 });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
