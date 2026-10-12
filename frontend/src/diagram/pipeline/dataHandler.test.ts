// @vitest-environment node
// SPDX-License-Identifier: MIT
import {
  normalizeViewSpec,
  SceneSchema,
  type Catalog,
  type CatalogType,
  type Snapshot,
  type ViewSpec,
} from '@gcportrait/model';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { catalog } from '@gcportrait/catalog';
import { buildSceneWithReport } from '@gcportrait/graph';

import { DEMO_S } from '../testing/demoData';
import { dataHarness, TEST_VIEWPORT } from '../testing/dataHarness';
import { consoleLinks, consoleSource, DataError, lensList, loadDemoSnapshot } from './dataHandler';
import { createSceneMemo } from './sceneMemo';

// The handler loads the demo generator on first use (ADR 0029); loaded once here, before any test times its steps.
beforeAll(async () => {
  await import('./demo');
});

/** A harness whose snapshot loader counts its loads. */
function countingLoads(loadSnapshot = loadDemoSnapshot) {
  let loads = 0;
  const harness = dataHarness({
    loadSnapshot: (ref, onStage) => {
      loads += 1;
      return loadSnapshot(ref, onStage);
    },
  });
  return { ...harness, loads: () => loads };
}

describe('the data worker handler', () => {
  it('answers the lens list from the catalog, in the model order', async () => {
    const { ask, responses } = dataHarness();
    expect(await ask({ type: 'lenses' })).toEqual({ type: 'lenses', id: 1, lenses: lensList() });
    expect(responses).toHaveLength(1);
    expect(lensList()[0]).toMatchObject({ id: 'overview', title: 'Overview' });
    expect(lensList().find((lens) => lens.id === 'load-balancing')?.title).toBe('Load balancing');
  });

  it('loads a demo organisation once, builds its graph, and answers each view with its Scene', async () => {
    const { responses, scene: draw, loads } = countingLoads();
    await draw({ snapshot: 'demo:S' });
    await draw({ snapshot: 'demo:S', lens: 'networking' });
    expect(loads()).toBe(1);
    expect(
      responses.filter((response) => response.type === 'progress').map((response) => response.stage),
    ).toEqual(['generate', 'ingest', 'graph', 'scene', 'scene']);
    const answers = responses.flatMap((response) => (response.type === 'scene' ? [response] : []));
    expect(answers.map((answer) => answer.id)).toEqual([1, 2]);
    const first = answers[0]?.answer;
    expect(SceneSchema.parse(first?.scene).metadata.rootLabel).toBe('example.com');
    expect(first?.source).toMatchObject({
      ref: 'demo:S',
      scope: 'example.com',
      readTime: '2026-10-08T00:00:00Z',
      assets: 96,
    });
    expect(first?.lensTitle).toBe('Overview');
    expect(answers[1]?.answer.scene.metadata.lens).toBe('networking');
    // The icons the Scene draws travel with it (the icon table stays in the worker), and so do the type
    // names of its product-container zones, for their accessible names.
    const scene = SceneSchema.parse(first?.scene);
    const keys: string[] = [];
    const walk = (nodes: typeof scene.children): void => {
      for (const node of nodes) {
        if (node.type === 'card') keys.push(node.icon);
        else walk(node.children);
      }
    };
    walk(scene.children);
    expect(keys.length).toBeGreaterThan(10);
    for (const key of keys) expect(first?.icons.byKey[key]?.svg, key).toMatch(/^<svg\b/);
    expect(first?.icons.generic.key).toBe('cloud_generic');
    expect(Object.values(first?.zoneTypes ?? {})).toContain('Google Kubernetes Engine cluster');
  });

  it('skips a view that a newer one replaced while its snapshot was loading', async () => {
    const { responses, send, answerTo } = dataHarness();
    const viewport = TEST_VIEWPORT;
    send({ type: 'scene', spec: normalizeViewSpec({ snapshot: 'demo:S' }), viewport });
    const newer = send({
      type: 'scene',
      spec: normalizeViewSpec({ snapshot: 'demo:S', lens: 'compute' }),
      viewport,
    });
    // The handler works its requests in order, so once the newer one is answered the older one is done.
    await answerTo(newer);
    expect(responses.filter((response) => response.type === 'scene').map((response) => response.id)).toEqual([
      newer,
    ]);
  });

  it('reports an unknown snapshot, a view without one, a failed load and a malformed request', async () => {
    const failing = dataHarness({ loadSnapshot: () => Promise.reject(new Error('disk on fire')) });
    const viewport = TEST_VIEWPORT;
    await failing.ask({ type: 'scene', spec: normalizeViewSpec({ snapshot: 'demo:M' }), viewport });
    expect(failing.responses).toEqual([
      { type: 'error', id: 1, error: { code: 'internal', message: 'disk on fire' } },
    ]);

    const { responses, send, sendRaw, ask, answerTo } = dataHarness();
    await ask({
      type: 'scene',
      spec: normalizeViewSpec({ snapshot: '01J9Z3K5Q8XW2V4N6P7R8S9T0A' }),
      viewport,
    });
    const none = send({ type: 'scene', spec: normalizeViewSpec({}), viewport });
    send({ type: 'scene', spec: { lens: 'nonsense' }, viewport });
    send({ type: 'paint' });
    sendRaw('junk');
    await answerTo(none);
    // Malformed requests are answered at once; a well-formed one waits its turn.
    expect(
      responses.map((response) =>
        response.type === 'error' ? [response.id, response.error.code] : response.type,
      ),
    ).toEqual([
      [1, 'unknown-snapshot'],
      [3, 'protocol'],
      [4, 'protocol'],
      [-1, 'protocol'],
      [2, 'no-snapshot'],
    ]);
  });

  it('ingests the demo with a fixed clock and entropy: the same snapshot every time', async () => {
    const first: Snapshot = await loadDemoSnapshot('demo:S', () => undefined);
    const second: Snapshot = await loadDemoSnapshot('demo:S', () => undefined);
    expect(second.id).toBe(first.id);
    expect(first.source).toEqual({ kind: 'demo', detail: 'demo:S' });
    await expect(loadDemoSnapshot('demo:Q', () => undefined)).rejects.toBeInstanceOf(DataError);
  });
});

describe('console links', () => {
  const VM = DEMO_S.webVm;

  it('answers every asset-backed node’s console action with the Scene, through consoleUrlFor', async () => {
    const answer = await dataHarness().scene({ snapshot: 'demo:S' });
    expect(answer.consoleLinks[VM]).toEqual({
      kind: 'resource',
      url: 'https://console.cloud.google.com/compute/instancesDetail/zones/europe-west3-a/instances/web-1mnl?project=demo-web-1',
    });
    // Every link is a Cloud Console URL, and every Scene node it names exists.
    for (const [id, link] of Object.entries(answer.consoleLinks)) {
      expect(link.url, id).toMatch(/^https:\/\/console\.cloud\.google\.com\//);
    }
  });

  it('falls back to the project’s console home for a type whose template is stripped', async () => {
    const snapshot = await loadDemoSnapshot('demo:S', () => undefined);
    const vm = snapshot.assets.find((asset) => asset.name === VM);
    expect(vm).toBeDefined();
    const scene = SceneSchema.parse({
      children: [
        {
          type: 'card',
          id: VM,
          label: 'web-1mnl',
          icon: 'compute_engine',
          product: 'Compute Engine',
          assetType: vm?.assetType,
        },
        {
          type: 'zone',
          id: 'virtual/region',
          kind: 'region',
          label: 'europe-west3',
          badges: [],
          children: [],
        },
      ],
      edges: [],
      metadata: { rootLabel: 'example.com', lens: 'overview', readTime: snapshot.readTime, rectCount: 2 },
    });
    const source = consoleSource(snapshot);
    const vmType = catalog.types['compute.googleapis.com/Instance'];
    if (vmType === undefined) throw new Error('the catalog maps no VM type');
    const entry: CatalogType = { ...vmType };
    delete entry.console;
    const stripped: Pick<Catalog, 'types'> = {
      types: { ...catalog.types, 'compute.googleapis.com/Instance': entry },
    };
    expect(consoleLinks(scene, source, stripped)).toEqual({
      [VM]: {
        kind: 'project',
        projectId: 'demo-web-1',
        url: 'https://console.cloud.google.com/home/dashboard?project=demo-web-1',
      },
    });
    expect(consoleLinks(scene, source)[VM]?.kind).toBe('resource');
  });
});

describe('the open view built at idle', () => {
  // The idle timer runs on fake time, so "idle for 400 ms" is exactly that, however busy the machine is.
  const realSetTimeout = globalThis.setTimeout;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A handler whose Scene memo records each view it builds (lens and detail level) and waits `warmAfterMs`. */
  function counting(warmAfterMs: number) {
    const built: string[] = [];
    const scenes = createSceneMemo(catalog, (graph, spec: ViewSpec, cat, env) => {
      built.push(`${spec.lens} ${spec.detail}${spec.tick === undefined ? '' : ` ${spec.tick}`}`);
      return buildSceneWithReport(graph, spec, cat, env);
    });
    return { ...dataHarness({ scenes, warmAfterMs }), built };
  }
  /** `ms` of quiet pass, and whatever the idle timer queued is built (a real turn of the event loop). */
  const quiet = async (ms: number): Promise<void> => {
    await vi.advanceTimersByTimeAsync(ms);
    await new Promise((resolve) => realSetTimeout(resolve, 0));
  };
  // Demo S at `folders` draws chips; its history's last day is the snapshot's own.
  const view = (input: { lens?: 'overview' | 'networking'; tick?: string } = {}) =>
    ({ snapshot: 'demo:S', detail: 'folders', ...input }) as const;

  it('builds the drawn day’s open view at idle: the first step back builds only the new day’s views', async () => {
    const { built, scene } = counting(5);
    await scene(view());
    expect(built).toEqual(['overview folders']);
    await quiet(5);
    expect(built).toEqual(['overview folders', 'overview all']);
    const step = await scene(view({ tick: '2026-10-07' }), { tick: null });
    // The new day's drawn view and open view; the snapshot's own day's open view was built at idle.
    expect(built).toEqual([
      'overview folders',
      'overview all',
      'overview folders 2026-10-07',
      'overview all 2026-10-07',
    ]);
    expect(step.diff?.since).toEqual({ readTime: '2026-10-08T00:00:00Z' });
    // A step with a diff has its open view built already: nothing more at idle.
    await quiet(1_000);
    expect(built).toHaveLength(4);
  });

  it('waits while requests arrive, and drops the open view of a view replaced by a newer one', async () => {
    const { built, scene, ask } = counting(400);
    await scene(view());
    // Two requests 250 ms apart: the worker is never idle for 400 ms.
    for (let request = 0; request < 2; request += 1) {
      await ask({ type: 'lenses' });
      await quiet(250);
    }
    expect(built).toEqual(['overview folders']);
    await scene(view({ lens: 'networking' }));
    await quiet(400);
    expect(built).toEqual(['overview folders', 'networking folders', 'networking all']);
  });
});
