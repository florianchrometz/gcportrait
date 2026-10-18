// SPDX-License-Identifier: Apache-2.0
/**
 * Stage 1: forest normalisation (the package README's "Pipeline"). Turns the Scene tree into the layout's own
 * mutable node tree: drops an organisation zone (the canvas is the organisation), computes each node's depth
 * from the canvas, decides how each node is drawn (open zone, chip, empty zone, card), validates what the
 * layout relies on (unique ids, edge endpoints present, a real tree, chips without children, nesting within
 * `MAX_SCENE_DEPTH`) and sorts every child list in the deterministic sibling order.
 */
import type { ChipCounts, Scene, SceneNode, ZoneKind } from '@gcportrait/model';
import { MAX_SCENE_DEPTH } from './constants.js';
import { LayoutInputError } from './errors.js';
import { compareCodePoints, compareSiblings } from './order.js';
import type { RectRole } from './types.js';

/** A Resource Manager organisation node id: such a zone at the top level is the canvas itself. */
const ORGANISATION_ID = /^\/\/cloudresourcemanager\.googleapis\.com\/organizations\/[^/]+$/;

/** One Scene node as the later stages see it. Sizes and positions are filled in by stages 2 and 3. */
export interface LayoutNode {
  readonly id: string;
  readonly type: 'zone' | 'card';
  readonly kind: ZoneKind | 'card';
  readonly role: RectRole;
  readonly label: string;
  readonly subtitle: string | undefined;
  readonly badges: readonly string[];
  /** A chip's counts (what its count line says); undefined for every other node. */
  readonly counts: ChipCounts | undefined;
  /**
   * Depth from the canvas: the canvas (the organisation, or the drill-in root) is 0, so root folders and loose
   * projects are 1. Header height, title size and the nested tint follow from it (skill §3, style §2–§4).
   */
  readonly depth: number;
  readonly parent: LayoutNode | null;
  /** Sorted in sibling order. */
  readonly children: LayoutNode[];
  width: number;
  height: number;
  chipCountLine?: string;
  headerHeight: number;
  padding: number;
  /** Narrowest width the header needs (open zones), from stage 2. */
  minWidth: number;
  /** Extra padding on single sides (open zones; the router's `ringSides`), from stage 2. */
  extra: { top: number; right: number; bottom: number; left: number };
  /** Position: relative to the parent's content origin after stage 3, absolute after placement. */
  x: number;
  y: number;
  /** The node's position in `NormalisedScene.order` (pre-order over the sorted tree). */
  index: number;
}

export interface NormalisedScene {
  /** The top-level nodes (the canvas's children), sorted. */
  readonly roots: LayoutNode[];
  /** Every node in pre-order over the sorted tree (parents before children). */
  readonly order: LayoutNode[];
  /** Ids of organisation zones that were unwrapped. */
  readonly droppedOrganisations: readonly string[];
  /** Edges with an end at a dropped organisation zone (the canvas), which no route can reach. */
  readonly edgesAtCanvas: number;
  readonly edgeCount: number;
}

function roleOf(node: SceneNode): RectRole {
  if (node.type === 'card') return 'card';
  if (node.collapsed !== undefined) return 'chip';
  return node.children.length === 0 ? 'empty' : 'zone';
}

export function normaliseScene(scene: Scene): NormalisedScene {
  const seen = new Map<string, SceneNode>();
  const path: SceneNode[] = [];
  const onPath = new Set<SceneNode>();

  // Validate the whole tree first (ids, cycles, chips, depth), so a refused Scene is refused before any work.
  // The recursion stops at MAX_SCENE_DEPTH, so validation itself cannot overflow the stack.
  const visit = (nodes: readonly SceneNode[]): void => {
    for (const node of nodes) {
      if (path.length >= MAX_SCENE_DEPTH) {
        const ids = [...path.slice(0, 1).map((entry) => entry.id), node.id];
        throw new LayoutInputError(
          'too-deep',
          ids,
          `the Scene nests deeper than ${String(MAX_SCENE_DEPTH)} levels: ${ids.join(' › … › ')}`,
        );
      }
      if (onPath.has(node)) {
        const from = path.indexOf(node);
        const ids = [...path.slice(from).map((entry) => entry.id), node.id];
        throw new LayoutInputError('cycle', ids, `the Scene tree contains itself: ${ids.join(' › ')}`);
      }
      if (seen.has(node.id)) {
        throw new LayoutInputError('duplicate-id', [node.id], `two Scene nodes have the id ${node.id}`);
      }
      seen.set(node.id, node);
      if (node.type === 'zone') {
        if (node.collapsed !== undefined && node.children.length > 0) {
          throw new LayoutInputError(
            'collapsed-with-children',
            [node.id, ...node.children.map((child) => child.id)],
            `the collapsed zone ${node.id} still has children in the Scene`,
          );
        }
        path.push(node);
        onPath.add(node);
        visit(node.children);
        onPath.delete(node);
        path.pop();
      }
    }
  };
  visit(scene.children);

  for (const edge of scene.edges) {
    const missing = [edge.from, edge.to].filter((id) => !seen.has(id));
    if (missing.length > 0) {
      throw new LayoutInputError(
        'unknown-endpoint',
        [edge.from, edge.to],
        `the ${edge.kind} edge ${edge.from} → ${edge.to} names ${missing.join(' and ')}, which the Scene does not hold`,
      );
    }
  }

  // Unwrap organisation zones at the top level: their children become the canvas's children.
  const droppedOrganisations: string[] = [];
  const topLevel: SceneNode[] = [];
  for (const node of scene.children) {
    if (node.type === 'zone' && ORGANISATION_ID.test(node.id)) {
      droppedOrganisations.push(node.id);
      topLevel.push(...node.children);
    } else {
      topLevel.push(node);
    }
  }
  // Sorted, so the report does not depend on the order the Scene lists its top level in.
  droppedOrganisations.sort(compareCodePoints);
  const dropped = new Set(droppedOrganisations);
  const edgesAtCanvas = scene.edges.filter((edge) => dropped.has(edge.from) || dropped.has(edge.to)).length;

  const build = (node: SceneNode, parent: LayoutNode | null, depth: number): LayoutNode => {
    const layoutNode: LayoutNode = {
      id: node.id,
      type: node.type,
      kind: node.type === 'zone' ? node.kind : 'card',
      role: roleOf(node),
      label: node.label,
      subtitle: node.subtitle,
      badges: node.type === 'zone' ? node.badges : [],
      counts: node.type === 'zone' ? node.collapsed : undefined,
      depth,
      parent,
      children: [],
      width: 0,
      height: 0,
      headerHeight: 0,
      padding: 0,
      minWidth: 0,
      extra: { top: 0, right: 0, bottom: 0, left: 0 },
      x: 0,
      y: 0,
      index: -1,
    };
    if (node.type === 'zone') {
      for (const child of node.children) layoutNode.children.push(build(child, layoutNode, depth + 1));
      layoutNode.children.sort(compareSiblings);
    }
    return layoutNode;
  };
  const roots = topLevel.map((node) => build(node, null, 1)).sort(compareSiblings);

  const order: LayoutNode[] = [];
  const collect = (nodes: readonly LayoutNode[]): void => {
    for (const node of nodes) {
      node.index = order.length;
      order.push(node);
      collect(node.children);
    }
  };
  collect(roots);

  return { roots, order, droppedOrganisations, edgesAtCanvas, edgeCount: scene.edges.length };
}
