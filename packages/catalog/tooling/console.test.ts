// SPDX-License-Identifier: MIT
/**
 * `consoleUrlFor` and `consoleLinkFor` over the real compiled catalog and the real fixtures: one
 * Cloud Console link per type for 15 types (the first asset of each type's fixture file), the k8s Namespace's
 * cluster through `parentSegment(clusters)`, values percent-encoded, nothing for a missing variable or a type
 * without a template, and the project fallback.
 */
import type { Asset } from '@gcportrait/model';
import { describe, expect, it } from 'vitest';
import {
  catalog,
  CONSOLE_ORIGIN,
  consoleLinkFor,
  consoleUrlFor,
  projectConsoleUrl,
  typesWithoutConsole,
} from '../src/index.js';
import { ctx, firstFixtureOf as fixture } from './real-fixtures.js';

const C = CONSOLE_ORIGIN;
// CASES and SHAPED together hold the 15 types checked here.
const CASES: ReadonlyArray<readonly [string, string]> = [
  [
    'compute.googleapis.com/Instance',
    `${C}/compute/instancesDetail/zones/europe-west3-a/instances/web-7k2p?project=demo-app-1`,
  ],
  [
    'compute.googleapis.com/GlobalForwardingRule',
    `${C}/net-services/loadbalancing/advanced/globalForwardingRules/details/web-https?project=demo-app-1`,
  ],
  ['k8s.io/Namespace', `${C}/kubernetes/namespace/europe-west3/shop/shop/details?project=demo-app-1`],
  [
    'k8s.io/Pod',
    `${C}/kubernetes/pod/europe-west3/shop/shop/frontend-7d9c6b5f4-x2k8p/details?project=demo-app-1`,
  ],
  ['run.googleapis.com/Service', `${C}/run/detail/europe-west3/orders-api/metrics?project=demo-app-1`],
  ['cloudresourcemanager.googleapis.com/Folder', `${C}/cloud-resource-manager?folder=20000000001`],
];

/** Types whose expected link is checked against the template's shape rather than pinned value by value. */
const SHAPED: ReadonlyArray<readonly [string, RegExp]> = [
  [
    'compute.googleapis.com/ForwardingRule',
    /\/advanced\/forwardingRules\/details\/regions\/[a-z0-9-]+\/forwardingRules\/[a-z0-9-]+\?project=demo-[a-z]+-1$/,
  ],
  ['compute.googleapis.com/Network', /\/networking\/networks\/details\/[a-z0-9-]+\?project=demo-[a-z]+-1$/],
  [
    'compute.googleapis.com/Subnetwork',
    /\/networking\/subnetworks\/details\/[a-z0-9-]+\/[a-z0-9-]+\?project=demo-[a-z]+-1$/,
  ],
  [
    'compute.googleapis.com/Disk',
    /\/compute\/disksDetail\/zones\/[a-z0-9-]+\/disks\/[a-z0-9-]+\?project=demo-[a-z]+-1$/,
  ],
  [
    'container.googleapis.com/Cluster',
    /\/kubernetes\/clusters\/details\/[a-z0-9-]+\/[a-z0-9-]+\/details\?project=demo-[a-z]+-1$/,
  ],
  ['sqladmin.googleapis.com/Instance', /\/sql\/instances\/[a-z0-9-]+\/overview\?project=demo-[a-z]+-1$/],
  ['storage.googleapis.com/Bucket', /\/storage\/browser\/[a-z0-9._-]+\?project=demo-[a-z]+-1$/],
  [
    'cloudkms.googleapis.com/KeyRing',
    /\/security\/kms\/keyring\/manage\/[a-z0-9-]+\/[A-Za-z0-9_-]+\/key\?project=demo-[a-z]+-1$/,
  ],
  ['pubsub.googleapis.com/Topic', /\/cloudpubsub\/topic\/detail\/[A-Za-z0-9._-]+\?project=demo-[a-z]+-1$/],
];

describe('consoleUrlFor (the catalog console templates)', () => {
  it.each(CASES)('%s → its console page', (assetType, expected) => {
    expect(consoleUrlFor(fixture(assetType), catalog, ctx)).toBe(expected);
  });

  it.each(SHAPED)('%s → a page of its template’s shape', (assetType, shape) => {
    const url = consoleUrlFor(fixture(assetType), catalog, ctx);
    expect(url).toMatch(new RegExp(`^${C.replace(/[.]/g, '\\.')}/`));
    expect(url).toMatch(shape);
  });

  it('names a Kubernetes namespace’s cluster from its resource name (parentSegment(clusters))', () => {
    const namespace = fixture('k8s.io/Namespace');
    const renamed: Asset = {
      ...namespace,
      name: namespace.name.replace('/clusters/shop/', '/clusters/retail-prod/'),
    };
    expect(consoleUrlFor(renamed, catalog, ctx)).toBe(
      `${C}/kubernetes/namespace/europe-west3/retail-prod/shop/details?project=demo-app-1`,
    );
  });

  it('percent-encodes values, keeps slashes, and resolves the project without the index from the name', () => {
    const vm = fixture('compute.googleapis.com/Instance');
    const odd: Asset = { ...vm, data: { ...(vm.data as object), name: 'a b&c' } };
    expect(consoleUrlFor(odd, catalog, ctx)).toContain('/instances/a%20b%26c?project=demo-app-1');
    // Without the snapshot's index the project id still comes from the Compute name.
    expect(consoleUrlFor(vm, catalog)).toBe(consoleUrlFor(vm, catalog, ctx));
  });

  it('gives nothing for a missing variable, a type without a template or an unknown type', () => {
    const vm = fixture('compute.googleapis.com/Instance');
    expect(consoleUrlFor({ ...vm, data: {} }, catalog, ctx)).toBeUndefined();
    const stripped = {
      types: { ...catalog.types, [vm.assetType]: { ...catalog.types[vm.assetType], console: undefined } },
    } as unknown as typeof catalog;
    expect(consoleUrlFor(vm, stripped, ctx)).toBeUndefined();
    expect(consoleUrlFor({ ...vm, assetType: 'unknown.googleapis.com/Thing' }, catalog, ctx)).toBeUndefined();
  });
});

describe('consoleLinkFor (the action, with its fallback)', () => {
  const vm = fixture('compute.googleapis.com/Instance');

  it('links the resource when its template renders', () => {
    expect(consoleLinkFor(vm, catalog, ctx)).toEqual({
      kind: 'resource',
      url: consoleUrlFor(vm, catalog, ctx),
    });
  });

  it('falls back to the project’s console home when the type has no template', () => {
    const entry = { ...catalog.types[vm.assetType] };
    delete entry.console;
    const stripped = { types: { ...catalog.types, [vm.assetType]: entry } } as unknown as typeof catalog;
    expect(consoleLinkFor(vm, stripped, ctx)).toEqual({
      kind: 'project',
      projectId: 'demo-app-1',
      url: `${C}/home/dashboard?project=demo-app-1`,
    });
    // The project comes from the ancestors through the index too (a v2 name with a project number).
    const run = fixture('run.googleapis.com/Service');
    expect(consoleLinkFor({ ...run, assetType: 'unknown.googleapis.com/Thing' }, catalog, ctx)).toEqual({
      kind: 'project',
      projectId: 'demo-app-1',
      url: projectConsoleUrl('demo-app-1'),
    });
  });

  it('has no action for an asset outside any project without a template', () => {
    const folder = fixture('cloudresourcemanager.googleapis.com/Folder');
    expect(consoleLinkFor({ ...folder, assetType: 'unknown.googleapis.com/Thing' }, catalog, ctx)).toBe(
      undefined,
    );
  });

  it('encodes the project id of the fallback', () => {
    expect(projectConsoleUrl('a b')).toBe(`${C}/home/dashboard?project=a%20b`);
  });
});

describe('typesWithoutConsole', () => {
  it('lists every mapped type without a template, nothing else, sorted, each once', () => {
    const missing = typesWithoutConsole(catalog);
    expect(missing).toEqual([...new Set(missing)].sort());
    expect(missing.filter((assetType) => !(assetType in catalog.types))).toEqual([]);
    const listed = new Set(missing);
    const misjudged = Object.entries(catalog.types)
      .filter(([assetType, type]) => listed.has(assetType) !== (type.console === undefined))
      .map(([assetType]) => assetType);
    expect(misjudged).toEqual([]);
  });
});
