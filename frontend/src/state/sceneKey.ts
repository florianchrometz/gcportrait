// SPDX-License-Identifier: Apache-2.0
/**
 * The key of the view a diagram draws: its app link's hash without the selection and the highlight, which change
 * neither the Scene nor an export. The pipeline keys its results by it (pipeline.ts); a draw.io file names its page by
 * it, so the app's export and the render library (through the headless entry) write the same page id for a view.
 * No store, no worker: plain functions of the view.
 */
import { encodeViewSpec, type ViewSpec } from '@gcportrait/model';

/** The view as its app link names it, without the selection and the highlight. */
export function drawnViewKey(spec: ViewSpec): string {
  const view: ViewSpec = { ...spec };
  delete view.selection;
  delete view.highlight;
  return encodeViewSpec(view);
}

const KEYS = new WeakMap<ViewSpec, string>();

/** The part of a view that defines its Scene ({@link drawnViewKey}); `''` without a snapshot, nothing to draw. */
export function sceneKey(spec: ViewSpec): string {
  const known = KEYS.get(spec);
  if (known !== undefined) return known;
  const key = spec.snapshot === '' ? '' : drawnViewKey(spec);
  KEYS.set(spec, key);
  return key;
}
