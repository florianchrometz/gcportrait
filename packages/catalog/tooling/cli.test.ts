// SPDX-License-Identifier: Apache-2.0
/**
 * The command-line tools, run as subprocesses. They check a small synthetic catalog written to a temporary
 * directory (`--root`) against its own official list (`--official`), so they test the tooling and stay green
 * whatever the catalog groups do to the real data at the same time. Each test checks exit codes, the JSON and
 * one phrase of the text: the text layout is tested once, in src/compiler/report.test.ts, and which file a
 * problem is blamed on in src/compiler/compile.test.ts. One cross-group case stays here because only check.ts
 * hands those notes (`scope.related`) to the JSON and the text. The last block only checks that check.ts and
 * coverage.ts find the real catalog and the real official snapshot; the real data itself is tested in catalog.test.ts.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LensIdSchema } from '@gcportrait/model';
import { afterAll, describe, expect, it } from 'vitest';
import type { CoverageReport, GroupCoverage, TypeTrace, Violation } from '../src/compiler/types.js';
import { rawAsset } from '../src/testing/assets.js';
import { CATALOG_ROOT } from './files.js';

const TSX = path.join(CATALOG_ROOT, 'node_modules', '.bin', 'tsx');
/** Each test spawns a few tsx processes. */
const SLOW = { timeout: 60_000 };

type ScopedJson = CoverageReport & {
  scope?: { groups: string[]; files: string[]; outside: number; related: Violation[] };
  trace?: TypeTrace[];
};

const NETWORK = 'compute.googleapis.com/Network';
const SUBNETWORK = 'compute.googleapis.com/Subnetwork';
const FORWARDING_RULE = 'compute.googleapis.com/ForwardingRule';
const URL_MAP = 'compute.googleapis.com/UrlMap';
const INSTANCE = 'compute.googleapis.com/Instance';
const ZONE = 'dns.googleapis.com/ManagedZone';
const DNS_POLICY = 'dns.googleapis.com/Policy';
const TOPIC = 'pubsub.googleapis.com/Topic';

const FABRIC = 'networking-fabric';
const EDGE = 'load-balancing-edge';
const DNS = 'dns-domains';
const COMPUTE = 'compute';
const MESSAGING = 'data-processing-messaging';

const FABRIC_FILE = 'products/compute.googleapis.com.networking-fabric.yaml';
const EDGE_FILE = 'products/compute.googleapis.com.load-balancing-edge.yaml';

const SELF = 'https://www.googleapis.com/compute/v1/projects/demo-net-1';

/**
 * A complete, clean catalog of five groups. Compute Engine is shared by three of them, as in the real
 * catalog: networking fabric maps Network and Subnetwork, load balancing maps ForwardingRule and still lists
 * UrlMap, compute lists Instance; DNS and messaging list their types.
 */
function cleanCatalog(): Record<string, string> {
  const yaml = (content: unknown): string => `${JSON.stringify(content, null, 2)}\n`;
  const group = (title: string, owns: string[], types: Record<string, string>) =>
    yaml({ title, owns, types });
  const files: Record<string, string> = {
    'package.json': yaml({ name: 'mini-catalog', version: '1.0.0' }),
    'official/cai-supported-asset-types.2026-01-01.txt': [
      '# Cloud Asset Inventory supported asset types, snapshot 2026-01-01',
      FORWARDING_RULE,
      INSTANCE,
      NETWORK,
      SUBNETWORK,
      URL_MAP,
      ZONE,
      DNS_POLICY,
      TOPIC,
      '',
    ].join('\n'),
    'icon-keys.json': yaml({ description: 'Icon keys.', keys: ['compute_engine', 'virtual_private_cloud'] }),
    [`known-unmapped/${FABRIC}.yaml`]: group('Networking fabric', [NETWORK, SUBNETWORK], {}),
    [`known-unmapped/${EDGE}.yaml`]: group('Load balancing and edge', [FORWARDING_RULE, URL_MAP], {
      [URL_MAP]: 'pending (load-balancing-edge)',
    }),
    [`known-unmapped/${DNS}.yaml`]: group('DNS and domains', ['dns.googleapis.com/*'], {
      [ZONE]: 'pending (dns-domains)',
      [DNS_POLICY]: 'pending (dns-domains)',
    }),
    [`known-unmapped/${COMPUTE}.yaml`]: group('Compute', [INSTANCE], {
      [INSTANCE]: 'pending (compute)',
    }),
    [`known-unmapped/${MESSAGING}.yaml`]: group(
      'Data processing and messaging',
      ['pubsub.googleapis.com/*'],
      {
        [TOPIC]: 'pending (data-processing-messaging)',
      },
    ),
    [FABRIC_FILE]: yaml({
      product: 'Compute Engine',
      service: 'compute.googleapis.com',
      icon: 'compute_engine',
      types: {
        [NETWORK]: {
          role: 'container',
          label: '{{data.name}}',
          icon: 'virtual_private_cloud',
          zoneKind: 'vpc',
          contains: ['$.data.subnetworks[*]'],
        },
        [SUBNETWORK]: {
          role: 'container',
          label: '{{data.name}}',
          zoneKind: 'subnet',
          ips: ['$.data.ipCidrRange'],
          relations: [{ kind: 'attaches', to: '$.data.network', normalize: 'computeSelfLink' }],
        },
      },
    }),
    [EDGE_FILE]: yaml({
      product: 'Compute Engine',
      service: 'compute.googleapis.com',
      icon: 'compute_engine',
      types: {
        [FORWARDING_RULE]: {
          role: 'core',
          label: '{{data.name}}',
          ips: ['$.data.IPAddress'],
          relations: [{ kind: 'attaches', to: '$.data.subnetwork', normalize: 'computeSelfLink' }],
        },
      },
    }),
    'fixtures/compute.googleapis.com/Network.json': yaml(
      rawAsset(
        '//compute.googleapis.com/projects/demo-net-1/global/networks/core',
        NETWORK,
        { name: 'core', subnetworks: [`${SELF}/regions/europe-west3/subnetworks/app`] },
        { location: 'global' },
      ),
    ),
    'fixtures/compute.googleapis.com/Subnetwork.json': yaml([
      rawAsset(
        '//compute.googleapis.com/projects/demo-net-1/regions/europe-west3/subnetworks/app',
        SUBNETWORK,
        {
          name: 'app',
          network: `${SELF}/global/networks/core`,
          ipCidrRange: '10.10.0.0/20',
        },
      ),
    ]),
    'fixtures/compute.googleapis.com/ForwardingRule.json': yaml(
      rawAsset(
        '//compute.googleapis.com/projects/demo-net-1/regions/europe-west3/forwardingRules/web',
        FORWARDING_RULE,
        {
          name: 'web',
          IPAddress: '10.10.0.5',
          subnetwork: `${SELF}/regions/europe-west3/subnetworks/app`,
        },
      ),
    ),
  };
  for (const id of LensIdSchema.options) {
    files[`lenses/${id}.yaml`] = yaml({
      title: `Lens ${id}`,
      description: 'A lens.',
      types: ['*'],
      relationKinds: ['contains'],
    });
  }
  return files;
}

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** Writes the clean catalog with some files replaced (a string) or removed (null) to a new directory. */
function catalogWith(changes: Record<string, string | null> = {}): string {
  const root = mkdtempSync(path.join(tmpdir(), 'gcportrait-catalog-cli-'));
  roots.push(root);
  for (const [file, text] of Object.entries({ ...cleanCatalog(), ...changes })) {
    if (text === null) continue;
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  return root;
}

function run(
  script: string,
  args: readonly string[],
  root?: string,
): { status: number | null; stdout: string; stderr: string } {
  const where = root === undefined ? [] : ['--root', root, '--official', path.join(root, 'official')];
  const result = spawnSync(TSX, [path.join(CATALOG_ROOT, 'tooling', script), ...where, ...args], {
    cwd: CATALOG_ROOT,
    encoding: 'utf8',
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function scopedJson(
  root: string,
  group: string,
  ...args: string[]
): { status: number | null; json: ScopedJson } {
  const { status, stdout } = run('check.ts', ['--group', group, '--json', ...args], root);
  return { status, json: JSON.parse(stdout) as ScopedJson };
}

const shown = (violations: readonly Violation[]): string[] =>
  violations.map((violation) => `${violation.code} ${violation.file ?? ''}`);

describe('pnpm catalog:check', () => {
  const clean = catalogWith();

  it('prints the coverage report of the --official list and succeeds on a clean catalog', SLOW, () => {
    const { status, stdout } = run('check.ts', [], clean);
    expect(status).toBe(0);
    expect(stdout).toMatch(/^catalog:check: official list 2026-01-01 \(8 types, /);
    expect(stdout.trimEnd().endsWith('catalog:check: OK.')).toBe(true);
    const json = JSON.parse(run('check.ts', ['--json'], clean).stdout) as CoverageReport;
    expect(json.violations).toEqual([]);
    expect(json.groups.map((group) => group.group)).toEqual([COMPUTE, MESSAGING, DNS, EDGE, FABRIC]);
  });

  it('checks one group with --group: its group file, product files and fixtures', SLOW, () => {
    const { status, json } = scopedJson(clean, EDGE);
    expect(status).toBe(0);
    expect(json.groups.map((group) => group.group)).toEqual([EDGE]);
    expect(json.scope).toEqual({
      groups: [EDGE],
      files: [
        'fixtures/compute.googleapis.com/ForwardingRule.json',
        `known-unmapped/${EDGE}.yaml`,
        EDGE_FILE,
      ],
      outside: 0,
      related: [],
    });
    // The group's file path works as well as its stem.
    const text = run('check.ts', ['--group', `known-unmapped/${EDGE}.yaml`], clean).stdout;
    expect(text).toContain(`group ${EDGE} (3 files); 0 violation(s) elsewhere not shown`);
    expect(text.trimEnd().endsWith(`catalog:check: OK for group ${EDGE}.`)).toBe(true);
    const missing = run('check.ts', ['--group', 'nothing'], clean);
    expect(missing.status).toBe(2);
    expect(missing.stderr).toContain(
      `catalog:check: no group nothing; the groups are: ${COMPUTE}, ${MESSAGING}`,
    );
  });

  it('checks one file with --file, written relative to the catalog or absolute', SLOW, () => {
    for (const file of [FABRIC_FILE, path.join(clean, FABRIC_FILE)]) {
      const { status, stdout } = run('check.ts', ['--file', file, '--json'], clean);
      expect(status).toBe(0);
      expect((JSON.parse(stdout) as ScopedJson).scope?.files).toEqual([FABRIC_FILE]);
    }
    const missing = run('check.ts', ['--file', 'products/nothing.yaml'], clean);
    expect(missing.status).toBe(2);
    expect(missing.stderr).toContain('no catalog file products/nothing.yaml');
  });

  it('prints every rule resolution with --verbose: rule → fixture value → normalised name', SLOW, () => {
    const { status, stdout } = run('check.ts', ['--file', EDGE_FILE, '--verbose'], clean);
    expect(status).toBe(0);
    expect(stdout).toContain(
      `${SELF}/regions/europe-west3/subnetworks/app → //compute.googleapis.com/projects/demo-net-1/regions/europe-west3/subnetworks/app`,
    );
    const json = scopedJson(clean, FABRIC, '--verbose').json;
    expect(json.trace?.map((type) => type.assetType)).toEqual([NETWORK, SUBNETWORK]);
  });
});

describe('a group-scoped check while other groups are mid-edit', () => {
  // Load balancing is half-way through a file of the shared Compute Engine service: not even YAML yet, under
  // a name that does not name its group. DNS has a broken product file and a broken fixture. Messaging maps a
  // type whose rule has no fixture yet, still lists it, and uses an icon key icon-keys.json does not know.
  const midEdit = catalogWith({
    [EDGE_FILE]: null,
    'products/compute.googleapis.com.load-balancing.yaml': [
      'product: Compute Engine',
      'service: compute.googleapis.com',
      'icon: compute_engine',
      'types:',
      `  ${FORWARDING_RULE}:`,
      '    role: core',
      '    relations: [',
      '',
    ].join('\n'),
    'products/dns.googleapis.com.yaml': 'product: Cloud DNS\ntypes: [\n',
    'fixtures/dns.googleapis.com/ManagedZone.json': '{',
    'products/pubsub.googleapis.com.yaml': [
      'product: Pub/Sub',
      'service: pubsub.googleapis.com',
      'icon: pubsub',
      'types:',
      `  ${TOPIC}:`,
      '    role: core',
      '    relations:',
      '      - { kind: encryptedBy, to: $.data.kmsKeyName, normalize: kmsKey }',
      '',
    ].join('\n'),
  });

  it('fails the whole catalog', SLOW, () => {
    const { status, stdout } = run('check.ts', [], midEdit);
    expect(status).toBe(1);
    expect(stdout).toContain('[load] products/compute.googleapis.com.load-balancing.yaml');
    expect(stdout).toContain('[load] products/dns.googleapis.com.yaml');
    expect(stdout).toContain('[rule-without-fixture] products/pubsub.googleapis.com.yaml');
    expect(stdout).toContain(`[known-unmapped-but-mapped] known-unmapped/${MESSAGING}.yaml`);
    // Without --strict-icons an unknown icon key is pending, not a violation.
    expect(stdout).toMatch(/pending icon keys: +1 \(not in icon-keys\.json yet/);
    expect(stdout).not.toContain('[unknown-icon]');
  });

  it(
    'passes for every group whose own files are fine, those sharing Compute Engine with the broken file too',
    SLOW,
    () => {
      for (const group of [FABRIC, COMPUTE]) {
        const { status, stdout } = run('check.ts', ['--group', group], midEdit);
        expect(status, stdout).toBe(0);
        expect(stdout).toMatch(
          new RegExp(`group ${group} \\(\\d+ files?\\); [1-9]\\d* violation\\(s\\) elsewhere not shown`),
        );
        expect(stdout.trimEnd().endsWith(`catalog:check: OK for group ${group}.`)).toBe(true);
      }
    },
  );

  it('shows each broken group its own problems, a file that does not parse included', SLOW, () => {
    // The broken Compute Engine file is load balancing's: it names its ForwardingRule (and its name names no
    // group).
    const edge = scopedJson(midEdit, EDGE);
    expect(edge.status).toBe(1);
    expect(shown(edge.json.violations)).toEqual([
      'load products/compute.googleapis.com.load-balancing.yaml',
      'product-file-group products/compute.googleapis.com.load-balancing.yaml',
    ]);
    const dns = scopedJson(midEdit, DNS);
    expect(dns.status).toBe(1);
    expect(shown(dns.json.violations)).toEqual([
      'load products/dns.googleapis.com.yaml',
      'load fixtures/dns.googleapis.com/ManagedZone.json',
    ]);
    // --strict-icons turns the pending icon key, which the whole-catalog run above only counts, into a violation.
    const messaging = scopedJson(midEdit, MESSAGING, '--strict-icons');
    expect(messaging.status).toBe(1);
    expect(shown(messaging.json.violations)).toEqual([
      `known-unmapped-but-mapped known-unmapped/${MESSAGING}.yaml`,
      'unknown-icon products/pubsub.googleapis.com.yaml',
      'rule-without-fixture products/pubsub.googleapis.com.yaml',
    ]);
    expect(messaging.json.warnings).toEqual([]);
  });
});

describe("a problem blamed on another group's file", () => {
  // Load balancing maps compute's Instance in its own, correctly named file. The problem is load balancing's to
  // fix, so compute's
  // check passes and lists it as a note: the notes reach the output only through check.ts.
  const edgeProduct = JSON.parse(cleanCatalog()[EDGE_FILE] ?? '{}') as { types: Record<string, unknown> };
  edgeProduct.types[INSTANCE] = { role: 'core', label: '{{data.name}}' };
  const root = catalogWith({ [EDGE_FILE]: JSON.stringify(edgeProduct, null, 2) });

  it('is a note for the group it names, in the JSON and the text, and does not fail that group', SLOW, () => {
    const compute = scopedJson(root, COMPUTE);
    expect(compute.status).toBe(0);
    expect(compute.json.violations).toEqual([]);
    expect(shown(compute.json.scope?.related ?? [])).toEqual([`product-file-group ${EDGE_FILE}`]);
    const text = run('check.ts', ['--group', COMPUTE], root);
    expect(text.status).toBe(0);
    expect(text.stdout).toContain('catalog:check: 1 note(s): problems blamed on files outside the selection');
    expect(text.stdout).toContain(`[product-file-group] ${EDGE_FILE}:`);
  });
});

describe('pnpm catalog:coverage', () => {
  const clean = catalogWith();

  it('prints per-group coverage: official, mapped by role, unmapped by reason, missing', SLOW, () => {
    const { status, stdout } = run('coverage.ts', ['--group', EDGE], clean);
    expect(status).toBe(0);
    expect(stdout).toMatch(/^catalog:coverage: official list 2026-01-01/);
    expect(stdout).toContain('2 official · 1 mapped (1 core) · 1 unmapped · 0 missing · 50.0 %');
    expect(stdout).toContain('unmapped, pending (load-balancing-edge): 1');
    expect(stdout).not.toContain('types no group owns');
    expect(stdout).not.toContain(FABRIC); // --group prints that group only
  });

  it('prints every group as JSON, with each unmapped type and its reason', SLOW, () => {
    const { status, stdout } = run('coverage.ts', ['--json'], clean);
    expect(status).toBe(0);
    const output = JSON.parse(stdout) as { groups: GroupCoverage[]; ungrouped: string[] };
    expect(output.groups).toHaveLength(5);
    expect(output.ungrouped).toEqual([]);
    expect(output.groups.find((group) => group.group === EDGE)?.unmapped.types[URL_MAP]).toBe(
      'pending (load-balancing-edge)',
    );
    expect(run('coverage.ts', ['--group', 'nothing'], clean).status).toBe(2);
  });
});

describe('the tools on the real catalog', () => {
  it('read the real data and the newest official snapshot (the data itself: catalog.test.ts)', SLOW, () => {
    // A repository-relative --file works from the real catalog root, against the real official snapshot.
    const scoped = JSON.parse(
      run('check.ts', ['--file', 'packages/catalog/products/k8s.io.yaml', '--json']).stdout,
    ) as ScopedJson;
    expect(scoped.officialList.file).toMatch(
      /^\.agents\/skills\/gcp-asset-catalog\/references\/cai-supported-asset-types\./,
    );
    expect(scoped.scope?.files).toEqual(['products/k8s.io.yaml']);
    // Without --root and --official, `pnpm catalog:coverage` reads the same catalog and official snapshot.
    const coverage = JSON.parse(run('coverage.ts', ['--json']).stdout) as {
      officialList: { file: string };
      groups: GroupCoverage[];
    };
    expect(coverage.officialList.file).toBe(scoped.officialList.file);
    expect(coverage.groups.length).toBeGreaterThan(0);
  });
});
