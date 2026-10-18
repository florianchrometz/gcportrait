// SPDX-License-Identifier: Apache-2.0
/**
 * Runs the timeline controller (controller.ts) while the component that calls it is mounted (the diagram page's
 * timeline bar), over the page's IndexedDB connection (the tick cache), the page's change signal of the tick cache
 * (the other tabs' stored and deleted days: storage/tickCacheChanges.ts), the sign-in (the token, in memory only) and
 * the import worker (the reads). Answers `retry(day)` for the bar's "Try again".
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';

import { useAuth } from '../auth';
import { useImportClient } from '../import/ImportWorkerProvider';
import { useAppStore } from '../state';
import { useDatabaseConnection } from '../storage/connection';
import { createTickCacheStore } from '../storage/tickCache';
import { tickCacheChanges } from '../storage/tickCacheChanges';
import { createTimelineController, type TimelineController } from './controller';
import { createTickFetcher } from './fetchTick';

export function useTimelineController(): (day: string) => void {
  const store = useAppStore();
  const { database } = useDatabaseConnection();
  const auth = useAuth();
  const worker = useImportClient();
  const cache = useMemo(() => createTickCacheStore(database), [database]);
  const controller = useRef<TimelineController | null>(null);

  useEffect(() => {
    const next = createTimelineController({
      store,
      cache,
      changes: tickCacheChanges(),
      fetchTick: createTickFetcher({ auth, worker, cache }),
    });
    controller.current = next;
    next.start();
    return () => {
      next.stop();
      if (controller.current === next) controller.current = null;
    };
  }, [store, cache, auth, worker]);

  return useCallback((day: string) => {
    controller.current?.retry(day);
  }, []);
}
