// SPDX-License-Identifier: Apache-2.0
/**
 * Test helper (not part of the public API): a `LayoutNode` built by hand, for the stage tests that feed the
 * packer, the port planner or the edge merger nodes no valid Scene would produce (a rect inside a chip) or that
 * need only a box. Every field the caller leaves out takes a neutral default: a card at the origin with no size,
 * no header, no padding and no parent, labelled with its id.
 */
import type { LayoutNode } from '../normalise.js';
import type { RectRole } from '../types.js';

export interface LayoutNodeSpec {
  readonly id: string;
  /** Default `card`; any other role is a project zone. */
  readonly role?: RectRole;
  readonly x?: number;
  readonly y?: number;
  readonly width?: number;
  readonly height?: number;
  readonly parent?: LayoutNode | null;
  /** Default: one below the parent, 1 at the top level. */
  readonly depth?: number;
  readonly headerHeight?: number;
  readonly padding?: number;
  readonly index?: number;
}

export function layoutNode(spec: LayoutNodeSpec): LayoutNode {
  const role = spec.role ?? 'card';
  const parent = spec.parent ?? null;
  return {
    id: spec.id,
    type: role === 'card' ? 'card' : 'zone',
    kind: role === 'card' ? 'card' : 'project',
    role,
    label: spec.id,
    subtitle: undefined,
    badges: [],
    counts: undefined,
    depth: spec.depth ?? (parent === null ? 1 : parent.depth + 1),
    parent,
    children: [],
    width: spec.width ?? 0,
    height: spec.height ?? 0,
    headerHeight: spec.headerHeight ?? 0,
    padding: spec.padding ?? 0,
    minWidth: 0,
    extra: { top: 0, right: 0, bottom: 0, left: 0 },
    x: spec.x ?? 0,
    y: spec.y ?? 0,
    index: spec.index ?? 0,
  };
}
