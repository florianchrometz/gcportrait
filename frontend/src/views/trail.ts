// SPDX-License-Identifier: Apache-2.0
/**
 * The breadcrumb's drill-in trail (the scope breadcrumb with the drill-in trail): from the scope
 * (the organisation, or whatever the snapshot covers) through the containers above the view's root down to the
 * root itself. Every crumb but the last drills out to it (`actions.drillIn(id)`, `null` for the scope). Pure.
 */
import type { ContainerInfo } from './choices';

export interface Crumb {
  /** The container to drill out to; null for the scope (no root). */
  readonly id: string | null;
  readonly label: string;
  /** What it is ("Folder", "Project"), for its tooltip; absent for the scope. */
  readonly typeName?: string;
}

export interface TrailInput {
  /** The scope's name ("example.com"). */
  readonly scope: string;
  /** The view's drill-in root, if any. */
  readonly root: string | undefined;
  /** The containers of the snapshot (view choices); null until they arrive. */
  readonly containers: Readonly<Record<string, ContainerInfo>> | null;
  /** The organisation's node: the scope crumb stands for it, so it is never a crumb of its own. */
  readonly organization: string | null;
  /** The root's label when the containers do not know it (the Scene's canvas title). */
  readonly rootLabel?: string;
}

function lastSegment(id: string): string {
  return id.slice(id.lastIndexOf('/') + 1);
}

/** The crumbs, outermost first; one crumb (the scope) when the view has no root. */
export function trailOf(input: TrailInput): Crumb[] {
  const scope: Crumb = { id: null, label: input.scope };
  const root = input.root;
  if (root === undefined || root === input.organization) return [scope];
  const above: Crumb[] = [];
  const containers = input.containers;
  if (containers !== null) {
    const seen = new Set<string>([root]);
    for (
      let current = containers[root]?.parent ?? null;
      current !== null && current !== input.organization && !seen.has(current);
      current = containers[current]?.parent ?? null
    ) {
      seen.add(current);
      const info = containers[current];
      above.unshift({
        id: current,
        label: info?.label ?? lastSegment(current),
        ...(info === undefined ? {} : { typeName: info.typeName }),
      });
    }
  }
  const info = containers?.[root];
  const last: Crumb = {
    id: root,
    label: info?.label ?? input.rootLabel ?? lastSegment(root),
    ...(info === undefined ? {} : { typeName: info.typeName }),
  };
  return [scope, ...above, last];
}
