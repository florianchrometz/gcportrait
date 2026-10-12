// SPDX-License-Identifier: MIT
/**
 * The camera after a chip was expanded or a zone collapsed on the canvas (skill gcp-diagram-layout §6:
 * "Expanding a zone keeps the viewBox fixed and glides the camera 200 ms to frame the zone; changing the level
 * re-fits the whole diagram"). The canvas remembers which zone the person flipped (`PendingFlip`); when the
 * drawing with that flip arrives it keeps the camera where it was instead of fitting the new drawing, and glides
 * from there to the zone. Pure.
 */
import type { Rect } from '@gcportrait/layout';

import { focusTransform } from '../camera';
import type { CameraTransform } from '../viewport';

/** How long the glide to an expanded or collapsed zone takes (ms); at once with reduced motion. */
export const FLIP_GLIDE_MS = 200;

/** A flip the canvas asked for and has not seen drawn yet. */
export interface PendingFlip<Model> {
  /** The drawing the flip was made on: the glide waits for a newer one. */
  readonly model: Model;
  readonly id: string;
  /** The zone was a chip (it is being expanded) or an open zone (being collapsed). */
  readonly wasChip: boolean;
  /** Made from the keyboard: focus follows the zone into the new drawing. */
  readonly keyboard: boolean;
}

/**
 * Whether a new drawing is the one the flip asked for: it draws the zone in the other state (a chip now open,
 * an open zone now a chip). Anything else (another view arrived first, the flip did not take) is fitted as
 * usual.
 */
export function isFlipDrawn(
  pending: PendingFlip<unknown>,
  rect: { readonly role: string } | undefined,
): boolean {
  if (rect === undefined) return false;
  return pending.wasChip ? rect.role === 'zone' || rect.role === 'empty' : rect.role === 'chip';
}

/**
 * Where the camera glides to: an expanded zone is framed (centred, at 100 % or closer, or fitted when larger:
 * `focusTransform`, as a jump); a collapsed zone's chip is centred at the current scale, so collapsing never
 * zooms in.
 */
export function flipTransform(
  rect: Rect,
  width: number,
  height: number,
  current: CameraTransform,
  expanded: boolean,
): CameraTransform {
  if (expanded) return focusTransform(rect, width, height, current);
  const k = current.k;
  return { k, x: width / 2 - (rect.x + rect.width / 2) * k, y: height / 2 - (rect.y + rect.height / 2) * k };
}
