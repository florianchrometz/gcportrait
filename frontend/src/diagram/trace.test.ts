// SPDX-License-Identifier: Apache-2.0
import type { RelationKind } from '@gcportrait/model';
import { describe, expect, it } from 'vitest';

import { buildDiagramModel } from './model';
import { modelOf, smallScene, TRACE_EDGES } from './testing/scenes';
import { computeTrace, TRACE_HOPS, traceIndex, type TraceEdge, type TraceIndex } from './trace';

const key = (from: string, kind: RelationKind, to: string): string => `${from} -${kind}-> ${to}`;

/** An index from a parent table and `[from, kind, to]` lines. */
function indexOf(
  parents: Record<string, string | null>,
  lines: ReadonlyArray<readonly [string, RelationKind, string]>,
): TraceIndex {
  const edges: TraceEdge[] = lines.map(([from, kind, to]) => ({ key: key(from, kind, to), from, to, kind }));
  return traceIndex(new Map(Object.entries(parents)), edges);
}

/**
 * A load balancer in a project, the way demo M draws one: forwarding rule → proxy → URL map → two backend
 * services → an instance group (an open zone with two VMs) and a serverless NEG → a Cloud Run service; the VMs
 * attach to a subnet in another project and use their disks; a second forwarding rule shares the proxy.
 */
const LB = indexOf(
  {
    folder: null,
    web: 'folder',
    net: 'folder',
    subnet: 'net',
    fr: 'web',
    fr2: 'web',
    proxy: 'web',
    urlmap: 'web',
    bes: 'web',
    besApi: 'web',
    mig: 'web',
    vm1: 'mig',
    vm2: 'mig',
    disk1: 'web',
    neg: 'web',
    run: 'web',
    ip: 'web',
  },
  [
    ['fr', 'routes', 'proxy'],
    ['fr2', 'routes', 'proxy'],
    ['fr', 'uses', 'ip'],
    ['proxy', 'routes', 'urlmap'],
    ['urlmap', 'routes', 'bes'],
    ['urlmap', 'routes', 'besApi'],
    ['bes', 'routes', 'mig'],
    ['besApi', 'routes', 'neg'],
    ['neg', 'routes', 'run'],
    ['vm1', 'attaches', 'subnet'],
    ['vm1', 'uses', 'disk1'],
    ['vm2', 'attaches', 'subnet'],
  ],
);

describe('computeTrace', () => {
  it('a forwarding rule: its path to the root, its own lines, and the whole chain to the backends', () => {
    const trace = computeTrace(LB, 'fr');
    expect(trace?.ancestors).toEqual(['web', 'folder']);
    expect(trace?.incident).toEqual([key('fr', 'routes', 'proxy'), key('fr', 'uses', 'ip')].sort());
    expect(trace?.chain).toEqual(
      [
        key('fr', 'routes', 'proxy'),
        key('proxy', 'routes', 'urlmap'),
        key('urlmap', 'routes', 'bes'),
        key('urlmap', 'routes', 'besApi'),
        key('bes', 'routes', 'mig'),
        key('besApi', 'routes', 'neg'),
        key('neg', 'routes', 'run'),
      ].sort(),
    );
    expect(trace?.reached).toEqual(['bes', 'besApi', 'ip', 'mig', 'neg', 'proxy', 'run', 'urlmap']);
    // The other forwarding rule shares the proxy but is not on a chain through this one.
    expect(trace?.edges).not.toContain(key('fr2', 'routes', 'proxy'));
  });

  it('a backend service: upstream to every forwarding rule, downstream to its backends, never sideways', () => {
    const trace = computeTrace(LB, 'bes');
    expect(trace?.chain).toEqual(
      [
        key('fr', 'routes', 'proxy'),
        key('fr2', 'routes', 'proxy'),
        key('proxy', 'routes', 'urlmap'),
        key('urlmap', 'routes', 'bes'),
        key('bes', 'routes', 'mig'),
      ].sort(),
    );
    expect(trace?.reached).toEqual(['fr', 'fr2', 'mig', 'proxy', 'urlmap']);
    expect(trace?.edges).not.toContain(key('urlmap', 'routes', 'besApi'));
  });

  it('a VM: the zones up to the top level and its NIC, subnet and disk lines', () => {
    const trace = computeTrace(LB, 'vm1');
    expect(trace?.ancestors).toEqual(['mig', 'web', 'folder']);
    expect(trace?.edges).toEqual([key('vm1', 'attaches', 'subnet'), key('vm1', 'uses', 'disk1')].sort());
    expect(trace?.chain).toEqual([]);
    expect(trace?.reached).toEqual(['disk1', 'subnet']);
  });

  it('an open zone: the lines of everything inside it, its contents never counted as reached', () => {
    const trace = computeTrace(LB, 'mig');
    expect(trace?.incident).toEqual(
      [
        key('bes', 'routes', 'mig'),
        key('vm1', 'attaches', 'subnet'),
        key('vm1', 'uses', 'disk1'),
        key('vm2', 'attaches', 'subnet'),
      ].sort(),
    );
    expect(trace?.reached).toEqual(['bes', 'disk1', 'fr', 'fr2', 'proxy', 'subnet', 'urlmap']);
    expect(trace?.reached).not.toContain('vm1');
  });

  it('follows connects both ways and through a chip, as drawn', () => {
    const index = indexOf({ a: null, chip: null, b: null, c: null }, [
      ['a', 'connects', 'chip'],
      ['b', 'connects', 'chip'],
      ['chip', 'routes', 'c'],
    ]);
    expect(computeTrace(index, 'a')?.reached).toEqual(['b', 'c', 'chip']);
    expect(computeTrace(index, 'c')?.reached).toEqual(['a', 'b', 'chip']);
  });

  it('is cycle-safe: a routing loop is traced once and ends', () => {
    const index = indexOf({ a: null, b: null, c: null, d: null }, [
      ['a', 'routes', 'b'],
      ['b', 'routes', 'c'],
      ['c', 'routes', 'a'],
      ['c', 'routes', 'd'],
    ]);
    const trace = computeTrace(index, 'a');
    expect(trace?.chain).toEqual(
      [
        key('a', 'routes', 'b'),
        key('b', 'routes', 'c'),
        key('c', 'routes', 'a'),
        key('c', 'routes', 'd'),
      ].sort(),
    );
    expect(trace?.reached).toEqual(['b', 'c', 'd']);
  });

  it(`stops after ${String(TRACE_HOPS)} hops each way`, () => {
    const names = Array.from({ length: 21 }, (_, i) => `n${String(i).padStart(2, '0')}`);
    const index = indexOf(
      Object.fromEntries(names.map((name) => [name, null])),
      names.slice(1).map((name, i) => [names[i] ?? '', 'routes', name] as const),
    );
    const trace = computeTrace(index, 'n10');
    expect(trace?.reached).toEqual([...names.slice(2, 10), ...names.slice(11, 19)]);
    expect(trace?.chain).toHaveLength(2 * TRACE_HOPS);
    expect(computeTrace(index, 'n10', 2)?.reached).toEqual(['n08', 'n09', 'n11', 'n12']);
  });

  it('a hub with 300 lines each way: everything through the hub, but no sibling of a leaf', () => {
    const leaves = Array.from({ length: 300 }, (_, i) => `in${String(i)}`);
    const sinks = Array.from({ length: 300 }, (_, i) => `out${String(i)}`);
    const index = indexOf(Object.fromEntries(['hub', ...leaves, ...sinks].map((name) => [name, null])), [
      ...leaves.map((leaf) => [leaf, 'routes', 'hub'] as const),
      ...sinks.map((sink) => ['hub', 'routes', sink] as const),
    ]);
    const hub = computeTrace(index, 'hub');
    const leaf = computeTrace(index, 'in7');
    expect(hub?.edges).toHaveLength(600);
    expect(hub?.reached).toHaveLength(600);
    // From one source: through the hub to every sink, but none of the other 299 sources.
    expect(leaf?.reached).toHaveLength(301);
    expect(leaf?.reached).not.toContain('in8');
    expect(leaf?.edges).toHaveLength(301);
  });

  it('knows nothing of an id the layout does not hold', () => {
    expect(computeTrace(LB, 'nowhere')).toBeNull();
  });
});

describe('the diagram model’s trace index', () => {
  it('holds every drawn line and the rects’ nesting, so a trace of a real layout works', () => {
    const model = modelOf(smallScene(TRACE_EDGES));
    const trace = computeTrace(model.trace, 'run/api');
    expect(trace?.ancestors).toEqual(['subnets/a', 'networks/vpc', 'projects/web', 'folders/1']);
    expect(trace?.reached).toEqual(['pools/default', 'run/web']);
    // The same input gives the same index.
    expect(buildDiagramModel(model.input).trace.edges.size).toBe(model.trace.edges.size);
  });

  it('traces the lines touching a node or anything inside it, never the secures overlays', () => {
    const model = modelOf(
      smallScene([
        ['run/api', 'run/web', 'uses'],
        ['run/jobs', 'pools/default', 'routes'],
        ['run/web', 'projects/data', 'triggers'],
        ['clusters/gke', 'networks/vpc', 'secures'],
      ]),
    );
    const incident = (id: string): readonly string[] => computeTrace(model.trace, id)?.incident ?? [];
    expect(incident('run/web').length).toBe(2);
    expect(incident('subnets/a')).toEqual(incident('networks/vpc'));
    expect(incident('projects/web').length).toBe(3);
    expect(incident('projects/data').length).toBe(1);
    expect(incident('clusters/gke')).toEqual(['run/jobs -routes-> pools/default']);
    expect(computeTrace(model.trace, 'nowhere')).toBeNull();
  });
});
