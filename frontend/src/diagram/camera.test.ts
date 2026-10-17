// @vitest-environment node
// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';

import {
  DOUBLE_TAP_ZOOM,
  doubleTapTransform,
  drawingPointAt,
  easeInOut,
  focusTransform,
  GLIDE_PADDING,
  glideAt,
  inRoom,
  keyboardTransform,
  panTransform,
  pinchTransform,
  REVEAL_MARGIN,
  revealTransform,
  SAME_CAMERA_PX,
  SAME_CAMERA_SCALE,
  sameCamera,
  showsWhole,
  ZOOM_STEP,
  zoomAbout,
  zoomStepTransform,
} from './camera';
import { SUBTITLE_MIN_SCALE } from './lod';
import { fitTransform, SCALE_EXTENT, type CameraTransform } from './viewport';

const CANVAS = { width: 1280, height: 624 };

describe('focusTransform', () => {
  it('centres the node at 100 % when the camera was further out', () => {
    const to = focusTransform({ x: 400, y: 300, width: 200, height: 44 }, CANVAS.width, CANVAS.height, {
      x: 0,
      y: 0,
      k: 0.3,
    });
    expect(to.k).toBe(1);
    expect(to.x + 500 * to.k).toBeCloseTo(640);
    expect(to.y + 322 * to.k).toBeCloseTo(312);
  });

  it('keeps a closer zoom, but fits a node the closer zoom would cut', () => {
    const close = { x: 0, y: 0, k: 2.5 };
    expect(focusTransform({ x: 0, y: 0, width: 200, height: 44 }, 1280, 624, close).k).toBe(2.5);
    const big = focusTransform({ x: 0, y: 0, width: 4000, height: 3000 }, 1280, 624, close);
    expect(big.k).toBeCloseTo((624 - 2 * GLIDE_PADDING) / 3000);
  });
});

describe('a part of the canvas (inRoom)', () => {
  const node = { x: 400, y: 300, width: 200, height: 44 };
  // The canvas below a sheet 400 px tall hanging from its top edge.
  const below = { x: 0, y: 400, width: CANVAS.width, height: CANVAS.height - 400 };

  it('is the camera itself when the room is the whole canvas', () => {
    const current = { x: 30, y: -20, k: 0.4 };
    const whole = { x: 0, y: 0, ...CANVAS };
    expect(
      inRoom(whole, current, (width, height, camera) => focusTransform(node, width, height, camera)),
    ).toEqual(focusTransform(node, CANVAS.width, CANVAS.height, current));
  });

  it('centres a node in the room, not in the canvas', () => {
    const to = inRoom(below, { x: 0, y: 0, k: 0.3 }, (width, height, camera) =>
      focusTransform(node, width, height, camera),
    );
    expect(to.k).toBe(1);
    expect(to.x + 500 * to.k).toBeCloseTo(640);
    expect(to.y + 322 * to.k).toBeCloseTo(400 + 224 / 2);
  });

  it('pans a node into the room, inside its margins, and leaves one there in place', () => {
    // At 1, under the sheet: 300 to 344 on screen.
    const under = { x: 0, y: 0, k: 1 };
    const to = inRoom(below, under, (width, height, camera) =>
      revealTransform(node, node, width, height, camera),
    );
    if (to === null) throw new Error('no pan');
    expect(to.k).toBe(1);
    expect(to.x).toBe(0);
    expect(node.y * to.k + to.y).toBeCloseTo(400 + REVEAL_MARGIN);
    // In the room already: nothing to move.
    expect(
      inRoom(below, to, (width, height, camera) => revealTransform(node, node, width, height, camera)),
    ).toBeNull();
  });
});

describe('the fit the camera rests on (sameCamera, showsWhole)', () => {
  const fit = { x: 40, y: 120, k: 0.4 };

  it('takes a camera off by no more than rounding for the same one', () => {
    expect(sameCamera(fit, fit)).toBe(true);
    expect(
      sameCamera({ ...fit, x: fit.x + SAME_CAMERA_PX * 0.9, y: fit.y - SAME_CAMERA_PX * 0.9 }, fit),
    ).toBe(true);
    expect(sameCamera({ ...fit, k: fit.k * (1 + SAME_CAMERA_SCALE / 2) }, fit)).toBe(true);
  });

  it('and one a pan, a pinch or a zoom step moved for another', () => {
    expect(sameCamera({ ...fit, x: fit.x + 1 }, fit)).toBe(false);
    expect(sameCamera({ ...fit, y: fit.y - 1 }, fit)).toBe(false);
    expect(sameCamera({ ...fit, k: fit.k * 1.01 }, fit)).toBe(false);
    expect(sameCamera({ ...fit, k: fit.k * ZOOM_STEP }, fit)).toBe(false);
  });

  it('sees a drawing fitted to a room whole in it, and one fitted to the whole canvas not in the part below a sheet', () => {
    const frame = { x: -24, y: -80, width: 2400, height: 900 };
    const below = { x: 0, y: 400, width: CANVAS.width, height: CANVAS.height - 400 };
    const whole = { x: 0, y: 0, ...CANVAS };
    const fitted = inRoom(below, fit, (width, height) => fitTransform(frame, width, height));
    expect(showsWhole(frame, below, fitted)).toBe(true);
    const filling = fitTransform(frame, CANVAS.width, CANVAS.height);
    expect(showsWhole(frame, whole, filling)).toBe(true);
    expect(showsWhole(frame, below, filling)).toBe(false);
  });

  it('and one too large to fit at the smallest scale not whole anywhere on the canvas', () => {
    const huge = { x: 0, y: 0, width: 100_000, height: 40_000 };
    const fitted = fitTransform(huge, CANVAS.width, CANVAS.height);
    expect(fitted.k).toBe(SCALE_EXTENT[0]);
    expect(showsWhole(huge, { x: 0, y: 0, ...CANVAS }, fitted)).toBe(false);
  });
});

describe('the glide', () => {
  const from = { x: 10, y: 20, k: 0.25 };
  const to = { x: -300, y: -100, k: 1 };

  it('starts at the camera it leaves and ends exactly at the one it goes to', () => {
    const start = glideAt(from, to, 0, CANVAS.width, CANVAS.height);
    expect(start.k).toBeCloseTo(from.k);
    expect(start.x).toBeCloseTo(from.x);
    expect(start.y).toBeCloseTo(from.y);
    expect(glideAt(from, to, 1, CANVAS.width, CANVAS.height)).toBe(to);
  });

  it('changes the scale geometrically and moves the centre in a straight line', () => {
    const middle = glideAt(from, to, 0.5, CANVAS.width, CANVAS.height);
    expect(middle.k).toBeCloseTo(0.5);
    const centre = (camera: { x: number; y: number; k: number }) => ({
      x: (CANVAS.width / 2 - camera.x) / camera.k,
      y: (CANVAS.height / 2 - camera.y) / camera.k,
    });
    const a = centre(from);
    const b = centre(to);
    const m = centre(middle);
    expect(m.x).toBeCloseTo((a.x + b.x) / 2);
    expect(m.y).toBeCloseTo((a.y + b.y) / 2);
  });

  it('keeps the scale exactly while it only pans (the reveal pan, a keyboard move)', () => {
    const k = 0.21692789968652038;
    for (const t of [0.1, 0.37, 0.5, 0.9]) {
      expect(glideAt({ x: 0, y: 0, k }, { x: -120, y: 40, k }, t, CANVAS.width, CANVAS.height).k).toBe(k);
    }
  });

  it('eases in and out', () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(0.5)).toBe(0.5);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.1)).toBeLessThan(0.1);
    expect(easeInOut(0.9)).toBeGreaterThan(0.9);
    expect(easeInOut(-1)).toBe(0);
    expect(easeInOut(2)).toBe(1);
  });
});

describe('the keyboard camera', () => {
  const card = { x: 4000, y: 2000, width: 180, height: 44 };
  const onScreen = (box: typeof card, camera: { x: number; y: number; k: number }) => ({
    left: box.x * camera.k + camera.x,
    top: box.y * camera.k + camera.y,
    right: (box.x + box.width) * camera.k + camera.x,
    bottom: (box.y + box.height) * camera.k + camera.y,
  });

  it('zooms in to the scale subtitles are drawn at when further out, about the item, then shows it', () => {
    // Demo L's overview fitted: 0.07; the card is in view, a few pixels wide.
    const far = { x: 40, y: 30, k: 0.07 };
    const before = onScreen(card, far);
    const to = keyboardTransform(card, 1280, 624, far);
    if (to === null) throw new Error('no move');
    expect(to.k).toBe(SUBTITLE_MIN_SCALE);
    const after = onScreen(card, to);
    // Its centre stays where it was (it was well inside the canvas), and it is wholly in view.
    expect((after.left + after.right) / 2).toBeCloseTo((before.left + before.right) / 2);
    expect((after.top + after.bottom) / 2).toBeCloseTo((before.top + before.bottom) / 2);
    expect(after.left).toBeGreaterThanOrEqual(0);
    expect(after.right).toBeLessThanOrEqual(1280);
  });

  it('only pans at or past that scale, and not at all when the item is in view', () => {
    const close = { x: -3600, y: -1800, k: 1 };
    expect(keyboardTransform(card, 1280, 624, close)).toBeNull();
    const away = { x: 0, y: 0, k: 0.6 };
    const to = keyboardTransform(card, 1280, 624, away);
    expect(to?.k).toBe(0.6);
    if (to === null) throw new Error('no pan');
    const after = onScreen(card, to);
    expect(after.right).toBeLessThanOrEqual(1280 - REVEAL_MARGIN + 0.001);
    expect(after.bottom).toBeLessThanOrEqual(624 - REVEAL_MARGIN + 0.001);
  });

  it('zooms one step about a point, which stays put, within the scale extent', () => {
    const camera = { x: 100, y: 50, k: 0.4 };
    const to = zoomAbout(camera, 0.6, 300, 200);
    expect(to.k).toBe(0.6);
    // The drawing point under (300, 200) is still there.
    expect((300 - to.x) / to.k).toBeCloseTo((300 - camera.x) / camera.k);
    expect((200 - to.y) / to.k).toBeCloseTo((200 - camera.y) / camera.k);
    // The scale extent, [0.05, 200], as literals: the camera stops at 5 % and at 20 000 %.
    expect(zoomAbout(camera, 1000, 0, 0).k).toBe(200);
    expect(zoomAbout(camera, 0.001, 0, 0).k).toBe(0.05);
    expect(zoomStepTransform(camera, 1, null, 1280, 624)?.k).toBeCloseTo(0.4 * ZOOM_STEP);
    expect(zoomStepTransform(camera, -1, null, 1280, 624)?.k).toBeCloseTo(0.4 / ZOOM_STEP);
    expect(zoomStepTransform({ x: 0, y: 0, k: 0.05 }, -1, null, 1280, 624)).toBeNull();
  });

  it('keeps the focused item in view when a zoom key grows it past the canvas edge', () => {
    // The card near the right edge at 1: two steps in would push it off.
    const camera = { x: 1280 - 4000 - 200, y: 300 - 2000, k: 1 };
    const to = zoomStepTransform(camera, 1, card, 1280, 624);
    if (to === null) throw new Error('no zoom');
    expect(to.k).toBeCloseTo(ZOOM_STEP);
    expect(onScreen(card, to).right).toBeLessThanOrEqual(1280);
  });
});

/** Where the drawing's point (`wx`, `wy`) lies on screen under `camera`. */
const onScreen = (camera: CameraTransform, wx: number, wy: number): { x: number; y: number } => ({
  x: wx * camera.k + camera.x,
  y: wy * camera.k + camera.y,
});

describe('the fingers’ camera', () => {
  const start = { x: -120, y: 40, k: 0.8 };

  it('reads the drawing’s point under a canvas point', () => {
    const held = drawingPointAt(start, { x: 300, y: 200 });
    expect(onScreen(start, held.x, held.y)).toEqual({ x: 300, y: 200 });
  });

  it('pans with one finger: what it touched stays under it, at the camera’s scale', () => {
    const held = drawingPointAt(start, { x: 300, y: 200 });
    const to = panTransform(start, held, { x: 260, y: 230 });
    expect(to.k).toBe(0.8);
    expect(to.x).toBeCloseTo(-160);
    expect(to.y).toBeCloseTo(70);
    // A camera fitted anew mid-gesture: the point still comes under the finger, at that camera's scale.
    const refitted = panTransform({ x: 5, y: 5, k: 0.3 }, held, { x: 260, y: 230 });
    expect(refitted.k).toBe(0.3);
    expect(onScreen(refitted, held.x, held.y).x).toBeCloseTo(260);
    expect(onScreen(refitted, held.x, held.y).y).toBeCloseTo(230);
  });

  it('pinches about the fingers’ midpoint, which stays where it was when they move apart around it', () => {
    const held = [
      drawingPointAt(start, { x: 400, y: 300 }),
      drawingPointAt(start, { x: 500, y: 300 }),
    ] as const;
    const pinched = pinchTransform(start, held, [
      { x: 350, y: 300 },
      { x: 550, y: 300 },
    ]);
    expect(pinched.k).toBeCloseTo(1.6);
    // The drawing's point at the midpoint (450, 300) is still drawn there.
    const middle = drawingPointAt(start, { x: 450, y: 300 });
    expect(onScreen(pinched, middle.x, middle.y).x).toBeCloseTo(450);
    expect(onScreen(pinched, middle.x, middle.y).y).toBeCloseTo(300);
  });

  it('pans with the midpoint as it pinches, and keeps the scale when the fingers only move together', () => {
    const held = [
      drawingPointAt(start, { x: 100, y: 100 }),
      drawingPointAt(start, { x: 200, y: 200 }),
    ] as const;
    const moved = pinchTransform(start, held, [
      { x: 130, y: 90 },
      { x: 230, y: 190 },
    ]);
    expect(moved.k).toBeCloseTo(start.k);
    expect(moved.x).toBeCloseTo(start.x + 30);
    expect(moved.y).toBeCloseTo(start.y - 10);
    // Two fingers that touched one point give no distance to scale by.
    const one = drawingPointAt(start, { x: 10, y: 10 });
    const together = pinchTransform(
      start,
      [one, one],
      [
        { x: 20, y: 10 },
        { x: 20, y: 10 },
      ],
    );
    expect(together.k).toBe(start.k);
    expect(onScreen(together, one.x, one.y).x).toBeCloseTo(20);
  });

  it('keeps a pinch within the scale extent, its midpoint still fixed', () => {
    const near = { x: 0, y: 0, k: 0.1 };
    const out = pinchTransform(
      near,
      [drawingPointAt(near, { x: 0, y: 0 }), drawingPointAt(near, { x: 10, y: 0 })],
      [
        { x: 4, y: 0 },
        { x: 6, y: 0 },
      ],
    );
    expect(out.k).toBe(SCALE_EXTENT[0]);
    expect(onScreen(out, 50, 0).x).toBeCloseTo(5);
    const deep = { x: 0, y: 0, k: 150 };
    const closer = pinchTransform(
      deep,
      [drawingPointAt(deep, { x: 0, y: 0 }), drawingPointAt(deep, { x: 10, y: 0 })],
      [
        { x: -45, y: 0 },
        { x: 55, y: 0 },
      ],
    );
    expect(closer.k).toBe(SCALE_EXTENT[1]);
  });

  it('zooms in by DOUBLE_TAP_ZOOM about the point of a double tap, and not past the scale extent', () => {
    const to = doubleTapTransform(start, { x: 300, y: 200 });
    if (to === null) throw new Error('no zoom');
    expect(to.k).toBeCloseTo(start.k * DOUBLE_TAP_ZOOM);
    const tapped = drawingPointAt(start, { x: 300, y: 200 });
    expect(onScreen(to, tapped.x, tapped.y).x).toBeCloseTo(300);
    expect(onScreen(to, tapped.x, tapped.y).y).toBeCloseTo(200);
    expect(doubleTapTransform({ x: 0, y: 0, k: 150 }, { x: 0, y: 0 })?.k).toBe(SCALE_EXTENT[1]);
    expect(doubleTapTransform({ x: 0, y: 0, k: SCALE_EXTENT[1] }, { x: 0, y: 0 })).toBeNull();
  });
});
