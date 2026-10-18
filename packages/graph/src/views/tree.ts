// SPDX-License-Identifier: Apache-2.0
/**
 * The scene tree before progressive disclosure: every visible node and external stub as a zone or a card,
 * nested in its nearest visible container, children in a fixed order, and large flat sets bundled into
 * alphabetical `group` zones (skill gcp-diagram-layout §4 and §6).
 *
 * Order (skill gcp-diagram-layout §4): zones before cards; zones by kind (folder, project, VPC, subnet,
 * region, product container, group); then by label and by id in code-point order, so the layout never
 * jiggles.
 */
import { serviceOf } from '@gcportrait/catalog';
import {
  ZONE_KIND_RANK,
  type Catalog,
  type ConcreteDetailLevel,
  type GraphNode,
  type ZoneKind,
} from '@gcportrait/model';
import { compareStrings } from '../order.js';
import { FOLDER_TYPE, PROJECT_TYPE, isVirtualNode } from '../structure.js';
import { BUNDLE_ID_PREFIX, BUNDLE_SIZE, BUNDLE_THRESHOLD, GENERIC_ICON } from './constants.js';
import { zoneOpensAt } from './detail.js';
import { sceneParentOf, type ViewContext, type Visible } from './filters.js';
import { projectOf } from './view-graph.js';

export interface ZoneEntry {
  readonly type: 'zone';
  readonly id: string;
  readonly kind: ZoneKind;
  /** The shallowest detail level the zone is open at by default (detail.ts, `zoneOpensAt`). */
  readonly opensAt: ConcreteDetailLevel;
  /** Whether the zone counts as a level for the `depth` filter (asset containers do; regions, bundles and overlays do not). */
  readonly counted: boolean;
  readonly label: string;
  readonly subtitle: string | undefined;
  /** An external stub's project zone. */
  readonly external: boolean;
  /**
   * The header icon of a product container: its catalog type's icon (skill gcp-diagram-style §4), so a
   * GKE cluster, a dataset or an instance group shows its product's mark. Absent for folders, projects,
   * networks, subnets, regions and bundles, which draw their zone kind's own mark.
   */
  readonly icon?: string;
}

export interface CardEntry {
  readonly type: 'card';
  readonly id: string;
  /** An external stub of a project focus. */
  readonly external: boolean;
  readonly label: string;
  readonly subtitle: string | undefined;
  readonly icon: string;
  readonly product: string;
  readonly assetType: string;
}

export type Entry = ZoneEntry | CardEntry;

export interface SceneTree {
  readonly entries: ReadonlyMap<string, Entry>;
  /** Top-level ids, ordered. */
  readonly top: readonly string[];
  /** Zone → its children, ordered (bundles included). */
  readonly children: ReadonlyMap<string, readonly string[]>;
  /** Scene id → its zone (bundles included). */
  readonly parent: ReadonlyMap<string, string>;
  /** Bundle zone → how many members it holds. */
  readonly bundles: ReadonlyMap<string, number>;
}

/** Cards after every zone kind (`ZONE_KIND_RANK`, declared once in the model and shared with the layout). */
const CARD_RANK = Math.max(...Object.values(ZONE_KIND_RANK)) + 1;

/**
 * The zone kind of a container node: the hierarchy by identity, virtual region containers by id, every other
 * container by its catalog type's `zoneKind` (`vpc`, `subnet`, …; `product` or none: a product container).
 */
function zoneKindOf(catalog: Catalog, node: GraphNode): ZoneKind {
  if (node.assetType === FOLDER_TYPE) return 'folder';
  if (node.assetType === PROJECT_TYPE) return 'project';
  if (isVirtualNode(node.id)) return 'region';
  const declared = Object.hasOwn(catalog.types, node.assetType)
    ? catalog.types[node.assetType]?.zoneKind
    : undefined;
  return declared === undefined || declared === 'product' ? 'product-container' : declared;
}

/** The icon of a card: the type's, else its service's product icon, else the generic mark. */
export function iconOf(catalog: Catalog, assetType: string): string {
  const type = Object.hasOwn(catalog.types, assetType) ? catalog.types[assetType] : undefined;
  if (type !== undefined) return type.icon;
  const service = serviceOf(assetType);
  return catalog.products.find((product) => product.service === service)?.icon ?? GENERIC_ICON;
}

function zoneEntry(catalog: Catalog, node: GraphNode, overlay: boolean, external: boolean): ZoneEntry {
  const kind = zoneKindOf(catalog, node);
  return {
    type: 'zone',
    id: node.id,
    kind,
    opensAt: zoneOpensAt(kind, overlay),
    counted: !overlay && !isVirtualNode(node.id),
    label: node.label,
    subtitle: node.subtitle,
    external,
    ...(kind === 'product-container' ? { icon: iconOf(catalog, node.assetType) } : {}),
  };
}

function cardEntry(catalog: Catalog, node: GraphNode, external = false): CardEntry {
  return {
    type: 'card',
    id: node.id,
    external,
    label: node.label,
    subtitle: node.subtitle,
    icon: iconOf(catalog, node.assetType),
    product: node.product,
    assetType: node.assetType,
  };
}

function rank(entry: Entry): number {
  return entry.type === 'card' ? CARD_RANK : ZONE_KIND_RANK[entry.kind];
}

/** Code points of a label, so prefixes never split a surrogate pair. */
function codePoints(text: string): string[] {
  return Array.from(text);
}

function commonPrefixLength(a: readonly string[], b: readonly string[]): number {
  let length = 0;
  while (length < a.length && length < b.length && a[length] === b[length]) length += 1;
  return length;
}

/** The shortest prefix of `label` that tells it apart from every neighbour (dictionary-style headings). */
function distinctPrefix(label: string, neighbours: readonly (string | undefined)[]): string {
  const own = codePoints(label);
  let length = 0;
  for (const neighbour of neighbours) {
    if (neighbour !== undefined) length = Math.max(length, commonPrefixLength(own, codePoints(neighbour)));
  }
  return own.slice(0, length + 1).join('');
}

interface Run<T> {
  readonly first: T;
  readonly last: T;
  readonly items: readonly T[];
}

/** Splits an ordered list into `count` runs whose lengths differ by at most one (`count` ≤ the length). */
function evenRuns<T>(items: readonly T[], count: number): Run<T>[] {
  const runs: Run<T>[] = [];
  let start = 0;
  for (let index = 0; index < count; index += 1) {
    const end = start + Math.floor((items.length - start) / (count - index));
    const slice = items.slice(start, end);
    const [first] = slice;
    const last = slice.at(-1);
    if (first !== undefined && last !== undefined) runs.push({ first, last, items: slice });
    start = end;
  }
  return runs;
}

function compareEntries(left: Entry, right: Entry): number {
  return (
    rank(left) - rank(right) || compareStrings(left.label, right.label) || compareStrings(left.id, right.id)
  );
}

/**
 * The zone of one bundle: labelled with the shortest prefixes of its first and last member that tell them
 * apart from the neighbouring bundles ("demo-a – demo-f"), identified by its first member.
 */
function bundleEntry(
  first: Entry,
  last: Entry,
  previous: Entry | undefined,
  next: Entry | undefined,
): ZoneEntry {
  const start = distinctPrefix(first.label, [previous?.label, last.label]);
  const end = distinctPrefix(last.label, [next?.label, first.label]);
  return {
    type: 'zone',
    id: `${BUNDLE_ID_PREFIX}${first.id}`,
    kind: 'group',
    opensAt: zoneOpensAt('group', false),
    counted: false,
    label: start === end ? start : `${start} – ${end}`,
    subtitle: undefined,
    external: false,
  };
}

/** Builds the scene tree of the visible nodes and stubs. */
export function sceneTree(ctx: ViewContext, catalog: Catalog, visible: Visible): SceneTree {
  const { vg, focus } = ctx;
  const entries = new Map<string, Entry>();
  const parent = new Map<string, string>();

  const hasChildren = new Set<string>();
  for (const id of visible.nodes) {
    const container = sceneParentOf(ctx, visible.nodes, id);
    if (container === undefined) continue;
    parent.set(id, container);
    hasChildren.add(container);
  }
  for (const [id, node] of vg.nodes) {
    if (!visible.nodes.has(id)) continue;
    // An overlay stays a zone even when the filters left nothing inside it.
    const zone = node.role === 'container' || hasChildren.has(id) || focus.overlay === id;
    entries.set(id, zone ? zoneEntry(catalog, node, focus.overlay === id, false) : cardEntry(catalog, node));
  }
  // External stubs, grouped in their project's zone; at the top level when the project is unknown or the lens
  // rules hide projects.
  for (const [id, node] of vg.nodes) {
    if (!visible.stubs.has(id)) continue;
    const project = projectOf(vg, id);
    const projectNode = project === undefined ? undefined : vg.nodes.get(project);
    if (projectNode === undefined || !ctx.rules.passes(projectNode)) {
      entries.set(id, cardEntry(catalog, node, true));
      continue;
    }
    entries.set(projectNode.id, zoneEntry(catalog, projectNode, false, true));
    if (id === projectNode.id) continue;
    entries.set(id, cardEntry(catalog, node, true));
    parent.set(id, projectNode.id);
  }

  const lists = new Map<string | undefined, Entry[]>();
  for (const entry of entries.values()) {
    const container = parent.get(entry.id);
    const list = lists.get(container);
    if (list === undefined) lists.set(container, [entry]);
    else list.push(entry);
  }

  const bundles = new Map<string, number>();
  const children = new Map<string, readonly string[]>();
  let top: string[] = [];
  for (const [container, list] of lists) {
    list.sort(compareEntries);
    let ordered = list;
    if (list.length > BUNDLE_THRESHOLD) {
      const runs = evenRuns(list, Math.ceil(list.length / BUNDLE_SIZE));
      ordered = runs.map((run, index) => {
        const zone = bundleEntry(run.first, run.last, runs[index - 1]?.last, runs[index + 1]?.first);
        entries.set(zone.id, zone);
        bundles.set(zone.id, run.items.length);
        if (container !== undefined) parent.set(zone.id, container);
        for (const member of run.items) parent.set(member.id, zone.id);
        children.set(
          zone.id,
          run.items.map((member) => member.id),
        );
        return zone;
      });
    }
    const ids = ordered.map((entry) => entry.id);
    if (container === undefined) top = ids;
    else children.set(container, ids);
  }
  return { entries, top, children, parent, bundles };
}
