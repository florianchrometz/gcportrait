// SPDX-License-Identifier: MIT
/**
 * The drawer's resize handle on its left edge: a focusable window splitter (WAI-ARIA `separator` with a value)
 * whose value is the drawer's width. Dragging it moves the edge; with the keyboard, ← and → move it by
 * {@link WIDTH_STEP} px (← widens the drawer, as the edge moves left), Home and End go to the narrowest and the
 * widest. `onChange` reports widths while dragging; `onCommit` the width to keep when a drag ends or a key moved
 * it.
 */
import { useRef, type KeyboardEvent, type PointerEvent, type ReactElement } from 'react';

import { DRAWER_WIDTH } from '../storage/preferences';
import styles from './DetailsDrawer.module.css';

/** How far one arrow key moves the edge (CSS px). */
export const WIDTH_STEP = 10;

export function clampWidth(width: number): number {
  return Math.round(Math.min(DRAWER_WIDTH.max, Math.max(DRAWER_WIDTH.min, width)));
}

export interface ResizeHandleProps {
  readonly width: number;
  /** The drawer's id (`aria-controls`). */
  readonly controls: string;
  readonly onChange: (width: number) => void;
  readonly onCommit: (width: number) => void;
}

export function ResizeHandle({ width, controls, onChange, onCommit }: ResizeHandleProps): ReactElement {
  const drag = useRef<{ readonly pointer: number; readonly x: number; readonly width: number } | null>(null);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    drag.current = { pointer: event.pointerId, x: event.clientX, width };
    const target = event.currentTarget;
    if (typeof target.setPointerCapture === 'function') target.setPointerCapture(event.pointerId);
    target.focus();
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const start = drag.current;
    if (start?.pointer !== event.pointerId) return;
    onChange(clampWidth(start.width + start.x - event.clientX));
  };
  const end = (event: PointerEvent<HTMLDivElement>): void => {
    const start = drag.current;
    if (start?.pointer !== event.pointerId) return;
    drag.current = null;
    onCommit(clampWidth(start.width + start.x - event.clientX));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const next =
      event.key === 'ArrowLeft'
        ? width + WIDTH_STEP
        : event.key === 'ArrowRight'
          ? width - WIDTH_STEP
          : event.key === 'Home'
            ? DRAWER_WIDTH.min
            : event.key === 'End'
              ? DRAWER_WIDTH.max
              : null;
    if (next === null) return;
    event.preventDefault();
    onCommit(clampWidth(next));
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the details drawer"
      aria-controls={controls}
      aria-valuemin={DRAWER_WIDTH.min}
      aria-valuemax={DRAWER_WIDTH.max}
      aria-valuenow={width}
      aria-valuetext={`${String(width)} pixels wide`}
      tabIndex={0}
      className={styles.handle}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={onKeyDown}
    />
  );
}
