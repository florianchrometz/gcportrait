// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';

import { describeFailure, type FailureContext, type ImportError } from './errors';

const PULL: FailureContext = { kind: 'pull', scope: 'example.com', quotaProject: 'demo-quota-1' };
const EXPORT: FailureContext = { kind: 'export', uri: 'gs://demo-exports/export.json' };

const upstream = (fields: Omit<Extract<ImportError, { kind: 'upstream' }>, 'kind'>): ImportError => ({
  kind: 'upstream',
  ...fields,
});

/** A case's title: what failed (status, code and reason, or the kind) and in which read. */
function failureName(error: ImportError, context: FailureContext): string {
  const what =
    error.kind === 'upstream'
      ? [String(error.status), error.code, error.reason].filter(Boolean).join(' ')
      : 'status' in error
        ? `${error.kind} ${String(error.status)}`
        : error.kind;
  return `${what} during ${context.kind === 'pull' ? 'a pull' : 'an export read'}`;
}

describe('describeFailure', () => {
  const cases: readonly [ImportError, FailureContext, Record<string, unknown>][] = [
    [
      upstream({ status: 403, code: 'PERMISSION_DENIED', message: 'Request denied by Cloud IAM.' }),
      PULL,
      {
        title: 'You cannot list assets in example.com, or it does not exist.',
        message: 'Request denied by Cloud IAM.',
        checkPermissions: true,
      },
    ],
    [
      upstream({
        status: 403,
        code: 'PERMISSION_DENIED',
        reason: 'SERVICE_DISABLED',
        message: 'API disabled.',
      }),
      PULL,
      { title: 'The Cloud Asset API is not enabled in demo-quota-1.', checkPermissions: true },
    ],
    [
      upstream({ status: 403, code: 'PERMISSION_DENIED', reason: 'USER_PROJECT_DENIED', message: 'No.' }),
      PULL,
      { title: 'You may not use demo-quota-1 for API quota.', checkPermissions: true },
    ],
    [
      upstream({ status: 400, code: 'INVALID_ARGUMENT', reason: 'USER_PROJECT_DENIED', message: 'Gone.' }),
      PULL,
      { title: 'demo-quota-1 does not exist or was deleted.', checkPermissions: true },
    ],
    [
      upstream({
        status: 403,
        code: 'PERMISSION_DENIED',
        reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT',
        message: 'x',
      }),
      PULL,
      { title: 'Your sign-in does not allow reading Cloud Asset Inventory.' },
    ],
    [
      upstream({ status: 404, code: 'NOT_FOUND', message: 'Requested entity was not found.' }),
      PULL,
      { title: 'example.com did not exist at that read time, or was not found.' },
    ],
    [
      upstream({
        status: 400,
        code: 'INVALID_ARGUMENT',
        message: 'No RESOURCE found that matches asset type x.',
      }),
      PULL,
      {
        title: 'Cloud Asset Inventory refused the request.',
        message: 'No RESOURCE found that matches asset type x.',
        advice: 'Check the asset types and the read time (no more than 35 days back).',
      },
    ],
    [
      upstream({ status: 401, code: 'UNAUTHENTICATED', message: 'Invalid credentials.' }),
      PULL,
      { title: 'Google no longer accepts your sign-in.' },
    ],
    [
      upstream({ status: 503, code: 'UNAVAILABLE', message: 'Busy.' }),
      PULL,
      { title: 'Google did not answer in time, or was busy.', retryable: true },
    ],
    [
      upstream({ status: 504, code: 'UPSTREAM_TIMEOUT', message: 'No answer.' }),
      EXPORT,
      {
        title: 'Google did not answer in time, or was busy.',
        advice: 'Try again in a minute.',
        retryable: true,
      },
    ],
    [
      upstream({ status: 502, code: 'RESPONSE_TOO_LARGE', message: 'Too big.' }),
      PULL,
      { title: 'Cloud Asset Inventory answered with more than gcportrait reads at once.' },
    ],
    [
      upstream({
        status: 403,
        code: 'PERMISSION_DENIED',
        message: 'person@example.com does not have access.',
      }),
      EXPORT,
      {
        title: 'You cannot read gs://demo-exports/export.json.',
        advice: 'You need storage.objects.get on the bucket, for example roles/storage.objectViewer.',
      },
    ],
    [
      upstream({
        status: 404,
        code: 'NOT_FOUND',
        message: 'There is no export at gs://demo-exports/export.json.',
      }),
      EXPORT,
      { title: 'There is no export at gs://demo-exports/export.json.' },
    ],
    [
      upstream({ status: 409, code: 'ABORTED', reason: 'SOMETHING_NEW', message: 'Odd.' }),
      PULL,
      { title: 'Google refused the request (409 ABORTED SOMETHING_NEW).', message: 'Odd.' },
    ],
    [{ kind: 'request', status: 401, message: 'Sign in first.' }, PULL, { title: 'Your sign-in has ended.' }],
    [
      { kind: 'request', status: 429, message: 'Four asset streams are already running.' },
      PULL,
      { title: 'Too many reads at once.', retryable: true },
    ],
    [
      { kind: 'request', status: 403, message: 'Service-account mode is off on this gcportrait instance.' },
      PULL,
      { title: 'The backend refused the request.', checkPermissions: true },
    ],
    [
      { kind: 'cut-short' },
      PULL,
      { title: 'The stream ended early, so nothing was stored.', retryable: true },
    ],
    [{ kind: 'network' }, PULL, { title: 'The connection to the backend broke.', retryable: true }],
    [{ kind: 'signed-out' }, PULL, { title: 'You are not signed in.' }],
    [{ kind: 'empty', problems: ['Line 1: not JSON'] }, EXPORT, { message: 'Line 1: not JSON' }],
    [
      { kind: 'storage', message: 'Quota.' },
      EXPORT,
      { title: 'This browser refused to store the snapshot.' },
    ],
  ];

  // Google's message is shown verbatim; a permission problem points at the permission check.
  it.each(
    cases.map(
      ([error, context, expected]) => [failureName(error, context), error, context, expected] as const,
    ),
  )('words %s', (_name, error, context, expected) => {
    expect(describeFailure(error, context)).toMatchObject(expected);
  });

  it('never words the message itself', () => {
    const message =
      'Exactly what Google said, with "quotes" and a link https://cloud.google.com/asset-inventory.';
    for (const status of [400, 403, 404, 429, 500])
      expect(describeFailure(upstream({ status, message }), PULL).message).toBe(message);
  });
});
