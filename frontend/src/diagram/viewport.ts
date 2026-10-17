// SPDX-License-Identifier: MIT
/**
 * Camera arithmetic for the canvas (zoom and pan with d3-zoom, `scaleExtent [0.05, 200]`; AGENTS.md, Architecture and
 * code). Pure.
 */
import type { Rect } from '@gcportrait/layout';

export const SCALE_EXTENT: readonly [number, number] = [0.05, 200];
/**
 * How far (CSS px) a mouse or a pen may move between its press and its release and still click (d3-zoom's
 * `clickDistance`): a hand's wobble. Further, it is a drag, which pans and selects nothing.
 */
export const CLICK_DISTANCE = 4;
/** Space kept around the drawing when it is fitted to the canvas (CSS px). */
export const FIT_PADDING = 16;

export interface CameraTransform {
  readonly x: number;
  readonly y: number;
  readonly k: number;
}

/**
 * The transform that shows the whole `frame` centred in a `width` × `height` canvas: never enlarged past
 * 100 % (a small diagram stays at its natural size), never below the scale extent.
 */
export function fitTransform(
  frame: Rect,
  width: number,
  height: number,
  padding = FIT_PADDING,
): CameraTransform {
  const room = (size: number): number => Math.max(1, size - 2 * padding);
  const fit = Math.min(room(width) / Math.max(1, frame.width), room(height) / Math.max(1, frame.height), 1);
  const k = Math.min(SCALE_EXTENT[1], Math.max(SCALE_EXTENT[0], fit));
  return {
    k,
    x: (width - frame.width * k) / 2 - frame.x * k,
    y: (height - frame.height * k) / 2 - frame.y * k,
  };
}
