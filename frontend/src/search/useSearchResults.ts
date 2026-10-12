// SPDX-License-Identifier: MIT
/**
 * The search box's results: the text, once typing pauses (`SEARCH_DEBOUNCE_MS`), goes to the data worker, which
 * searches the index of the view's snapshot on the day on screen (service.ts; the request names the day, so a search
 * typed on 17 September finds what 17 September holds); a newer text, or another day, supersedes the older request,
 * in the page and in the worker. While a newer answer is on its way (`pending`) the previous one stays listed, so
 * the list does not flicker, but only as the combobox's `busy` options: greyed, never active, never chosen, and its
 * count is not announced. `prepare()` asks the worker to build the index ahead of the first query (the box calls it
 * on focus).
 */
import type { SnapshotRef } from '@gcportrait/model';
import { useCallback, useEffect, useRef, useState } from 'react';

import { isDataCancelled } from '../diagram/pipeline/dataClient';
import { useDiagramSession } from '../diagram/session';
import type { SearchAnswer, SearchHit, SearchKind } from './protocol';

/**
 * The hits grouped by kind for the list: the kinds in the order of their best hit, each kind's hits in rank
 * order. The best hit stays first, and the keys move through the list in the order it shows.
 */
export function groupHits(hits: readonly SearchHit[]): SearchHit[] {
  const byKind = new Map<SearchKind, SearchHit[]>();
  for (const hit of hits) {
    const group = byKind.get(hit.kind);
    if (group === undefined) byKind.set(hit.kind, [hit]);
    else group.push(hit);
  }
  return [...byKind.values()].flat();
}

/** How long typing must pause before the text is searched (ms). */
export const SEARCH_DEBOUNCE_MS = 120;
/** How many results are listed at most. */
export const SEARCH_LIMIT = 20;

export interface SearchResults {
  /** The latest answer for this snapshot (the current text's, or the previous text's while `pending`). */
  readonly answer: SearchAnswer | null;
  /** The text has changed since that answer; a new one is on its way. */
  readonly pending: boolean;
  /** Why the search failed, if it did. */
  readonly error: string | null;
  /** Builds the snapshot's index in the worker ahead of the first query. */
  readonly prepare: () => void;
}

interface Answered {
  readonly snapshot: SnapshotRef;
  /** The day searched: a tick, or `''` for the snapshot's own day. */
  readonly day: string;
  readonly text: string;
  readonly answer: SearchAnswer | null;
  readonly error: string | null;
}

const NONE: Answered = { snapshot: '', day: '', text: '', answer: null, error: null };

/**
 * `day`: the day on screen (`selectDrawnDay`: a tick, or null for the snapshot's own day), whose Graph the
 * worker searches.
 */
export function useSearchResults(
  snapshot: SnapshotRef,
  day: string | null,
  text: string,
  enabled: boolean,
): SearchResults {
  const { workers } = useDiagramSession();
  const [answered, setAnswered] = useState<Answered>(NONE);
  const prepared = useRef<string | null>(null);
  const query = text.trim();
  const active = enabled && snapshot !== '' && query !== '';
  const dayKey = day ?? '';

  useEffect(() => {
    if (!active) return undefined;
    const data = workers()?.data;
    if (data === undefined) return undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const ask = {
        snapshot,
        day: { tick: dayKey === '' ? null : dayKey },
        text: query,
        limit: SEARCH_LIMIT,
      };
      data.search(ask, { signal: controller.signal }).then(
        (answer) => {
          setAnswered({ snapshot, day: dayKey, text: query, answer, error: null });
        },
        (error: unknown) => {
          if (isDataCancelled(error)) return;
          const message = error instanceof Error ? error.message : String(error);
          setAnswered({ snapshot, day: dayKey, text: query, answer: null, error: message });
        },
      );
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [active, snapshot, dayKey, query, workers]);

  const prepare = useCallback((): void => {
    // Only before the first query: a search request supersedes the one before it, and a query builds the index.
    const which = `${snapshot}\u0000${dayKey}`;
    if (!enabled || snapshot === '' || query !== '' || prepared.current === which) return;
    const data = workers()?.data;
    if (data === undefined) return;
    prepared.current = which;
    data.search({ snapshot, day: { tick: dayKey === '' ? null : dayKey }, text: '', limit: 1 }).catch(() => {
      // Superseded by the first real query (which builds the index itself) or failed: try again next time.
      if (prepared.current === which) prepared.current = null;
    });
  }, [enabled, snapshot, dayKey, query, workers]);

  const same = active && answered.snapshot === snapshot && answered.day === dayKey;
  return {
    answer: same ? answered.answer : null,
    pending: active && (!same || answered.text !== query),
    error: same && answered.text === query ? answered.error : null,
    prepare,
  };
}
