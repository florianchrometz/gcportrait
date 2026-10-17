// SPDX-License-Identifier: MIT
/**
 * The drawer's resize handle: a focusable window splitter (WAI-ARIA `separator` with a value). Beside the canvas (a
 * desktop) and over its right side (a tablet) it is the drawer's left edge and its value the drawer's width: dragging
 * moves the edge; ← and → move it by {@link WIDTH_STEP} px (← widens the drawer, as the edge moves left), Home and
 * End go to the narrowest and the widest. On a phone the drawer is a sheet over the lower part of the canvas and the
 * handle its top edge (`axis="height"`), its value the sheet's height in percent of the canvas's. The sheet rests at
 * one of two heights: half ({@link SHEET_HEIGHT}`.min`, never the whole canvas) and full; dragging moves the edge
 * freely, down below half too (the sheet follows the finger on its way out; {@link dismissing} tells when letting go
 * there closes it), and, let go, the sheet settles at the nearer of the two, or closes (`onDismiss`) when let go well
 * below half ({@link DISMISS_BELOW}); ↑ and End take it to full, ↓ and Home to half. `onChange` reports values while
 * dragging; `onCommit` the value to keep when a drag ends or a key moved it. Its value for assistive technology stays
 * between half and full. Its name is the same in either role.
 *
 * Only the primary button drags: a mouse's left button, a pen's tip and a finger (`button` 0). A drag follows the
 * pointer that pressed (its `pointerId`: another pointer's moves, a hovering mouse's beside a finger, are not the
 * drag's, and another press while the handle still holds the drag's pointer, a second finger's, starts nothing) and
 * ends at that pointer's `pointerup` or `pointercancel`, or at its first move that no longer holds the primary button
 * (`buttons` without bit 1): a mouse's left button released while its right one is still held sends no `pointerup`
 * until the last button is up, so the drag ends at that move: it lets the pointer's capture go and ends where the
 * last move left the edge, as letting go there would (the width kept; the sheet settled, or closed). A finger and a
 * pen's tip report the bit (`buttons` 1) for as long as they touch, so their drags end at the lift as ever.
 */
import { useRef, type KeyboardEvent, type PointerEvent, type ReactElement } from 'react';

import { cx } from '../classNames';
import { DRAWER_WIDTH } from '../storage/preferences';
import styles from './DetailsDrawer.module.css';

/** How far one arrow key moves the edge (CSS px). */
export const WIDTH_STEP = 10;

/** The phone's sheet: its two heights in percent of the canvas's, half and full. */
export const SHEET_HEIGHT = { min: 50, max: 100 } as const;

/** A drag of the sheet's edge let go this far below half (percent of the canvas's height) closes the sheet. */
export const DISMISS_BELOW = 20;

/** Lets a drag's pointer go before its `pointerup` (where the browser supports pointer capture; jsdom does not). */
function releasePointer(element: Element, pointerId: number): void {
  const capturable: Partial<Pick<Element, 'hasPointerCapture' | 'releasePointerCapture'>> = element;
  if (capturable.hasPointerCapture?.(pointerId) === true) element.releasePointerCapture(pointerId);
}

/** Whether `element` still holds `pointerId`'s capture (assumed where the browser has no pointer capture: jsdom). */
function holdsPointer(element: Element, pointerId: number): boolean {
  const capturable: Partial<Pick<Element, 'hasPointerCapture'>> = element;
  return capturable.hasPointerCapture?.(pointerId) ?? true;
}

export function clampWidth(width: number): number {
  return Math.round(Math.min(DRAWER_WIDTH.max, Math.max(DRAWER_WIDTH.min, width)));
}

export function clampHeight(height: number): number {
  return Math.round(Math.min(SHEET_HEIGHT.max, Math.max(SHEET_HEIGHT.min, height)));
}

/** A height while dragged: from nothing to full, so the sheet follows the finger below half on its way out. */
export function followHeight(height: number): number {
  return Math.round(Math.min(SHEET_HEIGHT.max, Math.max(0, height)));
}

/** Whether a sheet dragged to `height` closes when let go there. */
export function dismissing(height: number): boolean {
  return height < SHEET_HEIGHT.min - DISMISS_BELOW;
}

/** The height the sheet settles at: the nearer of half and full. */
export function settleHeight(height: number): number {
  return height >= (SHEET_HEIGHT.min + SHEET_HEIGHT.max) / 2 ? SHEET_HEIGHT.max : SHEET_HEIGHT.min;
}

/** The sheet's height in words. */
export function heightText(height: number): string {
  if (height <= SHEET_HEIGHT.min) return 'half the canvas high';
  if (height >= SHEET_HEIGHT.max) return 'the canvas’s full height';
  return `${String(height)} percent of the canvas high`;
}

export type ResizeAxis = 'width' | 'height';

export interface ResizeHandleProps {
  /** `width` (the default): the drawer's left edge, in CSS px; `height`: the phone's sheet's top edge, in percent. */
  readonly axis?: ResizeAxis;
  readonly value: number;
  /** The drawer's id (`aria-controls`). */
  readonly controls: string;
  /** With `height`: how many CSS px one percent is (the canvas's height over 100), read when a drag starts. */
  readonly pixelsPerUnit?: () => number;
  readonly onChange: (value: number) => void;
  readonly onCommit: (value: number) => void;
  /** With `height`: the sheet's edge was dragged down well below half and let go. */
  readonly onDismiss?: () => void;
}

export function ResizeHandle({
  axis = 'width',
  value,
  controls,
  pixelsPerUnit,
  onChange,
  onCommit,
  onDismiss,
}: ResizeHandleProps): ReactElement {
  const drag = useRef<{
    readonly pointer: number;
    readonly at: number;
    readonly value: number;
    readonly unit: number;
    /** The value the drag's last move made (its start value before the first). */
    last: number;
  } | null>(null);
  const tall = axis === 'height';
  const clamp = tall ? clampHeight : clampWidth;
  const follow = tall ? followHeight : clampWidth;
  const range = tall ? SHEET_HEIGHT : DRAWER_WIDTH;

  // The value a pointer at `event` makes, before clamping: the edge follows it (leftwards widens, upwards heightens);
  // null for another pointer than the drag's.
  const dragged = (event: PointerEvent<HTMLDivElement>): number | null => {
    const start = drag.current;
    if (start?.pointer !== event.pointerId) return null;
    const moved = start.at - (tall ? event.clientY : event.clientX);
    return start.value + moved / start.unit;
  };

  // The drag let go at `next`: the sheet closes when well below half or settles at half or full; the edge stays.
  const finish = (next: number): void => {
    drag.current = null;
    if (tall && onDismiss !== undefined && dismissing(next)) onDismiss();
    else onCommit(tall ? settleHeight(next) : clamp(next));
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    const target = event.currentTarget;
    // Another pointer drags already, a second finger's press: the drag stays with the first (see above).
    const current = drag.current;
    if (current !== null && current.pointer !== event.pointerId && holdsPointer(target, current.pointer))
      return;
    const unit = tall ? (pixelsPerUnit?.() ?? 0) : 1;
    drag.current = {
      pointer: event.pointerId,
      at: tall ? event.clientY : event.clientX,
      value,
      unit: unit > 0 ? unit : 1,
      last: value,
    };
    if (typeof target.setPointerCapture === 'function') target.setPointerCapture(event.pointerId);
    target.focus();
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const start = drag.current;
    const next = dragged(event);
    if (start === null || next === null) return;
    if ((event.buttons & 1) === 0) {
      // The primary button is up while another is still held, which sends no pointerup (see above).
      releasePointer(event.currentTarget, event.pointerId);
      finish(start.last);
      return;
    }
    start.last = follow(next);
    onChange(start.last);
  };
  const end = (event: PointerEvent<HTMLDivElement>): void => {
    const next = dragged(event);
    if (next !== null) finish(next);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const next = tall
      ? event.key === 'ArrowUp' || event.key === 'End'
        ? range.max
        : event.key === 'ArrowDown' || event.key === 'Home'
          ? range.min
          : null
      : event.key === 'ArrowLeft'
        ? value + WIDTH_STEP
        : event.key === 'ArrowRight'
          ? value - WIDTH_STEP
          : event.key === 'Home'
            ? range.min
            : event.key === 'End'
              ? range.max
              : null;
    if (next === null) return;
    event.preventDefault();
    onCommit(clamp(next));
  };

  return (
    <div
      role="separator"
      aria-orientation={tall ? 'horizontal' : 'vertical'}
      aria-label="Resize the details drawer"
      aria-controls={controls}
      aria-valuemin={range.min}
      aria-valuemax={range.max}
      aria-valuenow={tall ? clampHeight(value) : value}
      aria-valuetext={tall ? heightText(value) : `${String(value)} pixels wide`}
      tabIndex={0}
      className={cx(styles.handle, tall && styles.sheetHandle)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={onKeyDown}
    />
  );
}
