// SPDX-License-Identifier: MIT
/**
 * The live pull (ADR 0010, skill cai-ingestion §1 and §4, ADR 0028 §5): Cloud Asset Inventory
 * `assets.list` page by page, as NDJSON frames (frames.ts).
 *
 * - `POST https://cloudasset.googleapis.com/v1/{scope}/assets` with `X-HTTP-Method-Override: GET` and a JSON body (a
 *   POST without the override is an HTML 404, the quota-project spike's finding 11): `contentType: RESOURCE`,
 *   `pageSize: 500` (the API allows 1000; 500 keeps a page well under the 25 MiB cap), `readTime` and `assetTypes`
 *   when asked, and the `pageToken` of the previous page's `nextPageToken`, until a page has none.
 * - Each page: a `page` frame with its assets as Google sent them (scanned into the frame, not parsed:
 *   list-page.ts), then a `progress` frame with the totals. A page without an `assets` key is an empty page (finding
 *   12). At the end a `done` frame with the total and the `readTime` Google reported (every 200 carries one).
 * - Retries: 429, 5xx, timeouts and transport failures, by the upstream client's policy (500 ms, ×2, ≤ 8 s, 5
 *   attempts). Every other answer ends the stream with an `error` frame carrying Google's message verbatim, its
 *   status, canonical code and `ErrorInfo` reason: 400 (`assetTypes`, `readTime`), 401, 403, 404 (a `readTime`
 *   before the scope existed: `status: 404, code: "NOT_FOUND"`, which the timeline shows as "did not exist yet").
 * - Caps: 60 s per page attempt, 25 MiB per page, and the process-wide page budget (page-budget.ts): each
 *   page's bytes are claimed as they arrive and given back once the response has written its frame out to the
 *   connection (ndjson.ts asks for the next line only then), or at once when the page ends the stream with an
 *   error frame instead; a page the budget cannot hold is retried like a timeout, then ends the stream with a
 *   retryable `INSTANCE_BUSY` frame. Nothing of a page but its frame is kept while the frame waits for the client.
 *
 * The credentials are asked for before every page: in user mode they are the caller's token and quota project;
 * in service-account mode the gate of ADR 0028 §4 runs before every CAI call and may refuse.
 */
import { googleErrorOf } from '../upstream/google-error.js';
import {
  UpstreamExchangeError,
  requestJson,
  type ByteClaim,
  type RetryEvent,
  type UpstreamClient,
} from '../upstream/request.js';
import { frameLine, googleErrorFrame, type ErrorFrame } from './frames.js';
import { scanListPage } from './list-page.js';
import type { PageBudget } from './page-budget.js';

export const CAI_BASE_URL = 'https://cloudasset.googleapis.com/v1';

/** Results per page (the API allows up to 1000; ADR 0028 §5 keeps 500). */
export const CAI_PAGE_SIZE = 500;

/** The largest page read (skill cai-ingestion §4; docs/security.md §5). */
export const MAX_PAGE_BYTES = 25 * 1024 * 1024;

export interface AssetListQuery {
  /** The validated scope as a URL path: `organizations/<number>`, `folders/<number>`, `projects/<id or number>`. */
  readonly scopePath: string;
  readonly readTime?: string;
  readonly assetTypes?: readonly string[];
}

/** The credentials for one page, or why there are none (the service-account gate refused). */
export type PageCredentials =
  | { readonly ok: true; readonly token: string; readonly quotaProject?: string }
  | { readonly ok: false; readonly frame: ErrorFrame };

/** What a stream did, for its log line (counts only: no scope, no asset, no token). */
export interface AssetListStats {
  pages: number;
  assets: number;
  retries: number;
  /** How it ended: `done`, or the error frame's code. */
  end?: string;
}

export interface AssetListOptions {
  readonly client: UpstreamClient;
  readonly credentials: (signal: AbortSignal) => Promise<PageCredentials>;
  readonly stats: AssetListStats;
  readonly pageSize?: number;
  readonly maxPageBytes?: number;
  readonly onRetry?: (event: RetryEvent) => void;
  /** The process-wide page budget (page-budget.ts); without it pages are not counted (tests of other things). */
  readonly budget?: PageBudget;
}

/**
 * The error frame for an attempt that produced no answer (after its retries, if it had any). `what` names what
 * was asked for, to follow "for": "a page of Cloud Asset Inventory results".
 */
export function exchangeErrorFrame(error: UpstreamExchangeError, what: string, advice = ''): ErrorFrame {
  const attempts = error.attempts > 1 ? ` (${String(error.attempts)} attempts)` : '';
  const base = error.message.replace(/\.$/, '');
  switch (error.kind) {
    case 'timeout':
      return {
        t: 'error',
        message: `${base} for ${what}${attempts}. Try again later.`,
        status: 504,
        code: 'UPSTREAM_TIMEOUT',
        retryable: true,
      };
    case 'transport':
      return {
        t: 'error',
        message: `${base} for ${what}${attempts}. Try again later.`,
        status: 502,
        code: 'UPSTREAM_UNREACHABLE',
        retryable: true,
      };
    case 'too-large':
      return {
        t: 'error',
        message: `${base.replace("Google's answer", `Google's answer for ${what}`)}.${advice === '' ? '' : ` ${advice}`}`,
        status: 502,
        code: 'RESPONSE_TOO_LARGE',
      };
    case 'busy':
      return {
        t: 'error',
        message: `${base}, so it could not read ${what}${attempts}. Try again in a minute.`,
        status: 503,
        code: 'INSTANCE_BUSY',
        retryable: true,
      };
  }
}

function requestBody(query: AssetListQuery, pageSize: number, pageToken: string | undefined): string {
  return JSON.stringify({
    contentType: 'RESOURCE',
    pageSize,
    ...(query.readTime === undefined ? {} : { readTime: query.readTime }),
    ...(query.assetTypes === undefined ? {} : { assetTypes: query.assetTypes }),
    ...(pageToken === undefined ? {} : { pageToken }),
  });
}

/** One page read: its frame line and what the stream needs of it, or the error frame that ends the stream. */
type PageRead =
  | {
      readonly ok: true;
      /** The `page` frame, one line, in a buffer outside the JavaScript heap (list-page.ts). */
      readonly line: Uint8Array;
      readonly count: number;
      readonly nextPageToken?: string;
      readonly readTime?: string;
      /** The page's memory claim (page-budget.ts), released once the line has been written out. */
      readonly claim?: ByteClaim;
    }
  | { readonly ok: false; readonly frame: ErrorFrame }
  | { readonly ok: 'aborted' };

/**
 * Reads one page and turns it into its frame (list-page.ts: scanned, never parsed). A function of its own so that
 * the page's bytes are unreachable once it returns: only the frame is kept while it waits for the client. The
 * page's claim goes to the caller with the frame; every other way out of here gives it back.
 */
async function readPage(
  url: string,
  query: AssetListQuery,
  credentials: Extract<PageCredentials, { ok: true }>,
  pageToken: string | undefined,
  options: AssetListOptions,
  signal: AbortSignal,
): Promise<PageRead> {
  const { stats, budget } = options;
  let answer;
  try {
    answer = await requestJson(
      options.client,
      {
        url,
        method: 'POST',
        headers: {
          authorization: `Bearer ${credentials.token}`,
          'x-http-method-override': 'GET',
          'content-type': 'application/json',
          accept: 'application/json',
          ...(credentials.quotaProject === undefined
            ? {}
            : { 'x-goog-user-project': credentials.quotaProject }),
        },
        body: requestBody(query, options.pageSize ?? CAI_PAGE_SIZE, pageToken),
      },
      {
        signal,
        maxBytes: options.maxPageBytes ?? MAX_PAGE_BYTES,
        onRetry: (event) => {
          stats.retries += 1;
          options.onRetry?.(event);
        },
        ...(budget === undefined ? {} : { claim: () => budget.claim() }),
      },
    );
  } catch (error) {
    if (signal.aborted) return { ok: 'aborted' };
    if (error instanceof UpstreamExchangeError)
      return {
        ok: false,
        frame: exchangeErrorFrame(
          error,
          'a page of Cloud Asset Inventory results',
          'Narrow the asset types, or read an export of the scope instead.',
        ),
      };
    throw error;
  }
  const { claim } = answer;
  // Set once the claim travels with the frame; until then it is this function's to give back (an error frame, a
  // body that is not a page, a 2xx other than 200, an exception).
  let handedOn = false;
  try {
    if (answer.status !== 200) {
      const retryable = answer.status === 429 || answer.status >= 500;
      return { ok: false, frame: googleErrorFrame(googleErrorOf(answer.status, answer.body), retryable) };
    }
    const page = scanListPage(answer.body);
    if (page === null)
      return {
        ok: false,
        frame: {
          t: 'error',
          message: 'Cloud Asset Inventory answered with something that is not a page of assets.',
          status: 502,
          code: 'BAD_UPSTREAM_ANSWER',
          retryable: true,
        },
      };
    const read: PageRead = {
      ok: true,
      line: page.frame,
      count: page.count,
      ...(page.nextPageToken === undefined ? {} : { nextPageToken: page.nextPageToken }),
      ...(page.readTime === undefined ? {} : { readTime: page.readTime }),
      ...(claim === undefined ? {} : { claim }),
    };
    handedOn = true;
    return read;
  } finally {
    if (!handedOn) claim?.release();
  }
}

/** The frames of one live pull. Ends with a `done` or an `error` frame; stops silently when `signal` aborts. */
export async function* assetListFrames(
  query: AssetListQuery,
  options: AssetListOptions,
  signal: AbortSignal,
): AsyncGenerator<string | Uint8Array, void, undefined> {
  const { stats } = options;
  const url = `${CAI_BASE_URL}/${query.scopePath}/assets`;
  const fail = (frame: ErrorFrame): string => {
    stats.end = frame.code ?? 'error';
    return frameLine(frame);
  };
  let pageToken: string | undefined;
  let readTime: string | undefined;
  // The claim of the page whose frame is being handed to the client, if any.
  let held: ByteClaim | undefined;

  try {
    // The first line opens the stream at once, before Google has answered anything.
    yield frameLine({ t: 'progress', pages: 0, assets: 0 });
    for (;;) {
      const credentials = await options.credentials(signal);
      if (!credentials.ok) {
        yield fail(credentials.frame);
        return;
      }
      const read = await readPage(url, query, credentials, pageToken, options, signal);
      if (read.ok === 'aborted') return;
      if (!read.ok) {
        yield fail(read.frame);
        return;
      }
      stats.pages += 1;
      stats.assets += read.count;
      readTime ??= read.readTime;
      held = read.claim;
      yield read.line;
      // Asked for the next line: the response has written the page's frame out to the connection (ndjson.ts).
      held?.release();
      held = undefined;
      yield frameLine({ t: 'progress', pages: stats.pages, assets: stats.assets });
      if (read.nextPageToken === undefined) break;
      if (read.nextPageToken === pageToken) {
        yield fail({
          t: 'error',
          message: 'Cloud Asset Inventory repeated a page token, so the listing would never end.',
          status: 502,
          code: 'BAD_UPSTREAM_ANSWER',
        });
        return;
      }
      pageToken = read.nextPageToken;
    }
    stats.end = 'done';
    yield frameLine({ t: 'done', assets: stats.assets, ...(readTime === undefined ? {} : { readTime }) });
  } finally {
    held?.release();
  }
}
