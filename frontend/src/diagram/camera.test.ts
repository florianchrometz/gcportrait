// @vitest-environment node
// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';

import {
  easeInOut,
  focusTransform,
  GLIDE_PADDING,
  glideAt,
  keyboardTransform,
  REVEAL_MARGIN,
  ZOOM_STEP,
  zoomAbout,
  zoomStepTransform,
} from './camera';
import { SUBTITLE_MIN_SCALE } from './lod';

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
    // The scale extent, [0.05, 200] (ADR 0035 §5), as literals: the camera stops at 5 % and at 20 000 %.
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
