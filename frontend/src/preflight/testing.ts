// SPDX-License-Identifier: MIT
/**
 * Preflight answers as the backend writes them (backend/src/preflight/schemas.ts), and the app store's `connect`
 * slice once a check found a scope ready, for the tests. Synthetic only (agents.md, Data and graph semantics):
 * `demo-` project ids, example.com. Imported by tests only.
 */
import { signedInSession } from '../auth/testing';
import type { ScopeChoice } from '../scope/scopeName';
import type { ConnectSlice } from '../state/slices';
import type { PreflightAnswer } from './api';

/** The scope the ready answer is for: the demo organisation example.com. */
export const READY_SCOPE: ScopeChoice = {
  kind: 'organization',
  scope: 'organizations/30000000001',
  id: '30000000001',
};

/** A check that found example.com ready to read with the account's own permissions, on demo-quota-1's quota. */
export const READY_ANSWER: PreflightAnswer = {
  scope: READY_SCOPE.scope,
  kind: 'organization',
  mode: 'user',
  outcome: 'ready',
  displayName: 'example.com',
  quotaProject: 'demo-quota-1',
  items: [],
  candidates: [],
};

/** The `connect` slice of ada@example.com signed in, with `scope` (by default example.com) checked and ready. */
export function readyConnect(scope: ScopeChoice = READY_SCOPE): ConnectSlice {
  return {
    backend: { status: 'loading' },
    session: signedInSession(),
    mode: 'user',
    scope,
    quotaProject: null,
    preflight: {
      status: 'done',
      request: { scope: scope.scope, mode: 'user' },
      answer: { ...READY_ANSWER, scope: scope.scope },
    },
  };
}

/** An answer as the backend writes it (backend/src/preflight/schemas.ts), for projects/demo-app-1. */
export const BLOCKED_ANSWER: PreflightAnswer = {
  scope: 'projects/demo-app-1',
  kind: 'project',
  mode: 'user',
  outcome: 'blocked',
  displayName: 'Demo app 1',
  quotaProject: 'demo-quota-1',
  member: 'user:ada@example.com',
  items: [
    {
      id: 'scope-details',
      status: 'ok',
      finding: 'ok',
      blocking: false,
      permission: 'resourcemanager.projects.get',
      role: 'roles/browser',
      member: 'user:ada@example.com',
      resource: 'projects/demo-app-1',
      commands: [],
    },
    {
      id: 'quota-project',
      status: 'ok',
      finding: 'ok',
      blocking: true,
      permission: 'serviceusage.services.use',
      role: 'roles/serviceusage.serviceUsageConsumer',
      member: 'user:ada@example.com',
      resource: 'projects/demo-quota-1',
      commands: [],
    },
    {
      id: 'cai-access',
      status: 'missing',
      finding: 'denied',
      blocking: true,
      permission: 'cloudasset.assets.listResource',
      role: 'roles/cloudasset.viewer',
      member: 'user:ada@example.com',
      resource: 'projects/demo-app-1',
      commands: [
        'gcloud projects add-iam-policy-binding demo-app-1 --member="user:ada@example.com" --role="roles/cloudasset.viewer"',
      ],
      upstream: { status: 403, code: 'PERMISSION_DENIED', message: 'Request denied by Cloud IAM.' },
    },
  ],
  candidates: [
    {
      project: 'demo-app-1',
      source: 'scope',
      result: 'api-disabled',
      commands: ['gcloud services enable cloudasset.googleapis.com --project=demo-app-1'],
      upstream: { status: 403, code: 'PERMISSION_DENIED', reason: 'SERVICE_DISABLED' },
    },
    { project: 'demo-quota-1', source: 'chosen', result: 'usable', commands: [] },
  ],
};
