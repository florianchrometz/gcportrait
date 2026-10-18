// SPDX-License-Identifier: MIT
/**
 * A thin slider (WAI-ARIA slider pattern), the timeline's day and the Filters' depth: a thumb with `role="slider"`,
 * `aria-valuemin/max/now` and `aria-valuetext` (`valueText`, e.g. a date), named by its visible label. ← ↓ and
 * → ↑ step down and up, Page Down / Page Up by `bigStep`, Home and End to the ends; a press or a drag on the
 * track moves it there (and focuses the thumb). `onChange` fires for each new value. Inert (`disabled`):
 * announced unavailable, focusable, fixed; a press on its track moves nothing and, its default prevented as an
 * active slider's is, leaves focus where it is. `marks` are drawn inside the track, under the thumb, where a press
 * is a press on the track (the timeline's tick markers; the caller hides them from assistive technology).
 *
 * Only the primary button presses, as on a native range input: a mouse's left button, a pen's tip and a finger
 * (`button` 0). A press of another (a mouse's right or middle button, a pen's barrel button or eraser) moves
 * nothing and starts no drag, and it leaves focus where it is (a native range input takes it): its default is
 * prevented as a primary press's is, so the browser does not move focus off the track either, and a right press
 * still opens the context menu.
 *
 * A drag follows the pointer that pressed (its `pointerId`: another pointer's moves, a hovering mouse's beside a
 * finger, are not the drag's) and ends at that pointer's `pointerup` or `pointercancel`, or at its first move that
 * no longer holds the primary button (`buttons` without bit 1), as on a native range input: a mouse's left button
 * released while its right one is still held sends no `pointerup` until the last button is up, so the drag ends at
 * that move, lets the pointer's capture go and leaves the value where it was. A finger and a pen's tip report the
 * bit (`buttons` 1) for as long as they touch, so their drags end at the lift as ever.
 *
 * The focus ring is keyboard focus's, as on a native range input: a press of a mouse, a pen or a finger that focuses
 * the thumb marks it (`data-pointer-focus`), and the mark hides the ring (Slider.module.css) until a key is pressed
 * on it or focus leaves it. Any key but a shortcut with Ctrl, Alt or Meta takes the mark off, as such a key turns
 * a native range input's ring on, and the ring then shows as `:focus-visible` says; the mark stays while the
 * window loses focus and gets it back. A press on a thumb that has focus already leaves its ring as it is. Not
 * `focus({ focusVisible: false })`, which in Chromium keeps the ring off for the keys that follow as well. On a phone
 * or a tablet the thumb is a 44-pixel touch box round its 16-pixel dot, and the ring goes round the dot
 * (Slider.module.css), so it reaches no further past the track's ends than on a desktop.
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
  /** The label that names the slider, visible unless `hideLabel`. */
  readonly label: string;
  /** Keeps the label for assistive technology only (`.visually-hidden`), where the context already says it. */
  readonly hideLabel?: boolean;
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

/** Lets a drag's pointer go before its `pointerup` (where the browser supports pointer capture; jsdom does not). */
function releasePointer(element: Element, pointerId: number): void {
  const capturable: Partial<Pick<Element, 'hasPointerCapture' | 'releasePointerCapture'>> = element;
  if (capturable.hasPointerCapture?.(pointerId) === true) element.releasePointerCapture(pointerId);
}

/** `value` on the step grid from `min`, within [min, max]. */
export function clampToStep(value: number, min: number, max: number, step: number): number {
  const stepped = min + Math.round((value - min) / step) * step;
  return Math.min(max, Math.max(min, Number(stepped.toFixed(10))));
}

export function Slider({
  label,
  hideLabel = false,
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
  // The pointer that drags the thumb (its `pointerId`), null between drags.
  const dragging = useRef<number | null>(null);
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
      <span id={labelId} className={hideLabel ? 'visually-hidden' : controls.fieldLabel}>
        {label}
      </span>
      <div
        ref={trackRef}
        className={cx(styles.track, inert && styles.inert)}
        onPointerDown={(event) => {
          // Every press's default is prevented, an inert slider's too, so the browser moves focus nowhere.
          event.preventDefault();
          if (inert || event.button !== 0) return;
          const thumb = thumbRef.current;
          if (thumb !== null && thumb.ownerDocument.activeElement !== thumb) {
            thumb.focus();
            if (thumb.ownerDocument.activeElement === thumb) setPointerFocus(true);
          }
          dragging.current = event.pointerId;
          capturePointer(event.currentTarget, event.pointerId);
          fromPointer(event);
        }}
        onPointerMove={(event) => {
          if (event.pointerId !== dragging.current) return;
          if ((event.buttons & 1) === 0) {
            // The primary button is up while another is still held, which sends no pointerup (see above).
            dragging.current = null;
            releasePointer(event.currentTarget, event.pointerId);
            return;
          }
          fromPointer(event);
        }}
        onPointerUp={(event) => {
          if (event.pointerId === dragging.current) dragging.current = null;
        }}
        onPointerCancel={(event) => {
          if (event.pointerId === dragging.current) dragging.current = null;
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
