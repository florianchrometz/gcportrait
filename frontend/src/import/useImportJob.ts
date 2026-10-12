// SPDX-License-Identifier: MIT
/**
 * One live pull or export read at a time, for a Connect page control: its progress (progress.ts, ticking each
 * second while it runs, for the elapsed time), Cancel, and what follows success: the diagram opens on the new
 * snapshot (`actions.setSnapshot`), at once, or after the person has read the notes the import left (lines left
 * out, an estimated read time). Leaving the page cancels a running import; nothing is stored then.
 */
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import { useAuth } from '../auth';
import { useSnapshotLibrary } from '../snapshots/SnapshotLibraryProvider';
import { useDiagramActions } from '../state';
import { useImportClient } from './ImportWorkerProvider';
import { IDLE_PROGRESS, importProgressReducer, isRunning, type ImportProgress } from './progress';
import type { ImportDependencies, Imported } from './run';

export type ImportRunner = (
  dependencies: ImportDependencies,
  dispatch: (action: Parameters<typeof importProgressReducer>[1]) => void,
  signal: AbortSignal,
) => Promise<Imported | null>;

export interface ImportJob {
  readonly progress: ImportProgress;
  /** Notes about the stored snapshot, shown before the diagram opens. */
  readonly notes: readonly string[];
  readonly running: boolean;
  readonly start: (runner: ImportRunner) => void;
  readonly cancel: () => void;
  /** Opens the diagram on the stored snapshot (after the notes). */
  readonly openResult: () => void;
}

const TICK_MS = 1000;

export function useImportJob(): ImportJob {
  const auth = useAuth();
  const library = useSnapshotLibrary();
  const worker = useImportClient();
  const { setSnapshot } = useDiagramActions();
  const [progress, dispatch] = useReducer(importProgressReducer, IDLE_PROGRESS);
  const [notes, setNotes] = useState<readonly string[]>([]);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const running = isRunning(progress);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      dispatch({ type: 'tick', at: Date.now() });
    }, TICK_MS);
    return () => {
      clearInterval(timer);
    };
  }, [running]);

  const start = useCallback(
    (runner: ImportRunner): void => {
      if (controller.current !== null) return;
      const job = new AbortController();
      controller.current = job;
      setNotes([]);
      const safeDispatch = (action: Parameters<typeof importProgressReducer>[1]): void => {
        if (mounted.current) dispatch(action);
      };
      void runner({ auth, library, worker }, safeDispatch, job.signal)
        .then((imported) => {
          if (!mounted.current || imported === null) return;
          if (imported.warnings.length === 0) setSnapshot(imported.ref);
          else setNotes(imported.warnings);
        })
        .finally(() => {
          if (controller.current === job) controller.current = null;
        });
    },
    [auth, library, worker, setSnapshot],
  );

  const cancel = useCallback((): void => {
    controller.current?.abort();
  }, []);

  const openResult = useCallback((): void => {
    if (progress.result !== null) setSnapshot(progress.result.ref);
  }, [progress.result, setSnapshot]);

  return { progress, notes, running, start, cancel, openResult };
}
