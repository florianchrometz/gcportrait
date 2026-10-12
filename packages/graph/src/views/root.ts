// SPDX-License-Identifier: MIT
/**
 * Step (a) of the scene builder: the drill-in root (the ViewSpec's `root`). The
 * canvas is the organisation, so its zone is dropped and its children become the top level. A drill-in root
 * re-roots the view at a container: the container is the canvas and its children the top level. A root that
 * names no node, or a node that is not a container, falls back to the organisation and is reported.
 */
import type { SceneEnv, SceneRoot } from '@gcportrait/model';
import { DEFAULT_ROOT_LABEL } from './constants.js';
import { ORGANIZATION_TYPE } from '../structure.js';
import { subtree, type ViewGraph } from './view-graph.js';

export interface RootSelection {
  /** The container the view is rooted at; absent for the organisation. */
  readonly root: string | undefined;
  /** Every node below the canvas: the root's descendants, or every node but the organisation. */
  readonly universe: ReadonlySet<string>;
  readonly label: string;
  readonly outcome: SceneRoot;
}

/** Resolves the drill-in root and the nodes below the canvas. */
export function selectRoot(vg: ViewGraph, requested: string | undefined, env: SceneEnv): RootSelection {
  const organizations = vg.ids.filter(
    (id) => vg.parent.get(id) === undefined && vg.nodes.get(id)?.assetType === ORGANIZATION_TYPE,
  );
  const [only, another] = organizations;
  const organizationLabel =
    another === undefined && only !== undefined ? vg.nodes.get(only)?.label : undefined;
  const whole = (outcome: SceneRoot): RootSelection => {
    const dropped = new Set(organizations);
    return {
      root: undefined,
      universe: new Set(vg.ids.filter((id) => !dropped.has(id))),
      label: organizationLabel ?? env.rootLabel ?? DEFAULT_ROOT_LABEL,
      outcome,
    };
  };

  if (requested === undefined) return whole({});
  const node = vg.nodes.get(requested);
  if (node === undefined) {
    return whole({
      requested,
      error: {
        code: 'unknown-root',
        message: `No node ${requested} in this snapshot; showing the whole scope.`,
      },
    });
  }
  if (node.role !== 'container') {
    return whole({
      requested,
      error: {
        code: 'not-a-container',
        message: `${node.label} is not a container and cannot be drilled into; showing the whole scope.`,
      },
    });
  }
  const below = subtree(vg, requested).slice(1);
  return {
    root: requested,
    universe: new Set(below),
    label: node.label,
    outcome: { requested, used: requested },
  };
}
