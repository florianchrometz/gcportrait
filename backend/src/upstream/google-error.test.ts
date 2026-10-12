// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';

import { MAX_MESSAGE_LENGTH, errorDetailOf, googleErrorOf } from './google-error.js';
import { errorDetailOf as errorDetailOfGoogle, soleReason, summaryOf } from './google.js';

const bytes = (value: unknown): Uint8Array =>
  new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));

describe('googleErrorOf (the quota-project spike’s error bodies)', () => {
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

describe('one parser for every route', () => {
  const answers: readonly (readonly [number, unknown])[] = [
    [
      403,
      {
        error: {
          status: 'PERMISSION_DENIED',
          message: 'm'.repeat(MAX_MESSAGE_LENGTH + 10),
          details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'SERVICE_DISABLED' }],
        },
      },
    ],
    [
      403,
      { error: { status: 'PERMISSION_DENIED', message: 'You cannot list assets in projects/demo-app-1.' } },
    ],
    [404, '<!DOCTYPE html><html>Error 404 (Not Found)</html>'],
    [429, { error: { message: 'slow down' } }],
  ];

  it('the preflight’s view (google.ts) and the streams’ view (googleErrorOf) read an answer alike', () => {
    // google.ts re-exports the same function, not a copy.
    expect(errorDetailOfGoogle).toBe(errorDetailOf);
    for (const [status, body] of answers) {
      const detail = errorDetailOf(bytes(body));
      const summary = summaryOf({ kind: 'answer', httpStatus: status, body: undefined, error: detail });
      const frame = googleErrorOf(status, bytes(body));
      expect(frame.reason, JSON.stringify(body)).toBe(
        soleReason({ kind: 'answer', httpStatus: status, body: undefined, error: detail }),
      );
      if (detail.message !== undefined) expect(frame.message).toBe(summary.message);
      if (detail.status !== undefined) expect(frame.code).toBe(summary.code);
    }
    // Both cut a long message at the same length.
    expect(errorDetailOf(bytes(answers[0]?.[1])).message).toHaveLength(MAX_MESSAGE_LENGTH);
  });
});
