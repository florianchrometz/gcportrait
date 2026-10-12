// SPDX-License-Identifier: MIT
/**
 * compileCatalog on a small synthetic world (src/testing/world.ts): what it builds, every violation it finds
 * and which file it blames. The report's text form is tested in report.test.ts, `--group`/`--file` in
 * scope.test.ts.
 */
import { CatalogSchema, LensIdSchema } from '@gcportrait/model';
import { describe, expect, it } from 'vitest';
import { rawAsset } from '../testing/assets.js';
import {
  COMPUTE_FILE,
  DNS_GROUP,
  NETWORK,
  NET_FILE,
  NET_GROUP,
  OFFICIAL,
  ROUTE,
  SELF,
  SUBNETWORK,
  WEB_FILE,
  WEB_GROUP,
  ZONE,
  codes,
  compile,
  group,
  natSubnetFixture,
  networkFixture,
  product,
  scoped,
  shared,
  show,
  source,
  sources,
  subnetFixture,
  typeOf,
  world,
} from '../testing/world.js';
import { compileCatalog, productFileFits } from './compile.js';
import type { Violation } from './types.js';

describe('compileCatalog on a valid catalog', () => {
  it('reports no violation and assembles a valid catalog.json', () => {
    const { catalog, report } = compile(world());
    expect(report.violations).toEqual([]);
    expect(CatalogSchema.parse(catalog)).toEqual(catalog);
    expect(catalog?.version).toBe('1.2.3');
    expect(catalog?.officialListDate).toBe('2026-10-08');
    expect(catalog?.products).toEqual([
      {
        product: 'Compute Engine',
        service: 'compute.googleapis.com',
        icon: 'compute_engine',
        types: [NETWORK, SUBNETWORK],
      },
    ]);
    expect(catalog?.types[SUBNETWORK]?.icon).toBe('compute_engine');
    expect(catalog?.types[NETWORK]?.icon).toBe('virtual_private_cloud');
    expect(Object.keys(catalog?.lenses ?? {})).toEqual(LensIdSchema.options);
  });

  it('reports coverage numbers', () => {
    const { report } = compile(world());
    expect(report.officialList).toEqual({ date: '2026-10-08', file: OFFICIAL.file, total: 3 });
    expect(report.mapped).toEqual({ container: 2, core: 0, leaf: 0, hidden: 0, total: 2 });
    expect(report.coveragePercent).toBe(66.7);
    expect(report.unmapped).toEqual({
      total: 1,
      known: 1,
      knownByReason: { 'pending (networking-fabric)': 1 },
      unlisted: [],
    });
    expect(report.counts).toEqual({
      products: 1,
      productFiles: 1,
      types: 2,
      rules: 4,
      fixtures: 2,
      typesWithoutFixtures: 0,
      lenses: 11,
      iconKeys: 2,
      groups: 1,
    });
    expect(report.groups).toEqual([
      {
        group: 'net',
        title: 'Networking',
        file: NET_GROUP,
        official: 3,
        mapped: { container: 2, core: 0, leaf: 0, hidden: 0, total: 2 },
        unmapped: {
          total: 1,
          byReason: { 'pending (networking-fabric)': 1 },
          types: { [ROUTE]: 'pending (networking-fabric)' },
        },
        missing: [],
        coveragePercent: 66.7,
        productFiles: [COMPUTE_FILE],
        fixtureFiles: [
          'fixtures/compute.googleapis.com/Network.json',
          'fixtures/compute.googleapis.com/Subnetwork.json',
        ],
      },
    ]);
    expect(report.ungrouped).toEqual([]);
  });

  it('drops hiddenWhen: null and keeps a predicate', () => {
    const w = world();
    typeOf(w, NETWORK)['hiddenWhen'] = null;
    typeOf(w, SUBNETWORK)['hiddenWhen'] = "$.data.purpose == 'PRIVATE_NAT'";
    w.fixtures['fixtures/compute.googleapis.com/Subnetwork.json'] = [subnetFixture, natSubnetFixture];
    const { catalog, report } = compile(w);
    expect(report.violations).toEqual([]);
    expect(catalog?.types[NETWORK]).not.toHaveProperty('hiddenWhen');
    expect(catalog?.types[SUBNETWORK]?.hiddenWhen).toBe("$.data.purpose == 'PRIVATE_NAT'");
  });
});

describe('compileCatalog finds planted violations', () => {
  it('an unknown type (not on the official list, not deprecated)', () => {
    const w = world();
    product(w).types['compute.googleapis.com/Netwerk'] = { role: 'leaf' };
    const { report } = compile(w);
    expect(report.violations.map((v) => v.code)).toEqual(['not-official']);
    expect(report.notOfficial.unmarked).toEqual(['compute.googleapis.com/Netwerk']);
  });

  it('a deprecated type is reported, not failed; a deprecated type still on the list fails', () => {
    const w = world();
    product(w).types['compute.googleapis.com/OldThing'] = { role: 'leaf', deprecated: '2026-09-01' };
    const { report } = compile(w);
    expect(report.violations).toEqual([]);
    expect(report.notOfficial.deprecated).toEqual(['compute.googleapis.com/OldThing']);
    typeOf(w, NETWORK)['deprecated'] = '2026-09-01';
    expect(codes(w)).toEqual(['deprecated-but-official']);
  });

  it('a missing fixture', () => {
    const w = world();
    delete w.fixtures['fixtures/compute.googleapis.com/Subnetwork.json'];
    const { report } = compile(w);
    expect(report.violations.map((v) => v.code)).toEqual(['rule-without-fixture']);
    expect(report.rulesWithoutFixtures).toEqual([
      `${SUBNETWORK} ips[0] ($.data.ipCidrRange)`,
      `${SUBNETWORK} relations[0] ($.data.network → computeSelfLink)`,
    ]);
    expect(report.counts.typesWithoutFixtures).toBe(1);
  });

  it('a type without rules needs no fixture', () => {
    const w = world();
    product(w).types[ROUTE] = { role: 'leaf' };
    group(w).types = {};
    expect(compile(w).report.violations).toEqual([]);
    expect(compile(w).report.counts.typesWithoutFixtures).toBe(1);
  });

  it('an unknown normaliser, with the line the loader reports', () => {
    const w = world();
    typeOf(w, SUBNETWORK)['relations'] = [{ kind: 'attaches', to: '$.data.network', normalize: 'selfLink' }];
    const s = sources(w);
    const products = s.products.map((file) => source(file.path, file.content, (path) => path.length + 100));
    const { report, catalog } = compileCatalog({ ...s, products }, OFFICIAL, { version: '0.0.0' });
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]).toMatchObject({
      code: 'schema',
      file: COMPUTE_FILE,
      line: 105,
    });
    expect(report.violations[0]?.message).toContain(`types.${SUBNETWORK}.relations[0].normalize`);
    expect(catalog?.types[SUBNETWORK]).toBeUndefined();
    expect(catalog?.types[NETWORK]).toBeDefined();
  });

  it('a rule its fixture does not prove', () => {
    const w = world();
    typeOf(w, NETWORK)['relations'] = [
      { kind: 'peers', to: '$.data.peerings[*].peerNetwork', normalize: 'computeSelfLink' },
    ];
    typeOf(w, SUBNETWORK)['ips'] = ['$.data.name'];
    typeOf(w, SUBNETWORK)['domains'] = ['$.data.name'];
    typeOf(w, NETWORK)['contains'] = ['$.data.missing[*]'];
    const messages = compile(w).report.violations.map((v) => `${v.code}: ${v.message}`);
    expect(messages).toEqual([
      `rule-unproven: ${NETWORK} relations[0] ($.data.peerings[*].peerNetwork → computeSelfLink): no fixture yields a well-formed value through it`,
      `rule-unproven: ${NETWORK} contains[0] ($.data.missing[*]): no fixture yields a well-formed value through it`,
      `rule-unproven: ${SUBNETWORK} ips[0] ($.data.name): no fixture yields a well-formed value through it`,
      `rule-unproven: ${SUBNETWORK} domains[0] ($.data.name): no fixture yields a well-formed value through it`,
    ]);
  });

  it('a hiddenWhen predicate that no fixture exercises both ways', () => {
    const w = world();
    typeOf(w, SUBNETWORK)['hiddenWhen'] = "$.data.purpose == 'PRIVATE_NAT'";
    const never = compile(w).report.violations;
    expect(never.map((v) => `${v.code}: ${v.message}`)).toEqual([
      `hidden-unproven: ${SUBNETWORK} hiddenWhen: no fixture exercises both outcomes; add one it matches (starts hidden) to fixtures/compute.googleapis.com/Subnetwork.json ($.data.purpose == 'PRIVATE_NAT')`,
    ]);
    typeOf(w, SUBNETWORK)['hiddenWhen'] = '$.name exists';
    expect(compile(w).report.violations.map((v) => v.message)).toEqual([
      `${SUBNETWORK} hiddenWhen: no fixture exercises both outcomes; add one it does not match (stays visible) to fixtures/compute.googleapis.com/Subnetwork.json ($.name exists)`,
    ]);
    const { catalog } = compile(w);
    expect(catalog?.types[SUBNETWORK]).toBeUndefined();
    w.fixtures['fixtures/compute.googleapis.com/Subnetwork.json'] = [subnetFixture, natSubnetFixture];
    typeOf(w, SUBNETWORK)['hiddenWhen'] = "$.data.purpose == 'PRIVATE_NAT'";
    expect(codes(w)).toEqual([]);
  });

  it('nestsIn rules are proven like relations', () => {
    const w = world();
    typeOf(w, SUBNETWORK)['nestsIn'] = {
      to: '$.data.network',
      normalize: 'computeSelfLink',
      kind: 'attaches',
    };
    expect(codes(w)).toEqual([]);
    expect(compile(w).catalog?.types[SUBNETWORK]?.nestsIn).toEqual([
      { to: '$.data.network', normalize: 'computeSelfLink', kind: 'attaches' },
    ]);
    typeOf(w, SUBNETWORK)['nestsIn'] = [
      { to: '$.data.network', normalize: 'computeSelfLink' },
      { to: '$.data.missing', normalize: 'siblingName', pattern: '{parent}/networks/{id}' },
    ];
    expect(compile(w).report.violations.map((v) => `${v.code}: ${v.message}`)).toEqual([
      `rule-unproven: ${SUBNETWORK} nestsIn[1] ($.data.missing → siblingName): no fixture yields a well-formed value through it`,
    ]);
    typeOf(w, SUBNETWORK)['nestsIn'] = { to: '$..network', normalize: 'computeSelfLink' };
    expect(codes(w)).toEqual(['syntax', 'rule-unproven']);
  });

  it('a template with a variable no fixture has', () => {
    const w = world();
    typeOf(w, NETWORK)['console'] = 'https://console.cloud.google.com/x/{{data.missing}}';
    typeOf(w, SUBNETWORK)['subtitle'] = '{{data.purpose}}';
    expect(codes(w)).toEqual(['template-unproven', 'template-unproven']);
  });

  it('malformed paths and predicates', () => {
    const w = world();
    typeOf(w, NETWORK)['relations'] = [{ kind: 'peers', to: '$..network', normalize: 'computeSelfLink' }];
    typeOf(w, NETWORK)['hiddenWhen'] = '$.data.state = 1';
    typeOf(w, SUBNETWORK)['ips'] = ['$.data[0:1]'];
    typeOf(w, SUBNETWORK)['domains'] = ['$.data.x[?(@.a ==)]'];
    typeOf(w, NETWORK)['contains'] = ['$.data.subnetworks[*'];
    const violations = compile(w).report.violations.filter((v) => v.code === 'syntax');
    expect(violations.map((v) => v.message.split(':')[0])).toEqual([
      `${NETWORK} relations[0].to`,
      `${NETWORK} contains[0]`,
      `${NETWORK} hiddenWhen`,
      `${SUBNETWORK} ips[0]`,
      `${SUBNETWORK} domains[0]`,
    ]);
  });

  it('an official type that is neither mapped nor listed, in the group that owns it or in none', () => {
    const w = world();
    group(w).types = {};
    const { report } = compile(w);
    expect(report.violations).toEqual([
      {
        code: 'unmapped',
        message: `${ROUTE} is on the official list but neither in the catalog nor listed in ${NET_GROUP}, which owns it`,
        file: NET_GROUP,
      },
    ]);
    expect(report.unmapped.unlisted).toEqual([ROUTE]);
    expect(report.groups[0]?.missing).toEqual([ROUTE]);
    w.groups = {};
    const unowned = compile(w).report;
    expect(unowned.violations.map((v) => `${v.code} ${v.file ?? '(no file)'}`)).toEqual([
      'unmapped (no file)',
    ]);
    expect(unowned.ungrouped).toEqual([NETWORK, ROUTE, SUBNETWORK]);
  });

  it('a type both mapped and listed as unmapped names the group file and the product file', () => {
    const w = world();
    group(w).types = { [ROUTE]: 'later', [NETWORK]: 'later', 'compute.googleapis.com/Gone': 'later' };
    const { report } = compile(w);
    expect(report.violations).toEqual([
      expect.objectContaining({
        code: 'known-unmapped-but-mapped',
        file: NET_GROUP,
        related: [COMPUTE_FILE],
        message: `${NETWORK} is mapped in products/compute.googleapis.com.yaml now: remove it from ${NET_GROUP}`,
      }),
      expect.objectContaining({ code: 'known-unmapped-not-official', file: NET_GROUP }),
    ]);
  });

  it('a malformed group file, a misnamed one, and none at all', () => {
    const w = world();
    group(w).types = { [ROUTE]: '' };
    expect(codes(w)).toEqual(['schema', 'unmapped']);
    w.groups = { 'known-unmapped/Net Work.yaml': { title: 'x' } };
    expect(codes(w)).toEqual(['file-name', 'unmapped']);
    w.groups = {};
    const missing = compile(w, OFFICIAL, [{ code: 'load', file: 'known-unmapped/', message: 'missing' }]);
    expect(missing.report.violations.map((v) => v.code)).toEqual(['load', 'unmapped']);
  });

  it('types listed twice, listed by a group that does not own them, and owns patterns that match nothing', () => {
    const w = world();
    w.groups[DNS_GROUP] = {
      title: 'DNS',
      owns: ['dns.googleapis.com/*', 'compute.googleapis.com/Route', 'nothing.googleapis.com/*'],
      types: { [ROUTE]: 'pending (dns-domains)', [SUBNETWORK]: 'x' },
    };
    group(w).owns = ['compute.googleapis.com/Network', 'compute.googleapis.com/Subnetwork'];
    group(w).types = { [ROUTE]: 'pending (networking-fabric)', 'compute.googleapis.com/Firewall': 'x' };
    const official = { ...OFFICIAL, types: new Set([...OFFICIAL.types, 'compute.googleapis.com/Firewall']) };
    const messages = compile(w, official).report.violations.map(
      (v) => `${v.code} ${v.file ?? ''}: ${v.message}`,
    );
    expect(messages).toEqual([
      // DNS owning one compute type makes compute.googleapis.com a shared service (below).
      expect.stringMatching(
        /^product-file-group products\/compute\.googleapis\.com\.yaml: holds types of net: /,
      ),
      `known-unmapped-duplicate ${NET_GROUP}: ${ROUTE} is listed in both ${DNS_GROUP} and ${NET_GROUP}: keep it in the group that owns it`,
      `known-unmapped-but-mapped ${DNS_GROUP}: ${SUBNETWORK} is mapped in products/compute.googleapis.com.yaml now: remove it from ${DNS_GROUP}`,
      `known-unmapped-wrong-group ${DNS_GROUP}: ${SUBNETWORK} is owned by ${NET_GROUP} (its owns patterns): list it there, not in ${DNS_GROUP}`,
      `group-owns ${DNS_GROUP}: dns.googleapis.com/* matches no official or catalog type`,
      `group-owns ${DNS_GROUP}: nothing.googleapis.com/* matches no official or catalog type`,
      `known-unmapped-wrong-group ${NET_GROUP}: compute.googleapis.com/Firewall is listed here but no group owns it: add it (or its <service>/*) to owns`,
    ]);
  });

  it('the most specific owns pattern wins; two groups owning a type equally is an error', () => {
    const w = world();
    w.groups[DNS_GROUP] = { title: 'DNS', owns: [ROUTE], types: { [ROUTE]: 'pending (dns-domains)' } };
    group(w).types = {};
    // Two groups now share compute.googleapis.com, so net's file carries its group's name.
    w.products = { 'products/compute.googleapis.com.net.yaml': product(w) };
    const { report } = compile(w);
    expect(report.violations).toEqual([]);
    expect(report.groups.map((g) => [g.group, g.official])).toEqual([
      ['dns', 1],
      ['net', 2],
    ]);
    w.groups[DNS_GROUP] = { title: 'DNS', owns: ['compute.googleapis.com/*'] };
    const overlap = compile(w).report.violations.filter((v) => v.code === 'group-overlap');
    expect(overlap.map((v) => v.message)).toEqual(
      [NETWORK, ROUTE, SUBNETWORK].map(
        (type) =>
          `${type} is owned by both ${DNS_GROUP} and ${NET_GROUP} at the same specificity: one of them must give it up`,
      ),
    );
    expect(overlap[0]?.related).toEqual([DNS_GROUP]);
  });

  it('a product file that holds types of two groups', () => {
    const w = world();
    w.groups[DNS_GROUP] = { title: 'Subnets', owns: [SUBNETWORK] };
    const violations = compile(w).report.violations;
    expect(violations).toEqual([
      expect.objectContaining({
        code: 'group-mixed-file',
        file: COMPUTE_FILE,
        related: [DNS_GROUP, NET_GROUP],
      }),
    ]);
    expect(violations[0]?.message).toContain('(dns, net)');
  });

  it('pending (unknown) icon keys warn, or fail with strictIcons; unused and duplicated keys fail', () => {
    const w = world();
    typeOf(w, SUBNETWORK)['icon'] = 'subnet';
    w.icons = {
      description: 'Icon keys.',
      keys: ['compute_engine', 'virtual_private_cloud', 'spare', 'spare'],
    };
    const { report } = compile(w);
    expect(report.violations.map((v) => v.code)).toEqual(['schema', 'unused-icon']);
    expect(report.warnings).toEqual([
      expect.objectContaining({
        code: 'unknown-icon',
        file: COMPUTE_FILE,
        message: 'icon key subnet is not in icon-keys.json yet (pending: a warning without --strict-icons)',
      }),
    ]);
    expect(report.pendingIconKeys).toEqual(['subnet']);
    expect(report.unusedIconKeys).toEqual(['spare']);
    const strict = compile(w, OFFICIAL, [], { strictIcons: true }).report;
    expect(strict.violations.map((v) => v.code)).toEqual(['schema', 'unknown-icon', 'unused-icon']);
    expect(strict.warnings).toEqual([]);
    w.icons = { keys: [] };
    expect(codes(w)).toContain('schema');
  });

  it('fixtures without a catalog entry, invalid fixtures and fixtures in the wrong place', () => {
    const w = world();
    w.fixtures['fixtures/compute.googleapis.com/Route.json'] = rawAsset(
      '//compute.googleapis.com/projects/demo-net-1/global/routes/r',
      ROUTE,
      {},
      { location: 'global' },
    );
    w.fixtures['fixtures/compute.googleapis.com/Firewall.json'] = [];
    w.fixtures['fixtures/compute.googleapis.com/Address.json'] = [{ name: 'not a full name' }];
    w.fixtures['fixtures/compute.googleapis.com/Disk.json'] = rawAsset(
      '//compute.googleapis.com/projects/demo-net-1/zones/z/disks/d',
      NETWORK,
      {},
    );
    w.fixtures['fixtures/Network.json'] = networkFixture;
    const { report } = compile(w);
    expect(report.violations.map((v) => `${v.code} ${v.file ?? ''}`)).toEqual([
      'fixture-without-rules fixtures/compute.googleapis.com/Route.json',
      'fixture-invalid fixtures/compute.googleapis.com/Firewall.json',
      'fixture-without-rules fixtures/compute.googleapis.com/Firewall.json',
      ...['name', 'assetType', 'ancestors', 'updateTime', 'data'].map(
        () => 'fixture-invalid fixtures/compute.googleapis.com/Address.json',
      ),
      'fixture-without-rules fixtures/compute.googleapis.com/Address.json',
      'fixture-invalid fixtures/compute.googleapis.com/Disk.json',
      'fixture-without-rules fixtures/compute.googleapis.com/Disk.json',
      'file-name fixtures/Network.json',
    ]);
    expect(report.fixturesWithoutRules).toEqual([
      'fixtures/compute.googleapis.com/Address.json',
      'fixtures/compute.googleapis.com/Disk.json',
      'fixtures/compute.googleapis.com/Firewall.json',
      'fixtures/compute.googleapis.com/Route.json',
    ]);
  });

  it('fixtures with data that does not look synthetic', () => {
    const w = world();
    w.fixtures['fixtures/compute.googleapis.com/Subnetwork.json'] = rawAsset(
      '//compute.googleapis.com/projects/demo-net-1/regions/europe-west3/subnetworks/app',
      SUBNETWORK,
      {
        name: 'app',
        network: `${SELF}/demo-net-1/global/networks/core`,
        ipCidrRange: '10.10.0.0/20',
        owner: 'someone@gmail.com',
        dns: '8.8.8.8',
        docs: 'https://docs.vendor.io/x',
        project: 'projects/123456789012',
      },
    );
    const findings = compile(w)
      .report.violations.filter((v) => v.code === 'fixture-not-synthetic')
      .map((v) => v.message);
    expect(findings).toEqual([
      'email someone@gmail.com (fixtures use synthetic data only)',
      'ip 8.8.8.8 (fixtures use synthetic data only)',
      'domain docs.vendor.io (fixtures use synthetic data only)',
      'project-number projects/123456789012 (fixtures use synthetic data only)',
    ]);
  });

  it('names the line of a synthetic-data finding when the loader kept the text', () => {
    const w = world();
    const s = sources(w);
    const text = JSON.stringify(networkFixture, null, 2).replace(
      '"name": "core"',
      '"name": "core", "ip": "8.8.4.4"',
    );
    const fixtures = s.fixtures.map((file) =>
      file.path.endsWith('Network.json') ? { ...file, content: JSON.parse(text) as unknown, text } : file,
    );
    const { report } = compileCatalog({ ...s, fixtures }, OFFICIAL, { version: '0.0.0' });
    expect(report.violations).toEqual([
      {
        code: 'fixture-not-synthetic',
        message: 'ip 8.8.4.4 (fixtures use synthetic data only)',
        file: 'fixtures/compute.googleapis.com/Network.json',
        line: text.split('\n').findIndex((line) => line.includes('8.8.4.4')) + 1,
      },
    ]);
  });

  it('containers whose children are unknown, mutual or do not nest', () => {
    const w = world();
    typeOf(w, NETWORK)['contains'] = [
      '$.data.subnetworks[*]',
      { byParent: 'compute.googleapis.com/Nonsense' },
      { byParent: SUBNETWORK },
    ];
    typeOf(w, SUBNETWORK)['contains'] = [{ byParent: NETWORK }];
    const messages = compile(w)
      .report.violations.filter((v) => v.code === 'container-child')
      .map((v) => v.message);
    expect(messages).toEqual([
      `${NETWORK} contains compute.googleapis.com/Nonsense, which is neither official nor in the catalog`,
      `${NETWORK} and ${SUBNETWORK} contain each other`,
      `no fixture of ${SUBNETWORK} nests in a fixture of ${NETWORK} (by parent or by name)`,
      `${SUBNETWORK} and ${NETWORK} contain each other`,
      `no fixture of ${NETWORK} nests in a fixture of ${SUBNETWORK} (by parent or by name)`,
    ]);
  });

  it('a container whose child fixture nests by parent is fine', () => {
    const w = world();
    typeOf(w, NETWORK)['contains'] = ['$.data.subnetworks[*]', { byParent: SUBNETWORK }];
    w.fixtures['fixtures/compute.googleapis.com/Subnetwork.json'] = [
      {
        ...subnetFixture,
        parent: '//compute.googleapis.com/projects/demo-net-1/global/networks/core',
      },
    ];
    expect(codes(w)).toEqual([]);
  });

  it('missing, misnamed, invalid and over-narrow lenses', () => {
    const w = world();
    delete w.lenses['lenses/everything.yaml'];
    w.lenses['lenses/extra.yaml'] = { title: 'x' };
    w.lenses['lenses/overview.yaml'] = { title: 'Overview', description: 'x', types: [], relationKinds: [] };
    w.lenses['lenses/networking.yaml'] = {
      title: 'Networking',
      description: 'x',
      types: ['dns.googleapis.com/*', 'compute.googleapis.com/*', 'compute.googleapis.com/Netwerk'],
      relationKinds: ['attaches'],
    };
    const { report, catalog } = compile(w);
    expect(report.violations.map((v) => v.code)).toEqual([
      'schema',
      'lens-pattern',
      'lens-pattern',
      'file-name',
      'lens-missing',
      'lens-missing',
    ]);
    expect(catalog).toBeUndefined();
  });

  it('product files named after the wrong service, and types of another service', () => {
    const w = world();
    w.products['products/compute.yaml'] = {
      product: 'Compute Engine',
      service: 'compute.googleapis.com',
      icon: 'compute_engine',
      types: {},
    };
    w.products['products/compute.googleapis.com.Extra_Suffix.yaml'] = {
      product: 'Compute Engine',
      service: 'compute.googleapis.com',
      icon: 'compute_engine',
      types: {},
    };
    product(w).types['container.googleapis.com/Cluster'] = { role: 'leaf' };
    const messages = compile(w).report.violations.map((v) => `${v.code} ${v.file ?? ''}: ${v.message}`);
    expect(messages).toEqual([
      'file-name products/compute.yaml: a product file is named after its service: products/compute.googleapis.com.yaml or products/compute.googleapis.com.<suffix>.yaml',
      'file-name products/compute.googleapis.com.yaml: container.googleapis.com/Cluster belongs in a product file of container.googleapis.com: products/container.googleapis.com[.<suffix>].yaml',
      'file-name products/compute.googleapis.com.Extra_Suffix.yaml: a product file is named after its service: products/compute.googleapis.com.yaml or products/compute.googleapis.com.<suffix>.yaml',
      'not-official products/compute.googleapis.com.yaml: container.googleapis.com/Cluster is not on the official list of 2026-10-08: fix the identifier, remove the entry, or mark it deprecated: <date>',
    ]);
  });

  it('accepts <service>.yaml and <service>.<suffix>.yaml product file names', () => {
    expect(productFileFits(COMPUTE_FILE, 'compute.googleapis.com')).toBe(true);
    expect(productFileFits('products/compute.googleapis.com.lb-chain.yaml', 'compute.googleapis.com')).toBe(
      true,
    );
    expect(productFileFits('products/k8s.io.apps.yaml', 'k8s.io')).toBe(true);
    expect(productFileFits('products/apps.k8s.io.yaml', 'k8s.io')).toBe(false);
    expect(productFileFits('products/compute.googleapis.com..yaml', 'compute.googleapis.com')).toBe(false);
    expect(productFileFits('products/compute.googleapis.com.a.b.yaml', 'compute.googleapis.com')).toBe(false);
    expect(productFileFits('products/compute.googleapis.com.x.json', 'compute.googleapis.com')).toBe(false);
  });

  it('merges several product files of one service, by product name', () => {
    const w = world();
    product(w).types = { [NETWORK]: typeOf(w, NETWORK) };
    w.products['products/compute.googleapis.com.subnets.yaml'] = {
      product: 'Compute Engine',
      service: 'compute.googleapis.com',
      icon: 'compute_engine',
      types: { [SUBNETWORK]: { role: 'container', label: '{{data.name}}', ips: ['$.data.ipCidrRange'] } },
    };
    w.products['products/compute.googleapis.com.routes.yaml'] = {
      product: 'Compute Engine routes',
      service: 'compute.googleapis.com',
      icon: 'virtual_private_cloud',
      types: { [ROUTE]: { role: 'leaf' } },
    };
    group(w).types = {};
    const { catalog, report } = compile(w);
    expect(report.violations).toEqual([]);
    expect(catalog?.products).toEqual([
      {
        product: 'Compute Engine',
        service: 'compute.googleapis.com',
        icon: 'compute_engine',
        types: [NETWORK, SUBNETWORK],
      },
      {
        product: 'Compute Engine routes',
        service: 'compute.googleapis.com',
        icon: 'virtual_private_cloud',
        types: [ROUTE],
      },
    ]);
    expect(catalog?.types[ROUTE]?.icon).toBe('virtual_private_cloud');
    expect(report.counts.products).toBe(2);
    expect(report.counts.productFiles).toBe(3);
    expect(report.groups[0]?.productFiles).toEqual([
      'products/compute.googleapis.com.routes.yaml',
      'products/compute.googleapis.com.subnets.yaml',
      COMPUTE_FILE,
    ]);
  });

  it('a type described in two files is an error that names both files', () => {
    const w = world();
    w.products['products/compute.googleapis.com.copy.yaml'] = JSON.parse(
      JSON.stringify(w.products[COMPUTE_FILE]),
    ) as unknown;
    const violations = compile(w).report.violations;
    expect(
      violations.map((v) => `${v.code} ${v.file ?? ''} (${(v.related ?? []).join(', ')}): ${v.message}`),
    ).toEqual([
      `duplicate-type products/compute.googleapis.com.copy.yaml (products/compute.googleapis.com.yaml): ${NETWORK} is described in both products/compute.googleapis.com.yaml and products/compute.googleapis.com.copy.yaml: describe it once (net owns it)`,
      `duplicate-type products/compute.googleapis.com.copy.yaml (products/compute.googleapis.com.yaml): ${SUBNETWORK} is described in both products/compute.googleapis.com.yaml and products/compute.googleapis.com.copy.yaml: describe it once (net owns it)`,
    ]);
  });

  it('files of one product must agree on its icon', () => {
    const w = world();
    w.products['products/compute.googleapis.com.routes.yaml'] = {
      product: 'Compute Engine',
      service: 'compute.googleapis.com',
      icon: 'virtual_private_cloud',
      types: { [ROUTE]: { role: 'leaf' } },
    };
    group(w).types = {};
    expect(compile(w).report.violations).toEqual([
      expect.objectContaining({
        code: 'product-mismatch',
        file: 'products/compute.googleapis.com.routes.yaml',
        related: [COMPUTE_FILE],
      }),
    ]);
  });

  it('a product name that is not the official product of any of its types', () => {
    const w = world();
    const productOf = new Map([
      [NETWORK, 'Compute Engine'],
      [SUBNETWORK, 'Compute Engine'],
    ]);
    expect(codes(w, { ...OFFICIAL, productOf })).toEqual([]);
    product(w).product = 'Compute';
    const violations = compile(w, { ...OFFICIAL, productOf }).report.violations;
    expect(violations.map((v) => v.message)).toEqual([
      'product "Compute" is not the official product of any of its types (official: Compute Engine)',
    ]);
    expect(codes(w, { ...OFFICIAL, productOf: new Map() })).toEqual([]);
  });

  it('an invalid product file is skipped with its schema issues', () => {
    const w = world();
    w.products['products/dns.googleapis.com.yaml'] = 'not a mapping';
    expect(codes(w)).toEqual(['schema']);
    const { report } = compile(w);
    expect(report.violations[0]?.message).toContain('(file)');
  });
});

describe('groups sharing a service (compute.googleapis.com: net and web)', () => {
  it('compiles clean, each group with its own file', () => {
    const w = shared();
    const { catalog, report } = compile(w);
    expect(report.violations).toEqual([]);
    expect(report.groups.map((g) => [g.group, g.productFiles])).toEqual([
      ['net', [NET_FILE]],
      ['web', [WEB_FILE]],
    ]);
    expect(catalog?.products).toEqual([
      expect.objectContaining({ product: 'Compute Engine', types: [NETWORK, ROUTE, SUBNETWORK] }),
    ]);
  });

  it("names each group's file after the group (product-file-group)", () => {
    const plain = shared();
    plain.products = {
      [COMPUTE_FILE]: plain.products[NET_FILE],
      [WEB_FILE]: plain.products[WEB_FILE],
    };
    const violations = compile(plain).report.violations;
    expect(show(violations)).toEqual(['product-file-group products/compute.googleapis.com.yaml']);
    expect(violations[0]?.message).toBe(
      "holds types of net: name it products/compute.googleapis.com.net.yaml (or …net-<more>.yaml); compute.googleapis.com is shared by net, web, so each group's file is products/compute.googleapis.com.<group>.yaml (products/compute.googleapis.com.net.yaml, products/compute.googleapis.com.web.yaml)",
    );

    const more = shared();
    more.products = {
      [NET_FILE]: more.products[NET_FILE],
      'products/compute.googleapis.com.web-routes.yaml': more.products[WEB_FILE],
    };
    expect(compile(more).report.violations).toEqual([]);

    const wrong = shared();
    wrong.products = {
      [NET_FILE]: wrong.products[NET_FILE],
      'products/compute.googleapis.com.net-routes.yaml': wrong.products[WEB_FILE],
    };
    const misnamed = compile(wrong).report;
    // The file's name says net, so it is net's file: web's Route does not belong in it.
    expect(misnamed.violations).toEqual([
      {
        code: 'product-file-group',
        file: 'products/compute.googleapis.com.net-routes.yaml',
        related: [WEB_GROUP],
        message: `${ROUTE} is owned by web, but this file is net's (by its name): remove ${ROUTE} from this file; web maps it in its own file (${WEB_FILE}). If net should own it, say so in your report rather than editing ${WEB_GROUP}`,
      },
    ]);
    expect(misnamed.groups.find((g) => g.group === 'net')?.productFiles).toContain(
      'products/compute.googleapis.com.net-routes.yaml',
    );
    expect(show(scoped(misnamed, wrong, 'net').report.violations)).toEqual([
      'product-file-group products/compute.googleapis.com.net-routes.yaml',
    ]);
    const web = scoped(misnamed, wrong, 'web');
    expect(web.report.violations).toEqual([]);
    expect(show(web.related)).toEqual(['product-file-group products/compute.googleapis.com.net-routes.yaml']);

    const empty = shared();
    empty.products['products/compute.googleapis.com.misc.yaml'] = {
      product: 'Compute Engine',
      service: 'compute.googleapis.com',
      icon: 'compute_engine',
      types: {},
    };
    const nameless = compile(empty).report.violations;
    expect(show(nameless)).toEqual(['product-file-group products/compute.googleapis.com.misc.yaml']);
    expect(nameless[0]?.message).toMatch(/^names no group: /);
  });

  it("keeps a broken product file of the shared service out of the other group's scoped check", () => {
    // web's file is mid-edit: not even YAML. net must stay green; web sees its own problem.
    const w = shared();
    w.products = { [NET_FILE]: w.products[NET_FILE] };
    const load: Violation = {
      code: 'load',
      file: WEB_FILE,
      line: 6,
      message: 'invalid YAML: unexpected end',
    };
    const text = `product: Compute Engine\ntypes:\n  ${ROUTE}:\n    role: leaf\n    relations: [\n`;
    const { report } = compile(w, OFFICIAL, [load], {}, [{ path: WEB_FILE, text }]);
    // Route is named by the broken file: no "unmapped" noise on top of the load error.
    expect(show(report.violations)).toEqual([`load ${WEB_FILE}`]);
    expect(scoped(report, w, 'net', [WEB_FILE]).report.violations).toEqual([]);
    expect(show(scoped(report, w, 'web', [WEB_FILE]).report.violations)).toEqual([`load ${WEB_FILE}`]);

    // The same file under a name that names no group is attributed by the types it names.
    const wip = 'products/compute.googleapis.com.wip.yaml';
    const unnamed = compile(w, OFFICIAL, [{ ...load, file: wip }], {}, [{ path: wip, text }]).report;
    expect(show(unnamed.violations)).toEqual([`load ${wip}`, `product-file-group ${wip}`]);
    expect(scoped(unnamed, w, 'net', [wip]).report.violations).toEqual([]);
    expect(show(scoped(unnamed, w, 'web', [wip]).report.violations)).toEqual([
      `load ${wip}`,
      `product-file-group ${wip}`,
    ]);

    // Valid YAML that is no valid product yet (no icon): attributed by its types too.
    const iconless = shared();
    iconless.products[WEB_FILE] = {
      product: 'Compute Engine',
      service: 'compute.googleapis.com',
      types: { [ROUTE]: { role: 'leaf' } },
    };
    const schema = compile(iconless).report;
    expect(show(schema.violations)).toEqual([`schema ${WEB_FILE}`]);
    expect(scoped(schema, iconless, 'net').report.violations).toEqual([]);
    expect(show(scoped(schema, iconless, 'web').report.violations)).toEqual([`schema ${WEB_FILE}`]);

    // A broken file that names neither a group nor a type belongs to every group of its service.
    const bare = compile(w, OFFICIAL, [{ ...load, file: wip }], {}, [
      { path: wip, text: 'product: [\n' },
    ]).report;
    expect(bare.groups.map((g) => g.productFiles.includes(wip))).toEqual([true, true]);
  });

  it("keeps a type described twice in its owner's file, whatever the file order", () => {
    // net's file sorts first (net before web) but wrongly describes web's Route as well.
    const w = shared();
    product(w, NET_FILE).types[ROUTE] = { role: 'leaf', label: 'net {{data.name}}' };
    const { catalog, report } = compile(w);
    expect(report.violations).toEqual([
      expect.objectContaining({
        code: 'duplicate-type',
        file: NET_FILE,
        related: [WEB_FILE],
        message: `${ROUTE} is described in both ${WEB_FILE} and ${NET_FILE}: describe it once (web owns it)`,
      }),
      expect.objectContaining({ code: 'product-file-group', file: NET_FILE, related: [WEB_GROUP] }),
    ]);
    expect(catalog?.types[ROUTE]?.label).toBe('web {{data.name}}');
    expect(show(scoped(report, w, 'net').report.violations)).toEqual([
      `duplicate-type ${NET_FILE}`,
      `product-file-group ${NET_FILE}`,
    ]);
    const web = scoped(report, w, 'web');
    expect(web.report.violations).toEqual([]);
    expect(show(web.related)).toEqual([`duplicate-type ${NET_FILE}`, `product-file-group ${NET_FILE}`]);
  });

  it("blames a type mapped in another group's file on that file, never on the owner's list", () => {
    // web still lists Route as unmapped; net maps it in its own, correctly named file.
    const w = shared();
    w.products = { [NET_FILE]: w.products[NET_FILE] };
    product(w, NET_FILE).types[ROUTE] = { role: 'leaf', label: 'net {{data.name}}' };
    group(w, WEB_GROUP).types = { [ROUTE]: 'pending (load-balancing-edge)' };
    const { catalog, excluded, report } = compile(w);
    expect(report.violations).toEqual([
      {
        code: 'product-file-group',
        file: NET_FILE,
        related: [WEB_GROUP],
        message: `${ROUTE} is owned by web, but this file is net's (by its name): remove ${ROUTE} from this file; web maps it in its own file (${WEB_FILE}). If net should own it, say so in your report rather than editing ${WEB_GROUP}`,
      },
    ]);
    // The misplaced entry never reaches the graph builder; net's own types do.
    expect(excluded).toEqual([ROUTE]);
    expect(Object.keys(catalog?.types ?? {})).toEqual([NETWORK, SUBNETWORK]);
    // web's check stays green and shows the problem as a note; net's check fails on its own file.
    const web = scoped(report, w, 'web');
    expect(web.report.violations).toEqual([]);
    expect(show(web.related)).toEqual([`product-file-group ${NET_FILE}`]);
    expect(show(scoped(report, w, 'net').report.violations)).toEqual([`product-file-group ${NET_FILE}`]);

    // Once web maps Route in its own file, web's line is stale, and net's copy is a duplicate as well.
    w.products[WEB_FILE] = shared().products[WEB_FILE];
    const both = compile(w).report.violations;
    expect(show(both)).toEqual([
      `duplicate-type ${NET_FILE}`,
      `product-file-group ${NET_FILE}`,
      `known-unmapped-but-mapped ${WEB_GROUP}`,
    ]);
    expect(both[2]?.message).toBe(`${ROUTE} is mapped in ${WEB_FILE} now: remove it from ${WEB_GROUP}`);

    // A file named after a group is that group's whatever its service: net's name on a DNS file.
    const dns = shared();
    dns.groups[DNS_GROUP] = { title: 'DNS', owns: ['dns.googleapis.com/*'], types: { [ZONE]: 'later' } };
    dns.products['products/dns.googleapis.com.net.yaml'] = {
      product: 'Cloud DNS',
      service: 'dns.googleapis.com',
      icon: 'compute_engine',
      types: { [ZONE]: { role: 'core' } },
    };
    const official = { ...OFFICIAL, types: new Set([...OFFICIAL.types, ZONE]) };
    const named = compile(dns, official).report;
    expect(show(named.violations)).toEqual(['product-file-group products/dns.googleapis.com.net.yaml']);
    expect(named.violations[0]?.message).toContain(
      'dns maps it in its own file (products/dns.googleapis.com.yaml)',
    );
    expect(scoped(named, dns, 'dns').report.violations).toEqual([]);
  });

  it("keeps the owner's entry in the build when another group's copy of it is broken", () => {
    // web's file carries an invalid copy of net's Network (a misspelt role).
    const w = shared();
    product(w, WEB_FILE).types[NETWORK] = { role: 'containerr', label: 'web {{data.name}}' };
    const { catalog, excluded, report } = compile(w);
    expect(show(report.violations)).toEqual([`schema ${WEB_FILE}`, `product-file-group ${WEB_FILE}`]);
    expect(excluded).toEqual([]);
    expect(catalog?.types[NETWORK]).toEqual(
      expect.objectContaining({ role: 'container', label: '{{data.name}}' }),
    );
    expect(Object.keys(catalog?.types ?? {})).toEqual([NETWORK, ROUTE, SUBNETWORK]);
    const net = scoped(report, w, 'net');
    expect(net.report.violations).toEqual([]);
    expect(show(net.related)).toEqual([`product-file-group ${WEB_FILE}`]);
  });

  it("lets the first file of a product (in group order) set its icon, so a later group's file is blamed", () => {
    const w = shared();
    (w.products[WEB_FILE] as { icon: string }).icon = 'cloud_load_balancing';
    const { report } = compile(w);
    expect(report.violations).toEqual([
      expect.objectContaining({
        code: 'product-mismatch',
        file: WEB_FILE,
        related: [NET_FILE],
        message: `Compute Engine (compute.googleapis.com) has icon compute_engine in ${NET_FILE}, the first file of the product, and cloud_load_balancing here: use compute_engine (override single types with their own icon)`,
      }),
    ]);
    const net = scoped(report, w, 'net');
    expect(net.report.violations).toEqual([]);
    expect(show(net.related)).toEqual([`product-mismatch ${WEB_FILE}`]);
    expect(show(scoped(report, w, 'web').report.violations)).toEqual([`product-mismatch ${WEB_FILE}`]);
  });
});

describe('the compiled catalog', () => {
  it('leaves out every type with a violation of its own, and a product left without types', () => {
    const w = world();
    typeOf(w, SUBNETWORK)['ips'] = ['$.data..ipCidrRange'];
    const { catalog, excluded, report } = compile(w);
    expect(report.violations.map((v) => v.code)).toEqual(['syntax', 'rule-unproven']);
    expect(excluded).toEqual([SUBNETWORK]);
    expect(catalog?.types[SUBNETWORK]).toBeUndefined();
    expect(catalog?.types[NETWORK]).toBeDefined();
    expect(catalog?.products.map((p) => p.types)).toEqual([[NETWORK]]);

    typeOf(w, NETWORK)['relations'] = [
      { kind: 'peers', to: '$.data.nothing[*]', normalize: 'computeSelfLink' },
    ];
    const none = compile(w);
    expect(none.report.violations.map((v) => v.code)).toEqual(['syntax', 'rule-unproven', 'rule-unproven']);
    expect(none.excluded).toEqual([NETWORK, SUBNETWORK]);
    expect(none.catalog?.products).toEqual([]);
    expect(none.catalog?.types).toEqual({});
  });

  it('keeps types whose only problems are elsewhere (a stale group line, a pending icon key)', () => {
    const w = world();
    group(w).types = { [ROUTE]: 'pending (networking-fabric)', [NETWORK]: 'later' };
    typeOf(w, SUBNETWORK)['icon'] = 'subnet';
    const { catalog, excluded, report } = compile(w);
    expect(report.violations.map((v) => v.code)).toEqual(['known-unmapped-but-mapped']);
    expect(excluded).toEqual([]);
    expect(Object.keys(catalog?.types ?? {})).toEqual([NETWORK, SUBNETWORK]);
    const strict = compile(w, OFFICIAL, [], { strictIcons: true });
    expect(strict.excluded).toEqual([SUBNETWORK]);
  });
});

describe('rule traces (--verbose)', () => {
  it('show every rule value on every fixture and what it resolved to', () => {
    const w = world();
    typeOf(w, SUBNETWORK)['contains'] = [{ byParent: ROUTE }];
    typeOf(w, NETWORK)['aliases'] = ['$.data.name'];
    const { trace } = compile(w, OFFICIAL, [], { trace: true });
    expect(trace?.map((type) => [type.assetType, type.rules.map((rule) => rule.rule)])).toEqual([
      [
        NETWORK,
        [
          'relations[0] peers $.data.peerings[*].network → computeSelfLink',
          'contains[0] $.data.subnetworks[*]',
          'aliases[0] $.data.name',
          'label {{data.name}}',
          'console https://console.cloud.google.com/networking/networks/details/{{data.name}}?project={{projectId}}',
        ],
      ],
      [
        SUBNETWORK,
        [
          'relations[0] attaches $.data.network → computeSelfLink',
          'ips[0] $.data.ipCidrRange',
          'contains[0] byParent compute.googleapis.com/Route',
          'label {{data.name}}',
          'subtitle {{data.ipCidrRange}}',
        ],
      ],
    ]);
    const network = trace?.[0];
    expect(network?.rules[0]?.results).toEqual([
      {
        fixture: '//compute.googleapis.com/projects/demo-net-1/global/networks/core',
        raw: `${SELF}/demo-partner-1/global/networks/partner`,
        resolved: '//compute.googleapis.com/projects/demo-partner-1/global/networks/partner',
      },
    ]);
    expect(network?.rules[2]?.results[0]?.resolved).toBe('core');
    expect(network?.rules[4]?.results[0]?.resolved).toBe(
      'https://console.cloud.google.com/networking/networks/details/core?project=demo-net-1',
    );
    expect(compile(w).trace).toBeUndefined();
  });

  it('mark values that resolve to nothing, and templates with a missing variable', () => {
    const w = world();
    typeOf(w, SUBNETWORK)['ips'] = ['$.data.name', '$.data.missing'];
    typeOf(w, SUBNETWORK)['subtitle'] = '{{data.purpose}}';
    const trace = compile(w, OFFICIAL, [], { trace: true }).trace ?? [];
    const subnet = trace.find((type) => type.assetType === SUBNETWORK);
    expect(subnet?.rules.find((rule) => rule.rule === 'ips[0] $.data.name')?.results).toEqual([
      { fixture: subnetFixture['name'], raw: 'app' },
    ]);
    expect(subnet?.rules.find((rule) => rule.rule === 'ips[1] $.data.missing')?.results).toEqual([]);
    expect(subnet?.rules.find((rule) => rule.rule === 'subtitle {{data.purpose}}')?.results).toEqual([
      { fixture: subnetFixture['name'], raw: '{{data.purpose}}', resolved: ' [a variable is missing]' },
    ]);
  });
});
