// SPDX-License-Identifier: MIT
/**
 * Where a node is in a view, and what would show it: the facts of reveal.ts's decision table, worked out with
 * the scene builder itself, and the offers, each checked by building the view it proposes. Pure; runs in the
 * data worker, where the Graph is, with the environment the data worker builds Scenes with, so what it finds
 * is what the page will draw.
 *
 * The scene builder reports the scene node that shows a selection (`report.selection.shownAs`: the node itself,
 * or the outermost collapsed zone around it). While that is a chip, its zone's flip is toggled (exactly what a
 * click on the chip does) and the view built again, one level deeper each time, until the node shows as itself:
 * those flips are the "auto-expand ancestors" of a search hit, and what a jump link of the details drawer opens
 * (the loop is diagram/disclosure/openAround.ts's). The drawer asks without offers: a node the view does not reach
 * is then `unavailable`, and no offer's view is built.
 */
import { matchesTypePattern } from '@gcportrait/catalog';
import { ORGANIZATION_TYPE, PROJECT_TYPE } from '@gcportrait/graph';
import {
  LENS_IDS,
  normalizeViewSpec,
  type Catalog,
  type Graph,
  type GraphNode,
  type SceneReport,
  type ViewFilters,
  type ViewSpec,
  type ViewSpecInput,
} from '@gcportrait/model';

import { openAround, type SceneContext } from '../diagram/disclosure/openAround';
import { cardTypeName } from '../diagram/names';
import { viewWithLens, type LensDefaults } from '../views/lensDetail';
import type { LocateAnswer, LocateQuery, RevealContext, RevealOffer } from './protocol';
import { decideReveal, type RevealFacts, type RevealStep } from './reveal';

export type LocateContext = SceneContext;

interface Trial {
  /** How the view showed the node before any flip. */
  readonly initially: RevealFacts['shown'];
  /** Whether the view, with `opened` flipped open, shows it as itself. */
  readonly reachable: boolean;
  /** The view with those flips. */
  readonly view: ViewSpec;
  /** The zones flipped open, outermost first. */
  readonly opened: readonly string[];
  /** The report of the view before any flip (the root and focus it used). */
  readonly report: SceneReport;
}

/** The part of a view that defines its Scene: selection and highlight dropped. */
export function sceneView(spec: ViewSpec): ViewSpec {
  const next: ViewSpecInput = { ...spec };
  delete next.selection;
  delete next.highlight;
  return normalizeViewSpec(next);
}

/** Builds `view` and opens the chips around the node, one level at a time, until it shows as itself. */
function trial(context: LocateContext, view: ViewSpec, id: string): Trial {
  const around = openAround(context, view, id);
  const initially: Trial['initially'] =
    around.first === undefined ? 'absent' : around.first === id ? 'self' : 'chip';
  return {
    initially,
    reachable: around.reached,
    view: around.view,
    opened: around.opened,
    report: around.report,
  };
}

/** The containers above a node, closest first. */
function ancestorsOf(graph: Graph, id: string): string[] {
  const ancestors: string[] = [];
  let parent = graph.containment.parent[id];
  while (parent !== undefined && !ancestors.includes(parent) && parent !== id) {
    ancestors.push(parent);
    parent = graph.containment.parent[parent];
  }
  return ancestors;
}

/**
 * The container "drill in" re-roots at: the node's project, else its parent (a folder), else none (the whole
 * organisation).
 */
export function drillTarget(graph: Graph, id: string): string | undefined {
  const ancestors = ancestorsOf(graph, id);
  const project = ancestors.find((ancestor) => graph.nodes[ancestor]?.assetType === PROJECT_TYPE);
  if (project !== undefined) return project;
  const parent = ancestors[0];
  if (parent === undefined || graph.nodes[parent]?.assetType === ORGANIZATION_TYPE) return undefined;
  return parent;
}

function withoutFocus(view: ViewSpec): ViewSpec {
  const next: ViewSpecInput = { ...view };
  delete next.focus;
  return normalizeViewSpec(next);
}

/** Whether any filter that can remove a node by itself is set (type filters are the lens facts). */
function filtersSet(filters: ViewFilters): boolean {
  return (
    filters.hideEmptyProjects ||
    filters.hideEmptyFolders ||
    filters.hideDisconnected ||
    filters.regions !== undefined ||
    filters.projects !== undefined ||
    filters.folders !== undefined ||
    filters.depth !== undefined ||
    filters.showIdentities === false
  );
}

/** The facts of a node the view does not reach (reveal.ts). */
function revealFacts(context: LocateContext, view: ViewSpec, node: GraphNode, base: Trial): RevealFacts {
  const { graph } = context;
  const ancestors = ancestorsOf(graph, node.id);
  const root = base.report.root.used;
  const outsideRoot = root !== undefined && (root === node.id || !ancestors.includes(root));
  let outsideFocus = false;
  const focus = base.report.focus;
  if (focus?.status === 'applied') {
    const project =
      node.assetType === PROJECT_TYPE
        ? node.id
        : ancestors.find((ancestor) => graph.nodes[ancestor]?.assetType === PROJECT_TYPE);
    const inProjects = project !== undefined && focus.projects.includes(project);
    // An application or perimeter focus draws only part of its projects: the view without it decides.
    outsideFocus = !inProjects || (!outsideRoot && trial(context, withoutFocus(view), node.id).reachable);
  }
  const lens = context.catalog.lenses[view.lens];
  const type = node.assetType;
  const matches = (patterns: readonly string[] | undefined): boolean =>
    (patterns ?? []).some((pattern) => matchesTypePattern(pattern, type));
  const included = matches(view.filters.includeTypes);
  const listed = matches(lens.types) || included;
  const hidden: RevealFacts['hidden'] =
    !node.hidden || lens.showHidden
      ? 'no'
      : node.hiddenWhenMatched === true
        ? 'when'
        : included
          ? 'no'
          : 'role';
  return {
    shown: base.initially,
    expandable: false,
    outsideRoot,
    outsideFocus,
    lens: matches(view.filters.excludeTypes) ? 'excluded' : listed ? 'listed' : 'unlisted',
    hidden,
    filtered: filtersSet(view.filters),
  };
}

/** Each lens's default detail level, from the catalog (the Lens picker gets the same through the lens list). */
export function lensDefaultsOf(catalog: Pick<Catalog, 'lenses'>): LensDefaults {
  return Object.fromEntries(LENS_IDS.map((id) => [id, catalog.lenses[id].defaultDetail]));
}

/**
 * The view with an offer's steps applied (flips not yet added). Switching to the Everything lens follows the same
 * lens/detail rule as the Lens picker (views/lensDetail.ts): a level that follows the lens becomes `auto`,
 * a level the person chose stays.
 */
export function applySteps(
  context: Pick<LocateContext, 'graph' | 'catalog'>,
  view: ViewSpec,
  node: GraphNode,
  steps: readonly RevealStep[],
): ViewSpec {
  const { graph, catalog } = context;
  const next: ViewSpecInput = { ...view };
  let filters: ViewFilters = view.filters;
  for (const step of steps) {
    switch (step) {
      case 'drill-in': {
        const target = drillTarget(graph, node.id);
        if (target === undefined) delete next.root;
        else next.root = target;
        delete next.focus;
        break;
      }
      case 'everything-lens': {
        const switched = viewWithLens(view, 'everything', lensDefaultsOf(catalog));
        next.lens = 'everything';
        if (switched.detail !== undefined) next.detail = switched.detail;
        break;
      }
      case 'include-type': {
        // Include the type, and lift an exclusion that names it (exclusion wins over inclusion).
        const kept = (filters.excludeTypes ?? []).filter(
          (pattern) => !matchesTypePattern(pattern, node.assetType),
        );
        const included: ViewFilters = {
          ...filters,
          includeTypes: [...(filters.includeTypes ?? []), node.assetType],
        };
        if (kept.length === 0) delete included.excludeTypes;
        else included.excludeTypes = kept;
        filters = included;
        break;
      }
      case 'clear-filters': {
        // Everything that removes nodes by place or by emptiness; the type filters are the other steps'.
        const cleared: ViewFilters = {
          ...filters,
          hideEmptyProjects: false,
          hideEmptyFolders: false,
          hideDisconnected: false,
        };
        delete cleared.regions;
        delete cleared.projects;
        delete cleared.folders;
        delete cleared.depth;
        if (cleared.showIdentities === false) delete cleared.showIdentities;
        filters = cleared;
        break;
      }
    }
  }
  next.filters = filters;
  return normalizeViewSpec(next);
}

function labelOf(graph: Graph, id: string): string {
  return graph.nodes[id]?.label ?? id.slice(id.lastIndexOf('/') + 1);
}

function revealContext(
  context: LocateContext,
  view: ViewSpec,
  node: GraphNode,
  report: SceneReport,
): RevealContext {
  const { graph, catalog } = context;
  const root = report.root.used;
  const target = drillTarget(graph, node.id);
  return {
    label: node.label,
    typeName: cardTypeName(node.product, node.assetType),
    ...(root === undefined ? {} : { root: labelOf(graph, root) }),
    lensTitle: catalog.lenses[view.lens].title,
    everythingTitle: catalog.lenses.everything.title,
    ...(target === undefined ? {} : { drillTarget: labelOf(graph, target) }),
  };
}

/**
 * Where `id` is in `spec`'s view and what shows it (protocol.ts's `LocateAnswer`); without `offers` (a jump link's
 * locate), a node the view does not reach is `unavailable` and no offer is tried.
 */
export function locateNode(
  context: LocateContext,
  spec: ViewSpec,
  id: string,
  options: Pick<LocateQuery, 'offers'> = { offers: true },
): LocateAnswer {
  const node = context.graph.nodes[id];
  if (node === undefined || node.assetType === ORGANIZATION_TYPE) return { kind: 'missing' };
  const view = sceneView(spec);
  const base = trial(context, view, id);
  const reveal = revealContext(context, view, node, base.report);
  const facts: RevealFacts = base.reachable
    ? {
        shown: base.initially,
        expandable: true,
        outsideRoot: false,
        outsideFocus: false,
        lens: 'listed',
        hidden: 'no',
        filtered: false,
      }
    : revealFacts(context, view, node, base);
  const decision = decideReveal(facts);
  switch (decision.kind) {
    case 'jump':
      return { kind: 'shown', context: reveal };
    case 'expand':
      return {
        kind: 'expand',
        context: reveal,
        view: base.view,
        opened: base.opened.map((zone) => labelOf(context.graph, zone)),
      };
    case 'unavailable':
      return { kind: 'unavailable', context: reveal, facts };
    case 'offer': {
      if (!options.offers) return { kind: 'unavailable', context: reveal, facts };
      const offers: RevealOffer[] = [];
      const working = new Set<string>();
      for (const steps of decision.candidates) {
        const key = steps.filter((step) => step !== 'clear-filters').join('+');
        // A "clear the filters" variant is only offered when its offer does not work without it.
        if (steps.includes('clear-filters') && working.has(key)) continue;
        const result = trial(context, applySteps(context, view, node, steps), id);
        if (!result.reachable) continue;
        working.add(key);
        offers.push({ steps, view: result.view });
      }
      return offers.length === 0
        ? { kind: 'unavailable', context: reveal, facts }
        : { kind: 'offer', context: reveal, facts, offers };
    }
  }
}
