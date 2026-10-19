// SPDX-License-Identifier: Apache-2.0
/**
 * The variables of the commands on screen, in React: every field and every Copy button reads them here, so one
 * value per variable shows everywhere at once (commands/store.ts keeps what was typed, for the tab's session), over
 * the facts the app store knows (`connect`: the scope picked, the quota project, the signed-in account's email, the
 * instance's service account from /api/config; commands/values.ts, `commandFacts`). Outside the app store (a test
 * that renders a command alone) nothing is known and the fields start empty.
 */
import { useContext, useMemo, useSyncExternalStore } from 'react';

import type { AppState } from '../state';
import { AppStoreContext } from '../state/context';
import {
  checkVariable,
  clearVariables,
  getVariablesSnapshot,
  setVariable,
  subscribeVariables,
} from './store';
import {
  activeInvalidVariables,
  commandFacts,
  effectiveValues,
  hasActiveEntries,
  type Facts,
} from './values';

const NO_SUBSCRIPTION = (): (() => void) => () => undefined;

/** One value of the app store's state, or `fallback` outside it. The selector must return a primitive or a part. */
function useConnectFact<T>(selector: (state: AppState) => T, fallback: T): T {
  const store = useContext(AppStoreContext);
  return useSyncExternalStore(store?.subscribe ?? NO_SUBSCRIPTION, () =>
    store === null ? fallback : selector(store.getState()),
  );
}

/** What the app knows of the commands' variables now. */
export function useCommandFacts(): Facts {
  const scope = useConnectFact((state) => state.connect.scope, null);
  const quotaProject = useConnectFact((state) => state.connect.quotaProject, null);
  const email = useConnectFact((state) => state.connect.session.account?.email ?? null, null);
  const serviceAccount = useConnectFact((state) => {
    const backend = state.connect.backend;
    return backend.status === 'ready' && backend.config.saMode ? backend.config.backendServiceAccount : null;
  }, null);
  return useMemo(
    () => commandFacts({ scope, quotaProject, email, serviceAccount }),
    [scope, quotaProject, email, serviceAccount],
  );
}

export interface CommandVariables {
  /** Each variable's value: typed, else known ('' or absent: unfilled). */
  readonly values: Readonly<Record<string, string>>;
  /** Variables marked as not of their format. */
  readonly invalid: ReadonlySet<string>;
  /** Whether anything was typed (what "Clear values" would forget). */
  readonly typed: boolean;
  readonly set: (name: string, raw: string) => void;
  /** On leaving a field of `name`. */
  readonly check: (name: string) => void;
  readonly clear: () => void;
}

export function useCommandVariables(): CommandVariables {
  const facts = useCommandFacts();
  const { entries, invalid } = useSyncExternalStore(subscribeVariables, getVariablesSnapshot);
  return useMemo(() => {
    const values = effectiveValues(entries, facts);
    const known: Readonly<Record<string, string | undefined>> = facts;
    return {
      values,
      invalid: activeInvalidVariables(invalid, entries, facts),
      typed: hasActiveEntries(entries, facts),
      set: (name, raw) => {
        setVariable(name, raw, known[name]);
      },
      check: (name) => {
        checkVariable(name, values[name] ?? '');
      },
      clear: clearVariables,
    };
  }, [entries, invalid, facts]);
}
