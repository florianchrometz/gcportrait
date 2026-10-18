// SPDX-License-Identifier: Apache-2.0
/** Steps (c) and (d) on the views scenario: lens rules, scope filters, hide filters, virtual regions. */
import type { Catalog, SceneBuild, ViewSpecInput } from '@gcportrait/model';
import { describe, expect, it } from 'vitest';
import { graphNode } from '../testing/fixtures.js';
import {
  DISK,
  GADGET,
  LOCAL_SUBNET,
  LOCAL_VPC,
  ON_HOST,
  ON_NETWORK,
  ON_SUBNET,
  PROJECT_HOST,
  PROJECT_WEB,
  SERVICE_ACCOUNT,
  TWO_NICS,
} from '../testing/scenario.js';
import { cards, childIds, edgeKinds, edgesBetween, parentOf, shows, zone, zones } from '../testing/scene.js';
import {
  BUCKET_CENTRAL,
  BUCKET_DELETED,
  BUCKET_WEST3,
  BUILD,
  ENV,
  FOLDER_PLATFORM,
  FOLDER_RETAIL,
  FOLDER_SANDBOX,
  FOLDER_WORKLOADS,
  POLICY,
  PROJECT_EMPTY,
  PROJECT_SOLO,
  ROUTE,
  checkedScene,
  view,
  viewCatalog,
  viewGraphOf,
} from '../testing/views.js';
import { candidates, settle } from './filters.js';
import { lensRules } from './lens.js';
import { viewContext } from './scene.js';

/**
 * The views catalog with its overview lens pinned to also take the scenario's Compute routes and disks: these
 * tests exercise the filter mechanics on them, while the real overview lens leaves routes and disks to the
 * networking and compute lenses (it lists its Compute types one by one).
 */
function withPinnedOverview(catalog: Catalog): Catalog {
  const overview = catalog.lenses.overview;
  return {
    ...catalog,
    lenses: {
      ...catalog.lenses,
      overview: {
        ...overview,
        types: [...overview.types, 'compute.googleapis.com/Route', 'compute.googleapis.com/Disk'],
      },
    },
  };
}

const CATALOG = withPinnedOverview(viewCatalog());
const GRAPH = viewGraphOf();

function build(input: ViewSpecInput, graph = GRAPH): SceneBuild {
  return checkedScene({ detail: 'all', ...input }, { graph, catalog: CATALOG });
}

describe('lens (c)', () => {
  it('takes the lens types and draws only the lens relation kinds', () => {
    const networking = build({ lens: 'networking' }).scene;
    expect(shows(networking, ON_HOST)).toBe(false);
    expect(shows(networking, BUCKET_WEST3)).toBe(false);
    expect(shows(networking, LOCAL_VPC)).toBe(true);
    expect(shows(networking, ROUTE)).toBe(true);
    expect(edgeKinds(networking)).toEqual(['peers', 'shares']);

    const overview = build({ lens: 'overview' }).scene;
    expect(edgeKinds(overview)).toEqual(['attaches', 'peers', 'shares', 'uses']);
    expect(shows(overview, SERVICE_ACCOUNT)).toBe(false);
  });

  it('shows hidden-by-default nodes only with showHidden or includeTypes, and counts them otherwise', () => {
    const overview = build({ lens: 'overview' });
    expect(shows(overview.scene, BUCKET_DELETED)).toBe(false);
    expect(zone(overview.scene, PROJECT_SOLO).badges).toEqual(['1 hidden']);
    expect(overview.report.counts.held).toBe(1);

    expect(shows(build({ lens: 'everything' }).scene, BUCKET_DELETED)).toBe(true);
    expect(shows(build({ lens: 'everything' }).scene, BUILD)).toBe(true);
    const included = build({
      lens: 'overview',
      filters: { includeTypes: ['storage.googleapis.com/Bucket'] },
    });
    expect(shows(included.scene, BUCKET_DELETED)).toBe(true);
    expect(zone(included.scene, PROJECT_SOLO).badges).toEqual([]);
    // A hidden type outside the lens is not "held back": the lens would not show it anyway.
    expect(shows(overview.scene, BUILD)).toBe(false);
  });

  it("keeps a hidden type's hiddenWhen matches held back under includeTypes", () => {
    const included = lensRules(
      CATALOG,
      view({
        lens: 'overview',
        filters: { includeTypes: ['cloudbuild.googleapis.com/Build', 'storage.googleapis.com/Bucket'] },
      }),
    );
    const record = graphNode(BUILD, {
      assetType: 'cloudbuild.googleapis.com/Build',
      label: 'b-1',
      product: 'Cloud Build',
      role: 'hidden',
      hidden: true,
    });
    const bucket = graphNode(BUCKET_DELETED, {
      assetType: 'storage.googleapis.com/Bucket',
      role: 'leaf',
      hidden: true,
    });
    expect(included.passes(record)).toBe(true);
    expect(included.passes({ ...record, hiddenWhenMatched: true })).toBe(false);
    expect(included.heldBack({ ...record, hiddenWhenMatched: true })).toBe(true);
    // A type visible by role: includeTypes still reveals what its hiddenWhen hides.
    expect(included.passes({ ...bucket, hiddenWhenMatched: true })).toBe(true);
    // A lens with showHidden draws them all.
    expect(
      lensRules(CATALOG, view({ lens: 'everything' })).passes({ ...record, hiddenWhenMatched: true }),
    ).toBe(true);
  });

  it('adds types with includeTypes (globs too) and removes them with excludeTypes, which wins', () => {
    const included = build({
      lens: 'networking',
      filters: { includeTypes: ['storage.googleapis.com/*'] },
    }).scene;
    expect(shows(included, BUCKET_WEST3)).toBe(true);
    const excluded = build({
      lens: 'overview',
      filters: {
        includeTypes: ['storage.googleapis.com/*'],
        excludeTypes: ['storage.googleapis.com/Bucket'],
      },
    }).scene;
    expect(shows(excluded, BUCKET_WEST3)).toBe(false);
    const noVms = build({
      lens: 'overview',
      filters: { excludeTypes: ['compute.googleapis.com/Instance'] },
    }).scene;
    expect(cards(noVms).some((card) => card.assetType === 'compute.googleapis.com/Instance')).toBe(false);
  });

  it('lifts what a hidden container held into the nearest visible container', () => {
    const { scene } = build({
      lens: 'overview',
      filters: { excludeTypes: ['compute.googleapis.com/Subnetwork'] },
    });
    expect(parentOf(scene, ON_SUBNET)).toBe(LOCAL_VPC);
    const noProjects = build({
      lens: 'overview',
      filters: { excludeTypes: ['cloudresourcemanager.googleapis.com/Project'] },
    }).scene;
    expect(parentOf(noProjects, LOCAL_VPC)).toBe(FOLDER_RETAIL);
  });

  it('shows identities with showIdentities, hides them with false, and lets the lens decide otherwise', () => {
    const shown = build({ lens: 'overview', filters: { showIdentities: true } }).scene;
    expect(shows(shown, SERVICE_ACCOUNT)).toBe(true);
    expect(edgesBetween(shown, ON_SUBNET, SERVICE_ACCOUNT, 'runsAs')).toHaveLength(1);
    const identity = build({ lens: 'identity' }).scene;
    expect(shows(identity, SERVICE_ACCOUNT)).toBe(true);
    expect(edgeKinds(identity)).toContain('runsAs');
    const hidden = build({ lens: 'identity', filters: { showIdentities: false } }).scene;
    expect(shows(hidden, SERVICE_ACCOUNT)).toBe(false);
    expect(edgeKinds(hidden)).not.toContain('runsAs');
  });

  it('draws an attachment to the node’s own container as nesting, not as an arrow', () => {
    const { scene } = build({ lens: 'overview' });
    expect(parentOf(scene, ON_SUBNET)).toBe(LOCAL_SUBNET);
    expect(edgesBetween(scene, ON_SUBNET, LOCAL_SUBNET)).toEqual([]);
    expect(edgesBetween(scene, TWO_NICS, LOCAL_SUBNET, 'attaches')).toHaveLength(1);
  });
});

describe('scope filters (d)', () => {
  it('keeps the regions asked for (zones by their region), global containers, and nodes without a location', () => {
    const west = build({ lens: 'overview', filters: { regions: ['europe-west3'] } }).scene;
    expect(shows(west, BUCKET_WEST3)).toBe(true);
    expect(shows(west, BUCKET_CENTRAL)).toBe(false);
    expect(shows(west, ON_HOST)).toBe(true);
    expect(shows(west, ROUTE)).toBe(false);
    // The access policy has no location: there is nothing to filter on.
    expect(shows(build({ lens: 'everything', filters: { regions: ['europe-west3'] } }).scene, POLICY)).toBe(
      true,
    );

    const central = build({ lens: 'overview', filters: { regions: ['US-Central1'] } }).scene;
    expect(shows(central, BUCKET_CENTRAL)).toBe(true);
    expect(shows(central, LOCAL_VPC)).toBe(true);
    expect(shows(central, LOCAL_SUBNET)).toBe(false);
    expect(shows(central, ON_NETWORK)).toBe(false);

    const zonal = build({ lens: 'overview', filters: { regions: ['europe-west3-b'] } }).scene;
    expect(shows(zonal, ON_NETWORK)).toBe(true);
    expect(shows(zonal, ON_HOST)).toBe(false);

    const global = build({ lens: 'overview', filters: { regions: ['global'] } }).scene;
    expect(shows(global, ROUTE)).toBe(true);
  });

  it('keeps the projects asked for, by id or number, with their folders as structure only', () => {
    for (const projects of [['demo-solo-1'], ['10000000003']]) {
      const { scene } = build({ lens: 'everything', filters: { projects } });
      expect(childIds(scene)).toEqual([FOLDER_PLATFORM]);
      expect(childIds(scene, FOLDER_PLATFORM)).toEqual([PROJECT_SOLO]);
    }
  });

  it('keeps the folders asked for, with their subtree and their ancestors as structure', () => {
    const { scene } = build({ lens: 'everything', filters: { folders: ['20000000003'] } });
    expect(childIds(scene)).toEqual([FOLDER_WORKLOADS]);
    expect(childIds(scene, FOLDER_WORKLOADS)).toEqual([FOLDER_RETAIL]);
    expect(childIds(scene, FOLDER_RETAIL)).toEqual([PROJECT_WEB]);
  });

  it('intersects the project and folder lists', () => {
    const { scene } = build({
      lens: 'everything',
      filters: { folders: ['20000000003'], projects: ['demo-solo-1'] },
    });
    expect(scene.children).toEqual([]);
  });
});

describe('hide filters (d)', () => {
  it('hides empty projects, and empty folders recursively', () => {
    const projects = build({ lens: 'overview', filters: { hideEmptyProjects: true } }).scene;
    expect(shows(projects, PROJECT_EMPTY)).toBe(false);
    expect(shows(projects, FOLDER_SANDBOX)).toBe(true);
    const folders = build({ lens: 'overview', filters: { hideEmptyFolders: true } }).scene;
    expect(shows(folders, FOLDER_SANDBOX)).toBe(true);
    const both = build({
      lens: 'overview',
      filters: { hideEmptyProjects: true, hideEmptyFolders: true },
    }).scene;
    expect(shows(both, FOLDER_SANDBOX)).toBe(false);
  });

  it('judges emptiness in this view: a project the lens empties is empty', () => {
    const { scene } = build({
      lens: 'kubernetes',
      filters: { hideEmptyProjects: true, hideEmptyFolders: true },
    });
    // Only the networks (in the lens as structure) are left.
    expect(
      zones(scene)
        .filter((z) => z.kind === 'project')
        .map((z) => z.id),
    ).toEqual([
      PROJECT_HOST,
      '//cloudresourcemanager.googleapis.com/projects/10000000005',
      '//cloudresourcemanager.googleapis.com/projects/10000000006',
      PROJECT_WEB,
    ]);
    expect(shows(scene, PROJECT_SOLO)).toBe(false);
  });

  it('hides disconnected cards, then the containers left empty without an edge of their own', () => {
    const { scene } = build({ lens: 'overview', filters: { hideDisconnected: true } });
    expect(shows(scene, BUCKET_WEST3)).toBe(false);
    expect(shows(scene, ON_NETWORK)).toBe(false);
    expect(shows(scene, GADGET)).toBe(false);
    expect(shows(scene, ON_SUBNET)).toBe(true);
    expect(shows(scene, DISK)).toBe(true);
    // The peered VPCs are empty but connected; the empty and the standalone projects go, and Sandbox with them.
    expect(shows(scene, '//compute.googleapis.com/projects/demo-peer-1/global/networks/vpc-a')).toBe(true);
    expect(shows(scene, PROJECT_SOLO)).toBe(false);
    expect(shows(scene, PROJECT_EMPTY)).toBe(false);
    expect(shows(scene, FOLDER_SANDBOX)).toBe(false);
    // A zone with children stays without edges of its own.
    expect(shows(scene, FOLDER_WORKLOADS)).toBe(true);
    for (const card of cards(scene)) {
      expect(scene.edges.some((edge) => edge.from === card.id || edge.to === card.id)).toBe(true);
    }
  });

  it('settles to a fixpoint: applying the filters to their own result changes nothing', () => {
    const spec = view({
      lens: 'overview',
      filters: {
        hideDisconnected: true,
        hideEmptyProjects: true,
        hideEmptyFolders: true,
        regions: ['europe-west3'],
      },
    });
    const ctx = viewContext(GRAPH, spec, CATALOG, ENV);
    const once = settle(ctx, candidates(ctx));
    const twice = settle(ctx, once.nodes);
    expect([...twice.nodes]).toEqual([...once.nodes]);
    expect(twice.edges).toEqual(once.edges);
  });
});

describe('virtual region zones (showRegions)', () => {
  it('groups a project’s regional resources by region and zone, whatever the graph was built with', () => {
    const plain = build({ lens: 'overview', filters: { showRegions: true } });
    const built = build(
      { lens: 'overview', filters: { showRegions: true } },
      viewGraphOf(undefined, { showRegions: true }),
    );
    expect(built.scene).toEqual(plain.scene);
    const region = `//gcportrait.virtual/projects/demo-web-1/locations/europe-west3`;
    expect(zone(plain.scene, region).kind).toBe('region');
    expect(parentOf(plain.scene, ON_HOST)).toBe(`${region}/zones/europe-west3-a`);
    // VPCs stay under the project, and what is nested in them stays there.
    expect(parentOf(plain.scene, LOCAL_VPC)).toBe(PROJECT_WEB);
    expect(parentOf(plain.scene, ON_SUBNET)).toBe(LOCAL_SUBNET);
  });

  it('removes the graph’s region containers when the view does not ask for them', () => {
    const regional = viewGraphOf(undefined, { showRegions: true });
    expect(build({ lens: 'overview' }, regional).scene).toEqual(build({ lens: 'overview' }).scene);
    expect(
      build({ lens: 'overview' }, regional).scene.children.some((node) =>
        node.id.startsWith('//gcportrait.virtual'),
      ),
    ).toBe(false);
  });

  it('follows the caller’s setting when the view does not say, and drops region zones left empty', () => {
    const env = checkedScene(
      { lens: 'overview', detail: 'all' },
      { graph: GRAPH, catalog: CATALOG, env: { ...ENV, showRegions: true } },
    );
    expect(zones(env.scene).some((z) => z.kind === 'region')).toBe(true);
    const west = build({ lens: 'overview', filters: { showRegions: true, regions: ['europe-west3'] } }).scene;
    expect(shows(west, '//gcportrait.virtual/projects/demo-solo-1/locations/us-central1')).toBe(false);
    expect(shows(west, '//gcportrait.virtual/projects/demo-solo-1/locations/europe-west3')).toBe(true);
  });
});
