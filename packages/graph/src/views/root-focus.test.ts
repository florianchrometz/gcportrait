// SPDX-License-Identifier: MIT
/** Steps (a) and (b) on the views scenario: drill-in roots and the five focus views, errors included. */
import type { FocusKind, SceneBuild, SceneEnv, ViewSpecInput } from '@gcportrait/model';
import { describe, expect, it } from 'vitest';
import { ORG, organization, resource } from '../testing/fixtures.js';
import {
  CONNECTOR,
  HOST_SUBNET,
  LOCAL_SUBNET,
  LOCAL_VPC,
  ON_HOST,
  ON_SUBNET,
  PROJECT_HOST,
  PROJECT_WEB,
  RUN_SERVICE,
  WEB_NUMBER,
} from '../testing/scenario.js';
import { childIds, edgesBetween, parentOf, shows, zone } from '../testing/scene.js';
import {
  APP,
  APP_SERVICE,
  APP_WORKLOAD,
  ENV,
  FOLDER_PLATFORM,
  FOLDER_RETAIL,
  FOLDER_SANDBOX,
  FOLDER_WORKLOADS,
  PERIMETER,
  POLICY,
  PROJECT_EMPTY,
  PROJECT_PEER_A,
  PROJECT_SOLO,
  checkedScene,
  viewAssets,
  viewCatalog,
  viewGraphOf,
} from '../testing/views.js';

const CATALOG = viewCatalog();
const GRAPH = viewGraphOf();

function build(input: ViewSpecInput, env: SceneEnv = ENV, graph = GRAPH): SceneBuild {
  return checkedScene(input, { graph, catalog: CATALOG, env });
}

interface Refusal {
  readonly kind: FocusKind;
  /** What the request names, for the test's title. */
  readonly what: string;
  readonly params: Record<string, string>;
  readonly root?: string;
  readonly code: string;
  readonly param: string;
}

/**
 * Focus requests that are refused, with the error code and the parameter it names (an ambiguous application needs
 * a graph of its own). Without a root they ask for the whole scope.
 */
const REFUSALS: readonly Refusal[] = [
  { kind: 'project', what: 'no project', params: {}, code: 'missing-param', param: 'project' },
  {
    kind: 'project',
    what: 'an unknown project',
    params: { project: 'demo-nope-1' },
    code: 'unknown-project',
    param: 'project',
  },
  {
    kind: 'project',
    what: 'a VM',
    params: { project: ON_HOST },
    code: 'unknown-project',
    param: 'project',
  },
  {
    kind: 'project',
    what: 'a project outside the root',
    params: { project: 'demo-web-1' },
    root: FOLDER_PLATFORM,
    code: 'outside-root',
    param: 'project',
  },
  {
    kind: 'shared-vpc',
    what: 'a project that is no host',
    params: { host: 'demo-solo-1' },
    code: 'not-a-host',
    param: 'host',
  },
  { kind: 'shared-vpc', what: 'no host', params: {}, code: 'missing-param', param: 'host' },
  {
    kind: 'shared-vpc',
    what: 'an unknown project',
    params: { host: 'demo-nope-1' },
    code: 'unknown-project',
    param: 'host',
  },
  {
    kind: 'shared-vpc',
    what: 'a host outside the root',
    params: { host: 'demo-net-1' },
    root: FOLDER_SANDBOX,
    code: 'outside-root',
    param: 'host',
  },
  {
    kind: 'perimeter',
    what: 'an unknown perimeter',
    params: { perimeter: 'nope' },
    code: 'unknown-perimeter',
    param: 'perimeter',
  },
  {
    kind: 'perimeter',
    what: 'a node that secures nothing',
    params: { perimeter: ON_HOST },
    code: 'not-a-perimeter',
    param: 'perimeter',
  },
  { kind: 'perimeter', what: 'no perimeter', params: {}, code: 'missing-param', param: 'perimeter' },
  {
    kind: 'perimeter',
    what: 'a perimeter outside the root',
    params: { perimeter: 'shop_perimeter' },
    root: FOLDER_SANDBOX,
    code: 'outside-root',
    param: 'perimeter',
  },
  {
    kind: 'application',
    what: 'an unknown application',
    params: { application: 'nope' },
    code: 'unknown-application',
    param: 'application',
  },
  {
    kind: 'application',
    what: 'a node that is no container',
    params: { application: ON_HOST },
    code: 'not-an-application',
    param: 'application',
  },
  { kind: 'application', what: 'no application', params: {}, code: 'missing-param', param: 'application' },
  {
    kind: 'application',
    what: 'an application outside the root',
    params: { application: APP },
    root: FOLDER_PLATFORM,
    code: 'outside-root',
    param: 'application',
  },
];

function refused({ kind, params, root }: Refusal): ViewSpecInput {
  return { lens: 'overview', focus: { kind, params }, ...(root === undefined ? {} : { root }) };
}

describe('drill-in root (a)', () => {
  it('drops the organisation: its children are the top level and it names the canvas', () => {
    const { scene, report } = build({ lens: 'everything' });
    expect(childIds(scene)).toEqual([FOLDER_PLATFORM, FOLDER_SANDBOX, FOLDER_WORKLOADS, POLICY]);
    expect(shows(scene, ORG)).toBe(false);
    expect(scene.metadata.rootLabel).toBe('example.com');
    expect(report.root).toEqual({});
    expect(report.counts.universe).toBe(Object.keys(GRAPH.nodes).length - 1);
  });

  it('re-roots at a folder, a project and a VPC: the root is the canvas, its children the top level', () => {
    const folder = build({ lens: 'everything', root: FOLDER_WORKLOADS });
    expect(childIds(folder.scene)).toEqual([FOLDER_RETAIL]);
    expect(folder.scene.metadata.rootLabel).toBe('Workloads');
    expect(folder.report.root).toEqual({ requested: FOLDER_WORKLOADS, used: FOLDER_WORKLOADS });

    const project = build({ lens: 'everything', root: PROJECT_WEB, detail: 'all' });
    expect(shows(project.scene, PROJECT_WEB)).toBe(false);
    expect(childIds(project.scene)).toContain(LOCAL_VPC);
    expect(project.scene.metadata.rootLabel).toBe('demo-web-1');

    const vpc = build({ lens: 'everything', root: LOCAL_VPC, detail: 'all' });
    expect(childIds(vpc.scene)).toEqual([
      LOCAL_SUBNET,
      '//compute.googleapis.com/projects/demo-web-1/regions/europe-west3/subnetworks/local-b',
      '//compute.googleapis.com/projects/demo-web-1/zones/europe-west3-b/instances/on-network',
    ]);
    // Edges leaving the root are not drawn: the VM's disk and service account are outside the VPC.
    expect(vpc.scene.edges.every((edge) => edge.from !== ON_SUBNET)).toBe(true);
  });

  it('falls back to the organisation for an unknown root or one that is not a container, and says why', () => {
    const unknown = build({
      lens: 'everything',
      root: '//compute.googleapis.com/projects/x/global/networks/nope',
    });
    expect(unknown.report.root.error?.code).toBe('unknown-root');
    expect(unknown.report.root.used).toBeUndefined();
    // The refusal travels with the scene, so a caller that keeps only the Scene can still say why.
    expect(unknown.scene.metadata.rootError).toEqual(unknown.report.root.error);
    expect(build({ lens: 'everything' }).scene.metadata).not.toHaveProperty('rootError');
    expect(childIds(unknown.scene)).toEqual(childIds(build({ lens: 'everything' }).scene));
    expect(unknown.report.warnings[0]).toMatch(/showing the whole scope/);

    const card = build({ lens: 'everything', root: ON_HOST });
    expect(card.report.root).toMatchObject({ requested: ON_HOST, error: { code: 'not-a-container' } });
  });

  it('names the canvas after the caller when no organisation is in the snapshot', () => {
    const graph = viewGraphOf(viewAssets().filter((asset) => asset.name !== ORG));
    expect(
      build({ lens: 'everything' }, { ...ENV, rootLabel: 'Workloads scope' }, graph).scene.metadata.rootLabel,
    ).toBe('Workloads scope');
    expect(build({ lens: 'everything' }, ENV, graph).scene.metadata.rootLabel).toBe('All resources');
    // Without an organisation node nothing is dropped: the folders are the forest's roots.
    expect(childIds(build({ lens: 'everything' }, ENV, graph).scene)).toContain(FOLDER_PLATFORM);
  });

  it('does not name the canvas after one of several organisations', () => {
    const second = {
      ...organization(),
      name: '//cloudresourcemanager.googleapis.com/organizations/30000000002',
    };
    const graph = viewGraphOf([...viewAssets(), { ...second, ancestors: ['organizations/30000000002'] }]);
    expect(build({ lens: 'everything' }, ENV, graph).scene.metadata.rootLabel).toBe('All resources');
  });
});

describe('focus: project', () => {
  it('shows the project, and its edges leaving it to external stubs grouped by project', () => {
    for (const project of [
      'demo-web-1',
      '10000000002',
      PROJECT_WEB,
      'projects/demo-web-1',
      'projects/10000000002',
    ]) {
      const { scene, report } = build({
        lens: 'overview',
        detail: 'all',
        focus: { kind: 'project', params: { project } },
      });
      expect(report.focus).toEqual({
        status: 'applied',
        kind: 'project',
        anchor: PROJECT_WEB,
        projects: [PROJECT_WEB],
      });
      // Ordered by label: demo-net-1 (external) before demo-web-1.
      expect(childIds(scene)).toEqual([PROJECT_HOST, PROJECT_WEB]);
      const host = zone(scene, PROJECT_HOST);
      expect(host.badges).toEqual(['external']);
      expect(host.children.map((child) => [child.type, child.id])).toEqual([
        ['card', CONNECTOR],
        ['card', HOST_SUBNET],
      ]);
      expect(edgesBetween(scene, PROJECT_WEB, PROJECT_HOST, 'shares')).toHaveLength(1);
      expect(edgesBetween(scene, ON_HOST, HOST_SUBNET, 'attaches')).toHaveLength(1);
      expect(edgesBetween(scene, RUN_SERVICE, CONNECTOR, 'attaches')).toHaveLength(1);
      expect(report.counts.stubs).toBe(3);
      expect(report.external).toEqual([PROJECT_HOST, CONNECTOR, HOST_SUBNET].sort());
      expect(report.legend.external).toBe(true);
    }
  });

  it('puts the stubs at the top level when the lens rules hide projects, and lists them as external', () => {
    const { scene, report } = build({
      lens: 'overview',
      detail: 'all',
      focus: { kind: 'project', params: { project: 'demo-web-1' } },
      filters: { excludeTypes: ['cloudresourcemanager.googleapis.com/Project'] },
    });
    expect(shows(scene, PROJECT_HOST)).toBe(false);
    expect(parentOf(scene, HOST_SUBNET)).toBeUndefined();
    expect(parentOf(scene, CONNECTOR)).toBeUndefined();
    expect(report.external).toEqual([HOST_SUBNET, CONNECTOR]);
    expect(report.legend.external).toBe(true);
  });

  it('draws only the edges leaving the project, never the ones entering it', () => {
    const { scene } = build({
      lens: 'overview',
      detail: 'all',
      focus: { kind: 'project', params: { project: 'demo-net-1' } },
    });
    expect(childIds(scene)).toEqual([PROJECT_HOST]);
    expect(scene.edges).toEqual([]);
  });

  it('applies to the whole canvas when the root lies inside the project, stubs included', () => {
    const { scene, report } = build({
      lens: 'overview',
      detail: 'all',
      root: PROJECT_WEB,
      focus: { kind: 'project', params: { project: 'demo-web-1' } },
    });
    expect(report.focus?.status).toBe('applied');
    expect(childIds(scene)).toContain(LOCAL_VPC);
    expect(childIds(scene)).toContain(PROJECT_HOST);
    expect(zone(scene, PROJECT_HOST).badges).toEqual(['external']);
  });

  it.each(REFUSALS.filter((refusal) => refusal.kind === 'project'))(
    'falls back to the view without the focus, and says why: $what',
    (refusal) => {
      const { scene, report } = build(refused(refusal));
      expect(report.warnings.some((warning) => warning.startsWith('Focus not applied'))).toBe(true);
      // The view falls back to its root, without the focus; the refusal travels with the scene's metadata.
      const fallback = build({
        lens: 'overview',
        ...(refusal.root === undefined ? {} : { root: refusal.root }),
      }).scene;
      const error = report.focus?.status === 'error' ? report.focus.error : undefined;
      expect(error).toBeDefined();
      expect(scene).toEqual({ ...fallback, metadata: { ...fallback.metadata, focusError: error } });
    },
  );
});

describe('focus: shared-vpc', () => {
  it('shows the host and its service projects, without their folders', () => {
    const { scene, report } = build({
      lens: 'networking',
      detail: 'all',
      focus: { kind: 'shared-vpc', params: { host: 'demo-net-1' } },
    });
    expect(report.focus).toEqual({
      status: 'applied',
      kind: 'shared-vpc',
      anchor: PROJECT_HOST,
      projects: [PROJECT_HOST, PROJECT_WEB],
    });
    expect(childIds(scene)).toEqual([PROJECT_HOST, PROJECT_WEB]);
    expect(edgesBetween(scene, PROJECT_WEB, PROJECT_HOST, 'shares')).toHaveLength(1);
  });

  it('keeps only the projects inside the root, and the whole canvas when the root is inside one', () => {
    const inFolder = build({
      lens: 'networking',
      root: FOLDER_WORKLOADS,
      focus: { kind: 'shared-vpc', params: { host: 'demo-net-1' } },
    });
    expect(inFolder.report.focus).toMatchObject({ status: 'applied', projects: [PROJECT_WEB] });
    expect(childIds(inFolder.scene)).toEqual([PROJECT_WEB]);

    const inProject = build({
      lens: 'networking',
      root: LOCAL_VPC,
      focus: { kind: 'shared-vpc', params: { host: 'demo-net-1' } },
    });
    expect(inProject.report.focus).toMatchObject({ status: 'applied', projects: [PROJECT_WEB] });
    expect(childIds(inProject.scene)).toContain(LOCAL_SUBNET);
  });
});

describe('focus: standalone-projects', () => {
  it('keeps the projects with no Shared VPC, no peering and no hybrid link', () => {
    const { scene, report } = build({ lens: 'overview', focus: { kind: 'standalone-projects', params: {} } });
    expect(report.focus).toEqual({
      status: 'applied',
      kind: 'standalone-projects',
      projects: [PROJECT_SOLO, PROJECT_EMPTY],
    });
    expect(childIds(scene)).toEqual([PROJECT_EMPTY, PROJECT_SOLO]);
    expect(shows(scene, PROJECT_PEER_A)).toBe(false);
  });

  it('respects the root, and warns when no standalone project is in view', () => {
    expect(
      build({ lens: 'overview', root: FOLDER_SANDBOX, focus: { kind: 'standalone-projects', params: {} } })
        .report.focus,
    ).toMatchObject({ projects: [PROJECT_EMPTY] });
    const none = build({
      lens: 'overview',
      root: FOLDER_WORKLOADS,
      focus: { kind: 'standalone-projects', params: {} },
    });
    expect(none.scene.children).toEqual([]);
    expect(none.report.warnings).toEqual(['No standalone project lies in this view.']);
    const inside = build({
      lens: 'overview',
      root: PROJECT_SOLO,
      focus: { kind: 'standalone-projects', params: {} },
    });
    expect(inside.report.focus).toMatchObject({ projects: [PROJECT_SOLO] });
    expect(inside.scene.children.length).toBeGreaterThan(0);
  });
});

describe('focus: perimeter', () => {
  it('draws the perimeter as an overlay zone around its projects, by title or by id', () => {
    for (const perimeter of ['shop_perimeter', PERIMETER]) {
      const { scene, report } = build({
        lens: 'security',
        focus: { kind: 'perimeter', params: { perimeter } },
      });
      expect(report.focus).toEqual({
        status: 'applied',
        kind: 'perimeter',
        anchor: PERIMETER,
        projects: [PROJECT_WEB, PROJECT_SOLO],
      });
      expect(childIds(scene)).toEqual([PERIMETER]);
      expect(childIds(scene, PERIMETER)).toEqual([PROJECT_SOLO, PROJECT_WEB]);
      expect(report.overlays).toEqual([{ zone: PERIMETER, kind: 'secures' }]);
      // The perimeter's secures edges are its nesting, not arrows.
      expect(scene.edges.filter((edge) => edge.kind === 'secures')).toEqual([]);
    }
  });

  it('shows the perimeter whatever the lens, and only its projects inside the root', () => {
    const { scene } = build({
      lens: 'compute',
      root: FOLDER_PLATFORM,
      focus: { kind: 'perimeter', params: { perimeter: 'shop_perimeter' } },
    });
    expect(childIds(scene)).toEqual([PERIMETER]);
    expect(childIds(scene, PERIMETER)).toEqual([PROJECT_SOLO]);
  });

  it('needs no overlay when the root lies inside one of its projects', () => {
    const { scene, report } = build({
      lens: 'security',
      root: PROJECT_SOLO,
      focus: { kind: 'perimeter', params: { perimeter: 'shop_perimeter' } },
    });
    expect(report.focus).toMatchObject({ status: 'applied', projects: [PROJECT_SOLO] });
    expect(report.overlays).toEqual([]);
    expect(shows(scene, PERIMETER)).toBe(false);
  });
});

describe('focus: application', () => {
  it('shows the application, its services and workloads, and what they reference in their projects', () => {
    for (const application of [APP, 'Shop', 'shop']) {
      const { scene, report } = build({
        lens: 'everything',
        detail: 'all',
        focus: { kind: 'application', params: { application } },
      });
      expect(report.focus).toEqual({
        status: 'applied',
        kind: 'application',
        anchor: APP,
        projects: [PROJECT_WEB],
      });
      expect(childIds(scene)).toEqual([PROJECT_WEB]);
      expect(childIds(scene, APP)).toEqual([APP_SERVICE, APP_WORKLOAD]);
      expect(parentOf(scene, ON_SUBNET)).toBe(LOCAL_SUBNET);
      expect(parentOf(scene, RUN_SERVICE)).toBe(PROJECT_WEB);
      // Nothing else of the project: the other VMs are not referenced.
      expect(shows(scene, ON_HOST)).toBe(false);
      expect(edgesBetween(scene, APP_SERVICE, RUN_SERVICE, 'uses')).toHaveLength(1);
    }
  });

  it('keeps the application whatever the lens', () => {
    const { scene } = build({
      lens: 'networking',
      detail: 'all',
      focus: { kind: 'application', params: { application: APP } },
    });
    expect(shows(scene, APP)).toBe(true);
    expect(shows(scene, APP_SERVICE)).toBe(false);
  });

  it('applies to the whole canvas when drilled into the application', () => {
    const { scene, report } = build({
      lens: 'everything',
      root: APP,
      focus: { kind: 'application', params: { application: APP } },
    });
    expect(report.focus).toMatchObject({ status: 'applied', anchor: APP, projects: [] });
    expect(childIds(scene)).toEqual([APP_SERVICE, APP_WORKLOAD]);
  });
});

describe('focus refusals', () => {
  it.each(REFUSALS)('refuses focus $kind on $what: $code', (refusal) => {
    expect(build(refused(refusal)).report.focus).toMatchObject({
      status: 'error',
      kind: refusal.kind,
      error: { code: refusal.code, param: refusal.param },
    });
  });

  it('refuses an application name that two applications share', () => {
    const twin = resource(
      `${APP}-2`,
      'apphub.googleapis.com/Application',
      WEB_NUMBER,
      { displayName: 'Shop' },
      {
        location: 'global',
        folders: ['20000000003', '20000000002'],
      },
    );
    const graph = viewGraphOf([...viewAssets(), twin]);
    expect(
      build({ focus: { kind: 'application', params: { application: 'Shop' } } }, ENV, graph).report.focus,
    ).toMatchObject({
      error: { code: 'ambiguous', param: 'application' },
    });
  });
});

describe('references outside every project', () => {
  // Two more App Hub services of the application in demo-web-1: one registers the organisation's access policy,
  // the other a bucket of a project the snapshot does not have (the builder nests it under the organisation).
  const GONE_BUCKET = '//storage.googleapis.com/demo-gone-1-logs';
  const service = (name: string, uri: string) =>
    resource(
      `${APP}/services/${name}`,
      'apphub.googleapis.com/Service',
      WEB_NUMBER,
      { displayName: name, serviceReference: { uri } },
      { location: 'global', parent: APP, folders: ['20000000003', '20000000002'] },
    );
  const graph = viewGraphOf([
    ...viewAssets(),
    service('policy', POLICY),
    service('gone', GONE_BUCKET),
    resource(GONE_BUCKET, 'storage.googleapis.com/Bucket', '10000000099', { name: 'demo-gone-1-logs' }),
  ]);

  it('puts a project focus’s stubs that belong to no known project at the top level', () => {
    const { scene, report } = build(
      { lens: 'everything', detail: 'all', focus: { kind: 'project', params: { project: 'demo-web-1' } } },
      ENV,
      graph,
    );
    // The policy has no project; the bucket's project is not in the snapshot.
    expect(report.external).toEqual(expect.arrayContaining([POLICY, GONE_BUCKET]));
    expect(parentOf(scene, POLICY)).toBeUndefined();
    expect(parentOf(scene, GONE_BUCKET)).toBeUndefined();
    expect(edgesBetween(scene, `${APP}/services/policy`, POLICY, 'uses')).toHaveLength(1);
  });

  it('takes what an application references outside every project, without what holds it', () => {
    const { scene, report } = build(
      { lens: 'everything', detail: 'all', focus: { kind: 'application', params: { application: APP } } },
      ENV,
      graph,
    );
    expect(report.focus).toEqual({
      status: 'applied',
      kind: 'application',
      anchor: APP,
      projects: [PROJECT_WEB],
    });
    expect(childIds(scene)).toEqual(expect.arrayContaining([POLICY, GONE_BUCKET, PROJECT_WEB]));
    // The policy joins as a reference, not its perimeter, and nothing above it.
    expect(shows(scene, PERIMETER)).toBe(false);
    expect(shows(scene, ORG)).toBe(false);
  });
});
