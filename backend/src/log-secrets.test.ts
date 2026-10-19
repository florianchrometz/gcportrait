// SPDX-License-Identifier: Apache-2.0
/**
 * No token and no email in any log line, at the most verbose level (AGENTS.md, Security and privacy,
 * principle 2; docs/security.md §7). The server runs at `LOG_LEVEL=trace` against a pretend Google, and every
 * route is driven the way a person, a script and an attacker would: the token in each header the backend
 * reads, in a query string, in a body, in a malformed header and in Google's own error messages;
 * service-account mode with its gate and audit line; retries, refusals and failures. Every line written is
 * then searched for the tokens and the email. Everything is synthetic (AGENTS.md, Security and privacy,
 * principle 6).
 */
import type { FastifyInstance, InjectOptions } from 'fastify';
import { describe, expect, it } from 'vitest';

import type { ServiceAccountIdentity } from './auth/identity.js';
import { fakeGoogle, type FakeGoogleOptions } from './preflight/google.testing.js';
import { inProcessRunner } from './render/in-process.js';
import { startTestServer } from './server.testing.js';
import { mockGcs } from './stream/google.testing.js';
import {
  ACCOUNT_TOKEN,
  CALLER_EMAIL,
  CALLER_TOKEN,
  fakeAccount,
  googleError,
  jsonResponse,
} from './upstream/google.testing.js';
import type { UpstreamFetch } from './upstream/request.js';

/** Every secret that must never reach a log line. */
const SECRETS = [CALLER_TOKEN, ACCOUNT_TOKEN, CALLER_EMAIL, 'ya29.'] as const;

interface Traced {
  readonly app: FastifyInstance;
  readonly lines: () => string[];
}

/** The server at trace level; Cloud Storage answers from a small bucket, every other API from fakeGoogle. */
async function traced(
  options: FakeGoogleOptions = {},
  env: Record<string, string> = {},
  serviceAccount?: ServiceAccountIdentity,
): Promise<Traced> {
  const google = fakeGoogle(options);
  const gcs = mockGcs('demo-exports', { 'export.json': '{"name":"//x/1","assetType":"x/y"}\n' });
  const fetch: UpstreamFetch = (url, init) =>
    new URL(url).host === 'storage.googleapis.com' ? gcs.fetch(url, init) : google.fetch(url, init);
  const { app, logs } = await startTestServer({
    env,
    logLevel: 'trace',
    fetch,
    // The render API's job in process (the worker is the bundle's; render/bundle.test.ts runs it).
    renderRunner: inProcessRunner(),
    ...(serviceAccount === undefined ? {} : { serviceAccount }),
  });
  return { app, lines: logs.lines };
}

const USER_PULL = {
  scope: 'projects/demo-app-1',
  contentType: 'RESOURCE',
  mode: 'user',
  quotaProject: 'demo-quota-1',
} as const;

/** The requests a person, a script and an attacker would send, each carrying the caller's token somewhere. */
async function driveEveryRoute(app: FastifyInstance): Promise<number[]> {
  const own = { 'x-gcportrait-token': CALLER_TOKEN };
  const bearer = { authorization: `Bearer ${CALLER_TOKEN}` };
  const requests: InjectOptions[] = [
    { method: 'GET', url: '/healthz' },
    { method: 'GET', url: '/api/healthz', headers: own },
    { method: 'GET', url: '/api/config', headers: bearer },
    { method: 'GET', url: '/api/legal', headers: own },
    { method: 'GET', url: `/api/config?access_token=${CALLER_TOKEN}` },
    { method: 'GET', url: `/diagram?token=${CALLER_TOKEN}`, headers: { cookie: `sid=${CALLER_TOKEN}` } },
    { method: 'POST', url: '/api/scopes/search', headers: own, payload: { query: 'demo' } },
    { method: 'POST', url: '/api/scopes/search', headers: bearer, payload: { query: CALLER_TOKEN } },
    {
      method: 'POST',
      url: '/api/preflight',
      headers: own,
      payload: { scope: 'projects/demo-app-1', mode: 'user' },
    },
    {
      method: 'POST',
      url: `/api/preflight?access_token=${CALLER_TOKEN}`,
      headers: bearer,
      payload: { scope: 'folders/20000000001', mode: 'user', quotaProject: 'demo-quota-1' },
    },
    { method: 'POST', url: '/api/assets/stream', headers: own, payload: USER_PULL },
    {
      method: 'POST',
      url: '/api/assets/stream',
      headers: bearer,
      payload: { ...USER_PULL, mode: 'sa', quotaProject: undefined },
    },
    {
      method: 'POST',
      url: '/api/export/read',
      headers: own,
      payload: { gcsUri: 'gs://demo-exports/export.json' },
    },
    {
      method: 'POST',
      url: '/api/export/read',
      headers: own,
      payload: { gcsUri: 'gs://demo-exports/missing/' },
    },
    // Refused before Google is asked: an unknown field, a token in the body, bad JSON, a malformed header.
    {
      method: 'POST',
      url: '/api/preflight',
      headers: own,
      payload: { scope: 'projects/demo-app-1', mode: 'user', token: CALLER_TOKEN },
    },
    {
      method: 'POST',
      url: '/api/preflight',
      headers: { ...own, 'content-type': 'application/json' },
      payload: `{"scope": "${CALLER_TOKEN}`,
    },
    {
      method: 'POST',
      url: '/api/preflight',
      headers: { 'x-gcportrait-token': `${CALLER_TOKEN} junk` },
      payload: {},
    },
    {
      method: 'POST',
      url: '/api/assets/stream',
      headers: { authorization: `Basic ${CALLER_TOKEN}` },
      payload: USER_PULL,
    },
    { method: 'POST', url: '/api/nope', headers: own, payload: { token: CALLER_TOKEN } },
  ];
  const statuses: number[] = [];
  for (const request of requests) statuses.push((await app.inject(request)).statusCode);
  return statuses;
}

function expectNoSecret(lines: readonly string[]): void {
  expect(lines.length).toBeGreaterThan(0);
  for (const line of lines) for (const secret of SECRETS) expect(line, line).not.toContain(secret);
}

describe('no token and no email in any log line at LOG_LEVEL=trace', () => {
  it('in user mode, on every route, however the token arrives', async () => {
    const { app, lines } = await traced();
    const statuses = await driveEveryRoute(app);
    // The answers prove the routes really ran: successes, refusals and the 404.
    expect(statuses).toEqual([
      200, 200, 200, 200, 200, 404, 200, 200, 200, 200, 200, 403, 200, 200, 400, 400, 401, 401, 404,
    ]);
    const logged = lines();
    // Trace really is the level (the lines are all at info, as nothing in the server or Fastify writes below
    // it on these paths); the request lines, upstream lines and stream lines are all among them.
    expect(app.log.level).toBe('trace');
    expect(logged.some((line) => line.includes('"message":"incoming request"'))).toBe(true);
    expect(logged.some((line) => line.includes('"message":"upstream call"'))).toBe(true);
    expect(logged.some((line) => line.includes('"message":"asset stream ended"'))).toBe(true);
    expect(logged.some((line) => line.includes('"message":"export read ended"'))).toBe(true);
    expectNoSecret(logged);
  });

  it('when Google refuses, fails, retries, or quotes the token in its own error messages', async () => {
    const echo = (status: number, code: string) => () =>
      googleError(status, code, `The token ${CALLER_TOKEN} of ${CALLER_EMAIL} was refused.`);
    const { app, lines } = await traced({
      tokeninfo: () => jsonResponse(200, { email: CALLER_EMAIL, expires_in: '3599' }),
      get: echo(403, 'PERMISSION_DENIED'),
      list: echo(500, 'INTERNAL'),
      search: () => Promise.reject(new TypeError(`fetch failed for ${CALLER_TOKEN}`)),
    });
    await driveEveryRoute(app);
    expectNoSecret(lines());
    // Google's message travels to the person it is about (the frame or the body), never into the log.
    const pull = await app.inject({
      method: 'POST',
      url: '/api/assets/stream',
      headers: { 'x-gcportrait-token': CALLER_TOKEN },
      payload: USER_PULL,
    });
    expect(pull.body).toContain('was refused');
    expectNoSecret(lines());
  });

  it('in service-account mode: the gate, its audit line and the account’s own token', async () => {
    const { app, lines } = await traced(
      { tokeninfo: () => jsonResponse(200, { email: CALLER_EMAIL, expires_in: '3599' }) },
      { SA_MODE_ENABLED: 'true', SA_MODE_STRICT_EXPOSURE: 'true' },
      fakeAccount(),
    );
    const own = { 'x-gcportrait-token': CALLER_TOKEN };
    const statuses = [
      await app.inject({
        method: 'POST',
        url: '/api/preflight',
        headers: own,
        payload: { scope: 'folders/20000000001', mode: 'sa' },
      }),
      await app.inject({
        method: 'POST',
        url: '/api/assets/stream',
        headers: own,
        payload: { scope: 'folders/20000000001', contentType: 'RESOURCE', mode: 'sa' },
      }),
    ].map((response) => response.statusCode);
    expect(statuses.every((status) => status !== 500)).toBe(true);
    const logged = lines();
    expect(logged.some((line) => line.includes('"event":"sa-gate"'))).toBe(true);
    expectNoSecret(logged);
  });

  it('on the render API: its log line has counts only, whatever the request carries', async () => {
    const { app, lines } = await traced({
      tokeninfo: () => jsonResponse(200, { email: CALLER_EMAIL, expires_in: '3599' }),
      list: () => googleError(403, 'PERMISSION_DENIED', `The token ${CALLER_TOKEN} was refused.`),
    });
    const own = { 'x-gcportrait-token': CALLER_TOKEN };
    const statuses = [
      // Refused before any work: a token in the body, a malformed header, a pull Google refuses.
      await app.inject({
        method: 'POST',
        url: '/api/render',
        headers: own,
        payload: { source: { kind: 'demo', size: 'S' }, token: CALLER_TOKEN },
      }),
      await app.inject({
        method: 'POST',
        url: `/api/render?access_token=${CALLER_TOKEN}`,
        headers: { 'x-gcportrait-token': `${CALLER_TOKEN} junk` },
        payload: {},
      }),
      await app.inject({
        method: 'POST',
        url: '/api/render',
        headers: own,
        payload: { source: { ...USER_PULL, kind: 'scope', contentType: undefined } },
      }),
    ].map((response) => response.statusCode);
    expect(statuses).toEqual([400, 401, 403]);
    const logged = lines();
    expect(logged.some((line) => line.includes('"message":"render ended"'))).toBe(true);
    expectNoSecret(logged);
    for (const line of logged.filter((entry) => entry.includes('"message":"render ended"')))
      expect(line).not.toContain('demo-app-1');
  });

  it('when the account’s token cannot be had, with a message that names it', async () => {
    const { app, lines } = await traced(
      { tokeninfo: () => jsonResponse(200, { email: CALLER_EMAIL, expires_in: '3599' }) },
      { SA_MODE_ENABLED: 'true' },
      fakeAccount(() => Promise.reject(new Error(`metadata server said ${ACCOUNT_TOKEN}`))),
    );
    await app.inject({
      method: 'POST',
      url: '/api/assets/stream',
      headers: { 'x-gcportrait-token': CALLER_TOKEN },
      payload: { scope: 'folders/20000000001', contentType: 'RESOURCE', mode: 'sa' },
    });
    expectNoSecret(lines());
  });
});
