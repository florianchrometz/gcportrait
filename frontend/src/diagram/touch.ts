// SPDX-License-Identifier: MIT
/**
 * The canvas's touch input (AGENTS.md, Product rules, the touch model): the pointer events of fingers
 * (`pointerType` `touch`) read as gestures. A mouse and a pen never come here: d3-zoom keeps their drag and wheel, and
 * the canvas its click, double-click, right-click and hover, as they are.
 *
 * - One finger moved further than `TAP_SLOP` from where it touched pans: what lay under it stays under it.
 * - Two fingers pinch about their midpoint and pan with it (a third and more are ignored); lifting one of them leaves
 *   the other panning from there. Neither ever ends as a tap.
 * - A finger lifted within `TAP_SLOP` of where it touched, before `LONG_PRESS_MS`, taps; a tap that touches within
 *   `DOUBLE_TAP_MS` of the last tap's lift and `DOUBLE_TAP_DISTANCE` of where that one touched is a double tap instead
 *   (its first tap has tapped already, as a double-click's first click has clicked).
 * - A finger resting `LONG_PRESS_MS` within `TAP_SLOP` is a long press; moving or lifting it then does nothing more.
 * - A new first finger `begin`s a gesture: the canvas takes off what the last one left on screen.
 *
 * Pure but for the long-press timer, which the clock it is given runs. The canvas (DiagramCanvas.tsx) turns the
 * gestures into the camera, the selection and what hover shows; the camera's arithmetic is camera.ts's.
 */
import { drawingPointAt, panTransform, pinchTransform, type ScreenPoint } from './camera';
import type { CameraTransform } from './viewport';

/** How far a finger may move (CSS px) and still tap or press: a fingertip is not a mouse (a click's is 4 px). */
export const TAP_SLOP = 10;
/** How long a finger rests without moving before it is a long press (ms). */
export const LONG_PRESS_MS = 500;
/** The longest time from a tap's lift to the touch of the second tap of a double tap (ms). */
export const DOUBLE_TAP_MS = 300;
/** The farthest apart the two taps of a double tap may touch (CSS px). */
export const DOUBLE_TAP_DISTANCE = 24;
/**
 * How long after the last finger left the canvas the browser's events made from a touch (a tap's `mousedown` and
 * `click`, a double tap's `dblclick`) are still the touch's, and not a mouse's (ms; d3-zoom's own figure).
 */
export const TOUCH_MOUSE_MS = 500;

/** What the gestures do on the canvas. Every point is the canvas's (CSS px from its top-left corner). */
export interface TouchHandlers {
  /** The camera now: a pan or a pinch moves it from here. */
  readonly camera: () => CameraTransform;
  /** A finger's pan or a pinch moves the camera to `to`. */
  readonly moveCamera: (to: CameraTransform) => void;
  /** The first finger of a gesture touched the canvas. */
  readonly begin: () => void;
  /** A tap on `target`, at `at`: what a click does. */
  readonly tap: (target: EventTarget | null, at: ScreenPoint) => void;
  /** A double tap: its second tap, on `target`, at `at`. */
  readonly doubleTap: (target: EventTarget | null, at: ScreenPoint) => void;
  /** A long press on `target`, at `at`: what hover shows a mouse. */
  readonly longPress: (target: EventTarget | null, at: ScreenPoint) => void;
}

/** Time for the gestures: the time now (ms), and a timer that calls back once unless it is called off. */
export interface TouchClock {
  readonly now: () => number;
  /** Calls `callback` once after `ms`; answers how to call it off. */
  readonly after: (ms: number, callback: () => void) => () => void;
}

/** The page's clock: `Date.now()` and `setTimeout`. */
export const SYSTEM_CLOCK: TouchClock = {
  now: () => Date.now(),
  after: (ms, callback) => {
    const timer = setTimeout(callback, ms);
    return () => {
      clearTimeout(timer);
    };
  },
};

export interface TouchGestures {
  /**
   * A finger touched the canvas at `at`, on `target`. `primary`: the pointer events' `isPrimary`, the first finger
   * of a new touch; whatever an earlier gesture lost track of (a lift the canvas never heard of) is dropped then.
   */
  down(id: number, at: ScreenPoint, target: EventTarget | null, primary: boolean): void;
  /** A finger moved to `at`. */
  move(id: number, at: ScreenPoint): void;
  /** A finger left the canvas at `at`. */
  up(id: number, at: ScreenPoint): void;
  /** The browser took a finger over (`pointercancel`): it ends nothing but itself. */
  cancel(id: number): void;
  /** Whether a finger is on the canvas, or left it less than `TOUCH_MOUSE_MS` ago. */
  touching(): boolean;
  /** Stops the long-press timer, for good. */
  dispose(): void;
}

/** What the fingers are doing: nothing, one resting (a tap or a long press to be), panning, pinching, held long. */
type Phase = 'idle' | 'rest' | 'pan' | 'pinch' | 'held';

function distance(a: ScreenPoint, b: ScreenPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function createTouchGestures(
  handlers: TouchHandlers,
  clock: TouchClock = SYSTEM_CLOCK,
): TouchGestures {
  // The fingers on the canvas, in the order they touched; the first two make the gesture.
  const fingers = new Map<number, ScreenPoint>();
  let phase: Phase = 'idle';
  // What the drawing showed under the first two fingers (drawing units) when the set of fingers last changed: a pan
  // or a pinch keeps it under them, from whatever camera there is then (a new view fitted mid-gesture included).
  let held: readonly ScreenPoint[] = [];
  // The finger that may tap or press: where and on what it touched, and when.
  let first: { at: ScreenPoint; target: EventTarget | null; time: number } | null = null;
  // The last tap, which a second one may make a double tap: where it touched, and when it lifted.
  let lastTap: { at: ScreenPoint; lifted: number } | null = null;
  let lastUp = Number.NEGATIVE_INFINITY;
  let stopTimer: (() => void) | null = null;

  const callOffTimer = (): void => {
    stopTimer?.();
    stopTimer = null;
  };
  const rebase = (): void => {
    const camera = handlers.camera();
    held = [...fingers.values()].slice(0, 2).map((at) => drawingPointAt(camera, at));
  };
  // The finger that is left after the other of two lifted pans on from where it is.
  const panOn = (): void => {
    if (phase === 'pinch') phase = 'pan';
    rebase();
  };
  const end = (): void => {
    callOffTimer();
    phase = 'idle';
    first = null;
    lastUp = clock.now();
  };

  return {
    down(id, at, target, primary) {
      if (primary && fingers.size > 0) {
        fingers.clear();
        end();
      }
      if (fingers.has(id) || fingers.size >= 2) return;
      fingers.set(id, at);
      if (fingers.size === 1) {
        handlers.begin();
        phase = 'rest';
        const touched = { at, target, time: clock.now() };
        first = touched;
        stopTimer = clock.after(LONG_PRESS_MS, () => {
          stopTimer = null;
          if (phase !== 'rest' || first !== touched) return;
          phase = 'held';
          lastTap = null;
          handlers.longPress(touched.target, touched.at);
        });
      } else {
        callOffTimer();
        phase = 'pinch';
        first = null;
        lastTap = null;
      }
      rebase();
    },

    move(id, at) {
      if (!fingers.has(id)) return;
      fingers.set(id, at);
      if (phase === 'rest') {
        if (first !== null && distance(at, first.at) <= TAP_SLOP) return;
        callOffTimer();
        phase = 'pan';
        first = null;
        lastTap = null;
      }
      const [a, b] = [...fingers.values()];
      const [under, other] = held;
      if (phase === 'pan' && a !== undefined && under !== undefined) {
        handlers.moveCamera(panTransform(handlers.camera(), under, a));
      } else if (
        phase === 'pinch' &&
        a !== undefined &&
        b !== undefined &&
        under !== undefined &&
        other !== undefined
      ) {
        handlers.moveCamera(pinchTransform(handlers.camera(), [under, other], [a, b]));
      }
    },

    up(id, at) {
      if (!fingers.has(id)) return;
      fingers.delete(id);
      if (fingers.size > 0) {
        panOn();
        return;
      }
      const tapped = phase === 'rest' ? first : null;
      end();
      if (tapped === null || distance(at, tapped.at) > TAP_SLOP) {
        lastTap = null;
        return;
      }
      const previous = lastTap;
      if (
        previous !== null &&
        tapped.time - previous.lifted <= DOUBLE_TAP_MS &&
        distance(tapped.at, previous.at) <= DOUBLE_TAP_DISTANCE
      ) {
        lastTap = null;
        handlers.doubleTap(tapped.target, tapped.at);
        return;
      }
      lastTap = { at: tapped.at, lifted: lastUp };
      handlers.tap(tapped.target, tapped.at);
    },

    cancel(id) {
      if (!fingers.has(id)) return;
      fingers.delete(id);
      if (fingers.size > 0) {
        panOn();
        return;
      }
      end();
      lastTap = null;
    },

    touching() {
      return fingers.size > 0 || clock.now() - lastUp < TOUCH_MOUSE_MS;
    },

    dispose() {
      callOffTimer();
    },
  };
}
