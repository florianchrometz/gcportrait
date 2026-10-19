// SPDX-License-Identifier: Apache-2.0
/**
 * `POST /api/preflight` over HTTP (Fastify `inject`, a pretend Google behind the allowlisted client): the body's
 * schema, the rate limit per token hash, the gate before the account's probe, the answer's contract, and what
 * reaches the log (never the token, the email, the scope or the quota project). A missing or malformed token on
 * every route is demo-only.test.ts's route matrix; service-account mode off or unavailable is sa-mode.test.ts's.
 */
import { request as httpRequest } from 'node:http';

import type { FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';

import {
  answers,
  endpointOf,
  fakeGoogle,
  type FakeGoogle,
  type FakeGoogleOptions,
} from '../preflight/google.testing.js';
import { PreflightResponseSchema } from '../preflight/schemas.js';
import { listenOnLoopback, startTestServer, type TestServerOptions } from '../server.testing.js';
import {
  ACCOUNT_EMAIL,
  ACCOUNT_TOKEN,
  CALLER_EMAIL,
  CALLER_TOKEN,
  fakeAccount,
  untilAborted,
} from '../upstream/google.testing.js';

interface Started {
  readonly app: FastifyInstance;
  readonly google: FakeGoogle;
  readonly logs: () => string;
}

async function start(
  options: FakeGoogleOptions = {},
  env: Record<string, string> = {},
  extra: TestServerOptions = {},
): Promise<Started> {
  const google = fakeGoogle(options);
  const { app, logs } = await startTestServer({
    env: { BACKEND_SA_EMAIL: ACCOUNT_EMAIL, ...env },
    logLevel: 'info',
    fetch: google.fetch,
    ...extra,
  });
  return { app, google, logs: logs.text };
}

function preflight(
  app: FastifyInstance,
  body: unknown,
  token: string | null = CALLER_TOKEN,
  headers: Record<string, string> = {},
) {
  return app.inject({
    method: 'POST',
    url: '/api/preflight',
    headers: { ...(token === null ? {} : { authorization: `Bearer ${token}` }), ...headers },
    payload: body as Record<string, unknown>,
  });
}

describe('POST /api/preflight', () => {
  it('answers the checklist in the declared contract, uncached, with the request id', async () => {
    const { app } = await start();
    const response = await preflight(app, { scope: 'projects/demo-app-1', mode: 'user' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-request-id']).toBeDefined();
    const body = PreflightResponseSchema.parse(response.json());
    expect(body).toMatchObject({
      scope: 'projects/demo-app-1',
      kind: 'project',
      mode: 'user',
      outcome: 'ready',
    });
    expect(body.member).toBe(`user:${CALLER_EMAIL}`);
    expect(response.body).not.toContain(CALLER_TOKEN);
  });

  it.each([
    [{}, 'scope'],
    [{ scope: 'projects/demo-app-1' }, 'mode'],
    [{ scope: 'projects/demo-app-1', mode: 'admin' }, 'mode'],
    [{ scope: 'projects/demo-app-1', mode: 'user', extra: true }, ''],
    [{ scope: 'projects/../../storage/v1/b/x', mode: 'user' }, 'scope'],
    [{ scope: 'organizations/abc', mode: 'user' }, 'scope'],
    [{ scope: 'folders/0123', mode: 'user' }, 'scope'],
    [{ scope: 'projects/Demo-App', mode: 'user' }, 'scope'],
    [{ scope: 'projects/demo-app-1/assets', mode: 'user' }, 'scope'],
    [{ scope: 'billingAccounts/0X0X0X', mode: 'user' }, 'scope'],
    [{ scope: 'projects/demo?x=1', mode: 'user' }, 'scope'],
    [{ scope: 'projects/demo#x', mode: 'user' }, 'scope'],
    [{ scope: 'projects/demo%2F..', mode: 'user' }, 'scope'],
    [{ scope: 'organizations/1@example.com', mode: 'user' }, 'scope'],
    [{ scope: 'https://example.com/projects/x', mode: 'user' }, 'scope'],
    [{ scope: 'projects/demo-app-1', mode: 'user', quotaProject: 'demo\r\nx-evil: 1' }, 'quotaProject'],
    [{ scope: 'projects/demo-app-1', mode: 'user', quotaProject: 'demo/../x' }, 'quotaProject'],
    [{ scope: 'projects/demo-app-1', mode: 'user', quotaProject: '' }, 'quotaProject'],
    [{ scope: 42, mode: 'user' }, 'scope'],
  ])('refuses the body %j (400) without calling Google or echoing the value', async (body, field) => {
    const { app, google } = await start();
    const response = await preflight(app, body);
    expect(response.statusCode).toBe(400);
    const { message } = response.json<{ message: string }>();
    expect(message).toMatch(/^Invalid request: /);
    if (field !== '') expect(message).toContain(field);
    expect(message).not.toMatch(/evil|example\.com|\.\./);
    expect(google.calls).toHaveLength(0);
  });

  it('runs the gate before the account’s probe in service-account mode', async () => {
    const { app, google } = await start(
      {
        get: (call) =>
          call.token === ACCOUNT_TOKEN ? answers.getDenied('resourcemanager.projects.get') : undefined,
      },
      { SA_MODE_ENABLED: 'true', SA_MODE_STRICT_EXPOSURE: 'true' },
      { serviceAccount: fakeAccount() },
    );
    const response = await preflight(app, { scope: 'projects/demo-app-1', mode: 'sa' });
    expect(response.statusCode).toBe(200);
    expect(PreflightResponseSchema.parse(response.json())).toMatchObject({
      outcome: 'ready',
      serviceAccount: ACCOUNT_EMAIL,
    });
    const order = google.calls
      .filter((call) => call.url.host !== 'oauth2.googleapis.com')
      .map((call) => `${endpointOf(call)}:${call.token === ACCOUNT_TOKEN ? 'account' : 'caller'}`);
    expect(order).toEqual(['testIam:caller', 'get:account', 'list:account']);
    expect(response.body).not.toContain(ACCOUNT_TOKEN);
  });

  it('answers 401 when Google does not accept the token', async () => {
    const { app } = await start({ tokeninfo: () => answers.invalidToken() });
    const response = await preflight(app, { scope: 'projects/demo-app-1', mode: 'user' });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ message: 'Google did not accept your sign-in. Sign in again.' });
  });

  it('limits requests per token hash (429 with retry-after); another token is not affected', async () => {
    const { app } = await start({}, {}, { scopeRateLimitPerMinute: 2 });
    const body = { scope: 'projects/demo-app-1', mode: 'user' };
    expect((await preflight(app, body)).statusCode).toBe(200);
    expect((await preflight(app, body)).statusCode).toBe(200);
    const limited = await preflight(app, body);
    expect(limited.statusCode).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect((await preflight(app, body, 'ya29.another-token')).statusCode).toBe(200);
  });

  it('sends the incoming request id upstream and logs each call without the token, the email, the scope or the project', async () => {
    const { app, google, logs } = await start({ list: () => answers.listDenied() });
    const response = await preflight(
      app,
      { scope: 'projects/demo-secret-scope', mode: 'user', quotaProject: 'demo-secret-quota' },
      CALLER_TOKEN,
      { 'x-request-id': 'req-preflight-7' },
    );
    expect(response.statusCode).toBe(200);
    expect(google.calls.length).toBeGreaterThan(0);
    for (const call of google.calls) expect(call.headers.get('x-request-id')).toBe('req-preflight-7');
    const text = logs();
    expect(text).toContain('"requestId":"req-preflight-7"');
    expect(text).toContain('"operation":"cloudasset.assets.list"');
    expect(text).toContain('"operation":"resourcemanager.projects.get"');
    for (const secret of [CALLER_TOKEN, CALLER_EMAIL, 'demo-secret-scope', 'demo-secret-quota', 'ya29']) {
      expect(text, secret).not.toContain(secret);
    }
  });

  it('cancels the preflight and logs no error when the client disconnects mid-flight', async () => {
    let callSignal: AbortSignal | null = null;
    const { app, logs } = await start({
      list: (call) => {
        callSignal = call.signal;
        return untilAborted(call.signal);
      },
    });
    const port = await listenOnLoopback(app);
    const client = httpRequest(`http://127.0.0.1:${String(port)}/api/preflight`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${CALLER_TOKEN}`,
      },
    });
    client.on('error', () => undefined);
    client.end(JSON.stringify({ scope: 'projects/demo-app-1', mode: 'user' }));

    await expect.poll(() => callSignal).not.toBeNull();
    client.destroy();

    await expect.poll(() => callSignal?.aborted).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const text = logs();
    expect(text).not.toContain('"severity":"ERROR"');
    expect(text).not.toContain('"level":50');
    expect(text).not.toContain('Unhandled route error');
  });
});
