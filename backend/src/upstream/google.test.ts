// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';

import { errorDetailOf } from './google-error.js';
import {
  assetsListRequest,
  CLOUD_ASSET_URL,
  isTransientOutcome,
  probeAssets,
  summaryOf,
  type AssetsListBody,
  type CaiCredentials,
  type GoogleOutcome,
} from './google.js';
import {
  CALLER_TOKEN,
  googleError,
  htmlResponse,
  recordCall,
  scopeOf,
  testContext,
  type RecordedCall,
} from './google.testing.js';
import { isRetryableStatus } from './retry.js';

const USER: CaiCredentials = { token: CALLER_TOKEN, quotaProject: 'demo-quota-1' };
const ACCOUNT: CaiCredentials = { token: 'ya29.account-token-for-tests' };

describe('assetsListRequest (the one assets.list request of the probe and the pull)', () => {
  const cases: readonly (readonly [string, CaiCredentials, AssetsListBody, string | null, unknown])[] = [
    [
      'user mode, the first page',
      USER,
      { pageSize: 500 },
      'demo-quota-1',
      { contentType: 'RESOURCE', pageSize: 500 },
    ],
    [
      'user mode, a later page of a day with asset types',
      USER,
      {
        pageSize: 500,
        readTime: '2026-10-01T00:00:00Z',
        assetTypes: ['compute.googleapis.com/.*'],
        pageToken: 'page-2',
      },
      'demo-quota-1',
      {
        contentType: 'RESOURCE',
        pageSize: 500,
        readTime: '2026-10-01T00:00:00Z',
        assetTypes: ['compute.googleapis.com/.*'],
        pageToken: 'page-2',
      },
    ],
    [
      'service-account mode, the probe',
      ACCOUNT,
      { pageSize: 1 },
      null,
      { contentType: 'RESOURCE', pageSize: 1 },
    ],
    [
      'service-account mode, a later page',
      ACCOUNT,
      { pageSize: 500, pageToken: 'page-1' },
      null,
      { contentType: 'RESOURCE', pageSize: 500, pageToken: 'page-1' },
    ],
    [
      'fields given as undefined are left out',
      USER,
      { pageSize: 500, readTime: undefined, assetTypes: undefined, pageToken: undefined },
      'demo-quota-1',
      { contentType: 'RESOURCE', pageSize: 500 },
    ],
  ];

  it.each(cases)('%s', (_label, credentials, body, quotaHeader, sent) => {
    const request = assetsListRequest('folders/20000000001', credentials, body);
    expect(request.url).toBe(`${CLOUD_ASSET_URL}/folders/20000000001/assets`);
    expect(request.url).toBe('https://cloudasset.googleapis.com/v1/folders/20000000001/assets');
    // A POST without the method override is Google's HTML 404 (skill cai-ingestion §9).
    expect(request.method).toBe('POST');
    expect(request.headers).toEqual({
      authorization: `Bearer ${credentials.token}`,
      'content-type': 'application/json',
      accept: 'application/json',
      'x-http-method-override': 'GET',
      ...(quotaHeader === null ? {} : { 'x-goog-user-project': quotaHeader }),
    });
    expect(JSON.parse(request.body ?? '')).toEqual(sent);
  });

  it('the probe sends it, with the quota header in user mode only', async () => {
    const calls: RecordedCall[] = [];
    const context = testContext((url, init) => {
      recordCall(calls, url, init);
      return Promise.resolve(htmlResponse(404));
    });
    const scope = scopeOf('projects/demo-app-1');
    await probeAssets(context, scope, CALLER_TOKEN, 'demo-quota-1');
    await probeAssets(context, scope, 'ya29.account-token-for-tests', null);
    const [user, account] = calls;
    const expected = assetsListRequest('projects/demo-app-1', USER, { pageSize: 1 });
    expect(user?.url.href).toBe(expected.url);
    expect(user?.method).toBe('POST');
    expect(user?.token).toBe(CALLER_TOKEN);
    expect(user?.headers.get('x-goog-user-project')).toBe('demo-quota-1');
    expect(user?.headers.get('x-http-method-override')).toBe('GET');
    expect(user?.headers.get('x-request-id')).toBe('test-request-1');
    expect(user?.body).toBe(expected.body);
    expect(account?.token).toBe('ya29.account-token-for-tests');
    expect(account?.headers.has('x-goog-user-project')).toBe(false);
    expect(account?.body).toBe(expected.body);
  });
});

describe('isTransientOutcome', () => {
  it.each([200, 204, 302, 400, 401, 403, 404, 409, 428, 429, 430, 499, 500, 502, 503, 504, 599, 600])(
    'an answer of %i is transient exactly when the retry rule retries it',
    (status) => {
      const outcome: GoogleOutcome = { kind: 'answer', httpStatus: status, body: undefined };
      expect(isTransientOutcome(outcome)).toBe(isRetryableStatus(status));
    },
  );

  it.each([
    ['timeout', true],
    ['transport', true],
    ['busy', true],
    ['too-large', false],
  ] as const)('no answer (%s): %s', (failure, transient) => {
    expect(isTransientOutcome({ kind: 'failure', failure, message: 'x' })).toBe(transient);
  });
});

describe('summaryOf (what the browser is told of an answer)', () => {
  const bytesOf = async (response: Response): Promise<Uint8Array> =>
    new Uint8Array(await response.arrayBuffer());
  const answer = async (response: Response): Promise<GoogleOutcome> => ({
    kind: 'answer',
    httpStatus: response.status,
    body: undefined,
    error: errorDetailOf(await bytesOf(response)),
  });
  const json = (status: number, body: unknown): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  it.each<readonly [string, () => Response, unknown]>([
    [
      'Google’s envelope: its status, the one reason, its message',
      () => googleError(403, 'PERMISSION_DENIED', 'Request is prohibited.', 'SECURITY_POLICY_VIOLATED'),
      {
        status: 403,
        code: 'PERMISSION_DENIED',
        reason: 'SECURITY_POLICY_VIOLATED',
        message: 'Request is prohibited.',
      },
    ],
    [
      'two ErrorInfo entries: no reason',
      () =>
        googleError(403, 'PERMISSION_DENIED', 'x', [
          { reason: 'USER_PROJECT_DENIED' },
          { reason: 'SERVICE_DISABLED' },
        ]),
      { status: 403, code: 'PERMISSION_DENIED', message: 'x' },
    ],
    [
      'an HTML page: the code its HTTP status implies, and no message',
      () => htmlResponse(404),
      { status: 404, code: 'NOT_FOUND' },
    ],
    [
      'an envelope without `status`: the code its HTTP status implies',
      () => json(503, { error: { code: 503, message: 'The service is currently unavailable.' } }),
      { status: 503, code: 'UNAVAILABLE', message: 'The service is currently unavailable.' },
    ],
    [
      'a status and a reason that are not codes',
      () =>
        json(400, {
          error: {
            status: 'not a code!',
            message: 'odd',
            details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'lower_case' }],
          },
        }),
      { status: 400, code: 'INVALID_ARGUMENT', message: 'odd' },
    ],
  ])('%s', async (_label, make, expected) => {
    expect(summaryOf(await answer(make()))).toEqual(expected);
  });

  it('an answer without an error body is its status alone; no answer is status 0 with the failure', () => {
    expect(summaryOf({ kind: 'answer', httpStatus: 302, body: undefined })).toEqual({ status: 302 });
    expect(summaryOf({ kind: 'failure', failure: 'too-large', message: 'Too large.' })).toEqual({
      status: 0,
      code: 'TOO_LARGE',
      message: 'Too large.',
    });
  });
});
