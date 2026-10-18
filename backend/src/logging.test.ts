// SPDX-License-Identifier: Apache-2.0
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';

import {
  isLoggedHeader,
  LOGGED_HEADERS,
  loggerOptions,
  REDACTED,
  sanitizeHeaders,
  sanitizeUrl,
} from './logging.js';
import { captureLogs } from './server.testing.js';

/** Headers that carry a credential or a person's identity on Cloud Run, behind IAP, or from a client. */
const CREDENTIAL_HEADERS = {
  authorization: 'Bearer ya29.header-secret',
  'x-gcportrait-token': 'ya29.own-header-secret',
  'proxy-authorization': 'Basic proxy-secret',
  cookie: 'sid=cookie-secret',
  'x-goog-iap-jwt-assertion': 'eyJhbGciOiJFUzI1NiJ9.iap-jwt-secret.signature',
  'x-goog-authenticated-user-email': 'accounts.google.com:person@example.com',
  'x-goog-authenticated-user-id': 'accounts.google.com:1234567890',
  'x-serverless-authorization': 'Bearer serverless-id-token-secret',
  'x-api-key': 'api-key-secret',
  'x-goog-iam-authorization-token': 'iam-secret',
  'x-some-future-header': 'unknown-header-secret',
} as const;

describe('isLoggedHeader', () => {
  it.each([...LOGGED_HEADERS, 'User-Agent', 'Content-Type'])('logs the value of %s', (name) => {
    expect(isLoggedHeader(name)).toBe(true);
  });

  it.each([
    ...Object.keys(CREDENTIAL_HEADERS),
    'Authorization',
    'X-Gcportrait-Token',
    'X-Goog-IAP-JWT-Assertion',
    'x-request-id',
  ])('never logs the value of %s', (name) => {
    expect(isLoggedHeader(name)).toBe(false);
  });
});

describe('sanitizeHeaders', () => {
  it('keeps allowlisted values and redacts every other value, keeping the names', () => {
    expect(
      sanitizeHeaders({
        ...CREDENTIAL_HEADERS,
        'user-agent': 'test-agent',
        'content-type': 'application/json',
        accept: undefined,
      }),
    ).toEqual({
      ...Object.fromEntries(Object.keys(CREDENTIAL_HEADERS).map((name) => [name, REDACTED])),
      'user-agent': 'test-agent',
      'content-type': 'application/json',
    });
  });

  it('redacts multi-valued headers as a whole', () => {
    expect(sanitizeHeaders({ 'set-cookie': ['a=1', 'b=2'] })).toEqual({ 'set-cookie': REDACTED });
  });
});

describe('sanitizeUrl', () => {
  it('leaves URLs without a query alone', () => {
    expect(sanitizeUrl('/api/config')).toBe('/api/config');
  });

  it('replaces the whole query string, names included', () => {
    expect(sanitizeUrl('/x?access_token=abc&scope=projects%2F1&code=4%2F0Ab')).toBe(`/x?${REDACTED}`);
    expect(sanitizeUrl('/x?ya29.bare-token')).toBe(`/x?${REDACTED}`);
    expect(sanitizeUrl('/x?')).toBe(`/x?${REDACTED}`);
  });
});

describe('loggerOptions', () => {
  it('redacts credential headers in objects logged by hand', () => {
    const logs = captureLogs();
    // Without a destination and with the json format the options carry no stream and no transport, so
    // plain pino can take the capturing stream as its second argument (Fastify takes it as `stream`).
    const options = loggerOptions({ logLevel: 'info', logFormat: 'json', version: 'test' });
    expect(options.stream).toBeUndefined();
    const logger = pino(options, logs.stream);
    logger.info({ headers: CREDENTIAL_HEADERS }, 'hand-logged');
    const text = logs.text();
    for (const name of [
      'authorization',
      'x-gcportrait-token',
      'cookie',
      'x-goog-iap-jwt-assertion',
      'x-goog-authenticated-user-email',
      'x-serverless-authorization',
      'x-api-key',
    ] as const) {
      expect(text).not.toContain(CREDENTIAL_HEADERS[name]);
    }
    expect(text).toContain(REDACTED);
  });
});
