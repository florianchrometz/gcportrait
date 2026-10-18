// SPDX-License-Identifier: MIT
/**
 * CAI pagination as NDJSON frames (frames.ts; cai-ingestion skill §1/§4). The shared request builder
 * is upstream/google.ts's assetsListRequest; list-page.ts scans each answer into its frame.
 * Each page yields a page frame then progress, ending with done or error; credentials are requested
 * before every page, so the service-account gate may refuse between pages.
 *
 * readPage hands its memory claim to the frame's consumer and releases it on every other exit. Only
 * the frame remains reachable while the consumer waits (page-budget.ts); ndjson.ts controls when the
 * producer advances. Limits and retries: docs/security.md, "Timeouts" and "Response caps and memory";
 * upstream/request.ts and upstream/retry.ts own the exchange policy.
 */
import { googleErrorOf } from '../upstream/google-error.js';
import { assetsListRequest, UPSTREAM_MAX_BYTES, type CaiCredentials } from '../upstream/google.js';
import {
  UpstreamExchangeError,
  requestJson,
  type ByteClaim,
  type RetryEvent,
  type UpstreamClient,
} from '../upstream/request.js';
import { isRetryableStatus } from '../upstream/retry.js';
import { frameLine, googleErrorFrame, type ErrorFrame } from './frames.js';
import { scanListPage } from './list-page.js';
import type { PageBudget } from './page-budget.js';

/** Results per page (the API allows up to 1000; 500 keeps a page well under the cap). */
export const CAI_PAGE_SIZE = 500;

export interface AssetListQuery {
  /** The validated scope as a URL path: `organizations/<number>`, `folders/<number>`, `projects/<id or number>`. */
  readonly scopePath: string;
  readonly readTime?: string;
  readonly assetTypes?: readonly string[];
}

/** The credentials for one page, or why there are none (the service-account gate refused). */
export type PageCredentials =
  ({ readonly ok: true } & CaiCredentials) | { readonly ok: false; readonly frame: ErrorFrame };

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
      assetsListRequest(query.scopePath, credentials, {
        pageSize: options.pageSize ?? CAI_PAGE_SIZE,
        readTime: query.readTime,
        assetTypes: query.assetTypes,
        pageToken,
      }),
      {
        signal,
        maxBytes: UPSTREAM_MAX_BYTES,
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
      const error = googleErrorOf(answer.status, answer.body);
      return { ok: false, frame: googleErrorFrame(error, isRetryableStatus(answer.status)) };
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
      const read = await readPage(query, credentials, pageToken, options, signal);
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
