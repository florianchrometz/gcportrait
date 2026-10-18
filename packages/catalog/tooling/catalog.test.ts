// SPDX-License-Identifier: Apache-2.0
/**
 * The real catalog data, compiled and run through the rule engine. Catalog groups add types, rules and fixtures
 * to this data while these tests stay as they are, so every assertion is an invariant that holds whatever a
 * group maps correctly: the seed is a subset of the catalog, values are checked for what they must contain
 * rather than pinned whole, and ownership comes from the group files rather than from what is still unmapped.
 * Only the first test checks the whole catalog; while a group is mid-edit in a shared working tree it fails
 * and names that group (`pnpm catalog:check --group <group>` checks one group alone).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { CatalogSchema, LensIdSchema, type Asset } from '@gcportrait/model';
import { describe, expect, it } from 'vitest';
import { compileCatalog } from '../src/compiler/compile.js';
import { catalogCoverage } from '../src/compiler/coverage-file.js';
import { parseGroups } from '../src/compiler/groups.js';
import type { CoverageReport } from '../src/compiler/types.js';
import {
  catalog,
  evaluateContains,
  evaluateRelations,
  isHiddenByDefault,
  nestsByParent,
  renderConsoleUrl,
  renderLabel,
  renderTemplate,
  templateScope,
} from '../src/index.js';
import {
  CATALOG_ROOT,
  DIST_COVERAGE,
  GENERATED_MODULE,
  catalogVersion,
  readOfficialList,
  repositoryLicense,
} from './files.js';
import { renderCatalogModule } from './generate.js';
import { ctx, fixtureNamed as fixture, fixtures, sources } from './real-fixtures.js';

const official = readOfficialList();
const { catalog: compiled, report } = compileCatalog(sources, official, { version: catalogVersion() });
const ownership = parseGroups(
  sources.knownUnmapped,
  () => undefined,
  () => undefined,
);

/** The violations by the group whose files they are blamed on, so a failure says whose work it is. */
function violationsByGroup(coverage: CoverageReport): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const violation of coverage.violations) {
    const owners = coverage.groups
      .filter((group) =>
        [group.file, ...group.productFiles, ...group.fixtureFiles].includes(violation.file ?? ''),
      )
      .map((group) => group.group);
    const where = `${violation.file ?? ''}${violation.line === undefined ? '' : `:${String(violation.line)}`}`;
    for (const owner of owners.length === 0 ? ['(no group)'] : owners) {
      out[owner] = [...(out[owner] ?? []), `[${violation.code}] ${where} ${violation.message}`];
    }
  }
  return out;
}

/** The Tier-0 containers (skill gcp-diagram-layout §2) and the Resource Manager product of the catalog seed. */
const TIER_0 = [
  'cloudresourcemanager.googleapis.com/Organization',
  'cloudresourcemanager.googleapis.com/Folder',
  'cloudresourcemanager.googleapis.com/Project',
  'compute.googleapis.com/Network',
  'compute.googleapis.com/Subnetwork',
  'container.googleapis.com/Cluster',
  'k8s.io/Namespace',
  'bigquery.googleapis.com/Dataset',
  'cloudkms.googleapis.com/KeyRing',
  'alloydb.googleapis.com/Cluster',
  'spanner.googleapis.com/Instance',
  'bigtableadmin.googleapis.com/Instance',
  'dataplex.googleapis.com/Lake',
  'dataplex.googleapis.com/Zone',
  'apigee.googleapis.com/Organization',
  'vmwareengine.googleapis.com/PrivateCloud',
  'dataform.googleapis.com/Repository',
  'servicedirectory.googleapis.com/Namespace',
  'servicedirectory.googleapis.com/Service',
];
const HIDDEN_HIERARCHY = [
  'cloudresourcemanager.googleapis.com/TagKey',
  'cloudresourcemanager.googleapis.com/TagValue',
  'cloudresourcemanager.googleapis.com/TagBinding',
  'cloudresourcemanager.googleapis.com/Lien',
];

describe('the catalog data', () => {
  it('compiles without a single violation against the newest official list', () => {
    expect(violationsByGroup(report), 'violations, by the group whose files they are in').toEqual({});
    expect(compiled).toBeDefined();
    expect(report.officialList.total).toBe(official.types.size);
    expect(report.mapped.total + report.unmapped.total).toBe(official.types.size);
  });

  // The runtime catalog is the generated module's constant as it is, never parsed on import (src/catalog.ts),
  // so this is the guard that holds it to the schema: the module is a fresh compile that passes CatalogSchema,
  // and the catalog the package exports passes it unchanged.
  it('is what the generated module (and so the runtime catalog) holds', () => {
    const modulePath = path.join(CATALOG_ROOT, GENERATED_MODULE);
    const expected = renderCatalogModule(CatalogSchema.parse(compiled), repositoryLicense());
    expect(readFileSync(modulePath, 'utf8'), 'stale: run pnpm catalog:build').toBe(expected);
    expect(catalog).toEqual(compiled);
    expect(CatalogSchema.parse(catalog), 'the runtime catalog passes CatalogSchema as it is').toEqual(
      catalog,
    );
  });

  // The website renders the coverage page from dist/coverage.json instead of running `pnpm catalog:coverage
  // --json` during its build (src/compiler/coverage-file.ts), so the file must be the coverage of the catalog
  // as it is, narrowed to what the page reads and with each group's unmapped types sorted by type.
  it('writes the coverage the website reads (dist/coverage.json) as a fresh compile has it', () => {
    const written: unknown = JSON.parse(readFileSync(path.join(CATALOG_ROOT, DIST_COVERAGE), 'utf8'));
    expect(written, 'stale: run pnpm catalog:build').toEqual(catalogCoverage(report));
    expect(written).toMatchObject({
      officialDate: report.officialList.date,
      officialTotal: official.types.size,
    });
    for (const group of catalogCoverage(report).groups) {
      const types = group.unmapped.map((item) => item.type);
      expect(types, `${group.group}: the unmapped types are sorted`).toEqual([...types].sort());
    }
  });

  it('keeps every seeded Tier-0 container and the Resource Manager product (the groups add the rest)', () => {
    expect(Object.keys(catalog.types)).toEqual(expect.arrayContaining([...TIER_0, ...HIDDEN_HIERARCHY]));
    for (const assetType of TIER_0) {
      const type = catalog.types[assetType];
      expect(type?.role, assetType).toBe('container');
      // Projects contain whatever names them as parent or ancestor, without a rule (skill
      // gcp-diagram-layout §2).
      if (assetType === 'cloudresourcemanager.googleapis.com/Project') continue;
      expect((type?.contains.length ?? 0) + (type?.relations.length ?? 0), assetType).toBeGreaterThan(0);
    }
    for (const assetType of HIDDEN_HIERARCHY) expect(catalog.types[assetType]?.role).toBe('hidden');
  });

  it('has every lens, each with a title, a description and at least one type', () => {
    expect(Object.keys(catalog.lenses)).toEqual(LensIdSchema.options);
    for (const lens of Object.values(catalog.lenses)) {
      expect(lens.types.length).toBeGreaterThan(0);
      expect(lens.relationKinds).toContain('contains');
    }
    expect(catalog.lenses.everything.types).toEqual(['*']);
    expect(catalog.lenses.everything.showHidden).toBe(true);
    expect(catalog.lenses.identity.relationKinds).toContain('runsAs');
    expect(catalog.lenses.security.relationKinds).toEqual(expect.arrayContaining(['encryptedBy', 'secures']));
  });

  it('lists every unmapped official type in the group file that owns it, a pending reason naming that group', () => {
    expect(report.unmapped.unlisted).toEqual([]);
    for (const group of report.groups) {
      expect(group.missing, group.group).toEqual([]);
      for (const reason of Object.keys(group.unmapped.byReason)) {
        const pending = /^pending \(([a-z0-9-]+)\)$/.exec(reason)?.[1];
        if (pending !== undefined) expect(pending, `${group.group}: ${reason}`).toBe(group.group);
      }
    }
  });

  it('gives every official type to exactly one group: the twelve product groups, hierarchy and policy-and-runtime', () => {
    expect(report.ungrouped).toEqual([]);
    expect(report.groups.map((group) => group.group)).toEqual([
      'ai',
      'compute',
      'containers-serverless',
      'data-processing-messaging',
      'data-stores',
      'developer-tooling-delivery',
      'dns-domains',
      'hierarchy',
      'hybrid-connectivity',
      'load-balancing-edge',
      'networking-fabric',
      'operations-platform',
      'policy-and-runtime',
      'security-identity',
    ]);
    expect(report.groups.reduce((sum, group) => sum + group.official, 0)).toBe(official.types.size);
    // Ownership comes from the group files' owns patterns, mapped or not.
    const owner = (assetType: string) => ownership.ownerOf(assetType)?.stem;
    // Compute Engine is split by the catalog seed's sections; Cross-Site Interconnect goes with hybrid
    // connectivity.
    expect(owner('compute.googleapis.com/WireGroup')).toBe('hybrid-connectivity');
    expect(owner('compute.googleapis.com/Route')).toBe('networking-fabric');
    expect(owner('compute.googleapis.com/VpnTunnel')).toBe('hybrid-connectivity');
    expect(owner('compute.googleapis.com/UrlMap')).toBe('load-balancing-edge');
    expect(owner('compute.googleapis.com/Instance')).toBe('compute');
    expect(owner('iap.googleapis.com/TunnelDestGroup')).toBe('security-identity');
    expect(owner('iap.googleapis.com/Web')).toBe('policy-and-runtime');
    expect(owner('compute.googleapis.com/Network')).toBe('networking-fabric');
  });
});

describe('the fixtures, through the rule engine', () => {
  it('index the six demo projects', () => {
    expect(Object.keys(ctx.projects.numberById)).toEqual(
      expect.arrayContaining([
        'demo-app-1',
        'demo-data-1',
        'demo-net-1',
        'demo-old-1',
        'demo-ops-1',
        'demo-sec-1',
      ]),
    );
  });

  it('label every fixture, and fill each label template completely on some fixture of its type', () => {
    // Like the compiler's template check: a fixture array may hold an older API shape that lacks a variable.
    const byType = new Map<string, Asset[]>();
    for (const asset of fixtures)
      byType.set(asset.assetType, [...(byType.get(asset.assetType) ?? []), asset]);
    for (const [assetType, assets] of byType) {
      const type = catalog.types[assetType];
      if (type === undefined) continue; // a fixture without a clean entry fails the first test
      expect(
        assets.some((asset) => !renderTemplate(type.label, templateScope(asset, ctx)).missing),
        assetType,
      ).toBe(true);
      for (const asset of assets) expect(renderLabel(asset, type, ctx), asset.name).not.toBe('');
    }
    expect(
      renderLabel(
        fixture('//cloudresourcemanager.googleapis.com/projects/10000000001'),
        catalog.types['cloudresourcemanager.googleapis.com/Project'],
        ctx,
      ),
    ).toBe('Demo network host');
  });

  it('hide retired projects and system namespaces', () => {
    const projectType = catalog.types['cloudresourcemanager.googleapis.com/Project'];
    const namespaceType = catalog.types['k8s.io/Namespace'];
    expect(
      isHiddenByDefault(fixture('//cloudresourcemanager.googleapis.com/projects/10000000006'), projectType),
    ).toBe(true);
    expect(
      isHiddenByDefault(fixture('//cloudresourcemanager.googleapis.com/projects/10000000001'), projectType),
    ).toBe(false);
    const cluster = '//container.googleapis.com/projects/demo-app-1/locations/europe-west3/clusters/shop';
    expect(isHiddenByDefault(fixture(`${cluster}/k8s/namespaces/kube-system`), namespaceType)).toBe(true);
    expect(isHiddenByDefault(fixture(`${cluster}/k8s/namespaces/shop`), namespaceType)).toBe(false);
  });

  it('resolve the Shared VPC and cross-product references they carry', () => {
    const target = (name: string, assetType: string) =>
      evaluateRelations(fixture(name), catalog.types[assetType], ctx).map((relation) => relation.target);
    expect(
      target(
        '//alloydb.googleapis.com/projects/demo-data-1/locations/europe-west3/clusters/orders',
        'alloydb.googleapis.com/Cluster',
      ),
    ).toEqual(
      expect.arrayContaining([
        { by: 'name', name: '//compute.googleapis.com/projects/demo-net-1/global/networks/core' },
        {
          by: 'name',
          name: '//cloudkms.googleapis.com/projects/demo-sec-1/locations/europe-west3/keyRings/data/cryptoKeys/alloydb',
        },
      ]),
    );
    expect(
      target(
        '//dataform.googleapis.com/projects/demo-data-1/locations/europe-west3/repositories/warehouse',
        'dataform.googleapis.com/Repository',
      ),
    ).toEqual(
      expect.arrayContaining([
        { by: 'alias', alias: 'dataform-runner@demo-data-1.iam.gserviceaccount.com' },
        {
          by: 'name',
          name: '//cloudkms.googleapis.com/projects/demo-sec-1/locations/europe-west3/keyRings/data/cryptoKeys/dataform',
        },
        {
          by: 'name',
          name: '//secretmanager.googleapis.com/projects/demo-data-1/secrets/dataform-git-token/versions/1',
        },
      ]),
    );
  });

  it('nest subnetworks in their network and namespaces in their cluster', () => {
    const network = fixture('//compute.googleapis.com/projects/demo-net-1/global/networks/core');
    const names = evaluateContains(network, catalog.types['compute.googleapis.com/Network'], ctx).names;
    expect(names).toContainEqual({
      by: 'name',
      name: '//compute.googleapis.com/projects/demo-net-1/regions/europe-west3/subnetworks/app',
    });
    const cluster = fixture(
      '//container.googleapis.com/projects/demo-app-1/locations/europe-west3/clusters/shop',
    );
    const namespaces = fixtures.filter(
      (asset) => asset.assetType === 'k8s.io/Namespace' && asset.name.startsWith(`${cluster.name}/`),
    );
    expect(namespaces.length).toBeGreaterThan(0);
    for (const namespace of namespaces) expect(nestsByParent(namespace, cluster), namespace.name).toBe(true);
  });

  it('link to the console where a template exists', () => {
    const url = renderConsoleUrl(
      fixture('//compute.googleapis.com/projects/demo-net-1/regions/europe-west3/subnetworks/app'),
      catalog.types['compute.googleapis.com/Subnetwork'],
      ctx,
    );
    expect(url).toMatch(/^https:\/\/console\.cloud\.google\.com\/.*\bapp\b.*[?&]project=demo-net-1(?:&|$)/);
  });

  it('link nested containers to the console through their parents in the name (parentSegment)', () => {
    const link = (name: string, assetType: string) =>
      renderConsoleUrl(fixture(name), catalog.types[assetType], ctx) ?? '';
    // Each link names the parent that only the asset name holds (cluster, lake, Service Directory namespace).
    const namespace = link(
      '//container.googleapis.com/projects/demo-app-1/locations/europe-west3/clusters/shop/k8s/namespaces/shop',
      'k8s.io/Namespace',
    );
    expect(namespace).toMatch(
      /^https:\/\/console\.cloud\.google\.com\/kubernetes\/.*\/shop\/shop\b.*project=demo-app-1/,
    );
    const zone = link(
      '//dataplex.googleapis.com/projects/demo-data-1/locations/europe-west3/lakes/analytics/zones/raw',
      'dataplex.googleapis.com/Zone',
    );
    expect(zone).toMatch(
      /^https:\/\/console\.cloud\.google\.com\/dataplex\/.*\/analytics\/.*\braw\b.*project=demo-data-1/,
    );
    const service = link(
      '//servicedirectory.googleapis.com/projects/demo-ops-1/locations/europe-west3/namespaces/internal/services/payments',
      'servicedirectory.googleapis.com/Service',
    );
    expect(service).toMatch(
      /^https:\/\/console\.cloud\.google\.com\/.*\/internal\/.*\bpayments\b.*project=demo-ops-1/,
    );
  });

  it('draw VPC networks and subnetworks as their own zone kinds', () => {
    expect(catalog.types['compute.googleapis.com/Network']?.zoneKind).toBe('vpc');
    expect(catalog.types['compute.googleapis.com/Subnetwork']?.zoneKind).toBe('subnet');
  });
});
