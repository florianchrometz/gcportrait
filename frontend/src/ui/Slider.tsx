// SPDX-License-Identifier: MIT
/**
 * A thin slider (WAI-ARIA slider pattern), for the timeline later: a thumb with `role="slider"`,
 * `aria-valuemin/max/now` and `aria-valuetext` (`valueText`, e.g. a date), named by its visible label. ← ↓ and
 * → ↑ step down and up, Page Down / Page Up by `bigStep`, Home and End to the ends; a press or a drag on the
 * track moves it there (and focuses the thumb). `onChange` fires for each new value. Inert (`disabled`):
 * announced unavailable, focusable, fixed. `marks` are drawn inside the track, under the thumb, where a press is a
 * press on the track (the timeline's tick markers; the caller hides them from assistive technology).
 *
 * The focus ring is keyboard focus's, as on a native range input: a press of a mouse, a pen or a finger that focuses
 * the thumb marks it (`data-pointer-focus`), and the mark hides the ring (Slider.module.css) until a key is pressed
 * on it or focus leaves it. Any key but a shortcut with Ctrl, Alt or Meta takes the mark off, as such a key turns
 * a native range input's ring on, and the ring then shows as `:focus-visible` says; the mark stays while the
 * window loses focus and gets it back. A press on a thumb that has focus already leaves its ring as it is. Not
 * `focus({ focusVisible: false })`, which in Chromium keeps the ring off for the keys that follow as well.
 */
import {
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
} from 'react';

import { cx } from '../classNames';
import controls from './controls.module.css';
import { inertProps, isInert, type Inert } from './dom';
import styles from './Slider.module.css';

export interface SliderProps {
  /** The visible label that names the slider. */
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  /** Page Up / Page Down (default: a tenth of the range, at least one step). */
  readonly bigStep?: number;
  readonly value: number;
  readonly onChange: (value: number) => void;
  /** The value as words (`aria-valuetext`): "2026-10-08". */
  readonly valueText?: (value: number) => string;
  readonly disabled?: Inert;
  readonly className?: string;
  /** Drawn inside the track, before the thumb (positioned by the caller along the track's width). */
  readonly marks?: ReactNode;
}

/** Keeps a drag's pointer events on the track (where the browser supports pointer capture; jsdom does not). */
function capturePointer(element: Element, pointerId: number): void {
  const capturable: Partial<Pick<Element, 'setPointerCapture'>> = element;
  if (typeof capturable.setPointerCapture === 'function') element.setPointerCapture(pointerId);
}

/** `value` on the step grid from `min`, within [min, max]. */
export function clampToStep(value: number, min: number, max: number, step: number): number {
  const stepped = min + Math.round((value - min) / step) * step;
  return Math.min(max, Math.max(min, Number(stepped.toFixed(10))));
}

export function Slider({
  label,
  min,
  max,
  step = 1,
  bigStep,
  value,
  onChange,
  valueText,
  disabled,
  className,
  marks,
}: SliderProps): ReactElement {
  const labelId = useId();
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  // Focused by a pointer's press, until a key or a move of focus away (see above).
  const [pointerFocus, setPointerFocus] = useState(false);
  const inert = isInert(disabled);
  const range = Math.max(step, max - min);
  const page = bigStep ?? Math.max(step, Math.round(range / 10 / step) * step);
  const current = clampToStep(value, min, max, step);
  const percent = ((current - min) / range) * 100;

  const set = (next: number): void => {
    const clamped = clampToStep(next, min, max, step);
    if (!inert && clamped !== current) onChange(clamped);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!event.ctrlKey && !event.altKey && !event.metaKey) setPointerFocus(false);
    const keys: Record<string, number> = {
      ArrowRight: current + step,
      ArrowUp: current + step,
      ArrowLeft: current - step,
      ArrowDown: current - step,
      PageUp: current + page,
      PageDown: current - page,
      Home: min,
      End: max,
    };
    const next = keys[event.key];
    if (next === undefined) return;
    event.preventDefault();
    set(next);
  };

  const fromPointer = (event: PointerEvent<HTMLDivElement>): void => {
    const box = trackRef.current?.getBoundingClientRect();
    if (box === undefined || box.width <= 0) return;
    set(min + ((event.clientX - box.left) / box.width) * range);
  };

  return (
    <span className={cx(controls.field, styles.slider, className)}>
      <span id={labelId} className={controls.fieldLabel}>
        {label}
      </span>
      <div
        ref={trackRef}
        className={cx(styles.track, inert && styles.inert)}
        onPointerDown={(event) => {
          if (inert) return;
          event.preventDefault();
          const thumb = thumbRef.current;
          if (thumb !== null && thumb.ownerDocument.activeElement !== thumb) {
            thumb.focus();
            if (thumb.ownerDocument.activeElement === thumb) setPointerFocus(true);
          }
          dragging.current = true;
          capturePointer(event.currentTarget, event.pointerId);
          fromPointer(event);
        }}
        onPointerMove={(event) => {
          if (dragging.current) fromPointer(event);
        }}
        onPointerUp={() => {
          dragging.current = false;
        }}
        onPointerCancel={() => {
          dragging.current = false;
        }}
      >
        <div className={styles.fill} style={{ width: `${String(percent)}%` }} />
        {marks}
        <div
          ref={thumbRef}
          role="slider"
          tabIndex={0}
          className={styles.thumb}
          style={{ left: `${String(percent)}%` }}
          aria-labelledby={labelId}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={current}
          aria-valuetext={valueText?.(current)}
          aria-orientation="horizontal"
          data-pointer-focus={pointerFocus ? 'true' : undefined}
          {...inertProps(disabled)}
          onKeyDown={onKeyDown}
          onBlur={(event) => {
            // Focus moved away; the window losing focus leaves it on the thumb, and the mark with it.
            const thumb = event.currentTarget;
            if (thumb.ownerDocument.activeElement !== thumb) setPointerFocus(false);
          }}
        />
      </div>
    </span>
  );
}
