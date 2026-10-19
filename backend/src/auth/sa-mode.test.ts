// SPDX-License-Identifier: Apache-2.0
/**
 * Service-account mode over HTTP (Fastify `inject`, a pretend Google behind the allowlisted client): every route
 * that takes `mode: "sa"` goes through the gate, and without a passing gate answers 403 (401 for a token Google
 * does not accept, 503 for a gate that could not finish) with no call made as the account; the routes that take no
 * mode refuse one; /api/config publishes the identity's email; one audit line per gated call.
 */
import type { FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';

import {
  answers,
  askedPermissions,
  accountGetAnswer,
  CALLER_REFUSALS,
  callerAnswer,
  EXPOSURE_REFUSALS,
  fakeGoogle,
  type FakeGoogle,
  type FakeGoogleOptions,
} from '../preflight/google.testing.js';
import { ConfigError } from '../config.js';
import { PreflightResponseSchema } from '../preflight/schemas.js';
import { startTestServer } from '../server.testing.js';
import {
  ACCOUNT_EMAIL,
  ACCOUNT_TOKEN,
  CALLER_EMAIL,
  CALLER_TOKEN,
  caiPager,
  fakeAccount,
  type FakeAccount,
} from '../upstream/google.testing.js';
import { emailHashOf } from './gate.js';
import { GATE_RETRY_AFTER_SECONDS } from './refusal.js';

interface Started {
  readonly app: FastifyInstance;
  readonly google: FakeGoogle;
  readonly account: FakeAccount;
  readonly logs: () => string;
}

/** One page of a listing, the last. */
const onePage = caiPager(
  [
    [
      {
        name: '//cloudresourcemanager.googleapis.com/projects/10000000001',
        assetType: 'cloudresourcemanager.googleapis.com/Project',
      },
    ],
  ],
  '2026-10-10T06:00:00.123456Z',
);

/** A server in service-account mode, with the instance's identity unless `account` is null (a build without one). */
async function start(
  options: FakeGoogleOptions = {},
  env: Record<string, string> = {},
  account: FakeAccount | null = fakeAccount(),
): Promise<Started> {
  const google = fakeGoogle({ list: onePage, ...options });
  const { app, logs } = await startTestServer({
    env: { SA_MODE_ENABLED: 'true', ...env },
    logLevel: 'info',
    fetch: google.fetch,
    ...(account === null ? {} : { serviceAccount: account }),
  });
  return { app, google, account: account ?? fakeAccount(), logs: logs.text };
}

function post(app: FastifyInstance, url: string, body: unknown, token: string | null = CALLER_TOKEN) {
  return app.inject({
    method: 'POST',
    url,
    headers: {
      'content-type': 'application/json',
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
    },
    payload: JSON.stringify(body),
  });
}

const SCOPE = 'folders/20000000001';

/** Every route that takes `mode: "sa"`, with a body that asks for it. */
const GATED_ROUTES = [
  { route: 'preflight', url: '/api/preflight', body: { scope: SCOPE, mode: 'sa' } },
  {
    route: 'assets.stream',
    url: '/api/assets/stream',
    body: { scope: SCOPE, contentType: 'RESOURCE', mode: 'sa' },
  },
] as const;

/** No call was made with the account's token, and none to Cloud Asset Inventory at all. */
function expectNothingAsTheAccount(google: FakeGoogle): void {
  expect(google.calls.filter((call) => call.token === ACCOUNT_TOKEN)).toEqual([]);
  expect(google.callsTo('list')).toEqual([]);
}

/** The gate's refusals that answer 403 (the 401 and the 503 have tests of their own below). */
const forbidden = (row: { readonly status: number }): boolean => row.status === 403;

describe.each(GATED_ROUTES)('$url with mode "sa": the gate cannot be bypassed', ({ route, url, body }) => {
  it.each(CALLER_REFUSALS.filter(forbidden))(
    '403 when the caller’s check answers $label, and nothing is asked as the account',
    async (row) => {
      const { app, google, account } = await start({ testIam: callerAnswer(row) });
      const response = await post(app, url, body);
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ statusCode: 403, error: 'Forbidden', code: row.code });
      expectNothingAsTheAccount(google);
      expect(account.accessToken).not.toHaveBeenCalled();
      expect(response.body).not.toContain(CALLER_TOKEN);
    },
  );

  it.each(EXPOSURE_REFUSALS.filter(forbidden))(
    '403 with SA_MODE_STRICT_EXPOSURE when the account’s own get answers $label; no CAI call',
    async (row) => {
      const { app, google } = await start(
        { get: accountGetAnswer(row) },
        { SA_MODE_STRICT_EXPOSURE: 'true' },
      );
      const response = await post(app, url, body);
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ code: row.code });
      expect(google.callsTo('list')).toEqual([]);
      expect(response.body).not.toContain(ACCOUNT_TOKEN);
    },
  );

  it('401 when Google does not accept the caller’s token, with the Bearer challenge', async () => {
    const { app, google } = await start({ testIam: () => answers.unauthenticated() });
    const response = await post(app, url, body);
    expect(response.statusCode).toBe(401);
    expect(response.headers['www-authenticate']).toBe('Bearer');
    expect(response.json()).toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(response.json()).not.toHaveProperty('preflight');
    expectNothingAsTheAccount(google);
  });

  it('503 when Google does not answer the check, retryable with Retry-After; still nothing asked as the account', async () => {
    const { app, google } = await start({ testIam: () => answers.unavailable() });
    const response = await post(app, url, body);
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ code: 'SA_GATE_UNAVAILABLE', retryable: true });
    expect(response.headers['retry-after']).toBe(String(GATE_RETRY_AFTER_SECONDS));
    expectNothingAsTheAccount(google);
  });

  it('403 while the operator has service-account mode off, without calling Google', async () => {
    const { app, google, account } = await start({}, { SA_MODE_ENABLED: 'false' });
    const response = await post(app, url, body);
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      code: 'SA_MODE_OFF',
      message: 'Service-account mode is off on this gcportrait instance.',
    });
    expect(google.calls).toEqual([]);
    expect(account.accessToken).not.toHaveBeenCalled();
  });

  it('501 in a build without the instance’s identity, without calling Google', async () => {
    const { app, google } = await start({}, {}, null);
    const response = await post(app, url, body);
    expect(response.statusCode).toBe(501);
    expect(response.json()).toMatchObject({
      code: 'SA_MODE_UNAVAILABLE',
      message: 'Service-account mode is not available in this build of gcportrait.',
    });
    expect(google.calls).toEqual([]);
  });

  it('a passing gate: the account’s own token, no quota header, one audit line without secrets', async () => {
    const { app, google, logs } = await start();
    const response = await post(app, url, body);
    expect(response.statusCode).toBe(200);
    const [tested] = google.callsTo('testIam');
    if (tested === undefined) throw new Error('no testIamPermissions call');
    expect(tested.token).toBe(CALLER_TOKEN);
    expect(askedPermissions(tested)).toEqual(['resourcemanager.folders.get']);
    const [listed] = google.callsTo('list');
    expect(listed?.token).toBe(ACCOUNT_TOKEN);
    expect(listed?.url.pathname).toBe('/v1/folders/20000000001/assets');
    expect(listed?.headers.has('x-goog-user-project')).toBe(false);
    const audit = logs()
      .split('\n')
      .filter((line) => line.includes('"service-account gate"'))
      .map((line) => JSON.parse(line) as { requestId: string; audit: Record<string, unknown> });
    expect(audit).toHaveLength(1);
    expect(audit[0]?.audit).toMatchObject({
      event: 'sa-gate',
      route,
      scope: SCOPE,
      callerEmailHash: emailHashOf(CALLER_EMAIL),
      decision: 'allowed',
    });
    expect(audit[0]?.requestId).toBe(response.headers['x-request-id']);
    for (const secret of [CALLER_TOKEN, ACCOUNT_TOKEN, CALLER_EMAIL]) expect(logs()).not.toContain(secret);
    // The answer goes to the caller: never a token (the preflight names the caller's own email in its commands).
    for (const secret of [CALLER_TOKEN, ACCOUNT_TOKEN]) expect(response.body).not.toContain(secret);
  });

  it('a body may not choose the account’s quota project or smuggle anything else (400, no Google call)', async () => {
    const { app, google } = await start();
    for (const extra of [
      { quotaProject: 'demo-quota-1' },
      { serviceAccount: 'someone@example.com' },
      { gate: false },
    ]) {
      const response = await post(app, url, { ...body, ...extra });
      expect(response.statusCode, JSON.stringify(extra)).toBe(400);
    }
    expect(google.calls).toEqual([]);
  });
});

describe('POST /api/preflight with mode "sa": a refusal is never a 200, and still carries the checklist', () => {
  it('403 with the checklist as `preflight`: what the gate found, and the account never probing', async () => {
    const { app } = await start({ testIam: () => answers.permissions([]) });
    const response = await post(app, '/api/preflight', { scope: SCOPE, mode: 'sa' });
    expect(response.statusCode).toBe(403);
    const body = response.json<{ preflight: unknown; message: string }>();
    expect(body.message).toBe(
      'You cannot see folders/20000000001 yourself (you do not hold resourcemanager.folders.get there), so ' +
        'gcportrait does not read it with its service account.',
    );
    const checklist = PreflightResponseSchema.parse(body.preflight);
    expect(checklist).toMatchObject({ mode: 'sa', outcome: 'blocked', serviceAccount: ACCOUNT_EMAIL });
    expect(checklist.items.map((item) => [item.id, item.finding])).toEqual([
      ['sa-caller', 'denied'],
      ['sa-access', 'not-checked'],
    ]);
  });

  it('with the strict check, the checklist names the exposure', async () => {
    const { app } = await start({}, { SA_MODE_STRICT_EXPOSURE: 'true' });
    const response = await post(app, '/api/preflight', { scope: SCOPE, mode: 'sa' });
    expect(response.statusCode).toBe(403);
    const checklist = PreflightResponseSchema.parse(response.json<{ preflight: unknown }>().preflight);
    expect(checklist.items.map((item) => [item.id, item.finding])).toEqual([
      ['sa-caller', 'ok'],
      ['sa-exposure', 'exposed'],
      ['sa-access', 'not-checked'],
    ]);
  });
});

describe('routes that take no mode refuse one', () => {
  it.each([
    ['/api/scopes/search', { query: 'demo', mode: 'sa' }],
    ['/api/export/read', { gcsUri: 'gs://demo-bucket/export.json', mode: 'sa' }],
  ])('%s with mode "sa" is a 400, and nothing is asked as the account', async (url, body) => {
    const { app, google, account } = await start();
    const response = await post(app, url, body);
    expect(response.statusCode).toBe(400);
    expect(google.calls).toEqual([]);
    expect(account.accessToken).not.toHaveBeenCalled();
  });
});

describe('GET /api/config in service-account mode', () => {
  it('publishes the identity’s email, whether BACKEND_SA_EMAIL is unset or names the same account', async () => {
    for (const env of [{}, { BACKEND_SA_EMAIL: ACCOUNT_EMAIL.toUpperCase() }]) {
      const { app } = await start({}, env);
      const response = await app.inject({ method: 'GET', url: '/api/config' });
      expect(response.json()).toMatchObject({
        saMode: true,
        saStrictExposure: false,
        backendServiceAccount: ACCOUNT_EMAIL,
      });
    }
  });

  it('says whether the strict exposure check runs', async () => {
    const { app } = await start({}, { SA_MODE_STRICT_EXPOSURE: 'true' });
    const response = await app.inject({ method: 'GET', url: '/api/config' });
    expect(response.json()).toMatchObject({ saMode: true, saStrictExposure: true });
  });

  it('refuses to start when BACKEND_SA_EMAIL names another account than the identity', async () => {
    await expect(
      start({}, { BACKEND_SA_EMAIL: 'someone-else@demo-host.iam.gserviceaccount.com' }),
    ).rejects.toThrow(ConfigError);
  });

  it('with the mode off, reports it off and ignores the identity', async () => {
    const { app } = await start({}, { SA_MODE_ENABLED: 'false', SA_MODE_STRICT_EXPOSURE: 'true' });
    const response = await app.inject({ method: 'GET', url: '/api/config' });
    expect(response.json()).toMatchObject({
      saMode: false,
      saStrictExposure: false,
      backendServiceAccount: null,
    });
  });
});

describe('organisation scope gating over HTTP', () => {
  const orgScope = 'organizations/30000000001';

  it('refuses 403 SA_GATE_ORG_CALLER_NOT_ALLOWED when SA_MODE_CALLERS is unset', async () => {
    const { app, google, account } = await start();
    const response = await post(app, '/api/assets/stream', {
      scope: orgScope,
      contentType: 'RESOURCE',
      mode: 'sa',
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      code: 'SA_GATE_ORG_CALLER_NOT_ALLOWED',
    });
    expectNothingAsTheAccount(google);
    expect(account.accessToken).not.toHaveBeenCalled();
  });

  it('allows organisation scope when caller matches SA_MODE_CALLERS', async () => {
    const { app, account } = await start({}, { SA_MODE_CALLERS: 'example.com' });
    const response = await post(app, '/api/assets/stream', {
      scope: orgScope,
      contentType: 'RESOURCE',
      mode: 'sa',
    });
    expect(response.statusCode).toBe(200);
    expect(account.accessToken).toHaveBeenCalled();
  });
});

describe('SA_MODE_AUDIT_KEY over HTTP', () => {
  it('hashes caller email with HMAC-SHA256 in audit logs when key is set', async () => {
    const auditKey = 'my-secret-audit-key';
    const { app, logs } = await start({}, { SA_MODE_AUDIT_KEY: auditKey });
    await post(app, '/api/assets/stream', {
      scope: SCOPE,
      contentType: 'RESOURCE',
      mode: 'sa',
    });
    const expectedHash = emailHashOf(CALLER_EMAIL, auditKey);
    const auditLine = logs()
      .split('\n')
      .find((line) => line.includes('"event":"sa-gate"'));
    expect(auditLine).toBeDefined();
    expect(auditLine).toContain(`"callerEmailHash":"${expectedHash}"`);
  });
});
