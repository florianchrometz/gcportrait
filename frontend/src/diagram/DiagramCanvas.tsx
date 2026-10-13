// SPDX-License-Identifier: MIT
/**
 * The interactive diagram (AGENTS.md, Architecture and code; style skill §13): the drawing inside an `<svg>` that
 * d3-zoom pans and zooms (`scaleExtent [0.05, 200]`, wheel and drag; double-click is reserved for drill-in and does
 * not zoom), level of detail by the effective scale, and hover, selection (with its trace) and keyboard focus painted
 * by the highlight painter. The drawing renders once per model, theme and settings; zooming, hovering and selecting
 * only set attributes and classes on it, and never ask for a new layout. `data-diagram-ready="true"` on the
 * `<svg>` says the drawing is fitted and interactive: it is set once the painter and its listeners are attached.
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
 * trace in view); and `onHover`, which tells the store which node is under the pointer.
 *
 * Progressive disclosure, with `onFlip`: a click on a chip, or Enter or Space on a focused one, expands
 * it, and an open zone's collapse button (over its header icon; disclosure/CollapseButton.tsx) collapses it,
 * both by the zone's flip. The drawing with the flip keeps the camera where it was (no fit) and glides 200 ms to
 * frame the zone (disclosure/flipCamera.ts); after a flip from the keyboard, focus follows the zone (its collapse
 * button, or its chip). Without `onFlip` a chip is selected like any node.
 *
 * The keyboard (style skill §13; keyboard/navigation.ts): the drawing is one tab stop (roving `tabindex`; at first
 * its top-left solid node); the arrow keys move between the items of a zone (cards, chips, card-sized zones and the
 * open zones inside it, which take focus on their collapse button), ↓ on an open zone goes inside it, an arrow with
 * nothing that way in the zone carries on among the zone's neighbours (↑ reaches the zone's header), Home and End
 * go to the zone's first and last item; the camera pans just enough to show the item, zooming in first to the
 * scale at which labels are drawn when it is further out (camera.ts, `keyboardTransform`; at once with reduced
 * motion). `+` and `-` zoom about the focused item and `0` fits the drawing (keyboard/zoom.ts). Enter or Space
 * selects (the details drawer opens), Escape clears the selection and, with nothing selected, returns to the zone
 * around the item. The focus ring keeps its screen size at any scale (the painter's `setScale`). After "Drill in"
 * focus waits on the `<svg>` and goes to the new drawing's tab stop (canvasFocus.ts).
 */
import { select } from 'd3-selection';
import { zoom, zoomIdentity, zoomTransform, type D3ZoomEvent, type ZoomBehavior } from 'd3-zoom';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from 'react';

import './theme/tokens.css';
import './diagram.css';
import './disclosure/disclosure.css';
import type { Rect } from '@gcportrait/layout';

import { Menu, type MenuCloseReason, type MenuItem } from '../ui/Menu';
import { canDrillIn, nodeMenuItems } from './actions';
import {
  easeInOut,
  focusTransform,
  GLIDE_MS,
  glideAt,
  keyboardTransform,
  REVEAL_MS,
  revealTransform,
  zoomStepTransform,
  type JumpMode,
} from './camera';
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
import { computeTrace } from './trace';
import { fitTransform, SCALE_EXTENT, type CameraTransform } from './viewport';

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

/**
 * The part of the canvas a camera jump keeps a node in: the canvas, less a panel over it (`data-canvas-overlay`: the
 * details drawer of a phone or a tablet, AGENTS.md "Product rules") along its whole right edge or its whole lower
 * edge. On a desktop the drawer stands beside the canvas, covers none of it, and the room is the canvas.
 */
function clearRoom(svg: SVGSVGElement): { width: number; height: number } {
  const size = canvasSize(svg);
  const box = svg.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0) return size;
  let { width, height } = size;
  for (const overlay of svg.ownerDocument.querySelectorAll('[data-canvas-overlay]')) {
    if (overlay.closest('[hidden]') !== null) continue;
    const over = overlay.getBoundingClientRect();
    const across = Math.min(box.right, over.right) - Math.max(box.left, over.left);
    const down = Math.min(box.bottom, over.bottom) - Math.max(box.top, over.top);
    if (across <= 0 || down <= 0) continue;
    if (down >= box.height - 1 && over.right >= box.right - 1) width = Math.min(width, over.left - box.left);
    else if (across >= box.width - 1 && over.bottom >= box.bottom - 1)
      height = Math.min(height, over.top - box.top);
  }
  return { width: Math.max(1, width), height: Math.max(1, height) };
}

/** Whether an element shows its focus ring (`:focus-visible`; a browser without the selector shows it always). */
function focusVisible(element: Element): boolean {
  try {
    return element.matches(':focus-visible');
  } catch {
    return true;
  }
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
 * Glides the camera to `to` (camera.ts) in `ms`, frame by frame; at once with reduced motion or without
 * animation frames. A pan or zoom by the person stops it.
 */
function glideTo(
  svg: SVGSVGElement,
  behaviour: ZoomBehavior<SVGSVGElement, unknown>,
  to: CameraTransform,
  ms: number,
): Pick<Glide, 'to' | 'stop' | 'running'> {
  const size = canvasSize(svg);
  const from = zoomTransform(svg);
  const apply = (camera: { x: number; y: number; k: number }): void => {
    behaviour.transform(select(svg), zoomIdentity.translate(camera.x, camera.y).scale(camera.k));
  };
  const view = svg.ownerDocument.defaultView;
  if (prefersReducedMotion(svg) || typeof view?.requestAnimationFrame !== 'function') {
    apply(to);
    return { to, stop: () => undefined, running: () => false };
  }
  let frame = 0;
  let stopped = false;
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    view.cancelAnimationFrame(frame);
    behaviour.on('start.glide', null);
  };
  behaviour.on('start.glide', (event: D3ZoomEvent<SVGSVGElement, unknown>) => {
    // Only the person's own pan or zoom has a source event; the glide's steps have none.
    if (event.sourceEvent !== null && event.sourceEvent !== undefined) stop();
  });
  const begin = view.performance.now();
  const step = (now: number): void => {
    if (stopped) return;
    const t = Math.min(1, Math.max(0, now - begin) / ms);
    apply(glideAt(from, to, easeInOut(t), size.width, size.height));
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
}: DiagramCanvasProps): ReactElement {
  const svgRef = useRef<SVGSVGElement>(null);
  const viewportRef = useRef<SVGGElement>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
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

  // Pan and zoom, set up once per <svg>: the transform goes straight onto the viewport group. A layout effect,
  // like the fit below (which needs the behaviour), so the first frame the browser paints is already fitted.
  useLayoutEffect(() => {
    const svg = svgRef.current;
    const viewport = viewportRef.current;
    if (svg === null || viewport === null) return undefined;
    const behaviour = zoom<SVGSVGElement, unknown>()
      .scaleExtent([...SCALE_EXTENT])
      .extent((): [[number, number], [number, number]] => {
        const size = canvasSize(svg);
        return [
          [0, 0],
          [size.width, size.height],
        ];
      })
      .on('zoom', (event: D3ZoomEvent<SVGSVGElement, unknown>) => {
        viewport.setAttribute('transform', event.transform.toString());
        applyLevelOfDetail(svg, event.transform.k);
        // The focus ring keeps its screen size below 100 %.
        painterRef.current?.setScale(event.transform.k);
      });
    const selection = select(svg);
    selection.call(behaviour).on('dblclick.zoom', null);
    zoomRef.current = behaviour;
    return () => {
      selection.on('.zoom', null);
      zoomRef.current = null;
    };
  }, []);

  // A chip expanded or a zone collapsed here: the drawing with that flip keeps the camera where it was
  // (the fit below leaves it) and glides 200 ms to frame the zone; after a flip from the keyboard, focus follows
  // the zone (the painter effect). Before the fit, which it tells to keep the camera.
  useLayoutEffect(() => {
    const pending = flipRef.current;
    if (pending === null || pending.model === model) return;
    flipRef.current = null;
    const svg = svgRef.current;
    const behaviour = zoomRef.current;
    const rect = model.input.layout.rects[pending.id];
    if (svg === null || behaviour === null || rect === undefined || !isFlipDrawn(pending, rect)) return;
    keepCameraRef.current = model;
    if (pending.keyboard) focusAfterRef.current = pending.id;
    const size = canvasSize(svg);
    const to = flipTransform(rect, size.width, size.height, zoomTransform(svg), pending.wasChip);
    glideRef.current?.stop();
    glideRef.current = { id: pending.id, mode: 'centre', ...glideTo(svg, behaviour, to, FLIP_GLIDE_MS) };
  }, [model]);

  // Fit the whole drawing whenever its frame changes (a new view); a theme or selection change keeps the camera,
  // and so does the drawing of a flip made here (above). d3-zoom applies the transform synchronously, so the
  // viewport carries it before the first paint. A glide still on its way (a keyboard move's pan, made just
  // before a drill-in) was heading for a place in the previous drawing: it stops, so it cannot carry the camera
  // off the new one; a jump waiting for this drawing glides afterwards.
  useLayoutEffect(() => {
    const svg = svgRef.current;
    const behaviour = zoomRef.current;
    if (svg === null || behaviour === null || keepCameraRef.current === modelRef.current) return;
    glideRef.current?.stop();
    glideRef.current = null;
    const size = canvasSize(svg);
    const fit = fitTransform(
      { x: frame.x, y: frame.y, width: frame.width, height: frame.height },
      size.width,
      size.height,
    );
    behaviour.transform(select(svg), zoomIdentity.translate(fit.x, fit.y).scale(fit.k));
  }, [frame.x, frame.y, frame.width, frame.height]);

  // The painter and the pointer and keyboard listeners, once per drawing. A theme or settings change re-renders
  // the same elements, so the old painter takes its marks off first (cleanup) and the new one paints the
  // selection and the keyboard focus again; a hover waits for the pointer's next move.
  useEffect(() => {
    const svg = svgRef.current;
    if (svg === null) return undefined;
    const painter = createPainter(svg, model);
    painterRef.current = painter;
    painter.setScale(zoomTransform(svg).k);
    painter.select(selectionRef.current);
    const active = svg.ownerDocument.activeElement;
    const focusedId = active !== null && svg.contains(active) ? nodeIdOf(active) : null;
    if (active !== null && focusedId !== null) {
      painter.setTabStop(focusedId);
      painter.focus(focusVisible(active) ? focusedId : null);
    }
    let pressed: { x: number; y: number } | null = null;
    let hovered: string | null = null;
    const hover = (id: string | null): void => {
      painter.hover(id);
      if (id === hovered) return;
      hovered = id;
      onHoverRef.current?.(id);
    };
    const onPointerOver = (event: Event): void => {
      hover(nodeIdOf(event.target));
    };
    const onPointerLeave = (): void => {
      hover(null);
    };
    const onPointerDown = (event: PointerEvent): void => {
      pressed = { x: event.clientX, y: event.clientY };
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
      const behaviour = zoomRef.current;
      if (behaviour === null) return;
      // The person moved on: a glide still on its way (a search hit's) stops where it is, and the camera pans
      // from there.
      glideRef.current?.stop();
      const size = clearRoom(svg);
      const to = keyboardTransform(revealBox(rect), size.width, size.height, zoomTransform(svg));
      if (to === null) return;
      glideRef.current = { id, mode: 'reveal', ...glideTo(svg, behaviour, to, REVEAL_MS) };
    };
    // The zoom keys: one step in or out about the focused item (about the canvas's centre from the canvas
    // itself), keeping the item in view; `0` fits the whole drawing, as a new view opens.
    const zoomBy = (key: ZoomKey, focusedId: string | null): void => {
      const behaviour = zoomRef.current;
      const drawn = frameRef.current;
      if (behaviour === null) return;
      const size = canvasSize(svg);
      // Pressed again while the last glide is on its way: one more step from where that glide ends, so quick
      // presses add up.
      const running = glideRef.current;
      const current = running !== null && running.running() ? running.to : zoomTransform(svg);
      let to: CameraTransform | null;
      if (key === 'fit') {
        if (drawn === null) return;
        to = fitTransform(drawn, size.width, size.height);
      } else {
        const rect = focusedId === null ? undefined : model.input.layout.rects[focusedId];
        to = zoomStepTransform(
          current,
          key === 'in' ? 1 : -1,
          rect === undefined ? null : revealBox(rect),
          size.width,
          size.height,
        );
      }
      if (to === null) return;
      glideRef.current?.stop();
      glideRef.current = { id: focusedId ?? '', mode: 'reveal', ...glideTo(svg, behaviour, to, REVEAL_MS) };
    };
    // The drawing's tab stop (a node, or an open zone's collapse button), by its node id.
    const tabStopId = (): string | null =>
      nodeIdOf(svg.querySelector('.dg-zones [tabindex="0"], .dg-nodes [tabindex="0"]'));
    const onClick = (event: MouseEvent): void => {
      // The console action is a link of its own: it opens its page (a new tab) and changes nothing here.
      if (isConsoleAction(event.target)) return;
      // A drag pans the canvas; only a click that stayed put selects.
      const moved = pressed !== null && Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) > 4;
      pressed = null;
      if (moved) return;
      const flipped = flipTarget(event.target);
      if (flipped !== null) {
        // A double-click (reserved for drill-in) does not flip back what its first click flipped.
        if (event.detail <= 1) {
          clickFlipRef.current = flipped;
          flip(flipped, false);
        }
        return;
      }
      clickFlipRef.current = null;
      onSelectRef.current(nodeIdOf(event.target));
    };
    const onContextMenu = (event: MouseEvent): void => {
      const id = nodeIdOf(event.target);
      if (id === null) return;
      event.preventDefault();
      onSelectRef.current(id);
      openMenuRef.current(id, { x: event.clientX, y: event.clientY });
    };
    // A double-click on a container drills into it, as the menu's "Drill in" does (`onDrillIn`).
    const onDoubleClick = (event: MouseEvent): void => {
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
    // Fitted (the layout effects ran first) and now interactive: what the tests and the e2e suite wait for.
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
  // view or a centring glide is already on its way to the node.
  useEffect(() => {
    if (jump === null || jump === undefined) return;
    const svg = svgRef.current;
    const behaviour = zoomRef.current;
    const rect = model.input.layout.rects[jump.id];
    if (svg === null || behaviour === null || rect === undefined) return;
    const mode = jump.mode ?? 'centre';
    const size = clearRoom(svg);
    const current = zoomTransform(svg);
    const running = glideRef.current;
    const centring = running?.mode === 'centre' && running.id === jump.id && running.running();
    const to =
      mode === 'centre'
        ? focusTransform(rect, size.width, size.height, current)
        : centring
          ? null
          : revealTransform(rect, traceExtent(model, jump.id, rect), size.width, size.height, current);
    if (to !== null) {
      running?.stop();
      const glide = glideTo(svg, behaviour, to, mode === 'centre' ? GLIDE_MS : REVEAL_MS);
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
      <p className="visually-hidden" role="status">
        {status}
      </p>
    </>
  );
}
