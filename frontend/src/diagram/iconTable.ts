// SPDX-License-Identifier: MIT
/**
 * Resolves the icons of a Scene with `@gcportrait/icons` (the type's key, then the category mark, then the
 * generic mark: the fallback chain of packages/icons/README.md). It runs where the icon table is loaded anyway: in
 * the data worker, which sends the result with the Scene (icons.ts), and in tests. The UI thread never imports this
 * module.
 */
import { resolveIcon } from '@gcportrait/icons';
import type { Scene, SceneNode } from '@gcportrait/model';

import { iconKeyOf, type DiagramIcons } from './icons';
import { ZONE_MARKS } from './theme/styles';

function collectKeys(nodes: readonly SceneNode[], into: Set<string>): void {
  for (const node of nodes) {
    const key = iconKeyOf(node, { kind: node.type === 'card' ? 'card' : node.kind });
    if (key !== undefined) into.add(key);
    if (node.type === 'zone') collectKeys(node.children, into);
  }
}

/**
 * The icons a Scene's drawing needs: every card's and zone's key, and every zone kind's mark (the layout's
 * synthetic group zones are not in the Scene). Keys in code-point order, so equal Scenes give equal tables.
 */
export function diagramIcons(scene: Scene): DiagramIcons {
  const keys = new Set<string>(Object.values(ZONE_MARKS));
  collectKeys(scene.children, keys);
  const sorted = [...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    byKey: Object.fromEntries(sorted.map((key) => [key, resolveIcon(undefined, key)])),
    generic: resolveIcon(),
  };
}
