// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { FOLDER, INSTANCE, NETWORK, PROJECT, sampleScene } from '../testing/fixtures.js';
import { issuePaths, withChange } from '../testing/issues.js';
import {
  SceneBuildSchema,
  SceneEnvSchema,
  SceneFocusSchema,
  SceneReportSchema,
  SceneRootSchema,
  type SceneBuild,
  type SceneReport,
} from './scene-build.js';

/** A report that agrees with the model's sample scene (folder › project › VPC chip and an instance card). */
function sampleReport(): SceneReport {
  return {
    root: {},
    detail: {
      requested: 'auto',
      used: 'networks',
      budget: 73,
      ceiling: 'all',
      rectCounts: { folders: 2, projects: 4, networks: 4, all: 6 },
    },
    legend: {
      zoneKinds: ['folder', 'project', 'vpc'],
      edgeKinds: ['attaches'],
      collapsed: true,
      external: false,
      overlay: false,
    },
    overlays: [],
    external: [],
    unknownFlips: [],
    warnings: [],
    counts: {
      universe: 6,
      focus: 6,
      visible: 6,
      stubs: 0,
      held: 0,
      zones: 3,
      cards: 1,
      chips: 1,
      bundles: 0,
      edges: 1,
      relations: 2,
      dangling: 0,
    },
  };
}

const buildWith = (change: (build: SceneBuild) => void): SceneBuild =>
  withChange(() => ({ scene: sampleScene(), report: sampleReport() }), change);

describe('SceneEnvSchema', () => {
  it('needs a read time; budget, root label and the region setting are optional', () => {
    expect(issuePaths(SceneEnvSchema, { readTime: '2026-10-08T00:00:00Z' })).toEqual([]);
    expect(
      issuePaths(SceneEnvSchema, {
        readTime: '2026-10-08T00:00:00Z',
        viewportBudget: 73,
        rootLabel: 'example.com',
        showRegions: true,
      }),
    ).toEqual([]);
    expect(issuePaths(SceneEnvSchema, { viewportBudget: 0, rootLabel: '' })).toEqual([
      'readTime',
      'viewportBudget',
      'rootLabel',
    ]);
  });
});

describe('SceneRootSchema', () => {
  it('accepts the organisation, a used root and a refused one', () => {
    expect(issuePaths(SceneRootSchema, {})).toEqual([]);
    expect(issuePaths(SceneRootSchema, { requested: FOLDER, used: FOLDER })).toEqual([]);
    expect(
      issuePaths(SceneRootSchema, {
        requested: 'nowhere',
        error: { code: 'unknown-root', message: 'no node nowhere' },
      }),
    ).toEqual([]);
  });

  it('rejects an error without the request, or with a used root', () => {
    const error = { code: 'not-a-container', message: 'a card' };
    expect(issuePaths(SceneRootSchema, { error })).toEqual(['error']);
    expect(issuePaths(SceneRootSchema, { requested: INSTANCE, used: FOLDER, error })).toEqual(['error']);
  });
});

describe('SceneFocusSchema', () => {
  it('is either applied or an error', () => {
    expect(
      issuePaths(SceneFocusSchema, {
        status: 'applied',
        kind: 'project',
        anchor: PROJECT,
        projects: [PROJECT],
      }),
    ).toEqual([]);
    expect(
      issuePaths(SceneFocusSchema, { status: 'applied', kind: 'standalone-projects', projects: [] }),
    ).toEqual([]);
    expect(
      issuePaths(SceneFocusSchema, {
        status: 'error',
        kind: 'shared-vpc',
        error: { code: 'not-a-host', param: 'host', message: 'demo-web-1 is no Shared VPC host' },
      }),
    ).toEqual([]);
    expect(
      issuePaths(SceneFocusSchema, {
        status: 'error',
        kind: 'project',
        error: { code: 'nope', message: 'x' },
      }),
    ).toEqual(['error.code']);
    expect(issuePaths(SceneFocusSchema, { status: 'applied', kind: 'project', error: {} })).toEqual([
      'projects',
      '',
    ]);
  });
});

describe('SceneReportSchema', () => {
  it('accepts the sample report with every optional part', () => {
    const report: SceneReport = {
      ...sampleReport(),
      root: { requested: FOLDER, used: FOLDER },
      focus: { status: 'applied', kind: 'project', anchor: PROJECT, projects: [PROJECT] },
      selection: { value: INSTANCE, node: INSTANCE, shownAs: INSTANCE },
      highlight: { value: '10.0.0.2' },
      unknownFlips: ['k3x9a1'],
      warnings: ['1 flip matches no zone of this view'],
    };
    expect(issuePaths(SceneReportSchema, report)).toEqual([]);
  });

  it('is strict', () => {
    expect(issuePaths(SceneReportSchema, { ...sampleReport(), extra: 1 })).toEqual(['']);
  });
});

describe('SceneBuildSchema', () => {
  it('accepts a report that agrees with its scene', () => {
    expect(
      issuePaths(
        SceneBuildSchema,
        buildWith(() => undefined),
      ),
    ).toEqual([]);
  });

  it('accepts overlays and pointers that name scene nodes', () => {
    const build = buildWith(({ report }) => {
      report.overlays = [{ zone: FOLDER, kind: 'secures' }];
      report.legend.overlay = true;
      report.selection = { value: INSTANCE, node: INSTANCE, shownAs: INSTANCE };
      report.highlight = { value: NETWORK, node: NETWORK, shownAs: NETWORK };
    });
    expect(issuePaths(SceneBuildSchema, build)).toEqual([]);
  });

  it('rejects a legend that does not match the scene', () => {
    const build = buildWith(({ report }) => {
      report.legend = {
        zoneKinds: ['vpc', 'project'],
        edgeKinds: [],
        collapsed: false,
        external: true,
        overlay: true,
      };
    });
    expect(issuePaths(SceneBuildSchema, build)).toEqual([
      'report.legend.zoneKinds',
      'report.legend.edgeKinds',
      'report.legend.collapsed',
      'report.legend.external',
      'report.legend.overlay',
    ]);
  });

  it('accepts external stubs that are scene nodes', () => {
    const build = buildWith(({ report }) => {
      report.external = [INSTANCE];
      report.legend.external = true;
      report.counts.stubs = 1;
    });
    expect(issuePaths(SceneBuildSchema, build)).toEqual([]);
  });

  it('rejects overlays, external stubs and pointers that name nothing in the scene', () => {
    const build = buildWith(({ report }) => {
      report.external = ['nowhere'];
      report.legend.external = true;
      report.overlays = [{ zone: INSTANCE, kind: 'secures' }];
      report.legend.overlay = true;
      report.selection = { value: 'web', shownAs: 'nowhere' };
      report.highlight = { value: 'web', shownAs: 'elsewhere' };
    });
    expect(issuePaths(SceneBuildSchema, build)).toEqual([
      'report.external.0',
      'report.overlays.0.zone',
      'report.selection.shownAs',
      'report.highlight.shownAs',
    ]);
  });

  it('rejects counts that do not match the scene', () => {
    const build = buildWith(({ report }) => {
      report.counts = {
        ...report.counts,
        zones: 4,
        cards: 0,
        chips: 0,
        bundles: 1,
        edges: 2,
        relations: 1,
        focus: 7,
      };
    });
    expect(issuePaths(SceneBuildSchema, build)).toEqual([
      'report.counts.zones',
      'report.counts.cards',
      'report.counts.chips',
      'report.counts.bundles',
      'report.counts.edges',
      'report.counts.relations',
      'report.counts.focus',
    ]);
  });

  it('counts bundles and edges without a count as one relation', () => {
    const build = buildWith(({ scene, report }) => {
      scene.children.push({
        type: 'zone',
        id: 'group:a',
        kind: 'group',
        label: 'a – c',
        badges: [],
        children: [],
      });
      scene.metadata.rectCount += 1;
      const edge = scene.edges[0];
      if (edge !== undefined) scene.edges[0] = { from: edge.from, to: edge.to, kind: edge.kind };
      report.legend.zoneKinds = ['folder', 'project', 'vpc', 'group'];
      report.counts = { ...report.counts, zones: 4, bundles: 1, relations: 1 };
    });
    expect(issuePaths(SceneBuildSchema, build)).toEqual([]);
  });

  it('rejects an invalid scene', () => {
    const build = buildWith(({ scene }) => {
      scene.metadata.rectCount = 99;
    });
    expect(issuePaths(SceneBuildSchema, build)).toEqual(['scene.metadata.rectCount']);
  });
});
