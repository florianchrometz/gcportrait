// SPDX-License-Identifier: Apache-2.0
/**
 * Packing aspect and fill per container, measured from a Layout's rects alone: the bounding box of a
 * container's children (its children grid) against the target the packer aimed for (1.6 for zones, 1.75 for
 * the canvas), and how much of that box the children cover. The golden tests assert both and the debug
 * renderer prints them.
 */
import { resolveOptions } from './layout.js';
import type { Layout, LayoutOptions } from './types.js';

export interface PackingAspect {
  /** The zone's id; `null` for the canvas. */
  readonly id: string | null;
  readonly children: number;
  /** The bounding box of the children (gaps between them included, padding and header excluded). */
  readonly width: number;
  readonly height: number;
  readonly aspect: number;
  readonly target: number;
  /** |aspect − target| / target. */
  readonly deviation: number;
  /** The children's total area over the box's area (1 = no empty space; gaps count as empty). */
  readonly fill: number;
}

/** One entry per container with at least one child: the canvas first, then open zones in paint order. */
export function packingAspects(layout: Layout, options: LayoutOptions = {}): PackingAspect[] {
  const { targetAspect, rootAspect } = resolveOptions(options);
  const boxes = new Map<
    string | null,
    { minX: number; minY: number; maxX: number; maxY: number; n: number; area: number }
  >();
  for (const rect of Object.values(layout.rects)) {
    const box = boxes.get(rect.parent);
    const right = rect.x + rect.width;
    const bottom = rect.y + rect.height;
    if (box === undefined) {
      boxes.set(rect.parent, {
        minX: rect.x,
        minY: rect.y,
        maxX: right,
        maxY: bottom,
        n: 1,
        area: rect.width * rect.height,
      });
    } else {
      box.minX = Math.min(box.minX, rect.x);
      box.minY = Math.min(box.minY, rect.y);
      box.maxX = Math.max(box.maxX, right);
      box.maxY = Math.max(box.maxY, bottom);
      box.n += 1;
      box.area += rect.width * rect.height;
    }
  }
  const order: (string | null)[] = [null, ...Object.keys(layout.rects)];
  const result: PackingAspect[] = [];
  for (const id of order) {
    const box = boxes.get(id);
    if (box === undefined) continue;
    const width = box.maxX - box.minX;
    const height = box.maxY - box.minY;
    const aspect = width / height;
    const target = id === null ? rootAspect : targetAspect;
    result.push({
      id,
      children: box.n,
      width,
      height,
      aspect,
      target,
      deviation: Math.abs(aspect - target) / target,
      fill: box.area / (width * height),
    });
  }
  return result;
}
