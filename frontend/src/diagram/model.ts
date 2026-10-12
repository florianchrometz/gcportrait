// SPDX-License-Identifier: MIT
/**
 * What the renderer derives from a Scene and its Layout before drawing: the Scene nodes by id, the rects in
 * paint order with their parents and children, the edges split into lines and `secures` overlays, dim mode, and
 * the indexes the highlight painter walks (ancestor chain, the selection trace's index of the drawn lines), and a
 * timeline day's markers (diff/marks.ts). The ghosts of that day (what the view no longer draws, back in its
 * old place for one day) are kept apart from the rects: they are drawn, but nothing walks, focuses or selects them.
 * Pure: the same Scene and Layout give the same model.
 */
import type { ConsoleLink } from '@gcportrait/catalog';
import type { EdgePath, Layout, LayoutRect } from '@gcportrait/layout';
import type { Scene, SceneNode } from '@gcportrait/model';

import { diffMarks, type DiffMarks } from './diff/marks';
import type { TickDiff } from './diff/types';
import type { DiagramIcons } from './icons';
import { DIM_THRESHOLD, edgeStyleOf, type EdgeStyle } from './theme/styles';
import { traceIndex, type TraceIndex } from './trace';

export interface DiagramInput {
  readonly scene: Scene;
  readonly layout: Layout;
  /** The lens's title from the catalog ("Load balancing"); the lens id when unknown. */
  readonly lensTitle: string;
  /** Zones the Scene report draws as dashed overlays (a perimeter focus), not as tinted zones. */
  readonly overlayZones?: readonly string[];
  /** The icons the drawing needs, resolved where the icon table lives (the data worker; icons.ts). */
  readonly icons: DiagramIcons;
  /**
   * The type names of asset-backed zones by id ("Compute Engine instance group manager"), for their accessible
   * names; a Scene zone carries only its kind. Absent: zones are named by their kind.
   */
  readonly zoneTypes?: Readonly<Record<string, string>>;
  /**
   * The console action of each asset-backed node by id (absent: no action for that node): the catalog engine's
   * `ConsoleLink` (declared once, in `@gcportrait/catalog`), its own console page from the type's
   * `console` template or, for a type without one, its project's console home. The data worker works it out
   * (it holds the assets and the catalog); the page only shows it.
   */
  readonly consoleLinks?: Readonly<Record<string, ConsoleLink>>;
  /**
   * The drawn day compared with the day on screen before it (the data worker's `TickDiff`, sent with the
   * Scene, whose ghosts it lists). Absent: no markers.
   */
  readonly diff?: TickDiff;
}

export interface DiagramEdge {
  /** The layout's edge id, `<from> -<kind>-> <to>`. */
  readonly key: string;
  readonly path: EdgePath;
  readonly style: EdgeStyle;
}

export interface DiagramModel {
  readonly input: DiagramInput;
  readonly nodes: ReadonlyMap<string, SceneNode>;
  /** Every rect in paint order (parents before children), the ghosts left out. */
  readonly rects: ReadonlyArray<readonly [string, LayoutRect]>;
  /** The ghosts' rects in paint order: drawn, never walked, focused or selected. */
  readonly ghosts: ReadonlyArray<readonly [string, LayoutRect]>;
  /** The timeline markers of the drawn day, or null without a diff. */
  readonly diff: DiffMarks | null;
  readonly parent: ReadonlyMap<string, string | null>;
  readonly children: ReadonlyMap<string, readonly string[]>;
  /** Edges drawn as lines, in the layout's order. */
  readonly lines: readonly DiagramEdge[];
  /** `secures` edges, drawn as a dashed overlay around their target. */
  readonly overlayEdges: readonly DiagramEdge[];
  /** More than `DIM_THRESHOLD` lines: unfocused lines are dimmed (skill §5). */
  readonly dim: boolean;
  /** Edge keys by the rect at either end. */
  readonly edgesAt: ReadonlyMap<string, readonly string[]>;
  readonly overlayZones: ReadonlySet<string>;
  /** The longest ancestor chain (a node and every zone around it): how many path rings a trace can need. */
  readonly deepestChain: number;
  /** The selection trace's index of the rects' nesting and the drawn lines (trace.ts). */
  readonly trace: TraceIndex;
}

function collectNodes(nodes: readonly SceneNode[], into: Map<string, SceneNode>): void {
  for (const node of nodes) {
    into.set(node.id, node);
    if (node.type === 'zone') collectNodes(node.children, into);
  }
}

export function buildDiagramModel(input: DiagramInput): DiagramModel {
  const nodes = new Map<string, SceneNode>();
  collectNodes(input.scene.children, nodes);
  const diff = diffMarks(input.diff, input.layout, input.scene.metadata.readTime);
  const isGhost = (id: string): boolean => diff?.ghosts.has(id) === true;
  const all = Object.entries(input.layout.rects);
  const rects = all.filter(([id]) => !isGhost(id));
  const ghosts = all.filter(([id]) => isGhost(id));
  const parent = new Map<string, string | null>();
  const children = new Map<string, string[]>();
  for (const [id, rect] of rects) {
    parent.set(id, rect.parent);
    if (rect.parent !== null) {
      const list = children.get(rect.parent);
      if (list === undefined) children.set(rect.parent, [id]);
      else list.push(id);
    }
  }
  const lines: DiagramEdge[] = [];
  const overlayEdges: DiagramEdge[] = [];
  const edgesAt = new Map<string, string[]>();
  for (const [key, path] of Object.entries(input.layout.edges)) {
    const style = edgeStyleOf(path.kind);
    const edge: DiagramEdge = { key, path, style };
    if (style.overlay === true) {
      overlayEdges.push(edge);
      continue;
    }
    lines.push(edge);
    for (const end of [path.from, path.to]) {
      const list = edgesAt.get(end);
      if (list === undefined) edgesAt.set(end, [key]);
      else list.push(key);
    }
  }
  const chainLength = new Map<string, number>();
  const lengthOf = (id: string): number => {
    const known = chainLength.get(id);
    if (known !== undefined) return known;
    // Walk up to the first known (or the top), then fill the lengths in on the way back down.
    const path: string[] = [];
    let current: string | null | undefined = id;
    while (
      current !== null &&
      current !== undefined &&
      !chainLength.has(current) &&
      path.length <= rects.length
    ) {
      path.push(current);
      current = parent.get(current);
    }
    let length = current === null || current === undefined ? 0 : (chainLength.get(current) ?? 0);
    for (const step of path.reverse()) {
      length += 1;
      chainLength.set(step, length);
    }
    return length;
  };
  const deepestChain = rects.reduce((deepest, [id]) => Math.max(deepest, lengthOf(id)), 0);
  return {
    input,
    nodes,
    rects,
    ghosts,
    diff,
    parent,
    children,
    lines,
    overlayEdges,
    dim: lines.length > DIM_THRESHOLD,
    edgesAt,
    overlayZones: new Set(input.overlayZones ?? []),
    deepestChain,
    trace: traceIndex(
      parent,
      lines.map((edge) => ({ key: edge.key, from: edge.path.from, to: edge.path.to, kind: edge.path.kind })),
    ),
  };
}

/** The node and every zone around it, innermost first. */
export function ancestorChain(model: DiagramModel, id: string): string[] {
  const chain: string[] = [];
  let current: string | null | undefined = model.parent.has(id) ? id : undefined;
  while (current !== null && current !== undefined && chain.length <= model.rects.length) {
    chain.push(current);
    current = model.parent.get(current);
  }
  return chain;
}

/** Cards, chips and card-sized zones: the solid nodes a keyboard user tabs to, in paint order. */
export function solidIds(model: DiagramModel): string[] {
  return model.rects.flatMap(([id, rect]) => (rect.role === 'zone' ? [] : [id]));
}
