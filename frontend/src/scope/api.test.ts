// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
/**
 * POST /api/scopes/search's guard (scope/api.ts) against the contract it checks by hand,
 * `ScopeSearchResponseSchema` in @gcportrait/model, which the backend answers with: every answer one accepts the
 * other does too. zod is loaded here only, in the test.
 */
import { ScopeSearchResponseSchema, type ScopeSearchResponse } from '@gcportrait/model';
import { describe, expect, it } from 'vitest';

import { isScopeSearchAnswer } from './api';

const PROJECT = {
  kind: 'project',
  scope: 'projects/demo-web-1',
  id: 'demo-web-1',
  displayName: 'Web',
  parent: 'folders/20000000001',
  projectNumber: '10000000001',
} as const;

const PROBLEM = { kind: 'folder', upstream: { status: 503, code: 'UNAVAILABLE' } } as const;

const ANSWER: ScopeSearchResponse = {
  scopes: [
    {
      kind: 'organization',
      scope: 'organizations/30000000001',
      id: '30000000001',
      displayName: 'example.com',
    },
    PROJECT,
  ],
  nextPageToken: 'eyJmb2xkZXIiOiJhYmMifQ',
  problems: [PROBLEM],
};

function without(record: object, field: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => key !== field));
}

const ANSWERS: ReadonlyArray<readonly [string, unknown]> = [
  ['an answer with results, a next page and a problem', ANSWER],
  ['the last page, nothing found', { scopes: [], problems: [] }],
  ...Object.keys(ANSWER).map((field) => [`an answer without ${field}`, without(ANSWER, field)] as const),
  ...Object.keys(PROJECT).map(
    (field) => [`a result without ${field}`, { ...ANSWER, scopes: [without(PROJECT, field)] }] as const,
  ),
  ['a result of an unknown kind', { ...ANSWER, scopes: [{ ...PROJECT, kind: 'billingAccount' }] }],
  ['a display name that is not text', { ...ANSWER, scopes: [{ ...PROJECT, displayName: null }] }],
  ['a project number that is a number', { ...ANSWER, scopes: [{ ...PROJECT, projectNumber: 10000000001 }] }],
  ['a result that is text', { ...ANSWER, scopes: ['projects/demo-web-1'] }],
  ['a page token that is not text', { ...ANSWER, nextPageToken: 1 }],
  ['a problem of an unknown kind', { ...ANSWER, problems: [{ ...PROBLEM, kind: 'x' }] }],
  ['a problem without what Google answered', { ...ANSWER, problems: [{ kind: 'folder' }] }],
  [
    'a problem whose status is text',
    { ...ANSWER, problems: [{ kind: 'folder', upstream: { status: '503' } }] },
  ],
  ['results that are not a list', { ...ANSWER, scopes: {} }],
  ['an array', [ANSWER]],
  ['null', null],
];

describe('the scope search answer guard', () => {
  it.each(ANSWERS)('agrees with the model’s schema on %s', (_case, answer) => {
    expect(isScopeSearchAnswer(answer)).toBe(ScopeSearchResponseSchema.safeParse(answer).success);
  });

  it('accepts what the backend answers and refuses a result without its scope', () => {
    expect(isScopeSearchAnswer(ANSWER)).toBe(true);
    expect(isScopeSearchAnswer({ ...ANSWER, scopes: [without(PROJECT, 'scope')] })).toBe(false);
  });
});
