// SPDX-License-Identifier: MIT
/**
 * The composition table: lens × focus × filters × root × detail on the demo organisations S and M.
 *
 * 1. Every lens × every focus view (and none) × the standard filter set, on S and M: each combination is its
 *    own test case, checked by the independent oracle (`oracle.ts`).
 * 2. Drill-in on a folder, a project and a VPC × the standard filter set × three lenses, same oracle.
 * 3. Filters under drill-in and focus (filters compose with focus views and drill-in: AGENTS.md, Product
 *    rules): in every drill-in and focus context, each filter changes the view exactly when the unfiltered
 *    view holds something the filter removes, and the filtered view satisfies the filter. The matrix of which
 *    filter bites where is pinned per size.
 * 4. Named rows with specific expectations: ids present or absent, counts, chips, edge kinds.
 * 5. A zone whose suffix is longer than one letter (an AI zone) in every drill-in and focus context that holds
 *    its project × the regions filter and the region zones: the filter and the drawing put it in one region.
 */
import type {
  DetailLevel,
  Focus,
  FocusKind,
  Graph,
  LensId,
  Scene,
  SceneBuild,
  SceneNode,
  ViewFilters,
  ViewSpecInput,
} from '@gcportrait/model';
import { LensIdSchema } from '@gcportrait/model';
import { describe, expect, it } from 'vitest';
import { REAL_CATALOG } from '../../src/testing/fixtures.js';
import { childIds, parentOf, placed, shows, zone, zones } from '../../src/testing/scene.js';
import { view } from '../../src/testing/views.js';
import { flipIdOf } from '../../src/views/flip.js';
import { buildSceneWithReport } from '../../src/views/scene.js';
import {
  AI_ZONE,
  AI_ZONE_DISK,
  APPLICATION,
  APP_SERVICE_API,
  ORDERS_API,
  ORDERS_DB,
  READ_TIME,
  WEB_MIG,
  demoGraphBuild,
  type DemoSize,
} from './fixtures.js';
import { violations } from './oracle.js';

const CATALOG = REAL_CATALOG;
const SIZES: readonly DemoSize[] = ['S', 'M'];
const LENSES: readonly LensId[] = LensIdSchema.options;

const HOST_VPC = '//compute.googleapis.com/projects/demo-net-1/global/networks/vpc-shared-prod';
const PERIMETER =
  '//accesscontextmanager.googleapis.com/accessPolicies/40000000001/servicePerimeters/data_perimeter';

function graphOf(size: DemoSize): Graph {
  return demoGraphBuild(size).graph;
}

function folderNamed(size: DemoSize, label: string): string {
  const found = Object.values(graphOf(size).nodes).find(
    (node) => node.assetType === 'cloudresourcemanager.googleapis.com/Folder' && node.label === label,
  );
  if (found === undefined) throw new Error(`no folder ${label} in ${size}`);
  return found.id;
}

function projectNamed(size: DemoSize, projectId: string): string {
  const id = graphOf(size).indexes.aliases[projectId];
  if (id === undefined) throw new Error(`no project ${projectId} in ${size}`);
  return id;
}

/** The standard filter set. */
const FILTER_SETS: Readonly<Record<string, Partial<ViewFilters>>> = {
  none: {},
  'hide-empty-projects': { hideEmptyProjects: true },
  'hide-empty-folders': { hideEmptyFolders: true },
  'hide-empty': { hideEmptyProjects: true, hideEmptyFolders: true },
  'hide-disconnected': { hideDisconnected: true },
  // All three together: hiding an empty project can leave a node disconnected, so they repeat to a fixpoint.
  'hide-all': { hideEmptyProjects: true, hideEmptyFolders: true, hideDisconnected: true },
  'include-types': { includeTypes: ['storage.googleapis.com/*', 'iam.googleapis.com/ServiceAccount'] },
  'exclude-types': { excludeTypes: ['compute.googleapis.com/Instance', 'compute.googleapis.com/Subnetwork'] },
  'depth-1': { depth: 1 },
  'depth-2': { depth: 2 },
  regions: { regions: ['us-central1'] },
  projects: { projects: ['demo-web-1', 'demo-net-1', 'demo-svc-1'] },
  'show-regions': { showRegions: true, regions: ['europe-west3'] },
};
const FILTER_NAMES = Object.keys(FILTER_SETS);

/** The focus views with parameters that name real things in both demo organisations. */
const FOCUSES: Readonly<Record<FocusKind | 'none', Focus | undefined>> = {
  none: undefined,
  project: { kind: 'project', params: { project: 'demo-web-1' } },
  'shared-vpc': { kind: 'shared-vpc', params: { host: 'demo-net-1' } },
  'standalone-projects': { kind: 'standalone-projects', params: {} },
  perimeter: { kind: 'perimeter', params: { perimeter: 'data_perimeter' } },
  application: { kind: 'application', params: { application: APPLICATION } },
};
const FOCUS_NAMES = Object.keys(FOCUSES) as (FocusKind | 'none')[];

function build(size: DemoSize, input: ViewSpecInput, budget?: number): SceneBuild {
  return buildSceneWithReport(graphOf(size), view(input), CATALOG, {
    readTime: READ_TIME,
    ...(budget === undefined ? {} : { viewportBudget: budget }),
  });
}

/**
 * Section 3's unfiltered views: each context's view in a filter's lens and in the everything lens recurs in every
 * row of that context and in the bite matrix, so it is built once (scenes are read-only).
 */
const unfiltered = new Map<string, SceneBuild>();
function buildOnce(size: DemoSize, input: ViewSpecInput): SceneBuild {
  const key = `${size} ${JSON.stringify(view(input))}`;
  let result = unfiltered.get(key);
  if (result === undefined) {
    result = build(size, input);
    unfiltered.set(key, result);
  }
  return result;
}

function check(size: DemoSize, input: ViewSpecInput): SceneBuild {
  const spec = view(input);
  const result = build(size, input);
  expect(violations(graphOf(size), spec, CATALOG, result)).toEqual([]);
  return result;
}

describe('1. every lens × every focus × the standard filter set (oracle)', () => {
  const rows = SIZES.flatMap((size) =>
    LENSES.flatMap((lens) =>
      FOCUS_NAMES.flatMap((focus) => FILTER_NAMES.map((filters) => ({ size, lens, focus, filters }))),
    ),
  );
  it.each(rows)('$size · $lens · focus $focus · filters $filters', ({ size, lens, focus, filters }) => {
    const selected = FOCUSES[focus];
    const result = check(size, {
      lens,
      detail: 'all',
      filters: FILTER_SETS[filters] ?? {},
      ...(selected === undefined ? {} : { focus: selected }),
    });
    if (selected !== undefined) expect(result.report.focus?.status).toBe('applied');
  });
});

describe('2. drill-in on a folder, a project and a VPC × the standard filter set (oracle)', () => {
  const roots = (size: DemoSize): Record<string, string> => ({
    folder: folderNamed(size, 'Workloads'),
    project: projectNamed(size, 'demo-web-1'),
    vpc: HOST_VPC,
  });
  const rows = SIZES.flatMap((size) =>
    ['folder', 'project', 'vpc'].flatMap((root) =>
      (['overview', 'networking', 'everything'] as const).flatMap((lens) =>
        FILTER_NAMES.map((filters) => ({ size, root, lens, filters })),
      ),
    ),
  );
  it.each(rows)('$size · root $root · $lens · filters $filters', ({ size, root, lens, filters }) => {
    const id = roots(size)[root] ?? '';
    const result = check(size, { lens, root: id, detail: 'all', filters: FILTER_SETS[filters] ?? {} });
    expect(result.report.root).toEqual({ requested: id, used: id });
    expect(shows(result.scene, id)).toBe(false);
  });
});

/** Asset zones that enclose each scene node (bundles, region zones and overlays are no level). */
function depthOf(result: SceneBuild): Map<string, number> {
  const overlays = new Set(result.report.overlays.map((overlay) => overlay.zone));
  const depths = new Map<string, number>();
  const visit = (nodes: readonly SceneNode[], depth: number): void => {
    for (const node of nodes) {
      const counted =
        node.type === 'zone' && node.kind !== 'group' && node.kind !== 'region' && !overlays.has(node.id);
      depths.set(node.id, counted ? depth + 1 : depth);
      if (node.type === 'zone') visit(node.children, counted ? depth + 1 : depth);
    }
  };
  visit(result.scene.children, 0);
  return depths;
}

function isStub(scene: Scene, id: string): boolean {
  const all = placed(scene);
  for (let current: string | undefined = id; current !== undefined; current = all.get(current)?.parent) {
    const node = all.get(current)?.node;
    if (node?.type === 'zone' && node.badges.includes('external')) return true;
  }
  return false;
}

/** The focus's anchor (a perimeter overlay or an application), which the filters never remove. */
function isAnchor({ report }: SceneBuild, id: string): boolean {
  const focus = report.focus;
  return (
    focus?.status === 'applied' &&
    focus.anchor === id &&
    (focus.kind === 'perimeter' || focus.kind === 'application')
  );
}

function degree(scene: Scene, id: string): number {
  return scene.edges.filter((edge) => edge.from === id || edge.to === id).length;
}

function emptyZone(node: SceneNode): boolean {
  return node.type === 'zone' && node.collapsed === undefined && node.children.length === 0;
}

function deeperThan(result: SceneBuild, limit: number): boolean {
  const all = placed(result.scene);
  return [...depthOf(result)].some(([id, depth]) => {
    const node = all.get(id)?.node;
    return (
      node?.type === 'zone' &&
      node.children.length > 0 &&
      depth > limit &&
      node.kind !== 'group' &&
      node.kind !== 'region'
    );
  });
}

interface ProofFilter {
  readonly filters: Partial<ViewFilters>;
  /** The lens of the context; `include-types` starts from a narrow lens so that it has something to add. */
  readonly lens: LensId;
  /**
   * Whether the unfiltered view (`unfiltered`, in the filter's lens; `everything`, the same context in the
   * everything lens) holds something the filter must change.
   */
  readonly bites: (size: DemoSize, unfiltered: SceneBuild, everything: SceneBuild) => boolean;
}

const EXCLUDED = ['compute.googleapis.com/Instance', 'compute.googleapis.com/Subnetwork'];
const INCLUDED = /^(storage\.googleapis\.com\/|iam\.googleapis\.com\/ServiceAccount$)/;

const PROOF_FILTERS: Readonly<Record<string, ProofFilter>> = {
  'exclude-types': {
    filters: { excludeTypes: EXCLUDED },
    lens: 'everything',
    bites: (size, result) =>
      [...placed(result.scene).keys()].some(
        (id) => !isAnchor(result, id) && EXCLUDED.includes(graphOf(size).nodes[id]?.assetType ?? ''),
      ),
  },
  'include-types': {
    filters: { includeTypes: ['storage.googleapis.com/*', 'iam.googleapis.com/ServiceAccount'] },
    lens: 'networking',
    bites: (size, _unfiltered, everything) =>
      [...placed(everything.scene).keys()].some(
        (id) => !isStub(everything.scene, id) && INCLUDED.test(graphOf(size).nodes[id]?.assetType ?? ''),
      ),
  },
  regions: {
    filters: { regions: ['us-central1'] },
    lens: 'everything',
    bites: (size, result) =>
      [...placed(result.scene).keys()].some((id) => {
        const node = graphOf(size).nodes[id];
        if (node === undefined || isStub(result.scene, id) || isAnchor(result, id)) return false;
        if (node.assetType.startsWith('cloudresourcemanager.googleapis.com/')) return false;
        const location = node.location?.toLowerCase();
        if (location === undefined || (location === 'global' && node.role === 'container')) return false;
        return location !== 'us-central1' && !location.startsWith('us-central1-');
      }),
  },
  'depth-1': { filters: { depth: 1 }, lens: 'everything', bites: (_size, result) => deeperThan(result, 1) },
  'depth-2': { filters: { depth: 2 }, lens: 'everything', bites: (_size, result) => deeperThan(result, 2) },
  'hide-empty-projects': {
    filters: { hideEmptyProjects: true },
    lens: 'everything',
    bites: (_size, result) =>
      zones(result.scene).some(
        (z) =>
          z.kind === 'project' && emptyZone(z) && !z.badges.includes('external') && !isAnchor(result, z.id),
      ),
  },
  'hide-empty-folders': {
    filters: { hideEmptyFolders: true },
    lens: 'everything',
    bites: (_size, result) => zones(result.scene).some((z) => z.kind === 'folder' && emptyZone(z)),
  },
  'hide-empty': {
    // The networking lens leaves the serverless and data projects empty, and with them some folders.
    filters: { hideEmptyProjects: true, hideEmptyFolders: true },
    lens: 'networking',
    bites: (_size, result) =>
      zones(result.scene).some(
        (z) =>
          (z.kind === 'project' || z.kind === 'folder') &&
          emptyZone(z) &&
          !z.badges.includes('external') &&
          !isAnchor(result, z.id),
      ),
  },
  'hide-disconnected': {
    filters: { hideDisconnected: true },
    lens: 'everything',
    bites: (_size, result) =>
      [...placed(result.scene).values()].some(
        ({ node }) =>
          (node.type === 'card' || emptyZone(node)) &&
          degree(result.scene, node.id) === 0 &&
          !isAnchor(result, node.id),
      ),
  },
};

/** Drill-in and focus contexts, by name. */
function contexts(size: DemoSize): Record<string, ViewSpecInput> {
  return {
    'root: folder Workloads': { root: folderNamed(size, 'Workloads') },
    'root: project demo-web-1': { root: projectNamed(size, 'demo-web-1') },
    'root: VPC vpc-shared-prod': { root: HOST_VPC },
    ...Object.fromEntries(
      FOCUS_NAMES.flatMap((name) => {
        const focus = FOCUSES[name];
        return focus === undefined ? [] : [[`focus: ${name}`, { focus }]];
      }),
    ),
  };
}

function biteMatrix(size: DemoSize): Record<string, string> {
  return Object.fromEntries(
    Object.entries(contexts(size)).map(([name, context]) => {
      const everything = buildOnce(size, { ...context, lens: 'everything', detail: 'all' });
      const bitten = Object.entries(PROOF_FILTERS).filter(([, proof]) =>
        proof.bites(size, buildOnce(size, { ...context, lens: proof.lens, detail: 'all' }), everything),
      );
      return [name, bitten.map(([filter]) => filter).join(' ')];
    }),
  );
}

describe('3. filters apply under drill-in and under every focus', () => {
  for (const size of SIZES) {
    const rows = Object.entries(contexts(size)).flatMap(([context, input]) =>
      Object.keys(PROOF_FILTERS).map((filter) => ({ size, context, input, filter })),
    );
    it.each(rows)('$size · $context · $filter', ({ size, input, filter }) => {
      const proof = PROOF_FILTERS[filter];
      if (proof === undefined) throw new Error(filter);
      const base: ViewSpecInput = { ...input, lens: proof.lens, detail: 'all' };
      const before = buildOnce(size, base);
      const everything = buildOnce(size, { ...input, lens: 'everything', detail: 'all' });
      const filtered = check(size, { ...base, filters: proof.filters });
      expect(filtered.report.focus?.status ?? 'none').not.toBe('error');
      // The filter changes the view exactly when the view holds something it must change.
      const changed = JSON.stringify(filtered.scene) !== JSON.stringify(before.scene);
      expect(changed).toBe(proof.bites(size, before, everything));
    });
  }

  /**
   * Where each filter bites (changes the view) with the demo data and the real catalog. Pinned so that a
   * change to the data, the catalog or the builder that makes a filter a no-op in some context shows up here.
   */
  const BITES: Readonly<Record<DemoSize, Readonly<Record<string, string>>>> = {
    // S's managed VMs nest in their instance groups (a container, nestsIn), so depth 1 cuts them under the
    // project focus; and demo-web-1's load-balancer address, its only card without a drawn edge otherwise,
    // is used by the forwarding rule that holds it (the address's users, a reverse rule), so
    // hide-disconnected finds nothing to remove there.
    S: {
      'root: folder Workloads':
        'exclude-types include-types regions depth-1 depth-2 hide-empty-projects hide-empty hide-disconnected',
      'root: project demo-web-1': 'exclude-types include-types regions',
      'root: VPC vpc-shared-prod': 'exclude-types regions hide-disconnected',
      'focus: project': 'exclude-types include-types regions depth-1',
      'focus: shared-vpc': 'exclude-types include-types regions depth-1 depth-2 hide-empty hide-disconnected',
      'focus: standalone-projects':
        'include-types regions depth-1 hide-empty-projects hide-empty hide-disconnected',
      'focus: perimeter': 'include-types regions depth-1 hide-empty hide-disconnected',
      'focus: application': 'regions depth-1 hide-empty',
    },
    // Catalog generator cases: demo-data-1 (in the perimeter) runs Dataproc VMs on a host subnet
    // (exclude-types) and holds nested containers such as the Dataplex lake › zone (depth-2); demo-web-1
    // holds the Apigee organisation and the certificate map, containers that depth 1 cuts (focus: project).
    M: {
      'root: folder Workloads':
        'exclude-types include-types regions depth-1 depth-2 hide-empty-projects hide-empty hide-disconnected',
      'root: project demo-web-1': 'exclude-types include-types regions hide-disconnected',
      'root: VPC vpc-shared-prod': 'exclude-types regions hide-disconnected',
      'focus: project': 'exclude-types include-types regions depth-1 hide-disconnected',
      'focus: shared-vpc': 'exclude-types include-types regions depth-1 depth-2 hide-empty hide-disconnected',
      'focus: standalone-projects':
        'include-types regions depth-1 hide-empty-projects hide-empty hide-disconnected',
      'focus: perimeter': 'exclude-types include-types regions depth-1 depth-2 hide-empty hide-disconnected',
      'focus: application': 'regions depth-1 hide-empty',
    },
  };

  it.each(SIZES)(
    '%s: every filter bites under some drill-in and under some focus (pinned matrix)',
    (size) => {
      const matrix = biteMatrix(size);
      expect(matrix).toEqual(BITES[size]);
      const bitesIn = (prefix: string, filter: string): boolean =>
        Object.entries(matrix).some(
          ([context, filters]) => context.startsWith(prefix) && filters.split(' ').includes(filter),
        );
      for (const filter of Object.keys(PROOF_FILTERS)) {
        // A folder is never empty in the demo on its own; `hide-empty` (projects and folders together) shows it.
        if (filter === 'hide-empty-folders') continue;
        expect([filter, bitesIn('root:', filter)]).toEqual([filter, true]);
        expect([filter, bitesIn('focus:', filter)]).toEqual([filter, true]);
      }
    },
  );
});

const WEB_HTTPS_FR = '//compute.googleapis.com/projects/demo-web-1/global/forwardingRules/web-https-fr';
const API_ILB_FR =
  '//compute.googleapis.com/projects/demo-web-1/regions/europe-west3/forwardingRules/api-ilb-fr';
const URL_MAP = '//compute.googleapis.com/projects/demo-web-1/global/urlMaps/web-urlmap';
const WEB_HOST_SUBNET =
  '//compute.googleapis.com/projects/demo-net-1/regions/europe-west3/subnetworks/demo-web-1-europe-west3';
const CLUSTER = '//container.googleapis.com/projects/demo-gke-1/locations/europe-west3/clusters/retail-prod';
const KEY_RING =
  '//cloudkms.googleapis.com/projects/demo-sec-1/locations/europe-west3/keyRings/kr-europe-west3';
const DATASET = '//bigquery.googleapis.com/projects/demo-data-1/datasets/analytics';
const LAKE = '//storage.googleapis.com/demo-data-1-lake';
const SA_RUN = '//iam.googleapis.com/projects/demo-svc-1/serviceAccounts/176933304773594516620';
const ORG = '//cloudresourcemanager.googleapis.com/organizations/30000000001';
const INTERNAL_ZONE = '//dns.googleapis.com/projects/demo-net-1/managedZones/internal-prod';

/** Names in a row resolve per size: `@demo-web-1` is that project's node, `#Workloads` that folder's. */
function resolve(size: DemoSize, value: string): string {
  if (value.startsWith('@')) return projectNamed(size, value.slice(1));
  if (value.startsWith('#')) return folderNamed(size, value.slice(1));
  return value;
}

interface Expected {
  /** Exact top-level ids, in order. */
  readonly top?: readonly string[];
  readonly present?: readonly string[];
  readonly absent?: readonly string[];
  /** Zones drawn as chips (each must be one). */
  readonly chips?: readonly string[];
  /** Zones that must be open. */
  readonly open?: readonly string[];
  /** Child ids of a zone, exact and in order. */
  readonly children?: Readonly<Record<string, readonly string[]>>;
  /**
   * Child ids a zone holds at least, in any order: for zones whose other children depend on catalog entries
   * catalog entries add (a correct new rule may attach one more resource there).
   */
  readonly childrenInclude?: Readonly<Record<string, readonly string[]>>;
  /** The legend's edge kinds, exact and in order: for rows about the edges. */
  readonly edgeKinds?: readonly string[];
  /**
   * Edge kinds the legend lists at least, in any order: for rows about something else, which a catalog entry that
   * adds a relation kind to the view should not change.
   */
  readonly edgeKindsInclude?: readonly string[];
  readonly zoneKinds?: readonly string[];
  readonly detail?: DetailLevel;
  readonly rects?: number;
  readonly stubs?: number;
  /** A lower bound on the stubs, where catalog entries may add one (see `childrenInclude`). */
  readonly stubsAtLeast?: number;
  readonly overlays?: readonly string[];
  readonly focus?: string;
  readonly badges?: Readonly<Record<string, readonly string[]>>;
  readonly shownAs?: string;
}

interface NamedRow {
  readonly name: string;
  readonly sizes: readonly DemoSize[];
  readonly view: ViewSpecInput;
  readonly budget?: number;
  readonly expected: Expected;
  /** What one size expects instead, field by field (the sizes differ in what their data holds). */
  readonly bySize?: Partial<Record<DemoSize, Expected>>;
}

const NAMED_ROWS: readonly NamedRow[] = [
  {
    name: 'overview, whole organisation: the organisation is the canvas',
    sizes: ['S'],
    view: { lens: 'overview' },
    expected: {
      top: ['#Platform', '#Workloads', '@demo-sandbox-1'],
      absent: [ORG],
      detail: 'all',
      zoneKinds: ['folder', 'project', 'vpc', 'subnet', 'product-container'],
      // An Eventarc trigger triggers its Cloud Run service (siblingName reads destination.cloudRun).
      edgeKindsInclude: ['attaches', 'routes', 'uses', 'peers', 'connects', 'memberOf', 'triggers', 'shares'],
    },
  },
  {
    name: 'overview, whole organisation: auto opens folders only for M (projects are chips)',
    sizes: ['M'],
    view: { lens: 'overview' },
    expected: {
      detail: 'folders',
      chips: ['@demo-web-1', '@demo-net-1'],
      open: ['#Workloads', '#Networking'],
      // demo-mgmt-1, demo-vm-1 and demo-ml-1 (catalog generator cases) are three more project chips.
      rects: 38,
    },
  },
  {
    // At folder detail explicitly: the level auto picks depends on how many cards the catalog draws, which
    // each catalog entry changes (firewalls and routes nesting in their VPC, record sets hidden, …).
    name: 'networking, whole organisation at folder detail (the render-scene example view)',
    sizes: ['M'],
    view: { lens: 'networking', detail: 'folders' },
    expected: {
      detail: 'folders',
      zoneKinds: ['folder', 'project'],
      // routes: the partner extranet's static route (demo-net-1) whose next hop is the internal load
      // balancer of demo-web-1 (the networking-fabric group's Route rules), drawn between the two project
      // chips. With the catalog generator cases the
      // organisation-level Cloud NGFW objects add uses (the endpoint association, the hierarchical policy's
      // security profile group), connects (the nonprod host's NCC spoke to the hub, demo-web-1's service
      // attachment to the partner VPC, the network attachment to demo-ml-1) and secures (the hierarchical
      // firewall policy on the Workloads folder and the production host network).
      edgeKindsInclude: ['attaches', 'routes', 'uses', 'peers', 'connects', 'secures', 'shares'],
      chips: ['@demo-net-1', '@demo-net-2', '@demo-partner-1'],
      absent: [WEB_HTTPS_FR],
    },
  },
  {
    name: 'networking at detail networks: VPCs and subnets open, the host subnet shared',
    sizes: ['S', 'M'],
    view: { lens: 'networking', detail: 'networks' },
    expected: {
      open: [HOST_VPC, WEB_HOST_SUBNET],
      badges: { [WEB_HOST_SUBNET]: ['shared with 1 project'] },
      // routes: the static route via the internal load balancer; uses: the Cloud NAT router's static NAT
      // address. The hybrid links connect tunnels, gateways, attachments and routers.
      edgeKindsInclude: ['attaches', 'routes', 'uses', 'peers', 'connects', 'shares'],
    },
    bySize: {
      // M also has firewall policies (hierarchical and network), which secure the host networks.
      M: { edgeKindsInclude: ['attaches', 'routes', 'uses', 'peers', 'connects', 'secures', 'shares'] },
    },
  },
  {
    name: 'load-balancing, focus project demo-web-1: the chain, and the host subnet as an external stub',
    sizes: ['S', 'M'],
    view: {
      lens: 'load-balancing',
      detail: 'all',
      focus: { kind: 'project', params: { project: 'demo-web-1' } },
    },
    expected: {
      // Siblings sort by label: "Retail web (prod)" before "Shared VPC host (Production)".
      top: ['@demo-web-1', '@demo-net-1'],
      present: [WEB_HTTPS_FR, URL_MAP, API_ILB_FR, WEB_HOST_SUBNET],
      // At least the subnet: a backend service attaching to the host VPC adds the VPC as a stub too.
      childrenInclude: { '@demo-net-1': [WEB_HOST_SUBNET] },
      badges: { '@demo-net-1': ['external'] },
      stubsAtLeast: 1,
      focus: 'applied',
    },
    bySize: {
      // M: the static-site bucket writes its access logs to a bucket of the management project, which
      // joins as a stub ("Platform management" sorts first).
      M: { top: ['@demo-mgmt-1', '@demo-web-1', '@demo-net-1'] },
    },
  },
  {
    name: 'compute, focus shared-vpc demo-net-1: the host and its service projects, folders gone',
    sizes: ['S'],
    view: { lens: 'compute', detail: 'all', focus: { kind: 'shared-vpc', params: { host: 'demo-net-1' } } },
    expected: {
      top: ['@demo-gke-1', '@demo-svc-1', '@demo-web-1', '@demo-net-1'],
      absent: ['#Workloads', '#Platform', '@demo-sec-1'],
      // Managed instance groups are containers holding their VMs (product containers).
      zoneKinds: ['project', 'vpc', 'subnet', 'product-container'],
      focus: 'applied',
    },
  },
  {
    name: 'serverless, focus perimeter: the perimeter as an overlay around its two projects',
    sizes: ['S', 'M'],
    view: {
      lens: 'serverless',
      detail: 'all',
      focus: { kind: 'perimeter', params: { perimeter: 'data_perimeter' } },
    },
    expected: {
      top: [PERIMETER],
      children: { [PERIMETER]: ['@demo-data-1', '@demo-svc-1'] },
      present: [ORDERS_API, ORDERS_DB, LAKE],
      overlays: [PERIMETER],
      focus: 'applied',
    },
  },
  {
    name: 'data, focus application: the application, and what it registers that the lens shows',
    sizes: ['S', 'M'],
    view: {
      lens: 'data',
      detail: 'all',
      focus: { kind: 'application', params: { application: APPLICATION } },
    },
    expected: {
      // demo-web-1 holds the registered group, which the data lens does not show: the project stays, empty.
      top: ['@demo-svc-1', '@demo-web-1'],
      present: [APPLICATION, ORDERS_DB],
      absent: [ORDERS_API, WEB_MIG, APP_SERVICE_API],
      focus: 'applied',
    },
  },
  {
    name: 'everything, focus application: the App Hub services, their references and their projects',
    sizes: ['S'],
    view: {
      lens: 'everything',
      detail: 'all',
      focus: { kind: 'application', params: { application: APPLICATION } },
    },
    expected: {
      top: ['@demo-svc-1', '@demo-web-1'],
      children: {
        [APPLICATION]: [
          `${APPLICATION}/services/orders-api`,
          `${APPLICATION}/services/orders-db`,
          `${APPLICATION}/workloads/web`,
        ],
      },
      present: [ORDERS_API, ORDERS_DB, WEB_MIG],
      edgeKinds: ['uses'],
    },
  },
  {
    // The operations lens lists the types App Hub registers (Cloud Run services, Cloud SQL
    // instances, instance groups, forwarding rules), so the registrations' uses edges have a visible end.
    name: 'operations, focus application: the App Hub services and what they register',
    sizes: ['S', 'M'],
    view: {
      lens: 'operations',
      detail: 'all',
      focus: { kind: 'application', params: { application: APPLICATION } },
    },
    expected: {
      top: ['@demo-svc-1', '@demo-web-1'],
      present: [APPLICATION, APP_SERVICE_API, ORDERS_API, ORDERS_DB, WEB_MIG],
      edgeKinds: ['uses'],
      focus: 'applied',
    },
  },
  {
    name: 'kubernetes, drill-in project demo-gke-1: the cluster at the top, namespaces and workloads inside',
    sizes: ['S', 'M'],
    view: { lens: 'kubernetes', detail: 'all', root: '@demo-gke-1' },
    expected: {
      present: [CLUSTER, `${CLUSTER}/k8s/namespaces/shop`],
      absent: ['@demo-gke-1'],
      zoneKinds: ['product-container'],
      // The ingress routes to its backend service (k8sRef).
      edgeKindsInclude: ['routes', 'memberOf'],
    },
    bySize: {
      // M's node pools name their managed instance groups (instanceGroupUrls), which the lens lists: uses.
      // The cluster's fleet membership is one memberOf edge (the membership's own weak reverse rule draws
      // the same edge and merges with it).
      M: { edgeKindsInclude: ['routes', 'uses', 'memberOf'] },
    },
  },
  {
    name: 'security, standalone projects: the key project and the sandbox, keys inside their ring',
    sizes: ['S'],
    view: { lens: 'security', detail: 'all', focus: { kind: 'standalone-projects', params: {} } },
    expected: {
      top: ['@demo-ops-1', '@demo-data-1', '@demo-sandbox-1', '@demo-sec-1'],
      present: [KEY_RING],
      focus: 'applied',
    },
  },
  {
    name: 'security, standalone projects, hide empty projects: the sandbox and the build project go',
    sizes: ['S'],
    view: {
      lens: 'security',
      detail: 'all',
      focus: { kind: 'standalone-projects', params: {} },
      filters: { hideEmptyProjects: true },
    },
    expected: { top: ['@demo-data-1', '@demo-sec-1'], absent: ['@demo-sandbox-1', '@demo-ops-1'] },
  },
  {
    name: 'security, whole organisation: keys and what they encrypt (encryptedBy), and the perimeter',
    sizes: ['S', 'M'],
    view: { lens: 'security', detail: 'all' },
    expected: {
      present: [KEY_RING, DATASET, ORDERS_DB, LAKE, PERIMETER],
      // uses: the perimeter's access levels, BigQuery external tables reading the lake bucket and backend
      // services and buckets using their Cloud Armor policies.
      edgeKinds: ['attaches', 'uses', 'encryptedBy', 'secures'],
    },
    bySize: {
      // M adds triggers: secrets publish to the security project's topic, Security Command Center
      // notifies its findings topic.
      M: { edgeKinds: ['attaches', 'uses', 'encryptedBy', 'secures', 'triggers'] },
    },
  },
  {
    name: 'identity: service accounts and runsAs; showIdentities false removes both',
    sizes: ['S', 'M'],
    view: { lens: 'identity', detail: 'all', filters: { showIdentities: false } },
    expected: { absent: [SA_RUN], present: [ORDERS_API] },
  },
  {
    name: 'overview with showIdentities: identity cards and runsAs edges join the overview',
    sizes: ['S'],
    view: { lens: 'overview', detail: 'all', filters: { showIdentities: true } },
    expected: {
      present: [SA_RUN],
      // Triggers (Eventarc → Cloud Run), as in the overview row above.
      edgeKindsInclude: [
        'attaches',
        'routes',
        'uses',
        'peers',
        'connects',
        'memberOf',
        'runsAs',
        'triggers',
        'shares',
      ],
    },
  },
  {
    name: 'data, drill-in folder Workloads at detail projects: datasets are chips',
    sizes: ['S', 'M'],
    view: { lens: 'data', detail: 'projects', root: '#Workloads' },
    expected: { chips: [DATASET], present: [LAKE], absent: ['#Workloads', '#Platform'] },
  },
  {
    // The private DNS zone bound to this VPC alone is a product container that nests in it (a zone attaching
    // to exactly one network nests there: skill gcp-diagram-layout §2, rule 1), beside the subnets.
    name: 'everything, drill-in VPC vpc-shared-prod, depth 1: subnets and the private zone at the top',
    sizes: ['S', 'M'],
    view: { lens: 'everything', detail: 'all', root: HOST_VPC, filters: { depth: 1 } },
    expected: {
      present: [WEB_HOST_SUBNET, INTERNAL_ZONE],
      absent: [HOST_VPC, '@demo-net-1'],
      zoneKinds: ['subnet', 'product-container'],
    },
  },
  {
    name: 'overview, regions us-central1 with region zones: only the us-central1 zones stay',
    sizes: ['M'],
    view: { lens: 'overview', detail: 'all', filters: { regions: ['us-central1'], showRegions: true } },
    expected: {
      present: ['//gcportrait.virtual/projects/demo-web-2/locations/us-central1'],
      absent: ['//gcportrait.virtual/projects/demo-web-1/locations/europe-west3', WEB_HTTPS_FR],
    },
  },
  {
    name: 'overview at auto with a flip: the flipped project opens, the level stays',
    sizes: ['M'],
    view: { lens: 'overview', flips: ['@demo-web-1'] },
    expected: { detail: 'folders', open: ['@demo-web-1'], chips: ['@demo-net-1'], present: [WEB_HTTPS_FR] },
  },
  {
    name: 'overview at auto with a large budget: everything open',
    sizes: ['M'],
    view: { lens: 'overview' },
    budget: 400,
    expected: { detail: 'all', present: [WEB_HTTPS_FR, CLUSTER] },
  },
  {
    name: 'a selection inside a chip is shown as the chip',
    sizes: ['M'],
    view: { lens: 'overview', selection: WEB_HTTPS_FR },
    expected: { shownAs: '@demo-web-1' },
  },
  {
    name: 'an unknown root falls back to the organisation and the focus still applies',
    sizes: ['S'],
    view: {
      lens: 'overview',
      root: '//compute.googleapis.com/projects/nope/global/networks/x',
      focus: { kind: 'project', params: { project: 'demo-web-1' } },
    },
    expected: { top: ['@demo-web-1', '@demo-net-1'], focus: 'applied' },
  },
  {
    name: 'a focus outside the drill-in root is refused and the root is shown',
    sizes: ['S', 'M'],
    view: {
      lens: 'overview',
      root: '#Platform',
      focus: { kind: 'project', params: { project: 'demo-web-1' } },
    },
    expected: { focus: 'outside-root', present: ['@demo-net-1'], absent: ['@demo-web-1'] },
  },
];

describe('4. named rows', () => {
  const rows = NAMED_ROWS.flatMap((row) =>
    row.sizes.map((size) => ({ ...row, size, expected: { ...row.expected, ...row.bySize?.[size] } })),
  );
  it.each(rows)('$size · $name', ({ size, view: input, budget, expected }) => {
    const r = (value: string): string => resolve(size, value);
    const resolved: ViewSpecInput = {
      ...input,
      ...(input.root === undefined ? {} : { root: r(input.root) }),
      ...(input.flips === undefined ? {} : { flips: input.flips.map((flip) => flipIdOf(r(flip))) }),
    };
    const spec = view(resolved);
    const result = build(size, resolved, budget);
    expect(violations(graphOf(size), spec, CATALOG, result)).toEqual([]);
    const { scene, report } = result;
    const all = placed(scene);
    if (expected.top !== undefined) expect(childIds(scene)).toEqual(expected.top.map(r));
    for (const id of expected.present ?? []) expect([id, shows(scene, r(id))]).toEqual([id, true]);
    for (const id of expected.absent ?? []) expect([id, shows(scene, r(id))]).toEqual([id, false]);
    for (const id of expected.chips ?? [])
      expect([id, zone(scene, r(id)).collapsed !== undefined]).toEqual([id, true]);
    for (const id of expected.open ?? []) expect([id, zone(scene, r(id)).collapsed]).toEqual([id, undefined]);
    for (const [id, children] of Object.entries(expected.children ?? {})) {
      expect(childIds(scene, r(id))).toEqual(children.map(r));
    }
    for (const [id, children] of Object.entries(expected.childrenInclude ?? {})) {
      expect(childIds(scene, r(id))).toEqual(expect.arrayContaining(children.map(r)));
    }
    for (const [id, badges] of Object.entries(expected.badges ?? {}))
      expect(zone(scene, r(id)).badges).toEqual(badges);
    if (expected.edgeKinds !== undefined) expect(report.legend.edgeKinds).toEqual(expected.edgeKinds);
    if (expected.edgeKindsInclude !== undefined)
      expect(report.legend.edgeKinds).toEqual(expect.arrayContaining([...expected.edgeKindsInclude]));
    if (expected.zoneKinds !== undefined) expect(report.legend.zoneKinds).toEqual(expected.zoneKinds);
    if (expected.detail !== undefined) expect(report.detail.used).toBe(expected.detail);
    if (expected.rects !== undefined) expect(scene.metadata.rectCount).toBe(expected.rects);
    if (expected.stubs !== undefined) expect(report.counts.stubs).toBe(expected.stubs);
    if (expected.stubsAtLeast !== undefined)
      expect(report.counts.stubs).toBeGreaterThanOrEqual(expected.stubsAtLeast);
    if (expected.overlays !== undefined)
      expect(report.overlays.map((o) => o.zone)).toEqual(expected.overlays);
    if (expected.focus !== undefined) {
      const status = report.focus?.status === 'error' ? report.focus.error.code : report.focus?.status;
      expect(status).toBe(expected.focus);
    }
    if (expected.shownAs !== undefined) expect(report.selection?.shownAs).toBe(r(expected.shownAs));
    expect(all.size).toBe(scene.metadata.rectCount);
  });

  it('covers every lens, every focus kind and the three drill-ins', () => {
    const lenses = new Set(NAMED_ROWS.map((row) => row.view.lens));
    const focuses = new Set(
      NAMED_ROWS.flatMap((row) => (row.view.focus === undefined ? [] : [row.view.focus.kind])),
    );
    const roots = NAMED_ROWS.flatMap((row) => (row.view.root === undefined ? [] : [row.view.root]));
    expect(LENSES.filter((lens) => !lenses.has(lens))).toEqual([]);
    expect(focuses.size).toBe(5);
    expect(roots).toEqual(expect.arrayContaining(['#Workloads', '@demo-gke-1', HOST_VPC]));
  });
});

describe('5. an AI zone lies in its region for the regions filter and the region zones alike', () => {
  const REGION = '//gcportrait.virtual/projects/demo-web-1/locations/us-central1';
  const ZONE = `${REGION}/zones/${AI_ZONE}`;
  const aiGraph = (size: DemoSize): Graph => demoGraphBuild(size, { aiZone: true }).graph;

  /** The drill-in and focus contexts whose view holds demo-web-1, the disk's project. */
  const CONTEXTS: Readonly<Record<string, (size: DemoSize) => ViewSpecInput>> = {
    'no root or focus': () => ({}),
    'root: folder Workloads': (size) => ({ root: folderNamed(size, 'Workloads') }),
    'root: project demo-web-1': (size) => ({ root: projectNamed(size, 'demo-web-1') }),
    'focus: project': () => ({ focus: { kind: 'project', params: { project: 'demo-web-1' } } }),
    'focus: shared-vpc': () => ({ focus: { kind: 'shared-vpc', params: { host: 'demo-net-1' } } }),
  };
  interface ZoneRow {
    readonly filters: Partial<ViewFilters>;
    /** Whether the filters keep the disk. */
    readonly shown: boolean;
    /** Whether it is drawn in its zone's zone, inside its region's. */
    readonly nested: boolean;
  }
  const ZONE_FILTERS: Readonly<Record<string, ZoneRow>> = {
    'regions us-central1': { filters: { regions: ['us-central1'] }, shown: true, nested: false },
    [`regions ${AI_ZONE}`]: { filters: { regions: [AI_ZONE] }, shown: true, nested: false },
    'regions europe-west3': { filters: { regions: ['europe-west3'] }, shown: false, nested: false },
    'region zones': { filters: { showRegions: true }, shown: true, nested: true },
    'region zones, regions us-central1': {
      filters: { showRegions: true, regions: ['us-central1'] },
      shown: true,
      nested: true,
    },
    'region zones, regions europe-west3': {
      filters: { showRegions: true, regions: ['europe-west3'] },
      shown: false,
      nested: false,
    },
  };
  const rows = SIZES.flatMap((size) =>
    Object.keys(CONTEXTS).flatMap((context) =>
      Object.keys(ZONE_FILTERS).map((filters) => ({ size, context, filters })),
    ),
  );

  it.each(rows)('$size · $context · $filters', ({ size, context, filters }) => {
    const row = ZONE_FILTERS[filters];
    const input = CONTEXTS[context];
    if (row === undefined || input === undefined) throw new Error(`${context} · ${filters}`);
    const graph = aiGraph(size);
    const spec = view({ ...input(size), lens: 'compute', detail: 'all', filters: row.filters });
    const result = buildSceneWithReport(graph, spec, CATALOG, { readTime: READ_TIME });
    expect(violations(graph, spec, CATALOG, result)).toEqual([]);
    expect(result.report.focus?.status ?? 'none').not.toBe('error');
    expect(shows(result.scene, AI_ZONE_DISK)).toBe(row.shown);
    if (row.nested) {
      // Project › us-central1 (a region) › us-central1-ai1a (a zone) › the disk.
      expect(parentOf(result.scene, AI_ZONE_DISK)).toBe(ZONE);
      expect(parentOf(result.scene, ZONE)).toBe(REGION);
      expect(zone(result.scene, REGION).subtitle).toBe('region');
      expect(shows(result.scene, `//gcportrait.virtual/projects/demo-web-1/locations/${AI_ZONE}`)).toBe(
        false,
      );
    }
    if (row.filters.showRegions === true && !row.shown) expect(shows(result.scene, ZONE)).toBe(false);
  });
});
