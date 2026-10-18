// SPDX-License-Identifier: Apache-2.0
/**
 * The last permission check, as the app store keeps it (`connect.preflight`, state/slices.ts): plain data, never a
 * token. A result belongs to the request it answered (scope, mode, quota project); when the person changes any of
 * them, the page shows the result as out of date until they check again.
 */
import type { PreflightAnswer, PreflightRequest } from './api';

export type PreflightState =
  | { readonly status: 'idle' }
  | { readonly status: 'checking'; readonly request: PreflightRequest }
  | { readonly status: 'done'; readonly request: PreflightRequest; readonly answer: PreflightAnswer }
  | { readonly status: 'failed'; readonly request: PreflightRequest; readonly message: string };

export const IDLE_PREFLIGHT: PreflightState = { status: 'idle' };

/** Whether two requests ask the same thing. */
export function sameRequest(a: PreflightRequest, b: PreflightRequest): boolean {
  return a.scope === b.scope && a.mode === b.mode && (a.quotaProject ?? null) === (b.quotaProject ?? null);
}
