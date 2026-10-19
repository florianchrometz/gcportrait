// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
/**
 * The fingers' gestures on their own (touch.ts), on a clock the test runs: a pan that never taps, a pinch, a tap, a
 * double tap (timed from the first tap's lift) and when two taps are not one, a long press, a lifted finger of two, a
 * cancelled finger, a gesture that lost track of a lift.
 */
import { describe, expect, it } from 'vitest';

import type { ScreenPoint } from './camera';
import {
  createTouchGestures,
  DOUBLE_TAP_DISTANCE,
  DOUBLE_TAP_MS,
  LONG_PRESS_MS,
  TAP_SLOP,
  TOUCH_MOUSE_MS,
  type TouchClock,
} from './touch';
import type { CameraTransform } from './viewport';

/** A clock the test moves on by hand, with its timers. */
function testClock(): TouchClock & { advance: (ms: number) => void } {
  let now = 1_000;
  const timers = new Set<{ at: number; callback: () => void }>();
  return {
    now: () => now,
    after: (ms, callback) => {
      const timer = { at: now + ms, callback };
      timers.add(timer);
      return () => {
        timers.delete(timer);
      };
    },
    advance: (ms) => {
      now += ms;
      for (const timer of [...timers].sort((a, b) => a.at - b.at)) {
        if (timer.at > now) continue;
        timers.delete(timer);
        timer.callback();
      }
    },
  };
}

/** What a finger touched, by name: one event target per name. */
const targets = new Map<string, EventTarget>();
const names = new Map<EventTarget | null, string>();
function on(name: string): EventTarget {
  let target = targets.get(name);
  if (target === undefined) {
    target = new EventTarget();
    targets.set(name, target);
    names.set(target, name);
  }
  return target;
}
const nameOf = (target: EventTarget | null): string => names.get(target) ?? 'nothing';

/** The gestures with every handler recorded, and a camera the moves set. */
function setUp() {
  const clock = testClock();
  const events: string[] = [];
  let camera: CameraTransform = { x: 0, y: 0, k: 1 };
  const gestures = createTouchGestures(
    {
      camera: () => camera,
      moveCamera: (to) => {
        camera = to;
        events.push('move');
      },
      begin: () => events.push('begin'),
      tap: (target, at) => events.push(`tap ${nameOf(target)} ${String(at.x)},${String(at.y)}`),
      doubleTap: (target, at) => events.push(`double ${nameOf(target)} ${String(at.x)},${String(at.y)}`),
      longPress: (target, at) => events.push(`press ${nameOf(target)} ${String(at.x)},${String(at.y)}`),
    },
    clock,
  );
  return { gestures, clock, events, camera: () => camera };
}

const point = (x: number, y: number): ScreenPoint => ({ x, y });
/** What the gestures did, but the camera's moves. */
const acts = (events: readonly string[]): string[] => events.filter((event) => event !== 'move');

describe('one finger', () => {
  it('taps where it stayed put, on what it touched, and begins each gesture', () => {
    const { gestures, events } = setUp();
    const node = 'card';
    gestures.down(1, point(100, 100), on(node), true);
    gestures.move(1, point(100 + TAP_SLOP - 1, 100));
    gestures.up(1, point(100 + TAP_SLOP - 1, 100));
    expect(events).toEqual(['begin', 'tap card 100,100']);
  });

  it('pans once it moves past the slop, keeping what it touched under it, and never taps', () => {
    const { gestures, events, camera } = setUp();
    gestures.down(1, point(100, 100), on('card'), true);
    gestures.move(1, point(100, 100 + TAP_SLOP + 1));
    expect(camera()).toEqual({ x: 0, y: TAP_SLOP + 1, k: 1 });
    gestures.move(1, point(60, 150));
    expect(camera()).toEqual({ x: -40, y: 50, k: 1 });
    // Back where it touched: still a pan, not a tap.
    gestures.move(1, point(100, 100));
    gestures.up(1, point(100, 100));
    expect(camera()).toEqual({ x: 0, y: 0, k: 1 });
    expect(acts(events)).toEqual(['begin']);
  });

  it('does not tap when it lifts far from where it touched without a move heard', () => {
    const { gestures, events } = setUp();
    gestures.down(1, point(100, 100), on('card'), true);
    gestures.up(1, point(100, 140));
    expect(events).toEqual(['begin']);
  });

  it('long-presses after resting LONG_PRESS_MS within the slop, and lifting then does nothing more', () => {
    const { gestures, clock, events } = setUp();
    gestures.down(1, point(80, 90), on('card'), true);
    gestures.move(1, point(83, 92));
    clock.advance(LONG_PRESS_MS - 1);
    expect(events).toEqual(['begin']);
    clock.advance(1);
    expect(events).toEqual(['begin', 'press card 80,90']);
    // Moving a held finger pans nothing.
    gestures.move(1, point(200, 200));
    gestures.up(1, point(200, 200));
    expect(events).toEqual(['begin', 'press card 80,90']);
  });

  it('never long-presses once it panned, or once it lifted', () => {
    const { gestures, clock, events } = setUp();
    gestures.down(1, point(0, 0), on('a'), true);
    gestures.move(1, point(50, 0));
    clock.advance(LONG_PRESS_MS * 2);
    gestures.up(1, point(50, 0));
    gestures.down(2, point(0, 0), on('b'), true);
    gestures.up(2, point(0, 0));
    clock.advance(LONG_PRESS_MS * 2);
    expect(acts(events)).toEqual(['begin', 'begin', 'tap b 0,0']);
  });
});

describe('double taps', () => {
  it('make the second of two quick taps near each other a double tap, after the first tapped', () => {
    const { gestures, clock, events } = setUp();
    gestures.down(1, point(200, 200), on('chip'), true);
    gestures.up(1, point(200, 200));
    clock.advance(DOUBLE_TAP_MS - 50);
    gestures.down(2, point(210, 205), on('chip'), true);
    gestures.up(2, point(210, 205));
    expect(events).toEqual(['begin', 'tap chip 200,200', 'begin', 'double chip 210,205']);
    // A third tap at once starts over: a tap.
    gestures.down(3, point(210, 205), on('chip'), true);
    gestures.up(3, point(210, 205));
    expect(events.at(-1)).toBe('tap chip 210,205');
  });

  it('count the time from the first tap’s lift to the second’s touch, however long the first rested', () => {
    const { gestures, clock, events } = setUp();
    gestures.down(1, point(50, 50), on('card'), true);
    clock.advance(LONG_PRESS_MS - 100);
    gestures.up(1, point(50, 50));
    clock.advance(DOUBLE_TAP_MS);
    gestures.down(2, point(50, 50 + DOUBLE_TAP_DISTANCE), on('card'), true);
    gestures.up(2, point(50, 50 + DOUBLE_TAP_DISTANCE));
    expect(acts(events).filter((event) => !event.startsWith('begin'))).toEqual([
      'tap card 50,50',
      `double card 50,${String(50 + DOUBLE_TAP_DISTANCE)}`,
    ]);
  });

  it('are two taps when the second comes later than DOUBLE_TAP_MS or further than DOUBLE_TAP_DISTANCE', () => {
    const { gestures, clock, events } = setUp();
    gestures.down(1, point(0, 0), on('a'), true);
    gestures.up(1, point(0, 0));
    clock.advance(DOUBLE_TAP_MS + 1);
    gestures.down(2, point(0, 0), on('a'), true);
    gestures.up(2, point(0, 0));
    clock.advance(10);
    gestures.down(3, point(DOUBLE_TAP_DISTANCE + 1, 0), on('b'), true);
    gestures.up(3, point(DOUBLE_TAP_DISTANCE + 1, 0));
    expect(acts(events).filter((event) => !event.startsWith('begin'))).toEqual([
      'tap a 0,0',
      'tap a 0,0',
      `tap b ${String(DOUBLE_TAP_DISTANCE + 1)},0`,
    ]);
  });

  it('never follow a pan or a long press', () => {
    const { gestures, clock, events } = setUp();
    gestures.down(1, point(0, 0), on('a'), true);
    gestures.up(1, point(0, 0));
    gestures.down(2, point(0, 0), on('a'), true);
    gestures.move(2, point(40, 0));
    gestures.up(2, point(40, 0));
    gestures.down(3, point(40, 0), on('a'), true);
    gestures.up(3, point(40, 0));
    expect(acts(events).filter((event) => !event.startsWith('begin'))).toEqual(['tap a 0,0', 'tap a 40,0']);
    clock.advance(1_000);
    gestures.down(4, point(0, 0), on('a'), true);
    clock.advance(LONG_PRESS_MS);
    gestures.up(4, point(0, 0));
    gestures.down(5, point(0, 0), on('a'), true);
    gestures.up(5, point(0, 0));
    expect(
      acts(events)
        .filter((event) => !event.startsWith('begin'))
        .slice(2),
    ).toEqual(['press a 0,0', 'tap a 0,0']);
  });
});

describe('two fingers', () => {
  it('pinch about their midpoint, which stays fixed when they move apart around it, and never tap', () => {
    const { gestures, clock, events, camera } = setUp();
    gestures.down(1, point(100, 200), on('a'), true);
    gestures.down(2, point(200, 200), on('b'), false);
    gestures.move(1, point(50, 200));
    gestures.move(2, point(250, 200));
    expect(camera().k).toBeCloseTo(2);
    // The drawing's point at the midpoint (150, 200) is drawn there still.
    expect(150 * camera().k + camera().x).toBeCloseTo(150);
    expect(200 * camera().k + camera().y).toBeCloseTo(200);
    clock.advance(LONG_PRESS_MS * 2);
    gestures.up(1, point(50, 200));
    gestures.up(2, point(250, 200));
    expect(acts(events)).toEqual(['begin']);
  });

  it('leave the other finger panning when one lifts, from where it is', () => {
    const { gestures, camera } = setUp();
    gestures.down(1, point(100, 100), on('a'), true);
    gestures.down(2, point(200, 100), on('b'), false);
    gestures.move(2, point(300, 100));
    const pinched = camera();
    gestures.up(1, point(100, 100));
    gestures.move(2, point(320, 130));
    expect(camera()).toEqual({ x: pinched.x + 20, y: pinched.y + 30, k: pinched.k });
  });

  it('ignore a third finger', () => {
    const { gestures, camera } = setUp();
    gestures.down(1, point(0, 0), on('a'), true);
    gestures.down(2, point(100, 0), on('b'), false);
    gestures.down(3, point(500, 500), on('c'), false);
    gestures.move(3, point(900, 900));
    expect(camera()).toEqual({ x: 0, y: 0, k: 1 });
  });
});

describe('the gesture’s bookkeeping', () => {
  it('ends a finger the browser took over without a tap, and says when fingers were on the canvas', () => {
    const { gestures, clock, events } = setUp();
    expect(gestures.touching()).toBe(false);
    gestures.down(1, point(0, 0), on('a'), true);
    expect(gestures.touching()).toBe(true);
    gestures.cancel(1);
    // Its mouse events are still the touch's for a moment.
    expect(gestures.touching()).toBe(true);
    clock.advance(Math.max(TOUCH_MOUSE_MS, LONG_PRESS_MS));
    expect(gestures.touching()).toBe(false);
    expect(events).toEqual(['begin']);
  });

  it('starts afresh on a new first finger when it never heard the last one lift', () => {
    const { gestures, events, camera } = setUp();
    gestures.down(1, point(0, 0), on('a'), true);
    // Finger 1's lift went elsewhere; a new touch begins.
    gestures.down(2, point(50, 50), on('b'), true);
    gestures.move(2, point(80, 50));
    expect(camera()).toEqual({ x: 30, y: 0, k: 1 });
    gestures.up(2, point(80, 50));
    expect(acts(events)).toEqual(['begin', 'begin']);
  });

  it('calls its timer off when disposed', () => {
    const { gestures, clock, events } = setUp();
    gestures.down(1, point(0, 0), on('a'), true);
    gestures.dispose();
    clock.advance(LONG_PRESS_MS);
    expect(events).toEqual(['begin']);
  });
});
