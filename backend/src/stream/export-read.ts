// SPDX-License-Identifier: MIT
/**
 * Reading a Cloud Asset Inventory export from Cloud Storage with the caller's token (AGENTS.md, Data and
 * graph semantics; the cai-ingestion skill §1): the export's own NDJSON lines, streamed through as they
 * arrive.
 *
 * `gs://BUCKET/OBJECT` names one object (`--output-path`). A URI ending in `/`, or one that names no object,
 * is a prefix (`--output-path-prefix` writes `PREFIX/<asset type>/<shard>`): every object under `PREFIX/` is read,
 * in name order. Objects are read with the Cloud Storage JSON API (`…/o/OBJECT?alt=media`), listed with
 * `…/o?prefix=` (folder placeholders skipped). Between objects a line break is added when an object does not end
 * with one, so two files never run into one line. A failure ends the stream with an `error` frame on a line of
 * its own (frames.ts), which the browser's ingest reads among the export's lines.
 *
 * Caps: 60 s without a byte from Google (an idle timeout: an export can take minutes to stream), 1 GiB in all,
 * 10 000 objects listed under a prefix (folder placeholders included).
 */
import { googleErrorOf } from '../upstream/google-error.js';
import { isRecord, readJson } from '../upstream/json.js';
import {
  UpstreamExchangeError,
  openStream,
  requestJson,
  type ExchangeOptions,
  type UpstreamClient,
} from '../upstream/request.js';
import { isRetryableStatus } from '../upstream/retry.js';
import { exchangeErrorFrame } from './asset-list.js';
import { frameLine, googleErrorFrame, type ErrorFrame } from './frames.js';

export const STORAGE_BASE_URL = 'https://storage.googleapis.com/storage/v1';

/** The most bytes one export read streams (far above what a browser holds as one snapshot). */
export const MAX_EXPORT_BYTES = 1024 * 1024 * 1024;

/** The most objects one prefix may hold (an export writes one per asset type, with shards). */
export const MAX_EXPORT_OBJECTS = 10_000;

/** The largest JSON answer read (object metadata, a listing page, an error). */
const MAX_JSON_BYTES = 4 * 1024 * 1024;

/** A bucket name: 3 to 222 characters of lower-case letters, digits, dots, dashes and underscores. */
const BUCKET = /^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/;

function hasControlCharacter(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

export interface GcsLocation {
  readonly bucket: string;
  /** The object name, or the prefix when it is empty or ends with `/`. */
  readonly object: string;
}

/** A UTF-16 surrogate without its partner: text that has no UTF-8 form (and that encodeURIComponent throws on). */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/**
 * `gs://BUCKET/OBJECT` as a location, or null when it is not one: a valid bucket name, and an object name of at
 * most 1024 UTF-8 bytes of well-formed Unicode without control characters (Cloud Storage's own rules) that is
 * not `.` or `..`.
 */
export function parseGcsUri(uri: string): GcsLocation | null {
  const match = /^gs:\/\/([^/]+)(?:\/(.*))?$/s.exec(uri.trim());
  if (match === null) return null;
  const bucket = match[1] ?? '';
  const object = match[2] ?? '';
  if (!BUCKET.test(bucket) || bucket.includes('..')) return null;
  if (hasControlCharacter(object) || LONE_SURROGATE.test(object)) return null;
  if (new TextEncoder().encode(object).byteLength > 1024 || object === '.' || object === '..') return null;
  return { bucket, object };
}

export function gcsUri(location: GcsLocation): string {
  return `gs://${location.bucket}/${location.object}`;
}

export interface ExportObject {
  readonly name: string;
  readonly size: number;
}

export type ExportPlan =
  | { readonly ok: true; readonly objects: readonly ExportObject[]; readonly bytes: number }
  | { readonly ok: false; readonly frame: ErrorFrame };

/** What an export read did, for its log line (counts only: no bucket, no object name, no token). */
export interface ExportReadStats {
  objects: number;
  bytes: number;
  retries: number;
  end?: string;
}

export interface ExportReadOptions {
  readonly client: UpstreamClient;
  readonly token: string;
  readonly stats: ExportReadStats;
  readonly onRetry?: ExchangeOptions['onRetry'];
  /** The most bytes read in all; default {@link MAX_EXPORT_BYTES} (tests lower it). */
  readonly maxBytes?: number;
}

/** An object resource's `name` and `size` (a decimal string in the JSON API), or null. */
function objectOf(value: unknown): ExportObject | null {
  if (!isRecord(value)) return null;
  const { name, size } = value;
  const bytes = typeof size === 'string' && /^\d{1,16}$/.test(size) ? Number(size) : Number.NaN;
  return typeof name === 'string' && Number.isSafeInteger(bytes) ? { name, size: bytes } : null;
}

const badAnswer = (what: string): ErrorFrame => ({
  t: 'error',
  message: `Cloud Storage answered with something that is not ${what}.`,
  status: 502,
  code: 'BAD_UPSTREAM_ANSWER',
  retryable: true,
});

function headers(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, accept: 'application/json' };
}

function objectUrl(bucket: string, name: string): string {
  return `${STORAGE_BASE_URL}/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(name)}`;
}

function failureFrame(error: unknown, what: string): ErrorFrame {
  if (error instanceof UpstreamExchangeError) return exchangeErrorFrame(error, what);
  throw error;
}

/** Every object under `prefix`, in name order, or the reason there are none to read. */
async function listPrefix(
  location: GcsLocation,
  prefix: string,
  options: ExportReadOptions,
  signal: AbortSignal,
): Promise<ExportPlan> {
  const objects: ExportObject[] = [];
  // Every object listed counts against the cap, folder placeholders included, so that a prefix of placeholders
  // alone cannot keep the listing going page after page.
  let listed = 0;
  let pageToken: string | undefined;
  do {
    const query = new URLSearchParams({
      prefix,
      fields: 'items(name,size),nextPageToken',
      maxResults: '1000',
      ...(pageToken === undefined ? {} : { pageToken }),
    });
    let answer;
    try {
      answer = await requestJson(
        options.client,
        {
          url: `${STORAGE_BASE_URL}/b/${encodeURIComponent(location.bucket)}/o?${query.toString()}`,
          method: 'GET',
          headers: headers(options.token),
        },
        {
          signal,
          maxBytes: MAX_JSON_BYTES,
          ...(options.onRetry === undefined ? {} : { onRetry: options.onRetry }),
        },
      );
    } catch (error) {
      return { ok: false, frame: failureFrame(error, 'the listing of the export in Cloud Storage') };
    }
    if (answer.status !== 200)
      return {
        ok: false,
        frame: googleErrorFrame(googleErrorOf(answer.status, answer.body), isRetryableStatus(answer.status)),
      };
    const page = readJson(answer.body);
    if (!isRecord(page)) return { ok: false, frame: badAnswer('a listing of objects') };
    const items = page['items'] ?? [];
    const next = page['nextPageToken'];
    if (!Array.isArray(items) || (next !== undefined && typeof next !== 'string'))
      return { ok: false, frame: badAnswer('a listing of objects') };
    for (const item of items) {
      const object = objectOf(item);
      if (object === null) return { ok: false, frame: badAnswer('a listing of objects') };
      listed += 1;
      // A "folder" placeholder holds no lines.
      if (object.name.endsWith('/')) continue;
      objects.push(object);
    }
    if (listed > MAX_EXPORT_OBJECTS)
      return {
        ok: false,
        frame: {
          t: 'error',
          message: `There are more than ${MAX_EXPORT_OBJECTS.toLocaleString('en')} objects under gs://${location.bucket}/${prefix}; point at one export.`,
          status: 400,
          code: 'TOO_MANY_OBJECTS',
        },
      };
    pageToken = next === '' ? undefined : next;
  } while (pageToken !== undefined);
  if (objects.length === 0)
    return {
      ok: false,
      frame: {
        t: 'error',
        message: `There is no export at ${gcsUri(location)}: no object of that name and no objects under gs://${location.bucket}/${prefix}.`,
        status: 404,
        code: 'NOT_FOUND',
      },
    };
  objects.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { ok: true, objects, bytes: objects.reduce((sum, object) => sum + object.size, 0) };
}

/**
 * What a read covers: the one object the URI names, or every object under its prefix. A URI that does not end
 * in `/` is tried as an object first; when there is no such object (404) it is read as the prefix `OBJECT/`.
 */
export async function planExportRead(
  location: GcsLocation,
  options: ExportReadOptions,
  signal: AbortSignal,
): Promise<ExportPlan> {
  const plan = await planObjects(location, options, signal);
  if (plan.ok && plan.bytes > (options.maxBytes ?? MAX_EXPORT_BYTES))
    return {
      ok: false,
      frame: {
        t: 'error',
        message: `The export at ${gcsUri(location)} is larger than 1 GiB, more than this app can read at once. Export a folder or a project instead.`,
        status: 400,
        code: 'RESPONSE_TOO_LARGE',
      },
    };
  return plan;
}

async function planObjects(
  location: GcsLocation,
  options: ExportReadOptions,
  signal: AbortSignal,
): Promise<ExportPlan> {
  if (location.object === '' || location.object.endsWith('/'))
    return listPrefix(location, location.object, options, signal);
  let answer;
  try {
    answer = await requestJson(
      options.client,
      {
        url: `${objectUrl(location.bucket, location.object)}?fields=name,size`,
        method: 'GET',
        headers: headers(options.token),
      },
      {
        signal,
        maxBytes: MAX_JSON_BYTES,
        ...(options.onRetry === undefined ? {} : { onRetry: options.onRetry }),
      },
    );
  } catch (error) {
    return { ok: false, frame: failureFrame(error, 'the export in Cloud Storage') };
  }
  if (answer.status === 404) return listPrefix(location, `${location.object}/`, options, signal);
  if (answer.status !== 200)
    return {
      ok: false,
      frame: googleErrorFrame(googleErrorOf(answer.status, answer.body), isRetryableStatus(answer.status)),
    };
  const object = objectOf(readJson(answer.body));
  if (object === null) return { ok: false, frame: badAnswer('an object') };
  return { ok: true, objects: [object], bytes: object.size };
}

const LINE_FEED = 0x0a;

/**
 * The export's lines: each object's bytes as they arrive, a line break between objects that need one, and an
 * `error` frame on a line of its own if reading fails. Stops silently when `signal` aborts.
 */
export async function* exportLines(
  location: GcsLocation,
  objects: readonly ExportObject[],
  options: ExportReadOptions,
  signal: AbortSignal,
): AsyncGenerator<string | Uint8Array, void, undefined> {
  const { stats } = options;
  let endsWithLineFeed = true;
  const fail = (frame: ErrorFrame): string => {
    stats.end = frame.code ?? 'error';
    return `${endsWithLineFeed ? '' : '\n'}${frameLine(frame)}`;
  };
  for (const object of objects) {
    let opened;
    try {
      opened = await openStream(
        options.client,
        {
          url: `${objectUrl(location.bucket, object.name)}?alt=media`,
          method: 'GET',
          headers: { authorization: `Bearer ${options.token}` },
        },
        {
          signal,
          maxBytes: MAX_JSON_BYTES,
          ...(options.onRetry === undefined ? {} : { onRetry: options.onRetry }),
        },
      );
    } catch (error) {
      if (signal.aborted) return;
      yield fail(failureFrame(error, 'the export in Cloud Storage'));
      return;
    }
    if (!opened.ok) {
      const { answer } = opened;
      yield fail(
        googleErrorFrame(googleErrorOf(answer.status, answer.body), isRetryableStatus(answer.status)),
      );
      return;
    }
    stats.objects += 1;
    try {
      for await (const chunk of opened.stream.body) {
        if (chunk.byteLength === 0) continue;
        stats.bytes += chunk.byteLength;
        if (stats.bytes > (options.maxBytes ?? MAX_EXPORT_BYTES)) {
          yield fail({
            t: 'error',
            message: `The export at ${gcsUri(location)} is larger than 1 GiB, more than this app can read at once.`,
            status: 400,
            code: 'RESPONSE_TOO_LARGE',
          });
          return;
        }
        endsWithLineFeed = chunk[chunk.byteLength - 1] === LINE_FEED;
        yield chunk;
      }
    } catch (error) {
      if (signal.aborted) return;
      yield fail(failureFrame(error, 'the export in Cloud Storage'));
      return;
    }
    if (!endsWithLineFeed) {
      endsWithLineFeed = true;
      yield '\n';
    }
  }
  stats.end = 'done';
}
