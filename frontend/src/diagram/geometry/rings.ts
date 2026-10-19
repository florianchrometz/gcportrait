// SPDX-License-Identifier: Apache-2.0
/**
 * Ring geometry for the highlight marks (skill gcp-diagram-style §6): a node's outline moved `distance` outside
 * its border (the selection, reach and focus rings sit outside a canvas gap; the path-to-root rings sit on the
 * border), and the same outline as path data, so many reached nodes can share one `<path>` whose `d` the
 * painter sets (attributes only, never new elements). Pure.
 */
import type { Rect } from '@gcportrait/layout';

import { fmt } from './edgePath';

/** The rect grown by `distance` on every side. */
export function ringBox(rect: Rect, distance: number): Rect {
  return {
    x: rect.x - distance,
    y: rect.y - distance,
    width: rect.width + 2 * distance,
    height: rect.height + 2 * distance,
  };
}

/** A rounded rectangle as path data, clockwise from the top-left corner's end; the radius is clamped to fit. */
export function roundedRectPath(box: Rect, radius: number): string {
  const r = Math.max(0, Math.min(radius, box.width / 2, box.height / 2));
  const { x, y, width, height } = box;
  const right = x + width;
  const bottom = y + height;
  if (r === 0) return `M${fmt(x)} ${fmt(y)}H${fmt(right)}V${fmt(bottom)}H${fmt(x)}Z`;
  const arc = `A${fmt(r)} ${fmt(r)} 0 0 1`;
  return (
    `M${fmt(x + r)} ${fmt(y)}H${fmt(right - r)}${arc} ${fmt(right)} ${fmt(y + r)}` +
    `V${fmt(bottom - r)}${arc} ${fmt(right - r)} ${fmt(bottom)}` +
    `H${fmt(x + r)}${arc} ${fmt(x)} ${fmt(bottom - r)}` +
    `V${fmt(y + r)}${arc} ${fmt(x + r)} ${fmt(y)}Z`
  );
}
