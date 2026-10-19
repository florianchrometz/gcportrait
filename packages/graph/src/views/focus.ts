// SPDX-License-Identifier: Apache-2.0
/**
 * Step (b) of the scene builder: focus views (docs/lenses-and-filters.md). A focus picks a part of the
 * universe below the root; the lens and the filters then apply to that part exactly as they apply to the whole
 * view. Parameters come from `ViewSpec.focus.params` and are checked against the graph: a parameter that names
 * nothing usable becomes an error in the report (never a throw), and the view falls back to its root.
 *
 * | Kind | Parameter | Shows |
 * |---|---|---|
 * | `project` | `project` (id, number or node id) | the project, and its edges leaving it with their targets as external stubs |
 * | `shared-vpc` | `host` | the host project and every project with a `shares` edge to it |
 * | `standalone-projects` | — | projects with no `shares` edge and no `peers` or `connects` relation inside them |
 * | `perimeter` | `perimeter` (node id, label or last name segment) | the node's `secures` target projects, inside it as an overlay zone |
 * | `application` | `application` (node id, label or last name segment) | the container, its contents, and what its contents reference, in their projects |
 *
 * Perimeters and applications are recognised by structure, not by asset type: a perimeter is any node whose
 * `secures` edges reach projects, an application any container. The catalog's rules decide what that covers.
 */
import type { FocusError, FocusKind, SceneFocus, ViewSpec } from '@gcportrait/model';
import { compareStrings, sortedUnique } from '../order.js';
import { FOLDER_TYPE, ORGANIZATION_TYPE, PROJECT_TYPE } from '../structure.js';
import type { RootSelection } from './root.js';
import { isAncestor, projectOf, subtree, type ViewGraph } from './view-graph.js';

export interface FocusSelection {
  /** The nodes the focus keeps (a subset of the universe, plus anchors); absent: the whole universe. */
  readonly members: ReadonlySet<string> | undefined;
  /** Nodes shown whatever the lens and the filters say: the perimeter's overlay zone, the application. */
  readonly anchors: ReadonlySet<string>;
  /** Scene-parent overrides: a perimeter's projects sit inside its overlay zone. */
  readonly sceneParent: ReadonlyMap<string, string>;
  /** The overlay zone (a perimeter). */
  readonly overlay: string | undefined;
  /** Project focus: the project's subtree. Edges from inside it to anything outside become external stubs. */
  readonly inside: ReadonlySet<string> | undefined;
  readonly outcome: SceneFocus | undefined;
  readonly warnings: readonly string[];
}

const NO_FOCUS: FocusSelection = {
  members: undefined,
  anchors: new Set(),
  sceneParent: new Map(),
  overlay: undefined,
  inside: undefined,
  outcome: undefined,
  warnings: [],
};

type Position = 'inside' | 'holds-root' | 'outside';

/** Where a node lies relative to the view: below the root, the root or above it, or elsewhere. */
function position(vg: ViewGraph, root: RootSelection, id: string): Position {
  if (root.universe.has(id)) return 'inside';
  if (root.root !== undefined && (id === root.root || isAncestor(vg, id, root.root))) return 'holds-root';
  return 'outside';
}

function lastSegment(id: string): string {
  return id.slice(id.lastIndexOf('/') + 1);
}

/** A focus error (never thrown: every step returns it). */
interface Failure {
  readonly failure: FocusError;
}

function fail(code: FocusError['code'], message: string, param?: string): Failure {
  return { failure: { code, message, ...(param === undefined ? {} : { param }) } };
}

function failed(value: string | FocusSelection | Failure): value is Failure {
  return typeof value === 'object' && 'failure' in value;
}

function label(vg: ViewGraph, id: string): string {
  return vg.nodes.get(id)?.label ?? id;
}

/** The required parameter, or a `missing-param` error. */
function required(kind: FocusKind, params: Readonly<Record<string, string>>, name: string): string | Failure {
  return params[name] ?? fail('missing-param', `The ${kind} focus needs the parameter "${name}".`, name);
}

/** A project by node id, project id, project number, or `projects/<id or number>`. */
function resolveProject(vg: ViewGraph, value: string, param: string): string | Failure {
  const aliases = vg.graph.indexes.aliases;
  const bare = value.startsWith('projects/') ? value.slice('projects/'.length) : value;
  const candidates = [value, Object.hasOwn(aliases, bare) ? aliases[bare] : undefined];
  const found = candidates.find((id) => id !== undefined && vg.nodes.get(id)?.assetType === PROJECT_TYPE);
  return found ?? fail('unknown-project', `No project "${value}" in this snapshot.`, param);
}

interface AnchorKind {
  readonly unknown: FocusError['code'];
  readonly invalid: FocusError['code'];
  readonly what: string;
  readonly why: string;
}

/**
 * A node by exact id, or by label or last name segment among the candidates. An exact id that is no candidate
 * is `invalid`; a value that matches nothing is `unknown`; one that matches several is `ambiguous`.
 */
function resolveAnchor(
  vg: ViewGraph,
  value: string,
  candidates: readonly string[],
  param: string,
  kind: AnchorKind,
): string | Failure {
  if (vg.nodes.has(value)) {
    return candidates.includes(value) ? value : fail(kind.invalid, `${label(vg, value)} ${kind.why}.`, param);
  }
  const matches = candidates.filter((id) => vg.nodes.get(id)?.label === value || lastSegment(id) === value);
  const [first, second] = matches;
  if (first === undefined) return fail(kind.unknown, `No ${kind.what} "${value}" in this snapshot.`, param);
  if (second !== undefined) {
    const count = String(matches.length);
    return fail('ambiguous', `"${value}" names ${count} ${kind.what}s; use the full resource name.`, param);
  }
  return first;
}

function outsideRoot(vg: ViewGraph, root: RootSelection, id: string, param: string): Failure {
  return fail(
    'outside-root',
    `${label(vg, id)} is outside the drill-in root ${root.label}; leave the drill-in to focus on it.`,
    param,
  );
}

interface ProjectSet {
  readonly members: ReadonlySet<string> | undefined;
  readonly projects: readonly string[];
}

/** The subtrees of the projects inside the view; the whole universe when one of them holds the root. */
function projectSet(vg: ViewGraph, root: RootSelection, projects: readonly string[]): ProjectSet {
  const holder = projects.find((project) => position(vg, root, project) === 'holds-root');
  if (holder !== undefined) return { members: undefined, projects: [holder] };
  const inView = projects.filter((project) => root.universe.has(project));
  return { members: new Set(inView.flatMap((project) => subtree(vg, project))), projects: inView };
}

function applied(kind: FocusKind, projects: readonly string[], anchor?: string): SceneFocus {
  return {
    status: 'applied',
    kind,
    ...(anchor === undefined ? {} : { anchor }),
    projects: [...projects].sort(compareStrings),
  };
}

type Params = Readonly<Record<string, string>>;

function focusProject(vg: ViewGraph, root: RootSelection, params: Params): FocusSelection | Failure {
  const value = required('project', params, 'project');
  if (failed(value)) return value;
  const project = resolveProject(vg, value, 'project');
  if (failed(project)) return project;
  const where = position(vg, root, project);
  if (where === 'outside') return outsideRoot(vg, root, project, 'project');
  const inside = new Set(subtree(vg, project));
  return {
    ...NO_FOCUS,
    members: where === 'inside' ? inside : undefined,
    inside,
    outcome: applied('project', [project], project),
  };
}

function focusSharedVpc(vg: ViewGraph, root: RootSelection, params: Params): FocusSelection | Failure {
  const value = required('shared-vpc', params, 'host');
  if (failed(value)) return value;
  const host = resolveProject(vg, value, 'host');
  if (failed(host)) return host;
  const services = sortedUnique(
    vg.graph.edges.filter((edge) => edge.kind === 'shares' && edge.to === host).map((edge) => edge.from),
  );
  if (services.length === 0) {
    const message = `${label(vg, host)} is not a Shared VPC host: no other project attaches to its networks.`;
    return fail('not-a-host', message, 'host');
  }
  const set = projectSet(vg, root, [host, ...services]);
  if (set.projects.length === 0) return outsideRoot(vg, root, host, 'host');
  return { ...NO_FOCUS, members: set.members, outcome: applied('shared-vpc', set.projects, host) };
}

function focusStandalone(vg: ViewGraph, root: RootSelection): FocusSelection {
  const connected = new Set<string>();
  const mark = (id: string): void => {
    const project = projectOf(vg, id);
    if (project !== undefined) connected.add(project);
  };
  for (const edge of vg.graph.edges) {
    if (edge.kind === 'shares' || edge.kind === 'peers' || edge.kind === 'connects') {
      mark(edge.from);
      mark(edge.to);
    }
  }
  // A peering or hybrid link to something outside the snapshot (a producer's tenant project) still counts.
  for (const edge of vg.graph.dangling) {
    if (edge.kind === 'peers' || edge.kind === 'connects') mark(edge.from);
  }
  const standalone = vg.ids.filter(
    (id) => vg.nodes.get(id)?.assetType === PROJECT_TYPE && !connected.has(id),
  );
  const set = projectSet(vg, root, standalone);
  return {
    ...NO_FOCUS,
    members: set.members,
    outcome: applied('standalone-projects', set.projects),
    warnings: set.projects.length === 0 ? ['No standalone project lies in this view.'] : [],
  };
}

const PERIMETER: AnchorKind = {
  unknown: 'unknown-perimeter',
  invalid: 'not-a-perimeter',
  what: 'perimeter',
  why: 'secures no project',
};

function focusPerimeter(vg: ViewGraph, root: RootSelection, params: Params): FocusSelection | Failure {
  const value = required('perimeter', params, 'perimeter');
  if (failed(value)) return value;
  const secured = new Map<string, string[]>();
  for (const edge of vg.graph.edges) {
    if (edge.kind !== 'secures' || vg.nodes.get(edge.to)?.assetType !== PROJECT_TYPE) continue;
    secured.set(edge.from, [...(secured.get(edge.from) ?? []), edge.to]);
  }
  const perimeter = resolveAnchor(vg, value, sortedUnique(secured.keys()), 'perimeter', PERIMETER);
  if (failed(perimeter)) return perimeter;
  const set = projectSet(vg, root, sortedUnique(secured.get(perimeter) ?? []));
  if (set.projects.length === 0) return outsideRoot(vg, root, perimeter, 'perimeter');
  if (set.members === undefined) {
    // The root lies inside one of the perimeter's projects: the whole canvas is inside the perimeter.
    return { ...NO_FOCUS, outcome: applied('perimeter', set.projects, perimeter) };
  }
  return {
    ...NO_FOCUS,
    members: new Set([...set.members, perimeter]),
    anchors: new Set([perimeter]),
    sceneParent: new Map(set.projects.map((project) => [project, perimeter])),
    overlay: perimeter,
    outcome: applied('perimeter', set.projects, perimeter),
  };
}

/** The node and its containers up to its project (inclusive); never a folder or the organisation. */
function chainToProject(vg: ViewGraph, id: string): string[] {
  const chain: string[] = [];
  for (let current: string | undefined = id; current !== undefined; current = vg.parent.get(current)) {
    const type = vg.nodes.get(current)?.assetType;
    if (type === FOLDER_TYPE || type === ORGANIZATION_TYPE) break;
    chain.push(current);
    if (type === PROJECT_TYPE) break;
  }
  return chain;
}

const APPLICATION: AnchorKind = {
  unknown: 'unknown-application',
  invalid: 'not-an-application',
  what: 'application',
  why: 'is not a container, so it cannot be an application',
};

function focusApplication(vg: ViewGraph, root: RootSelection, params: Params): FocusSelection | Failure {
  const value = required('application', params, 'application');
  if (failed(value)) return value;
  const containers = vg.ids.filter((id) => vg.nodes.get(id)?.role === 'container');
  const application = resolveAnchor(vg, value, containers, 'application', APPLICATION);
  if (failed(application)) return application;
  const where = position(vg, root, application);
  if (where === 'outside') return outsideRoot(vg, root, application, 'application');
  if (where === 'holds-root') return { ...NO_FOCUS, outcome: applied('application', [], application) };
  const own = new Set(subtree(vg, application));
  const members = new Set(own);
  for (const edge of vg.graph.edges) {
    if (edge.kind === 'shares' || !own.has(edge.from) || own.has(edge.to)) continue;
    for (const id of chainToProject(vg, edge.to)) if (root.universe.has(id)) members.add(id);
  }
  const projects = [...members].filter((id) => vg.nodes.get(id)?.assetType === PROJECT_TYPE);
  return {
    ...NO_FOCUS,
    members,
    anchors: new Set([application]),
    outcome: applied('application', projects, application),
  };
}

/** Applies the view's focus, or reports why it cannot (the view then shows its root). */
export function selectFocus(vg: ViewGraph, root: RootSelection, spec: ViewSpec): FocusSelection {
  const focus = spec.focus;
  if (focus === undefined) return NO_FOCUS;
  const params = focus.params;
  const selection = {
    project: () => focusProject(vg, root, params),
    'shared-vpc': () => focusSharedVpc(vg, root, params),
    'standalone-projects': () => focusStandalone(vg, root),
    perimeter: () => focusPerimeter(vg, root, params),
    application: () => focusApplication(vg, root, params),
  }[focus.kind]();
  if (!failed(selection)) return selection;
  return {
    ...NO_FOCUS,
    outcome: { status: 'error', kind: focus.kind, error: selection.failure },
    warnings: [`Focus not applied: ${selection.failure.message}`],
  };
}
