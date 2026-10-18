// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
/**
 * The data worker's side of the search (service.ts, documents.ts) on the demo organisations with the real
 * catalog: the documents (kinds, the organisation left out, the names above a node, icon keys), the answers to
 * the e2e suite's four searches (an IP, a domain, a project id, a label) with their icons, one index per Graph,
 * and the request parsers.
 */
import { catalog } from '@gcportrait/catalog';
import { generateOrganization, toSnapshot } from '@gcportrait/demo-data';
import { buildGraph } from '@gcportrait/graph';
import { DEFAULT_VIEW_SPEC } from '@gcportrait/model';
import { describe, expect, it } from 'vitest';

import { searchDocuments } from './documents';
import {
  answerSearch,
  parseLocateQuery,
  parseSearchQuery,
  searchIndexOf,
  type LoadedSnapshot,
} from './service';

function load(size: 'S' | 'M'): LoadedSnapshot {
  const snapshot = toSnapshot(generateOrganization({ size }));
  return { snapshot, graph: buildGraph(snapshot, catalog) };
}

const S = load('S');
const M = load('M');

describe('searchDocuments', () => {
  const docs = searchDocuments(S.graph, S.snapshot.assets, catalog);
  const byId = new Map(docs.map((doc) => [doc.id, doc]));

  it('has one document per node but the organisation, which is the canvas', () => {
    expect(docs).toHaveLength(Object.keys(S.graph.nodes).length - 1);
    expect(docs.some((doc) => doc.assetType.endsWith('/Organization'))).toBe(false);
  });

  it('gives each node its kind, type name, project, the names above it and its icon key', () => {
    const vm = byId.get(
      '//compute.googleapis.com/projects/demo-web-1/zones/europe-west3-a/instances/web-1mnl',
    );
    expect(vm).toMatchObject({
      kind: 'resource',
      container: false,
      typeName: 'Compute Engine instance',
      projectId: 'demo-web-1',
      name: 'web-1mnl',
      ips: ['10.0.0.2'],
      icon: catalog.types['compute.googleapis.com/Instance']?.icon,
    });
    expect(vm?.ancestors[0]).toBe('Retail web (prod)');
    expect(byId.get('//cloudresourcemanager.googleapis.com/projects/10000000007')).toMatchObject({
      kind: 'project',
      container: true,
      projectId: 'demo-web-1',
    });
    const kinds = new Set(docs.map((doc) => doc.kind));
    expect([...kinds].sort()).toEqual(['container', 'folder', 'network', 'project', 'resource']);
    expect(docs.filter((doc) => doc.kind === 'folder').every((doc) => doc.projectId === '')).toBe(true);
  });
});

describe('answerSearch on demo M (the e2e searches)', () => {
  const top = (text: string) =>
    answerSearch({ snapshot: 'demo:M', day: { tick: null }, text, limit: 20 }, M).hits[0];

  it('lands on the VM with an IP', () => {
    expect(top('10.0.14.5')).toMatchObject({
      id: '//compute.googleapis.com/projects/demo-vm-1/zones/europe-west3-a/instances/bastion',
      tier: 'exact',
      match: { field: 'ip', value: '10.0.14.5' },
    });
  });

  it('lands on the VM with a domain', () => {
    expect(top('bastion.corp.example.com')).toMatchObject({
      label: 'bastion',
      tier: 'exact',
      project: 'demo-vm-1',
    });
  });

  it('lands on the project with its id', () => {
    expect(top('demo-web-1')).toMatchObject({
      id: '//cloudresourcemanager.googleapis.com/projects/10000000009',
      kind: 'project',
      label: 'Retail web (prod)',
      match: { field: 'project', value: 'demo-web-1' },
    });
  });

  it('lands on the Cloud SQL instance with its label', () => {
    const hit = top('orders-db');
    expect(hit?.label).toBe('orders-db');
    expect(hit?.typeName).toMatch(/^Cloud SQL/);
  });

  it('sends the icon of every hit and counts every match', () => {
    const answer = answerSearch({ snapshot: 'demo:M', day: { tick: null }, text: 'web', limit: 5 }, M);
    expect(answer.hits).toHaveLength(5);
    expect(answer.total).toBeGreaterThan(5);
    for (const hit of answer.hits) expect(answer.icons[hit.icon]?.svg).toMatch(/^<svg/);
    expect(answer.text).toBe('web');
  });

  it('builds the index once per Graph; empty text only prepares it', () => {
    const fresh = load('S');
    expect(answerSearch({ snapshot: 'demo:S', day: { tick: null }, text: '  ', limit: 5 }, fresh)).toEqual({
      text: '',
      total: 0,
      hits: [],
      icons: {},
    });
    expect(searchIndexOf(fresh)).toBe(searchIndexOf(fresh));
    expect(searchIndexOf(fresh)).not.toBe(searchIndexOf(S));
  });
});

describe('request parsers', () => {
  it('reads a search query and refuses malformed ones', () => {
    expect(parseSearchQuery({ snapshot: 'demo:M', text: 'web', limit: 20 })).toEqual({
      snapshot: 'demo:M',
      day: { tick: null },
      text: 'web',
      limit: 20,
    });
    // The day on screen: a tick, null for the snapshot's own day (also when absent); malformed refused.
    expect(
      parseSearchQuery({ snapshot: 'demo:M', day: { tick: '2026-09-17' }, text: 'web', limit: 20 })?.day,
    ).toEqual({ tick: '2026-09-17' });
    expect(parseSearchQuery({ snapshot: 'demo:M', day: { tick: '' }, text: 'web', limit: 20 })).toBeNull();
    expect(parseSearchQuery({ snapshot: 'demo:M', day: 'today', text: 'web', limit: 20 })).toBeNull();
    expect(parseSearchQuery({ snapshot: 'nope', text: 'web', limit: 20 })).toBeNull();
    expect(parseSearchQuery({ snapshot: 'demo:M', text: 3, limit: 20 })).toBeNull();
    expect(parseSearchQuery({ snapshot: 'demo:M', text: 'web', limit: 0 })).toBeNull();
    expect(parseSearchQuery(null)).toBeNull();
  });

  it('reads a locate query and refuses malformed ones', () => {
    const spec = { ...DEFAULT_VIEW_SPEC, snapshot: 'demo:M' };
    const small = { width: 1, height: 1 };
    expect(
      parseLocateQuery({ spec, viewport: { width: 1280, height: 624 }, node: 'x', offers: true }),
    ).toEqual({
      spec,
      day: { tick: null },
      viewport: { width: 1280, height: 624 },
      node: 'x',
      offers: true,
    });
    expect(
      parseLocateQuery({ spec, day: { tick: '2026-09-17' }, viewport: small, node: 'x', offers: false }),
    ).toMatchObject({ day: { tick: '2026-09-17' }, offers: false });
    expect(parseLocateQuery({ spec, day: { tick: 7 }, viewport: small, node: 'x', offers: true })).toBeNull();
    expect(
      parseLocateQuery({ spec, viewport: { width: 0, height: 624 }, node: 'x', offers: true }),
    ).toBeNull();
    expect(
      parseLocateQuery({ spec, viewport: { width: 1280, height: 624 }, node: '', offers: true }),
    ).toBeNull();
    expect(parseLocateQuery({ spec: { lens: 3 }, viewport: small, node: 'x', offers: true })).toBeNull();
    // Whether to try the offers is said, as a boolean.
    expect(parseLocateQuery({ spec, viewport: small, node: 'x' })).toBeNull();
    expect(parseLocateQuery({ spec, viewport: small, node: 'x', offers: 'yes' })).toBeNull();
  });
});
