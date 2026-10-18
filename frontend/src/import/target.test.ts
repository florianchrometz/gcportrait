// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';

import { signedInSession } from '../auth/testing';
import { SIGNED_OUT_SESSION } from '../auth/types';
import type { PreflightAnswer } from '../preflight/api';
import { READY_ANSWER, READY_SCOPE as SCOPE, readyConnect } from '../preflight/testing';
import type { ConnectSlice } from '../state/slices';
import { pullTargetOf } from './target';

/** The ready answer with `overrides`, and without the fields `without` names. */
function answer(
  overrides: Partial<PreflightAnswer> = {},
  without: readonly (keyof PreflightAnswer)[] = [],
): PreflightAnswer {
  const full: Record<string, unknown> = { ...READY_ANSWER, ...overrides };
  const kept = Object.fromEntries(
    Object.entries(full).filter(([key]) => !(without as readonly string[]).includes(key)),
  );
  return kept as unknown as PreflightAnswer;
}

function connect(overrides: Partial<ConnectSlice> = {}): ConnectSlice {
  return { ...readyConnect(), ...overrides };
}

describe('pullTargetOf', () => {
  it('pulls the scope the check found ready, with the quota project it found usable', () => {
    expect(pullTargetOf(connect())).toEqual({
      target: {
        scope: { kind: 'organization', id: '30000000001', displayName: 'example.com' },
        mode: 'user',
        quotaProject: 'demo-quota-1',
      },
    });
  });

  it('sends no quota project in service-account mode', () => {
    const ready = connect({
      mode: 'sa',
      preflight: {
        status: 'done',
        request: { scope: SCOPE.scope, mode: 'sa' },
        answer: answer({ mode: 'sa' }, ['quotaProject', 'displayName']),
      },
    });
    expect(pullTargetOf(ready)).toEqual({
      target: { scope: { kind: 'organization', id: '30000000001' }, mode: 'sa' },
    });
  });

  it.each<readonly [string, string, Partial<ConnectSlice>]>([
    ['nobody signed in', 'Sign in with Google first', { session: SIGNED_OUT_SESSION }],
    ['the sign-in expired', 'Sign in with Google first', { session: signedInSession({ status: 'expired' }) }],
    ['no scope chosen', 'Choose a scope first', { scope: null }],
    [
      'the scope not checked',
      'Check the permissions for this scope first',
      { preflight: { status: 'idle' } },
    ],
    ['another mode chosen since the check', 'Check the permissions again for this choice', { mode: 'sa' }],
    [
      'another quota project chosen since the check',
      'Check the permissions again for this choice',
      { quotaProject: 'demo-other-1' },
    ],
    [
      'another scope chosen since the check',
      'Check the permissions again for this choice',
      { scope: { kind: 'project', scope: 'projects/demo-app-1', id: 'demo-app-1' } },
    ],
    [
      'the check running',
      'The permissions are being checked',
      { preflight: { status: 'checking', request: { scope: SCOPE.scope, mode: 'user' } } },
    ],
    [
      'the check failed',
      'The permission check did not finish; check again',
      { preflight: { status: 'failed', request: { scope: SCOPE.scope, mode: 'user' }, message: 'offline' } },
    ],
    [
      'the check found something missing',
      'The permission check found something missing',
      {
        preflight: {
          status: 'done',
          request: { scope: SCOPE.scope, mode: 'user' },
          answer: answer({ outcome: 'blocked' }),
        },
      },
    ],
  ])('with %s, says "%s"', (_what, blocked, overrides) => {
    // Everything after the scope is the permission check's to settle, and the button links it.
    const check = !/^(?:Sign in|Choose|The permissions are being)/.test(blocked);
    expect(pullTargetOf(connect(overrides))).toEqual(check ? { blocked, check: true } : { blocked });
  });
});
