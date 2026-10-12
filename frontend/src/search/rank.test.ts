// @vitest-environment node
// SPDX-License-Identifier: MIT
/**
 * The search ranking (rank.ts) on hand-made documents: tiers never mix (an exact id beats a fuzzy label), the
 * container boost, IP matches (exact, prefix, inside a range), shown before hidden, word starts, queries of
 * several words, fewer typos next to a better match, limit and total. Synthetic data only (example.com,
 * documentation and private ranges).
 */
import { describe, expect, it } from 'vitest';

import type { SearchDoc } from './documents';
import { CONTAINER_BOOST, createSearchIndex, ipv4, searchIndex } from './rank';

function doc(id: string, fields: Partial<SearchDoc> = {}): SearchDoc {
  return {
    id,
    label: id.slice(id.lastIndexOf('/') + 1),
    displayName: '',
    name: id.slice(id.lastIndexOf('/') + 1),
    assetType: 'compute.googleapis.com/Instance',
    product: 'Compute Engine',
    typeName: 'Compute Engine instance',
    projectId: 'demo-web-1',
    ips: [],
    domains: [],
    ancestors: ['Retail web (prod)', 'Retail'],
    kind: 'resource',
    container: false,
    leaf: false,
    prominent: true,
    hidden: false,
    icon: 'compute_engine',
    ...fields,
  };
}

const VM = '//compute.googleapis.com/projects/demo-web-1/zones/europe-west3-a/instances/web-1';
const PROJECT = '//cloudresourcemanager.googleapis.com/projects/10000000009';

function ids(index: ReturnType<typeof createSearchIndex>, text: string, limit = 20): string[] {
  return searchIndex(index, text, limit).hits.map((hit) => hit.doc.id);
}

describe('searchIndex: tiers', () => {
  it('ranks an exact full name above a fuzzy label match, whatever the boost', () => {
    const index = createSearchIndex([
      // A container whose label is a near miss of the query: fuzzy, boosted.
      doc('//compute.googleapis.com/projects/demo-web-1/global/networks/web-1x', {
        label: 'web-1x',
        kind: 'network',
        container: true,
      }),
      doc(VM, { label: 'frontend VM' }),
    ]);
    const result = searchIndex(index, VM, 10);
    expect(result.hits[0]?.doc.id).toBe(VM);
    expect(result.hits[0]?.tier).toBe('exact');
    expect(result.hits[0]?.field).toBe('id');
    // The last name segment is exact too, and beats the boosted fuzzy container.
    const byName = searchIndex(index, 'WEB-1', 10);
    expect(byName.hits.map((hit) => [hit.doc.label, hit.tier])).toEqual([
      ['frontend VM', 'exact'],
      ['web-1x', 'prefix'],
    ]);
  });

  it('finds a project by its id exactly, and the nodes in it only after it', () => {
    const index = createSearchIndex([
      doc(VM),
      doc(PROJECT, {
        label: 'Retail web (prod)',
        assetType: 'cloudresourcemanager.googleapis.com/Project',
        kind: 'project',
        container: true,
        projectId: 'demo-web-1',
        ancestors: ['Retail'],
      }),
    ]);
    const result = searchIndex(index, 'demo-web-1', 10);
    expect(result.hits.map((hit) => [hit.doc.id, hit.tier, hit.field])).toEqual([
      [PROJECT, 'exact', 'project'],
      [VM, 'fuzzy', 'project'],
    ]);
  });

  it('matches by prefix before fuzzily, and needs two characters to match fuzzily', () => {
    const index = createSearchIndex([doc(VM, { label: 'orders-api' }), doc(`${VM}-2`, { label: 'xorders' })]);
    expect(searchIndex(index, 'orde', 10).hits.map((hit) => hit.tier)).toEqual(['prefix', 'fuzzy']);
    expect(searchIndex(index, 'o', 10).hits.map((hit) => hit.doc.label)).toEqual(['orders-api']);
    expect(searchIndex(index, '   ', 10)).toEqual({ total: 0, hits: [] });
  });

  it('finds display names, domains and the names of the folders and project above a node', () => {
    const index = createSearchIndex([
      doc(VM, { displayName: 'Checkout frontend', domains: ['shop.example.com'] }),
      doc(`${VM}-other`, { ancestors: ['Payments (prod)', 'Payments'] }),
    ]);
    expect(searchIndex(index, 'checkout frontend', 5).hits[0]).toMatchObject({
      tier: 'exact',
      field: 'displayName',
    });
    expect(searchIndex(index, 'shop.example.com', 5).hits[0]).toMatchObject({
      tier: 'exact',
      field: 'domain',
    });
    expect(searchIndex(index, 'payments', 5).hits.map((hit) => [hit.doc.id, hit.field])).toEqual([
      [`${VM}-other`, 'ancestor'],
    ]);
  });
});

describe('searchIndex: the container boost', () => {
  it('lists a container before a resource that matches the same way', () => {
    const index = createSearchIndex([
      doc(`${VM}-a`, { label: 'retail web frontend' }),
      doc(PROJECT, { label: 'retail web frontend', kind: 'project', container: true }),
    ]);
    const result = searchIndex(index, 'retail web', 10);
    expect(result.hits.map((hit) => hit.doc.id)).toEqual([PROJECT, `${VM}-a`]);
    const [container, resource] = result.hits;
    expect(container?.tier).toBe(resource?.tier);
    expect(container?.score).toBeCloseTo((resource?.score ?? 0) * CONTAINER_BOOST, 6);
  });

  it('does not lift a container above a better tier', () => {
    const index = createSearchIndex([
      doc(PROJECT, { label: 'web-frontends', kind: 'project', container: true }),
      doc(VM, { label: 'web' }),
    ]);
    expect(ids(index, 'web')).toEqual([VM, PROJECT]);
  });

  it('ranks a node that equals the query in more fields first, then the types the default lens draws', () => {
    const SQL = '//sqladmin.googleapis.com/projects/demo-svc-1/instances/orders-db';
    const BACKUP =
      '//backupdr.googleapis.com/projects/demo-svc-1/locations/europe-west3/dataSources/ds-orders-db';
    const DISK = '//compute.googleapis.com/projects/demo-vm-1/zones/europe-west3-a/disks/bastion';
    const BASTION = '//compute.googleapis.com/projects/demo-vm-1/zones/europe-west3-a/instances/bastion';
    const index = createSearchIndex([
      doc(BACKUP, { label: 'orders-db' }),
      doc(SQL),
      doc(DISK, { prominent: false }),
      doc(BASTION),
    ]);
    expect(ids(index, 'orders-db')).toEqual([SQL, BACKUP]);
    expect(ids(index, 'bastion')).toEqual([BASTION, DISK]);
  });

  it('puts nodes drawn by default before hidden ones that match equally', () => {
    const index = createSearchIndex([
      doc(`${VM}-h`, { label: 'cache', hidden: true }),
      doc(`${VM}-v`, { label: 'cache' }),
    ]);
    expect(ids(index, 'cache')).toEqual([`${VM}-v`, `${VM}-h`]);
  });
});

describe('searchIndex: IP matches', () => {
  const SUBNET = '//compute.googleapis.com/projects/demo-net-1/regions/europe-west3/subnetworks/web';
  const WIDE = '//compute.googleapis.com/projects/demo-net-1/global/routes/default-route';
  const index = createSearchIndex([
    doc(VM, { ips: ['10.0.14.5', '203.0.113.19'] }),
    doc(SUBNET, { label: 'web', ips: ['10.0.14.0/24', '10.0.14.1'], kind: 'network', container: true }),
    doc(WIDE, { label: 'default-route', ips: ['10.0.0.0/8'] }),
  ]);

  it('lands on the node that has the address, exactly', () => {
    const result = searchIndex(index, '203.0.113.19', 10);
    expect(result.hits[0]).toMatchObject({ tier: 'exact', field: 'ip', value: '203.0.113.19' });
    expect(result.hits[0]?.doc.id).toBe(VM);
  });

  it('lists the ranges that hold an address after the exact match, narrowest first', () => {
    const result = searchIndex(index, '10.0.14.5', 10);
    expect(result.hits.map((hit) => [hit.doc.id, hit.tier])).toEqual([
      [VM, 'exact'],
      [SUBNET, 'range'],
      [WIDE, 'range'],
    ]);
    expect(result.hits[1]?.value).toBe('10.0.14.0/24');
  });

  it('matches the start of an address', () => {
    const result = searchIndex(index, '10.0.14.', 10);
    expect(result.hits.slice(0, 2).map((hit) => hit.tier)).toEqual(['prefix', 'prefix']);
    expect(result.hits.map((hit) => hit.doc.id)).toContain(VM);
  });

  it('reads IPv4 addresses strictly', () => {
    expect(ipv4('10.0.14.5')).toBe(10 * 2 ** 24 + 14 * 256 + 5);
    expect(ipv4('10.0.14')).toBeNull();
    expect(ipv4('10.0.14.256')).toBeNull();
    expect(ipv4('a.b.c.d')).toBeNull();
  });
});

describe('searchIndex: fuzzy fields', () => {
  it('ranks a node by its best field, the label first', () => {
    const index = createSearchIndex([
      doc(`${VM}-ctx`, { label: 'checkout', ancestors: ['Retail web (prod)'], typeName: 'Retail web thing' }),
      doc(PROJECT, { label: 'Retail web (prod)', kind: 'project', container: true }),
    ]);
    const result = searchIndex(index, 'retail web', 10);
    expect(result.hits.map((hit) => [hit.doc.id, hit.field])).toEqual([
      [PROJECT, 'label'],
      [`${VM}-ctx`, 'type'],
    ]);
  });

  it('forgives typos in a label, but takes fewer in context fields', () => {
    const index = createSearchIndex([
      doc(VM, { label: 'bastion' }),
      doc(`${VM}-in`, { label: 'jump-host', ancestors: ['bastion'] }),
    ]);
    // Two errors in seven characters still match a label, not a folder above the node.
    expect(ids(index, 'bastoin')).toEqual([VM]);
    // One error, or spelled right: both match, the label first.
    expect(ids(index, 'bastian')).toEqual([VM, `${VM}-in`]);
    expect(ids(index, 'bastion')).toEqual([VM, `${VM}-in`]);
  });

  it('matches part of a full resource name when the query looks like a path', () => {
    const index = createSearchIndex([doc(VM), doc(`${VM}-2`, { label: 'other' })]);
    const result = searchIndex(index, 'instances/web-1', 10);
    expect(result.hits.map((hit) => [hit.doc.id, hit.tier, hit.field]).sort()).toEqual([
      [VM, 'fuzzy', 'id'],
      [`${VM}-2`, 'fuzzy', 'id'],
    ]);
    // Without a slash, the full name is matched exactly or by its start only.
    expect(searchIndex(index, 'europe-west3-a', 10).total).toBe(0);
  });
});

describe('searchIndex: words', () => {
  const DISK = '//compute.googleapis.com/projects/demo-pay-1/zones/europe-west3-a/disks/frontend-1-boot';
  const PROJECT_FIELDS: Partial<SearchDoc> = {
    label: 'Retail web (prod)',
    name: '10000000009',
    assetType: 'cloudresourcemanager.googleapis.com/Project',
    product: 'Resource Manager',
    typeName: 'Project',
    kind: 'project',
    container: true,
    projectId: 'demo-web-1',
    ancestors: ['Retail'],
  };

  it('matches a word inside a label or a project id by its start, before a match inside a word', () => {
    const COBWEB = '//compute.googleapis.com/projects/demo-x-1/zones/europe-west3-a/instances/cobweb';
    const index = createSearchIndex([
      doc(COBWEB, { label: 'cobweb', projectId: 'demo-x-1', ancestors: [] }),
      doc(VM, { label: 'web-1' }),
      doc(PROJECT, PROJECT_FIELDS),
    ]);
    const result = searchIndex(index, 'web', 10);
    // The project's id has the word "web" (boosted); the VM's label starts with it; "cobweb" only holds it.
    expect(result.hits.map((hit) => [hit.doc.id, hit.tier, hit.field])).toEqual([
      [PROJECT, 'prefix', 'project'],
      [VM, 'prefix', 'label'],
      [COBWEB, 'fuzzy', 'label'],
    ]);
    // A word start inside a field ranks after the same match at the field's start.
    const words = createSearchIndex([doc(VM, { label: 'web-store' }), doc(`${VM}-2`, { label: 'old-web' })]);
    expect(ids(words, 'web')).toEqual([VM, `${VM}-2`]);
  });

  it('finds the nodes that hold every word of a query of several words, in any order', () => {
    const index = createSearchIndex([
      doc(PROJECT, PROJECT_FIELDS),
      doc(VM, { label: 'frontend-1', name: 'frontend-1', ancestors: ['Retail web (prod)', 'Retail'] }),
      doc(DISK, {
        label: 'frontend-1-boot',
        name: 'frontend-1-boot',
        assetType: 'compute.googleapis.com/Disk',
        typeName: 'Compute Engine disk',
        projectId: 'demo-pay-1',
        ancestors: ['Payments (prod)', 'Payments'],
      }),
    ]);
    // Both words in the project's label; the VM holds "web" in its project id and "retail" in a folder above.
    expect(ids(index, 'web retail')).toEqual([PROJECT, VM]);
    // A type name: each word counts in its weightiest field.
    expect(
      searchIndex(index, 'compute instance', 10).hits.map((hit) => [hit.doc.id, hit.tier, hit.field]),
    ).toEqual([[VM, 'fuzzy', 'type']]);
    expect(searchIndex(index, 'frontend payments', 10).hits.map((hit) => [hit.doc.id, hit.field])).toEqual([
      [DISK, 'label'],
    ]);
    expect(searchIndex(index, 'compute nothing', 10).total).toBe(0);
  });

  it('takes one typo only once the query matched a node exactly, by a prefix or in a range', () => {
    const NOTICES =
      '//cloudtasks.googleapis.com/projects/demo-web-1/locations/europe-west3/queues/notifications';
    const index = createSearchIndex([
      doc(VM, { label: 'bastion' }),
      doc(NOTICES, { label: 'notifications' }),
    ]);
    // Two typos inside a longer label are noise next to an exact match …
    expect(ids(index, 'bastion')).toEqual([VM]);
    // … but still count when nothing matches better.
    expect(ids(createSearchIndex([doc(NOTICES, { label: 'notifications' })]), 'bastion')).toEqual([NOTICES]);
    expect(ids(index, 'bastoin')[0]).toBe(VM);
  });
});

describe('searchIndex: limit and total', () => {
  it('counts every match and returns the best `limit`', () => {
    const docs = Array.from({ length: 30 }, (_, n) =>
      doc(`${VM}-${String(n).padStart(2, '0')}`, { label: `batch-${String(n)}` }),
    );
    const result = searchIndex(createSearchIndex(docs), 'batch', 5);
    expect(result.total).toBe(30);
    expect(result.hits).toHaveLength(5);
  });
});
