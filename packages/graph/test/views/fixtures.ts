// SPDX-License-Identifier: MIT
/**
 * The demo organisations S and M (@gcportrait/demo-data, default seed, DEMO_TODAY) for the tests on the demo:
 * each size's Snapshot and its graph build with the real compiled catalog, generated and built once per test
 * file. The scene tests add a small App Hub application to the demo data, which has none of its own there.
 *
 * - VPC Service Controls: the access policy contains its perimeters and access levels; a perimeter `secures`
 *   the projects in `status.resources` (products/accesscontextmanager.googleapis.com.yaml). The demo's
 *   `data_perimeter` holds the first serverless and the first data project.
 * - App Hub: an application contains its services and workloads; each `uses` the resource it registers
 *   (products/apphub.googleapis.com.yaml). The test application `shop` lives in demo-svc-1 and registers that
 *   project's `orders-api` Cloud Run service and `orders-db` Cloud SQL instance, and demo-web-1's `web-mig`
 *   group.
 *
 * The catalog maps every type these tests need, so there are no test-only stand-ins: the views are checked
 * against the real rules.
 */
import { generateOrganization, toSnapshot } from '@gcportrait/demo-data';
import { GraphBuildSchema, type Asset, type GraphBuild, type Snapshot } from '@gcportrait/model';
import { buildGraphWithReport } from '../../src/build.js';
import { REAL_CATALOG } from '../../src/testing/fixtures.js';

const SVC_PROJECT = 'demo-svc-1';
const APP_PATH = `projects/${SVC_PROJECT}/locations/global/applications/shop`;
export const APPLICATION = `//apphub.googleapis.com/${APP_PATH}`;
export const APP_SERVICE_API = `${APPLICATION}/services/orders-api`;
export const APP_SERVICE_DB = `${APPLICATION}/services/orders-db`;
export const APP_WORKLOAD_WEB = `${APPLICATION}/workloads/web`;
export const ORDERS_API = `//run.googleapis.com/projects/${SVC_PROJECT}/locations/europe-west3/services/orders-api`;
export const ORDERS_DB = `//cloudsql.googleapis.com/projects/${SVC_PROJECT}/instances/orders-db`;
/** App Hub registers a managed instance group workload by its instance group (App Hub supported resources). */
export const WEB_MIG =
  '//compute.googleapis.com/projects/demo-web-1/zones/europe-west3-a/instanceGroups/web-mig';

/** The App Hub application `shop` in demo-svc-1, placed like the demo places assets of that project. */
export function applicationAssets(snapshot: Snapshot): Asset[] {
  const project = snapshot.assets.find(
    (asset) =>
      asset.assetType === 'cloudresourcemanager.googleapis.com/Project' &&
      (asset.data as { projectId?: unknown }).projectId === SVC_PROJECT,
  );
  if (project === undefined) throw new Error(`the demo has no ${SVC_PROJECT}`);
  const ancestors = project.ancestors;
  const asset = (name: string, assetType: string, parent: string, data: Record<string, unknown>): Asset => ({
    name,
    assetType,
    parent,
    ancestors,
    location: 'global',
    updateTime: '2026-09-01T09:00:00Z',
    data,
  });
  const registered = (
    path: string,
    displayName: string,
    field: string,
    uri: string,
  ): Record<string, unknown> => ({
    name: `${APP_PATH}/${path}`,
    displayName,
    [field]: { uri },
  });
  return [
    asset(APPLICATION, 'apphub.googleapis.com/Application', project.name, {
      name: APP_PATH,
      displayName: 'Shop',
      scope: { type: 'GLOBAL' },
    }),
    asset(
      APP_SERVICE_API,
      'apphub.googleapis.com/Service',
      APPLICATION,
      registered('services/orders-api', 'Orders API', 'serviceReference', ORDERS_API),
    ),
    asset(
      APP_SERVICE_DB,
      'apphub.googleapis.com/Service',
      APPLICATION,
      registered('services/orders-db', 'Orders database', 'serviceReference', ORDERS_DB),
    ),
    asset(
      APP_WORKLOAD_WEB,
      'apphub.googleapis.com/Workload',
      APPLICATION,
      registered('workloads/web', 'Storefront VMs', 'workloadReference', WEB_MIG),
    ),
  ];
}

export type DemoSize = 'S' | 'M';

const snapshots = new Map<DemoSize, Snapshot>();

/** The demo organisation as a Snapshot, generated once per size. */
export function demoSnapshot(size: DemoSize): Snapshot {
  let snapshot = snapshots.get(size);
  if (snapshot === undefined) {
    snapshot = toSnapshot(generateOrganization({ size }));
    snapshots.set(size, snapshot);
  }
  return snapshot;
}

const builds = new Map<string, GraphBuild>();

/**
 * The demo organisation's validated graph build with the real catalog, built once per size and choice: with the
 * App Hub application `shop` (the scene tests), or with `application: false` the demo data alone.
 */
export function demoGraphBuild(
  size: DemoSize,
  { application = true }: { readonly application?: boolean } = {},
): GraphBuild {
  const key = `${size}${application ? ' with the application' : ''}`;
  let build = builds.get(key);
  if (build === undefined) {
    const snapshot = demoSnapshot(size);
    const assets = application ? [...snapshot.assets, ...applicationAssets(snapshot)] : snapshot.assets;
    build = GraphBuildSchema.parse(buildGraphWithReport({ assets }, REAL_CATALOG));
    builds.set(key, build);
  }
  return build;
}

export const READ_TIME = '2026-10-08T00:00:00Z';
