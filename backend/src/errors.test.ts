// SPDX-License-Identifier: MIT
/**
 * The server's one error answer (./errors.ts): each status's default code, a named code kept, the headers that go
 * with an answer, and the body's fields in the shape `ErrorResponseSchema` declares.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_CODES,
  DEFAULT_RETRY_AFTER_SECONDS,
  FALLBACK_CODE,
  isErrorResponse,
  sendError,
  type ErrorAnswer,
} from './errors.js';
import { ErrorResponseSchema } from './schemas.js';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

/** A server whose one route answers `answer`. */
async function answering(answer: ErrorAnswer): Promise<FastifyInstance> {
  app = Fastify({ genReqId: () => 'probe-id' });
  app.get('/probe', (request, reply) => sendError(request, reply, answer));
  await app.ready();
  return app;
}

describe('sendError', () => {
  it.each(Object.entries(DEFAULT_CODES))(
    'gives %s its default code, %s, when none is named',
    async (status, code) => {
      const server = await answering({ status: Number(status), message: 'What happened.' });
      const response = await server.inject({ method: 'GET', url: '/probe' });
      expect(response.statusCode).toBe(Number(status));
      expect(ErrorResponseSchema.parse(response.json())).toEqual({
        statusCode: Number(status),
        error: expect.any(String) as string,
        message: 'What happened.',
        requestId: 'probe-id',
        code,
      });
    },
  );

  it('keeps the code an answer names, and gives a status without a default the fallback', async () => {
    const named = await answering({ status: 403, code: 'SA_MODE_OFF', message: 'Off.' });
    expect((await named.inject({ method: 'GET', url: '/probe' })).json()).toMatchObject({
      code: 'SA_MODE_OFF',
    });
    await named.close();
    const other = await answering({ status: 418, message: 'A teapot.' });
    expect((await other.inject({ method: 'GET', url: '/probe' })).json()).toMatchObject({
      statusCode: 418,
      error: "I'm a Teapot",
      code: FALLBACK_CODE,
    });
  });

  it('challenges every 401 with Bearer, and no other status', async () => {
    const unauthenticated = await answering({ status: 401, message: 'Sign in.' });
    const response = await unauthenticated.inject({ method: 'GET', url: '/probe' });
    expect(response.headers['www-authenticate']).toBe('Bearer');
    expect(response.json()).toMatchObject({ code: 'UNAUTHENTICATED' });
    await unauthenticated.close();
    const forbidden = await answering({ status: 403, code: 'SA_MODE_OFF', message: 'Off.' });
    expect(
      (await forbidden.inject({ method: 'GET', url: '/probe' })).headers['www-authenticate'],
    ).toBeUndefined();
  });

  it('sends Retry-After with a delay of its own, or the default with retryable: true, and none otherwise', async () => {
    const own = await answering({ status: 429, message: 'Busy.', retryAfter: 30 });
    const ownAnswer = await own.inject({ method: 'GET', url: '/probe' });
    expect(ownAnswer.headers['retry-after']).toBe('30');
    expect(ownAnswer.json()).not.toHaveProperty('retryable');
    await own.close();
    const retryable = await answering({
      status: 503,
      code: 'X_UNAVAILABLE',
      message: 'Later.',
      retryable: true,
    });
    const retryableAnswer = await retryable.inject({ method: 'GET', url: '/probe' });
    expect(retryableAnswer.headers['retry-after']).toBe(String(DEFAULT_RETRY_AFTER_SECONDS));
    expect(retryableAnswer.json()).toMatchObject({ retryable: true });
    await retryable.close();
    const final = await answering({ status: 503, code: 'X_TOO_LARGE', message: 'No.', retryable: false });
    const finalAnswer = await final.inject({ method: 'GET', url: '/probe' });
    expect(finalAnswer.headers['retry-after']).toBeUndefined();
    expect(finalAnswer.json()).not.toHaveProperty('retryable');
  });

  it('carries Google’s reason and answer, and the extra fields after the error fields', async () => {
    const server = await answering({
      status: 403,
      code: 'PERMISSION_DENIED',
      message: 'Google refused.',
      reason: 'SERVICE_DISABLED',
      upstream: { status: 403, code: 'PERMISSION_DENIED' },
      extra: { preflight: { outcome: 'blocked' } },
    });
    const body: unknown = (await server.inject({ method: 'GET', url: '/probe' })).json();
    expect(body).toEqual({
      statusCode: 403,
      error: 'Forbidden',
      message: 'Google refused.',
      requestId: 'probe-id',
      code: 'PERMISSION_DENIED',
      reason: 'SERVICE_DISABLED',
      upstream: { status: 403, code: 'PERMISSION_DENIED' },
      preflight: { outcome: 'blocked' },
    });
    expect(isErrorResponse(body)).toBe(true);
    expect(isErrorResponse({ statusCode: 403, error: 'Forbidden', message: 'x', requestId: 'y' })).toBe(
      false,
    );
  });
});
