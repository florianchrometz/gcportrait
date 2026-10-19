// SPDX-License-Identifier: Apache-2.0
/**
 * Theme-independent drawing rules (skill gcp-diagram-style §2, §4, §5): stroke widths and dashes
 * per zone tint, edge strokes, dashes and heads per relation style, zone kind names and marks. Colours come
 * from the palette (tokens.ts); geometry from `@gcportrait/layout`'s constants.
 */
import { RELATION_KINDS, type EdgeStyleId, type RelationKind, type ZoneKind } from '@gcportrait/model';

import type { ZoneTint } from './tokens';

/**
 * A zone's tint from its kind and depth (the canvas is depth 0, the top level 1, as in the layout): product
 * containers are `other` above depth 3 and `nested` from depth 3 on (skill §2); synthetic group zones are
 * grey like other containers (skill gcp-diagram-layout §4).
 */
export function zoneTintOf(kind: ZoneKind, depth: number): ZoneTint {
  switch (kind) {
    case 'folder':
    case 'project':
    case 'vpc':
    case 'subnet':
    case 'region':
      return kind;
    case 'group':
      return 'other';
    case 'product-container':
      return depth >= 3 ? 'nested' : 'other';
  }
}

/** Stroke width and dash of a zone outline (style skill §4): 1.5 px for projects, VPCs and subnets, else 1 px. */
export function zoneStroke(tint: ZoneTint): { readonly width: number; readonly dash?: string } {
  switch (tint) {
    case 'project':
    case 'vpc':
    case 'subnet':
      return { width: 1.5 };
    case 'region':
      return { width: 1, dash: '4 3' };
    case 'folder':
    case 'nested':
    case 'other':
      return { width: 1 };
  }
}

/** Corner radii (skill §4): zones 10, cards, chips and card-sized zones 8. */
export const ZONE_RADIUS = 10;
export const CARD_RADIUS = 8;
/** Card outline (skill §2: `card` stroke 1.5 px); chips and card-sized zones keep their zone's stroke. */
export const CARD_STROKE_WIDTH = 1.5;

/** An arrowhead: filled (ink), hollow (canvas inside an ink outline) or open (two ink strokes meeting at the tip). */
export type HeadShape = 'filled' | 'hollow' | 'open';

export interface HeadStyle {
  readonly shape: HeadShape;
  /** Along the edge. */
  readonly length: number;
  /** Across the edge. */
  readonly width: number;
}

export interface EdgeStyle {
  readonly width: number;
  readonly dash?: string;
  /** Absent: no head (round caps). Which ends carry it comes from the layout (`EdgePath.heads`). */
  readonly head?: HeadStyle;
  /** Drawn as a dashed overlay around the target instead of a line (`secures`, skill §5). */
  readonly overlay?: boolean;
}

const FILLED_9x7: HeadStyle = { shape: 'filled', length: 9, width: 7 };
const FILLED_7x5: HeadStyle = { shape: 'filled', length: 7, width: 5 };

/**
 * The skill's §5 table, keyed by the default-style id each relation kind carries in the model's
 * `RELATION_KINDS` (one row per style, so no second per-kind map): `routes`, `uses`, `triggers` are
 * `solid-arrow`; `attaches` is `nesting-or-thin-arrow`; `peers` `dashed-double-headed`; `connects`
 * `solid-round-caps`; `memberOf`, `runsAs`, `encryptedBy` `thin-dotted`; `replicates` `solid-hollow-head`;
 * `shares` `dashed-arrow`; `secures` `dashed-overlay-zone`. `nesting` (`contains`) is never drawn as a line; if
 * one ever reaches the renderer it is drawn like a thin arrow.
 */
export const EDGE_STYLES: Readonly<Record<EdgeStyleId, EdgeStyle>> = Object.freeze({
  nesting: { width: 1.5, head: FILLED_7x5 },
  'nesting-or-thin-arrow': { width: 1.5, head: FILLED_7x5 },
  'solid-arrow': { width: 2, head: FILLED_9x7 },
  'dashed-double-headed': { width: 2, dash: '6 5', head: FILLED_9x7 },
  'solid-round-caps': { width: 2 },
  'thin-dotted': { width: 1.2, dash: '1 3', head: { shape: 'open', length: 7, width: 5 } },
  'dashed-overlay-zone': { width: 2, dash: '6 4', overlay: true },
  'solid-hollow-head': { width: 2, head: { shape: 'hollow', length: 9, width: 7 } },
  'dashed-arrow': { width: 1.5, dash: '8 4', head: FILLED_7x5 },
});

export function edgeStyleOf(kind: RelationKind): EdgeStyle {
  return EDGE_STYLES[RELATION_KINDS[kind].defaultStyle];
}

/** Dim mode (skill §5): more than this many drawn edges dims the lines outside the trace. */
export const DIM_THRESHOLD = 30;
/** Lines in dim mode: `edge.dim`, 1.2 px, with their kind's head at 7 × 5 (skill §5). */
export const DIM_EDGE_WIDTH = 1.2;
/** The head size of every dimmed line: its kind's shape (filled, hollow, open), 7 × 5. */
export const DIM_HEAD = Object.freeze({ length: 7, width: 5 });
/** The heads of a kind in dim mode: the kind's shape at 7 × 5; none for a kind without a head. */
export function dimHead(head: HeadStyle | undefined): HeadStyle | undefined {
  return head === undefined ? undefined : { shape: head.shape, ...DIM_HEAD };
}
/**
 * Traced lines (the selection trace, skill §6; in dim mode the focused set) are drawn again on top, cased in
 * `canvas` this many px on each side of the line (skill §5: "a 4 px casing in `canvas`", read as 4 px on each
 * side, so the gap stays visible beside the line).
 */
export const CASING = 4;
/**
 * The `secures` overlay (skill §5): `accent.path` at 50 %, dashed `6 4`, 2 px, over its casing (`PATH_CASING`),
 * this far inside the target's border (under the lines and inside the target, never in the gutter where
 * the lines run). Overlay zones (a perimeter focus) use the same outline on the zone's border.
 */
export const OVERLAY_OPACITY = 0.5;
export const OVERLAY_INSET = 4;
export const OVERLAY_WIDTH = 2;
export const OVERLAY_DASH = '6 4';
/**
 * Highlights (skill §6): the path to the root (every zone around the traced node) 3 px `accent.path`; the
 * selection 3 px `accent.select`; traced lines 3 px `accent.select`; nodes the trace reaches a 1.5 px
 * `accent.select` outline.
 */
export const PATH_WIDTH = 3;
export const SELECT_WIDTH = 3;
export const TRACE_WIDTH = 3;
export const REACH_WIDTH = 1.5;
/**
 * A traced line keeps its kind's dash rhythm, scaled to the trace width so the dashes keep their proportions
 * (`1 3` dots at 1.2 px stay dots at 3 px): every kind still differs by its dashes and heads (skill §10).
 */
export function traceDash(style: EdgeStyle): string | undefined {
  if (style.dash === undefined) return undefined;
  const factor = TRACE_WIDTH / style.width;
  return style.dash
    .split(/\s+/)
    .map((part) => String(Math.round(Number(part) * factor * 100) / 100))
    .join(' ');
}
/**
 * The `pathCasing` band on each side of the ancestor-path accent and the `secures` overlay (tokens.ts): the
 * light amber reaches 3 : 1 only against it, as the selection ring does against its canvas gap.
 */
export const PATH_CASING = 1;
/** Selection, reach and focus rings sit outside the node with a canvas-coloured gap this wide on each side. */
export const RING_GAP = 2;
/**
 * The selected node's "Open in Cloud Console ↗" action (inside the node): a pill 16 px
 * tall in the node's top-right corner, over its border, with `accent.select` outline and glyph on `canvas`. At
 * rest it is icon-only (a 16 px circle around the ↗ glyph, concentric with a card's 8 px corner); on hover and
 * keyboard focus it grows leftwards to show its label when the labelled pill fits inside the node. Never outside
 * the node, so it never covers a neighbour (the gap between two rows of cards is 20 px).
 */
export const CONSOLE_ACTION = Object.freeze({
  height: 16,
  /** The icon-only pill: a circle as wide as it is tall. */
  compactWidth: 16,
  radius: 8,
  /** The ↗ glyph's box, centred in the icon-only pill; the labelled pill keeps it in the same place. */
  glyph: 8,
  glyphStroke: 1.5,
  /** The label: 11 px / 500, `paddingX` from the pill's left end, `glyphGap` before the glyph's slot. */
  paddingX: 6,
  glyphGap: 2,
  fontSize: 11,
  fontWeight: 500 as const,
});
/**
 * Timeline markers (skill §6), for one day: what changed since the day on screen before.
 *
 * - Added: an `accent.peer` outline 2 px wide, centred `ADDED_DISTANCE` outside the node's border, between canvas
 *   gaps (`RING_GAP`) like the selection ring (the light green reaches only 2.92 : 1 on the light project tint, 5.02
 *   on its canvas gap). Centred 8 px out, its line (7–9 px) stays clear of the selection ring and its gaps (0–7 px)
 *   and of the reach ring (0–5.5 px), so an added node that is selected or traced keeps its outline.
 * - Changed: a 6 px `accent.path` dot on the node's top-right corner (centred on its rounded corner), on a
 *   `pathCasing` disc `CHANGED_DOT_CASING` wider (the light amber reaches 3.13 : 1 on it and 1.1–1.9 on the light
 *   fills, as the path to the root does).
 * - Removed: a ghost of the node where it stood: its body (fill and icon) at `GHOST_OPACITY`, its label and a
 *   "removed" line in the readable grey of that body, and a dashed `accent.removed` outline at full strength on a
 *   canvas band `GHOST_BAND` wider on each side (at 50 % the light red would reach only 2.22 : 1 on the canvas).
 */
export const ADDED_WIDTH = 2;
export const ADDED_DISTANCE = 8;
export const CHANGED_DOT_RADIUS = 3;
export const CHANGED_DOT_CASING = 1;
export const GHOST_OPACITY = 0.5;
export const GHOST_STROKE_WIDTH = 1.5;
export const GHOST_DASH = '5 3';
export const GHOST_BAND = 1;
/** Focus ring (skill §9): 2 px `primary`. */
export const FOCUS_WIDTH = 2;
/** Zone titles get a halo in the zone fill this wide on each side of the glyphs (skill §3). */
export const HALO = 2;

/** What a zone kind is called (legend, accessible names). */
export const ZONE_KIND_NAMES: Readonly<Record<ZoneKind, string>> = Object.freeze({
  folder: 'Folder',
  project: 'Project',
  vpc: 'VPC network',
  subnet: 'Subnetwork',
  region: 'Region',
  'product-container': 'Container',
  group: 'Group',
});

/**
 * The header mark of a zone whose Scene node names no icon ("absent: the zone kind's own mark", model
 * `SceneZone.icon`): Resource Manager folders and projects, the VPC network icon for networks and subnets,
 * gcportrait's own generic box for virtual regions (not a Google product), the folder for synthetic groups and
 * Google's generic cloud mark for a product container. Resolved through `@gcportrait/icons`, so a key it does
 * not know falls back to the generic mark.
 */
export const ZONE_MARKS: Readonly<Record<ZoneKind, string>> = Object.freeze({
  folder: 'folder',
  project: 'project',
  vpc: 'virtual_private_cloud',
  subnet: 'virtual_private_cloud',
  region: 'generic_resource',
  'product-container': 'cloud_generic',
  group: 'folder',
});
