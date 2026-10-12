// SPDX-License-Identifier: MIT
/**
 * The NDJSON frames of `POST /api/assets/stream` (skill cai-ingestion §4), one JSON
 * object per line, exactly as `@gcportrait/ingest` reads them in the browser (packages/ingest/README.md,
 * "Dialects"): an object with a `t` field and no `name`.
 *
 * - `{"t":"page","assets":[…]}`: one page of `assets.list` results, the assets as Google sent them;
 * - `{"t":"progress","pages":n,"assets":m}`: totals so far;
 * - `{"t":"done","assets":m,"readTime":"…"}`: the end, with the read time Google reported;
 * - `{"t":"error","message":"…","status":403,"code":"PERMISSION_DENIED","reason":"…"}`: the end, failed;
 *   `message` is Google's, verbatim; `status` the HTTP status Google answered with; `code` Google's canonical
 *   status; `reason` the `ErrorInfo` reason when there is one; `retryable` when trying again later may help.
 *
 * `POST /api/export/read` streams the export's own lines and uses only the `error` frame, which ingest reads
 * in either stream.
 */
import type { GoogleError } from '../upstream/google-error.js';

export type StreamFrame =
  | { readonly t: 'page'; readonly assets: readonly unknown[] }
  | { readonly t: 'progress'; readonly pages: number; readonly assets: number }
  | { readonly t: 'done'; readonly assets: number; readonly readTime?: string }
  | ErrorFrame;

export interface ErrorFrame {
  readonly t: 'error';
  readonly message: string;
  readonly status?: number;
  readonly code?: string;
  readonly reason?: string;
  readonly retryable?: boolean;
}

/** One frame as a line of NDJSON. `JSON.stringify` never writes a line break, so a frame is always one line. */
export function frameLine(frame: StreamFrame): string {
  return `${JSON.stringify(frame)}\n`;
}

/** The error frame for an error answer from Google. */
export function googleErrorFrame(error: GoogleError, retryable = false): ErrorFrame {
  return {
    t: 'error',
    message: error.message,
    status: error.httpStatus,
    code: error.code,
    ...(error.reason === undefined ? {} : { reason: error.reason }),
    ...(retryable ? { retryable: true } : {}),
  };
}
