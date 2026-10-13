// SPDX-License-Identifier: MIT
/**
 * The icons a diagram draws (style skill §4). The data worker resolves them with `@gcportrait/icons`
 * (iconTable.ts) and sends them with the Scene, so the icon table (170 kB of artwork) never loads on the UI
 * thread: the page only receives the few dozen icons a view needs. This module is the UI thread's side, a
 * lookup with no import of the icon table. The artwork is Google's and is never altered (skill §1; agents.md, Style
 * and accessibility).
 */
import type { Icon } from '@gcportrait/icons';
import type { SceneNode } from '@gcportrait/model';
import type { LayoutRect } from '@gcportrait/layout';

import { ZONE_MARKS } from './theme/styles';

/** The icons of one Scene: each icon key the drawing asks for, mapped to the icon its fallback chain gives. */
export interface DiagramIcons {
  readonly byKey: Readonly<Record<string, Icon>>;
  /** Google's generic cloud mark: for a node that names no key, or a key the table lacks. */
  readonly generic: Icon;
}

/**
 * The icon key a rect asks for: a card's own key; a zone's header key, else its kind's mark (`ZONE_MARKS`);
 * nothing for a rect the Scene does not know (the generic mark then).
 */
export function iconKeyOf(node: SceneNode | undefined, rect: Pick<LayoutRect, 'kind'>): string | undefined {
  if (node?.type === 'card') return node.icon;
  const zoneIcon = node?.type === 'zone' ? node.icon : undefined;
  return zoneIcon ?? (rect.kind === 'card' ? undefined : ZONE_MARKS[rect.kind]);
}

/** The icon for a key; the generic mark for none or for a key the table does not hold. */
export function lookupIcon(icons: DiagramIcons, key: string | undefined): Icon {
  if (key === undefined || !Object.hasOwn(icons.byKey, key)) return icons.generic;
  return icons.byKey[key] ?? icons.generic;
}

/**
 * The icon as a nested `<svg>` placed at (`x`, `y`) in a `size` × `size` box. The same contract as
 * `@gcportrait/icons`' `placeIcon` (only position and size are added to the root element; the artwork is
 * untouched), kept here so the UI thread does not import the icon table that module carries.
 */
export function placeIconMarkup(icon: Icon, size: number, x = 0, y = 0): string {
  const placement = ` x="${String(x)}" y="${String(y)}" width="${String(size)}" height="${String(size)}"`;
  return icon.svg.replace(/^<svg\b/, `<svg${placement}`);
}
