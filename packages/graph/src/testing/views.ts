// SPDX-License-Identifier: MIT
/**
 * A synthetic organisation for the scene builder's unit tests: the builder's scenario (a Shared VPC host and a
 * service project with VMs, a local VPC, a connector, Cloud Run, a service account, an unmapped gadget) plus
 * what the views need beyond it:
 *
 * - a standalone project `demo-solo-1` with buckets in two regions, a soft-deleted bucket (hidden by
 *   default), a hidden build record and a route (a Compute type the catalog does not map);
 * - an empty project `demo-empty-1` in its own folder `Sandbox`;
 * - two peered VPCs in `demo-peer-1` and `demo-peer-2`, so those projects are not standalone;
 * - an access policy with a perimeter that secures demo-web-1 and demo-solo-1;
 * - an App Hub application `shop` in demo-web-1 registering the Cloud Run service and a VM.
 *
 * Not part of the public API.
 */
import {
  GraphBuildSchema,
  SceneBuildSchema,
  ViewSpecSchema,
  normalizeViewSpec,
  type Asset,
  type Catalog,
  type Graph,
  type SceneBuild,
  type SceneEnv,
  type ViewSpec,
  type ViewSpecInput,
} from '@gcportrait/model';
import { buildGraphWithReport, type BuildOptions } from '../build.js';
import { buildSceneWithReport } from '../views/scene.js';
import {
  ORG,
  ORG_NUMBER,
  UPDATED,
  catalogWith,
  computeName,
  folder,
  network,
  project,
  resource,
  selfLink,
  type CatalogEntryInput,
} from './fixtures.js';
import { ON_SUBNET, RUN_SERVICE, SCENARIO_ENTRIES, WEB_ID, WEB_NUMBER, scenarioAssets } from './scenario.js';

export const SOLO_NUMBER = '10000000003';
export const SOLO_ID = 'demo-solo-1';
export const EMPTY_NUMBER = '10000000004';
export const PEER_A_NUMBER = '10000000005';
export const PEER_B_NUMBER = '10000000006';

export const PROJECT_SOLO = `//cloudresourcemanager.googleapis.com/projects/${SOLO_NUMBER}`;
export const PROJECT_EMPTY = `//cloudresourcemanager.googleapis.com/projects/${EMPTY_NUMBER}`;
export const PROJECT_PEER_A = `//cloudresourcemanager.googleapis.com/projects/${PEER_A_NUMBER}`;
export const PROJECT_PEER_B = `//cloudresourcemanager.googleapis.com/projects/${PEER_B_NUMBER}`;
export const FOLDER_PLATFORM = '//cloudresourcemanager.googleapis.com/folders/20000000001';
export const FOLDER_WORKLOADS = '//cloudresourcemanager.googleapis.com/folders/20000000002';
export const FOLDER_RETAIL = '//cloudresourcemanager.googleapis.com/folders/20000000003';
export const FOLDER_SANDBOX = '//cloudresourcemanager.googleapis.com/folders/20000000004';

export const BUCKET_WEST3 = '//storage.googleapis.com/demo-solo-1-logs';
export const BUCKET_CENTRAL = '//storage.googleapis.com/demo-solo-1-archive';
export const BUCKET_DELETED = '//storage.googleapis.com/demo-solo-1-old';
export const BUILD = `//cloudbuild.googleapis.com/projects/${SOLO_NUMBER}/locations/global/builds/b-1`;
/** A Compute type the catalog does not map: a generic card with the Compute Engine product icon. */
export const ROUTE = computeName('demo-solo-1', 'global/routes/default-route');
export const PEER_VPC_A = computeName('demo-peer-1', 'global/networks/vpc-a');
export const PEER_VPC_B = computeName('demo-peer-2', 'global/networks/vpc-b');
export const POLICY = '//accesscontextmanager.googleapis.com/accessPolicies/40000000001';
export const PERIMETER = `${POLICY}/servicePerimeters/shop_perimeter`;
export const APP = `//apphub.googleapis.com/projects/${WEB_ID}/locations/global/applications/shop`;
export const APP_SERVICE = `${APP}/services/api`;
export const APP_WORKLOAD = `${APP}/workloads/vm`;

/** The extra product entries: storage, builds (hidden), perimeters, App Hub. */
export const VIEW_ENTRIES: CatalogEntryInput[] = [
  ...SCENARIO_ENTRIES,
  {
    product: 'Cloud Storage',
    service: 'storage.googleapis.com',
    icon: 'cloud_storage',
    types: {
      'storage.googleapis.com/Bucket': {
        role: 'leaf',
        label: '{{data.name}}',
        hiddenWhen: '$.data.softDeleted == true',
      },
    },
  },
  {
    product: 'Cloud Build',
    service: 'cloudbuild.googleapis.com',
    icon: 'cloud_build',
    types: { 'cloudbuild.googleapis.com/Build': { role: 'hidden' } },
  },
  {
    product: 'Access Context Manager',
    service: 'accesscontextmanager.googleapis.com',
    icon: 'access_context_manager',
    types: {
      'accesscontextmanager.googleapis.com/AccessPolicy': {
        role: 'container',
        label: '{{data.title}}',
        contains: [{ byParent: 'accesscontextmanager.googleapis.com/ServicePerimeter' }],
      },
      'accesscontextmanager.googleapis.com/ServicePerimeter': {
        role: 'core',
        label: '{{data.title}}',
        relations: [{ kind: 'secures', to: '$.data.status.resources[*]', normalize: 'projectNumberOrId' }],
      },
    },
  },
  {
    product: 'App Hub',
    service: 'apphub.googleapis.com',
    icon: 'app_hub',
    types: {
      'apphub.googleapis.com/Application': {
        role: 'container',
        label: '{{data.displayName}}',
        contains: [
          { byParent: 'apphub.googleapis.com/Service' },
          { byParent: 'apphub.googleapis.com/Workload' },
        ],
      },
      'apphub.googleapis.com/Service': {
        role: 'core',
        label: '{{data.displayName}}',
        relations: [{ kind: 'uses', to: '$.data.serviceReference.uri', normalize: 'name' }],
      },
      'apphub.googleapis.com/Workload': {
        role: 'core',
        label: '{{data.displayName}}',
        relations: [{ kind: 'uses', to: '$.data.workloadReference.uri', normalize: 'name' }],
      },
    },
  },
];

/** The views scenario's catalog: the real one plus {@link VIEW_ENTRIES}. */
export function viewCatalog(): Catalog {
  return catalogWith(VIEW_ENTRIES);
}

function inProject(number: string, folders: readonly string[]) {
  return (name: string, assetType: string, data: unknown, location?: string, parent?: string): Asset =>
    resource(name, assetType, number, data, {
      folders,
      ...(location === undefined ? {} : { location }),
      ...(parent === undefined ? {} : { parent }),
    });
}

/** The scenario's assets plus the views' additions, in no particular order. */
export function viewAssets(): Asset[] {
  const solo = inProject(SOLO_NUMBER, ['20000000001']);
  const web = inProject(WEB_NUMBER, ['20000000003', '20000000002']);
  const policy: Asset = {
    name: POLICY,
    assetType: 'accesscontextmanager.googleapis.com/AccessPolicy',
    parent: ORG,
    ancestors: [`organizations/${ORG_NUMBER}`],
    updateTime: UPDATED,
    data: { name: 'accessPolicies/40000000001', title: 'example.com policy' },
  };
  const perimeter: Asset = {
    ...policy,
    name: PERIMETER,
    assetType: 'accesscontextmanager.googleapis.com/ServicePerimeter',
    parent: POLICY,
    data: {
      title: 'shop_perimeter',
      status: { resources: [`projects/${WEB_NUMBER}`, `projects/${SOLO_NUMBER}`] },
    },
  };
  const peerA = network(
    PEER_A_NUMBER,
    'demo-peer-1',
    'vpc-a',
    [],
    [selfLink('demo-peer-2', 'global/networks/vpc-b')],
  );
  const peerB = network(
    PEER_B_NUMBER,
    'demo-peer-2',
    'vpc-b',
    [],
    [selfLink('demo-peer-1', 'global/networks/vpc-a')],
  );
  return [
    ...scenarioAssets(),
    folder('20000000004', 'Sandbox'),
    project(SOLO_NUMBER, SOLO_ID, ['20000000001']),
    project(EMPTY_NUMBER, 'demo-empty-1', ['20000000004']),
    project(PEER_A_NUMBER, 'demo-peer-1', ['20000000001']),
    project(PEER_B_NUMBER, 'demo-peer-2', ['20000000001']),
    solo(BUCKET_WEST3, 'storage.googleapis.com/Bucket', { name: 'demo-solo-1-logs' }, 'europe-west3'),
    solo(BUCKET_CENTRAL, 'storage.googleapis.com/Bucket', { name: 'demo-solo-1-archive' }, 'us-central1'),
    solo(
      BUCKET_DELETED,
      'storage.googleapis.com/Bucket',
      { name: 'demo-solo-1-old', softDeleted: true },
      'europe-west3',
    ),
    solo(BUILD, 'cloudbuild.googleapis.com/Build', { id: 'b-1' }, 'global'),
    solo(ROUTE, 'compute.googleapis.com/Route', { name: 'default-route' }, 'global'),
    {
      ...peerA,
      ancestors: [`projects/${PEER_A_NUMBER}`, 'folders/20000000001', `organizations/${ORG_NUMBER}`],
    },
    {
      ...peerB,
      ancestors: [`projects/${PEER_B_NUMBER}`, 'folders/20000000001', `organizations/${ORG_NUMBER}`],
    },
    policy,
    perimeter,
    web(APP, 'apphub.googleapis.com/Application', { displayName: 'Shop' }, 'global'),
    web(
      APP_SERVICE,
      'apphub.googleapis.com/Service',
      { displayName: 'Shop API', serviceReference: { uri: RUN_SERVICE } },
      'global',
      APP,
    ),
    web(
      APP_WORKLOAD,
      'apphub.googleapis.com/Workload',
      { displayName: 'Shop VM', workloadReference: { uri: ON_SUBNET } },
      'global',
      APP,
    ),
  ];
}

/** The views scenario's graph, validated. */
export function viewGraphOf(assets: readonly Asset[] = viewAssets(), options: BuildOptions = {}): Graph {
  return GraphBuildSchema.parse(buildGraphWithReport({ assets }, viewCatalog(), options)).graph;
}

export const ENV: SceneEnv = { readTime: '2026-10-08T00:00:00Z' };

/** A complete ViewSpec from a partial one (canonical, so tests read like URL hashes). */
export function view(input: ViewSpecInput): ViewSpec {
  return ViewSpecSchema.parse(normalizeViewSpec(input));
}

/** Where {@link checkedScene} builds a view: a graph and a catalog, and the environment ({@link ENV} by default). */
export interface SceneInputs {
  readonly graph: Graph;
  readonly catalog: Catalog;
  readonly env?: SceneEnv;
}

/** The scene and report of a view, validated with `SceneBuildSchema`. */
export function checkedScene(input: ViewSpecInput, { graph, catalog, env = ENV }: SceneInputs): SceneBuild {
  return SceneBuildSchema.parse(buildSceneWithReport(graph, view(input), catalog, env));
}
