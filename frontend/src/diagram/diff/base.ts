// SPDX-License-Identifier: MIT
/**
 * Which day a new diagram is compared with: the tick displayed before (docs/timeline.md). The
 * store's pipeline asks it before each Scene request and sends the answer with it; the data worker then compares
 * the day it draws with that one. Pure.
 *
 * - Another day of the snapshot on screen: the day on screen (whatever moved the view: a step, the slider,
 *   playback, Back).
 * - The same day again (another lens, a filter, a flip, the canvas resized): the day the diagram on screen was
 *   compared with, so the markers stay for as long as the day does ("for one tick").
 * - Another snapshot, or nothing on screen (a link opened, a reload): no diff.
 */
import type { ViewSpec } from '@gcportrait/model';

import type { SceneAnswer } from '../pipeline/protocol';
import type { DiffFrom } from './types';

/** The diagram on screen, as the pipeline holds it. */
export interface OnScreen {
  readonly answer: Pick<SceneAnswer, 'source' | 'diff'>;
}

/** The day to compare view `view` with (its `tick` is the day the pipeline draws), or undefined for none. */
export function diffFrom(
  onScreen: OnScreen | null,
  view: Pick<ViewSpec, 'snapshot' | 'tick'>,
): DiffFrom | undefined {
  if (onScreen === null || view.snapshot === '' || onScreen.answer.source.ref !== view.snapshot)
    return undefined;
  const shown = onScreen.answer.source.tick ?? null;
  const wanted = view.tick ?? null;
  if (wanted !== shown) return { tick: shown };
  const since = onScreen.answer.diff?.since;
  return since === undefined ? undefined : { tick: since.tick ?? null };
}
