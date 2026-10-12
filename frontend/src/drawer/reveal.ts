// SPDX-License-Identifier: MIT
/**
 * Opening the collapsed zones around a node so that it is drawn (flips, layout skill §6; the drawer's jump links
 * flip collapsed targets open): the loop of diagram/disclosure/openAround.ts, which search's locate
 * shares, so the rule of what collapses where is never restated. Pure; runs in the data worker.
 */
import type { Catalog, Graph, SceneEnv, ViewSpec } from '@gcportrait/model';

import { openAround } from '../diagram/disclosure/openAround';
import type { RevealAnswer } from './types';

/** The flips that draw `node` in the view `spec`; the view's own when no flip can (or none is needed). */
export function revealFlips(
  graph: Graph,
  spec: ViewSpec,
  catalog: Catalog,
  env: SceneEnv,
  node: string,
): RevealAnswer {
  const around = openAround({ graph, catalog, env }, spec, node);
  return around.reached ? { shown: true, flips: around.view.flips } : { shown: false, flips: spec.flips };
}
