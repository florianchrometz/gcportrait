// SPDX-License-Identifier: MIT
/**
 * Highlight painting (skill gcp-diagram-style §6; ADR 0035 §5: highlight changes mutate attributes only, never
 * re-layout). The selection trace (trace.ts) of the selected node stays painted until the selection changes:
 * the zones on its path to the root get an `accent.path` ring on their border, its traced lines (the lines
 * touching it or anything inside it, and its `routes`/`connects` chain) are shown again on top in
 * `accent.select`, the nodes they reach get a thin `accent.select` ring, and the legend shows its trace column.
 * The selected node itself gets the pulsing `accent.select` ring and, when it has one, the "Open in Cloud
 * Console ↗" action in its top-right corner, inside it, a tab stop after it.
 *
 * Hover previews the same trace for the node under the pointer without touching the selection; the hovered node
 * also gets a path ring of its own (it is where the path starts). With a selection, only cards, chips and
 * card-sized zones preview: the pointer is almost always over some open zone, and its preview would hide the
 * selection's trace whenever the pointer rests on the canvas. Keyboard focus draws the focus ring around the
 * focused node, an open zone included (its collapse button has focus, and its plate shrinks with the camera;
 * the ring around the zone does not): the canvas tells the painter the camera's scale (`setScale`), and below
 * 100 % the ring keeps its 2 px line and gaps in screen pixels (marks.ts, `focusRingPlacement`).
 *
 * Everything here toggles classes and sets attributes on elements the drawing already holds, with one exception:
 * the traced lines on top, which the painter makes for the lines it traces, cloned from the drawing's hidden
 * prototype of their relation kind (before, the drawing held a hidden copy of every line), and takes out of
 * the document again when they are no longer traced. Nothing re-renders. Ids, not elements, carry the state, so a
 * painter for a new drawing (a theme change, a new layout) paints the same selection again.
 *
 * React leaves those classes and attributes alone when it re-renders the same drawing (a theme or settings
 * change keeps every element), so a painter takes its marks off again when it is disposed, and a new painter
 * starts by clearing whatever an earlier one may have left on the elements it is given.
 */
import type { LayoutRect } from '@gcportrait/layout';

import { consoleActionOf } from './actions';
import { COLLAPSE_CLASS, COLLAPSE_ZONE_ATTRIBUTE } from './disclosure/CollapseButton';
import {
  consoleActionAnchor,
  consoleActionExpands,
  focusRingPlacement,
  reachPathData,
  ringPlacement,
  SELECT_DISTANCE,
  type RingPlacement,
} from './marks';
import { edgeGeometry, TRACED_LAYER_CLASS, TRACED_PROTOTYPE_CLASS } from './Drawing';
import type { DiagramEdge, DiagramModel } from './model';
import { FOCUS_WIDTH, RING_GAP } from './theme/styles';
import { computeTrace, type Trace } from './trace';

export interface Painter {
  /** The node under the pointer, or null. */
  hover(id: string | null): void;
  /** The selected node, or null. */
  select(id: string | null): void;
  /** Pulses the selection ring again (a search hit on the node already selected). */
  pulse(): void;
  /** The node with keyboard focus (focus ring), or null. */
  focus(id: string | null): void;
  /** The camera's scale (CSS px per drawing unit): below 1 the focus ring keeps its screen size. */
  setScale(scale: number): void;
  /** Makes the node the one tab stop of the drawing (roving tab index). */
  setTabStop(id: string): void;
  /** Takes every mark this painter made off the drawing: hover, selection, trace, focus ring and its tab stop. */
  dispose(): void;
  readonly hovered: string | null;
  readonly selected: string | null;
  /** The node whose trace is on screen: the selection, or a hover's preview; null for none. */
  readonly traced: string | null;
}

function escapeAttribute(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}

/** Places a ring group's band and line on an outline, or hides the group. */
function placeRing(group: Element | null | undefined, at: RingPlacement | null): void {
  if (group === null || group === undefined) return;
  if (at === null) {
    group.setAttribute('display', 'none');
    return;
  }
  for (const element of Array.from(group.children)) {
    element.setAttribute('x', String(at.x));
    element.setAttribute('y', String(at.y));
    element.setAttribute('width', String(at.width));
    element.setAttribute('height', String(at.height));
    element.setAttribute('rx', String(at.rx));
  }
  group.removeAttribute('display');
}

/** Sets the focus ring's band (its canvas gaps) and line widths (the drawing's own: `Drawing.tsx` FocusMark). */
function setFocusRingWidths(group: Element | null, band: number, line: number): void {
  if (group === null) return;
  group.querySelector('.dg-ring-gap')?.setAttribute('stroke-width', String(band));
  group.querySelector('.dg-ring')?.setAttribute('stroke-width', String(line));
}

/**
 * The drawing's first tab stop: its first solid node in reading order, where the eye starts. Reading order goes
 * zone by zone, as the arrow keys do (keyboard/navigation.ts): the top-level rects top to bottom, then left to
 * right; the first of them, when it is an open zone, is read from its own first child, and so on down to a solid
 * node; whatever order the layout lists its rects in.
 */
function firstInReadingOrder(model: DiagramModel): string | undefined {
  const drawn = new Set(model.rects.map(([id]) => id));
  const children = new Map<string | null, Array<readonly [string, LayoutRect]>>();
  for (const [id, rect] of model.rects) {
    // A rect whose parent is not drawn is a top-level one.
    const parent = rect.parent !== null && drawn.has(rect.parent) ? rect.parent : null;
    const list = children.get(parent);
    if (list === undefined) children.set(parent, [[id, rect]]);
    else list.push([id, rect]);
  }
  const first = (parent: string | null, depth: number): string | undefined => {
    const list = [...(children.get(parent) ?? [])].sort(([, a], [, b]) => a.y - b.y || a.x - b.x);
    for (const [id, rect] of list) {
      if (rect.role !== 'zone') return id;
      const inside = depth < model.rects.length ? first(id, depth + 1) : undefined;
      if (inside !== undefined) return inside;
    }
    return undefined;
  };
  return first(null, 0);
}

/** The class of a traced line on top, and of one the painter shows (`is-focus`). */
const TRACED_CLASS = 'dg-edge-top';

/** The interactive drawing's marks and scaffolding, found once per painter. */
interface Parts {
  readonly nodes: ReadonlyMap<string, Element>;
  /** The layer the traced lines go into, and its hidden prototype per relation kind. */
  readonly tracedLayer: Element | null;
  readonly prototypes: ReadonlyMap<string, Element>;
  readonly selectRing: Element | null;
  readonly focusRing: Element | null;
  readonly pathRings: readonly Element[];
  readonly reachRings: Element | null;
  readonly legendPanel: Element | null;
  readonly legendTrace: Element | null;
  readonly actions: Element | null;
  readonly action: Element | null;
  readonly variants: { readonly resource: Element | null; readonly project: Element | null };
  /** Open zones' collapse buttons by zone id: a zone's stand-in as the drawing's tab stop. */
  readonly collapse: ReadonlyMap<string, Element>;
}

function findParts(root: Element): Parts {
  const nodes = new Map<string, Element>();
  for (const element of Array.from(root.querySelectorAll('[data-id]'))) {
    const id = element.getAttribute('data-id');
    if (id !== null) nodes.set(id, element);
  }
  const collapse = new Map<string, Element>();
  for (const element of Array.from(root.querySelectorAll(`.${COLLAPSE_CLASS}`))) {
    const id = element.getAttribute(COLLAPSE_ZONE_ATTRIBUTE);
    if (id !== null) collapse.set(id, element);
  }
  const tracedLayer = root.querySelector(`.${TRACED_LAYER_CLASS}`);
  const prototypes = new Map<string, Element>();
  for (const element of Array.from(tracedLayer?.querySelectorAll(`.${TRACED_PROTOTYPE_CLASS}`) ?? [])) {
    const kind = element.getAttribute('data-kind');
    if (kind !== null) prototypes.set(kind, element);
  }
  return {
    nodes,
    tracedLayer,
    prototypes,
    selectRing: root.querySelector('.dg-select-ring'),
    focusRing: root.querySelector('.dg-focus-ring'),
    pathRings: Array.from(root.querySelectorAll('.dg-path-ring')),
    reachRings: root.querySelector('.dg-reach-rings'),
    legendPanel: root.querySelector('.dg-legend-panel'),
    legendTrace: root.querySelector('.dg-legend-trace'),
    actions: root.querySelector('.dg-actions'),
    action: root.querySelector('.dg-console-action'),
    variants: {
      resource: root.querySelector('.dg-console-resource'),
      project: root.querySelector('.dg-console-project'),
    },
    collapse,
  };
}

/** Shows or hides the legend's trace column, widening the panel to its size with the column. */
function showLegendTrace(parts: Parts, shown: boolean): void {
  const { legendPanel, legendTrace } = parts;
  if (legendPanel === null || legendTrace === null) return;
  const width = legendPanel.getAttribute(shown ? 'data-trace-width' : 'data-width');
  const height = legendPanel.getAttribute(shown ? 'data-trace-height' : 'data-height');
  if (width !== null) legendPanel.setAttribute('width', width);
  if (height !== null) legendPanel.setAttribute('height', height);
  if (shown) legendTrace.removeAttribute('display');
  else legendTrace.setAttribute('display', 'none');
}

/** Hides the console action and takes its link, name, place and tab stop off. */
function hideAction(parts: Parts): void {
  parts.actions?.setAttribute('display', 'none');
  const { action } = parts;
  if (action === null) return;
  for (const name of ['href', 'aria-label', 'transform', 'data-expand']) action.removeAttribute(name);
  action.setAttribute('tabindex', '-1');
}

/**
 * Clears what any painter may have left on a drawing: the hover, trace and selection classes, `aria-pressed`,
 * the tab stop, the traced copies, the rings, the legend's trace column and the console action. Classes and
 * attributes only, like the painting itself.
 */
function clearMarks(parts: Parts): void {
  for (const element of parts.nodes.values()) {
    element.classList.remove('is-path', 'is-selected', 'is-reached');
    if (element.getAttribute('aria-pressed') === 'true') element.setAttribute('aria-pressed', 'false');
    if (element.getAttribute('tabindex') === '0') element.setAttribute('tabindex', '-1');
  }
  for (const button of parts.collapse.values())
    if (button.getAttribute('tabindex') === '0') button.setAttribute('tabindex', '-1');
  // Traced lines an earlier painter of this drawing left (React keeps the layer across a theme change).
  for (const element of Array.from(parts.tracedLayer?.querySelectorAll(`.${TRACED_CLASS}`) ?? []))
    element.remove();
  for (const ring of [parts.selectRing, parts.focusRing, ...parts.pathRings]) {
    ring?.setAttribute('display', 'none');
    ring?.classList.remove('is-pulsing');
  }
  setFocusRingWidths(parts.focusRing, FOCUS_WIDTH + 2 * RING_GAP, FOCUS_WIDTH);
  parts.reachRings?.setAttribute('display', 'none');
  for (const path of Array.from(parts.reachRings?.children ?? [])) path.removeAttribute('d');
  showLegendTrace(parts, false);
  hideAction(parts);
}

/**
 * The traced line of `edge`: its kind's prototype cloned, with the line's path data and only the heads the
 * line draws (a traced copy draws its own heads, even a bundle's shared one), shown (`is-focus`); null without a
 * prototype of its kind.
 */
function tracedCopy(parts: Parts, edge: DiagramEdge): Element | null {
  const prototype = parts.prototypes.get(edge.path.kind);
  if (prototype === undefined) return null;
  const copy = prototype.cloneNode(true);
  if (!(copy instanceof Element)) return null;
  const own = edgeGeometry(edge, false);
  copy.setAttribute('class', `${TRACED_CLASS} is-focus`);
  copy.setAttribute('data-edge', edge.key);
  copy.removeAttribute('data-kind');
  copy.removeAttribute('display');
  for (const path of Array.from(copy.children)) path.setAttribute('d', own.d);
  const line = copy.querySelector('.dg-edge');
  if (!own.start) line?.removeAttribute('marker-start');
  if (!own.end) line?.removeAttribute('marker-end');
  return copy;
}

export function createPainter(root: Element, model: DiagramModel): Painter {
  const parts = findParts(root);
  const { nodes } = parts;
  clearMarks(parts);
  // The lines by key in drawing order, and the traced copies made so far (kept out of the document while not
  // traced, so tracing a line again only puts its copy back).
  const lines = new Map(model.lines.map((edge, index) => [edge.key, { edge, index }] as const));
  const copies = new Map<string, Element | null>();
  const copyOf = (key: string): Element | null => {
    if (!copies.has(key)) {
      const line = lines.get(key);
      copies.set(key, line === undefined ? null : tracedCopy(parts, line.edge));
    }
    return copies.get(key) ?? null;
  };

  let hovered: string | null = null;
  let selected: string | null = null;
  let traced: { readonly id: string; readonly preview: boolean } | null = null;
  let pathNodes: string[] = [];
  let reachedNodes: readonly string[] = [];
  let focusedEdges: readonly string[] = [];
  let tabStop: string | null = null;
  let focused: string | null = null;
  let scale = 1;
  const traces = new Map<string, Trace | null>();

  const rectOf = (id: string): LayoutRect | undefined => model.input.layout.rects[id];
  const isSolid = (id: string): boolean => {
    const rect = rectOf(id);
    return rect !== undefined && rect.role !== 'zone';
  };
  const traceOf = (id: string): Trace | null => {
    if (!traces.has(id)) traces.set(id, computeTrace(model.trace, id));
    return traces.get(id) ?? null;
  };

  /** Whose trace to show: a hover's preview, else the selection's. */
  const wanted = (): { readonly id: string; readonly preview: boolean } | null => {
    if (hovered !== null && hovered !== selected && (selected === null || isSolid(hovered)))
      return { id: hovered, preview: true };
    return selected === null ? null : { id: selected, preview: false };
  };

  const paintTrace = (): void => {
    const next = wanted();
    if (next?.id === traced?.id && next?.preview === traced?.preview) return;
    for (const id of pathNodes) nodes.get(id)?.classList.remove('is-path');
    for (const id of reachedNodes) nodes.get(id)?.classList.remove('is-reached');
    for (const key of focusedEdges) copies.get(key)?.remove();
    traced = next;
    const trace = next === null ? null : traceOf(next.id);
    // The hovered node starts its own path; a selected node has the selection ring instead.
    pathNodes =
      trace === null || next === null
        ? []
        : next.preview
          ? [next.id, ...trace.ancestors]
          : [...trace.ancestors];
    reachedNodes = trace?.reached ?? [];
    focusedEdges = trace?.edges ?? [];
    for (const id of pathNodes) nodes.get(id)?.classList.add('is-path');
    for (const id of reachedNodes) nodes.get(id)?.classList.add('is-reached');
    // The traced lines in drawing order, after the prototypes (a later line over an earlier one, as drawn).
    const layer = parts.tracedLayer;
    if (layer !== null) {
      const ordered = [...focusedEdges].sort(
        (a, b) => (lines.get(a)?.index ?? 0) - (lines.get(b)?.index ?? 0),
      );
      for (const key of ordered) {
        const copy = copyOf(key);
        if (copy !== null) layer.appendChild(copy);
      }
    }
    // One path ring per node of the path, on its border; the rest stay hidden.
    parts.pathRings.forEach((ring, index) => {
      const id = pathNodes[index];
      const rect = id === undefined ? undefined : rectOf(id);
      placeRing(ring, rect === undefined ? null : ringPlacement(rect, 0));
    });
    const reach = parts.reachRings;
    if (reach !== null) {
      const rects = reachedNodes.flatMap((id) => {
        const rect = rectOf(id);
        return rect === undefined ? [] : [rect];
      });
      if (rects.length === 0) {
        reach.setAttribute('display', 'none');
        for (const path of Array.from(reach.children)) path.removeAttribute('d');
      } else {
        const d = reachPathData(rects);
        for (const path of Array.from(reach.children)) path.setAttribute('d', d);
        reach.removeAttribute('display');
      }
    }
  };

  /**
   * The console action in the selected node's top-right corner, inside it, when it has one (style skill §6);
   * never opened from here. `data-expand` says whether its labelled pill fits inside the node (the stylesheet
   * shows it on hover and keyboard focus); otherwise it stays icon-only, named and with its tooltip.
   */
  const placeAction = (): void => {
    const rect = selected === null ? undefined : rectOf(selected);
    const action = selected === null ? undefined : consoleActionOf(model, selected);
    const { action: link, variants } = parts;
    if (rect === undefined || action === undefined || link === null) {
      hideAction(parts);
      return;
    }
    const shown = action.kind === 'resource' ? variants.resource : variants.project;
    const other = action.kind === 'resource' ? variants.project : variants.resource;
    shown?.removeAttribute('display');
    other?.setAttribute('display', 'none');
    const width = Number(shown?.getAttribute('data-width') ?? 'Infinity');
    const at = consoleActionAnchor(rect);
    link.setAttribute('href', action.href);
    link.setAttribute('aria-label', action.name);
    link.setAttribute('data-expand', consoleActionExpands(rect, width) ? 'true' : 'false');
    link.setAttribute('transform', `translate(${String(at.x)} ${String(at.y)})`);
    // A tab stop after the selected node (DOM order: the action comes after every node).
    link.setAttribute('tabindex', '0');
    parts.actions?.removeAttribute('display');
  };

  // The element that holds a node's tab stop: the node itself, or an open zone's collapse button.
  const tabTarget = (id: string): Element | undefined =>
    rectOf(id)?.role === 'zone' ? parts.collapse.get(id) : nodes.get(id);
  const setTabStop = (id: string): void => {
    const target = nodes.has(id) ? tabTarget(id) : undefined;
    if (target === undefined) return;
    if (tabStop !== null) tabTarget(tabStop)?.setAttribute('tabindex', '-1');
    target.setAttribute('tabindex', '0');
    tabStop = id;
  };
  const firstSolid = firstInReadingOrder(model);
  if (firstSolid !== undefined) setTabStop(firstSolid);

  // The focus ring around the focused node, a card or an open zone, at the camera's scale.
  const paintFocus = (): void => {
    const rect = focused === null ? undefined : rectOf(focused);
    if (rect === undefined) {
      placeRing(parts.focusRing, null);
      setFocusRingWidths(parts.focusRing, FOCUS_WIDTH + 2 * RING_GAP, FOCUS_WIDTH);
      return;
    }
    const at = focusRingPlacement(rect, scale);
    placeRing(parts.focusRing, at);
    setFocusRingWidths(parts.focusRing, at.band, at.line);
  };

  const painter: Painter = {
    get hovered() {
      return hovered;
    },
    get selected() {
      return selected;
    },
    get traced() {
      return traced?.id ?? null;
    },
    hover(id) {
      const next = id !== null && nodes.has(id) ? id : null;
      if (next === hovered) return;
      hovered = next;
      paintTrace();
    },
    select(id) {
      const next = id !== null && nodes.has(id) ? id : null;
      if (next === selected) return;
      if (selected !== null) {
        const previous = nodes.get(selected);
        previous?.classList.remove('is-selected');
        if (previous?.hasAttribute('aria-pressed') === true) previous.setAttribute('aria-pressed', 'false');
      }
      selected = next;
      paintTrace();
      placeAction();
      showLegendTrace(parts, next !== null);
      const { selectRing } = parts;
      const rect = next === null ? undefined : rectOf(next);
      if (next === null || rect === undefined) {
        placeRing(selectRing, null);
        selectRing?.classList.remove('is-pulsing');
        return;
      }
      const element = nodes.get(next);
      element?.classList.add('is-selected');
      if (element?.hasAttribute('aria-pressed') === true) element.setAttribute('aria-pressed', 'true');
      setTabStop(next);
      placeRing(selectRing, ringPlacement(rect, SELECT_DISTANCE));
      painter.pulse();
    },
    pulse() {
      const { selectRing } = parts;
      if (selected === null || selectRing === null) return;
      // Restart the two-step pulse: drop the class, let the browser see it gone, add it again.
      selectRing.classList.remove('is-pulsing');
      void selectRing.getBoundingClientRect();
      selectRing.classList.add('is-pulsing');
    },
    focus(id) {
      focused = id !== null && nodes.has(id) ? id : null;
      paintFocus();
    },
    setScale(next) {
      if (!(next > 0) || next === scale) return;
      scale = next;
      if (focused !== null) paintFocus();
    },
    setTabStop,
    dispose() {
      painter.hover(null);
      painter.select(null);
      painter.focus(null);
      if (tabStop !== null) tabTarget(tabStop)?.setAttribute('tabindex', '-1');
      tabStop = null;
    },
  };
  return painter;
}

/**
 * The node an event target belongs to, if any: the node's own element, a `secures` overlay's target (a
 * click on its dashes means its target), or for a timeline ghost, which is no node, the open zone it lies
 * in (`data-in`; none at the top level), as if the pointer were on that zone where the ghost is drawn.
 */
export function nodeIdOf(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  const node = target.closest('[data-id]')?.getAttribute('data-id');
  if (node !== undefined && node !== null) return node;
  const ghost = target.closest('[data-ghost]');
  if (ghost !== null) return ghost.getAttribute('data-in');
  return target.closest('[data-secures]')?.getAttribute('data-secures') ?? null;
}

/** Whether an event target is the console action (its own link: a click there opens it, nothing else). */
export function isConsoleAction(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('.dg-console-action') !== null;
}

/** A node element by id. */
export function nodeElement(root: Element, id: string): Element | null {
  return root.querySelector(`[data-id="${escapeAttribute(id)}"]`);
}
