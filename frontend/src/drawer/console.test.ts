// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
/**
 * The drawer's "Open in Cloud Console" link: the catalog's `console` template of the node's
 * type, rendered by the catalog engine (`consoleLinkFor`, reached through `nodeDetails`, the data worker's
 * answer) and worded by the same helper as the card's action and its menu (`consoleAction`). Ten-plus catalog
 * types render their pages from synthetic assets; a template whose variable is missing never yields a broken
 * link: the drawer offers the project's console home instead, and nothing at all outside any project. The
 * expected URLs are written out by hand from the templates in packages/catalog/products/.
 */
import { catalog, typesWithoutConsole } from '@gcportrait/catalog';
import { buildGraph } from '@gcportrait/graph';
import { buildProjectIndex, type Asset } from '@gcportrait/model';
import { describe, expect, it } from 'vitest';

import { consoleAction } from '../diagram/actions';
import { nodeDetails } from './details';

const NUMBER = '10000000042';
const PROJECT = 'demo-shop';
const ANCESTORS = [`projects/${NUMBER}`, 'organizations/30000000001'];
const UPDATED = '2026-10-01T00:00:00Z';
const HOME = `https://console.cloud.google.com/home/dashboard?project=${PROJECT}`;

function asset(
  name: string,
  assetType: string,
  data: Record<string, unknown>,
  location?: string,
  ancestors: readonly string[] = ANCESTORS,
): Asset {
  return {
    name,
    assetType,
    ancestors: [...ancestors],
    ...(location === undefined ? {} : { location }),
    updateTime: UPDATED,
    data,
  };
}

const project = asset(
  `//cloudresourcemanager.googleapis.com/projects/${NUMBER}`,
  'cloudresourcemanager.googleapis.com/Project',
  { projectId: PROJECT, projectNumber: NUMBER, name: `projects/${NUMBER}`, displayName: 'Shop' },
  'global',
);

/** One asset per type, with the page its template gives. */
const CASES: readonly (readonly [Asset, string])[] = [
  [
    asset(
      `//compute.googleapis.com/projects/${PROJECT}/zones/europe-west3-a/instances/web-1`,
      'compute.googleapis.com/Instance',
      { name: 'web-1' },
      'europe-west3-a',
    ),
    `https://console.cloud.google.com/compute/instancesDetail/zones/europe-west3-a/instances/web-1?project=${PROJECT}`,
  ],
  [
    asset(
      `//compute.googleapis.com/projects/${PROJECT}/zones/europe-west3-a/disks/web-1-boot`,
      'compute.googleapis.com/Disk',
      { name: 'web-1-boot' },
      'europe-west3-a',
    ),
    `https://console.cloud.google.com/compute/disksDetail/zones/europe-west3-a/disks/web-1-boot?project=${PROJECT}`,
  ],
  [
    asset(
      `//compute.googleapis.com/projects/${PROJECT}/regions/europe-west3/subnetworks/shop-subnet`,
      'compute.googleapis.com/Subnetwork',
      { name: 'shop-subnet' },
      'europe-west3',
    ),
    `https://console.cloud.google.com/networking/subnetworks/details/europe-west3/shop-subnet?project=${PROJECT}`,
  ],
  [
    asset(
      `//compute.googleapis.com/projects/${PROJECT}/global/networks/shop-vpc`,
      'compute.googleapis.com/Network',
      { name: 'shop-vpc' },
      'global',
    ),
    `https://console.cloud.google.com/networking/networks/details/shop-vpc?project=${PROJECT}`,
  ],
  [
    asset(
      `//run.googleapis.com/projects/${PROJECT}/locations/europe-west3/services/orders-api`,
      'run.googleapis.com/Service',
      { name: `projects/${PROJECT}/locations/europe-west3/services/orders-api` },
      'europe-west3',
    ),
    `https://console.cloud.google.com/run/detail/europe-west3/orders-api/metrics?project=${PROJECT}`,
  ],
  [
    asset(
      `//cloudsql.googleapis.com/projects/${PROJECT}/instances/orders-db`,
      'sqladmin.googleapis.com/Instance',
      { name: 'orders-db' },
      'europe-west3',
    ),
    `https://console.cloud.google.com/sql/instances/orders-db/overview?project=${PROJECT}`,
  ],
  [
    asset(
      `//container.googleapis.com/projects/${PROJECT}/locations/europe-west3/clusters/shop-gke`,
      'container.googleapis.com/Cluster',
      { name: 'shop-gke' },
      'europe-west3',
    ),
    `https://console.cloud.google.com/kubernetes/clusters/details/europe-west3/shop-gke/details?project=${PROJECT}`,
  ],
  [
    asset(
      '//storage.googleapis.com/demo-shop-assets',
      'storage.googleapis.com/Bucket',
      { name: 'demo-shop-assets' },
      'eu',
    ),
    `https://console.cloud.google.com/storage/browser/demo-shop-assets?project=${PROJECT}`,
  ],
  [
    asset(`//pubsub.googleapis.com/projects/${PROJECT}/topics/orders`, 'pubsub.googleapis.com/Topic', {
      name: `projects/${PROJECT}/topics/orders`,
    }),
    `https://console.cloud.google.com/cloudpubsub/topic/detail/orders?project=${PROJECT}`,
  ],
  [
    asset(
      `//bigquery.googleapis.com/projects/${PROJECT}/datasets/sales`,
      'bigquery.googleapis.com/Dataset',
      { datasetReference: { projectId: PROJECT, datasetId: 'sales' } },
      'EU',
    ),
    `https://console.cloud.google.com/bigquery?project=${PROJECT}&p=${PROJECT}&d=sales&page=dataset`,
  ],
  [
    asset(
      `//cloudkms.googleapis.com/projects/${PROJECT}/locations/europe/keyRings/shop-ring/cryptoKeys/orders-key`,
      'cloudkms.googleapis.com/CryptoKey',
      { name: `projects/${PROJECT}/locations/europe/keyRings/shop-ring/cryptoKeys/orders-key` },
      'europe',
    ),
    `https://console.cloud.google.com/security/kms/key/manage/europe/shop-ring/orders-key?project=${PROJECT}`,
  ],
  [
    asset(
      `//compute.googleapis.com/projects/${PROJECT}/regions/europe-west3/forwardingRules/web-fr`,
      'compute.googleapis.com/ForwardingRule',
      { name: 'web-fr' },
      'europe-west3',
    ),
    `https://console.cloud.google.com/net-services/loadbalancing/advanced/forwardingRules/details/regions/europe-west3/forwardingRules/web-fr?project=${PROJECT}`,
  ],
  [project, `https://console.cloud.google.com/home/dashboard?project=${PROJECT}`],
];

/** The drawer's console link for each asset, through the data worker's `nodeDetails`. */
function linksOf(assets: readonly Asset[]) {
  const all = [project, ...assets.filter((each) => each !== project)];
  const graph = buildGraph({ assets: all }, catalog);
  const source = {
    graph,
    assets: new Map(all.map((each) => [each.name, each])),
    ctx: { projects: buildProjectIndex(all) },
  };
  return (name: string) => nodeDetails(source, name, catalog)?.console;
}

describe('the drawer’s console link (the catalog template through consoleLinkFor)', () => {
  it.each(CASES.map(([each, url]) => [each.assetType, each, url] as const))(
    'renders the page of a %s',
    (_type, each, url) => {
      const link = linksOf([each])(each.name);
      expect(link).toEqual({ kind: 'resource', url });
      // The drawer's header words it as the card's action does.
      const action = link === undefined ? undefined : consoleAction(link, 'x');
      expect(action?.label).toBe('Open in Cloud Console');
      expect(action?.href).toBe(url);
    },
  );

  it('tolerates a missing variable: no broken link, the project’s console home instead', () => {
    const noLocation = asset(
      `//compute.googleapis.com/projects/${PROJECT}/zones/europe-west3-a/instances/web-2`,
      'compute.googleapis.com/Instance',
      { name: 'web-2' },
    );
    const noName = asset(
      `//cloudsql.googleapis.com/projects/${PROJECT}/instances/old-db`,
      'sqladmin.googleapis.com/Instance',
      { state: 'RUNNABLE' },
      'europe-west3',
    );
    const noReference = asset(
      `//bigquery.googleapis.com/projects/${PROJECT}/datasets/raw`,
      'bigquery.googleapis.com/Dataset',
      { datasetReference: { projectId: PROJECT } },
      'EU',
    );
    const links = linksOf([noLocation, noName, noReference]);
    for (const each of [noLocation, noName, noReference]) {
      expect(links(each.name), each.assetType).toEqual({ kind: 'project', url: HOME, projectId: PROJECT });
      const link = links(each.name);
      expect(link === undefined ? undefined : consoleAction(link, 'x').label).toBe(
        'Open project in Cloud Console',
      );
    }
  });

  it('offers the project’s home for a type without a template, and nothing outside any project', () => {
    const untemplated = typesWithoutConsole(catalog).find(
      (type) => !type.startsWith('cloudresourcemanager.'),
    );
    if (untemplated === undefined) throw new Error('every type has a template');
    const service = untemplated.slice(0, untemplated.indexOf('/'));
    const inProject = asset(`//${service}/projects/${PROJECT}/things/one`, untemplated, { name: 'one' });
    const unknownOutside = asset(
      '//example.googleapis.com/things/loose',
      'example.googleapis.com/Thing',
      { name: 'loose' },
      undefined,
      ['organizations/30000000001'],
    );
    const links = linksOf([inProject, unknownOutside]);
    expect(links(inProject.name)).toEqual({ kind: 'project', url: HOME, projectId: PROJECT });
    expect(links(unknownOutside.name)).toBeUndefined();
  });
});
