// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';

import { MAX_MESSAGE_LENGTH, errorDetailOf, googleErrorOf } from './google-error.js';
import { summaryOf } from './google.js';

const bytes = (value: unknown): Uint8Array =>
  new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));

describe('googleErrorOf (Google’s error bodies)', () => {
  it('reads the status, the message verbatim and the one ErrorInfo reason', () => {
    const body = {
      error: {
        code: 403,
        status: 'PERMISSION_DENIED',
        message: 'Cloud Asset API has not been used in project demo-quota before or it is disabled.',
        details: [
          {
            '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
            reason: 'SERVICE_DISABLED',
            domain: 'googleapis.com',
            metadata: { consumer: 'projects/demo-quota', service: 'cloudasset.googleapis.com' },
          },
          { '@type': 'type.googleapis.com/google.rpc.Help', links: [] },
        ],
      },
    };
    expect(googleErrorOf(403, bytes(body))).toEqual({
      httpStatus: 403,
      code: 'PERMISSION_DENIED',
      reason: 'SERVICE_DISABLED',
      message: 'Cloud Asset API has not been used in project demo-quota before or it is disabled.',
    });
  });

  it('has no reason for CAI’s own denial, or for two ErrorInfo entries', () => {
    const denial = {
      error: { code: 403, status: 'PERMISSION_DENIED', message: 'Request denied by Cloud IAM.' },
    };
    expect(googleErrorOf(403, bytes(denial))).toEqual({
      httpStatus: 403,
      code: 'PERMISSION_DENIED',
      message: 'Request denied by Cloud IAM.',
    });
    const info = { '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'IAM_PERMISSION_DENIED' };
    const two = { error: { code: 403, status: 'PERMISSION_DENIED', message: 'x', details: [info, info] } };
    expect(googleErrorOf(403, bytes(two)).reason).toBeUndefined();
  });

  it('takes the canonical code from the HTTP status when Cloud Storage leaves `status` out', () => {
    const body = {
      error: { code: 404, message: 'No such object: bucket/export.json', errors: [{ reason: 'notFound' }] },
    };
    expect(googleErrorOf(404, bytes(body))).toEqual({
      httpStatus: 404,
      code: 'NOT_FOUND',
      message: 'No such object: bucket/export.json',
    });
    expect(googleErrorOf(429, bytes({ error: { message: 'slow down' } })).code).toBe('RESOURCE_EXHAUSTED');
    expect(googleErrorOf(503, bytes({ error: { message: 'busy' } })).code).toBe('UNAVAILABLE');
    expect(googleErrorOf(500, bytes({ error: { message: 'oops' } })).code).toBe('INTERNAL');
  });

  it('never forwards an HTML page or garbage', () => {
    for (const body of ['<!DOCTYPE html><html>Error 404 (Not Found)</html>', '', '{"error":"text"}', '[1]']) {
      const error = googleErrorOf(404, bytes(body));
      expect(error).toEqual({
        httpStatus: 404,
        code: 'NOT_FOUND',
        message: 'Google answered HTTP 404 without a readable error message.',
      });
    }
    expect(googleErrorOf(400, new Uint8Array([0xff, 0xfe])).message).toMatch(/without a readable error/);
  });

  it('cuts a very long message and ignores a code that is not a code', () => {
    const long = { error: { status: 'not a code!', message: 'x'.repeat(MAX_MESSAGE_LENGTH + 50) } };
    const error = googleErrorOf(400, bytes(long));
    expect(error.code).toBe('INVALID_ARGUMENT');
    expect(error.message).toHaveLength(MAX_MESSAGE_LENGTH);
    expect(error.message.endsWith('…')).toBe(true);
  });
});

describe('one reading for every route', () => {
  const info = (reason: string) => ({ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason });
  const answers: readonly (readonly [number, unknown])[] = [
    [
      403,
      {
        error: {
          status: 'PERMISSION_DENIED',
          message: 'm'.repeat(MAX_MESSAGE_LENGTH + 10),
          details: [info('SERVICE_DISABLED')],
        },
      },
    ],
    [
      403,
      { error: { status: 'PERMISSION_DENIED', message: 'You cannot list assets in projects/demo-app-1.' } },
    ],
    [403, { error: { status: 'PERMISSION_DENIED', message: 'x', details: [info('A'), info('B')] } }],
    [400, { error: { status: 'not a code!', message: 'odd', details: [info('lower_case')] } }],
    [404, '<!DOCTYPE html><html>Error 404 (Not Found)</html>'],
    [404, { error: { code: 404, message: 'No such object: bucket/export.json' } }],
    [429, { error: { message: 'slow down' } }],
    [500, ''],
  ];

  it('the `upstream` of a preflight item, a gate refusal or a search problem says what a frame says', () => {
    for (const [status, body] of answers) {
      const summary = summaryOf({
        kind: 'answer',
        httpStatus: status,
        body: undefined,
        error: errorDetailOf(bytes(body)),
      });
      const frame = googleErrorOf(status, bytes(body));
      const label = JSON.stringify(body);
      expect(summary.status, label).toBe(frame.httpStatus);
      expect(summary.code, label).toBe(frame.code);
      expect(summary.reason, label).toBe(frame.reason);
      // Google's own message, the same in both; only a frame, which must carry one, falls back on a sentence.
      if (summary.message === undefined)
        expect(frame.message, label).toMatch(/without a readable error message/);
      else expect(summary.message, label).toBe(frame.message);
    }
    // Both cut a long message at the same length.
    expect(errorDetailOf(bytes(answers[0]?.[1])).message).toHaveLength(MAX_MESSAGE_LENGTH);
  });
});
