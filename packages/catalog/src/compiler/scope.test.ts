// SPDX-License-Identifier: Apache-2.0
/** scopeReport: the part of a compiled report that `pnpm catalog:check --group/--file` shows. */
import { describe, expect, it } from 'vitest';
import {
  COMPUTE_FILE,
  DNS_GROUP,
  NETWORK,
  NET_GROUP,
  OFFICIAL,
  SUBNETWORK,
  ZONE,
  compile,
  known,
  product,
  scoped,
  show,
  world,
  type World,
} from '../testing/world.js';
import { ScopeError, scopeReport } from './scope.js';
import type { OfficialList } from './types.js';

const COPY_FILE = 'products/compute.googleapis.com.copy.yaml';

describe('scopeReport (--group, --file)', () => {
  /** A world with a second group (DNS) whose product file and fixture are broken mid-edit. */
  function twoGroups(): World {
    const w = world();
    w.groups[DNS_GROUP] = { title: 'DNS', owns: ['dns.googleapis.com/*'], types: {} };
    w.products['products/dns.googleapis.com.yaml'] = {
      product: 'Cloud DNS',
      service: 'dns.googleapis.com',
      icon: 'cloud_dns',
      types: {
        [ZONE]: {
          role: 'core',
          relations: [{ kind: 'attaches', to: '$.data.network', normalize: 'nonsense' }],
        },
      },
    };
    w.fixtures['fixtures/dns.googleapis.com/ManagedZone.json'] = { name: 'not an asset' };
    return w;
  }
  const OFFICIAL_DNS: OfficialList = { ...OFFICIAL, types: new Set([...OFFICIAL.types, ZONE]) };

  it("keeps only the selected group's problems, so a broken other group does not get in the way", () => {
    const w = twoGroups();
    const { report } = compile(w, OFFICIAL_DNS);
    expect(report.violations.length).toBeGreaterThan(0);
    const net = scoped(report, w, 'net');
    expect(net.report.violations).toEqual([]);
    expect(net.outside).toBe(report.violations.length);
    expect(net.files).toEqual([
      'fixtures/compute.googleapis.com/Network.json',
      'fixtures/compute.googleapis.com/Subnetwork.json',
      NET_GROUP,
      COMPUTE_FILE,
    ]);
    expect(net.report.groups.map((g) => g.group)).toEqual(['net']);
    const dns = scoped(report, w, 'dns');
    expect(dns.report.violations).toEqual(report.violations);
    expect(new Set(dns.report.violations.map((v) => v.file))).toEqual(
      new Set(['products/dns.googleapis.com.yaml', 'fixtures/dns.googleapis.com/ManagedZone.json']),
    );
  });

  it('selects single files, lists problems blamed elsewhere that name them as notes, and filters traces', () => {
    const w = world();
    w.products[COPY_FILE] = JSON.parse(JSON.stringify(product(w))) as unknown;
    const { report, trace } = compile(w, OFFICIAL, [], { trace: true });
    const original = scopeReport(report, { groups: [], files: [COMPUTE_FILE] }, known(w), trace);
    // The copy is blamed (the plain file comes first); the original only appears in notes and stays green.
    expect(original.report.violations).toEqual([]);
    expect(show(original.related)).toEqual([`duplicate-type ${COPY_FILE}`, `duplicate-type ${COPY_FILE}`]);
    const copy = scopeReport(report, { groups: [], files: [COPY_FILE] }, known(w));
    expect(copy.report.violations.map((v) => v.code)).toEqual(['duplicate-type', 'duplicate-type']);
    expect(copy.related).toEqual([]);
    expect(original.report.groups.map((g) => g.group)).toEqual(['net']);
    expect(original.trace?.map((type) => type.assetType)).toEqual([NETWORK, SUBNETWORK]);
    const fixture = scopeReport(
      report,
      { groups: [], files: ['fixtures/compute.googleapis.com/Network.json'] },
      known(w),
      trace,
    );
    expect(fixture.report.violations).toEqual([]);
    expect(fixture.trace?.map((type) => type.assetType)).toEqual([NETWORK]);
  });

  it('refuses a group or file that does not exist, naming the groups there are', () => {
    const { report } = compile(world());
    expect(() => scopeReport(report, { groups: ['nope'], files: [] }, new Set())).toThrow(ScopeError);
    expect(() => scopeReport(report, { groups: ['nope'], files: [] }, new Set())).toThrow(
      'the groups are: net',
    );
    expect(() => scopeReport(report, { groups: [], files: ['products/x.yaml'] }, new Set())).toThrow(
      'no catalog file products/x.yaml',
    );
  });
});
