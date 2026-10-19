// SPDX-License-Identifier: Apache-2.0
import {
  CatalogTypeEntrySchema,
  EvaluatedNestingSchema,
  EvaluatedRelationSchema,
  type CatalogTypeEntry,
} from '@gcportrait/model';
import { describe, expect, it } from 'vitest';
import { asset, PROJECTS, RUN_SERVICE } from '../testing/assets.js';
import { EMPTY_PROJECT_INDEX } from './project.js';
import {
  evaluateAliases,
  evaluateContains,
  evaluateNestsIn,
  evaluateRelations,
  extractDomains,
  extractIps,
  hiddenWhenMatches,
  isHiddenByDefault,
  matchesTypePattern,
  nestsByParent,
  renderConsoleUrl,
  renderLabel,
  renderSubtitle,
  serviceOf,
  toDomain,
  toIp,
} from './rules.js';

const ctx = { projects: PROJECTS };
const SELF = 'https://www.googleapis.com/compute/v1/projects';

const INSTANCE = asset(
  '//compute.googleapis.com/projects/demo-app-1/zones/europe-west3-a/instances/web-1',
  'compute.googleapis.com/Instance',
  {
    name: 'web-1',
    status: 'TERMINATED',
    machineType: `${SELF}/demo-app-1/zones/europe-west3-a/machineTypes/e2-medium`,
    networkInterfaces: [
      {
        network: `${SELF}/demo-net-1/global/networks/core`,
        subnetwork: `${SELF}/demo-net-1/regions/europe-west3/subnetworks/app`,
        networkIP: '10.10.0.5',
        accessConfigs: [{ natIP: '203.0.113.7' }],
      },
      {
        network: `${SELF}/demo-net-1/global/networks/core`,
        subnetwork: `${SELF}/demo-net-1/regions/europe-west3/subnetworks/app`,
        networkIP: '10.10.0.6',
      },
    ],
    disks: [
      { source: `${SELF}/demo-app-1/zones/europe-west3-a/disks/web-1` },
      { source: null },
      { source: '' },
    ],
    serviceAccounts: [{ email: 'web@demo-app-1.iam.gserviceaccount.com' }],
    metadata: {
      items: [
        { key: 'created-by', value: 'projects/10000000002/zones/europe-west3-a/instanceGroupManagers/web' },
      ],
    },
    selfLinks: [`${SELF}/demo-app-1/zones/europe-west3-a/instances/web-1`],
    oddValues: [{ not: 'a reference' }, 'nonsense'],
  },
  { location: 'europe-west3-a' },
);

function entry(fields: Record<string, unknown>): CatalogTypeEntry {
  return CatalogTypeEntrySchema.parse({ role: 'core', ...fields });
}

describe('evaluateRelations', () => {
  const instanceEntry = entry({
    relations: [
      { kind: 'attaches', to: '$.data.networkInterfaces[*].subnetwork', normalize: 'computeSelfLink' },
      {
        kind: 'attaches',
        to: '$.data.networkInterfaces[*].network',
        normalize: 'computeSelfLink',
        weak: true,
      },
      { kind: 'uses', to: '$.data.disks[*].source', normalize: 'computeSelfLink' },
      { kind: 'runsAs', to: '$.data.serviceAccounts[*].email', normalize: 'serviceAccountEmail' },
      {
        kind: 'memberOf',
        to: "$.data.metadata.items[?(@.key=='created-by')].value",
        normalize: 'computeRelative',
      },
      { kind: 'uses', to: '$.data.selfLinks[*]', normalize: 'computeSelfLink' },
      { kind: 'uses', to: '$.data.oddValues[*]', normalize: 'computeSelfLink' },
    ],
  });

  it('normalises every value, de-duplicates, drops self-references and keeps what it cannot resolve', () => {
    const relations = evaluateRelations(INSTANCE, instanceEntry, ctx);
    for (const relation of relations) EvaluatedRelationSchema.parse(relation);
    expect(relations).toEqual([
      {
        kind: 'attaches',
        rule: 0,
        raw: `${SELF}/demo-net-1/regions/europe-west3/subnetworks/app`,
        target: {
          by: 'name',
          name: '//compute.googleapis.com/projects/demo-net-1/regions/europe-west3/subnetworks/app',
        },
      },
      {
        kind: 'attaches',
        rule: 1,
        raw: `${SELF}/demo-net-1/global/networks/core`,
        target: { by: 'name', name: '//compute.googleapis.com/projects/demo-net-1/global/networks/core' },
        weak: true,
      },
      {
        kind: 'uses',
        rule: 2,
        raw: `${SELF}/demo-app-1/zones/europe-west3-a/disks/web-1`,
        target: {
          by: 'name',
          name: '//compute.googleapis.com/projects/demo-app-1/zones/europe-west3-a/disks/web-1',
        },
      },
      {
        kind: 'runsAs',
        rule: 3,
        raw: 'web@demo-app-1.iam.gserviceaccount.com',
        target: { by: 'alias', alias: 'web@demo-app-1.iam.gserviceaccount.com' },
      },
      {
        kind: 'memberOf',
        rule: 4,
        raw: 'projects/10000000002/zones/europe-west3-a/instanceGroupManagers/web',
        target: {
          by: 'name',
          name: '//compute.googleapis.com/projects/demo-app-1/zones/europe-west3-a/instanceGroupManagers/web',
        },
      },
      { kind: 'uses', rule: 6, raw: '{"not":"a reference"}' },
      { kind: 'uses', rule: 6, raw: 'nonsense' },
    ]);
  });

  it('makes a relation strong when a strong rule repeats a weak one', () => {
    const repeated = entry({
      relations: [
        {
          kind: 'attaches',
          to: '$.data.networkInterfaces[*].network',
          normalize: 'computeSelfLink',
          weak: true,
        },
        { kind: 'attaches', to: '$.data.networkInterfaces[0].network', normalize: 'computeSelfLink' },
        {
          kind: 'attaches',
          to: '$.data.networkInterfaces[1].network',
          normalize: 'computeSelfLink',
          weak: true,
        },
      ],
    });
    expect(evaluateRelations(INSTANCE, repeated, ctx)).toEqual([
      {
        kind: 'attaches',
        rule: 0,
        raw: `${SELF}/demo-net-1/global/networks/core`,
        target: { by: 'name', name: '//compute.googleapis.com/projects/demo-net-1/global/networks/core' },
      },
    ]);
  });

  it('resolves relative names in the asset service unless the rule names another', () => {
    const service = asset(RUN_SERVICE.name, RUN_SERVICE.assetType, {
      template: {
        vpcAccess: { connector: 'projects/demo-app-1/locations/europe-west3/connectors/main' },
        volumes: [{ secret: { secret: 'projects/demo-app-1/secrets/db' } }],
      },
    });
    const relations = evaluateRelations(
      service,
      entry({
        relations: [
          {
            kind: 'attaches',
            to: '$.data.template.vpcAccess.connector',
            normalize: 'name',
            service: 'vpcaccess.googleapis.com',
          },
          { kind: 'uses', to: '$.data.template.volumes[*].secret.secret', normalize: 'name' },
        ],
      }),
      ctx,
    );
    expect(relations.map((relation) => relation.target)).toEqual([
      {
        by: 'name',
        name: '//vpcaccess.googleapis.com/projects/demo-app-1/locations/europe-west3/connectors/main',
      },
      { by: 'name', name: '//run.googleapis.com/projects/demo-app-1/secrets/db' },
    ]);
  });

  it('keeps a key version only with versionLevel', () => {
    const key = 'projects/demo-sec-1/locations/europe-west3/keyRings/data/cryptoKeys/ca/cryptoKeyVersions/1';
    const subject = asset(RUN_SERVICE.name, RUN_SERVICE.assetType, { key });
    const rule = { kind: 'encryptedBy', to: '$.data.key', normalize: 'kmsKey' };
    expect(evaluateRelations(subject, entry({ relations: [rule] }), ctx)[0]?.target).toEqual({
      by: 'name',
      name: '//cloudkms.googleapis.com/projects/demo-sec-1/locations/europe-west3/keyRings/data/cryptoKeys/ca',
    });
    expect(
      evaluateRelations(subject, entry({ relations: [{ ...rule, versionLevel: true }] }), ctx)[0]?.target,
    ).toEqual({
      by: 'name',
      name: `//cloudkms.googleapis.com/${key}`,
    });
  });

  it('marks reverse rules and keeps a reverse relation apart from a forward one', () => {
    const both = entry({
      relations: [
        { kind: 'uses', to: '$.data.disks[*].source', normalize: 'computeSelfLink' },
        {
          kind: 'uses',
          to: '$.data.disks[*].source',
          normalize: 'computeSelfLink',
          reverse: true,
          weak: true,
        },
        { kind: 'uses', to: '$.data.disks[*].source', normalize: 'computeSelfLink', reverse: true },
      ],
    });
    const disk = {
      by: 'name',
      name: '//compute.googleapis.com/projects/demo-app-1/zones/europe-west3-a/disks/web-1',
    };
    const relations = evaluateRelations(INSTANCE, both, ctx);
    for (const relation of relations) EvaluatedRelationSchema.parse(relation);
    expect(relations).toEqual([
      { kind: 'uses', rule: 0, raw: `${SELF}/demo-app-1/zones/europe-west3-a/disks/web-1`, target: disk },
      {
        kind: 'uses',
        rule: 1,
        raw: `${SELF}/demo-app-1/zones/europe-west3-a/disks/web-1`,
        target: disk,
        reverse: true,
      },
    ]);
  });

  it('passes sibling patterns and Kubernetes kinds to the normalisers', () => {
    const pipeline = asset(
      '//clouddeploy.googleapis.com/projects/demo-app-1/locations/europe-west3/deliveryPipelines/web',
      'clouddeploy.googleapis.com/DeliveryPipeline',
      { serialPipeline: { stages: [{ targetId: 'staging' }, { targetId: 'prod' }] } },
    );
    const stages = entry({
      relations: [
        {
          kind: 'routes',
          to: '$.data.serialPipeline.stages[*].targetId',
          normalize: 'siblingName',
          pattern: '{parent}/targets/{id}',
        },
      ],
    });
    expect(evaluateRelations(pipeline, stages, ctx).map((r) => r.target)).toEqual([
      {
        by: 'name',
        name: '//clouddeploy.googleapis.com/projects/demo-app-1/locations/europe-west3/targets/staging',
      },
      {
        by: 'name',
        name: '//clouddeploy.googleapis.com/projects/demo-app-1/locations/europe-west3/targets/prod',
      },
    ]);
    const cluster = '//container.googleapis.com/projects/demo-app-1/locations/europe-west3/clusters/shop/k8s';
    const pod = asset(`${cluster}/namespaces/shop/pods/web-1`, 'k8s.io/Pod', {
      spec: { nodeName: 'node-1' },
    });
    const onNode = entry({
      relations: [{ kind: 'uses', to: '$.data.spec.nodeName', normalize: 'k8sRef', k8sKind: 'Node' }],
    });
    expect(evaluateRelations(pod, onNode, ctx).map((r) => r.target)).toEqual([
      { by: 'name', name: `${cluster}/nodes/node-1` },
    ]);
  });

  it('returns nothing for an unknown type or a type without rules', () => {
    expect(evaluateRelations(INSTANCE, undefined, ctx)).toEqual([]);
    expect(evaluateRelations(INSTANCE, entry({}), ctx)).toEqual([]);
  });
});

describe('evaluateContains and nestsByParent', () => {
  const network = asset(
    '//compute.googleapis.com/projects/demo-net-1/global/networks/core',
    'compute.googleapis.com/Network',
    {
      subnetworks: [
        `${SELF}/demo-net-1/regions/europe-west3/subnetworks/app`,
        `${SELF}/demo-net-1/regions/europe-west3/subnetworks/app`,
        'projects/demo-net-1/regions/europe-west3/subnetworks/gke',
        null,
        'garbage',
      ],
    },
  );
  const networkEntry = CatalogTypeEntrySchema.parse({
    role: 'container',
    contains: [
      '$.data.subnetworks[*]',
      { byParent: 'compute.googleapis.com/Subnetwork' },
      { byParent: 'compute.googleapis.com/Subnetwork' },
    ],
  });

  it('reads child names from the data and lists the byParent types once', () => {
    expect(evaluateContains(network, networkEntry, ctx)).toEqual({
      names: [
        {
          by: 'name',
          name: '//compute.googleapis.com/projects/demo-net-1/regions/europe-west3/subnetworks/app',
        },
        {
          by: 'name',
          name: '//compute.googleapis.com/projects/demo-net-1/regions/europe-west3/subnetworks/gke',
        },
      ],
      byParent: ['compute.googleapis.com/Subnetwork'],
    });
    expect(evaluateContains(network, undefined, ctx)).toEqual({ names: [], byParent: [] });
  });

  it('nests by parent or by name prefix, never by a mere common prefix', () => {
    const instance = { name: '//spanner.googleapis.com/projects/demo-data-1/instances/ledger' };
    expect(nestsByParent({ name: `${instance.name}/databases/main` }, instance)).toBe(true);
    expect(nestsByParent({ name: '//x.googleapis.com/a', parent: instance.name }, instance)).toBe(true);
    expect(nestsByParent({ name: `${instance.name}-eu/databases/main` }, instance)).toBe(false);
    expect(nestsByParent({ name: instance.name }, instance)).toBe(false);
  });
});

describe('evaluateAliases', () => {
  const account = asset(
    '//iam.googleapis.com/projects/demo-app-1/serviceAccounts/10000000000000000001',
    'iam.googleapis.com/ServiceAccount',
    {
      email: ' Web@Demo-App-1.iam.gserviceaccount.com ',
      others: ['web@demo-app-1.iam.gserviceaccount.com', 'two words', '', 42, null],
    },
  );

  it('reads alias keys through the aliases paths, as the serviceAccountEmail normaliser writes them', () => {
    const keys = evaluateAliases(account, entry({ aliases: ['$.data.email', '$.data.others[*]'] }));
    expect(keys).toEqual(['web@demo-app-1.iam.gserviceaccount.com']);
    const target = evaluateRelations(
      RUN_SERVICE,
      entry({ relations: [{ kind: 'runsAs', to: '$.data.sa', normalize: 'serviceAccountEmail' }] }),
      ctx,
    );
    expect(target).toEqual([]);
    const runsAs = evaluateRelations(
      asset(RUN_SERVICE.name, RUN_SERVICE.assetType, { sa: 'WEB@demo-app-1.iam.gserviceaccount.com' }),
      entry({ relations: [{ kind: 'runsAs', to: '$.data.sa', normalize: 'serviceAccountEmail' }] }),
      ctx,
    );
    expect(runsAs.map((relation) => relation.target)).toEqual([{ by: 'alias', alias: keys[0] }]);
  });

  it('reads nothing without aliases paths or an entry', () => {
    expect(evaluateAliases(account, entry({}))).toEqual([]);
    expect(evaluateAliases(account, undefined)).toEqual([]);
  });
});

describe('evaluateNestsIn', () => {
  it('names the containers in rule order, each once, with the fallback kind', () => {
    const nests = entry({
      nestsIn: [
        {
          to: "$.data.metadata.items[?(@.key=='created-by')].value",
          normalize: 'siblingName',
          pattern: '{parent}/instanceGroups/{id}',
          kind: 'memberOf',
        },
        { to: '$.data.oddValues[*]', normalize: 'computeSelfLink' },
        {
          to: "$.data.metadata.items[?(@.key=='created-by')].value",
          normalize: 'siblingName',
          pattern: '{parent}/instanceGroups/{id}',
        },
      ],
    });
    const nestings = evaluateNestsIn(INSTANCE, nests, ctx);
    for (const nesting of nestings) EvaluatedNestingSchema.parse(nesting);
    expect(nestings).toEqual([
      {
        rule: 0,
        raw: 'projects/10000000002/zones/europe-west3-a/instanceGroupManagers/web',
        target: {
          by: 'name',
          name: '//compute.googleapis.com/projects/10000000002/zones/europe-west3-a/instanceGroups/web',
        },
        kind: 'memberOf',
      },
      { rule: 1, raw: '{"not":"a reference"}' },
      { rule: 1, raw: 'nonsense' },
    ]);
    expect(evaluateNestsIn(INSTANCE, entry({}), ctx)).toEqual([]);
    expect(evaluateNestsIn(INSTANCE, undefined, ctx)).toEqual([]);
  });

  it('drops a reference to the asset itself', () => {
    const self = entry({ nestsIn: { to: '$.data.selfLinks[*]', normalize: 'computeSelfLink' } });
    expect(evaluateNestsIn(INSTANCE, self, ctx)).toEqual([]);
  });
});

describe('isHiddenByDefault', () => {
  it('hides the hidden role and assets matching hiddenWhen', () => {
    expect(isHiddenByDefault(INSTANCE, entry({ role: 'hidden' }))).toBe(true);
    expect(isHiddenByDefault(INSTANCE, entry({ hiddenWhen: "$.data.status in ['TERMINATED']" }))).toBe(true);
    expect(isHiddenByDefault(INSTANCE, entry({ hiddenWhen: "$.data.status == 'RUNNING'" }))).toBe(false);
    expect(isHiddenByDefault(INSTANCE, entry({ hiddenWhen: null }))).toBe(false);
    expect(isHiddenByDefault(INSTANCE, entry({}))).toBe(false);
    expect(isHiddenByDefault(INSTANCE, undefined)).toBe(false);
  });

  it('tells whether hiddenWhen matched, whatever the role', () => {
    const terminated = "$.data.status in ['TERMINATED']";
    expect(hiddenWhenMatches(INSTANCE, entry({ role: 'hidden', hiddenWhen: terminated }))).toBe(true);
    expect(hiddenWhenMatches(INSTANCE, entry({ role: 'hidden' }))).toBe(false);
    expect(hiddenWhenMatches(INSTANCE, entry({ hiddenWhen: "$.data.status == 'RUNNING'" }))).toBe(false);
    expect(hiddenWhenMatches(INSTANCE, undefined)).toBe(false);
  });
});

describe('labels, subtitles and console links', () => {
  it('renders the label template, tidying separators', () => {
    expect(renderLabel(INSTANCE, entry({ label: '{{data.name}}' }), ctx)).toBe('web-1');
    expect(renderLabel(INSTANCE, entry({}), ctx)).toBe('web-1');
    expect(renderLabel(INSTANCE, entry({ label: ' {{data.missing}} · {{data.name}} · ' }), ctx)).toBe(
      'web-1',
    );
  });

  it('falls back to displayName, the data name and the asset name', () => {
    const named = (data: unknown) =>
      asset('//x.googleapis.com/projects/demo-app-1/things/thing-1', 'x.googleapis.com/Thing', data);
    const missing = entry({ label: '{{data.missing}}' });
    expect(renderLabel(named({ displayName: ' Thing One ' }), missing, ctx)).toBe('Thing One');
    expect(renderLabel(named({ name: 'projects/demo-app-1/things/thing-one' }), missing, ctx)).toBe(
      'thing-one',
    );
    expect(renderLabel(named({ name: '' }), undefined, ctx)).toBe('thing-1');
    expect(renderLabel(named(null), undefined, ctx)).toBe('thing-1');
    expect(renderLabel(named(['a']), undefined, ctx)).toBe('thing-1');
    const slashed = asset('//x.googleapis.com/', 'x.googleapis.com/Thing', {});
    expect(renderLabel(slashed, undefined, ctx)).toBe('x.googleapis.com');
  });

  it('renders subtitles and drops empty ones', () => {
    const subtitle = entry({
      subtitle: '{{data.machineType | lastSegment}} · {{location}} · {{data.missing}}',
    });
    expect(renderSubtitle(INSTANCE, subtitle, ctx)).toBe('e2-medium · europe-west3-a');
    expect(renderSubtitle(INSTANCE, entry({ subtitle: '{{data.missing}}' }), ctx)).toBeUndefined();
    expect(
      renderSubtitle(
        INSTANCE,
        entry({ subtitle: '{{data.missing}} GB · {{location}} · {{data.gone}} nodes' }),
        ctx,
      ),
    ).toBe('europe-west3-a');
    expect(
      renderSubtitle(INSTANCE, entry({ subtitle: 'Shared VPC {{data.missing | lower}}' }), ctx),
    ).toBeUndefined();
    expect(renderSubtitle(INSTANCE, entry({}), ctx)).toBeUndefined();
    expect(renderSubtitle(INSTANCE, undefined, ctx)).toBeUndefined();
  });

  it('renders console links with encoded values and refuses broken ones', () => {
    const link = entry({
      console:
        'https://console.cloud.google.com/compute/instancesDetail/zones/{{location}}/instances/{{data.name}}?project={{projectId}}',
    });
    expect(renderConsoleUrl(INSTANCE, link, ctx)).toBe(
      'https://console.cloud.google.com/compute/instancesDetail/zones/europe-west3-a/instances/web-1?project=demo-app-1',
    );
    const odd = asset(INSTANCE.name, INSTANCE.assetType, { name: 'a b&c/d' });
    expect(renderConsoleUrl(odd, entry({ console: 'https://example.com/{{data.name}}' }), ctx)).toBe(
      'https://example.com/a%20b%26c/d',
    );
    expect(
      renderConsoleUrl(INSTANCE, entry({ console: 'https://example.com/{{data.missing}}' }), ctx),
    ).toBeUndefined();
    expect(renderConsoleUrl(INSTANCE, link, { projects: EMPTY_PROJECT_INDEX })).toContain(
      'project=demo-app-1',
    );
    expect(renderConsoleUrl(INSTANCE, entry({}), ctx)).toBeUndefined();
    expect(renderConsoleUrl(INSTANCE, undefined, ctx)).toBeUndefined();
  });
});

describe('extractIps and extractDomains', () => {
  it('reads addresses and ranges, dropping ports, paths and junk', () => {
    const subject = asset(RUN_SERVICE.name, RUN_SERVICE.assetType, {
      values: [
        '10.10.0.5',
        '10.10.0.0/20',
        '10.10.0.5',
        '203.0.113.7:443',
        '10.40.0.2@tcp:/lustrefs',
        'http://10.12.0.9:8080/healthz',
        '[2001:DB8::1]:443',
        '2001:db8::/32',
        'fd00::1',
        '999.1.1.1',
        'not an ip',
        42,
        'https://[2001:db8::2]/x',
        'ftp://',
      ],
    });
    expect(extractIps(subject, entry({ ips: ['$.data.values[*]'] }))).toEqual([
      '10.10.0.5',
      '10.10.0.0/20',
      '203.0.113.7',
      '10.40.0.2',
      '10.12.0.9',
      '2001:db8::1',
      '2001:db8::/32',
      'fd00::1',
      '2001:db8::2',
    ]);
    expect(extractIps(subject, undefined)).toEqual([]);
  });

  it('reads host names, taking the host from URLs', () => {
    const subject = asset(RUN_SERVICE.name, RUN_SERVICE.assetType, {
      values: [
        'https://shop-abc123-ew.a.run.app',
        'https://git.example.org/data/warehouse.git',
        'Shop.Example.org.',
        'api.example.org:8443',
        'shop.example.org/path',
        '*.example.org',
        'shop.example.org',
        '10.10.0.5',
        'localhost',
        'https://user@internal.example.org:9000/x',
        'gs://demo-logs-1/x',
        'bad_host!.example.org',
        null,
      ],
    });
    expect(extractDomains(subject, entry({ domains: ['$.data.values[*]'] }))).toEqual([
      'shop-abc123-ew.a.run.app',
      'git.example.org',
      'shop.example.org',
      'api.example.org',
      '*.example.org',
      'internal.example.org',
    ]);
    expect(extractDomains(subject, undefined)).toEqual([]);
  });

  it('converts single values', () => {
    expect(toIp('10.0.0.1')).toBe('10.0.0.1');
    expect(toIp(null)).toBeUndefined();
    expect(toDomain('https://')).toBeUndefined();
    expect(toDomain(7)).toBeUndefined();
  });
});

describe('small helpers', () => {
  it('takes the service from an asset type, or the whole string without a slash', () => {
    expect(serviceOf('compute.googleapis.com/Network')).toBe('compute.googleapis.com');
    expect(serviceOf('k8s.io/Namespace')).toBe('k8s.io');
    expect(serviceOf('nothing')).toBe('nothing');
  });

  it.each([
    ['*', 'compute.googleapis.com/Network', true],
    ['compute.googleapis.com/*', 'compute.googleapis.com/Network', true],
    ['compute.googleapis.com/*', 'container.googleapis.com/Cluster', false],
    ['k8s.io/*', 'apps.k8s.io/Deployment', false],
    ['compute.googleapis.com/Network', 'compute.googleapis.com/Network', true],
    ['compute.googleapis.com/Network', 'compute.googleapis.com/Subnetwork', false],
  ])('matchesTypePattern(%s, %s) = %s', (pattern, assetType, expected) => {
    expect(matchesTypePattern(pattern, assetType)).toBe(expected);
  });
});
