// SPDX-License-Identifier: Apache-2.0
/**
 * What the details drawer shows about one node, as the data worker
 * answers it: the worker holds the Graph, the snapshot's assets and the catalog, so it works the details out
 * (details.ts) and the page only shows them. Plain, serialisable data (it crosses `postMessage`); types only,
 * so the UI thread imports nothing of the catalog through this module.
 */
import type { ConsoleLink } from '@gcportrait/catalog';
import type { NodeRole, RelationKind } from '@gcportrait/model';

import type { DiffDay } from '../diagram/diff/types';

/** Another node the drawer names, with a jump link: its id, label and human type name. */
export interface NodeRef {
  readonly id: string;
  readonly label: string;
  /** "Compute Engine subnetwork" (`cardTypeName`); the builder's own containers say "Region", "Zone". */
  readonly typeName: string;
}

/**
 * Which way a relation runs, seen from the selected node: `out` (it is the relation's `from`), `in` (its
 * `to`), or `both` for the symmetric `peers`.
 */
export type RelationDirection = 'out' | 'in' | 'both';

export interface RelationEntry {
  readonly direction: RelationDirection;
  readonly target: NodeRef;
  /**
   * The VPC network the target sits in, when it sits directly in one: a NIC's subnet names its network (the
   * NIC's own `attaches` to the network yields to the subnet in the Graph, so this is where it shows).
   */
  readonly via?: NodeRef;
  /** A weak relation that nothing stronger replaced (a NIC's network without a subnet). */
  readonly weak?: true;
}

/** The relations of one kind, outgoing before incoming, each by label. */
export interface RelationGroup {
  readonly kind: RelationKind;
  readonly entries: readonly RelationEntry[];
  /** Entries left out beyond the cap (a project's children). */
  readonly more: number;
}

/**
 * Why a reference dangles, for its short explanation: it names a resource in a project the snapshot does not
 * hold (`outside-project`: a public image project, a Google-managed tenant project, a project outside the
 * scope), a resource the snapshot does not hold (`missing`), an identity no asset has (`identity`: a
 * Google-managed service agent, an account of another project), or a value the catalog's normaliser could not
 * read as a resource name (`unreadable`).
 */
export type DanglingReason = 'outside-project' | 'missing' | 'identity' | 'unreadable';

export interface DanglingEntry {
  readonly kind: RelationKind;
  /** The normalised name, the alias, or the raw text when the normaliser did not understand it. */
  readonly to: string;
  /** The value as read from the asset. */
  readonly raw: string;
  readonly reason: DanglingReason;
  /** The project the reference names, for `outside-project`. */
  readonly project?: string;
}

/** The project a node lives in: its id and number as the snapshot's project index pairs them. */
export interface ProjectInfo {
  readonly id?: string;
  readonly number?: string;
  /** The Resource Manager project's node, when the snapshot holds it (a jump link). */
  readonly node?: string;
}

/** A label of the resource (`data.labels`, GKE's `data.resourceLabels`). */
export interface LabelEntry {
  readonly key: string;
  readonly value: string;
}

export interface NodeDetails {
  readonly id: string;
  readonly label: string;
  readonly subtitle?: string;
  readonly assetType: string;
  readonly typeName: string;
  readonly product: string;
  readonly role: NodeRole;
  /** Whether the view can be re-rooted at the node (a container of the snapshot, not one the builder adds). */
  readonly drillable: boolean;
  /** Whether the node is hidden by default (role `hidden`, or its type's `hiddenWhen` matched). */
  readonly hidden: boolean;
  /** The container the Graph nests the node in. */
  readonly parent?: NodeRef;
  readonly project?: ProjectInfo;
  readonly location?: string;
  readonly ips: readonly string[];
  readonly domains: readonly string[];
  readonly labels: readonly LabelEntry[];
  /** Network tags and other plain tag lists (`data.tags.items`, `data.tags`). */
  readonly tags: readonly string[];
  /** In the model's order (`RelationKindSchema`); kinds without relations are left out. */
  readonly relations: readonly RelationGroup[];
  readonly dangling: readonly DanglingEntry[];
  /** The console action (the catalog engine's `consoleLinkFor`): the resource's page, or its project's home. */
  readonly console?: ConsoleLink;
  /** When the asset last changed (`updateTime`). */
  readonly updateTime?: string;
  /** `resource.data` as the snapshot holds it; null for the builder's own containers (regions, zones). */
  readonly resource: { readonly data: unknown } | null;
}

/** One field of `resource.data` that differs between two days (drawer/fieldDiff.ts). */
export interface FieldChange {
  /** Where, as a dotted path with array indexes (`rules[2].action`); `(data)` for `resource.data` itself. */
  readonly path: string;
  /** `added`: only on the drawn day; `removed`: only on the earlier one; `changed`: another value. */
  readonly kind: 'added' | 'removed' | 'changed';
  /** The values as short JSON (cut with an ellipsis), each where it exists. */
  readonly before?: string;
  readonly after?: string;
}

/** The fields that differ, at most a cap of them, and how many more there are. */
export interface FieldSummary {
  readonly entries: readonly FieldChange[];
  readonly more: number;
}

/** Nodes of one kind of change, by label, at most a cap of them, and how many more there are. */
export interface ChangeList {
  readonly entries: readonly NodeRef[];
  readonly more: number;
}

/** How a node itself changed between the two days. */
export type ChangeStatus = 'added' | 'removed' | 'changed' | 'unchanged';

/**
 * What changed about one node of the drawn day since the day on screen before it (the drawer's "What
 * changed" section), as the data worker answers it (drawer/changes.ts).
 */
export interface NodeChanges {
  /** The day compared with. */
  readonly since: DiffDay;
  /** The drawn day's read time. */
  readonly readTime: string;
  readonly status: ChangeStatus;
  /** Its label and type where it exists (for a removed node, as the earlier day had it). */
  readonly label: string;
  readonly typeName: string;
  /** Its `updateTime` on the earlier day and on the drawn one, each where it exists. */
  readonly updateTime: { readonly before?: string; readonly after?: string };
  /** A changed node's fields of `resource.data` that differ (empty: only its update time moved). */
  readonly fields?: FieldSummary;
  /** For a container: what inside it (at any depth) was added, removed or changed. */
  readonly inside: {
    readonly added: ChangeList;
    readonly removed: ChangeList;
    readonly changed: ChangeList;
  };
}
