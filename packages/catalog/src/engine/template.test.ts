// SPDX-License-Identifier: Apache-2.0
import { TemplateSchema } from '@gcportrait/model';
import { describe, expect, it } from 'vitest';
import { expectSyntaxError } from '../testing/syntax.js';
import { CatalogSyntaxError } from './syntax.js';
import { lastSegment, parseTemplate, renderDisplay, renderTemplate, type TemplateScope } from './template.js';

const scope: TemplateScope = {
  name: '//compute.googleapis.com/projects/demo-app-1/zones/europe-west3-a/instances/Web-1',
  assetType: 'compute.googleapis.com/Instance',
  location: 'europe-west3-a',
  projectId: 'demo-app-1',
  projectNumber: '10000000002',
  data: {
    name: 'web-1',
    machineType:
      'https://www.googleapis.com/compute/v1/projects/demo-app-1/zones/europe-west3-a/machineTypes/e2-medium/',
    sizeGb: 200,
    deletionProtection: false,
    disks: [{ source: 'projects/demo-app-1/zones/europe-west3-a/disks/web-1-boot' }],
    labels: { 'goog-app': 'Shop' },
    region: 'projects/demo-app-1/regions/europe-west3',
    location: 'projects/demo-app-1/locations/us-central1',
    nested: { list: ['a'] },
    empty: '',
  },
};

const render = (source: string): string => renderTemplate(source, scope).text;

describe('renderTemplate', () => {
  it.each([
    ['plain text', 'plain text'],
    ['{{name}}', scope.name],
    ['{{assetType}}', 'compute.googleapis.com/Instance'],
    ['{{location}}', 'europe-west3-a'],
    ['{{projectId}}/{{projectNumber}}', 'demo-app-1/10000000002'],
    ['{{data.name}}', 'web-1'],
    ['{{data.sizeGb}} GB', '200 GB'],
    ['{{data.deletionProtection}}', 'false'],
    ['{{data.disks[0].source | lastSegment}}', 'web-1-boot'],
    ['{{data.labels.goog-app | lower}}', 'shop'],
    ['{{data.machineType | lastSegment}} · {{location}}', 'e2-medium · europe-west3-a'],
    ['{{name | lastSegment | lower}}', 'web-1'],
    ['{{ name|projectFromName }}', 'demo-app-1'],
    ['{{name | regionFromName}}', 'europe-west3'],
    ['{{data.region | regionFromName}}', 'europe-west3'],
    ['{{data.location | regionFromName}}', 'us-central1'],
    ['{{location | regionFromName}}', 'europe-west3'],
    ['{{assetType | regionFromName}}', ''],
    ['{{data.name | regionFromName}}', 'web-1'],
    ['{{data.name | projectFromName}}', ''],
    ['{{data.name | short(4)}}', 'web…'],
    ['{{data.name | short(5)}}', 'web-1'],
    ['{{data.name | short(1)}}', '…'],
    ['{{name | parentSegment(zones)}}', 'europe-west3-a'],
    ['{{name | parentSegment(projects)}}/{{name | parentSegment(instances)}}', 'demo-app-1/Web-1'],
    ['{{data.disks[0].source | parentSegment(disks)}}', 'web-1-boot'],
    ['{{name | parentSegment(clusters)}}', ''],
  ])('%s', (source, expected) => {
    expect(TemplateSchema.safeParse(source).success).toBe(true);
    expect(render(source)).toBe(expected);
  });

  it('names a parent with parentSegment(collection), the first match in the value', () => {
    const namespace = {
      ...scope,
      name: '//container.googleapis.com/projects/demo-app-1/locations/europe-west3/clusters/shop/k8s/namespaces/web',
    };
    expect(renderTemplate('{{name | parentSegment(clusters)}}', namespace).text).toBe('shop');
    expect(renderTemplate('{{name | parentSegment(namespaces)}}', namespace)).toEqual({
      text: 'web',
      missing: false,
    });
    expect(renderTemplate('{{name | parentSegment(web)}}', namespace).missing).toBe(true);
  });

  it('cuts short(n) at user-perceived characters', () => {
    const text = renderTemplate('{{data.title | short(3)}}', { ...scope, data: { title: 'a👍🏽bcd' } }).text;
    expect(text).toBe('a👍🏽…');
  });

  it('renders missing values as nothing and reports them', () => {
    expect(renderTemplate('{{data.missing}}', scope)).toEqual({ text: '', missing: true });
    expect(renderTemplate('{{data.nested}}', scope)).toEqual({ text: '', missing: true });
    expect(renderTemplate('{{data.nested.list[3]}}', scope)).toEqual({ text: '', missing: true });
    expect(renderTemplate('{{data.disks.x}}', scope)).toEqual({ text: '', missing: true });
    expect(renderTemplate('{{data.empty}}', scope)).toEqual({ text: '', missing: true });
    expect(renderTemplate('{{data.name | projectFromName}}', scope)).toEqual({ text: '', missing: true });
    const bare = { name: '//x.googleapis.com/a', assetType: 'x.googleapis.com/A', data: null };
    expect(renderTemplate('{{location}}{{projectId}}{{projectNumber}}', bare)).toEqual({
      text: '',
      missing: true,
    });
    expect(renderTemplate('x {{name}}', bare)).toEqual({ text: 'x //x.googleapis.com/a', missing: false });
  });

  it('encodes expression values only', () => {
    const encoded = renderTemplate('a b?q={{data.labels.goog-app}}&x={{data.name}}', scope, (value) =>
      encodeURIComponent(value.toUpperCase()),
    );
    expect(encoded.text).toBe('a b?q=SHOP&x=WEB-1');
  });

  it('renders a malformed template as missing, the second time too (the cache-hit path)', () => {
    expect(renderTemplate('{{oops', scope)).toEqual({ text: '', missing: true });
    expect(renderTemplate('{{oops', scope)).toEqual({ text: '', missing: true });
  });

  it('takes the first present variable with first(…) when the value is missing', () => {
    expect(render('{{data.missing | first(data.empty, data.name, location)}}')).toBe('web-1');
    expect(render('{{data.name | first(location)}}')).toBe('web-1');
    expect(render('{{data.missing | first(data.region) | regionFromName}}')).toBe('europe-west3');
    expect(render('{{data.missing | first(data.nested.list[0], data.name) | lower}}')).toBe('a');
    expect(render('{{data.machineType | parentSegment(nodes) | first(location)}}')).toBe('europe-west3-a');
    expect(renderTemplate('{{data.missing | first(data.empty, data.other)}}', scope)).toEqual({
      text: '',
      missing: true,
    });
    expect(TemplateSchema.safeParse('{{data.missing | first(data.name, location)}}').success).toBe(true);
  });
});

describe('plural(word)', () => {
  const counted = (value: unknown, source = '{{data.n | plural(instance)}}'): string =>
    renderDisplay(source, { ...scope, data: { n: value } }).text;

  it('writes the count with its noun: singular for exactly 1, plural otherwise', () => {
    expect(counted(1)).toBe('1 instance');
    expect(counted('1')).toBe('1 instance');
    expect(counted('1.0')).toBe('1.0 instance');
    expect(counted(0)).toBe('0 instances');
    expect(counted(4)).toBe('4 instances');
    expect(counted('12')).toBe('12 instances');
    expect(counted(1, '{{data.n | plural(VM)}}')).toBe('1 VM');
    expect(counted(3, '{{data.n | plural(VM)}}')).toBe('3 VMs');
    expect(counted(2, '{{data.n | plural(policy, policies)}}')).toBe('2 policies');
    expect(counted(1, '{{data.n | plural( policy , policies )}}')).toBe('1 policy');
  });

  it('keeps a missing count missing, so its segment is dropped', () => {
    expect(counted(undefined, '{{data.n | plural(node)}} · {{location}}')).toBe(' europe-west3-a');
    expect(renderTemplate('{{data.n | plural(node)}}', { ...scope, data: {} })).toEqual({
      text: '',
      missing: true,
    });
  });

  it('parses the singular and the plural, and the model grammar accepts both forms', () => {
    expect(parseTemplate('{{data.n | plural(instance)}}').parts[0]).toEqual({
      kind: 'expression',
      variable: 'data',
      dataPath: ['n'],
      filters: [{ name: 'plural', singular: 'instance', plural: 'instances' }],
    });
    expect(parseTemplate('{{data.n | plural(policy, policies)}}').parts[0]).toMatchObject({
      filters: [{ name: 'plural', singular: 'policy', plural: 'policies' }],
    });
    for (const source of ['{{data.n | plural(instance)}}', '{{data.n | plural(policy, policies)}}'])
      expect(TemplateSchema.safeParse(source).success, source).toBe(true);
    expect(() => parseTemplate('{{data.n | plural()}}')).toThrow(CatalogSyntaxError);
    expect(() => parseTemplate('{{data.n | plural(a, b, c)}}')).toThrow(CatalogSyntaxError);
  });
});

describe('renderDisplay (labels and subtitles)', () => {
  const display = (source: string): string => renderDisplay(source, scope).text;

  it('drops a segment whose expressions are all missing, with its unit words', () => {
    expect(display('{{data.missing}} GB · {{location}}')).toBe(' europe-west3-a');
    expect(display('{{data.sizeGb}} GB · {{data.missing}} MB/s per TiB · {{data.name}}')).toBe(
      '200 GB · web-1',
    );
    expect(display('{{data.missing}}–{{data.sizeGb}} replicas')).toBe('–200 replicas');
    expect(display('regional · {{data.missing}} nodes')).toBe('regional ');
    expect(display('Shared VPC {{data.missing}}')).toBe('');
  });

  it('keeps literal segments and reports what was missing', () => {
    expect(renderDisplay('backup · {{data.name}}', scope)).toEqual({
      text: 'backup · web-1',
      missing: false,
    });
    expect(renderDisplay('{{data.missing}} x · y', scope)).toEqual({ text: ' y', missing: true });
    expect(renderDisplay('{{oops', scope)).toEqual({ text: '', missing: true });
  });
});

describe('parseTemplate', () => {
  it('parses first(…) with its alternatives', () => {
    expect(parseTemplate('{{data.a | first(data.b[0], location)}}').parts).toEqual([
      {
        kind: 'expression',
        variable: 'data',
        dataPath: ['a'],
        filters: [
          {
            name: 'first',
            alternatives: [
              { variable: 'data', dataPath: ['b', 0] },
              { variable: 'location', dataPath: [] },
            ],
          },
        ],
      },
    ]);
    expect(() => parseTemplate('{{data.a | first()}}')).toThrow(CatalogSyntaxError);
    expect(() => parseTemplate('{{data.a | first(data.b,)}}')).toThrow(CatalogSyntaxError);
    expect(() => parseTemplate('{{data.a | first(zone)}}')).toThrow(CatalogSyntaxError);
  });

  it('splits text and expressions', () => {
    expect(parseTemplate('id {{data.disks[0].source | lastSegment | short(8)}}!').parts).toEqual([
      { kind: 'text', text: 'id ' },
      {
        kind: 'expression',
        variable: 'data',
        dataPath: ['disks', 0, 'source'],
        filters: [{ name: 'lastSegment' }, { name: 'short', length: 8 }],
      },
      { kind: 'text', text: '!' },
    ]);
  });

  it.each([
    ['a stray brace', 'a } b', 'stray brace'],
    ['a single opening brace', '{name}', 'stray brace'],
    ['an unclosed expression', '{{name', 'unclosed {{'],
    ['an empty expression', '{{ }}', 'empty expression'],
    ['an unknown variable', '{{zone}}', 'unknown variable zone'],
    ['a variable that only starts like data', '{{database}}', 'unknown variable database'],
    ['bare data', '{{data}}', 'data needs at least one'],
    ['a malformed data path', '{{data.a..b}}', 'malformed data path'],
    ['an unknown filter', '{{name | upper}}', 'unknown filter upper'],
    ['short without a length', '{{name | short}}', 'unknown filter short'],
    ['parentSegment without a collection', '{{name | parentSegment}}', 'unknown filter parentSegment'],
    ['parentSegment with a path', '{{name | parentSegment(a/b)}}', 'unknown filter parentSegment(a/b)'],
  ])('rejects %s', (_case, source, message) => {
    expectSyntaxError(parseTemplate, source, message);
  });
});

describe('helpers', () => {
  it.each([
    ['a/b/c', 'c'],
    ['a/b/c/', 'c'],
    ['a/b/c//', 'c'],
    ['plain', 'plain'],
    ['', ''],
  ])('lastSegment(%j) = %j', (value, expected) => {
    expect(lastSegment(value)).toBe(expected);
  });
});

describe('regionFromName', () => {
  // A zone becomes its region by the one rule of @gcportrait/model (`regionOfZone`), AI zones included,
  // whether it stands after `zones/`, after `locations/` or alone.
  it.each([
    ['//compute.googleapis.com/projects/demo-app-1/zones/europe-west3-a/instances/web-1', 'europe-west3'],
    ['//compute.googleapis.com/projects/demo-app-1/zones/us-central1-ai1a/instances/train-1', 'us-central1'],
    ['//compute.googleapis.com/projects/demo-app-1/zones/u-france-east1-b/instances/web-1', 'u-france-east1'],
    ['projects/demo-app-1/regions/europe-west3', 'europe-west3'],
    // A zonal GKE cluster and a TPU node name their zone under `locations/`.
    ['//container.googleapis.com/projects/demo-app-1/locations/europe-west3-a/clusters/c', 'europe-west3'],
    ['//tpu.googleapis.com/projects/demo-app-1/locations/us-central1-ai1a/nodes/train-1', 'us-central1'],
    ['//container.googleapis.com/projects/demo-app-1/locations/europe-west3/clusters/c', 'europe-west3'],
    ['//cloudkms.googleapis.com/projects/demo-app-1/locations/eu/keyRings/k', 'eu'],
    ['//cloudkms.googleapis.com/projects/demo-app-1/locations/global/keyRings/k', 'global'],
    ['us-central1-ai1a', 'us-central1'],
    ['us-central1-f', 'us-central1'],
    ['europe-west3', 'europe-west3'],
    ['nam4', 'nam4'],
    ['EU', 'EU'],
    ['projects/demo-app-1', ''],
  ])('%j → %j', (value, expected) => {
    expect(renderTemplate('{{data.value | regionFromName}}', { ...scope, data: { value } }).text).toBe(
      expected,
    );
  });
});
