// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { cachedPath, evaluateJsonPath, parseJsonPath, selectValues } from './jsonpath.js';
import { expectSyntaxError } from '../testing/syntax.js';

const instance = {
  name: '//compute.googleapis.com/projects/demo-app-1/zones/europe-west3-a/instances/web-1',
  data: {
    name: 'web-1',
    status: 'RUNNING',
    'run.googleapis.com/ingress': 'all',
    networkInterfaces: [
      {
        network: 'https://www.googleapis.com/compute/v1/projects/demo-net-1/global/networks/core',
        subnetwork:
          'https://www.googleapis.com/compute/v1/projects/demo-net-1/regions/europe-west3/subnetworks/app',
        networkIP: '10.10.0.5',
        accessConfigs: [{ natIP: '203.0.113.7' }],
      },
      {
        network: 'https://www.googleapis.com/compute/v1/projects/demo-net-1/global/networks/mgmt',
        networkIP: '10.50.0.5',
      },
    ],
    metadata: {
      items: [
        { key: 'created-by', value: 'projects/10000000002/zones/europe-west3-a/instanceGroupManagers/web' },
        { key: 'startup-script', value: '#!/bin/sh' },
        { key: 'count', value: 3 },
      ],
    },
    labels: { env: 'prod', team: 'shop' },
    empty: null,
  },
};

describe('evaluateJsonPath', () => {
  it.each([
    ['$.data.name', ['web-1']],
    ['$.data.networkInterfaces[*].networkIP', ['10.10.0.5', '10.50.0.5']],
    ['$.data.networkInterfaces[*].accessConfigs[*].natIP', ['203.0.113.7']],
    ['$.data.networkInterfaces[0].networkIP', ['10.10.0.5']],
    ['$.data.networkInterfaces[-1].networkIP', ['10.50.0.5']],
    ['$.data.networkInterfaces[5].networkIP', []],
    ["$.data['run.googleapis.com/ingress']", ['all']],
    ['$.data["run.googleapis.com/ingress"]', ['all']],
    ["$.data.labels['env','team']", ['prod', 'shop']],
    ['$.data.networkInterfaces[1,0].networkIP', ['10.50.0.5', '10.10.0.5']],
    ['$.data.labels.*', ['prod', 'shop']],
    ['$.data.labels[*]', ['prod', 'shop']],
    [
      "$.data.metadata.items[?(@.key=='created-by')].value",
      ['projects/10000000002/zones/europe-west3-a/instanceGroupManagers/web'],
    ],
    ['$.data.metadata.items[?(@.key == "startup-script")].value', ['#!/bin/sh']],
    ['$.data.metadata.items[?(@.value > 2)].key', ['count']],
    [
      "$.data.metadata.items[?(@.key startsWith 'start' || @.key == 'count')].key",
      ['startup-script', 'count'],
    ],
    ['$.data.networkInterfaces[?(@.accessConfigs)].networkIP', ['10.10.0.5']],
    ['$.data.labels[?(@ == "prod")]', ['prod']],
    ['$.data.empty', [null]],
    ['$.data.missing.deeper', []],
    ['$.data.name.length', []],
    ['$.data.labels[0]', []],
    ['$.name', [instance.name]],
  ])('%s', (path, expected) => {
    expect(evaluateJsonPath(path, instance)).toEqual(expected);
  });

  it('selects nothing for a malformed path instead of throwing', () => {
    expect(evaluateJsonPath('$..name', instance)).toEqual([]);
    expect(evaluateJsonPath('data.name', instance)).toEqual([]);
  });

  it('remembers parsed paths, including malformed ones', () => {
    expect(cachedPath('$.data.name')).toBe(cachedPath('$.data.name'));
    expect(cachedPath('$[')).toBeUndefined();
    expect(cachedPath('$[')).toBeUndefined();
  });

  it('reads @ as the current item and $ as the root inside filters', () => {
    const root = { wanted: 'b', items: [{ id: 'a' }, { id: 'b' }] };
    expect(evaluateJsonPath('$.items[?(@.id == "b")].id', root)).toEqual(['b']);
    const path = parseJsonPath('@.id', { allowCurrent: true });
    expect(selectValues(path, root, { id: 'current' })).toEqual(['current']);
  });
});

describe('parseJsonPath', () => {
  it('describes the steps', () => {
    expect(parseJsonPath("$.a[*].b[2]['c d'][0,'e'][?(@.f)]").steps).toEqual([
      { kind: 'key', key: 'a' },
      { kind: 'wildcard' },
      { kind: 'key', key: 'b' },
      { kind: 'index', index: 2 },
      { kind: 'key', key: 'c d' },
      { kind: 'union', members: [0, 'e'] },
      {
        kind: 'filter',
        predicate: {
          kind: 'test',
          path: { source: '@.f', root: '@', steps: [{ kind: 'key', key: 'f' }] },
          test: { op: 'truthy' },
        },
      },
    ]);
  });

  it.each([
    ['no root', 'data.name', 'a path starts with $'],
    ['@ outside a filter', '@.name', 'a path starts with $'],
    ['recursive descent', '$..name', 'recursive descent'],
    ['a slice', '$.items[0:2]', 'slices are not supported'],
    ['an empty name', '$.data.', 'expected a name after .'],
    ['an unclosed bracket', '$.items[0', 'unclosed ['],
    ['empty brackets', '$.items[]', 'empty brackets'],
    ['a script expression', '$.items[(@.length-1)]', 'expected *, an index'],
    ['a bad filter', '$.items[?@.a]', 'a filter must read'],
    ['a bad union separator', "$.items['a' 'b']", 'expected , between union members'],
    ['an unterminated string', "$.items['a]", 'unterminated string'],
    ['a stray character', '$.a b', 'unexpected " "'],
    ['unbalanced brackets', '$.items[0)', 'unbalanced brackets'],
  ])('rejects %s', (_case, source, message) => {
    expectSyntaxError(parseJsonPath, source, message);
  });

  it('names the position of the problem', () => {
    expect(expectSyntaxError(parseJsonPath, '$.data..x', 'recursive descent', 6).source).toBe('$.data..x');
  });

  it('accepts escaped quotes inside quoted keys', () => {
    expect(evaluateJsonPath("$['it\\'s']", { "it's": 1 })).toEqual([1]);
  });
});
