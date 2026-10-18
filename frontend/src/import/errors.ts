// SPDX-License-Identifier: Apache-2.0
/**
 * What went wrong with a live pull or an export read, in words a person can act on (docs/permissions.md).
 * Google's message is always shown as it came (skill cai-ingestion §4); the title and the advice come from the
 * HTTP status, Google's canonical code and the `ErrorInfo` reason, never from the message text. Permission problems
 * point to the Permissions page, whose check (the preflight) names the missing grant and its command.
 */
import type { ImportFailure, ImportKind } from './progress';

export type ImportError =
  /** The backend refused the request before streaming (its JSON error body). */
  | { readonly kind: 'request'; readonly status: number; readonly message: string }
  /** An `error` frame: Google's answer, or the backend's own (timeouts, caps). */
  | {
      readonly kind: 'upstream';
      readonly message: string;
      readonly status?: number;
      readonly code?: string;
      readonly reason?: string;
    }
  /** A pull's stream ended without its `done` frame. */
  | { readonly kind: 'cut-short' }
  /** The connection to the backend failed or broke. */
  | { readonly kind: 'network' }
  /** There is no usable token. */
  | { readonly kind: 'signed-out' }
  /** The export held no asset. */
  | { readonly kind: 'empty'; readonly problems: readonly string[] }
  /** The browser refused to store the snapshot. */
  | { readonly kind: 'storage'; readonly message: string }
  /** Anything else the import worker reported. */
  | { readonly kind: 'other'; readonly message: string; readonly problems?: readonly string[] };

export interface FailureContext {
  readonly kind: ImportKind;
  /** The scope as the page names it ("example.com", "Folder 20000000001"); pulls. */
  readonly scope?: string;
  /** The quota project of a user-mode pull. */
  readonly quotaProject?: string;
  /** The gs:// URI of an export read. */
  readonly uri?: string;
}

const RETRY = 'Try again in a minute.';
const SIGN_IN_AGAIN = 'Sign in with Google again, then try again.';

function isTransient(status: number | undefined, code: string | undefined): boolean {
  if (status !== undefined && (status === 429 || status >= 500)) return true;
  return code === 'UPSTREAM_TIMEOUT' || code === 'UPSTREAM_UNREACHABLE' || code === 'BAD_UPSTREAM_ANSWER';
}

function upstreamFailure(
  error: Extract<ImportError, { kind: 'upstream' }>,
  context: FailureContext,
): ImportFailure {
  const { message, status, code, reason } = error;
  const scope = context.scope ?? 'the scope';
  const quota = context.quotaProject ?? 'the quota project';
  const pull = context.kind === 'pull';
  if (status === 401 || code === 'UNAUTHENTICATED')
    return { title: 'Google no longer accepts your sign-in.', message, advice: SIGN_IN_AGAIN };
  if (reason === 'ACCESS_TOKEN_SCOPE_INSUFFICIENT')
    return {
      title: 'Your sign-in does not allow reading Cloud Asset Inventory.',
      message,
      advice: 'Sign in again and allow gcportrait to read Cloud Asset Inventory.',
    };
  if (reason === 'SERVICE_DISABLED')
    return {
      title: `The Cloud Asset API is not enabled in ${quota}.`,
      message,
      advice:
        'Enable it there (the permission check shows the command), allow a few minutes, then pull again.',
      checkPermissions: true,
    };
  if (reason === 'USER_PROJECT_DENIED')
    return {
      title:
        status === 400
          ? `${quota} does not exist or was deleted.`
          : `You may not use ${quota} for API quota.`,
      message,
      advice: 'Pick another quota project, or get the role the permission check names.',
      checkPermissions: true,
    };
  if (code === 'RESPONSE_TOO_LARGE')
    return {
      title: pull
        ? 'Cloud Asset Inventory answered with more than gcportrait reads at once.'
        : 'The export is too large.',
      message,
      advice: pull
        ? 'Read an export of the scope instead (below), or pull a folder or a project.'
        : 'Export a folder or a project instead of the whole organisation.',
    };
  if (isTransient(status, code))
    return {
      title: 'Google did not answer in time, or was busy.',
      message,
      advice: pull ? `${RETRY} For a very large scope, an export is more reliable.` : RETRY,
      retryable: true,
    };
  if (status === 403)
    return pull
      ? {
          title: `You cannot list assets in ${scope}, or it does not exist.`,
          message,
          advice:
            'You need roles/cloudasset.viewer on the scope; the permission check names what is missing.',
          checkPermissions: true,
        }
      : {
          title: `You cannot read ${context.uri ?? 'this export'}.`,
          message,
          advice: 'You need storage.objects.get on the bucket, for example roles/storage.objectViewer.',
        };
  if (status === 404)
    return pull
      ? { title: `${scope} did not exist at that read time, or was not found.`, message }
      : {
          title: `There is no export at ${context.uri ?? 'that address'}.`,
          message,
          advice: 'Check the URI.',
        };
  if (status === 400 && pull)
    return {
      title: 'Cloud Asset Inventory refused the request.',
      message,
      advice: 'Check the asset types and the read time (no more than 35 days back).',
    };
  const label = [status === undefined ? null : String(status), code, reason].filter(Boolean).join(' ');
  return { title: `Google refused the request${label === '' ? '' : ` (${label})`}.`, message };
}

export function describeFailure(error: ImportError, context: FailureContext): ImportFailure {
  switch (error.kind) {
    case 'upstream':
      return upstreamFailure(error, context);
    case 'request':
      if (error.status === 401)
        return { title: 'Your sign-in has ended.', message: error.message, advice: SIGN_IN_AGAIN };
      if (error.status === 429)
        return { title: 'Too many reads at once.', message: error.message, advice: RETRY, retryable: true };
      if (error.status === 403 || error.status === 501)
        return { title: 'The backend refused the request.', message: error.message, checkPermissions: true };
      if (error.status >= 500)
        return {
          title: 'The backend could not take the request.',
          message: error.message,
          advice: RETRY,
          retryable: true,
        };
      return { title: 'The backend refused the request.', message: error.message };
    case 'cut-short':
      return {
        title: 'The stream ended early, so nothing was stored.',
        message: 'The connection to the backend closed before Cloud Asset Inventory had sent every page.',
        advice: RETRY,
        retryable: true,
      };
    case 'network':
      return {
        title: 'The connection to the backend broke.',
        message: 'Nothing was stored.',
        advice: RETRY,
        retryable: true,
      };
    case 'signed-out':
      return {
        title: 'You are not signed in.',
        message: 'Reading from Google Cloud needs your sign-in.',
        advice: SIGN_IN_AGAIN,
      };
    case 'empty':
      return {
        title: 'No assets were found in the export.',
        message:
          error.problems.length === 0
            ? 'The files hold no Cloud Asset Inventory lines.'
            : error.problems.join(' '),
        advice: 'Check that the export used --content-type=resource.',
      };
    case 'storage':
      return {
        title: 'This browser refused to store the snapshot.',
        message: error.message,
        advice:
          'The space it allows this site may be full: delete snapshots you no longer need on the Snapshots page.',
      };
    case 'other':
      return { title: 'The import failed.', message: [error.message, ...(error.problems ?? [])].join(' ') };
  }
}
