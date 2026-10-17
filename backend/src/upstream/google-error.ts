// SPDX-License-Identifier: MIT
/**
 * Google's error answers, read once for every route (AGENTS.md, Security and privacy, Quota project and the
 * permission check; skill cai-ingestion §9). Google APIs answer an error with the envelope `{"error":
 * {"code", "message", "status", "details": [...]}}`; Cloud Storage's JSON API leaves out `status`. The
 * backend classifies by HTTP status and the `ErrorInfo` reason, never by message text, and passes the message
 * on verbatim (skill cai-ingestion §4: 400/403/404 are actionable). A body that is not that JSON (an HTML
 * error page, for a request Google could not route) is never forwarded.
 *
 * {@link errorDetailOf} is the one parser of the envelope: the preflight, the scope search and the
 * service-account gate classify its {@link GoogleErrorDetail} (through upstream/google.ts). What every route
 * reports of an answer is the one reading of that parse, {@link googleErrorOfDetail}: a stream's error frame
 * ({@link googleErrorOf}) and the `upstream` summary of a preflight item, a gate refusal or a search problem
 * (upstream/google.ts, `summaryOf`) carry the same status, canonical code and reason for the same answer.
 */
import { isRecord, readJson } from './json.js';

/** One `google.rpc.ErrorInfo` of an error answer's `details`. */
export interface ErrorInfo {
  readonly reason: string;
  readonly domain?: string;
  readonly metadata: Readonly<Record<string, string>>;
}

/** An error answer, read by status and `ErrorInfo` (never by message text). */
export interface GoogleErrorDetail {
  /** Whether the body was Google's JSON error envelope; an HTML page or anything else is not. */
  readonly json: boolean;
  /** `error.status` exactly as Google sent it (`PERMISSION_DENIED`, …), if it sent one. */
  readonly status?: string;
  /** `error.message`, cut at {@link MAX_MESSAGE_LENGTH} characters; only for JSON answers (HTML is never passed on). */
  readonly message?: string;
  /** Every ErrorInfo in `error.details`, in order. */
  readonly infos: readonly ErrorInfo[];
}

/** An error answer as every route reports it: a stream's `error` frame, the summary of upstream/google.ts. */
export interface GoogleError {
  /** The HTTP status Google answered with. */
  readonly httpStatus: number;
  /** Google's canonical status (`PERMISSION_DENIED`, `NOT_FOUND`, …), or the one the HTTP status implies. */
  readonly code: string;
  /** The `ErrorInfo` reason (`SERVICE_DISABLED`, `USER_PROJECT_DENIED`, …) when there is exactly one. */
  readonly reason?: string;
  /** Google's message, verbatim (cut at {@link MAX_MESSAGE_LENGTH} characters). */
  readonly message: string;
}

/** Longer upstream messages are cut: they are shown to a person, and nothing longer is ever meaningful. */
export const MAX_MESSAGE_LENGTH = 2000;

const ERROR_INFO_TYPE = 'type.googleapis.com/google.rpc.ErrorInfo';

/** A canonical status or an ErrorInfo reason as Google spells them: upper case and underscores. */
const CODE_PATTERN = /^[A-Z][A-Z_]{1,63}$/;

/** The canonical status Google's HTTP mapping gives a status code, for answers without `error.status`. */
function codeForHttpStatus(status: number): string {
  switch (status) {
    case 400:
      return 'INVALID_ARGUMENT';
    case 401:
      return 'UNAUTHENTICATED';
    case 403:
      return 'PERMISSION_DENIED';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'ABORTED';
    case 412:
      return 'FAILED_PRECONDITION';
    case 429:
      return 'RESOURCE_EXHAUSTED';
    case 499:
      return 'CANCELLED';
    case 501:
      return 'UNIMPLEMENTED';
    case 503:
      return 'UNAVAILABLE';
    case 504:
      return 'DEADLINE_EXCEEDED';
    default:
      return status >= 500 ? 'INTERNAL' : 'UNKNOWN';
  }
}

function stringRecord(value: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (!isRecord(value)) return result;
  for (const [key, entry] of Object.entries(value)) if (typeof entry === 'string') result[key] = entry;
  return result;
}

function cut(text: string): string {
  return text.length <= MAX_MESSAGE_LENGTH ? text : `${text.slice(0, MAX_MESSAGE_LENGTH - 1)}…`;
}

/** Reads an error body. Never throws; a body that is not Google's JSON envelope gives `json: false`. */
export function errorDetailOf(body: Uint8Array): GoogleErrorDetail {
  const parsed = readJson(body);
  const error = isRecord(parsed) ? parsed.error : undefined;
  if (!isRecord(error)) return { json: false, infos: [] };
  const infos: ErrorInfo[] = [];
  if (Array.isArray(error.details)) {
    for (const detail of error.details) {
      if (!isRecord(detail) || detail['@type'] !== ERROR_INFO_TYPE) continue;
      const reason = typeof detail.reason === 'string' ? detail.reason : '';
      infos.push({
        reason,
        ...(typeof detail.domain === 'string' ? { domain: detail.domain } : {}),
        metadata: stringRecord(detail.metadata),
      });
    }
  }
  return {
    json: true,
    ...(typeof error.status === 'string' ? { status: error.status } : {}),
    ...(typeof error.message === 'string' && error.message.trim() !== ''
      ? { message: cut(error.message) }
      : {}),
    infos,
  };
}

/** Reads an error answer's body as the streams report it. Never throws; anything unexpected becomes a generic message. */
export function googleErrorOf(httpStatus: number, body: Uint8Array): GoogleError {
  return googleErrorOfDetail(httpStatus, errorDetailOf(body));
}

/**
 * An error answer already parsed ({@link errorDetailOf}) as every route reports it: `error.status` when it is
 * shaped like a canonical code, else the one the HTTP status implies; the one ErrorInfo reason when it is
 * shaped like one; Google's message, or a generic sentence when it sent none.
 */
export function googleErrorOfDetail(httpStatus: number, detail: GoogleErrorDetail): GoogleError {
  const [info, ...more] = detail.infos;
  const reason =
    info !== undefined && more.length === 0 && CODE_PATTERN.test(info.reason) ? info.reason : undefined;
  return {
    httpStatus,
    code:
      detail.status !== undefined && CODE_PATTERN.test(detail.status)
        ? detail.status
        : codeForHttpStatus(httpStatus),
    ...(reason === undefined ? {} : { reason }),
    message: detail.message ?? `Google answered HTTP ${String(httpStatus)} without a readable error message.`,
  };
}
