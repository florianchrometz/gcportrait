// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
/**
 * The preflight's client side: the answer's guard, the request (path, method, body, token), the error answers,
 * and the words for every item and finding (docs/permissions.md).
 */
import { PREFLIGHT_FINDINGS, PREFLIGHT_ITEM_IDS } from '@gcportrait/model';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { testAuth } from '../auth/testing';
import { stubBackend } from '../test/backend';
import { isPreflightAnswer, readError, requestPreflight, type PreflightItem } from './api';
import { purposeOf } from './CommandBlock';
import { explainCandidate, explainItem, outcomeHeadline, refusal, serviceAccountParagraphs } from './copy';
import { referenceRows } from './PermissionsGuide';
import { sameRequest } from './state';
import { BLOCKED_ANSWER } from './testing';

const TOKEN = 'unit-test-token-1';

const auth = (token: string | null = TOKEN): ReturnType<typeof testAuth> => testAuth(token);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isPreflightAnswer', () => {
  it('accepts the backend’s answer', () => {
    expect(isPreflightAnswer(BLOCKED_ANSWER)).toBe(true);
    expect(isPreflightAnswer({ ...BLOCKED_ANSWER, candidates: [] })).toBe(true);
  });

  it.each([
    ['a missing items list', { ...BLOCKED_ANSWER, items: undefined }],
    ['an unknown outcome', { ...BLOCKED_ANSWER, outcome: 'maybe' }],
    ['an unknown kind', { ...BLOCKED_ANSWER, kind: 'billingAccount' }],
    ['an unknown item', { ...BLOCKED_ANSWER, items: [{ ...BLOCKED_ANSWER.items[0], id: 'nope' }] }],
    ['an unknown finding', { ...BLOCKED_ANSWER, items: [{ ...BLOCKED_ANSWER.items[0], finding: 'nope' }] }],
    [
      'commands that are not text',
      { ...BLOCKED_ANSWER, items: [{ ...BLOCKED_ANSWER.items[0], commands: [1] }] },
    ],
    [
      'an upstream without a status',
      { ...BLOCKED_ANSWER, items: [{ ...BLOCKED_ANSWER.items[2], upstream: {} }] },
    ],
    [
      'an unknown candidate source',
      { ...BLOCKED_ANSWER, candidates: [{ ...BLOCKED_ANSWER.candidates[0], source: 'x' }] },
    ],
    ['not an object', 'ok'],
  ])('refuses %s', (_label, value) => {
    expect(isPreflightAnswer(value)).toBe(false);
  });
});

describe('requestPreflight', () => {
  // The token in gcportrait's own header, never in Authorization or the URL: auth/fetch.test.ts.
  it('posts the request as JSON to /api/preflight, and reads the answer', async () => {
    const { calls } = stubBackend({ routes: { '/api/preflight': () => Response.json(BLOCKED_ANSWER) } });
    const outcome = await requestPreflight(auth(), {
      scope: 'projects/demo-app-1',
      mode: 'user',
      quotaProject: 'demo-quota-1',
    });
    expect(outcome).toEqual({ kind: 'answer', answer: BLOCKED_ANSWER });
    expect(calls.map(({ url, init, body }) => [url, init?.method, body])).toEqual([
      [
        '/api/preflight',
        'POST',
        { scope: 'projects/demo-app-1', mode: 'user', quotaProject: 'demo-quota-1' },
      ],
    ]);
  });

  it('is signed out without a token, and never calls the backend', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(await requestPreflight(auth(null), { scope: 'projects/demo-app-1', mode: 'user' })).toEqual({
      kind: 'signed-out',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('tells the session about a 401', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(Response.json({ message: 'Sign in again.' }, { status: 401 })),
    );
    const controls = auth();
    expect(await requestPreflight(controls, { scope: 'projects/demo-app-1', mode: 'user' })).toEqual({
      kind: 'signed-out',
    });
    expect(controls.rejectedTokens).toEqual([TOKEN]);
  });

  it.each([
    [
      400,
      { message: 'Invalid request: scope: must be organizations/ID, folders/ID or projects/ID_OR_NUMBER.' },
      /^Invalid request/,
    ],
    [
      403,
      { message: 'Service-account mode is off on this gcportrait instance.' },
      /^Service-account mode is off/,
    ],
    [429, { message: 'x' }, /^Too many requests/],
    [500, { message: 'Internal error.' }, /HTTP 500/],
  ])('words a %s answer', async (status, body, expected) => {
    vi.stubGlobal('fetch', () => Promise.resolve(Response.json(body, { status })));
    const outcome = await requestPreflight(auth(), { scope: 'projects/demo-app-1', mode: 'user' });
    expect(outcome.kind).toBe('error');
    expect(outcome.kind === 'error' ? outcome.message : '').toMatch(expected);
  });

  it('refuses an answer that does not fit, and survives a dropped connection', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(Response.json({ items: 'x' })));
    expect((await requestPreflight(auth(), { scope: 'projects/demo-app-1', mode: 'user' })).kind).toBe(
      'error',
    );
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
    expect(await requestPreflight(auth(), { scope: 'projects/demo-app-1', mode: 'user' })).toEqual({
      kind: 'error',
      message: 'The backend did not answer. Check your connection and try again.',
    });
  });

  it('reads error bodies without trusting them', () => {
    expect(readError(400, null)).toBe('The backend could not answer (HTTP 400). Try again.');
    expect(readError(502, { message: 'Google did not answer the search; try again.' })).toMatch(/HTTP 502/);
  });
});

describe('the words', () => {
  const base: PreflightItem = {
    id: 'cai-access',
    status: 'unknown',
    finding: 'ok',
    blocking: true,
    permission: 'p',
    resource: 'projects/demo-app-1',
    commands: [],
  };

  it('has a sentence for every item and finding', () => {
    for (const id of PREFLIGHT_ITEM_IDS) {
      for (const finding of PREFLIGHT_FINDINGS) {
        const text = explainItem(
          { ...base, id, finding },
          { scope: 'projects/demo-app-1', quotaProject: 'demo-quota-1' },
        );
        expect(text.length, `${id}/${finding}`).toBeGreaterThan(10);
      }
    }
  });

  it('says what each finding means and what to do', () => {
    const answer = { scope: 'folders/20000000001', quotaProject: 'demo-quota-1' };
    expect(explainItem({ ...base, id: 'cai-access', finding: 'denied' }, answer)).toBe(
      'You cannot list assets in folders/20000000001, or it does not exist.',
    );
    expect(explainItem({ ...base, id: 'scope-details', finding: 'denied' }, answer)).toMatch(
      /^You cannot see folders\/20000000001’s details, so gcportrait shows ids instead of names/,
    );
    expect(explainItem({ ...base, id: 'quota-project', finding: 'ok' }, answer)).toBe(
      'Requests use the quota of demo-quota-1.',
    );
    expect(explainItem({ ...base, finding: 'sign-in' }, answer)).toBe(
      'Sign in again and allow gcportrait to read Cloud Asset Inventory.',
    );
    expect(explainItem({ ...base, id: 'sa-exposure', finding: 'exposed' }, answer)).toMatch(
      /for example because they are public, so service-account mode is refused for folders\/20000000001\.$/,
    );
    expect(
      explainCandidate({ project: 'demo-q', source: 'chosen', result: 'api-disabled', commands: [] }),
    ).toBe('The Cloud Asset API is not enabled in demo-q. After enabling it, allow a few minutes.');
    expect(
      explainCandidate({ project: 'demo-q', source: 'chosen', result: 'no-permission', commands: [] }),
    ).toBe('You may not use demo-q for API quota.');
    expect(explainCandidate({ project: 'demo-q', source: 'chosen', result: 'not-found', commands: [] })).toBe(
      'demo-q does not exist or was deleted. Pick another project.',
    );
  });

  it('passes Google’s refusal on with its status and reason', () => {
    expect(
      refusal({
        status: 403,
        code: 'PERMISSION_DENIED',
        reason: 'SECURITY_POLICY_VIOLATED',
        message: 'Blocked.',
      }),
    ).toBe('Google refused the request (403 PERMISSION_DENIED SECURITY_POLICY_VIOLATED): Blocked.');
    expect(refusal({ status: 0, code: 'TIMEOUT', message: 'Google did not answer within 60 s.' })).toBe(
      'Google did not answer (Google did not answer within 60 s.).',
    );
  });

  it('has a headline of its own for every outcome', () => {
    const headlines = (['ready', 'blocked', 'sign-in', 'retry'] as const).map(outcomeHeadline);
    expect(headlines.every((headline) => headline.length > 10)).toBe(true);
    expect(new Set(headlines).size).toBe(4);
  });

  it('explains service-account mode with the scope and the account, as the instance’s gate runs it', () => {
    const lenient = serviceAccountParagraphs('folders/20000000001', 'gcportrait-backend@example.com').join(
      ' ',
    );
    expect(lenient).toContain('reads folders/20000000001 as gcportrait-backend@example.com');
    expect(lenient).toContain('Grant the account roles/cloudasset.viewer only');
    expect(lenient).toContain('everyone who can sign in here passes the gate for folders/20000000001');
    expect(lenient).not.toContain('service-account mode is refused');
    const strict = serviceAccountParagraphs(
      'folders/20000000001',
      'gcportrait-backend@example.com',
      true,
    ).join(' ');
    expect(strict).toContain('service-account mode is refused for folders/20000000001');
  });

  it('names copy buttons after what the command does, and where', () => {
    expect(
      purposeOf(
        'gcloud projects add-iam-policy-binding demo-q --member="user:a@example.com" --role="roles/serviceusage.serviceUsageConsumer"',
      ),
    ).toBe('grants roles/serviceusage.serviceUsageConsumer on demo-q');
    expect(purposeOf('gcloud services enable cloudasset.googleapis.com --project=demo-q')).toBe(
      'enables the Cloud Asset API in demo-q',
    );
    expect(purposeOf('gcloud asset export --folder=20000000001 --content-type=resource')).toBe(
      'exports the scope’s assets to Cloud Storage',
    );
    expect(purposeOf('gcloud asset operations describe YOUR_OPERATION_NAME --format=json')).toBe(
      'saves the export’s operation',
    );
    expect(purposeOf('gcloud storage cp gs://demo-exports-1/export.json .')).toBe(
      'copies the export to this computer',
    );
    expect(purposeOf('gcloud version')).toBe('is shown');
  });
});

describe('the reference table (docs/permissions.md)', () => {
  it('writes the commands in the scope’s command group, with variables for every value', () => {
    const empty = referenceRows({ scope: null, serviceAccount: null });
    expect(empty.flatMap((row) => row.commands)).toEqual([
      'gcloud organizations add-iam-policy-binding YOUR_ORG_ID --member="user:YOUR_EMAIL" --role="roles/cloudasset.viewer"',
      'gcloud services enable cloudasset.googleapis.com --project=YOUR_QUOTA_PROJECT',
      'gcloud projects add-iam-policy-binding YOUR_QUOTA_PROJECT --member="user:YOUR_EMAIL" --role="roles/serviceusage.serviceUsageConsumer"',
      'gcloud organizations add-iam-policy-binding YOUR_ORG_ID --member="serviceAccount:YOUR_SA_EMAIL" --role="roles/cloudasset.viewer"',
      'gcloud asset export --organization=YOUR_ORG_ID --content-type=resource --output-path=gs://YOUR_BUCKET/export.json',
    ]);
    const folder = referenceRows({
      scope: { kind: 'folder' },
      serviceAccount: 'gcportrait-backend@example.com',
    });
    expect(folder[0]?.commands[0]).toBe(
      'gcloud resource-manager folders add-iam-policy-binding YOUR_FOLDER_ID --member="user:YOUR_EMAIL" --role="roles/cloudasset.viewer"',
    );
    expect(folder[3]?.need).toBe('roles/cloudasset.viewer on the scope for gcportrait-backend@example.com');
    expect(folder[3]?.commands[0]).toContain('folders add-iam-policy-binding YOUR_FOLDER_ID');
    expect(folder[5]?.commands[0]).toContain('--folder=YOUR_FOLDER_ID');
    const project = referenceRows({ scope: { kind: 'project' }, serviceAccount: null });
    expect(project[0]?.commands[0]).toMatch(/^gcloud projects add-iam-policy-binding YOUR_PROJECT_ID /);
    expect(project[5]?.commands[0]).toContain('--project=YOUR_PROJECT_ID');
  });

  it('never names an email that could carry shell syntax', () => {
    const rows = referenceRows({ scope: null, serviceAccount: '"$(id)"@example.com' });
    expect(rows.map((row) => row.need).join('\n')).not.toContain('$(');
  });
});

describe('sameRequest', () => {
  it('compares scope, mode and quota project', () => {
    expect(sameRequest({ scope: 'projects/a', mode: 'user' }, { scope: 'projects/a', mode: 'user' })).toBe(
      true,
    );
    expect(
      sameRequest(
        { scope: 'projects/a', mode: 'user' },
        { scope: 'projects/a', mode: 'user', quotaProject: 'q' },
      ),
    ).toBe(false);
    expect(sameRequest({ scope: 'projects/a', mode: 'user' }, { scope: 'projects/a', mode: 'sa' })).toBe(
      false,
    );
  });
});
