// SPDX-License-Identifier: MIT
import { GraphSchema, type Asset } from '@gcportrait/model';
import { describe, expect, it } from 'vitest';
import { buildGraph, buildGraphWithReport } from './build.js';
import { REGION_TYPE, ZONE_TYPE } from './structure.js';
import {
  ORG,
  catalogWith,
  computeName,
  folder,
  folderName,
  network,
  organization,
  project,
  projectName,
  resource,
  selfLink,
  subnetwork,
} from './testing/fixtures.js';
import { edgeBetween as edge, parentOf } from './testing/graph.js';
import {
  CONNECTOR,
  DISK,
  GADGET,
  HOST_ID,
  HOST_NUMBER,
  HOST_SUBNET,
  LOCAL_SUBNET,
  LOCAL_SUBNET_B,
  LOCAL_VPC,
  ON_HOST,
  ON_NETWORK,
  ON_SUBNET,
  PROJECT_HOST,
  PROJECT_WEB,
  RUN_SERVICE,
  SA_EMAIL,
  SCENARIO_ENTRIES,
  SERVICE_ACCOUNT,
  SHARED_VPC,
  TWO_NICS,
  WEB_ID,
  WEB_NUMBER,
  checkedBuild,
  scenarioAssets,
  scenarioCatalog,
} from './testing/scenario.js';

const CATALOG = scenarioCatalog();

describe('buildGraph on the scenario', () => {
  const { graph, report } = checkedBuild(scenarioAssets(), CATALOG);

  it('builds one node per asset and the resource hierarchy from parents and ancestors', () => {
    expect(Object.keys(graph.nodes)).toHaveLength(scenarioAssets().length);
    expect(parentOf(graph, folderName('20000000003'))).toBe(folderName('20000000002'));
    expect(parentOf(graph, folderName('20000000002'))).toBe(ORG);
    expect(parentOf(graph, PROJECT_WEB)).toBe(folderName('20000000003'));
    expect(parentOf(graph, PROJECT_HOST)).toBe(folderName('20000000001'));
    expect(parentOf(graph, ORG)).toBeUndefined();
    expect(graph.containment.children[ORG]).toEqual([folderName('20000000001'), folderName('20000000002')]);
  });

  it('nests networks in their project and subnets in their network (declared by the network)', () => {
    expect(parentOf(graph, SHARED_VPC)).toBe(PROJECT_HOST);
    expect(parentOf(graph, HOST_SUBNET)).toBe(SHARED_VPC);
    expect(parentOf(graph, LOCAL_SUBNET)).toBe(LOCAL_VPC);
  });

  describe('rule 1: attachments', () => {
    it('nests a resource with exactly one subnet in that subnet; its network edge yields', () => {
      expect(parentOf(graph, ON_SUBNET)).toBe(LOCAL_SUBNET);
      expect(edge(graph, ON_SUBNET, LOCAL_SUBNET)).toEqual({
        from: ON_SUBNET,
        to: LOCAL_SUBNET,
        kind: 'attaches',
      });
      expect(edge(graph, ON_SUBNET, LOCAL_VPC)).toBeUndefined();
    });

    it('nests a resource with only a network in the VPC and keeps the weak edge, marked weak', () => {
      expect(parentOf(graph, ON_NETWORK)).toBe(LOCAL_VPC);
      expect(edge(graph, ON_NETWORK, LOCAL_VPC)).toEqual({
        from: ON_NETWORK,
        to: LOCAL_VPC,
        kind: 'attaches',
        weak: true,
      });
    });

    it('keeps a resource with several subnets in its project and draws both edges', () => {
      expect(parentOf(graph, TWO_NICS)).toBe(PROJECT_WEB);
      expect(edge(graph, TWO_NICS, LOCAL_SUBNET)?.kind).toBe('attaches');
      expect(edge(graph, TWO_NICS, LOCAL_SUBNET_B)?.kind).toBe('attaches');
      expect(edge(graph, TWO_NICS, LOCAL_VPC)).toBeUndefined();
    });

    it('does not nest in an attachment target that is not a container', () => {
      expect(parentOf(graph, RUN_SERVICE)).toBe(PROJECT_WEB);
      expect(edge(graph, RUN_SERVICE, CONNECTOR)?.kind).toBe('attaches');
    });

    it('counts the weak edges that yielded', () => {
      expect(report.counts.weakYielded).toBe(3);
    });
  });

  describe('rule 2: Shared VPC', () => {
    it('keeps a resource on a host subnet in its service project and joins the projects with shares', () => {
      expect(parentOf(graph, ON_HOST)).toBe(PROJECT_WEB);
      expect(edge(graph, ON_HOST, HOST_SUBNET)?.kind).toBe('attaches');
      expect(edge(graph, PROJECT_WEB, PROJECT_HOST)).toEqual({
        from: PROJECT_WEB,
        to: PROJECT_HOST,
        kind: 'shares',
      });
      expect(report.counts.crossProjectRefused).toBe(1);
    });

    it('reports the pair with its attachments and the shared-with count of each host-side target', () => {
      // Only attachments into the host's subnets (or a Shared VPC host's networks) count; the Cloud
      // Run service's connector in the host project is drawn, but it is no evidence of Shared VPC.
      expect(report.sharedVpc).toEqual([
        { service: PROJECT_WEB, host: PROJECT_HOST, attachments: [{ from: ON_HOST, to: HOST_SUBNET }] },
      ]);
      expect(report.sharedWith).toEqual({ [HOST_SUBNET]: 1 });
      expect(edge(graph, RUN_SERVICE, CONNECTOR)?.kind).toBe('attaches');
    });
  });

  describe('types the catalog does not map', () => {
    it('renders them as generic leaf cards in their project, labelled from the data, without edges', () => {
      expect(graph.nodes[GADGET]).toEqual({
        id: GADGET,
        assetType: 'gadgets.googleapis.com/Gadget',
        label: 'Shiny gadget',
        role: 'leaf',
        product: 'gadgets.googleapis.com',
        projectId: WEB_ID,
        projectNumber: WEB_NUMBER,
        location: 'global',
        ips: [],
        domains: [],
        hidden: false,
      });
      expect(parentOf(graph, GADGET)).toBe(PROJECT_WEB);
      expect(graph.edges.filter((e) => e.from === GADGET)).toEqual([]);
      expect(report.unmappedTypes).toEqual({ 'gadgets.googleapis.com/Gadget': 1 });
    });

    it('makes them core when another asset’s rule points at them', () => {
      const catalog = catalogWith([
        ...SCENARIO_ENTRIES,
        {
          product: 'Cloud Run',
          service: 'run.googleapis.com',
          icon: 'cloud_run',
          types: {
            'run.googleapis.com/Service': {
              role: 'core',
              relations: [{ kind: 'uses', to: '$.data.gadget', normalize: 'name' }],
            },
          },
        },
      ]);
      const assets = scenarioAssets().map((asset) =>
        asset.name === RUN_SERVICE ? { ...asset, data: { gadget: GADGET } } : asset,
      );
      const built = checkedBuild(assets, catalog).graph;
      expect(built.nodes[GADGET]?.role).toBe('core');
      expect(edge(built, RUN_SERVICE, GADGET)?.kind).toBe('uses');
    });

    it('falls back to the last segment of data.name, then of the asset name', () => {
      const assets = [
        project(WEB_NUMBER, WEB_ID),
        resource(
          `//gadgets.googleapis.com/projects/${WEB_ID}/gadgets/a`,
          'gadgets.googleapis.com/Gadget',
          WEB_NUMBER,
          {
            name: 'projects/demo-web-1/gadgets/from-data',
          },
        ),
        resource(
          `//gadgets.googleapis.com/projects/${WEB_ID}/gadgets/b`,
          'gadgets.googleapis.com/Gadget',
          WEB_NUMBER,
          null,
        ),
      ];
      const built = checkedBuild(assets, CATALOG).graph;
      expect(built.nodes[`//gadgets.googleapis.com/projects/${WEB_ID}/gadgets/a`]?.label).toBe('from-data');
      expect(built.nodes[`//gadgets.googleapis.com/projects/${WEB_ID}/gadgets/b`]?.label).toBe('b');
    });
  });

  describe('aliases and dangling references', () => {
    it('resolves a service-account e-mail (any case) to the service account by data.email', () => {
      expect(graph.indexes.aliases[SA_EMAIL]).toBe(SERVICE_ACCOUNT);
      expect(edge(graph, ON_SUBNET, SERVICE_ACCOUNT)?.kind).toBe('runsAs');
    });

    it('indexes project ids and numbers as aliases of the project node', () => {
      expect(graph.indexes.aliases).toMatchObject({
        [WEB_ID]: PROJECT_WEB,
        [WEB_NUMBER]: PROJECT_WEB,
        [HOST_ID]: PROJECT_HOST,
        [HOST_NUMBER]: PROJECT_HOST,
      });
    });

    it('keeps an unresolved reference per node with its raw value, counted and never drawn', () => {
      const missing = 'missing@demo-web-1.iam.gserviceaccount.com';
      expect(graph.dangling).toEqual([
        { from: RUN_SERVICE, to: missing, kind: 'runsAs', dangling: { raw: missing } },
      ]);
      expect(report.danglingByNode).toEqual({ [RUN_SERVICE]: 1 });
      expect(graph.edges.some((e) => e.to === missing)).toBe(false);
    });

    it('keeps a value its normaliser does not understand as dangling, with the raw text as target', () => {
      const assets = scenarioAssets().map((asset) =>
        asset.name === ON_SUBNET
          ? {
              ...asset,
              data: { ...(asset.data as object), disks: [{ source: 'not a self-link' }, { source: 7 }] },
            }
          : asset,
      );
      const built = checkedBuild(assets, CATALOG).graph;
      expect(built.dangling.filter((d) => d.from === ON_SUBNET)).toEqual([
        { from: ON_SUBNET, to: '7', kind: 'uses', dangling: { raw: '7' } },
        { from: ON_SUBNET, to: 'not a self-link', kind: 'uses', dangling: { raw: 'not a self-link' } },
      ]);
    });

    it('counts an alias claimed twice and keeps the first claim in name order', () => {
      const twin = resource(
        `//iam.googleapis.com/projects/${WEB_ID}/serviceAccounts/104000000000000000002`,
        'iam.googleapis.com/ServiceAccount',
        WEB_NUMBER,
        { email: SA_EMAIL },
      );
      const built = checkedBuild([...scenarioAssets(), twin], CATALOG);
      expect(built.report.counts.aliasConflicts).toBe(1);
      expect(built.graph.indexes.aliases[SA_EMAIL]).toBe(SERVICE_ACCOUNT);
    });
  });

  it('builds the indexes by type, project, address and host name', () => {
    expect(graph.indexes.byType['compute.googleapis.com/Instance']).toEqual([
      ON_HOST,
      ON_SUBNET,
      TWO_NICS,
      ON_NETWORK,
    ]);
    expect(graph.indexes.byProject[HOST_ID]).toEqual([PROJECT_HOST, SHARED_VPC, HOST_SUBNET, CONNECTOR]);
    expect(graph.indexes.byIp['10.1.0.2']).toEqual([ON_SUBNET]);
    expect(graph.indexes.byIp['10.1.0.0/24']).toEqual([LOCAL_SUBNET]);
    expect(graph.indexes.byDomain['api.example.org']).toEqual([RUN_SERVICE]);
    expect(Object.keys(graph.indexes.byProject)).toEqual([HOST_ID, WEB_ID]);
  });

  it('uses the catalog for labels, subtitles, products and roles', () => {
    expect(graph.nodes[SHARED_VPC]).toMatchObject({
      label: 'vpc-shared',
      subtitle: 'VPC network · global routing',
      role: 'container',
      product: 'Compute Engine',
    });
    expect(graph.nodes[DISK]?.role).toBe('leaf');
    expect(graph.nodes[ORG]?.label).toBe('example.com');
  });
});

describe('determinism', () => {
  it('builds the same graph twice and for any order of the assets', () => {
    const assets = scenarioAssets();
    const first = buildGraphWithReport({ assets }, CATALOG);
    expect(buildGraphWithReport({ assets }, CATALOG)).toEqual(first);
    expect(buildGraphWithReport({ assets: [...assets].reverse() }, CATALOG)).toEqual(first);
  });

  it('keeps the latest copy of a repeated asset name and counts the repeat', () => {
    const assets = scenarioAssets();
    const older = { ...(assets.find((a) => a.name === GADGET) as Asset), updateTime: '2026-01-01T00:00:00Z' };
    const renamed = { ...older, data: { displayName: 'Old gadget' } };
    for (const order of [
      [renamed, ...assets],
      [...assets, renamed],
    ]) {
      const built = checkedBuild(order, CATALOG);
      expect(built.graph.nodes[GADGET]?.label).toBe('Shiny gadget');
      expect(built.report.counts.duplicateAssets).toBe(1);
    }
  });

  it('returns only the Graph from buildGraph', () => {
    const graph = buildGraph({ assets: scenarioAssets() }, CATALOG);
    expect(GraphSchema.parse(graph)).toEqual(
      buildGraphWithReport({ assets: scenarioAssets() }, CATALOG).graph,
    );
  });

  it('builds an empty graph from an empty snapshot', () => {
    expect(checkedBuild([], CATALOG).graph).toEqual({
      nodes: {},
      containment: { parent: {}, children: {} },
      edges: [],
      dangling: [],
      indexes: { byType: {}, byProject: {}, byIp: {}, byDomain: {}, aliases: {} },
    });
  });
});

describe('default visibility', () => {
  it('hides hidden-role types and assets matching hiddenWhen', () => {
    const tagKey = resource(
      '//cloudresourcemanager.googleapis.com/tagKeys/30000000101',
      'cloudresourcemanager.googleapis.com/TagKey',
      WEB_NUMBER,
      {
        namespacedName: '30000000001/env',
      },
    );
    const assets = scenarioAssets().map((asset) =>
      asset.name === TWO_NICS
        ? { ...asset, data: { ...(asset.data as object), status: 'TERMINATED' } }
        : asset,
    );
    const graph = checkedBuild([...assets, tagKey], CATALOG).graph;
    expect(graph.nodes[TWO_NICS]?.hidden).toBe(true);
    expect(graph.nodes[TWO_NICS]?.hiddenWhenMatched).toBe(true);
    expect(graph.nodes[ON_SUBNET]?.hidden).toBe(false);
    expect(graph.nodes[ON_SUBNET]).not.toHaveProperty('hiddenWhenMatched');
    expect(graph.nodes[tagKey.name]).toMatchObject({ role: 'hidden', hidden: true });
    expect(graph.nodes[tagKey.name]).not.toHaveProperty('hiddenWhenMatched');
  });
});

describe('rule 3: virtual region and zone containers', () => {
  const { graph, report } = checkedBuild(scenarioAssets(), CATALOG, { showRegions: true });
  const region = (projectId: string, location: string): string =>
    `//gcportrait.virtual/projects/${projectId}/locations/${location}`;
  const zone = (projectId: string, location: string): string =>
    `${region(projectId, location.slice(0, location.lastIndexOf('-')))}/zones/${location}`;

  it('groups a project’s direct children by region and zone', () => {
    expect(parentOf(graph, ON_HOST)).toBe(zone(WEB_ID, 'europe-west3-a'));
    expect(parentOf(graph, DISK)).toBe(zone(WEB_ID, 'europe-west3-a'));
    expect(parentOf(graph, zone(WEB_ID, 'europe-west3-a'))).toBe(region(WEB_ID, 'europe-west3'));
    expect(parentOf(graph, region(WEB_ID, 'europe-west3'))).toBe(PROJECT_WEB);
    expect(parentOf(graph, RUN_SERVICE)).toBe(region(WEB_ID, 'europe-west3'));
    expect(parentOf(graph, CONNECTOR)).toBe(region(HOST_ID, 'europe-west3'));
    expect(graph.nodes[region(WEB_ID, 'europe-west3')]).toEqual({
      id: region(WEB_ID, 'europe-west3'),
      assetType: REGION_TYPE,
      label: 'europe-west3',
      subtitle: 'region',
      role: 'container',
      product: 'gcportrait.virtual',
      projectId: WEB_ID,
      projectNumber: WEB_NUMBER,
      location: 'europe-west3',
      ips: [],
      domains: [],
      hidden: false,
    });
    expect(graph.nodes[zone(WEB_ID, 'europe-west3-a')]?.assetType).toBe(ZONE_TYPE);
    expect(report.counts.virtualNodes).toBe(3);
  });

  it('leaves global resources, VPCs and everything inside them where they are', () => {
    expect(parentOf(graph, GADGET)).toBe(PROJECT_WEB);
    expect(parentOf(graph, SERVICE_ACCOUNT)).toBe(PROJECT_WEB);
    expect(parentOf(graph, LOCAL_VPC)).toBe(PROJECT_WEB);
    expect(parentOf(graph, LOCAL_SUBNET)).toBe(LOCAL_VPC);
    expect(parentOf(graph, ON_SUBNET)).toBe(LOCAL_SUBNET);
  });

  it('labels a multi-region location as such', () => {
    const bucket = resource(
      '//storage.googleapis.com/demo-web-1-lake',
      'storage.googleapis.com/Bucket',
      WEB_NUMBER,
      {},
      {
        location: 'EU',
      },
    );
    const built = checkedBuild([...scenarioAssets(), bucket], CATALOG, { showRegions: true }).graph;
    expect(parentOf(built, bucket.name)).toBe(region(WEB_ID, 'eu'));
    expect(built.nodes[region(WEB_ID, 'eu')]?.subtitle).toBe('multi-region');
  });

  it('puts a zone with a longer suffix (an AI zone) in its region, as the regions filter counts it', () => {
    const disk = resource(
      computeName(WEB_ID, 'zones/us-central1-ai1a/disks/train-scratch'),
      'compute.googleapis.com/Disk',
      WEB_NUMBER,
      { name: 'train-scratch' },
      { location: 'us-central1-ai1a' },
    );
    const built = checkedBuild([...scenarioAssets(), disk], CATALOG, { showRegions: true }).graph;
    expect(parentOf(built, disk.name)).toBe(zone(WEB_ID, 'us-central1-ai1a'));
    expect(parentOf(built, zone(WEB_ID, 'us-central1-ai1a'))).toBe(region(WEB_ID, 'us-central1'));
    expect(built.nodes[region(WEB_ID, 'us-central1')]?.subtitle).toBe('region');
    expect(built.nodes[zone(WEB_ID, 'us-central1-ai1a')]?.subtitle).toBe('zone');
    expect(built.nodes[region(WEB_ID, 'us-central1-ai1a')]).toBeUndefined();
  });
});

/** Test containers whose rules can be made to disagree. */
const BOXES = catalogWith([
  {
    product: 'Boxes',
    service: 'boxes.googleapis.com',
    icon: 'boxes',
    types: {
      'boxes.googleapis.com/Box': {
        role: 'container',
        contains: ['$.data.children[*]', { byParent: 'boxes.googleapis.com/Item' }],
        relations: [{ kind: 'attaches', to: '$.data.attachedTo', normalize: 'name' }],
      },
      'boxes.googleapis.com/Item': { role: 'leaf' },
    },
  },
]);

function box(name: string, data: Record<string, unknown>, parent?: string): Asset {
  return resource(
    `//boxes.googleapis.com/projects/${WEB_ID}/boxes/${name}`,
    'boxes.googleapis.com/Box',
    WEB_NUMBER,
    data,
    {
      ...(parent === undefined ? {} : { parent }),
    },
  );
}

const boxName = (name: string): string => `//boxes.googleapis.com/projects/${WEB_ID}/boxes/${name}`;
const BASE = [organization(), project(WEB_NUMBER, WEB_ID)];

describe('rule 5: cycles', () => {
  it('refuses a cycle of declarations, reports it, and still nests every node', () => {
    const assets = [
      ...BASE,
      box('a', { children: [`projects/${WEB_ID}/boxes/b`] }),
      box('b', { children: [`projects/${WEB_ID}/boxes/a`] }),
    ];
    const { graph, report } = checkedBuild(assets, BOXES);
    expect(report.cycles).toEqual([{ ids: [boxName('a'), boxName('b')] }]);
    expect(parentOf(graph, boxName('b'))).toBe(boxName('a'));
    expect(parentOf(graph, boxName('a'))).toBe(projectName(WEB_NUMBER));
  });

  it('lets a container’s declaration win over another node’s attachment, whatever the name order', () => {
    for (const [outer, inner] of [
      ['a', 'z'],
      ['z', 'a'],
    ] as const) {
      const assets = [
        ...BASE,
        box(outer, {
          children: [`projects/${WEB_ID}/boxes/${inner}`],
          attachedTo: `projects/${WEB_ID}/boxes/${inner}`,
        }),
        box(inner, {}),
      ];
      const { graph, report } = checkedBuild(assets, BOXES);
      expect(parentOf(graph, boxName(inner))).toBe(boxName(outer));
      expect(parentOf(graph, boxName(outer))).toBe(projectName(WEB_NUMBER));
      expect(report.cycles).toHaveLength(1);
    }
  });

  it('refuses an attachment cycle between two containers', () => {
    const assets = [
      ...BASE,
      box('a', { attachedTo: `projects/${WEB_ID}/boxes/b` }),
      box('b', { attachedTo: `projects/${WEB_ID}/boxes/a` }),
    ];
    const { graph, report } = checkedBuild(assets, BOXES);
    expect(report.cycles).toEqual([{ ids: [boxName('a'), boxName('b')] }]);
    const parents = [parentOf(graph, boxName('a')), parentOf(graph, boxName('b'))];
    expect(parents).toContain(projectName(WEB_NUMBER));
  });
});

describe('declared containment', () => {
  it('nests a byParent child by its parent field or its name, the innermost container winning', () => {
    const item = (name: string, parent?: string): Asset =>
      resource(name, 'boxes.googleapis.com/Item', WEB_NUMBER, {}, parent === undefined ? {} : { parent });
    const assets = [
      ...BASE,
      box('outer', {}),
      resource(`${boxName('outer')}/boxes/inner`, 'boxes.googleapis.com/Box', WEB_NUMBER, {}),
      item(`${boxName('outer')}/boxes/inner/items/by-name`),
      item(`//boxes.googleapis.com/projects/${WEB_ID}/items/by-parent`, boxName('outer')),
    ];
    const { graph } = checkedBuild(assets, BOXES);
    expect(parentOf(graph, `${boxName('outer')}/boxes/inner/items/by-name`)).toBe(
      `${boxName('outer')}/boxes/inner`,
    );
    expect(parentOf(graph, `//boxes.googleapis.com/projects/${WEB_ID}/items/by-parent`)).toBe(
      boxName('outer'),
    );
  });

  it('passes a non-container parent’s placement on to its children', () => {
    const item = `${boxName('b')}/items/i`;
    const part = `//boxes.googleapis.com/projects/${WEB_ID}/parts/p`;
    const assets = [
      ...BASE,
      box('b', {}),
      resource(item, 'boxes.googleapis.com/Item', WEB_NUMBER, {}),
      resource(part, 'boxes.googleapis.com/Part', WEB_NUMBER, {}, { parent: item }),
    ];
    const { graph } = checkedBuild(assets, BOXES);
    expect(parentOf(graph, item)).toBe(boxName('b'));
    expect(parentOf(graph, part)).toBe(boxName('b'));
  });

  it('never nests the resource hierarchy in anything else', () => {
    const assets = [...BASE, box('greedy', { children: [projectName(WEB_NUMBER)] })];
    const { graph } = checkedBuild(assets, BOXES);
    expect(parentOf(graph, projectName(WEB_NUMBER))).toBe(ORG);
    expect(parentOf(graph, boxName('greedy'))).toBe(projectName(WEB_NUMBER));
  });

  it('never nests across projects, even when a container declares it', () => {
    const assets = [
      ...BASE,
      project(HOST_NUMBER, HOST_ID),
      resource(
        `//boxes.googleapis.com/projects/${HOST_ID}/boxes/h`,
        'boxes.googleapis.com/Box',
        HOST_NUMBER,
        {
          children: [`projects/${WEB_ID}/boxes/w`],
        },
      ),
      box('w', {}),
    ];
    const { graph, report } = checkedBuild(assets, BOXES);
    expect(parentOf(graph, boxName('w'))).toBe(projectName(WEB_NUMBER));
    expect(report.counts.crossProjectRefused).toBe(1);
  });

  it('falls back to the closest ancestor in the snapshot, and to a root without one', () => {
    const orphan = resource(
      `//boxes.googleapis.com/projects/${WEB_ID}/boxes/orphan`,
      'boxes.googleapis.com/Box',
      WEB_NUMBER,
      {},
      {
        parent: projectName('10000000099'),
        folders: ['20000000001'],
      },
    );
    const lonely = { ...orphan, name: `${orphan.name}-2`, ancestors: [] };
    const { graph } = checkedBuild(
      [organization(), folder('20000000001', 'Platform'), orphan, lonely],
      BOXES,
    );
    expect(parentOf(graph, orphan.name)).toBe(folderName('20000000001'));
    expect(parentOf(graph, lonely.name)).toBeUndefined();
  });
});

describe('Kubernetes objects', () => {
  const cluster = `//container.googleapis.com/projects/${WEB_ID}/locations/europe-west3/clusters/shop`;
  const k8s = (path: string, assetType: string, data: Record<string, unknown> = {}): Asset =>
    resource(
      `${cluster}/k8s/${path}`,
      assetType,
      WEB_NUMBER,
      { metadata: { name: path.split('/').at(-1) }, ...data },
      {
        parent: cluster,
        location: 'europe-west3',
      },
    );
  const assets: Asset[] = [
    ...BASE,
    network(WEB_NUMBER, WEB_ID, 'vpc', ['regions/europe-west3/subnetworks/gke']),
    subnetwork(WEB_NUMBER, WEB_ID, 'europe-west3', 'gke', 'vpc', '10.2.0.0/22'),
    resource(
      cluster,
      'container.googleapis.com/Cluster',
      WEB_NUMBER,
      {
        name: 'shop',
        networkConfig: {
          network: `projects/${WEB_ID}/global/networks/vpc`,
          subnetwork: `projects/${WEB_ID}/regions/europe-west3/subnetworks/gke`,
        },
      },
      { location: 'europe-west3' },
    ),
    k8s('namespaces/web', 'k8s.io/Namespace', { status: { phase: 'Active' } }),
    k8s('namespaces/web/pods/front-1', 'k8s.io/Pod'),
    k8s('namespaces/web/configmaps/settings', 'k8s.io/ConfigMap'),
    k8s('namespaces/web/apps/deployments/front', 'apps.k8s.io/Deployment'),
    k8s('nodes/node-1', 'k8s.io/Node'),
    k8s('rbac.authorization.k8s.io/clusterroles/viewer', 'rbac.authorization.k8s.io/ClusterRole'),
    resource(
      `${cluster}/nodePools/default`,
      'container.googleapis.com/NodePool',
      WEB_NUMBER,
      {},
      { parent: cluster },
    ),
  ];
  const { graph } = checkedBuild(assets, CATALOG);

  it('nests the cluster in its subnet (one attachment), namespaces and nodes in the cluster', () => {
    expect(parentOf(graph, cluster)).toBe(computeName(WEB_ID, 'regions/europe-west3/subnetworks/gke'));
    expect(parentOf(graph, `${cluster}/k8s/namespaces/web`)).toBe(cluster);
    expect(parentOf(graph, `${cluster}/k8s/nodes/node-1`)).toBe(cluster);
    expect(parentOf(graph, `${cluster}/nodePools/default`)).toBe(cluster);
  });

  it('nests namespaced objects in their namespace by name path, also types the catalog does not map', () => {
    for (const path of ['pods/front-1', 'configmaps/settings', 'apps/deployments/front']) {
      expect(parentOf(graph, `${cluster}/k8s/namespaces/web/${path}`)).toBe(`${cluster}/k8s/namespaces/web`);
    }
    expect(parentOf(graph, `${cluster}/k8s/rbac.authorization.k8s.io/clusterroles/viewer`)).toBe(cluster);
  });
});

describe('peerings', () => {
  it('folds reciprocal peerings into one edge from the smaller id and keeps one-sided ones', () => {
    const tenant = selfLink('a1b2c3-tp', 'global/networks/servicenetworking');
    const assets = [
      ...BASE,
      project(HOST_NUMBER, HOST_ID),
      network(WEB_NUMBER, WEB_ID, 'blue', [], [selfLink(HOST_ID, 'global/networks/green'), tenant]),
      network(HOST_NUMBER, HOST_ID, 'green', [], [selfLink(WEB_ID, 'global/networks/blue')]),
    ];
    const { graph, report } = checkedBuild(assets, CATALOG);
    const green = computeName(HOST_ID, 'global/networks/green');
    const blue = computeName(WEB_ID, 'global/networks/blue');
    expect(graph.edges.filter((e) => e.kind === 'peers')).toEqual([{ from: green, to: blue, kind: 'peers' }]);
    expect(report.counts.peersMerged).toBe(1);
    expect(graph.dangling).toEqual([
      {
        from: blue,
        to: computeName('a1b2c3-tp', 'global/networks/servicenetworking'),
        kind: 'peers',
        dangling: { raw: tenant },
      },
    ]);
  });
});

describe('child-side containment: nestsIn', () => {
  const OTHER_ID = 'demo-other-1';
  const OTHER_NUMBER = '10000000077';
  const POOLS = catalogWith([
    {
      product: 'Pools',
      service: 'pools.googleapis.com',
      icon: 'pools',
      types: {
        'pools.googleapis.com/Pool': { role: 'container' },
        'pools.googleapis.com/Card': { role: 'core' },
        'pools.googleapis.com/Volume': {
          role: 'core',
          nestsIn: [
            { to: '$.data.pool', normalize: 'siblingName', pattern: '{parent}/pools/{id}', kind: 'uses' },
            { to: '$.data.fallbackPool', normalize: 'name' },
          ],
        },
      },
    },
  ]);
  const pool = (projectId: string, number: string, name: string): Asset =>
    resource(
      `//pools.googleapis.com/projects/${projectId}/pools/${name}`,
      'pools.googleapis.com/Pool',
      number,
      {},
    );
  const volume = (name: string, data: Record<string, unknown>): Asset =>
    resource(
      `//pools.googleapis.com/projects/${WEB_ID}/volumes/${name}`,
      'pools.googleapis.com/Volume',
      WEB_NUMBER,
      data,
    );
  const name = (projectId: string, collection: string, id: string): string =>
    `//pools.googleapis.com/projects/${projectId}/${collection}/${id}`;

  it('nests in the container the node names, and draws the rule kind where it cannot nest', () => {
    const assets = [
      ...BASE,
      project(OTHER_NUMBER, OTHER_ID),
      pool(WEB_ID, WEB_NUMBER, 'fast'),
      pool(OTHER_ID, OTHER_NUMBER, 'shared'),
      resource(name(WEB_ID, 'pools', 'card'), 'pools.googleapis.com/Card', WEB_NUMBER, {}),
      volume('a', { pool: 'fast' }),
      volume('b', { pool: `projects/${OTHER_ID}/pools/shared` }),
      volume('c', { pool: 'missing' }),
      volume('d', { pool: 'card', fallbackPool: `projects/${WEB_NUMBER}/pools/fast` }),
    ];
    const { graph, report } = checkedBuild(assets, POOLS);
    expect(parentOf(graph, name(WEB_ID, 'volumes', 'a'))).toBe(name(WEB_ID, 'pools', 'fast'));
    expect(edge(graph, name(WEB_ID, 'volumes', 'a'), name(WEB_ID, 'pools', 'fast'))).toBeUndefined();
    // A pool in another project: no nesting across projects; the rule's kind is drawn instead.
    expect(parentOf(graph, name(WEB_ID, 'volumes', 'b'))).toBe(projectName(WEB_NUMBER));
    expect(edge(graph, name(WEB_ID, 'volumes', 'b'), name(OTHER_ID, 'pools', 'shared'))?.kind).toBe('uses');
    expect(graph.dangling).toContainEqual({
      from: name(WEB_ID, 'volumes', 'c'),
      to: name(WEB_ID, 'pools', 'missing'),
      kind: 'uses',
      dangling: { raw: 'missing' },
    });
    // Not a container: the next rule's target, found with its project number swapped for the id.
    expect(parentOf(graph, name(WEB_ID, 'volumes', 'd'))).toBe(name(WEB_ID, 'pools', 'fast'));
    expect(edge(graph, name(WEB_ID, 'volumes', 'd'), name(WEB_ID, 'pools', 'card'))?.kind).toBe('uses');
    expect(report.counts.nestedByReference).toBe(2);
    expect(report.counts.crossProjectRefused).toBe(1);
  });
});

describe('nestsIn through an alias', () => {
  it('resolves alias targets like relations, drawing the kind or dangling the alias', () => {
    const ROBOTS = catalogWith([
      ...SCENARIO_ENTRIES,
      {
        product: 'Robots',
        service: 'robots.googleapis.com',
        icon: 'robots',
        types: {
          'robots.googleapis.com/Robot': {
            role: 'core',
            nestsIn: { to: '$.data.operators[*]', normalize: 'serviceAccountEmail', kind: 'runsAs' },
          },
        },
      },
    ]);
    const robot = resource(
      `//robots.googleapis.com/projects/${WEB_ID}/robots/r2`,
      'robots.googleapis.com/Robot',
      WEB_NUMBER,
      {
        operators: [SA_EMAIL, `nobody@${WEB_ID}.iam.gserviceaccount.com`],
      },
    );
    const sa = scenarioAssets().find((asset) => asset.name === SERVICE_ACCOUNT);
    const { graph } = checkedBuild([...BASE, ...(sa === undefined ? [] : [sa]), robot], ROBOTS);
    expect(parentOf(graph, robot.name)).toBe(projectName(WEB_NUMBER));
    expect(edge(graph, robot.name, SERVICE_ACCOUNT)?.kind).toBe('runsAs');
    expect(graph.dangling).toEqual([
      {
        from: robot.name,
        to: `nobody@${WEB_ID}.iam.gserviceaccount.com`,
        kind: 'runsAs',
        dangling: { raw: `nobody@${WEB_ID}.iam.gserviceaccount.com` },
      },
    ]);
  });
});

describe('Shared VPC hosts', () => {
  it('marks a project whose Compute settings say HOST, and only counts its networks then', () => {
    const settings = (projectId: string, number: string, status: string): Asset =>
      resource(`//compute.googleapis.com/projects/${projectId}`, 'compute.googleapis.com/Project', number, {
        name: projectId,
        xpnProjectStatus: status,
      });
    const sql = (projectId: string, number: string, networkProject: string): Asset =>
      resource(
        `//cloudsql.googleapis.com/projects/${projectId}/instances/db`,
        'sqladmin.googleapis.com/Instance',
        number,
        {
          name: 'db',
          settings: {
            ipConfiguration: { privateNetwork: `projects/${networkProject}/global/networks/core` },
          },
        },
      );
    for (const status of ['HOST', 'UNSPECIFIED_XPN_PROJECT_STATUS']) {
      const assets = [
        ...BASE,
        project(HOST_NUMBER, HOST_ID),
        settings(HOST_ID, HOST_NUMBER, status),
        network(HOST_NUMBER, HOST_ID, 'core', []),
        sql(WEB_ID, WEB_NUMBER, HOST_ID),
      ];
      const { graph, report } = checkedBuild(assets, CATALOG);
      const host = status === 'HOST';
      expect(graph.nodes[PROJECT_HOST]?.sharedVpcHost).toBe(host ? true : undefined);
      expect(
        edge(
          graph,
          `//cloudsql.googleapis.com/projects/${WEB_ID}/instances/db`,
          computeName(HOST_ID, 'global/networks/core'),
        )?.kind,
      ).toBe('attaches');
      expect(report.sharedVpc.length).toBe(host ? 1 : 0);
      expect(edge(graph, PROJECT_WEB, PROJECT_HOST)?.kind).toBe(host ? 'shares' : undefined);
    }
  });
});
