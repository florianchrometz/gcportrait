// SPDX-License-Identifier: MIT
/**
 * Test helper (not part of the public API): checks, from a Layout's rects alone, that every container's rows
 * are full (packing rule 1 in src/pack.ts): no zone row but the last has room for the next zone within the
 * children box's width, and the card grid could not take one more column within that width. Independent of
 * the packer: rows are read back from the rects' positions, card widths are re-measured from the Scene.
 */
import type { Scene, SceneNode } from '@gcportrait/model';
import { resolveOptions } from '../layout.js';
import { cardWidth } from '../size.js';
import type { Layout, LayoutOptions, LayoutRect } from '../types.js';

export interface RowViolation {
  readonly container: string | null;
  readonly message: string;
}

export function fullRowViolations(scene: Scene, layout: Layout, options: LayoutOptions = {}): RowViolation[] {
  const { sizing, gutters, fontMetrics } = resolveOptions(options);
  const natural = new Map<string, number>();
  const visit = (nodes: readonly SceneNode[]): void => {
    for (const node of nodes) {
      if (node.type === 'card') {
        natural.set(node.id, cardWidth(node.label, node.subtitle, { sizing, metrics: fontMetrics }).width);
      } else visit(node.children);
    }
  };
  visit(scene.children);

  const byParent = new Map<string | null, [string, LayoutRect][]>();
  for (const [id, rect] of Object.entries(layout.rects)) {
    byParent.set(rect.parent, [...(byParent.get(rect.parent) ?? []), [id, rect]]);
  }
  const violations: RowViolation[] = [];
  for (const [container, children] of byParent) {
    const widening =
      container === null
        ? gutters.canvas
        : gutters.zones !== undefined && Object.hasOwn(gutters.zones, container)
          ? gutters.zones[container]
          : undefined;
    const gap = sizing.gapHorizontal + (widening?.horizontal ?? 0);
    const left = Math.min(...children.map(([, r]) => r.x));
    const width = Math.max(...children.map(([, r]) => r.x + r.width)) - left;
    const readingOrder = (a: [string, LayoutRect], b: [string, LayoutRect]): number =>
      a[1].y - b[1].y || a[1].x - b[1].x;

    // Zone rows: a row starts with a zone at or below the bottom of every zone so far; a zone that starts
    // inside the row's band sits in it (side by side, or stacked under another zone of the row: ADR 0026).
    // A row's cells are its zones sharing a left edge (a stack is left-aligned).
    const zones = children.filter(([, r]) => r.role !== 'card').sort(readingOrder);
    const rows: [string, LayoutRect][][] = [];
    let bottom = -Infinity;
    for (const zone of zones) {
      const row = rows[rows.length - 1];
      if (row !== undefined && zone[1].y < bottom) row.push(zone);
      else rows.push([zone]);
      bottom = Math.max(bottom, zone[1].y + zone[1].height);
    }
    const cellWidth = (row: readonly [string, LayoutRect][], x: number): number =>
      Math.max(...row.filter(([, r]) => r.x === x).map(([, r]) => r.width));
    rows.slice(0, -1).forEach((row, index) => {
      const left = Math.min(...row.map(([, r]) => r.x));
      const right = Math.max(...row.map(([, r]) => r.x + r.width));
      const following = rows[index + 1];
      if (following === undefined) return;
      const nextLeft = Math.min(...following.map(([, r]) => r.x));
      if (right - left + gap + cellWidth(following, nextLeft) <= width) {
        violations.push({ container, message: `zone row ${String(index)} has room for the next zone` });
      }
    });

    const cards = children.filter(([, r]) => r.role === 'card').sort(readingOrder);
    const columns = new Set(cards.map(([, r]) => r.x)).size;
    if (cards.length > columns) {
      const widths = new Array<number>(columns + 1).fill(0);
      cards.forEach(([id], i) => {
        widths[i % (columns + 1)] = Math.max(widths[i % (columns + 1)] ?? 0, natural.get(id) ?? 0);
      });
      const wider = widths.reduce((a, b) => a + b, 0) + columns * gap;
      if (wider <= width) {
        violations.push({ container, message: `the card grid has room for column ${String(columns + 1)}` });
      }
    }
  }
  return violations;
}
