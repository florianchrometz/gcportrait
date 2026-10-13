// SPDX-License-Identifier: MIT
/**
 * The diagram pipeline for the view in the store (docs/packages.md): the data worker turns the view into a Scene
 * (loading and building the snapshot's Graph the first time), the layout worker lays the Scene out, and the
 * result goes into the store's `pipeline` slice; the snapshot's loading stages and errors go into its
 * `snapshot` slice. A new request supersedes the one being prepared (it is aborted, and both worker clients
 * cancel a superseded request themselves); the previous diagram of the same snapshot stays on screen meanwhile.
 * Selection and highlight are not part of the Scene's view (`sceneKey`), so selecting a node never asks either
 * worker for anything.
 *
 * The canvas is measured by the page (`measure`, from a ResizeObserver); each request is made at the latest
 * measured size (the minimum viewport, 1280 × 800, until there is one). A resize asks for the view
 * again only when detail `auto` would pick another level, with hysteresis (diagram/autoDetail.ts).
 */
import { isLayoutCancelled, LayoutWorkerError } from '@gcportrait/layout';
import { decodeViewSpec } from '@gcportrait/model';

import { autoLevelChange, budgetOf } from '../diagram/autoDetail';
import { diffFrom } from '../diagram/diff/base';
import { DataWorkerError, isDataCancelled } from '../diagram/pipeline/dataClient';
import type { DataStage, Viewport } from '../diagram/pipeline/protocol';
import type { DiagramWorkers } from '../diagram/pipeline/workers';
import type { PipelineError, PipelineSlice, SnapshotStage } from './slices';
import type { AppStore } from './store';

/** The canvas size used until the canvas has been measured: the minimum viewport, 1280 × 800. */
export const FALLBACK_VIEWPORT: Viewport = { width: 1280, height: 800 };

export { sceneKey } from './sceneKey';

function errorOf(error: unknown): PipelineError {
  if (error instanceof LayoutWorkerError) return { message: error.message, ids: error.ids };
  if (error instanceof DataWorkerError) return { message: error.message, ids: [] };
  return { message: error instanceof Error ? error.message : String(error), ids: [] };
}

function isSnapshotStage(stage: DataStage | 'layout'): stage is SnapshotStage {
  return stage === 'generate' || stage === 'ingest' || stage === 'graph';
}

export interface PipelineController {
  /** Draws the view whose scene key is `key` (`''`: nothing to draw). */
  run(key: string): void;
  /** The canvas was measured (null: it has no size); asks for the view again if `auto` would change level. */
  measure(canvas: Viewport | null): void;
  /** Aborts the request being prepared, if any. */
  cancel(): void;
  /** Aborts and empties the pipeline slice (the diagram page went away). */
  reset(): void;
}

export function createPipelineController(
  store: AppStore,
  workers: () => DiagramWorkers | null,
): PipelineController {
  let running: AbortController | null = null;

  const update = (patch: Partial<PipelineSlice>): void => {
    store.updatePipeline((current) => ({ ...current, ...patch }));
  };

  const run = (key: string): void => {
    running?.abort();
    running = null;
    if (key === '') {
      update({ key, result: null, pending: null, error: null, viewport: null });
      return;
    }
    const view = decodeViewSpec(key);
    const pair = workers();
    if (pair === null) {
      update({
        key,
        result: null,
        pending: null,
        error: { message: 'Diagrams cannot be drawn here: no workers.', ids: [] },
      });
      return;
    }
    const controller = new AbortController();
    running = controller;
    const { signal } = controller;
    const ref = view.snapshot;
    const viewport = store.getState().pipeline.canvas ?? FALLBACK_VIEWPORT;
    // The day on screen, or the one the diagram on screen was compared with, is what this one is compared with.
    const since = diffFrom(store.getState().pipeline.result, view);
    // While true, the data worker is still loading the snapshot (an error then is the snapshot's own).
    let loadingSnapshot = store.getState().snapshot.source?.ref !== ref;
    // A timeline day of a snapshot already loaded is read and built as a snapshot is, but its stages and
    // errors are the day's, not the snapshot's.
    const snapshotStages = loadingSnapshot || view.tick === undefined;
    store.updatePipeline((current) => ({
      ...current,
      key,
      result: current.result?.answer.source.ref === ref ? current.result : null,
      pending: { ref, stage: 'scene' },
      error: null,
      viewport,
      requests: current.requests + 1,
    }));
    if (loadingSnapshot)
      store.updateSnapshot((current) => ({ ...current, status: 'loading', stage: null, error: null }));
    const stage = (next: DataStage | 'layout'): void => {
      if (signal.aborted) return;
      store.updatePipeline((current) => ({ ...current, pending: { ref, stage: next } }));
      if (isSnapshotStage(next) && snapshotStages) {
        loadingSnapshot = true;
        store.updateSnapshot((current) => ({ ...current, status: 'loading', stage: next, error: null }));
      } else {
        loadingSnapshot = false;
      }
    };
    void (async () => {
      try {
        const answer = await pair.data.scene(view, viewport, {
          signal,
          onProgress: stage,
          ...(since === undefined ? {} : { diffFrom: since }),
        });
        stage('layout');
        const { layout } = await pair.layout.layout(answer.scene, undefined, { signal });
        if (signal.aborted) return;
        running = null;
        update({ result: { key, answer, layout }, pending: null, error: null });
        store.updateSnapshot((current) => ({
          ...current,
          status: 'ready',
          stage: null,
          source: answer.source,
          error: null,
        }));
        store.setHovered(null);
        check();
      } catch (error: unknown) {
        if (isDataCancelled(error) || isLayoutCancelled(error) || signal.aborted) return;
        running = null;
        const failure = errorOf(error);
        update({ pending: null, error: failure });
        // A data error before the Scene stage is the snapshot's own (unknown, unreadable, no Graph).
        if (error instanceof DataWorkerError && loadingSnapshot) {
          store.updateSnapshot((current) => ({
            ...current,
            status: 'error',
            stage: null,
            error: failure.message,
          }));
        }
      }
    })();
  };

  /** Re-asks for the view on screen when the measured canvas would make `auto` pick another level. */
  const check = (): void => {
    const { pipeline } = store.getState();
    const result = pipeline.result;
    if (running !== null || result === null || result.key !== pipeline.key) return;
    const budget = budgetOf(pipeline.canvas ?? FALLBACK_VIEWPORT);
    if (autoLevelChange(result.answer.report.detail, budget) !== null) run(pipeline.key);
  };

  return {
    run,
    measure(canvas) {
      const current = store.getState().pipeline.canvas;
      if (canvas?.width === current?.width && canvas?.height === current?.height) return;
      update({ canvas });
      check();
    },
    cancel() {
      running?.abort();
      running = null;
    },
    reset() {
      running?.abort();
      running = null;
      update({ key: '', result: null, pending: null, error: null, viewport: null });
    },
  };
}
