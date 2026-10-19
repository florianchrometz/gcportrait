// SPDX-License-Identifier: Apache-2.0
/**
 * Where the highlight marks go (skill gcp-diagram-style §6): the geometry the highlight painter sets on the
 * interactive canvas and the static drawing writes for a selected-state baseline, so both draw the same marks.
 * Pure: rects in, numbers and path data out.
 *
 * - Path to the root: an `accent.path` ring on each zone's border (distance 0), over its `pathCasing` band.
 * - Selection: an `accent.select` ring outside the node, between canvas gaps (`RING_GAP` each side).
 * - Reached nodes: a thinner `accent.select` ring outside each, between canvas gaps, all of them one path.
 * - Keyboard focus: the focus ring, the same construction in the focus colour, around a solid node or an open
 *   zone; never thinner on screen than at 100 % (`focusRingPlacement`), so it stays visible zoomed out.
 * - The console action: a pill in the selected node's top-right corner, inside the node: icon-only at
 *   rest, labelled on hover and focus where the labelled pill fits inside the node.
 */
import { measureText, type LayoutRect, type Rect } from '@gcportrait/layout';

import { fmt } from './geometry/edgePath';
import { ringBox, roundedRectPath } from './geometry/rings';
import {
  CARD_RADIUS,
  CONSOLE_ACTION,
  FOCUS_WIDTH,
  REACH_WIDTH,
  RING_GAP,
  SELECT_WIDTH,
  ZONE_RADIUS,
} from './theme/styles';

/** How far outside a node's border each ring is centred. */
export const SELECT_DISTANCE = RING_GAP + SELECT_WIDTH / 2;
export const FOCUS_DISTANCE = RING_GAP + FOCUS_WIDTH / 2;
export const REACH_DISTANCE = RING_GAP + REACH_WIDTH / 2;

/** A node's corner radius: open zones 10, cards, chips and card-sized zones 8 (skill §4). */
export function nodeRadius(rect: Pick<LayoutRect, 'role'>): number {
  return rect.role === 'zone' ? ZONE_RADIUS : CARD_RADIUS;
}

export interface RingPlacement extends Rect {
  readonly rx: number;
}

/** A ring `distance` outside a node's border (0: on it), with its corner radius grown to match. */
export function ringPlacement(rect: LayoutRect, distance: number): RingPlacement {
  return { ...ringBox(rect, distance), rx: nodeRadius(rect) + distance };
}

/** The focus ring's geometry at a scale: where it goes and how wide its gap band and its line are drawn. */
export interface FocusRingPlacement extends RingPlacement {
  /** The canvas-coloured band under the line (the gap on both sides of it). */
  readonly band: number;
  readonly line: number;
}

/**
 * The focus ring around a node at the camera's scale `scale`. At 100 % and closer it is the drawing's own
 * ring: 2 px of the focus colour between 2 px canvas gaps, in drawing units, so it grows as the camera zooms in.
 * Further out it keeps those sizes in screen pixels (the drawing units grow by 1 / scale): the indicator never
 * shrinks below 2 px on screen with its gaps, however small the node is drawn, and keeps its 3 : 1 against them.
 */
export function focusRingPlacement(rect: LayoutRect, scale: number): FocusRingPlacement {
  const grow = scale > 0 && scale < 1 ? 1 / scale : 1;
  return {
    ...ringPlacement(rect, FOCUS_DISTANCE * grow),
    band: (FOCUS_WIDTH + 2 * RING_GAP) * grow,
    line: FOCUS_WIDTH * grow,
  };
}

/** The reach rings of the given nodes as one path (empty for none). */
export function reachPathData(rects: readonly LayoutRect[]): string {
  return rects
    .map((rect) => roundedRectPath(ringBox(rect, REACH_DISTANCE), nodeRadius(rect) + REACH_DISTANCE))
    .join('');
}

/**
 * The labelled console action pill's width for its label: the padding, the label (11 px / 500), a small gap
 * and the glyph's slot, which keeps the ↗ glyph where the icon-only pill has it.
 */
export function consoleActionWidth(label: string): number {
  const { compactWidth, glyph, glyphGap, paddingX, fontSize, fontWeight } = CONSOLE_ACTION;
  return Math.ceil(
    paddingX + measureText(label, fontWeight, fontSize) + glyphGap + (compactWidth + glyph) / 2,
  );
}

/** How far inside a node's corner the action sits: concentric with the node's corner (cards 0, zones 2). */
function consoleActionInset(rect: Pick<LayoutRect, 'role'>): number {
  return Math.max(0, nodeRadius(rect) - CONSOLE_ACTION.radius);
}

/**
 * Where the console action is anchored: the selected node's top-right corner (moved in to be concentric with a
 * zone's larger corner). The action is drawn leftwards and downwards from this point.
 */
export function consoleActionAnchor(rect: LayoutRect): { readonly x: number; readonly y: number } {
  const inset = consoleActionInset(rect);
  return { x: rect.x + rect.width - inset, y: rect.y + inset };
}

/** The console action's box for a pill `width` wide (the icon-only pill: `CONSOLE_ACTION.compactWidth`). */
export function consoleActionBox(rect: LayoutRect, width: number): Rect {
  const at = consoleActionAnchor(rect);
  return { x: at.x - width, y: at.y, width, height: CONSOLE_ACTION.height };
}

/**
 * Whether the labelled pill `width` wide may show (on hover and focus): on a card, a chip or a card-sized zone
 * whose width holds it. An open zone keeps the icon-only pill, so the label never covers its header; its
 * tooltip and accessible name say what it does.
 */
export function consoleActionExpands(rect: LayoutRect, width: number): boolean {
  return rect.role !== 'zone' && width <= rect.width - 2 * consoleActionInset(rect);
}

/** The ↗ glyph inside a pill anchored at (0, 0) and drawn leftwards: a diagonal and its head, as path data. */
export function consoleGlyphPath(): string {
  const { compactWidth, glyph, height } = CONSOLE_ACTION;
  const left = -(compactWidth + glyph) / 2;
  const top = (height - glyph) / 2;
  const right = left + glyph;
  const bottom = top + glyph;
  const head = glyph * 0.6;
  return `M${fmt(left)} ${fmt(bottom)}L${fmt(right)} ${fmt(top)}M${fmt(right - head)} ${fmt(top)}H${fmt(right)}V${fmt(top + head)}`;
}
