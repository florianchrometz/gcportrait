// SPDX-License-Identifier: MIT
/**
 * What can go wrong while ingesting. Bad input lines are not errors: they become {@link IngestProblem}s in the
 * report and the rest of the input is still read. {@link IngestError} is thrown only for problems that stop
 * the whole job: invalid options, an unreadable source, an upstream error frame, a session used after it
 * closed, or the first bad line when `strict` is on.
 */

/** Why a line (or one asset inside a `page` frame) was skipped. */
export type IngestProblemCode =
  /** The line's bytes are not valid UTF-8. */
  | 'invalid-utf8'
  /** The line is longer than `maxLineBytes`; it was skipped without being buffered. */
  | 'line-too-long'
  /** The line is not valid JSON. */
  | 'invalid-json'
  /** The line is JSON but not an object (an array, a number, a string, `null`). */
  | 'not-an-object'
  /**
   * The line has a `t` field and no `name` (a stream frame), and `t` is not `page`, `progress`, `done` or
   * `error`.
   */
  | 'unknown-frame'
  /** A `page`, `progress` or `done` frame lacks a required field or has one of the wrong type. */
  | 'invalid-frame'
  /** An asset (a whole line, or one item of a `page` frame) does not normalise into a model `Asset`. */
  | 'invalid-asset';

/** One skipped line or asset, with where it was found. */
export interface IngestProblem {
  readonly code: IngestProblemCode;
  /** Index of the input part (file) the line came from, from 0. */
  readonly part: number;
  /** Line number within its part, from 1. Blank lines count, so this matches an editor's line numbers. */
  readonly line: number;
  /** For an asset inside a `page` frame: its index in the frame's `assets` array. */
  readonly item?: number;
  /** A human-readable explanation. */
  readonly message: string;
}

/** Why an ingest job stopped. */
export type IngestErrorCode =
  /** An option is missing or invalid (scope, source, readTime, limits, clock, entropy). */
  | 'invalid-options'
  /** A source is not one of the accepted kinds, or a stream produced something other than bytes or text. */
  | 'invalid-source'
  /** `strict` is on and a line or asset was malformed; `problem` says which. */
  | 'malformed'
  /** The input carried an `error` frame; the message is the upstream message, verbatim. */
  | 'upstream'
  /** The runtime lacks an API the package needs (TextDecoder). */
  | 'unsupported-platform'
  /** A session was used after it finished or failed. */
  | 'closed';

/** What an upstream `error` frame said besides its message. */
export interface UpstreamFailure {
  /** The HTTP status the backend received from Google, when the frame carries one. */
  readonly status?: number;
  /** The upstream status code, e.g. `PERMISSION_DENIED`, when the frame carries one. */
  readonly code?: string;
}

/** Details attached to an {@link IngestError}. */
export interface IngestErrorDetails {
  readonly problem?: IngestProblem;
  readonly upstream?: UpstreamFailure;
}

/** Thrown when an ingest job cannot continue. */
export class IngestError extends Error {
  readonly code: IngestErrorCode;
  /** The offending line when `code` is `malformed`. */
  readonly problem: IngestProblem | undefined;
  /** The upstream status when `code` is `upstream`. */
  readonly upstream: UpstreamFailure | undefined;

  constructor(code: IngestErrorCode, message: string, details: IngestErrorDetails = {}) {
    super(message);
    this.name = 'IngestError';
    this.code = code;
    this.problem = details.problem;
    this.upstream = details.upstream;
  }
}
