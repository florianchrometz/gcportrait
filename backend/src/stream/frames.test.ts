// SPDX-License-Identifier: Apache-2.0
/** The NDJSON frames of a stream (frames.ts): one line each, and Google's errors as the app reads them. */
import { describe, expect, it } from 'vitest';

import { frameLine, googleErrorFrame } from './frames.js';

describe('frames', () => {
  it('are one line of JSON each', () => {
    const line = frameLine({
      t: 'page',
      assets: [{ name: '//x.googleapis.com/a\nb', data: { text: 'two\nlines' } }],
    });
    expect(line.endsWith('\n')).toBe(true);
    expect(line.slice(0, -1)).not.toContain('\n');
  });

  it('carry Google’s error as status, code, reason and the message verbatim', () => {
    expect(
      googleErrorFrame({
        httpStatus: 403,
        code: 'PERMISSION_DENIED',
        reason: 'SERVICE_DISABLED',
        message: 'off',
      }),
    ).toEqual({
      t: 'error',
      message: 'off',
      status: 403,
      code: 'PERMISSION_DENIED',
      reason: 'SERVICE_DISABLED',
    });
    expect(googleErrorFrame({ httpStatus: 503, code: 'UNAVAILABLE', message: 'busy' }, true)).toEqual({
      t: 'error',
      message: 'busy',
      status: 503,
      code: 'UNAVAILABLE',
      retryable: true,
    });
  });
});
