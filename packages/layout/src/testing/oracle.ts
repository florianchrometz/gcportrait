// SPDX-License-Identifier: Apache-2.0
/**
 * Test helper (not part of the public API): an independent oracle for the packing, used by the golden tests
 * (test/golden.test.ts) and the packer's brute-force property (src/pack.test.ts). For one container it
 * enumerates, by brute force and without the packer's code, the arrangements skill gcp-diagram-layout §4
 * allows: cards first in a grid of any column count (each column as wide as its widest card), then the zones in
 * consecutive left-aligned rows split in any way (every composition for up to `EXHAUSTIVE_ZONES` zones; above
 * that, k per row and every width-budget split, which still covers every split with full rows). For each it
 * reports the children box, whether every row is full (src/pack.ts rule 1, the formal reading of skill §1's
 * "tidy grid") and whether it is wider than tall.
 */
import type { Scene, SceneNode } from '@gcportrait/model';
import { DEFAULT_SIZING } from '../constants.js';
import { defaultFontMetrics } from '../metrics.js';
import { compareSiblings } from '../order.js';
import { cardWidth } from '../size.js';
import type { Layout } from '../types.js';

/** Up to this many zones, every split into rows is enumerated (2^(n−1) splits). */
export const EXHAUSTIVE_ZONES = 12;

export interface Child {
  readonly width: number;
  readonly height: number;
  readonly card: boolean;
}

export interface OracleArrangement {
  readonly cardColumns: number;
  readonly zoneRows: readonly number[];
  readonly width: number;
  readonly height: number;
  /** Every row full: no zone row but the last has room for the next zone, no room for one more card column. */
  readonly full: boolean;
}

/** The children of `container` (`null`: the canvas) in sibling order, at their natural (unpacked) sizes. */
export function naturalChildren(scene: Scene, layout: Layout, container: string | null): Child[] {
  const context = { sizing: DEFAULT_SIZING, metrics: defaultFontMetrics() };
  const find = (nodes: readonly SceneNode[]): readonly SceneNode[] | undefined => {
    for (const node of nodes) {
      if (node.type !== 'zone') continue;
      if (node.id === container) return node.children;
      const found = find(node.children);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  const nodes = container === null ? scene.children : (find(scene.children) ?? []);
  return [...nodes]
    .sort((a, b) =>
      compareSiblings(
        { id: a.id, type: a.type, kind: a.type === 'zone' ? a.kind : 'card', label: a.label },
        { id: b.id, type: b.type, kind: b.type === 'zone' ? b.kind : 'card', label: b.label },
      ),
    )
    .map((node) => {
      const rect = layout.rects[node.id];
      if (rect === undefined) throw new Error(`no rect for ${node.id}`);
      return node.type === 'card'
        ? { width: cardWidth(node.label, node.subtitle, context).width, height: rect.height, card: true }
        : { width: rect.width, height: rect.height, card: false };
    });
}

function compositions(count: number): number[][] {
  if (count === 0) return [[]];
  const result: number[][] = [];
  for (let first = 1; first <= count; first += 1) {
    for (const rest of compositions(count - first)) result.push([first, ...rest]);
  }
  return result;
}

function greedy(zones: readonly Child[], budget: number, gap: number): number[] {
  const rows: number[] = [];
  let length = 0;
  let width = 0;
  for (const zone of zones) {
    if (length > 0 && width + gap + zone.width > budget) {
      rows.push(length);
      length = 0;
      width = 0;
    }
    width += (length > 0 ? gap : 0) + zone.width;
    length += 1;
  }
  if (length > 0) rows.push(length);
  return rows;
}

/** Every arrangement of `children` the skill's packing rules allow (see the module comment). */
export function arrangements(children: readonly Child[]): OracleArrangement[] {
  const { gapHorizontal: h, gapVertical: v } = DEFAULT_SIZING;
  const cards = children.filter((child) => child.card);
  const zones = children.filter((child) => !child.card);

  const grid = (columns: number): { width: number; height: number } => {
    if (columns === 0) return { width: 0, height: 0 };
    const widths: number[] = [];
    const heights: number[] = [];
    cards.forEach((child, i) => {
      widths[i % columns] = Math.max(widths[i % columns] ?? 0, child.width);
      const row = Math.floor(i / columns);
      heights[row] = Math.max(heights[row] ?? 0, child.height);
    });
    return {
      width: widths.reduce((a, b) => a + b, 0) + (widths.length - 1) * h,
      height: heights.reduce((a, b) => a + b, 0) + (heights.length - 1) * v,
    };
  };

  const splits = new Map<string, number[]>();
  const addSplit = (rows: number[]): void => {
    splits.set(rows.join(','), rows);
  };
  if (zones.length <= EXHAUSTIVE_ZONES) {
    for (const rows of compositions(zones.length)) addSplit(rows);
  } else {
    for (let k = 1; k <= zones.length; k += 1) {
      const rows: number[] = [];
      for (let left = zones.length; left > 0; left -= k) rows.push(Math.min(k, left));
      addSplit(rows);
    }
    const budgets: number[] = cards.map((_, i) => grid(i + 1).width);
    for (let start = 0; start < zones.length; start += 1) {
      let width = -h;
      for (let end = start; end < zones.length; end += 1) {
        width += h + (zones[end]?.width ?? 0);
        budgets.push(width);
      }
    }
    for (const budget of budgets) addSplit(greedy(zones, budget, h));
  }

  const result: OracleArrangement[] = [];
  const columnChoices = cards.length === 0 ? [0] : cards.map((_, i) => i + 1);
  for (const cardColumns of columnChoices) {
    const block = grid(cardColumns);
    const wider = cardColumns > 0 && cardColumns < cards.length ? grid(cardColumns + 1).width : Infinity;
    for (const zoneRows of splits.values()) {
      let index = 0;
      let width = 0;
      let height = 0;
      let overflow = Infinity;
      zoneRows.forEach((length, row) => {
        const members = zones.slice(index, index + length);
        index += length;
        const rowWidth = members.reduce((a, z) => a + z.width, 0) + (length - 1) * h;
        const next = zones[index];
        if (next !== undefined) overflow = Math.min(overflow, rowWidth + h + next.width);
        width = Math.max(width, rowWidth);
        height += Math.max(...members.map((z) => z.height)) + (row > 0 ? v : 0);
      });
      const boxWidth = Math.max(block.width, width);
      const boxHeight = block.height + height + (block.height > 0 && height > 0 ? v : 0);
      result.push({
        cardColumns,
        zoneRows,
        width: boxWidth,
        height: boxHeight,
        full: wider > boxWidth && overflow > boxWidth,
      });
    }
  }
  return result;
}

/**
 * A box's frame: the box within `tolerance` of `target`, otherwise the smallest rectangle of the target's
 * aspect around it (src/pack.ts rule 3, recomputed here).
 */
export function frameArea(width: number, height: number, target: number, tolerance: number): number {
  if (Math.abs(width / height - target) <= tolerance * target) return width * height;
  return Math.max(width, height * target) * Math.max(height, width / target);
}
