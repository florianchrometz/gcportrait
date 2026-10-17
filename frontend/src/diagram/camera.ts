// SPDX-License-Identifier: MIT
/**
 * The camera glide behind `jumpTo(id)` (the app store's action; the canvas carries it out): where the camera
 * ends, and the transforms in between. Pure.
 *
 * The glide ends with the node centred, at 100 % or closer: the current scale when the person had already
 * zoomed in further, unless the node would then not fit the canvas (with `GLIDE_PADDING` around it), in which
 * case the scale that fits it. In between, the centre moves and the scale changes geometrically, both eased in
 * and out, so a long jump does not lurch.
 *
 * A jump, the keyboard's pan and a zoom key's step keep the node in the part of the canvas a panel lying over it
 * leaves in view (DiagramCanvas, `clearRoom`), and a fit (a new view's, `0`'s, a panel's refit) shows the drawing in
 * that part (viewport.ts, `fitTransform`): `inRoom` works a camera out for that part as if it were the whole canvas.
 * Whether the camera still rests on the last fit, which a panel opening or closing then makes again, is `sameCamera`'s
 * to say, and whether the drawing lies whole in that part `showsWhole`'s.
 *
 * The keyboard's camera is here too: a move to an item pans just enough to show it, and first zooms in to
 * the scale at which labels are drawn when the camera is further out (`keyboardTransform`); the zoom keys scale by
 * `ZOOM_STEP` about the focused item (`zoomStepTransform`).
 *
 * And the fingers' (touch.ts): one finger keeps what it touched under it (`panTransform`), two keep what they touched
 * under them as near as a scale and a pan can, so they zoom about their midpoint and pan with it (`pinchTransform`),
 * and a double tap zooms in by `DOUBLE_TAP_ZOOM` about the point tapped (`doubleTapTransform`), all within the scale
 * extent a mouse wheel has.
 *
 * And a mouse's and a pen's (DiagramCanvas): a press let go within `CLICK_DISTANCE` of where it was pressed is a click
 * and moves nothing, one moved further is a drag (`isDrag`), which keeps what was pressed under the pointer as a
 * finger's pan does (`panTransform`); the wheel zooms about the pointer by a power of two of its delta (`wheelZoom`,
 * `wheelTransform`).
 */
import type { Rect } from '@gcportrait/layout';

import { SUBTITLE_MIN_SCALE } from './lod';
import { CLICK_DISTANCE, SCALE_EXTENT, type CameraTransform } from './viewport';

/**
 * How long a centring glide takes (ms): 200, the search hit's "200 ms glide to centre" (skill gcp-diagram-style
 * §6). With reduced motion the camera moves at once.
 */
export const GLIDE_MS = 200;
/** Room kept around the node the camera glides to (CSS px). */
export const GLIDE_PADDING = 48;

/** The camera that shows `rect` centred in a `width` × `height` canvas, from the camera `current`. */
export function focusTransform(
  rect: Rect,
  width: number,
  height: number,
  current: CameraTransform,
  padding = GLIDE_PADDING,
): CameraTransform {
  const room = (size: number): number => Math.max(1, size - 2 * padding);
  const fits = Math.min(room(width) / Math.max(1, rect.width), room(height) / Math.max(1, rect.height));
  const k = Math.min(SCALE_EXTENT[1], Math.max(SCALE_EXTENT[0], Math.min(Math.max(current.k, 1), fits)));
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  return { k, x: width / 2 - cx * k, y: height / 2 - cy * k };
}

/**
 * A part of the canvas, in CSS px from its top-left corner: the room a jump, a keyboard move or a zoom key's step keeps
 * the node in and a fit shows the drawing in, the canvas less a panel lying over it (DiagramCanvas, `clearRoom`).
 */
export interface CanvasRoom {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A camera worked out for a `width` × `height` canvas from the camera `current` on it. */
type Placement<T> = (width: number, height: number, current: CameraTransform) => T;

/**
 * A camera worked out for a part of the canvas, `room`, as if the room were the whole canvas: `place` gets the room's
 * size and the camera `current` as the room's top-left corner sees it, and the camera it answers is moved back onto
 * the canvas (null, nothing to move, stays null). So `focusTransform` centres a node in the room, `revealTransform`,
 * `keyboardTransform` and `zoomStepTransform` keep it inside the room's margins, a zoom step with nothing focused
 * zooms about the room's centre, and `fitTransform` (viewport.ts, for a fit) shows the whole drawing inside the room's
 * margins.
 */
export function inRoom(
  room: CanvasRoom,
  current: CameraTransform,
  place: Placement<CameraTransform>,
): CameraTransform;
export function inRoom(
  room: CanvasRoom,
  current: CameraTransform,
  place: Placement<CameraTransform | null>,
): CameraTransform | null;
export function inRoom(
  room: CanvasRoom,
  current: CameraTransform,
  place: Placement<CameraTransform | null>,
): CameraTransform | null {
  const to = place(room.width, room.height, { k: current.k, x: current.x - room.x, y: current.y - room.y });
  return to === null ? null : { k: to.k, x: to.x + room.x, y: to.y + room.y };
}

/** How far apart (CSS px) two cameras may place the drawing and still be one: rounding, never a person's pan. */
export const SAME_CAMERA_PX = 0.5;
/** How far apart two cameras' scales may be (a fraction of the scale) and still be one. */
export const SAME_CAMERA_SCALE = 1e-3;

/**
 * Whether `camera` is `other`, give or take rounding (`SAME_CAMERA_PX` on the canvas, `SAME_CAMERA_SCALE` of the
 * scale): how the canvas tells that the camera still rests on the last fit (DiagramCanvas), which no pan, pinch, zoom
 * step or jump leaves it on.
 */
export function sameCamera(camera: CameraTransform, other: CameraTransform): boolean {
  return (
    Math.abs(camera.k - other.k) <= SAME_CAMERA_SCALE * other.k &&
    Math.abs(camera.x - other.x) <= SAME_CAMERA_PX &&
    Math.abs(camera.y - other.y) <= SAME_CAMERA_PX
  );
}

/**
 * Whether `camera` shows the whole of `frame` (drawing units: the drawing's frame) inside `room`, give or take
 * `SAME_CAMERA_PX`: a fit does, unless the drawing is too large to fit at the smallest scale.
 */
export function showsWhole(frame: Rect, room: CanvasRoom, camera: CameraTransform): boolean {
  const left = frame.x * camera.k + camera.x;
  const top = frame.y * camera.k + camera.y;
  return (
    left >= room.x - SAME_CAMERA_PX &&
    top >= room.y - SAME_CAMERA_PX &&
    left + frame.width * camera.k <= room.x + room.width + SAME_CAMERA_PX &&
    top + frame.height * camera.k <= room.y + room.height + SAME_CAMERA_PX
  );
}

/** Ease in and out (cubic), for t in [0, 1]. */
export function easeInOut(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return clamped < 0.5 ? 4 * clamped ** 3 : 1 - (-2 * clamped + 2) ** 3 / 2;
}

/**
 * The camera at progress `t` (0–1, already eased) between `from` and `to`, in a `width` × `height` canvas: the
 * point at the canvas centre moves in a straight line and the scale changes geometrically.
 */
export function glideAt(
  from: CameraTransform,
  to: CameraTransform,
  t: number,
  width: number,
  height: number,
): CameraTransform {
  const centre = (camera: CameraTransform): { x: number; y: number } => ({
    x: (width / 2 - camera.x) / camera.k,
    y: (height / 2 - camera.y) / camera.k,
  });
  const a = centre(from);
  const b = centre(to);
  // A pan (the same scale at both ends) keeps the scale exactly: exp(log(k)) can be a rounding step off it.
  const k = from.k === to.k ? from.k : Math.exp(Math.log(from.k) + (Math.log(to.k) - Math.log(from.k)) * t);
  const x = a.x + (b.x - a.x) * t;
  const y = a.y + (b.y - a.y) * t;
  return t >= 1 ? to : { k, x: width / 2 - x * k, y: height / 2 - y * k };
}

/**
 * What a jump asks of the camera: `centre` glides to the node centred (search, `jumpTo`'s default); `reveal`
 * (the details drawer) only pans, as little as it can, so that the node and what its trace reaches stay
 * in view beside the drawer.
 */
export type JumpMode = 'centre' | 'reveal';

/** How long the reveal pan takes (ms). */
export const REVEAL_MS = 200;
/** Room kept between a revealed node (and its trace) and the canvas's edges (CSS px). */
export const REVEAL_MARGIN = 24;

/**
 * The shift along one axis (screen px) that keeps the interval [n0, n1] (the node) inside [lo, hi] and, as far
 * as it can, [e0, e1] (the node with what its trace reaches): the whole extent when it fits, else a window
 * filled by the extent; always the smallest such shift. A node larger than the room is centred.
 */
function revealShift(n0: number, n1: number, e0: number, e1: number, lo: number, hi: number): number {
  const closest = (from: number, to: number): number => Math.min(to, Math.max(from, 0));
  const nodeFrom = lo - n0;
  const nodeTo = hi - n1;
  if (nodeFrom > nodeTo) return (lo + hi) / 2 - (n0 + n1) / 2;
  const extentFrom = lo - e0;
  const extentTo = hi - e1;
  // The extent fits: the shifts that keep it inside also keep the node inside (the extent holds the node).
  if (extentFrom <= extentTo) return closest(extentFrom, extentTo);
  // The extent is larger than the room: fill the room with it, where that keeps the node in view.
  const from = Math.max(nodeFrom, extentTo);
  const to = Math.min(nodeTo, extentFrom);
  return from <= to ? closest(from, to) : closest(nodeFrom, nodeTo);
}

/**
 * The camera that shows `node` inside a `width` × `height` canvas with `margin` around it, and as much of
 * `extent` (the node and the nodes its trace reaches, in drawing units) as fits, moving the `current` camera as
 * little as possible and never changing its scale; null when nothing needs to move (both shifts under half a
 * pixel). On a desktop the drawer sits beside the canvas, so the canvas's own size is what stays in view; where a panel
 * lies over the canvas, `inRoom` gives it the part the panel leaves.
 */
export function revealTransform(
  node: Rect,
  extent: Rect,
  width: number,
  height: number,
  current: CameraTransform,
  margin = REVEAL_MARGIN,
): CameraTransform | null {
  const { k } = current;
  const axis = (
    start: number,
    size: number,
    extentStart: number,
    extentSize: number,
    room: number,
    at: number,
  ) => {
    const pad = Math.min(margin, room / 4);
    return revealShift(
      start * k + at,
      (start + size) * k + at,
      extentStart * k + at,
      (extentStart + extentSize) * k + at,
      pad,
      room - pad,
    );
  };
  const dx = axis(node.x, node.width, extent.x, extent.width, width, current.x);
  const dy = axis(node.y, node.height, extent.y, extent.height, height, current.y);
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return null;
  return { k, x: current.x + dx, y: current.y + dy };
}

/**
 * The smallest scale a keyboard move leaves the camera at: the scale from which subtitles
 * are drawn (lod.ts, 0.55), so the item reached by the keyboard reads with its title and its type or count line.
 * At the label scale (0.35) a card's text is about 4.5 px, drawn but not readable; further out a card is a few
 * pixels with no label, and the keyboard could reach it without anyone seeing which.
 */
export const KEYBOARD_MIN_SCALE = SUBTITLE_MIN_SCALE;
/** One press of a zoom key (`+` in, `-` out) scales the camera by this factor. */
export const ZOOM_STEP = 1.5;

function clampScale(k: number): number {
  return Math.min(SCALE_EXTENT[1], Math.max(SCALE_EXTENT[0], k));
}

/**
 * The camera `current` scaled to `k` (within the scale extent) about the screen point (`px`, `py`): what is drawn
 * at that point stays there.
 */
export function zoomAbout(current: CameraTransform, k: number, px: number, py: number): CameraTransform {
  const scale = clampScale(k);
  const wx = (px - current.x) / current.k;
  const wy = (py - current.y) / current.k;
  return { k: scale, x: px - wx * scale, y: py - wy * scale };
}

/** Where a box's centre (drawing units) is on screen under a camera. */
function screenCentre(box: Rect, camera: CameraTransform): { x: number; y: number } {
  return {
    x: (box.x + box.width / 2) * camera.k + camera.x,
    y: (box.y + box.height / 2) * camera.k + camera.y,
  };
}

/**
 * The camera after the keyboard moved to an item whose `box` (drawing units) must be seen, in a `width` ×
 * `height` canvas: further out than `minScale`, it first zooms in to `minScale` about the item (the item stays
 * where it was on screen and its surroundings grow around it); then it pans as little as it can to show the item
 * (`revealTransform`). Null when nothing needs to move.
 */
export function keyboardTransform(
  box: Rect,
  width: number,
  height: number,
  current: CameraTransform,
  minScale = KEYBOARD_MIN_SCALE,
): CameraTransform | null {
  if (current.k >= minScale) return revealTransform(box, box, width, height, current);
  const at = screenCentre(box, current);
  const zoomed = zoomAbout(current, minScale, at.x, at.y);
  return revealTransform(box, box, width, height, zoomed) ?? zoomed;
}

/**
 * One press of a zoom key: the camera scaled by `ZOOM_STEP` (`direction` 1 in, -1 out) about the focused
 * item's `box`, which then stays in view (`revealTransform`), or about the canvas's centre when nothing on it has
 * focus. Null when the scale extent leaves nothing to do.
 */
export function zoomStepTransform(
  current: CameraTransform,
  direction: 1 | -1,
  box: Rect | null,
  width: number,
  height: number,
): CameraTransform | null {
  const k = clampScale(current.k * ZOOM_STEP ** direction);
  if (k === current.k) return null;
  const at = box === null ? { x: width / 2, y: height / 2 } : screenCentre(box, current);
  const zoomed = zoomAbout(current, k, at.x, at.y);
  return box === null ? zoomed : (revealTransform(box, box, width, height, zoomed) ?? zoomed);
}

/** A point on the canvas, in CSS px from its top-left corner (or, where a name says so, in drawing units). */
export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

/** The drawing's point (drawing units) that `camera` shows at the canvas point `at`. */
export function drawingPointAt(camera: CameraTransform, at: ScreenPoint): ScreenPoint {
  return { x: (at.x - camera.x) / camera.k, y: (at.y - camera.y) / camera.k };
}

/**
 * One finger's pan: the camera at the scale of `current` that shows the drawing's point `held` (drawing units, what
 * the finger touched) under the finger at `at`, so what lay under it stays under it.
 */
export function panTransform(current: CameraTransform, held: ScreenPoint, at: ScreenPoint): CameraTransform {
  return { k: current.k, x: at.x - held.x * current.k, y: at.y - held.y * current.k };
}

function midpoint(a: ScreenPoint, b: ScreenPoint): ScreenPoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Two fingers' pinch: the camera that keeps the drawing's points `held` (drawing units, what the two fingers touched)
 * under the fingers at `at` as near as a scale and a pan can. The scale is the fingers' distance over the points'
 * (within the scale extent; `current`'s when the points are one), and the points' midpoint is drawn at the fingers'
 * midpoint, which may itself move, so a pinch zooms about its midpoint and pans with it.
 */
export function pinchTransform(
  current: CameraTransform,
  held: readonly [ScreenPoint, ScreenPoint],
  at: readonly [ScreenPoint, ScreenPoint],
): CameraTransform {
  const apart = Math.hypot(held[1].x - held[0].x, held[1].y - held[0].y);
  const fingers = Math.hypot(at[1].x - at[0].x, at[1].y - at[0].y);
  const k = apart > 0 ? clampScale(fingers / apart) : current.k;
  const drawn = midpoint(held[0], held[1]);
  const now = midpoint(at[0], at[1]);
  return { k, x: now.x - drawn.x * k, y: now.y - drawn.y * k };
}

/** A double tap scales the camera by this factor (a mouse's double-click is drill-in's, and zooms nothing). */
export const DOUBLE_TAP_ZOOM = 2;

/**
 * A double tap at `at`: the camera `current` scaled by `DOUBLE_TAP_ZOOM` about that point, within the scale
 * extent; null when the extent leaves nothing to do.
 */
export function doubleTapTransform(current: CameraTransform, at: ScreenPoint): CameraTransform | null {
  const k = clampScale(current.k * DOUBLE_TAP_ZOOM);
  if (k === current.k) return null;
  return zoomAbout(current, k, at.x, at.y);
}

/**
 * Whether a mouse's or a pen's press, made at `from`, is a drag once the pointer is at `at`: further than
 * `CLICK_DISTANCE` away. As far as that, a hand's wobble, its release is still a click.
 */
export function isDrag(from: ScreenPoint, at: ScreenPoint): boolean {
  return (at.x - from.x) ** 2 + (at.y - from.y) ** 2 > CLICK_DISTANCE ** 2;
}

/**
 * How far a wheel's delta zooms, in powers of two per unit of its `deltaMode`, here a pixel (0): a notch of a mouse
 * wheel, 100 px in most browsers, scales the camera by 2^0.2, about 1.15.
 */
export const WHEEL_ZOOM_PER_PIXEL = 0.002;
/** The same per line (`deltaMode` 1): three lines, a notch where a browser counts in lines, scale by 2^0.15. */
export const WHEEL_ZOOM_PER_LINE = 0.05;
/** The same per page (`deltaMode` 2, or any other): a page doubles or halves the scale. */
export const WHEEL_ZOOM_PER_PAGE = 1;
/**
 * A wheel's turn with Ctrl zooms this many times as far: a browser sends a touchpad's pinch as one, in deltas of a few
 * pixels, so a pinch zooms about as fast as the wheel does.
 */
export const WHEEL_CTRL_FACTOR = 10;

/** What the camera reads of a wheel's turn (a `WheelEvent`'s). */
export interface WheelTurn {
  readonly deltaY: number;
  readonly deltaMode: number;
  readonly ctrlKey: boolean;
}

/** The power of two a wheel's turn scales the camera by: turned up (a negative `deltaY`) it zooms in. */
export function wheelZoom(turn: WheelTurn): number {
  const unit =
    turn.deltaMode === 0
      ? WHEEL_ZOOM_PER_PIXEL
      : turn.deltaMode === 1
        ? WHEEL_ZOOM_PER_LINE
        : WHEEL_ZOOM_PER_PAGE;
  return -turn.deltaY * unit * (turn.ctrlKey ? WHEEL_CTRL_FACTOR : 1);
}

/**
 * A wheel's turn with the pointer at `at`: the camera `current` scaled by `wheelZoom`'s power of two about that point,
 * within the scale extent; null when that leaves the scale as it is (at the extent, or a turn with no `deltaY`).
 */
export function wheelTransform(
  current: CameraTransform,
  turn: WheelTurn,
  at: ScreenPoint,
): CameraTransform | null {
  const k = clampScale(current.k * 2 ** wheelZoom(turn));
  if (k === current.k) return null;
  return zoomAbout(current, k, at.x, at.y);
}
