// SPDX-License-Identifier: MIT
/**
 * The interactive diagram (frontend/AGENTS.md, Code; style skill §13): the drawing inside an `<svg>` that the
 * canvas pans and zooms itself (`scaleExtent [0.05, 200]`; a mouse's or a pen's drag and the wheel, read from their
 * pointer and wheel events; a press that moved at most `CLICK_DISTANCE`, 4 px, is a click and moves nothing;
 * double-click is reserved for drill-in and does not zoom), level of detail by the effective scale, and hover,
 * selection (with its trace) and keyboard focus painted by the highlight painter. The drawing renders once per model,
 * theme and settings; zooming, hovering and selecting only set attributes and classes on it, and never ask for a new
 * layout. `data-diagram-ready="true"` on the `<svg>` says the drawing is fitted and interactive: it is set once the
 * painter and its listeners are attached, and stays set while the next view is prepared, as the drawing before it stays
 * on the canvas until then. `data-drawing`, set in the same step, numbers the drawing: every drawing the canvas puts up
 * (a new view, or the same view in another theme or with other settings) takes the page's next number, so a new number
 * tells the next drawing from the last.
 *
 * A node's menu ("Open in Cloud Console", "Copy resource name", "Drill in") opens on a right-click, on
 * Shift+F10 or the context-menu key on a focused node, and on Enter on the selected node; it selects the node
 * too. The selected node's "Open in Cloud Console ↗" action sits inside the node and is a tab stop
 * after it; Escape there clears the selection and puts focus back on the node. Nothing opens a console page by
 * itself: only activating the card's action or the menu's link does, in a new tab.
 *
 * The app store reaches the camera through two props only: `jump`, a pending `jumpTo(id)`, which the
 * canvas makes as a glide (camera.ts; at once with reduced motion) as soon as the node is drawn and then reports
 * with `onJumpDone` (a centring glide, or for the details drawer, a short pan that keeps the node and its
 * trace in view); and `onHover`, which tells the store which node is under the pointer. A jump, the pan that
 * follows keyboard focus and a zoom key's step keep the node in the part of the canvas the panels lying over it leave
 * in view (`clearRoom`): the drawer of a phone or a tablet with the disclosure bar's row in the part it leaves, or the
 * top bar's View or More sheet with the disclosure bar on a tablet.
 *
 * A fit shows the whole drawing in that part too (`fitRoom`), so none of it lies under a panel: the fit a new view
 * opens with (whatever draws a new frame: a drill-in, a lens or a filter picked in the View sheet, a day whose drawing
 * is another size, a resize that picks another level of detail) and `0`'s. Where the panels leave no room to fit into
 * (the phone's drawer at full height, which hides the drawing) it takes the whole canvas, ready for when the drawer
 * comes down. A panel opening or closing over the canvas (`panels`) fits the drawing again to the part the panels
 * leave now, and so does the drawer's reveal after the drawer changed its height or width (its own state, which
 * `panels` does not carry), so long as the camera still rests on the last fit: the person has not panned, pinched,
 * zoomed or jumped since (`sameCamera`; a glide on its way to the fit counts as resting on it). So a lens picked in
 * the View sheet shows its whole drawing below the sheet, and the drawing fills the canvas again once the sheet
 * closes, while a camera the person moved stays where they put it. The refit is the zoom keys' short glide (at once
 * with reduced motion), never a new layout; while the camera rests on a fit to the part the drawer leaves, the
 * drawer's reveal has nothing more to do, as the whole drawing is in view there. The canvas learns of a panel through
 * `panels`, a value the diagram page derives from the store (the open sheet, the drawer's open state):
 * the prop changes in the same commit as the panel's `hidden` (and as
 * the disclosure bar's marker, which the bar takes from the same state), so the refit (a layout effect) measures the
 * panel as it now is, before the browser paints and before the drawer's reveal asks for its pan, where a mutation or
 * resize observer would answer after both. A ResizeObserver on the marked overlays catches later size changes, such
 * as a disclosure notice appearing or being dismissed, and refits under the same resting-camera guard. The canvas
 * still knows nothing of the store. On a desktop nothing lies
 * over the canvas: every fit fills it, and a panel changes nothing.
 *
 * Progressive disclosure, with `onFlip`: a click on a chip, or Enter or Space on a focused one, expands
 * it, and an open zone's collapse button (over its header icon; disclosure/CollapseButton.tsx) collapses it,
 * both by the zone's flip. The drawing with the flip keeps the camera where it was (no fit) and glides 200 ms to
 * frame the zone (disclosure/flipCamera.ts); after a flip from the keyboard, focus follows the zone (its collapse
 * button, or its chip). Without `onFlip` a chip is selected like any node.
 *
 * Fingers (touch.ts; frontend/AGENTS.md, Phones, tablets and desktops, the touch model) come as pointer events of `pointerType` `touch`, read
 * here into gestures: one finger pans, two pinch about their midpoint and pan, a tap does what a click does (selects,
 * clears, or flips a chip), a double tap zooms in about its point (on a chip or a collapse button the first tap's flip
 * stands instead, as a double-click's second click does not flip it back), and a long press (500 ms, without moving)
 * shows what hover shows a mouse, the trace's preview and the tooltip there, until the next finger touches; a long
 * press on the selected node's console action also shows its label, and leaves the browser's own menu for its link. The
 * browser's click, double-click, right-click and mouse events made from a finger are the finger's, already read; a
 * mouse and a pen keep everything above exactly as it is.
 *
 * The keyboard (style skill §13; keyboard/navigation.ts): the drawing is one tab stop (roving `tabindex`; at first
 * its top-left solid node); the arrow keys move between the items of a zone (cards, chips, card-sized zones and the
 * open zones inside it, which take focus on their collapse button), ↓ on an open zone goes inside it, an arrow with
 * nothing that way in the zone carries on among the zone's neighbours (↑ reaches the zone's header), Home and End
 * go to the zone's first and last item; the camera pans just enough to show the item, zooming in first to the
 * scale at which labels are drawn when it is further out (camera.ts, `keyboardTransform`; at once with reduced
 * motion). `+` and `-` zoom about the focused item, which stays in the part of the canvas left in view (about that
 * part's centre from the canvas itself), and `0` fits the drawing to that part (keyboard/zoom.ts). Enter or Space
 * selects (the details drawer opens), Escape clears the selection and, with nothing selected, returns to the zone
 * around the item. The focus ring keeps its screen size at any scale (the painter's `setScale`). After "Drill in"
 * focus waits on the `<svg>` and goes to the new drawing's tab stop (canvasFocus.ts).
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from 'react';

import './theme/tokens.css';
import './diagram.css';
import './disclosure/disclosure.css';
import type { Rect } from '@gcportrait/layout';

import { focusVisible } from '../ui/dom';
import { Menu, type MenuCloseReason, type MenuItem } from '../ui/Menu';
import { canDrillIn, nodeMenuItems } from './actions';
import {
  doubleTapTransform,
  drawingPointAt,
  easeInOut,
  focusTransform,
  GLIDE_MS,
  glideAt,
  inRoom,
  isDrag,
  keyboardTransform,
  panTransform,
  REVEAL_MS,
  revealTransform,
  sameCamera,
  showsWhole,
  wheelTransform,
  zoomStepTransform,
  type CanvasRoom,
  type JumpMode,
  type ScreenPoint,
} from './camera';
import { publishCamera } from './canvasCamera';
import { isCanvasFocusParked, parkCanvasFocus, unparkCanvasFocus } from './canvasFocus';
import { DiagramDrawing, planDrawing, type DrawingOptions } from './Drawing';
import { collapseButtonOf, collapseZoneOf } from './disclosure/CollapseButton';
import { FLIP_GLIDE_MS, flipTransform, isFlipDrawn, type PendingFlip } from './disclosure/flipCamera';
import { documentText } from './DiagramSvg';
import { isNavigationKey, keyboardMap, navigate, zoneOf, type KeyboardMap } from './keyboard/navigation';
import { zoomKeyOf, type ZoomKey } from './keyboard/zoom';
import { levelOfDetail, LOD_CLASSES, lodClasses } from './lod';
import type { DiagramModel } from './model';
import { createPainter, isConsoleAction, nodeElement, nodeIdOf, type Painter } from './painter';
import type { DiagramTheme } from './theme/tokens';
import { createTouchGestures, type TouchGestures, type TouchHandlers } from './touch';
import styles from './touchHint.module.css';
import { computeTrace } from './trace';
import {
  cameraAttribute,
  FIT_PADDING,
  fitTransform,
  IDENTITY_CAMERA,
  type CameraTransform,
} from './viewport';

export interface DiagramCanvasProps {
  readonly model: DiagramModel;
  readonly theme: DiagramTheme;
  /** Show the legend and the title block on the canvas (a setting; exports always carry them). */
  readonly overlays: boolean;
  readonly utcOffsetMinutes: number;
  /** The selected node (from the URL hash), or null. */
  readonly selection: string | null;
  /** A node was clicked or activated with Enter or Space (its id), or the selection was cleared (null). */
  readonly onSelect: (id: string | null) => void;
  /**
   * "Drill in" from a container's menu or a double-click on it: re-root the view at it. Absent: neither
   * offers it. A double-click on a chip or a collapse button drills in `replace`ing the history entry its first
   * click's flip made, after undoing that flip (`onFlip` with `replace`), so it leaves no flip behind.
   */
  readonly onDrillIn?: (id: string, options?: HistoryOption) => void;
  /** The node under the pointer changed (its id, or null when the pointer left the nodes). */
  readonly onHover?: (id: string | null) => void;
  /**
   * A camera glide to make (the store's pending `jumpTo`), as soon as its node is drawn: `centre` (the default)
   * or `reveal` (camera.ts, `JumpMode`).
   */
  readonly jump?: { readonly id: string; readonly seq: number; readonly mode?: JumpMode } | null;
  /** The glide numbered `seq` has started: it is no longer pending. */
  readonly onJumpDone?: (seq: number) => void;
  /**
   * Expand a chip or collapse an open zone: toggle its flip (the store's `flip`). Absent: chips are
   * selected like any node and open zones have no collapse button.
   */
  readonly onFlip?: (zoneId: string, options?: HistoryOption) => void;
  /**
   * Which panels lie open over the canvas (a phone's or a tablet's View or More sheet, or details drawer): any value
   * that changes when one opens or closes. Each change fits the drawing again to the part of the canvas the panels
   * leave, while the camera still rests on the last fit (the header).
   */
  readonly panels?: string;
}

/** How a change enters the browser history (the store's `WriteOptions`): a new entry, or in place. */
export interface HistoryOption {
  readonly history?: 'push' | 'replace';
}

/** The node menu on screen: whose, where (viewport coordinates) and what it offers. */
interface OpenMenu {
  readonly id: string;
  readonly at: { readonly x: number; readonly y: number };
  readonly items: readonly MenuItem[];
}

/** The canvas size when the element has none yet (jsdom, a hidden page): a 1280 × 800 window's. */
const FALLBACK_SIZE = { width: 1280, height: 800 };

function canvasSize(svg: SVGSVGElement): { width: number; height: number } {
  const width = svg.clientWidth;
  const height = svg.clientHeight;
  return width > 0 && height > 0 ? { width, height } : FALLBACK_SIZE;
}

/** A box's edges, in CSS px from the canvas's top-left corner. */
interface Edges {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

const areaOf = (box: Edges): number => (box.right - box.left) * (box.bottom - box.top);

/**
 * The largest part of `room` that none of `panels` covers: a panel lying over it leaves the parts to its left and
 * right, above and below it, the next panel is taken in each of those in turn, and the largest part that remains wins
 * (the first of equals, in that order). A part free of every panel lies wholly to one side of each, so this finds the
 * largest whatever order the panels come in.
 */
function largestFree(room: Edges, panels: readonly Edges[]): Edges {
  const [panel, ...rest] = panels;
  if (panel === undefined) return room;
  const across = Math.min(room.right, panel.right) - Math.max(room.left, panel.left);
  const down = Math.min(room.bottom, panel.bottom) - Math.max(room.top, panel.top);
  if (across <= 0 || down <= 0) return largestFree(room, rest);
  const parts: readonly Edges[] = [
    { ...room, right: Math.max(room.left, panel.left) },
    { ...room, left: Math.min(room.right, panel.right) },
    { ...room, bottom: Math.max(room.top, panel.top) },
    { ...room, top: Math.min(room.bottom, panel.bottom) },
  ];
  return parts
    .map((part) => largestFree(part, rest))
    .reduce((largest, part) => (areaOf(part) > areaOf(largest) ? part : largest));
}

/** Whether an element lies open on screen: not inside a closed (`hidden`) element, and not `visibility: hidden`. */
function lyingOpen(element: Element): boolean {
  if (element.closest('[hidden]') !== null) return false;
  const visibility = element.ownerDocument.defaultView?.getComputedStyle(element).visibility;
  return visibility !== 'hidden' && visibility !== 'collapse';
}

/**
 * The part of the canvas a camera jump, the keyboard's pan and a zoom key's step keep a node in, and `0` fits the
 * drawing to (`fitRoom`; camera.ts, `inRoom`): the largest part of the canvas that no panel lying over it covers
 * (`data-canvas-overlay`, frontend/AGENTS.md, "Phones, tablets and desktops": on a phone or a tablet the details drawer along the canvas's right
 * or lower edge, and with it the disclosure bar's row in the part it leaves, above a phone's sheet or beside a tablet's
 * panel; the top bar's View or More sheet hanging over it from its top edge). One panel leaves the largest part of the
 * canvas it keeps free, to its left or right, above or below it; with the drawer and the row, the largest part clear of
 * both (`largestFree`). A closed panel (`hidden`) or one out of sight (`visibility: hidden`: the row under the phone's
 * sheet at full height, or on a canvas too short for it) covers nothing, and nor does one beside the canvas: on a
 * desktop the drawer stands beside it and no sheet opens, and the room is the canvas.
 */
function clearRoom(svg: SVGSVGElement): CanvasRoom {
  const size = canvasSize(svg);
  const box = svg.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0) return { x: 0, y: 0, ...size };
  const panels: Edges[] = [];
  for (const overlay of svg.ownerDocument.querySelectorAll('[data-canvas-overlay]')) {
    if (!lyingOpen(overlay)) continue;
    const over = overlay.getBoundingClientRect();
    panels.push({
      left: over.left - box.left,
      top: over.top - box.top,
      right: over.right - box.left,
      bottom: over.bottom - box.top,
    });
  }
  const room = largestFree({ left: 0, top: 0, right: size.width, bottom: size.height }, panels);
  return {
    x: room.left,
    y: room.top,
    width: Math.max(1, room.right - room.left),
    height: Math.max(1, room.bottom - room.top),
  };
}

/**
 * The part of the canvas `0` fits the drawing to: the room the panels lying over the canvas leave (`clearRoom`), so
 * that none of the drawing lies under them; or the whole canvas when that room has nothing inside the fit's margins
 * (`FIT_PADDING` on each side), as when the phone's drawer at full height leaves only the strip its handle stands in
 * and hides the drawing until it comes down.
 */
function fitRoom(svg: SVGSVGElement): CanvasRoom {
  const room = clearRoom(svg);
  return room.width > 2 * FIT_PADDING && room.height > 2 * FIT_PADDING
    ? room
    : { x: 0, y: 0, ...canvasSize(svg) };
}

/** How far a room lies inside each edge of the canvas (CSS px): what the panels over the canvas take of it. */
interface Insets {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

const NO_INSETS: Insets = { left: 0, top: 0, right: 0, bottom: 0 };

/** How far `room` lies inside each edge of the canvas: the same whatever the canvas's size while no panel moves. */
function insetsOf(svg: SVGSVGElement, room: CanvasRoom): Insets {
  const size = canvasSize(svg);
  return {
    left: room.x,
    top: room.y,
    right: size.width - room.x - room.width,
    bottom: size.height - room.y - room.height,
  };
}

/** Whether two rooms lie as far inside each edge of the canvas, give or take half a pixel. */
function sameInsets(a: Insets, b: Insets): boolean {
  return (
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.right - b.right) < 0.5 &&
    Math.abs(a.bottom - b.bottom) < 0.5
  );
}

/**
 * A fit of the drawing (a new view's, `0`'s, a panel's refit): the camera it set, and how far the room it was made
 * for (`fitRoom`) lay inside the canvas's edges (`NO_INSETS` when it filled the canvas). The camera rests on it until
 * the person moves it.
 */
interface Fit {
  readonly camera: CameraTransform;
  readonly insets: Insets;
}

/** Whether the viewer asked for reduced motion (no matchMedia, as in jsdom: no). */
function prefersReducedMotion(element: Element): boolean {
  const view = element.ownerDocument.defaultView;
  return (
    typeof view?.matchMedia === 'function' && view.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** A glide on its way: what it heads for, and how to stop it. */
interface Glide {
  readonly id: string;
  readonly mode: JumpMode;
  /** Where the camera ends (a zoom key pressed during a glide steps on from there). */
  readonly to: CameraTransform;
  readonly stop: () => void;
  readonly running: () => boolean;
}

/** The node and the nodes its selection trace reaches (trace.ts), as one rect: what a reveal keeps in view. */
function traceExtent(model: DiagramModel, id: string, rect: Rect): Rect {
  let [x0, y0, x1, y1] = [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height];
  for (const reached of computeTrace(model.trace, id)?.reached ?? []) {
    const other = model.input.layout.rects[reached];
    if (other === undefined) continue;
    x0 = Math.min(x0, other.x);
    y0 = Math.min(y0, other.y);
    x1 = Math.max(x1, other.x + other.width);
    y1 = Math.max(y1, other.y + other.height);
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/**
 * Glides the camera from `from` to `to` (camera.ts) in `ms`, frame by frame, each step `place`d; at once with reduced
 * motion or without animation frames. The person's own pan or zoom stops it (the canvas calls `stop`).
 */
function glideTo(
  svg: SVGSVGElement,
  from: CameraTransform,
  to: CameraTransform,
  ms: number,
  place: (camera: CameraTransform) => void,
): Pick<Glide, 'to' | 'stop' | 'running'> {
  const size = canvasSize(svg);
  const view = svg.ownerDocument.defaultView;
  if (prefersReducedMotion(svg) || typeof view?.requestAnimationFrame !== 'function') {
    place(to);
    return { to, stop: () => undefined, running: () => false };
  }
  let frame = 0;
  let stopped = false;
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    view.cancelAnimationFrame(frame);
  };
  const begin = view.performance.now();
  const step = (now: number): void => {
    if (stopped) return;
    const t = Math.min(1, Math.max(0, now - begin) / ms);
    place(glideAt(from, to, easeInOut(t), size.width, size.height));
    if (t < 1) frame = view.requestAnimationFrame(step);
    else stop();
  };
  frame = view.requestAnimationFrame(step);
  return { to, stop, running: () => !stopped };
}

/** How much of an open zone's header (from its left end, CSS px at scale 1) a keyboard move keeps in view. */
const ZONE_REVEAL_WIDTH = 240;

/**
 * The part of an item the camera keeps in view when the keyboard moves to it: a solid node whole; an open
 * zone, which takes focus on its collapse button over its header icon, by the start of its header.
 */
function revealBox(rect: Rect & { readonly role: string; readonly headerHeight: number }): Rect {
  if (rect.role !== 'zone') return rect;
  return {
    x: rect.x,
    y: rect.y,
    width: Math.min(rect.width, ZONE_REVEAL_WIDTH),
    height: Math.min(rect.height, Math.max(rect.headerHeight, 1)),
  };
}

/** Sets the level-of-detail classes for an effective scale; only touches the classes that change. */
function applyLevelOfDetail(svg: SVGSVGElement, scale: number): void {
  const wanted = new Set(lodClasses(levelOfDetail(scale)));
  for (const name of LOD_CLASSES) svg.classList.toggle(name, wanted.has(name));
  svg.setAttribute('data-scale', String(Math.round(scale * 1000) / 1000));
}

/** Whether an event names a finger as its pointer: a pointer event of a touch (and Chromium's click of a tap). */
function isTouchEvent(event: Event): boolean {
  return 'pointerType' in event && event.pointerType === 'touch';
}

/**
 * What a finger's gestures do on the drawing (the painter effect's): what `TouchHandlers` gives the canvas, but the
 * camera, which is the pan and zoom effect's; and `release`, which takes off what a long press showed.
 */
interface TouchActions extends Pick<TouchHandlers, 'tap' | 'doubleTap' | 'longPress'> {
  readonly release: () => void;
}

const NO_TOUCH_ACTIONS: TouchActions = {
  release: () => undefined,
  tap: () => undefined,
  doubleTap: () => undefined,
  longPress: () => undefined,
};

/** What a long press shows by the finger: its text, and the point pressed (the canvas's CSS px). */
interface HeldHint {
  readonly text: string;
  readonly at: ScreenPoint;
}

/**
 * How long after a wheel's turn the next one still belongs to the same gesture (ms): a mouse wheel's notches and a
 * touchpad's scroll come as a stream of turns.
 */
const WHEEL_GESTURE_MS = 150;

/** How far above the finger a long press's hint stands (CSS px): a fingertip would cover it nearer. */
const HINT_LIFT = 40;
/** The room a long press's hint keeps from the canvas's edges (CSS px). */
const HINT_MARGIN = 8;

/**
 * The drawings the page's canvases have put up, the last one's number (`data-drawing`). Counted for the page rather
 * than for a canvas, so a canvas mounted again (the diagram page left and opened again) repeats no number.
 */
let drawingsShown = 0;

/**
 * What a long press on `target` names: the tooltip a resting mouse would show there (the `<title>` of the target or
 * of the nearest element around it that has one, short of the drawing's own: a ghost's, a `secures` overlay's, a legend
 * row's, the console action's, the collapse button's), or else the node's accessible name; null on the bare canvas.
 */
function heldText(svg: SVGSVGElement, target: EventTarget | null): string | null {
  if (!(target instanceof Element) || !svg.contains(target)) return null;
  for (let at: Element | null = target; at !== null && at !== svg; at = at.parentElement) {
    for (const child of Array.from(at.children)) {
      if (child.localName !== 'title') continue;
      const text = child.textContent.trim();
      if (text !== '') return text;
    }
  }
  const id = nodeIdOf(target);
  return id === null ? null : (nodeElement(svg, id)?.getAttribute('aria-label') ?? null);
}

export function DiagramCanvas({
  model,
  theme,
  overlays,
  utcOffsetMinutes,
  selection,
  onSelect,
  onDrillIn,
  onHover,
  jump,
  onJumpDone,
  onFlip,
  panels,
}: DiagramCanvasProps): ReactElement {
  const svgRef = useRef<SVGSVGElement>(null);
  const viewportRef = useRef<SVGGElement>(null);
  // The camera the drawing is shown through, and how to set it (the pan and zoom effect's, null before and after it).
  const cameraRef = useRef<CameraTransform>(IDENTITY_CAMERA);
  const placeRef = useRef<((to: CameraTransform) => void) | null>(null);
  const painterRef = useRef<Painter | null>(null);
  const onSelectRef = useRef(onSelect);
  const onHoverRef = useRef(onHover);
  const onJumpDoneRef = useRef(onJumpDone);
  const glideRef = useRef<Glide | null>(null);
  const selectionRef = useRef(selection);
  const onFlipRef = useRef(onFlip);
  const onDrillInRef = useRef(onDrillIn);
  const modelRef = useRef(model);
  // The flip asked for here and not drawn yet; the drawing that keeps the camera; who gets focus after it.
  const flipRef = useRef<PendingFlip<DiagramModel> | null>(null);
  const keepCameraRef = useRef<DiagramModel | null>(null);
  const focusAfterRef = useRef<string | null>(null);
  // The zone the last single click flipped: a double-click's first click, should a double-click follow.
  const clickFlipRef = useRef<string | null>(null);
  // "Drill in" chosen from a node's menu (its menu then parks focus on the canvas, canvasFocus.ts); the model
  // the painter last drew (focus parked on the canvas moves on only when a new one is drawn); the drawing's frame
  // (`0` fits it).
  const drillChosenRef = useRef(false);
  const drawnModelRef = useRef<DiagramModel | null>(null);
  const frameRef = useRef<Rect | null>(null);
  // The last fit (a new view's, `0`'s, a panel's refit), which the camera rests on until the person moves it.
  const fitRef = useRef<Fit | null>(null);
  // What a finger's gestures do on the drawing now (the painter effect's), the gestures themselves (a click, a
  // double-click or a right-click while they say a finger is touching is the finger's, which they read already), and
  // what a long press shows by the finger.
  const touchActionsRef = useRef<TouchActions>(NO_TOUCH_ACTIONS);
  const gesturesRef = useRef<TouchGestures | null>(null);
  const hintRef = useRef<HTMLParagraphElement>(null);
  const [hint, setHint] = useState<HeldHint | null>(null);
  const titleId = useId();
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [status, setStatus] = useState('');

  // Opens a node's menu at a viewport point (a right-click) or under the node (the keyboard).
  const openMenuRef = useRef<(id: string, at: { x: number; y: number } | null) => void>(() => undefined);
  // The listeners below are native, so React does not flush their updates at once: the refs are brought up to
  // date in a layout effect, before the browser paints, so a key pressed as soon as a new selection shows
  // (Escape on the drawn drawer) never reaches the previous render's callbacks.
  useLayoutEffect(() => {
    onSelectRef.current = onSelect;
    onHoverRef.current = onHover;
    onJumpDoneRef.current = onJumpDone;
    selectionRef.current = selection;
    onFlipRef.current = onFlip;
    onDrillInRef.current = onDrillIn;
    modelRef.current = model;
    openMenuRef.current = (id, at) => {
      const svg = svgRef.current;
      const items = nodeMenuItems(model, id, {
        copy: (name) => {
          const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
          if (clipboard === undefined) {
            setStatus('Copying is not available here.');
            return;
          }
          clipboard.writeText(name).then(
            () => {
              setStatus(`Copied the resource name ${name}.`);
            },
            () => {
              setStatus('The browser did not allow copying.');
            },
          );
        },
        ...(onDrillIn === undefined
          ? {}
          : {
              drillIn: (target: string) => {
                drillChosenRef.current = true;
                onDrillIn(target);
              },
            }),
      });
      if (items.length === 0) return;
      let point = at;
      if (point === null) {
        const box = svg === null ? null : nodeElement(svg, id)?.getBoundingClientRect();
        point = box === null || box === undefined ? { x: 0, y: 0 } : { x: box.left, y: box.bottom + 4 };
      }
      setStatus('');
      setMenu({ id, at: point, items });
    };
  });

  const collapsible = onFlip !== undefined;
  const options = useMemo<DrawingOptions>(
    () => ({ theme, overlays, interactive: true, utcOffsetMinutes, collapsible }),
    [theme, overlays, utcOffsetMinutes, collapsible],
  );
  const plan = useMemo(() => planDrawing(model, options), [model, options]);
  const drawing = useMemo(
    () => <DiagramDrawing model={model} options={options} plan={plan} />,
    [model, options, plan],
  );
  const text = documentText(model, utcOffsetMinutes);
  const { frame } = plan;
  useLayoutEffect(() => {
    frameRef.current = frame;
  });

  // The fit the camera rests on, made again for the part of the canvas the panels lying over it leave now (`fitRoom`)
  // when the last fit was made for another (a panel opened or closed, or the drawer changed its size since): a glide
  // there, at once with reduced motion. Null when the camera rests on no fit: the person moved it since (a pan, a pinch,
  // a zoom key, a jump, a keyboard move), and a panel never moves it back. A glide on its way counts as resting on its
  // end, so a panel closed while the refit for its opening still glides fits the drawing back to the canvas.
  const refit = (): Fit | null => {
    const svg = svgRef.current;
    const place = placeRef.current;
    const fit = fitRef.current;
    const drawn = frameRef.current;
    if (svg === null || place === null || fit === null || drawn === null) return null;
    const running = glideRef.current;
    const camera = running !== null && running.running() ? running.to : cameraRef.current;
    if (!sameCamera(camera, fit.camera)) return null;
    const room = fitRoom(svg);
    const insets = insetsOf(svg, room);
    if (sameInsets(insets, fit.insets)) return fit;
    const to = inRoom(room, camera, (width, height) => fitTransform(drawn, width, height));
    running?.stop();
    glideRef.current = { id: '', mode: 'reveal', ...glideTo(svg, cameraRef.current, to, REVEAL_MS, place) };
    const next = { camera: to, insets };
    fitRef.current = next;
    return next;
  };

  // The camera, set up once per <svg>: kept here (`cameraRef`), put straight onto the viewport group (`place`) and
  // published for the export's "current viewport" and the tests (canvasCamera.ts). A layout effect, like the fit below
  // (which needs `place`), so the first frame the browser paints is already fitted. The canvas reads every pointer
  // itself and moves the one camera for each, within the scale extent: a finger's pointer events as gestures
  // (touch.ts), a mouse's and a pen's as a click or a drag, and the wheel.
  useLayoutEffect(() => {
    const svg = svgRef.current;
    const viewport = viewportRef.current;
    if (svg === null || viewport === null) return undefined;
    const place = (to: CameraTransform): void => {
      cameraRef.current = to;
      viewport.setAttribute('transform', cameraAttribute(to));
      applyLevelOfDetail(svg, to.k);
      // The focus ring keeps its screen size below 100 %.
      painterRef.current?.setScale(to.k);
    };
    placeRef.current = place;
    // The person moved the camera (a finger, a mouse's or a pen's drag, the wheel): a glide still on its way stops
    // where it is.
    const move = (to: CameraTransform): void => {
      glideRef.current?.stop();
      place(to);
    };
    const unpublish = publishCamera(svg, { get: () => cameraRef.current, moveTo: move });
    const gestures = createTouchGestures({
      camera: () => cameraRef.current,
      moveCamera: (to) => {
        // A finger moved the camera: a glide still on its way stops where it is (a tap leaves it, so the glide that
        // frames a chip the first tap of a double tap opened goes on), and what a long press showed by the finger goes.
        touchActionsRef.current.release();
        move(to);
      },
      begin: () => {
        touchActionsRef.current.release();
      },
      tap: (target, at) => {
        touchActionsRef.current.tap(target, at);
      },
      doubleTap: (target, at) => {
        touchActionsRef.current.doubleTap(target, at);
      },
      longPress: (target, at) => {
        touchActionsRef.current.longPress(target, at);
      },
    });
    gesturesRef.current = gestures;
    const view = svg.ownerDocument.defaultView;
    const local = (event: MouseEvent): ScreenPoint => {
      const box = svg.getBoundingClientRect();
      return { x: event.clientX - box.left, y: event.clientY - box.top };
    };
    // What a browser would make of a press while a mouse or a pen holds the drawing (a drag of what was pressed, the
    // console action's link; a text selection) and of a drag's click (a selection, the link opened): none of it.
    const refuse = (event: Event): void => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    // The click a browser makes of a drag's release is taken on the window, before anything else hears it, when it
    // comes in the same task as the release, as a browser sends it.
    let unswallow: (() => void) | null = null;
    const swallowClick = (): void => {
      unswallow?.();
      if (view === null) return;
      const stop = (): void => {
        clearTimeout(timer);
        view.removeEventListener('click', swallow, true);
        unswallow = null;
      };
      const swallow = (event: Event): void => {
        refuse(event);
        stop();
      };
      view.addEventListener('click', swallow, true);
      const timer = setTimeout(stop, 0);
      unswallow = stop;
    };
    // A mouse's or a pen's press of the primary button: its pointer, where it was pressed and the drawing's point there,
    // and whether it has moved past the click distance since (a drag, which keeps that point under the pointer).
    let press: {
      readonly id: number;
      readonly at: ScreenPoint;
      readonly held: ScreenPoint;
      dragging: boolean;
    } | null = null;
    const letGo = (dragged: boolean): void => {
      if (press === null) return;
      press = null;
      view?.removeEventListener('dragstart', refuse, true);
      view?.removeEventListener('selectstart', refuse, true);
      if (dragged) swallowClick();
    };
    // A finger's presses are heard on the canvas, its moves and lifts on the window, where they go once the node it
    // pressed is redrawn mid-gesture; a mouse's and a pen's too, which the canvas takes over once they drag.
    const onDown = (event: PointerEvent): void => {
      if (event.pointerType === 'touch') {
        gestures.down(event.pointerId, local(event), event.target, event.isPrimary);
        return;
      }
      // The primary button without Ctrl (with it, a Mac's right-click) takes hold of the drawing; any other button is
      // the other listeners' (the right-click's menu).
      if (event.button !== 0 || event.ctrlKey) return;
      letGo(false);
      // The person took hold of the camera: a glide on its way stops where it is.
      glideRef.current?.stop();
      const at = local(event);
      press = { id: event.pointerId, at, held: drawingPointAt(cameraRef.current, at), dragging: false };
      view?.addEventListener('dragstart', refuse, true);
      view?.addEventListener('selectstart', refuse, true);
    };
    const onMove = (event: PointerEvent): void => {
      if (event.pointerType === 'touch') {
        gestures.move(event.pointerId, local(event));
        return;
      }
      if (press === null || event.pointerId !== press.id) return;
      // The button was let go where the canvas did not hear it: the press is over.
      if ((event.buttons & 1) === 0) {
        letGo(false);
        return;
      }
      const at = local(event);
      if (!press.dragging) {
        // A hand's wobble moves nothing: the press may still be a click.
        if (!isDrag(press.at, at)) return;
        press.dragging = true;
        // A drag from now on: its moves and its release come to the canvas wherever the pointer goes.
        try {
          svg.setPointerCapture(event.pointerId);
        } catch {
          // A pointer the browser no longer knows (or a test's): the window still hears it.
        }
      }
      move(panTransform(cameraRef.current, press.held, at));
    };
    const onUp = (event: PointerEvent): void => {
      if (event.pointerType === 'touch') {
        gestures.up(event.pointerId, local(event));
        return;
      }
      if (press !== null && event.pointerId === press.id) letGo(press.dragging);
    };
    const onCancel = (event: PointerEvent): void => {
      if (event.pointerType === 'touch') {
        gestures.cancel(event.pointerId);
        return;
      }
      if (press !== null && event.pointerId === press.id) letGo(false);
    };
    // The wheel zooms about the pointer (camera.ts, `wheelTransform`; with Ctrl, a touchpad's pinch). Turns less than
    // `WHEEL_GESTURE_MS` apart are one gesture: once one of them zoomed, the rest are the canvas's even where the scale
    // extent leaves them nothing to do, while a turn on its own there is the page's (with Ctrl, the browser's zoom).
    let wheeling: ReturnType<typeof setTimeout> | undefined;
    const onWheel = (event: WheelEvent): void => {
      const to = wheelTransform(cameraRef.current, event, local(event));
      if (to === null && wheeling === undefined) return;
      event.preventDefault();
      clearTimeout(wheeling);
      wheeling = setTimeout(() => {
        wheeling = undefined;
      }, WHEEL_GESTURE_MS);
      if (to !== null) move(to);
    };
    svg.addEventListener('pointerdown', onDown);
    svg.addEventListener('wheel', onWheel, { passive: false });
    view?.addEventListener('pointermove', onMove);
    view?.addEventListener('pointerup', onUp);
    view?.addEventListener('pointercancel', onCancel);
    return () => {
      svg.removeEventListener('pointerdown', onDown);
      svg.removeEventListener('wheel', onWheel);
      view?.removeEventListener('pointermove', onMove);
      view?.removeEventListener('pointerup', onUp);
      view?.removeEventListener('pointercancel', onCancel);
      letGo(false);
      unswallow?.();
      clearTimeout(wheeling);
      gestures.dispose();
      gesturesRef.current = null;
      unpublish();
      placeRef.current = null;
    };
  }, []);

  // A long press's hint stands above the finger (under it where the canvas has no room above), inside the canvas.
  useLayoutEffect(() => {
    const element = hintRef.current;
    const svg = svgRef.current;
    if (hint === null || element === null || svg === null) return;
    const size = canvasSize(svg);
    const { offsetWidth: width, offsetHeight: height } = element;
    const left = Math.max(HINT_MARGIN, Math.min(hint.at.x - width / 2, size.width - HINT_MARGIN - width));
    const above = hint.at.y - HINT_LIFT - height;
    const top =
      above >= HINT_MARGIN ? above : Math.min(hint.at.y + HINT_LIFT, size.height - HINT_MARGIN - height);
    element.style.left = `${String(Math.round(left))}px`;
    element.style.top = `${String(Math.round(Math.max(0, top)))}px`;
  }, [hint]);

  // A chip expanded or a zone collapsed here: the drawing with that flip keeps the camera where it was
  // (the fit below leaves it) and glides 200 ms to frame the zone; after a flip from the keyboard, focus follows
  // the zone (the painter effect). Before the fit, which it tells to keep the camera.
  useLayoutEffect(() => {
    const pending = flipRef.current;
    if (pending === null || pending.model === model) return;
    flipRef.current = null;
    const svg = svgRef.current;
    const place = placeRef.current;
    const rect = model.input.layout.rects[pending.id];
    if (svg === null || place === null || rect === undefined || !isFlipDrawn(pending, rect)) return;
    keepCameraRef.current = model;
    if (pending.keyboard) focusAfterRef.current = pending.id;
    const size = canvasSize(svg);
    const to = flipTransform(rect, size.width, size.height, cameraRef.current, pending.wasChip);
    glideRef.current?.stop();
    glideRef.current = {
      id: pending.id,
      mode: 'centre',
      ...glideTo(svg, cameraRef.current, to, FLIP_GLIDE_MS, place),
    };
  }, [model]);

  // Fit the whole drawing whenever its frame changes (a new view), to the part of the canvas the panels lying over it
  // leave (`fitRoom`; the whole canvas when none does), and remember the fit, which the camera rests on until the
  // person moves it; a theme or selection change keeps the camera, and so does the drawing of a flip made here
  // (above). The camera is set synchronously, so the viewport carries it before the first paint. A glide
  // still on its way (a keyboard move's pan, made just before a drill-in) was heading for a place in the previous
  // drawing: it stops, so it cannot carry the camera off the new one; a jump waiting for this drawing glides
  // afterwards.
  useLayoutEffect(() => {
    const svg = svgRef.current;
    const place = placeRef.current;
    if (svg === null || place === null || keepCameraRef.current === modelRef.current) return;
    glideRef.current?.stop();
    glideRef.current = null;
    const room = fitRoom(svg);
    const fit = inRoom(room, cameraRef.current, (width, height) =>
      fitTransform({ x: frame.x, y: frame.y, width: frame.width, height: frame.height }, width, height),
    );
    place(fit);
    fitRef.current = { camera: fit, insets: insetsOf(svg, room) };
  }, [frame.x, frame.y, frame.width, frame.height]);

  // A panel opened or closed over the canvas (`panels`, in the same commit as the panel's `hidden`): the drawing is
  // fitted again to the part the panels leave now, while the camera still rests on the last fit (`refit`). After the
  // fit above, which a new view drawn in the same commit has made for the panels as they are already.
  useLayoutEffect(() => {
    refit();
    const svg = svgRef.current;
    if (svg === null || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => {
      refit();
    });
    for (const overlay of svg.ownerDocument.querySelectorAll('[data-canvas-overlay], [data-canvas-resize]')) {
      observer.observe(overlay, { box: 'border-box' });
    }
    return () => {
      observer.disconnect();
    };
  }, [panels]);

  // The painter and the pointer and keyboard listeners, once per drawing. A theme or settings change re-renders
  // the same elements, so the old painter takes its marks off first (cleanup) and the new one paints the
  // selection and the keyboard focus again; a hover waits for the pointer's next move.
  useEffect(() => {
    const svg = svgRef.current;
    if (svg === null) return undefined;
    const painter = createPainter(svg, model);
    painterRef.current = painter;
    painter.setScale(cameraRef.current.k);
    painter.select(selectionRef.current);
    const active = svg.ownerDocument.activeElement;
    const focusedId = active !== null && svg.contains(active) ? nodeIdOf(active) : null;
    if (active !== null && focusedId !== null) {
      painter.setTabStop(focusedId);
      painter.focus(focusVisible(active) ? focusedId : null);
    }
    let hovered: string | null = null;
    const hover = (id: string | null): void => {
      painter.hover(id);
      if (id === hovered) return;
      hovered = id;
      onHoverRef.current?.(id);
    };
    // What a long press showed (touch.ts): the hover, the hint by the finger, the console action's label. It stays
    // until the next finger touches or moves the camera, a mouse moves over the drawing, or the drawing is replaced.
    let held = false;
    const release = (): void => {
      if (!held) return;
      held = false;
      hover(null);
      setHint(null);
      svg.querySelector('.dg-console-action')?.classList.remove('is-held');
    };
    // A click, a double-click or a right-click is a finger's when it says so (Chromium's) or comes while a finger is
    // on the canvas or has just left it: the gestures read it already.
    const fromFinger = (event: Event): boolean =>
      isTouchEvent(event) || gesturesRef.current?.touching() === true;
    // A finger's hover is its long press's: the pointer events a touch makes on its way (over, then out after the
    // lift) are not a resting pointer.
    const onPointerOver = (event: Event): void => {
      if (isTouchEvent(event)) return;
      release();
      hover(nodeIdOf(event.target));
    };
    const onPointerLeave = (event: Event): void => {
      if (isTouchEvent(event)) return;
      hover(null);
    };
    const onPointerDown = (): void => {
      unparkCanvasFocus(svg);
    };
    // The zone a chip or a collapse button flips, when the page flips zones.
    const flipTarget = (target: EventTarget | null): string | null => {
      if (onFlipRef.current === undefined || !(target instanceof Element)) return null;
      return collapseZoneOf(target) ?? target.closest('.dg-chip')?.getAttribute('data-id') ?? null;
    };
    const flip = (id: string, keyboard: boolean): void => {
      flipRef.current = { model, id, wasChip: model.input.layout.rects[id]?.role === 'chip', keyboard };
      onFlipRef.current?.(id);
    };
    // The drawing's items for the arrow keys, worked out on the first key press. Open zones are items when
    // they have a collapse button to take focus (the page flips zones).
    let keyboard: KeyboardMap | null = null;
    const keyboardOf = (): KeyboardMap =>
      (keyboard ??= keyboardMap(model.rects, svg.querySelector('.dg-collapse') !== null));
    // Moves focus to an item (a node, or an open zone's collapse button) and pans the camera just enough to show
    // it; it becomes the tab stop and gets the focus ring (an open zone's collapse button shows its own focus).
    const focusItem = (id: string): void => {
      const rect = model.input.layout.rects[id];
      const target = rect?.role === 'zone' ? collapseButtonOf(svg, id) : nodeElement(svg, id);
      if (rect === undefined || !(target instanceof SVGElement)) return;
      painter.setTabStop(id);
      target.focus({ preventScroll: true });
      // Moved by a key: the ring shows whatever the browser's focus-visible heuristic says.
      painter.focus(id);
      const place = placeRef.current;
      if (place === null) return;
      // The person moved on: a glide still on its way (a search hit's) stops where it is, and the camera pans
      // from there.
      glideRef.current?.stop();
      const to = inRoom(clearRoom(svg), cameraRef.current, (width, height, camera) =>
        keyboardTransform(revealBox(rect), width, height, camera),
      );
      if (to === null) return;
      glideRef.current = { id, mode: 'reveal', ...glideTo(svg, cameraRef.current, to, REVEAL_MS, place) };
    };
    // The zoom keys: one step in or out about the focused item (from the canvas itself, about the centre of the
    // part of the canvas a panel lying over it leaves in view), keeping the item in that part, as a jump and the
    // keyboard's pan do (`clearRoom`); `0` fits the whole drawing to that part (`fitRoom`), a fit the camera then rests
    // on as on a new view's, so a panel closed afterwards fits the drawing to the canvas again.
    const zoomBy = (key: ZoomKey, focusedId: string | null): void => {
      const place = placeRef.current;
      const drawn = frameRef.current;
      if (place === null) return;
      // Pressed again while the last glide is on its way: one more step from where that glide ends, so quick
      // presses add up.
      const running = glideRef.current;
      const current = running !== null && running.running() ? running.to : cameraRef.current;
      let to: CameraTransform | null;
      if (key === 'fit') {
        if (drawn === null) return;
        const room = fitRoom(svg);
        to = inRoom(room, current, (width, height) => fitTransform(drawn, width, height));
        fitRef.current = { camera: to, insets: insetsOf(svg, room) };
      } else {
        const rect = focusedId === null ? undefined : model.input.layout.rects[focusedId];
        const box = rect === undefined ? null : revealBox(rect);
        const direction = key === 'in' ? 1 : -1;
        to = inRoom(clearRoom(svg), current, (width, height, camera) =>
          zoomStepTransform(camera, direction, box, width, height),
        );
      }
      if (to === null) return;
      glideRef.current?.stop();
      glideRef.current = {
        id: focusedId ?? '',
        mode: 'reveal',
        ...glideTo(svg, cameraRef.current, to, REVEAL_MS, place),
      };
    };
    // The drawing's tab stop (a node, or an open zone's collapse button), by its node id.
    const tabStopId = (): string | null =>
      nodeIdOf(svg.querySelector('.dg-zones [tabindex="0"], .dg-nodes [tabindex="0"]'));
    // A click (`detail`: its count) or a finger's tap that stayed put: a chip expands, a collapse button collapses its
    // zone, anything else is selected (the bare canvas clears the selection).
    const activate = (target: EventTarget | null, detail: number): void => {
      const flipped = flipTarget(target);
      if (flipped !== null) {
        // A double-click (reserved for drill-in) does not flip back what its first click flipped.
        if (detail <= 1) {
          clickFlipRef.current = flipped;
          flip(flipped, false);
        }
        return;
      }
      clickFlipRef.current = null;
      onSelectRef.current(nodeIdOf(target));
    };
    const onClick = (event: MouseEvent): void => {
      // A finger's tap was read as one already (touch.ts); the click the browser makes of it changes nothing more.
      if (fromFinger(event)) return;
      // The console action is a link of its own: it opens its page (a new tab) and changes nothing here.
      if (isConsoleAction(event.target)) return;
      // A drag, which pans the canvas, never gets here: the canvas takes its click on the window (the click distance).
      activate(event.target, event.detail);
    };
    // A double tap at a point: one step in, about that point (camera.ts, `doubleTapTransform`), as a glide.
    const zoomInAt = (at: ScreenPoint): void => {
      const place = placeRef.current;
      if (place === null) return;
      const to = doubleTapTransform(cameraRef.current, at);
      if (to === null) return;
      glideRef.current?.stop();
      glideRef.current = { id: '', mode: 'reveal', ...glideTo(svg, cameraRef.current, to, REVEAL_MS, place) };
    };
    touchActionsRef.current = {
      release,
      tap: (target) => {
        // The console action's link opens with the browser's click, as a mouse's does.
        if (!isConsoleAction(target)) activate(target, 1);
      },
      doubleTap: (target, at) => {
        if (isConsoleAction(target)) return;
        // Its first tap opened a chip or closed a zone: that flip stands, framed by its own glide, as a double-click's
        // second click does not flip back what its first flipped. Anywhere else the drawing zooms in about the point.
        const flipped = clickFlipRef.current;
        clickFlipRef.current = null;
        if (flipped === null) zoomInAt(at);
      },
      longPress: (target, at) => {
        release();
        held = true;
        hover(nodeIdOf(target));
        if (isConsoleAction(target)) svg.querySelector('.dg-console-action')?.classList.add('is-held');
        const text = heldText(svg, target);
        setHint(text === null ? null : { text, at });
      },
    };
    const onContextMenu = (event: MouseEvent): void => {
      // A finger's long press shows what hover shows (above), never the node's menu; on the console action the
      // browser keeps its own menu for the link.
      if (fromFinger(event)) {
        if (!isConsoleAction(event.target)) event.preventDefault();
        return;
      }
      const id = nodeIdOf(event.target);
      if (id === null) return;
      event.preventDefault();
      onSelectRef.current(id);
      openMenuRef.current(id, { x: event.clientX, y: event.clientY });
    };
    // A double-click on a container drills into it, as the menu's "Drill in" does (`onDrillIn`).
    const onDoubleClick = (event: MouseEvent): void => {
      // A finger's double tap was read as one already (touch.ts).
      if (fromFinger(event)) return;
      const clicked = clickFlipRef.current;
      clickFlipRef.current = null;
      if (isConsoleAction(event.target)) return;
      const id = nodeIdOf(event.target);
      if (id === null || !canDrillIn(model, id)) return;
      if (clicked !== id) {
        onDrillInRef.current?.(id);
        return;
      }
      // Its first click flipped the zone (a chip opened, an open zone closed): the person meant to drill in. The
      // flip is undone in its own history entry, which the drill-in then takes over, so Back returns to the
      // drawing before the double-click and the drawing after it carries no flip.
      flipRef.current = null;
      onFlipRef.current?.(id, { history: 'replace' });
      onDrillInRef.current?.(id, { history: 'replace' });
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        // From the console action (a tab stop after the selected node), focus goes back to the node, as the
        // action goes away with the selection.
        const selected = selectionRef.current;
        const fromAction = isConsoleAction(event.target);
        if (selected === null && !fromAction) {
          // Nothing selected: Escape returns to the zone around the focused item.
          const from = nodeIdOf(event.target);
          const zone = from === null ? null : zoneOf(keyboardOf(), from);
          if (zone !== null) {
            event.preventDefault();
            focusItem(zone);
          }
          return;
        }
        onSelectRef.current(null);
        if (fromAction && selected !== null) {
          const element = nodeElement(svg, selected);
          if (element instanceof SVGElement && element.getAttribute('role') === 'button') {
            painter.setTabStop(selected);
            element.focus();
          }
        }
        return;
      }
      // `+`, `-` and `0` zoom (keyboard/zoom.ts), from an item or from the canvas itself.
      const zoomKey = zoomKeyOf(event);
      if (zoomKey !== null) {
        event.preventDefault();
        zoomBy(zoomKey, event.target === svg ? null : nodeIdOf(event.target));
        return;
      }
      // The arrow keys, Home and End move between the items of a zone (keyboard/navigation.ts); from the
      // canvas itself (focused by a click on its background) they go to its tab stop first.
      if (
        isNavigationKey(event.key) &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey
      ) {
        const from = event.target === svg ? null : nodeIdOf(event.target);
        if (from === null && event.target !== svg) return;
        event.preventDefault();
        const next = from === null ? tabStopId() : navigate(keyboardOf(), from, event.key);
        if (next !== null) focusItem(next);
        return;
      }
      const id = nodeIdOf(event.target);
      if (id === null) return;
      if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
        event.preventDefault();
        onSelectRef.current(id);
        openMenuRef.current(id, null);
        return;
      }
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      // Enter or Space on a chip expands it, on a collapse button collapses its zone.
      const flipped = flipTarget(event.target);
      if (flipped !== null) {
        if (!event.repeat) flip(flipped, true);
        return;
      }
      // Enter on the selected node opens its menu (the keyboard's way to its console action).
      if (event.key === 'Enter' && id === selectionRef.current) {
        openMenuRef.current(id, null);
        return;
      }
      onSelectRef.current(id);
    };
    const onFocusIn = (event: FocusEvent): void => {
      const id = nodeIdOf(event.target);
      if (id === null) return;
      painter.setTabStop(id);
      painter.focus(event.target instanceof Element && focusVisible(event.target) ? id : null);
    };
    const onFocusOut = (event: FocusEvent): void => {
      painter.focus(null);
      // Focus parked on the canvas for the next view moved elsewhere: it no longer waits.
      if (event.target === svg) unparkCanvasFocus(svg);
    };
    svg.addEventListener('pointerover', onPointerOver);
    svg.addEventListener('pointerleave', onPointerLeave);
    svg.addEventListener('pointerdown', onPointerDown);
    svg.addEventListener('click', onClick);
    svg.addEventListener('contextmenu', onContextMenu);
    svg.addEventListener('dblclick', onDoubleClick);
    svg.addEventListener('keydown', onKeyDown);
    svg.addEventListener('focusin', onFocusIn);
    svg.addEventListener('focusout', onFocusOut);
    // Fitted (the layout effects ran first) and now interactive: what the tests and the e2e suite wait for, the
    // drawing's number first, which tells this drawing from the one before it.
    drawingsShown += 1;
    svg.setAttribute('data-drawing', String(drawingsShown));
    svg.setAttribute('data-diagram-ready', 'true');
    // After a flip from the keyboard, focus follows the zone: its collapse button, or its chip.
    const focusAfter = focusAfterRef.current;
    focusAfterRef.current = null;
    if (focusAfter !== null) {
      const target =
        model.input.layout.rects[focusAfter]?.role === 'zone'
          ? collapseButtonOf(svg, focusAfter)
          : nodeElement(svg, focusAfter);
      if (target instanceof SVGElement) target.focus({ preventScroll: true });
    }
    // After "Drill in" (a node's menu, the details drawer), focus waited on the canvas: once the new view is
    // drawn it goes to the new drawing's tab stop. A redraw of the same view (a theme change) leaves it.
    const newView = drawnModelRef.current !== model;
    drawnModelRef.current = model;
    if (newView && isCanvasFocusParked(svg)) {
      unparkCanvasFocus(svg);
      const stop = svg.querySelector('.dg-zones [tabindex="0"], .dg-nodes [tabindex="0"]');
      if (stop instanceof SVGElement) stop.focus({ preventScroll: true });
    }
    return () => {
      svg.removeEventListener('pointerover', onPointerOver);
      svg.removeEventListener('pointerleave', onPointerLeave);
      svg.removeEventListener('pointerdown', onPointerDown);
      svg.removeEventListener('click', onClick);
      svg.removeEventListener('contextmenu', onContextMenu);
      svg.removeEventListener('dblclick', onDoubleClick);
      svg.removeEventListener('keydown', onKeyDown);
      svg.removeEventListener('focusin', onFocusIn);
      svg.removeEventListener('focusout', onFocusOut);
      touchActionsRef.current = NO_TOUCH_ACTIONS;
      if (held) {
        setHint(null);
        svg.querySelector('.dg-console-action')?.classList.remove('is-held');
      }
      painter.dispose();
      painterRef.current = null;
      // The painter's hover goes with it (a hover waits for the pointer's next move).
      if (hovered !== null) onHoverRef.current?.(null);
    };
  }, [drawing, model]);

  useEffect(() => {
    painterRef.current?.select(selection);
  }, [selection, drawing]);

  // A pending jump: glide as soon as its node is drawn (this drawing, or a later one). A newer jump or the
  // canvas going away stops a glide still running; the store no longer keeping the jump does not. A `reveal`
  // (the details drawer) pans only as far as the node and its trace need, and not at all when they are in
  // view or a centring glide is already on its way to the node. Over a camera that still rests on the last fit, a
  // reveal first fits the drawing again when the drawer changed its size since (`refit`), and works out from where
  // that fit ends; while the fit is to the part of the canvas the drawer leaves and shows the whole drawing there, the
  // node and its trace are in view already and the camera stays on the fit, which the drawer's closing then makes
  // again for the whole canvas.
  useEffect(() => {
    if (jump === null || jump === undefined) return;
    const svg = svgRef.current;
    const place = placeRef.current;
    const rect = model.input.layout.rects[jump.id];
    if (svg === null || place === null || rect === undefined) return;
    const mode = jump.mode ?? 'centre';
    const room = clearRoom(svg);
    const fit = mode === 'reveal' ? refit() : null;
    if (
      fit !== null &&
      !sameInsets(fit.insets, NO_INSETS) &&
      frameRef.current !== null &&
      showsWhole(frameRef.current, fitRoom(svg), fit.camera)
    ) {
      onJumpDoneRef.current?.(jump.seq);
      return;
    }
    const current = fit?.camera ?? cameraRef.current;
    const running = glideRef.current;
    const centring = running?.mode === 'centre' && running.id === jump.id && running.running();
    const to =
      mode === 'centre'
        ? inRoom(room, current, (width, height, camera) => focusTransform(rect, width, height, camera))
        : centring
          ? null
          : inRoom(room, current, (width, height, camera) =>
              revealTransform(rect, traceExtent(model, jump.id, rect), width, height, camera),
            );
    if (to !== null) {
      running?.stop();
      const glide = glideTo(svg, cameraRef.current, to, mode === 'centre' ? GLIDE_MS : REVEAL_MS, place);
      glideRef.current = { id: jump.id, mode, ...glide };
    }
    // A centring jump to the node already selected (a search hit) blinks it like a new selection does.
    if (mode === 'centre' && jump.id === selectionRef.current) painterRef.current?.pulse();
    onJumpDoneRef.current?.(jump.seq);
  }, [jump, model]);
  useEffect(
    () => () => {
      glideRef.current?.stop();
      glideRef.current = null;
    },
    [],
  );

  const closeMenu = (reason: MenuCloseReason): void => {
    const open = menu;
    setMenu(null);
    // Escape (and an action) puts focus back on the node, or on an open zone's collapse button; Tab and a
    // press elsewhere let it go where it went.
    if (open === null || (reason !== 'escape' && reason !== 'select')) return;
    const svg = svgRef.current;
    if (svg === null) return;
    // "Drill in" replaces the drawing: focus waits on the canvas, then goes to the new drawing's tab stop.
    const drilled = drillChosenRef.current;
    drillChosenRef.current = false;
    if (reason === 'select' && drilled) {
      parkCanvasFocus(svg);
      return;
    }
    const element = nodeElement(svg, open.id);
    const target =
      element instanceof SVGElement && element.getAttribute('role') !== 'button'
        ? collapseButtonOf(svg, open.id)
        : element;
    if (target instanceof SVGElement && target.getAttribute('role') === 'button') {
      painterRef.current?.setTabStop(open.id);
      target.focus();
    }
  };

  return (
    <>
      <svg
        ref={svgRef}
        className="dg-canvas"
        role="graphics-document"
        aria-labelledby={titleId}
        // Chromium makes a named <svg> a tab stop of its own; the drawing's tab stops are its roving node and,
        // while a node is selected, that node's console action.
        tabIndex={-1}
        data-theme={theme}
        data-dim={model.dim ? 'true' : 'false'}
      >
        <title id={titleId}>{text.title}</title>
        <desc>{text.desc}</desc>
        <g ref={viewportRef} className="dg-viewport">
          {drawing}
        </g>
      </svg>
      {menu === null ? null : (
        <Menu
          label={`Actions for ${model.nodes.get(menu.id)?.label ?? menu.id}`}
          items={menu.items}
          at={menu.at}
          onClose={closeMenu}
        />
      )}
      {hint === null ? null : (
        // The same words assistive technology has already (the node's name, the element's own `<title>`).
        <p ref={hintRef} className={styles.hint} aria-hidden="true">
          {hint.text}
        </p>
      )}
      <p className="visually-hidden" role="status">
        {status}
      </p>
    </>
  );
}
