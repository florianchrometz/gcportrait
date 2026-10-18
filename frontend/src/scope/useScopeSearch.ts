// SPDX-License-Identifier: Apache-2.0
/**
 * The scope picker's search: asks `/api/scopes/search` for what the person typed, 250 ms after they stop typing,
 * cancelling the request a newer text supersedes. Answers are kept per text for the life of the picker, so going
 * back to a text shows its results at once. Nothing is searched while `enabled` is false (signed out).
 */
import { useEffect, useRef, useState } from 'react';

import { useAuth } from '../auth';
import { searchScopes, type ScopeSearchOutcome, type SearchProblem } from './api';
import type { ScopeChoice, ScopeKind } from './scopeName';

export const SEARCH_DEBOUNCE_MS = 250;

export type ScopeSearchState =
  | { readonly status: 'idle' }
  | { readonly status: 'searching'; readonly text: string }
  | {
      readonly status: 'done';
      readonly text: string;
      readonly scopes: readonly ScopeChoice[];
      readonly problems: readonly SearchProblem[];
      /** More results exist than were listed (the person can narrow the text). */
      readonly more: boolean;
    }
  | { readonly status: 'signed-out' }
  | { readonly status: 'error'; readonly text: string; readonly message: string };

function stateOf(text: string, outcome: ScopeSearchOutcome): ScopeSearchState {
  switch (outcome.kind) {
    case 'ok':
      return {
        status: 'done',
        text,
        scopes: outcome.scopes,
        problems: outcome.problems,
        more: outcome.nextPageToken !== undefined,
      };
    case 'signed-out':
      return { status: 'signed-out' };
    case 'error':
      return { status: 'error', text, message: outcome.message };
  }
}

export function useScopeSearch(
  text: string,
  options: { readonly kinds?: readonly ScopeKind[]; readonly enabled: boolean; readonly active: boolean },
): ScopeSearchState {
  const auth = useAuth();
  const [state, setState] = useState<ScopeSearchState>({ status: 'idle' });
  const cache = useRef(new Map<string, ScopeSearchState>());
  const kindsKey = options.kinds === undefined ? 'all' : options.kinds.join(',');
  const query = text.trim();

  useEffect(() => {
    if (!options.enabled || !options.active) return undefined;
    const key = `${kindsKey}|${query}`;
    const cached = cache.current.get(key);
    if (cached !== undefined) {
      setState(cached);
      return undefined;
    }
    setState({ status: 'searching', text: query });
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const kinds = kindsKey === 'all' ? undefined : (kindsKey.split(',') as ScopeKind[]);
      searchScopes(auth, { query, ...(kinds === undefined ? {} : { kinds }) }, controller.signal).then(
        (outcome) => {
          if (controller.signal.aborted) return;
          const next = stateOf(query, outcome);
          if (next.status === 'done') cache.current.set(key, next);
          setState(next);
        },
        () => {
          // Aborted by a newer text: that text's search reports instead.
        },
      );
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [auth, query, kindsKey, options.enabled, options.active]);

  return options.enabled ? state : { status: 'signed-out' };
}
