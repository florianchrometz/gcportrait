// SPDX-License-Identifier: Apache-2.0
/**
 * What "Pull now" pulls: the scope picked on the Connect page, read in the mode chosen, once the
 * permission check (the preflight) says it is ready for exactly that scope, mode and quota project. In user
 * mode the quota project is the one the check found usable (required, never the instance's own; AGENTS.md,
 * Security and privacy, Quota project and the permission check).
 * Until then the button says what is missing. Pure: reads the app store's `connect` slice.
 */
import { sameRequest } from '../preflight/state';
import type { ConnectSlice } from '../state/slices';
import type { PullTarget } from './run';

export type PullReadiness =
  | { readonly target: PullTarget }
  /** `check`: the permission check (the Permissions page) is what is missing. */
  | { readonly blocked: string; readonly check?: true };

export function pullTargetOf(connect: ConnectSlice): PullReadiness {
  if (connect.session.status !== 'signed-in') return { blocked: 'Sign in with Google first' };
  const { scope, mode, preflight } = connect;
  if (scope === null) return { blocked: 'Choose a scope first' };
  const current = {
    scope: scope.scope,
    mode,
    ...(mode === 'user' && connect.quotaProject !== null ? { quotaProject: connect.quotaProject } : {}),
  };
  if (preflight.status === 'idle')
    return { blocked: 'Check the permissions for this scope first', check: true };
  if (!sameRequest(preflight.request, current))
    return { blocked: 'Check the permissions again for this choice', check: true };
  if (preflight.status === 'checking') return { blocked: 'The permissions are being checked' };
  if (preflight.status === 'failed')
    return { blocked: 'The permission check did not finish; check again', check: true };
  const { answer } = preflight;
  if (answer.outcome !== 'ready')
    return { blocked: 'The permission check found something missing', check: true };
  if (mode === 'user' && answer.quotaProject === undefined)
    return { blocked: 'The permission check found no quota project to use', check: true };
  const displayName = answer.displayName ?? scope.displayName;
  return {
    target: {
      scope:
        displayName === undefined
          ? { kind: scope.kind, id: scope.id }
          : { kind: scope.kind, id: scope.id, displayName },
      mode,
      ...(mode === 'user' && answer.quotaProject !== undefined ? { quotaProject: answer.quotaProject } : {}),
    },
  };
}
