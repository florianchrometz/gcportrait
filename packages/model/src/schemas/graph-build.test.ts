// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { INSTANCE, NETWORK, PROJECT, SUBNET, sampleGraph } from '../testing/fixtures.js';
import { issuePaths, present, withChange } from '../testing/issues.js';
import { GraphBuildSchema, GraphReportSchema, type GraphBuild, type GraphReport } from './graph-build.js';

const HOST = '//cloudresourcemanager.googleapis.com/projects/10000000002';
const HOST_SUBNET = '//compute.googleapis.com/projects/demo-host/regions/europe-west3/subnetworks/shared';
const MISSING = '//compute.googleapis.com/projects/demo-net/global/networks/missing';

function emptyReport(): GraphReport {
  return {
    sharedVpc: [],
    sharedWith: {},
    cycles: [],
    danglingByNode: { [INSTANCE]: 1 },
    unmappedTypes: {},
    counts: {
      assets: 6,
      duplicateAssets: 0,
      virtualNodes: 0,
      weakYielded: 0,
      peersMerged: 0,
      aliasConflicts: 0,
      crossProjectRefused: 0,
    },
  };
}

/** The sample graph plus a host project whose subnet the instance attaches to across projects. */
function sharedBuild(): GraphBuild {
  const graph = sampleGraph();
  const base = present(graph.nodes[PROJECT]);
  graph.nodes[HOST] = {
    ...base,
    id: HOST,
    label: 'demo-host',
    projectId: 'demo-host',
    projectNumber: '10000000002',
  };
  graph.nodes[HOST_SUBNET] = { ...present(graph.nodes[SUBNET]), id: HOST_SUBNET, label: 'shared' };
  graph.containment.parent[HOST_SUBNET] = HOST;
  graph.containment.children[HOST] = [HOST_SUBNET];
  graph.edges.push(
    { from: INSTANCE, to: HOST_SUBNET, kind: 'attaches' },
    { from: PROJECT, to: HOST, kind: 'shares' },
  );
  const report = emptyReport();
  report.sharedVpc = [{ service: PROJECT, host: HOST, attachments: [{ from: INSTANCE, to: HOST_SUBNET }] }];
  report.sharedWith = { [HOST_SUBNET]: 1 };
  report.cycles = [{ ids: [NETWORK, SUBNET] }];
  report.unmappedTypes = { 'example.googleapis.com/Widget': 2 };
  return { graph, report };
}

const buildWith = (change: (build: GraphBuild) => void): GraphBuild => withChange(sharedBuild, change);

describe('GraphReportSchema', () => {
  it('accepts an empty report and a full one', () => {
    expect(issuePaths(GraphReportSchema, emptyReport())).toEqual([]);
    expect(issuePaths(GraphReportSchema, sharedBuild().report)).toEqual([]);
  });

  it('rejects zero counts in the per-key records, empty lists, unknown keys and negative counters', () => {
    const report = { ...emptyReport(), danglingByNode: { [INSTANCE]: 0 }, unmappedTypes: { 'a.b/C': 0 } };
    expect(issuePaths(GraphReportSchema, report)).toEqual([
      `danglingByNode.${INSTANCE}`,
      'unmappedTypes.a.b/C',
    ]);
    expect(issuePaths(GraphReportSchema, { ...emptyReport(), cycles: [{ ids: [] }] })).toEqual([
      'cycles.0.ids',
    ]);
    expect(
      issuePaths(GraphReportSchema, {
        ...emptyReport(),
        sharedVpc: [{ service: PROJECT, host: HOST, attachments: [] }],
      }),
    ).toEqual(['sharedVpc.0.attachments']);
    expect(issuePaths(GraphReportSchema, { ...emptyReport(), extra: 1 })).toEqual(['']);
    const counts = { ...emptyReport().counts, weakYielded: -1 };
    expect(issuePaths(GraphReportSchema, { ...emptyReport(), counts })).toEqual(['counts.weakYielded']);
  });
});

describe('GraphBuildSchema', () => {
  it('accepts a graph with the report that describes it', () => {
    expect(issuePaths(GraphBuildSchema, sharedBuild())).toEqual([]);
    expect(issuePaths(GraphBuildSchema, { graph: sampleGraph(), report: emptyReport() })).toEqual([]);
  });

  it('rejects report ids that name no node', () => {
    const build = buildWith((b) => {
      b.report.sharedVpc = [
        { service: MISSING, host: MISSING, attachments: [{ from: INSTANCE, to: HOST_SUBNET }] },
      ];
      b.report.cycles = [{ ids: [MISSING] }];
      b.report.sharedWith = { [MISSING]: 1, [HOST_SUBNET]: 1 };
      b.graph.edges = b.graph.edges.filter((edge) => edge.kind !== 'shares');
    });
    expect(issuePaths(GraphBuildSchema, build)).toEqual([
      'report.sharedVpc.0.service',
      'report.sharedVpc.0.host',
      'report.sharedVpc.0',
      `report.sharedWith.${MISSING}`,
      `report.sharedWith.${MISSING}`,
      'report.cycles.0.ids.0',
    ]);
  });

  it('rejects a pair listed twice, a pair without its shares edge, and a shares edge without a pair', () => {
    const twice = buildWith((b) => {
      b.report.sharedVpc.push(present(b.report.sharedVpc[0]));
    });
    expect(issuePaths(GraphBuildSchema, twice)).toEqual(['report.sharedVpc.1']);

    const noEdge = buildWith((b) => {
      b.graph.edges = b.graph.edges.filter((edge) => edge.kind !== 'shares');
    });
    expect(issuePaths(GraphBuildSchema, noEdge)).toEqual(['report.sharedVpc.0']);

    const noPair = buildWith((b) => {
      b.report.sharedVpc = [];
      b.report.sharedWith = {};
    });
    expect(issuePaths(GraphBuildSchema, noPair)).toEqual(['graph.edges.3']);
  });

  it('rejects an attachment that is no attaches edge', () => {
    const build = buildWith((b) => {
      b.graph.edges = b.graph.edges.filter((edge) => edge.to !== HOST_SUBNET);
    });
    expect(issuePaths(GraphBuildSchema, build)).toEqual(['report.sharedVpc.0.attachments.0']);
  });

  it('rejects sharedWith counts that do not match the pairs, and missing targets', () => {
    const wrong = buildWith((b) => {
      b.report.sharedWith = { [HOST_SUBNET]: 2 };
    });
    expect(issuePaths(GraphBuildSchema, wrong)).toEqual([`report.sharedWith.${HOST_SUBNET}`]);
    const missing = buildWith((b) => {
      b.report.sharedWith = {};
    });
    expect(issuePaths(GraphBuildSchema, missing)).toEqual(['report.sharedWith']);
  });

  it('rejects danglingByNode counts that do not match Graph.dangling, and missing nodes', () => {
    const wrong = buildWith((b) => {
      b.report.danglingByNode = { [INSTANCE]: 2, [SUBNET]: 1 };
    });
    expect(issuePaths(GraphBuildSchema, wrong)).toEqual([
      `report.danglingByNode.${INSTANCE}`,
      `report.danglingByNode.${SUBNET}`,
    ]);
    const missing = buildWith((b) => {
      b.report.danglingByNode = {};
    });
    expect(issuePaths(GraphBuildSchema, missing)).toEqual(['report.danglingByNode']);
  });

  it('rejects unknown top-level keys and an invalid graph', () => {
    expect(issuePaths(GraphBuildSchema, { ...sharedBuild(), extra: true })).toEqual(['']);
    const build = buildWith((b) => {
      b.graph.edges.push({ from: INSTANCE, to: MISSING, kind: 'uses' });
    });
    expect(issuePaths(GraphBuildSchema, build)).toEqual(['graph.edges.4']);
  });
});
