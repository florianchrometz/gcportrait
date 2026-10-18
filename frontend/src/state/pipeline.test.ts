// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
/**
 * The pipeline controller with the real data and layout handlers in-process: a view's Scene and Layout land in
 * the pipeline slice and its snapshot in the snapshot slice; a newer request supersedes the older; a timeline day
 * is drawn as a view is, without taking the snapshot back to loading; the canvas size is the measured one; a resize
 * asks again only when `auto` would pick another level (with hysteresis); a reset forgets the measured canvas.
 */
import { decodeViewSpec } from '@gcportrait/model';
import { describe, expect, it, vi } from 'vitest';

import { budgetOf } from '../diagram/autoDetail';
import { createInProcessWorkers } from '../diagram/pipeline/inProcess';
import type { Viewport } from '../diagram/pipeline/protocol';
import type { DiagramWorkers } from '../diagram/pipeline/workers';
import { selectSceneKey } from './hooks';
import { createPipelineController, FALLBACK_VIEWPORT, locateViewport, sceneKey } from './pipeline';
import { createAppStore, type AppStore } from './store';

function setup(hash: string): {
  store: AppStore;
  viewports: Viewport[];
  workers: () => DiagramWorkers;
} {
  const store = createAppStore({ location: { pathname: '/diagram', hash } });
  const viewports: Viewport[] = [];
  const pair = createInProcessWorkers();
  const scene = pair.data.scene.bind(pair.data);
  pair.data.scene = (spec, viewport, options) => {
    viewports.push(viewport);
    return scene(spec, viewport, options);
  };
  return { store, viewports, workers: () => pair };
}

const keyOf = (store: AppStore): string => sceneKey(store.getState().view.spec);

async function settled(store: AppStore, key = keyOf(store)): Promise<void> {
  await vi.waitFor(
    () => {
      const { pipeline } = store.getState();
      expect(pipeline.pending).toBeNull();
      expect(pipeline.result?.key ?? pipeline.error?.message).toBe(
        pipeline.error === null ? key : pipeline.error.message,
      );
    },
    { timeout: 20_000, interval: 10 },
  );
}

/** A canvas whose `auto` budget is `budget` (budget × 14 000 px², 1000 px tall). */
const canvasFor = (budget: number): Viewport => ({
  width: Math.ceil((budget * 14_000) / 1000),
  height: 1000,
});

describe('the pipeline controller', () => {
  it('locates with the drawn viewport, then the measured canvas, then the fallback', () => {
    const viewport = { width: 1000, height: 700 };
    const canvas = { width: 800, height: 600 };
    expect(locateViewport({ viewport, canvas })).toBe(viewport);
    expect(locateViewport({ viewport: null, canvas })).toBe(canvas);
    expect(locateViewport({ viewport: null, canvas: null })).toBe(FALLBACK_VIEWPORT);
  });

  it('draws the view into the pipeline slice and the snapshot into the snapshot slice', async () => {
    const { store, viewports, workers } = setup('#snapshot=demo:S&selection=x');
    const stages: string[] = [];
    store.subscribe(() => {
      const stage = store.getState().snapshot.stage;
      if (stage !== null && stages.at(-1) !== stage) stages.push(stage);
    });
    const controller = createPipelineController(store, workers);
    controller.run(keyOf(store));
    expect(store.getState().pipeline.pending).toEqual({ ref: 'demo:S', stage: 'scene' });
    expect(store.getState().snapshot.status).toBe('loading');
    await settled(store);
    const { pipeline, snapshot } = store.getState();
    expect(pipeline.result?.key).toBe('snapshot=demo:S');
    expect(pipeline.result?.layout.rects).toBeDefined();
    expect(pipeline.viewport).toEqual(FALLBACK_VIEWPORT);
    expect(pipeline.requests).toBe(1);
    expect(viewports).toEqual([FALLBACK_VIEWPORT]);
    expect(snapshot).toMatchObject({ ref: 'demo:S', status: 'ready', stage: null, error: null });
    expect(snapshot.source?.scope).toBe('example.com');
    expect(stages).toEqual(['generate', 'ingest', 'graph']);
  }, 30_000);

  it('supersedes a request with a newer one and keeps the previous diagram of the same snapshot meanwhile', async () => {
    const { store, workers } = setup('#snapshot=demo:S');
    const controller = createPipelineController(store, workers);
    controller.run(keyOf(store));
    await settled(store);
    const first = store.getState().pipeline.result;
    store.actions.setView((spec) => ({ ...spec, lens: 'networking' }));
    controller.run(keyOf(store));
    expect(store.getState().pipeline.result).toBe(first);
    store.actions.setView((spec) => ({ ...spec, lens: 'load-balancing' }));
    controller.run(keyOf(store));
    await settled(store);
    expect(store.getState().pipeline.result?.key).toBe('snapshot=demo:S&lens=load-balancing');
    expect(store.getState().pipeline.requests).toBe(3);
  }, 30_000);

  it('draws a timeline day without taking the snapshot back to loading', async () => {
    const { store, workers } = setup('#snapshot=demo:S');
    const controller = createPipelineController(store, workers);
    controller.run(selectSceneKey(store.getState()));
    await settled(store);
    expect(store.getState().snapshot.status).toBe('ready');
    const statuses: string[] = [];
    const stages: string[] = [];
    store.subscribe(() => {
      const { snapshot, pipeline } = store.getState();
      if (statuses.at(-1) !== snapshot.status) statuses.push(snapshot.status);
      const stage = pipeline.pending?.stage;
      if (stage !== undefined && stages.at(-1) !== stage) stages.push(stage);
    });
    store.actions.setView((spec) => ({ ...spec, tick: '2026-09-17' }));
    // The key the app draws (state/hooks.ts), the day's own: the day is read and built, its Scene and Layout land.
    const day = selectSceneKey(store.getState());
    expect(day).toBe('snapshot=demo:S&tick=2026-09-17');
    controller.run(day);
    await settled(store, day);
    const { pipeline, snapshot } = store.getState();
    expect(pipeline.result?.answer.source).toMatchObject({
      tick: '2026-09-17',
      readTime: '2026-09-17T00:00:00Z',
    });
    expect(stages).toEqual(['scene', 'ingest', 'graph', 'scene', 'layout']);
    expect(statuses).toEqual(['ready']);
    expect(snapshot.source?.tick).toBe('2026-09-17');
  }, 40_000);

  it('asks at the measured canvas size, and again only when auto would pick another level', async () => {
    // Demo M's networking lens: folders (38 rects) at 1280 × 624, projects (127) from a budget of 142.
    const { store, viewports, workers } = setup('#snapshot=demo:M&lens=networking');
    const controller = createPipelineController(store, workers);
    controller.measure({ width: 1280, height: 624 });
    controller.run(keyOf(store));
    await settled(store);
    expect(viewports).toEqual([{ width: 1280, height: 624 }]);
    const detail = store.getState().pipeline.result?.answer.report.detail;
    if (detail === undefined) throw new Error('no detail');
    expect(detail.budget).toBe(57);
    // The next level opens at its rect count / 0.9; just below that nothing is asked for.
    const levels = ['folders', 'projects', 'networks', 'all'] as const;
    const next = levels[levels.indexOf(detail.used) + 1];
    if (next === undefined) throw new Error('M networking opens fully at 57 rects');
    const opensAt = Math.ceil(detail.rectCounts[next] / 0.9);
    controller.measure(canvasFor(opensAt - 3));
    controller.measure({ width: 1281, height: 624 });
    expect(viewports).toHaveLength(1);
    controller.measure(canvasFor(opensAt + 2));
    await settled(store);
    expect(viewports).toHaveLength(2);
    const reopened = store.getState().pipeline.result?.answer.report.detail;
    expect(reopened?.used).not.toBe(detail.used);
    expect(reopened?.budget).toBe(budgetOf(canvasFor(opensAt + 2)));
    // A level that is not auto never follows the canvas.
    store.actions.setDetail('folders');
    controller.run(keyOf(store));
    await settled(store);
    controller.measure({ width: 4000, height: 3000 });
    controller.measure({ width: 1280, height: 400 });
    expect(viewports).toHaveLength(3);
  }, 30_000);

  it('reports an unknown snapshot in both slices, and no workers in the pipeline slice', async () => {
    const { store, workers } = setup('#snapshot=01J9Z3K5Q8XW2V4N6P7R8S9T0A');
    const controller = createPipelineController(store, workers);
    controller.run(keyOf(store));
    await settled(store);
    expect(store.getState().pipeline.error?.message).toContain('No snapshot "01J9Z3K5Q8XW2V4N6P7R8S9T0A"');
    expect(store.getState().snapshot.status).toBe('error');
    expect(store.getState().snapshot.error).toContain('is available yet');

    const bare = createAppStore({ location: { pathname: '/diagram', hash: '#snapshot=demo:S' } });
    createPipelineController(bare, () => null).run(sceneKey(bare.getState().view.spec));
    expect(bare.getState().pipeline.error?.message).toBe('Diagrams cannot be drawn here: no workers.');
  }, 30_000);

  it('draws nothing without a snapshot, and empties the slice on reset', async () => {
    const { store, workers } = setup('#snapshot=demo:S');
    const controller = createPipelineController(store, workers);
    controller.run(keyOf(store));
    controller.cancel();
    controller.run(keyOf(store));
    await settled(store);
    controller.reset();
    expect(store.getState().pipeline).toMatchObject({ key: '', result: null, pending: null, error: null });
    controller.run(sceneKey(decodeViewSpec('lens=data')));
    expect(store.getState().pipeline.result).toBeNull();
  }, 30_000);

  it('forgets the measured canvas on reset, and asks at the size measured when the page comes back', async () => {
    const { store, viewports, workers } = setup('#snapshot=demo:S');
    const controller = createPipelineController(store, workers);
    controller.measure({ width: 1280, height: 624 });
    controller.run(keyOf(store));
    await settled(store);
    // The diagram page went away: no size is left in the slice for a reader on another page.
    controller.reset();
    expect(store.getState().pipeline).toMatchObject({ canvas: null, viewport: null });
    // The page comes back and measures its canvas before it asks for the view (state/hooks.ts).
    controller.measure({ width: 390, height: 500 });
    expect(store.getState().pipeline.canvas).toEqual({ width: 390, height: 500 });
    controller.run(keyOf(store));
    await settled(store);
    expect(viewports).toEqual([
      { width: 1280, height: 624 },
      { width: 390, height: 500 },
    ]);
    // Measured the same as before the page went away, the canvas is written again all the same.
    controller.reset();
    controller.measure({ width: 390, height: 500 });
    expect(store.getState().pipeline.canvas).toEqual({ width: 390, height: 500 });
  }, 30_000);

  it('leaves selection and highlight out of the scene key', () => {
    expect(sceneKey(decodeViewSpec('snapshot=demo:S&lens=data&selection=a&highlight=b'))).toBe(
      'snapshot=demo:S&lens=data',
    );
    expect(sceneKey(decodeViewSpec('lens=data'))).toBe('');
  });
});
