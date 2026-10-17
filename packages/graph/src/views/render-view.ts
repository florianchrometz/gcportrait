// SPDX-License-Identifier: MIT
/**
 * The ViewSpec of a render's view (`RenderView` of `@gcportrait/model`): the view `POST /api/render`,
 * `pnpm render` and `pnpm render-scene` take, as an app link's hash or as explicit fields. One resolution for
 * all three (the render library re-exports it), so a view draws the same from each.
 */
import {
  decodeViewSpec,
  normalizeViewSpec,
  type RenderView,
  type SnapshotRef,
  type ViewSpec,
} from '@gcportrait/model';

import { flipIdOf } from './flip.js';

/**
 * The ViewSpec of `view` for `snapshot`. A hash (with or without its `#`) is decoded leniently by
 * `decodeViewSpec`, as the app decodes its URL, and its own `snapshot` is replaced; explicit fields are
 * normalised (lens `overview` and detail `auto` by default), the flips' zone ids turned into flip tokens.
 */
export function viewSpecOf(view: RenderView, snapshot: SnapshotRef): ViewSpec {
  if (view.hash !== undefined) {
    const decoded = decodeViewSpec(view.hash.startsWith('#') ? view.hash : `#${view.hash}`);
    return { ...decoded, snapshot };
  }
  return normalizeViewSpec({
    snapshot,
    lens: view.lens ?? 'overview',
    detail: view.detail ?? 'auto',
    filters: view.filters ?? {},
    flips: (view.flips ?? []).map(flipIdOf),
    ...(view.focus === undefined ? {} : { focus: view.focus }),
    ...(view.root === undefined ? {} : { root: view.root }),
  });
}
