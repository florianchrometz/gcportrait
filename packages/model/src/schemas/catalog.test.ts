// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { sampleCatalog, sampleCatalogEntry } from '../testing/fixtures.js';
import { issueMessages, issuePaths, present, withChange } from '../testing/issues.js';
import {
  CatalogEntrySchema,
  CatalogRelationKindSchema,
  CatalogSchema,
  CatalogTypeEntrySchema,
  CatalogZoneKindSchema,
  ContainsRuleSchema,
  DEFAULT_LABEL_TEMPLATE,
  JsonPathSchema,
  LensSchema,
  NestsInRuleSchema,
  NormaliserNameSchema,
  PredicateSchema,
  RelationRuleSchema,
  SiblingPatternSchema,
  TEMPLATE_FILTERS,
  TEMPLATE_VARIABLES,
  TemplateSchema,
  type Catalog,
} from './catalog.js';

describe('TemplateSchema', () => {
  it.each([
    'plain text',
    '{{data.name}}',
    '{{data.machineType | lastSegment}} · {{location}}',
    '{{ name|short(12)|lower }}',
    '{{data.disks[0].source | lastSegment}}',
    '{{data.labels.goog-app | lower}}',
    '{{assetType}} {{projectId}}/{{projectNumber}} {{name | projectFromName}} {{name | regionFromName}}',
    '{{name | parentSegment(clusters)}}/{{name|parentSegment(namespaces)}}',
    '{{data.run.location | first(data.gke.cluster, location)}}',
    '{{data.a | first( data.b ) | lower}}',
    '{{data.size | plural(instance)}} · {{location}}',
    '{{data.count | plural( policy , policies )}}',
    '{{data.vmCount | plural(VM)}}',
    'https://console.cloud.google.com/run/detail/{{location}}/{{data.name | lastSegment}}?project={{projectId}}',
  ])('accepts %j', (template) => {
    expect(TemplateSchema.safeParse(template).success).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['an unknown variable', '{{zone}}'],
    ['bare data', '{{data}}'],
    ['an unknown filter', '{{name | upper}}'],
    ['short without a length', '{{name | short}}'],
    ['parentSegment without a collection', '{{name | parentSegment}}'],
    ['parentSegment with a path', '{{name | parentSegment(a/b)}}'],
    ['first without variables', '{{name | first()}}'],
    ['first with a literal', "{{name | first('x')}}"],
    ['first with an unknown variable', '{{name | first(zone)}}'],
    ['plural without a word', '{{data.size | plural}}'],
    ['plural with an empty word', '{{data.size | plural()}}'],
    ['plural with three words', '{{data.size | plural(a, b, c)}}'],
    ['plural with a path', '{{data.size | plural(a/b)}}'],
    ['an unclosed expression', '{{name'],
    ['a stray closing brace pair', 'name}}'],
    ['a single brace', '{name}'],
    ['an empty expression', '{{}}'],
  ])('rejects %s', (_case, template) => {
    expect(TemplateSchema.safeParse(template).success).toBe(false);
  });

  it('names the allowed variables and filters in its message', () => {
    const [message] = issueMessages(TemplateSchema, '{{zone}}');
    for (const word of [...TEMPLATE_VARIABLES, ...TEMPLATE_FILTERS, 'data.*'])
      expect(message).toContain(word);
  });
});

describe('JsonPathSchema and PredicateSchema', () => {
  it.each([
    '$.data.networkInterfaces[*].subnetwork',
    "$.data.metadata.items[?(@.key=='created-by')].value",
    '$[0]',
  ])('accept %j', (path) => {
    expect(JsonPathSchema.safeParse(path).success).toBe(true);
    expect(PredicateSchema.safeParse(path).success).toBe(true);
  });
  it.each(['data.name', '$', '$data', ''])('reject %j', (path) => {
    expect(JsonPathSchema.safeParse(path).success).toBe(false);
    expect(PredicateSchema.safeParse(path).success).toBe(false);
  });
});

describe('NormaliserNameSchema', () => {
  it('lists the normalisers of skill gcp-asset-catalog §5', () => {
    expect(NormaliserNameSchema.options).toEqual([
      'name',
      'computeSelfLink',
      'computeRelative',
      'serviceAccountEmail',
      'gcsUri',
      'bigqueryUri',
      'pubsubUri',
      'kmsKey',
      'cloudSqlConnectionName',
      'artifactImage',
      'projectNumberOrId',
      'k8sOwner',
      'logSinkDestination',
      'siblingName',
      'k8sRef',
    ]);
  });
});

describe('RelationRuleSchema', () => {
  const rule = { kind: 'uses', to: '$.data.disks[*].source', normalize: 'computeSelfLink' };

  it('accepts a rule, with or without weak', () => {
    expect(issuePaths(RelationRuleSchema, rule)).toEqual([]);
    expect(issuePaths(RelationRuleSchema, { ...rule, weak: true })).toEqual([]);
  });

  it('allows versionLevel on the kmsKey normaliser only', () => {
    const cmek = { kind: 'encryptedBy', to: '$.data.kmsKeyName', normalize: 'kmsKey', versionLevel: true };
    expect(issuePaths(RelationRuleSchema, cmek)).toEqual([]);
    expect(issuePaths(RelationRuleSchema, { ...rule, versionLevel: false })).toEqual(['versionLevel']);
  });

  it('allows a target service on the name normaliser only', () => {
    const connector = {
      kind: 'attaches',
      to: '$.data.template.vpcAccess.connector',
      normalize: 'name',
      service: 'vpcaccess.googleapis.com',
    };
    expect(issuePaths(RelationRuleSchema, connector)).toEqual([]);
    expect(issuePaths(RelationRuleSchema, { ...connector, service: 'vpcaccess' })).toEqual(['service']);
    expect(issuePaths(RelationRuleSchema, { ...rule, service: 'compute.googleapis.com' })).toEqual([
      'service',
    ]);
  });

  it('accepts reverse rules, weak ones too', () => {
    const replica = {
      kind: 'replicates',
      to: '$.data.masterInstanceName',
      normalize: 'cloudSqlConnectionName',
      reverse: true,
    };
    expect(issuePaths(RelationRuleSchema, replica)).toEqual([]);
    expect(issuePaths(RelationRuleSchema, { ...replica, weak: true })).toEqual([]);
    expect(issuePaths(RelationRuleSchema, { ...replica, reverse: 'yes' })).toEqual(['reverse']);
  });

  it('requires a pattern for siblingName and allows it nowhere else', () => {
    const sibling = {
      kind: 'routes',
      to: '$.data.serialPipeline.stages[*].targetId',
      normalize: 'siblingName',
      pattern: '{parent}/targets/{id}',
    };
    expect(issuePaths(RelationRuleSchema, sibling)).toEqual([]);
    expect(
      issuePaths(RelationRuleSchema, {
        ...sibling,
        service: 'run.googleapis.com',
        pattern: 'projects/{project}/locations/{.region}/services/{.service}',
      }),
    ).toEqual([]);
    const withoutPattern = { kind: sibling.kind, to: sibling.to, normalize: sibling.normalize };
    expect(issuePaths(RelationRuleSchema, withoutPattern)).toEqual(['pattern']);
    expect(issuePaths(RelationRuleSchema, { ...rule, pattern: '{parent}/disks/{id}' })).toEqual(['pattern']);
  });

  it.each([
    '{parent}/targets/{id}',
    'apps/{projectId}/services/{id}',
    'projects/{.projectId}/global/networks/{.name}',
  ])('accepts the sibling pattern %j', (pattern) => {
    expect(SiblingPatternSchema.safeParse(pattern).success).toBe(true);
  });

  it.each(['', '/projects/{project}', '{parent}//x', 'projects/{tenant}', '{parent}/a b', 'x/{id}-{zone}'])(
    'rejects the sibling pattern %j',
    (pattern) => {
      expect(SiblingPatternSchema.safeParse(pattern).success).toBe(false);
    },
  );

  it('allows k8sKind on the k8sRef normaliser only', () => {
    const node = { kind: 'uses', to: '$.data.spec.nodeName', normalize: 'k8sRef', k8sKind: 'Node' };
    expect(issuePaths(RelationRuleSchema, node)).toEqual([]);
    expect(issuePaths(RelationRuleSchema, { ...node, k8sKind: 'gateway.networking.k8s.io/Gateway' })).toEqual(
      [],
    );
    expect(issuePaths(RelationRuleSchema, { ...node, k8sKind: 'node' })).toEqual(['k8sKind']);
    expect(issuePaths(RelationRuleSchema, { ...rule, k8sKind: 'Node' })).toEqual(['k8sKind']);
  });

  it('never accepts shares, which only the graph builder derives', () => {
    expect(CatalogRelationKindSchema.options).not.toContain('shares');
    expect(issuePaths(RelationRuleSchema, { ...rule, kind: 'shares' })).toEqual(['kind']);
  });

  it.each([
    ['to', { ...rule, to: 'data.disks' }],
    ['normalize', { ...rule, normalize: 'selfLink' }],
    ['weak', { ...rule, weak: 'yes' }],
    ['', { ...rule, target: '$.data' }],
  ])('rejects a bad %s', (path, value) => {
    expect(issuePaths(RelationRuleSchema, value)).toEqual([path]);
  });
});

describe('NestsInRuleSchema', () => {
  it('accepts a reference with an optional fallback kind', () => {
    const pool = { to: '$.data.storagePool', normalize: 'computeSelfLink' };
    expect(issuePaths(NestsInRuleSchema, pool)).toEqual([]);
    expect(issuePaths(NestsInRuleSchema, { ...pool, kind: 'uses' })).toEqual([]);
    expect(issuePaths(NestsInRuleSchema, { ...pool, kind: 'shares' })).toEqual(['kind']);
    expect(issuePaths(NestsInRuleSchema, { ...pool, weak: true })).toEqual(['']);
    expect(issuePaths(NestsInRuleSchema, { ...pool, normalize: 'siblingName' })).toEqual(['pattern']);
  });
});

describe('ContainsRuleSchema', () => {
  it.each(['$.data.subnetworks[*]', { byParent: 'compute.googleapis.com/Subnetwork' }])(
    'accepts %j',
    (value) => {
      expect(ContainsRuleSchema.safeParse(value).success).toBe(true);
    },
  );
  it.each(['subnetworks', { byParent: 'Subnetwork' }, { byType: 'compute.googleapis.com/Subnetwork' }])(
    'rejects %j',
    (value) => {
      expect(ContainsRuleSchema.safeParse(value).success).toBe(false);
    },
  );
});

describe('CatalogTypeEntrySchema', () => {
  it('fills the defaults of a minimal entry', () => {
    expect(CatalogTypeEntrySchema.parse({ role: 'leaf' })).toEqual({
      role: 'leaf',
      label: DEFAULT_LABEL_TEMPLATE,
      ips: [],
      domains: [],
      relations: [],
      contains: [],
    });
  });

  it('gives every entry its own default arrays', () => {
    const a = CatalogTypeEntrySchema.parse({ role: 'leaf' });
    const b = CatalogTypeEntrySchema.parse({ role: 'leaf' });
    expect(a.relations).not.toBe(b.relations);
  });

  it('accepts hiddenWhen as a predicate or null, notes and a deprecation date', () => {
    for (const hiddenWhen of ["$.data.status in ['TERMINATED']", null]) {
      expect(issuePaths(CatalogTypeEntrySchema, { role: 'hidden', hiddenWhen })).toEqual([]);
    }
    expect(
      issuePaths(CatalogTypeEntrySchema, { role: 'leaf', notes: 'v2 shape', deprecated: '2026-10-08' }),
    ).toEqual([]);
  });

  it('accepts a zone kind on containers only', () => {
    for (const zoneKind of CatalogZoneKindSchema.options) {
      expect(issuePaths(CatalogTypeEntrySchema, { role: 'container', zoneKind })).toEqual([]);
    }
    expect(CatalogZoneKindSchema.options).toEqual(['vpc', 'subnet', 'region', 'product', 'group']);
    expect(issuePaths(CatalogTypeEntrySchema, { role: 'core', zoneKind: 'vpc' })).toEqual(['zoneKind']);
    expect(issuePaths(CatalogTypeEntrySchema, { role: 'container', zoneKind: 'folder' })).toEqual([
      'zoneKind',
    ]);
  });

  it('accepts alias paths, and leaves them out when not given', () => {
    expect(CatalogTypeEntrySchema.parse({ role: 'leaf', aliases: ['$.data.email'] }).aliases).toEqual([
      '$.data.email',
    ]);
    expect(CatalogTypeEntrySchema.parse({ role: 'leaf' })).not.toHaveProperty('aliases');
    expect(issuePaths(CatalogTypeEntrySchema, { role: 'leaf', aliases: [] })).toEqual(['aliases']);
    expect(issuePaths(CatalogTypeEntrySchema, { role: 'leaf', aliases: ['data.email'] })).toEqual([
      'aliases.0',
    ]);
  });

  it('stores nestsIn as a list, given one rule or several', () => {
    const group = {
      to: "$.data.metadata.items[?(@.key=='created-by')].value",
      normalize: 'siblingName',
      pattern: '{parent}/instanceGroups/{id}',
    };
    const nodes = { ...group, pattern: 'projects/{project}/zones/{zone}/nodeGroups/{id}' };
    expect(CatalogTypeEntrySchema.parse({ role: 'core', nestsIn: group }).nestsIn).toEqual([group]);
    expect(CatalogTypeEntrySchema.parse({ role: 'core', nestsIn: [group, nodes] }).nestsIn).toEqual([
      group,
      nodes,
    ]);
    expect(CatalogTypeEntrySchema.parse({ role: 'core' })).not.toHaveProperty('nestsIn');
    expect(issuePaths(CatalogTypeEntrySchema, { role: 'core', nestsIn: [] })).toEqual(['nestsIn']);
  });

  it('allows contains rules on containers only', () => {
    const contains = [{ byParent: 'compute.googleapis.com/Subnetwork' }];
    expect(issuePaths(CatalogTypeEntrySchema, { role: 'container', contains })).toEqual([]);
    expect(issuePaths(CatalogTypeEntrySchema, { role: 'core', contains })).toEqual(['contains']);
  });

  it.each([
    ['role', { role: 'zone' }],
    ['label', { role: 'core', label: '{{zone}}' }],
    ['subtitle', { role: 'core', subtitle: '' }],
    ['icon', { role: 'core', icon: 'Cloud Run' }],
    ['console', { role: 'core', console: 'http://console.cloud.google.com/{{name}}' }],
    ['ips.0', { role: 'core', ips: ['data.ip'] }],
    ['domains.0', { role: 'core', domains: ['data.url'] }],
    [
      'relations.0.kind',
      { role: 'core', relations: [{ kind: 'shares', to: '$.data.x', normalize: 'name' }] },
    ],
    ['hiddenWhen', { role: 'core', hiddenWhen: 'status == TERMINATED' }],
    ['notes', { role: 'core', notes: '' }],
    ['deprecated', { role: 'core', deprecated: 'soon' }],
    ['', { role: 'core', relation: [] }],
  ])('rejects a bad %s', (path, value) => {
    expect(issuePaths(CatalogTypeEntrySchema, value)).toEqual([path]);
  });
});

describe('CatalogEntrySchema', () => {
  it('accepts the sample catalog entry', () => {
    expect(issuePaths(CatalogEntrySchema, sampleCatalogEntry())).toEqual([]);
  });

  it.each([
    ['product', { product: '' }],
    ['service', { service: 'compute' }],
    ['icon', { icon: 'Compute Engine' }],
    ['types.Instance', { types: { Instance: { role: 'core' } } }],
    [
      'types.compute.googleapis.com/Disk.role',
      { types: { 'compute.googleapis.com/Disk': { role: 'disk' } } },
    ],
    ['', { category: 'compute' }],
  ])('rejects a bad %s', (path, patch) => {
    expect(issuePaths(CatalogEntrySchema, { ...sampleCatalogEntry(), ...patch })).toEqual([path]);
  });
});

describe('LensSchema', () => {
  const lens = {
    title: 'Serverless',
    description: 'Cloud Run, functions and eventing.',
    types: ['run.googleapis.com/*'],
    relationKinds: ['triggers'],
  };

  it('fills showHidden and defaultDetail', () => {
    expect(LensSchema.parse(lens)).toEqual({ ...lens, showHidden: false, defaultDetail: 'auto' });
  });

  it('accepts exact types, service globs and the everything glob', () => {
    const types = ['run.googleapis.com/Service', 'cloudfunctions.googleapis.com/*', '*'];
    expect(issuePaths(LensSchema, { ...lens, types, showHidden: true, defaultDetail: 'projects' })).toEqual(
      [],
    );
  });

  it.each([
    ['title', { title: '' }],
    ['types', { types: [] }],
    ['types.0', { types: ['run.googleapis.com/S*'] }],
    ['relationKinds.0', { relationKinds: ['flows'] }],
    ['defaultDetail', { defaultDetail: 'everything' }],
    ['', { id: 'serverless' }],
  ])('rejects a bad %s', (path, patch) => {
    expect(issuePaths(LensSchema, { ...lens, ...patch })).toEqual([path]);
  });
});

describe('CatalogSchema', () => {
  const INSTANCE = 'compute.googleapis.com/Instance';
  const NETWORK = 'compute.googleapis.com/Network';

  const catalogWith = (change: (catalog: Catalog) => void): Catalog => withChange(sampleCatalog, change);

  it('accepts a consistent catalog', () => {
    expect(issuePaths(CatalogSchema, sampleCatalog())).toEqual([]);
  });

  it('rejects a product type without a description, or described by another product', () => {
    const missing = catalogWith((c) => {
      present(c.products[0]).types.push('compute.googleapis.com/Disk');
    });
    expect(issuePaths(CatalogSchema, missing)).toEqual(['products.0.types.2']);
    const otherProduct = catalogWith((c) => {
      present(c.types[NETWORK]).product = 'VPC';
    });
    expect(issuePaths(CatalogSchema, otherProduct)).toEqual(['products.0.types.1']);
  });

  it('rejects a type listed twice', () => {
    const catalog = catalogWith((c) => {
      c.products.push({ ...present(c.products[0]), types: [INSTANCE] });
    });
    expect(issuePaths(CatalogSchema, catalog)).toEqual(['products.1.types.0']);
  });

  it('rejects a described type that no product lists, or that is stored under another key', () => {
    const unlisted = catalogWith((c) => {
      present(c.products[0]).types = [INSTANCE];
    });
    expect(issuePaths(CatalogSchema, unlisted)).toEqual([`types.${NETWORK}`]);
    const wrongKey = catalogWith((c) => {
      present(c.types[NETWORK]).assetType = INSTANCE;
    });
    expect(issuePaths(CatalogSchema, wrongKey)).toEqual([`types.${NETWORK}.assetType`]);
  });

  it('requires every lens', () => {
    const catalog = catalogWith((c) => {
      delete (c.lenses as Partial<Catalog['lenses']>).identity;
    });
    expect(issuePaths(CatalogSchema, catalog)).toEqual(['lenses.identity']);
  });

  it('requires the effective icon on every type', () => {
    const catalog = catalogWith((c) => {
      delete (c.types[INSTANCE] as Partial<Catalog['types'][string]>).icon;
    });
    expect(issuePaths(CatalogSchema, catalog)).toEqual([`types.${INSTANCE}.icon`]);
  });

  it.each([
    ['version', { version: 'v1' }],
    ['officialListDate', { officialListDate: '2026-10' }],
    ['', { generatedAt: '2026-10-08' }],
  ])('rejects a bad %s', (path, patch) => {
    expect(issuePaths(CatalogSchema, { ...sampleCatalog(), ...patch })).toEqual([path]);
  });

  it('accepts pre-release versions', () => {
    expect(issuePaths(CatalogSchema, { ...sampleCatalog(), version: '1.2.0-rc.1' })).toEqual([]);
  });
});
