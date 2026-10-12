// SPDX-License-Identifier: MIT
/**
 * What a node offers (style skill §6, the selection trace and the console action): the one helper behind the selected
 * card's "Open in Cloud Console ↗" action, the card's context menu and the details drawer's header, so they always
 * agree. The console link itself comes from the catalog engine (`consoleUrlFor`, through the data worker,
 * `DiagramInput.consoleLinks`); a type without a console template offers its project's console home instead, and
 * every asset-backed node offers its resource name to copy. Nothing here opens a page: links open only when a person
 * activates them, in a new tab, and never navigate the app itself.
 */
import type { ConsoleLink } from '@gcportrait/catalog';

import type { MenuItem } from '../ui/Menu';
import type { DiagramModel } from './model';

/** The console action of a node, in the words each place shows it. */
export interface ConsoleAction {
  readonly kind: 'resource' | 'project';
  readonly href: string;
  /** The menu item's and the drawer's label: "Open in Cloud Console", "Open project in Cloud Console". */
  readonly label: string;
  /** The label with the arrow that says it leaves the app (the selected card's action, the drawer's header). */
  readonly pill: string;
  /** The accessible name, naming the resource or project and the new tab. */
  readonly name: string;
}

export const CONSOLE_LABELS = Object.freeze({
  resource: 'Open in Cloud Console',
  project: 'Open project in Cloud Console',
  copy: 'Copy resource name',
  drillIn: 'Details',
});

/** The node's console action, or undefined when it has none (a synthetic zone, an asset outside a project). */
export function consoleActionOf(model: DiagramModel, id: string): ConsoleAction | undefined {
  const link = model.input.consoleLinks?.[id];
  return link === undefined ? undefined : consoleAction(link, model.nodes.get(id)?.label ?? id);
}

/**
 * The console action of a catalog `ConsoleLink` for a node labelled `label`, in the words every place shows it
 * (the drawer takes it from its details, for a node the view does not draw as well).
 */
export function consoleAction(link: ConsoleLink, label: string): ConsoleAction {
  if (link.kind === 'resource') {
    return {
      kind: 'resource',
      href: link.url,
      label: CONSOLE_LABELS.resource,
      pill: `${CONSOLE_LABELS.resource} ↗`,
      name: `Open ${label} in Cloud Console (opens a new tab)`,
    };
  }
  return {
    kind: 'project',
    href: link.url,
    label: CONSOLE_LABELS.project,
    pill: `${CONSOLE_LABELS.project} ↗`,
    name: `Open project ${link.projectId} in Cloud Console (opens a new tab)`,
  };
}

/** Whether a node is a container one can drill into: an asset zone (open or a chip), not a region or a group. */
export function canDrillIn(model: DiagramModel, id: string): boolean {
  const node = model.nodes.get(id);
  // A timeline ghost is no container of the drawn day.
  if (model.diff?.ghosts.has(id) === true) return false;
  return node?.type === 'zone' && node.kind !== 'region' && node.kind !== 'group';
}

/** Whether a node stands for an asset (its id is a resource name to copy): not a synthetic region or group. */
export function hasResourceName(model: DiagramModel, id: string): boolean {
  const node = model.nodes.get(id);
  if (node === undefined) return false;
  return node.type === 'card' || (node.kind !== 'region' && node.kind !== 'group');
}

export interface NodeActionHandlers {
  /** Copies the node's resource name (its id). */
  readonly copy: (id: string) => void;
  /** Re-roots the view at the node; absent where drilling in is not offered. */
  readonly drillIn?: (id: string) => void;
}

/**
 * The node's menu, in this order: "Open in Cloud Console" (or "Open project in Cloud Console", a link), "Copy
 * resource name", "Drill in" (containers). Empty for a node with nothing to offer.
 */
export function nodeMenuItems(model: DiagramModel, id: string, handlers: NodeActionHandlers): MenuItem[] {
  const items: MenuItem[] = [];
  const action = consoleActionOf(model, id);
  if (action !== undefined) items.push({ id: 'console', label: action.label, href: action.href });
  if (hasResourceName(model, id)) {
    items.push({
      id: 'copy',
      label: CONSOLE_LABELS.copy,
      onSelect: () => {
        handlers.copy(id);
      },
    });
  }
  const { drillIn } = handlers;
  if (drillIn !== undefined && canDrillIn(model, id)) {
    items.push({
      id: 'drill-in',
      label: CONSOLE_LABELS.drillIn,
      onSelect: () => {
        drillIn(id);
      },
    });
  }
  return items;
}
