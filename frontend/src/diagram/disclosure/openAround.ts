// SPDX-License-Identifier: MIT
/**
 * Opening the collapsed zones around a node until it is drawn as itself (flips, layout skill §6): the one loop behind
 * a search hit's "auto-expand ancestors" and the details drawer's jump links that "flip collapsed targets open", both
 * through search/locate.ts. Worked out with the scene builder itself, so the rule of what collapses where is
 * never restated: build the view with the node as its selection, read which Scene node shows it
 * (`report.selection.shownAs`: the node, or the outermost chip it is collapsed into), toggle that chip's flip
 * (exactly what a click on the chip does), and build again, one level deeper each time. Toggling the flip of a zone
 * that is collapsed always opens it, whatever collapsed it (the detail level, the depth filter or an earlier flip),
 * and never closes anything that was open. Pure; runs in the data worker, where the Graph is.
 */
import { buildSceneWithReport, flipIdOf } from '@gcportrait/graph';
import {
  normalizeViewSpec,
  type Catalog,
  type Graph,
  type SceneEnv,
  type SceneReport,
  type ViewSpec,
} from '@gcportrait/model';

/** At most this many zones are opened around one node: more levels than any containment chain has. */
export const MAX_OPEN_ZONES = 16;

/** What the data worker builds Scenes with. */
export interface SceneContext {
  readonly graph: Graph;
  readonly catalog: Catalog;
  /** The environment the data worker builds the view's Scene with (read time, root label, `auto` budget). */
  readonly env: SceneEnv;
}

export interface OpenedAround {
  /** The Scene node that showed the node before any flip; undefined when the view leaves it out. */
  readonly first: string | undefined;
  /** The report of the view before any flip (the root and focus it used). */
  readonly report: SceneReport;
  /** Whether the view, with `opened` flipped open, draws the node as itself. */
  readonly reached: boolean;
  /** The view with those flips (normalised; the input's flips when nothing was opened). */
  readonly view: ViewSpec;
  /** The zones flipped open, outermost first. */
  readonly opened: readonly string[];
}

/** The view with one zone's flip toggled (`ViewActions.flip`'s rule). */
export function toggleFlip(view: ViewSpec, zoneId: string): ViewSpec {
  const token = flipIdOf(zoneId);
  const flips = view.flips.includes(token)
    ? view.flips.filter((flip) => flip !== token)
    : [...view.flips, token];
  return normalizeViewSpec({ ...view, flips });
}

function shownAs(context: SceneContext, view: ViewSpec, id: string): { report: SceneReport; at?: string } {
  const { report } = buildSceneWithReport(
    context.graph,
    { ...view, selection: id },
    context.catalog,
    context.env,
  );
  const at = report.selection?.shownAs;
  return at === undefined ? { report } : { report, at };
}

/** Builds `view` and opens the chips around node `id`, one level at a time, until it shows as itself. */
export function openAround(context: SceneContext, view: ViewSpec, id: string): OpenedAround {
  const start = normalizeViewSpec(view);
  const first = shownAs(context, start, id);
  let current = start;
  let at = first.at;
  const opened: string[] = [];
  while (at !== undefined && at !== id && !opened.includes(at) && opened.length < MAX_OPEN_ZONES) {
    opened.push(at);
    current = toggleFlip(current, at);
    at = shownAs(context, current, id).at;
  }
  return { first: first.at, report: first.report, reached: at === id, view: current, opened };
}
