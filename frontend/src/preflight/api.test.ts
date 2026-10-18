// @vitest-environment node
// SPDX-License-Identifier: MIT
/**
 * POST /api/preflight's guard (preflight/api.ts) against the contract it checks by hand, `PreflightResponseSchema`
 * in @gcportrait/model, which the backend answers with: every answer one accepts the other does too, and the guard
 * reads its closed lists from the model's zod-free vocabulary. zod is loaded here only, in the test.
 */
import {
  PREFLIGHT_FINDINGS,
  PREFLIGHT_ITEM_IDS,
  PREFLIGHT_OUTCOMES,
  PreflightResponseSchema,
  QUOTA_CANDIDATE_RESULTS,
  UpstreamSummarySchema,
} from '@gcportrait/model';
import { describe, expect, it } from 'vitest';

import { isPreflightAnswer, isUpstreamSummary, type PreflightAnswer } from './api';
import { BLOCKED_ANSWER, READY_ANSWER } from './testing';

const [ITEM] = BLOCKED_ANSWER.items;
const [CANDIDATE] = BLOCKED_ANSWER.candidates;
if (ITEM === undefined || CANDIDATE === undefined)
  throw new Error('BLOCKED_ANSWER lists an item and a candidate.');

const SA_ANSWER: PreflightAnswer = {
  scope: 'folders/20000000001',
  kind: 'folder',
  mode: 'sa',
  outcome: 'blocked',
  member: 'user:ada@example.com',
  serviceAccount: 'gcportrait-backend@demo-host.iam.gserviceaccount.com',
  items: [
    {
      id: 'sa-exposure',
      status: 'missing',
      finding: 'exposed',
      blocking: true,
      permission: 'resourcemanager.folders.get',
      member: 'serviceAccount:gcportrait-backend@demo-host.iam.gserviceaccount.com',
      resource: 'folders/20000000001',
      commands: [],
    },
  ],
  candidates: [],
};

function withItem(fields: Record<string, unknown>): Record<string, unknown> {
  return { ...BLOCKED_ANSWER, items: [{ ...ITEM, ...fields }] };
}

function withCandidate(fields: Record<string, unknown>): Record<string, unknown> {
  return { ...BLOCKED_ANSWER, candidates: [{ ...CANDIDATE, ...fields }] };
}

function without(record: object, field: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => key !== field));
}

const ANSWERS: ReadonlyArray<readonly [string, unknown]> = [
  ['a blocked user-mode answer', BLOCKED_ANSWER],
  ['a ready answer', READY_ANSWER],
  ['a service-account answer', SA_ANSWER],
  ...PREFLIGHT_OUTCOMES.map((outcome) => [`the outcome ${outcome}`, { ...READY_ANSWER, outcome }] as const),
  ...PREFLIGHT_ITEM_IDS.map((id) => [`the item ${id}`, withItem({ id })] as const),
  ...PREFLIGHT_FINDINGS.map((finding) => [`the finding ${finding}`, withItem({ finding })] as const),
  ...QUOTA_CANDIDATE_RESULTS.map(
    (result) => [`the candidate result ${result}`, withCandidate({ result })] as const,
  ),
  ...Object.keys(BLOCKED_ANSWER).map(
    (field) => [`an answer without ${field}`, without(BLOCKED_ANSWER, field)] as const,
  ),
  ...Object.keys(ITEM).map(
    (field) => [`an item without ${field}`, { ...BLOCKED_ANSWER, items: [without(ITEM, field)] }] as const,
  ),
  ...Object.keys(CANDIDATE).map(
    (field) =>
      [
        `a candidate without ${field}`,
        { ...BLOCKED_ANSWER, candidates: [without(CANDIDATE, field)] },
      ] as const,
  ),
  ['an unknown mode', { ...READY_ANSWER, mode: 'robot' }],
  ['an unknown outcome', { ...READY_ANSWER, outcome: 'maybe' }],
  ['an unknown kind', { ...READY_ANSWER, kind: 'billingAccount' }],
  ['an unknown item', withItem({ id: 'nope' })],
  ['an unknown status', withItem({ status: 'fine' })],
  ['an unknown finding', withItem({ finding: 'nope' })],
  ['a blocking flag that is not a boolean', withItem({ blocking: 'yes' })],
  ['commands that are not text', withItem({ commands: [1] })],
  ['a role that is not text', withItem({ role: 1 })],
  ['an upstream without a status', withItem({ upstream: {} })],
  ['an upstream status that is not an integer', withItem({ upstream: { status: 403.5 } })],
  ['an upstream reason that is not text', withItem({ upstream: { status: 403, reason: 7 } })],
  ['an unknown candidate source', withCandidate({ source: 'x' })],
  ['an unknown candidate result', withCandidate({ result: 'fine' })],
  ['a display name that is not text', { ...READY_ANSWER, displayName: 1 }],
  ['a service account that is not text', { ...SA_ANSWER, serviceAccount: null }],
  ['items that are not a list', { ...READY_ANSWER, items: {} }],
  ['an array', [READY_ANSWER]],
  ['text', 'ok'],
  ['null', null],
];

describe('the preflight answer guard', () => {
  it.each(ANSWERS)('agrees with the model’s schema on %s', (_case, answer) => {
    expect(isPreflightAnswer(answer)).toBe(PreflightResponseSchema.safeParse(answer).success);
  });

  it('accepts what the backend answers and refuses an item without its finding', () => {
    expect(isPreflightAnswer(BLOCKED_ANSWER)).toBe(true);
    expect(isPreflightAnswer(SA_ANSWER)).toBe(true);
    expect(isPreflightAnswer({ ...BLOCKED_ANSWER, items: [without(ITEM, 'finding')] })).toBe(false);
  });
});

describe('the upstream summary guard', () => {
  it.each<[string, unknown]>([
    [
      'a full summary',
      { status: 403, code: 'PERMISSION_DENIED', reason: 'IAM_PERMISSION_DENIED', message: 'No.' },
    ],
    ['no answer', { status: 0 }],
    ['a status that is text', { status: '403' }],
    ['a message that is not text', { status: 500, message: false }],
    ['null', null],
  ])('agrees with the model’s schema on %s', (_case, summary) => {
    expect(isUpstreamSummary(summary)).toBe(UpstreamSummarySchema.safeParse(summary).success);
  });
});
