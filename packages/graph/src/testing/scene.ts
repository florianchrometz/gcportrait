// SPDX-License-Identifier: MIT
/** Test helpers to read a Scene: every node with its zone and depth, children, edges. Not part of the public API. */
import type { Scene, SceneCard, SceneEdge, SceneNode, SceneZone } from '@gcportrait/model';

export interface Placed {
  readonly node: SceneNode;
  /** The enclosing zone's id; undefined at the top level. */
  readonly parent: string | undefined;
  /** 1 at the top level. */
  readonly depth: number;
}

/** Every scene node by id, with its zone and depth. */
export function placed(scene: Scene): Map<string, Placed> {
  const result = new Map<string, Placed>();
  const visit = (nodes: readonly SceneNode[], parent: string | undefined, depth: number): void => {
    for (const node of nodes) {
      result.set(node.id, { node, parent, depth });
      if (node.type === 'zone') visit(node.children, node.id, depth + 1);
    }
  };
  visit(scene.children, undefined, 1);
  return result;
}

/** Every zone of the scene. */
export function zones(scene: Scene): SceneZone[] {
  return [...placed(scene).values()].flatMap(({ node }) => (node.type === 'zone' ? [node] : []));
}

/** Every card of the scene. */
export function cards(scene: Scene): SceneCard[] {
  return [...placed(scene).values()].flatMap(({ node }) => (node.type === 'card' ? [node] : []));
}

/** The zone with this id; throws when the scene has none. */
export function zone(scene: Scene, id: string): SceneZone {
  const node = placed(scene).get(id)?.node;
  if (node?.type !== 'zone') throw new Error(`no zone ${id} in the scene`);
  return node;
}

/** The ids of a zone's children (or of the top level). */
export function childIds(scene: Scene, id?: string): string[] {
  const nodes = id === undefined ? scene.children : zone(scene, id).children;
  return nodes.map((node) => node.id);
}

/** The zone that holds a node, or undefined at the top level; throws when the node is not in the scene. */
export function parentOf(scene: Scene, id: string): string | undefined {
  const entry = placed(scene).get(id);
  if (entry === undefined) throw new Error(`no node ${id} in the scene`);
  return entry.parent;
}

/** Whether the scene shows a node (as a card or a zone, chips included). */
export function shows(scene: Scene, id: string): boolean {
  return placed(scene).has(id);
}

/** The scene's edges between two nodes, optionally of one kind. */
export function edgesBetween(scene: Scene, from: string, to: string, kind?: string): SceneEdge[] {
  return scene.edges.filter(
    (edge) => edge.from === from && edge.to === to && (kind === undefined || edge.kind === kind),
  );
}

/** The scene's edge kinds, sorted. */
export function edgeKinds(scene: Scene): string[] {
  return [...new Set(scene.edges.map((edge) => edge.kind))].sort();
}
