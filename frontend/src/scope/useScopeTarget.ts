// SPDX-License-Identifier: Apache-2.0
/**
 * The scope and quota project the person picked (`connect.scope`, `connect.quotaProject` in the app store), shared
 * by the Connect page, the Permissions page and the live pull. Picking a scope also remembers it among the recent
 * scopes and brings back the quota project last picked for it; picking a quota project remembers it
 * for the scope. Both memories are this browser's preferences (scope/recent.ts).
 */
import { useCallback } from 'react';

import { useAppState, useAppStore } from '../state';
import { usePreference } from '../storage/preferences';
import { withQuotaProject, withRecent } from './recent';
import type { ScopeChoice } from './scopeName';

const NO_RECENT: readonly ScopeChoice[] = [];
const NO_QUOTA_PROJECTS: Readonly<Record<string, string>> = {};

export interface ScopeTarget {
  readonly scope: ScopeChoice | null;
  readonly quotaProject: string | null;
  readonly recent: readonly ScopeChoice[];
  readonly chooseScope: (choice: ScopeChoice | null) => void;
  readonly chooseQuotaProject: (project: string | null) => void;
}

export function useScopeTarget(): ScopeTarget {
  const store = useAppStore();
  const scope = useAppState((state) => state.connect.scope);
  const quotaProject = useAppState((state) => state.connect.quotaProject);
  const [recent, setRecent] = usePreference('recentScopes', NO_RECENT);
  const [quotaProjects, setQuotaProjects] = usePreference('quotaProjects', NO_QUOTA_PROJECTS);

  const chooseScope = useCallback(
    (choice: ScopeChoice | null): void => {
      store.updateConnect((connect) => ({
        ...connect,
        scope: choice,
        quotaProject: choice === null ? null : (quotaProjects[choice.scope] ?? null),
      }));
      if (choice !== null) setRecent(withRecent(recent, choice));
    },
    [store, quotaProjects, recent, setRecent],
  );

  const chooseQuotaProject = useCallback(
    (project: string | null): void => {
      store.updateConnect((connect) => ({ ...connect, quotaProject: project }));
      if (scope !== null) setQuotaProjects(withQuotaProject(quotaProjects, scope.scope, project));
    },
    [store, scope, quotaProjects, setQuotaProjects],
  );

  return { scope, quotaProject, recent, chooseScope, chooseQuotaProject };
}
