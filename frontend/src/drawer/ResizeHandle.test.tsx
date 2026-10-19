// SPDX-License-Identifier: Apache-2.0
/**
 * The resize handle as the phone's sheet uses it (`axis="height"`; the drawer's width: DetailsDrawer.test.tsx): a
 * horizontal splitter named as on a desktop, its value the sheet's height in percent of the canvas's, half or full;
 * the pointer moves the edge freely (upwards heightens, downwards below half too) and, let go, the sheet settles at
 * the nearer of the two heights; ↑ and End take it to full, ↓ and Home to half; a drag let go well below half closes
 * the sheet. A drag in either role follows the pointer that pressed alone (a second finger's press and moves, a
 * hovering mouse's, are not the drag's) and ends when its primary button comes up, also while another is still held:
 * the width kept and the sheet settled, or closed, where the last move left the edge.
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
  type ResizeAxis,
} from './ResizeHandle';

function handle(value: number, axis: ResizeAxis = 'height') {
  const onChange = vi.fn<(value: number) => void>();
  const onCommit = vi.fn<(value: number) => void>();
  const onDismiss = vi.fn<() => void>();
  render(
    <ResizeHandle
      axis={axis}
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

/** Pointer capture on `element` as a browser keeps it (jsdom has none): what was captured and what was let go. */
function capture(element: HTMLElement) {
  const captured: number[] = [];
  const released: number[] = [];
  const held = new Set<number>();
  element.setPointerCapture = (pointerId) => {
    captured.push(pointerId);
    held.add(pointerId);
  };
  element.hasPointerCapture = (pointerId) => held.has(pointerId);
  element.releasePointerCapture = (pointerId) => {
    released.push(pointerId);
    held.delete(pointerId);
  };
  // The capture gone without a pointerup or a pointercancel reaching the handle.
  const lose = (pointerId: number): void => {
    held.delete(pointerId);
  };
  return { captured, released, lose };
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
    fireEvent.pointerMove(element, { buttons: 1, pointerId: 1, clientY: 300 });
    expect(onChange).toHaveBeenLastCalledWith(75);
    fireEvent.pointerMove(element, { buttons: 1, pointerId: 1, clientY: 0 });
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
    fireEvent.pointerMove(element, { buttons: 1, pointerId: 1, clientY: 440 });
    expect(onChange).toHaveBeenLastCalledWith(40);
    expect(dismissing(40)).toBe(false);
    fireEvent.pointerMove(element, { buttons: 1, pointerId: 1, clientY: 400 + (DISMISS_BELOW + 5) * 4 });
    expect(onChange).toHaveBeenLastCalledWith(SHEET_HEIGHT.min - DISMISS_BELOW - 5);
    expect(dismissing(SHEET_HEIGHT.min - DISMISS_BELOW - 5)).toBe(true);
    fireEvent.pointerMove(element, { buttons: 1, pointerId: 1, clientY: 1000 });
    expect(onChange).toHaveBeenLastCalledWith(0);
    fireEvent.pointerUp(element, { pointerId: 1, clientY: 400 + (DISMISS_BELOW - 5) * 4 });
    expect(onCommit).toHaveBeenLastCalledWith(50);
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.pointerDown(element, { button: 0, pointerId: 2, clientY: 400 });
    fireEvent.pointerUp(element, { pointerId: 2, clientY: 400 + (DISMISS_BELOW + 5) * 4 });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe('a drag of the handle', () => {
  it.each([
    { pointerType: 'mouse', button: 2, held: 2, by: "a mouse's right button" },
    { pointerType: 'mouse', button: 1, held: 4, by: "a mouse's middle button" },
    { pointerType: 'pen', button: 2, held: 2, by: "a pen's barrel button" },
  ])(
    'ends when the primary button comes up while $by is held, the width kept where the last move left it',
    ({ pointerType, button, held }) => {
      const { element, onChange, onCommit } = handle(360, 'width');
      const { captured, released } = capture(element);
      fireEvent.pointerDown(element, { button: 0, buttons: 1, clientX: 900, pointerId: 1, pointerType });
      fireEvent.pointerMove(element, { button: -1, buttons: 1, clientX: 880, pointerId: 1, pointerType });
      expect(onChange).toHaveBeenLastCalledWith(380);
      // The other button pressed during the drag (a move with both held): the drag goes on.
      fireEvent.pointerMove(element, { button, buttons: 1 | held, clientX: 870, pointerId: 1, pointerType });
      expect(onChange).toHaveBeenLastCalledWith(390);
      // The primary button released while the other is held: no pointerup until the last button is up, only a
      // move whose `buttons` lacks the primary bit. The drag ends there, its capture let go, and the width stays
      // where the last move left it, for that move and every one after it.
      fireEvent.pointerMove(element, { button: 0, buttons: held, clientX: 860, pointerId: 1, pointerType });
      expect(onCommit).toHaveBeenCalledTimes(1);
      expect(onCommit).toHaveBeenLastCalledWith(390);
      expect(released).toEqual([1]);
      fireEvent.pointerMove(element, { button: -1, buttons: held, clientX: 800, pointerId: 1, pointerType });
      // The other button up: the pointerup, and moves without a button after it.
      fireEvent.pointerUp(element, { button, buttons: 0, clientX: 800, pointerId: 1, pointerType });
      fireEvent.pointerMove(element, { button: -1, buttons: 0, clientX: 700, pointerId: 1, pointerType });
      expect(onChange).toHaveBeenCalledTimes(2);
      expect(onCommit).toHaveBeenCalledTimes(1);
      // A new press of the primary button drags as ever.
      fireEvent.pointerDown(element, { button: 0, buttons: 1, clientX: 900, pointerId: 1, pointerType });
      fireEvent.pointerMove(element, { button: -1, buttons: 1, clientX: 890, pointerId: 1, pointerType });
      expect(onChange).toHaveBeenLastCalledWith(370);
      fireEvent.pointerUp(element, { button: 0, buttons: 0, clientX: 890, pointerId: 1, pointerType });
      expect(onCommit).toHaveBeenLastCalledWith(370);
      expect(captured).toEqual([1, 1]);
    },
  );

  it('ends the sheet’s drag so too: settled at the nearer height, or closed, from where the last move left it', () => {
    const { element, onChange, onCommit, onDismiss } = handle(50);
    const { released } = capture(element);
    const mouse = { pointerId: 1, pointerType: 'mouse' } as const;
    fireEvent.pointerDown(element, { ...mouse, button: 0, buttons: 1, clientY: 400 });
    // 100 px up at 4 px per percent: 75 percent, which settles at full.
    fireEvent.pointerMove(element, { ...mouse, button: -1, buttons: 1, clientY: 300 });
    fireEvent.pointerMove(element, { ...mouse, button: 2, buttons: 3, clientY: 300 });
    expect(onChange).toHaveBeenLastCalledWith(75);
    // The left button up, the right still held, and the pointer back where it pressed (50 percent).
    fireEvent.pointerMove(element, { ...mouse, button: 0, buttons: 2, clientY: 400 });
    expect(onCommit).toHaveBeenLastCalledWith(100);
    expect(onChange).toHaveBeenCalledTimes(2);
    // Dragged well below half, where letting go closes the sheet: it closes.
    fireEvent.pointerUp(element, { ...mouse, button: 2, buttons: 0, clientY: 400 });
    fireEvent.pointerDown(element, { ...mouse, button: 0, buttons: 1, clientY: 400 });
    fireEvent.pointerMove(element, {
      ...mouse,
      button: -1,
      buttons: 1,
      clientY: 400 + (DISMISS_BELOW + 5) * 4,
    });
    fireEvent.pointerMove(element, { ...mouse, button: 0, buttons: 2, clientY: 400 });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledTimes(3);
    expect(released).toEqual([1, 1]);
  });

  it('follows the finger that pressed: a second finger on the handle neither takes it over nor ends it, nor does a hovering mouse', () => {
    const { element, onChange, onCommit } = handle(50);
    const { captured } = capture(element);
    const touch = { pointerType: 'touch' } as const;
    fireEvent.pointerDown(element, { ...touch, button: 0, buttons: 1, clientY: 400, pointerId: 1 });
    fireEvent.pointerMove(element, { ...touch, button: -1, buttons: 1, clientY: 360, pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith(60);
    // A second finger lands on the handle and moves down: the drag stays with the first.
    fireEvent.pointerDown(element, { ...touch, button: 0, buttons: 1, clientY: 360, pointerId: 2 });
    fireEvent.pointerMove(element, { ...touch, button: -1, buttons: 1, clientY: 440, pointerId: 2 });
    // A mouse moved over the handle meanwhile, no button held: another pointer's move.
    fireEvent.pointerMove(element, {
      button: -1,
      buttons: 0,
      clientY: 200,
      pointerId: 3,
      pointerType: 'mouse',
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    // The first finger moves on (100 px up from where it pressed: 75 percent); the second lifts first.
    fireEvent.pointerMove(element, { ...touch, button: -1, buttons: 1, clientY: 300, pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith(75);
    fireEvent.pointerUp(element, { ...touch, button: 0, buttons: 0, clientY: 440, pointerId: 2 });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.pointerUp(element, { ...touch, button: 0, buttons: 0, clientY: 300, pointerId: 1 });
    expect(onCommit).toHaveBeenLastCalledWith(100);
    expect(captured).toEqual([1]);
  });

  it('starts anew at a press once the handle no longer holds the last drag’s pointer, whose end never came', () => {
    const { element, onChange, onCommit } = handle(50);
    const { lose } = capture(element);
    const touch = { pointerType: 'touch' } as const;
    fireEvent.pointerDown(element, { ...touch, button: 0, buttons: 1, clientY: 400, pointerId: 1 });
    fireEvent.pointerMove(element, { ...touch, button: -1, buttons: 1, clientY: 360, pointerId: 1 });
    lose(1);
    fireEvent.pointerDown(element, { ...touch, button: 0, buttons: 1, clientY: 400, pointerId: 2 });
    fireEvent.pointerMove(element, { ...touch, button: -1, buttons: 1, clientY: 300, pointerId: 2 });
    expect(onChange).toHaveBeenLastCalledWith(75);
    fireEvent.pointerUp(element, { ...touch, button: 0, buttons: 0, clientY: 300, pointerId: 2 });
    expect(onCommit).toHaveBeenLastCalledWith(100);
  });
});
