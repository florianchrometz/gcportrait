// SPDX-License-Identifier: MIT
/**
 * `POST /api/render` (backend/AGENTS.md, The render API): a view of a scope, an uploaded export or
 * bundle, or a demo organisation, drawn on the server as SVG, PNG or a draw.io file (`"format": "drawio"`,
 * compressed unless `"compressed": false`; the pixel limits are a PNG's only) with the code `pnpm render`
 * runs (`@gcportrait/render`, in a fresh worker per render: ../render/runner.ts), so an instance's users can
 * script exports without the app. Registered only with the routes that call Google (never on a demo-only
 * instance) and only while `RENDER_API` is on.
 *
 * The request is one JSON document, `RenderOptionsSchema` of `@gcportrait/model` plus `source`: the whole body for
 * the `scope` and `demo` sources, or the `request` field of a `multipart/form-data` body whose `file` part follows
 * it for `ndjson` and `bundle`. Checks, in order: the caller's token and its rate limit (10 renders a minute) →
 * the schema → the source's authority (a pull's mode and gate, as on `/api/assets/stream`; tokeninfo must call the
 * token valid for the others) → one render per instance (`RENDER_BUSY`) → a stream slot for a pull
 * (`STREAMS_BUSY`) → the job. A pull is the stream route's own (`assetListFrames` with the same credentials, page
 * budget and slots): each frame goes to the job, and the next is asked for only once the job has read it, which
 * gives the page's budget claim back. The lock, the slot and the worker are given back however the render ends:
 * done, failed, timed out (`RENDER_TIMEOUT_MS`), the upload late (the server's body deadline: 408) or unreadable
 * (400), or the client gone. Once the client is gone or the time is up, nothing more is handed to the stopped job,
 * and a refusal of the job's that is still under way is handled, so it never becomes an unhandled rejection.
 *
 * A 200 answer carries the image in pieces with the streams' stall rule, `content-disposition` with the app's export
 * file name, the view drawn (`x-gcportrait-view`, a hash `pnpm render --hash` takes), and the detail level and scale
 * used. Errors are the server's one error answer with a `code` (../errors.ts; the route's own in
 * ../render/errors.ts), sent before any image byte; a retryable one carries `Retry-After`. One log line per
 * render, of counts only: never the token, the scope or the view.
 */
import { Readable } from 'node:stream';

import multipart from '@fastify/multipart';
import {
  DemoSizeSchema,
  RenderOptionsObjectSchema,
  TimestampSchema,
  checkRenderOptions,
  renderTooManyAssetsMessage,
} from '@gcportrait/model';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import * as z from 'zod';

import type { RenderLimits } from '../config.js';
import { sendError } from '../errors.js';
import {
  RENDER_BUSY_RETRY_SECONDS,
  frameFailure,
  jobFailure,
  UPLOAD_SHAPE,
  uploadFailure,
  type RenderFailure,
} from '../render/errors.js';
import type { JobResult, JobSource, JobSpec } from '../render/protocol.js';
import { RenderJobError, type RenderRun, type RenderRunner } from '../render/runner.js';
import { assetListFrames, type AssetListStats } from '../stream/asset-list.js';
import type { ErrorFrame } from '../stream/frames.js';
import { sendPieces, watchResponse, type StreamOutcome } from '../stream/ndjson.js';
import type { PageBudget } from '../stream/page-budget.js';
import {
  assetListQueryOf,
  checkPullMode,
  pullCredentials,
  PullFieldsSchema,
  refuseUnavailableMode,
  type PullAuthority,
} from '../stream/pull.js';
import { StreamSlots } from '../stream/slots.js';
import { tokenFacts } from '../upstream/google.js';
import {
  authenticate,
  googleContextFor,
  invalidRequest,
  SIGN_IN_AGAIN_MESSAGE,
  takeStreamSlot,
} from '../upstream/route-support.js';
import { ScopeNameSchema } from '../upstream/scope.js';
import { TokenRateLimiter } from '../upstream/token-limit.js';

/** Renders per token hash and minute. */
export const RENDER_RATE_LIMIT_PER_MINUTE = 10;

/**
 * One render at a time per instance (backend/AGENTS.md, The render API): a render keeps the instance's only
 * CPU busy and holds hundreds of MiB, so a second one waits for another instance (Cloud Run adds them) rather
 * than sharing this one. The lock is a table of stream slots ({@link createRenderLock}) with one slot, taken under
 * this one key: in memory only, given back exactly once however the render ends.
 */
export const RENDER_LOCK_KEY = 'render';

/** One server's render lock: one slot, under {@link RENDER_LOCK_KEY}. */
export function createRenderLock(): StreamSlots {
  return new StreamSlots(1);
}

/** Where the data of a render comes from. */
export const RenderSourceSchema = z.discriminatedUnion('kind', [
  PullFieldsSchema.extend({ kind: z.literal('scope') }),
  z.strictObject({
    kind: z.literal('ndjson'),
    /** The scope the export was taken of; default the root its assets' ancestors share. */
    scope: ScopeNameSchema.optional(),
    /** When the export was taken (as an export's operation.json says); default the latest asset change. */
    readTime: TimestampSchema.optional(),
  }),
  z.strictObject({ kind: z.literal('bundle') }),
  z.strictObject({ kind: z.literal('demo'), size: DemoSizeSchema }),
]);

export const RenderRequestSchema = RenderOptionsObjectSchema.extend({
  source: RenderSourceSchema,
}).superRefine((body, context) => {
  checkRenderOptions(body, context);
  if (body.source.kind === 'scope') checkPullMode(body.source, context, ['source']);
});
export type RenderRequest = z.infer<typeof RenderRequestSchema>;

export interface RenderRouteOptions {
  readonly limits: RenderLimits;
  readonly authority: PullAuthority;
  readonly slots: StreamSlots;
  readonly budget: PageBudget;
  readonly runner: RenderRunner;
  /** One render per instance ({@link createRenderLock}). */
  readonly lock: StreamSlots;
  /** The largest `request` field of an upload: the server's JSON body limit. */
  readonly fieldBytes: number;
  /** The server's deadline for a request body (server.ts), named in the 408 of an upload that missed it. */
  readonly bodyTimeoutMs: number;
  /** Renders per token hash and minute; default {@link RENDER_RATE_LIMIT_PER_MINUTE}. */
  readonly ratePerMinute?: number;
  /** How long the answer waits for its client to take a piece (../stream/ndjson.ts); tests lower it. */
  readonly stallMs?: number;
  /** The instance's version, which a draw.io file names after the wordmark in its `agent`. */
  readonly version?: string;
}

/** A pull's `error` frame, which ends the render with its answer. */
class PullFailure extends Error {
  readonly frame: ErrorFrame;

  constructor(frame: ErrorFrame) {
    super(frame.message);
    this.frame = frame;
  }
}

/** The render ran out of time (`RENDER_TIMEOUT_MS`). */
class RenderTimeout extends Error {}

/** The upload passed `RENDER_MAX_BODY_BYTES`. */
class UploadTooLarge extends Error {}

/** Reading the upload's file part failed: the body was late, cut short or malformed (`cause`). */
class UploadUnreadable extends Error {
  constructor(cause: unknown) {
    super('The upload could not be read.', { cause });
  }
}

/**
 * `promise`, or `signal`'s reason as soon as it aborts. `promise` may still reject after that (a job stopped since,
 * ../render/runner.ts); its rejection is handled here in every case, so it never becomes an unhandled rejection,
 * which would end the process.
 */
function unlessAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  promise.catch(() => undefined);
  if (signal.aborted) return Promise.reject(signal.reason as Error);
  return new Promise<T>((resolve, reject) => {
    const aborted = (): void => {
      reject(signal.reason as Error);
    };
    signal.addEventListener('abort', aborted, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', aborted);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', aborted);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/** The multipart parts of an upload: the `request` field's text and the `file` part's stream. */
type Upload =
  | { readonly ok: true; readonly document: unknown; readonly next: () => Promise<Readable | null> }
  | { readonly ok: false; readonly failure: RenderFailure };

/**
 * An upload's body as it arrives: the multipart parts, and the error the request itself failed with, if any. The
 * server's body deadline (server.ts) fails the request with a 408; the multipart reader then ends the part being
 * read with a plain "premature close", so the request's own error says what happened.
 */
interface UploadBody {
  readonly request: FastifyRequest;
  /** The request's own error, once it failed. */
  readonly failed: () => unknown;
}

function watchUploadBody(request: FastifyRequest): UploadBody {
  let failure: unknown;
  request.raw.on('error', (error: unknown) => {
    failure ??= error;
  });
  return { request, failed: () => failure };
}

/**
 * Reads the multipart body's `request` field; its `file` part is read on demand (`next`, which rejects with an
 * {@link UploadUnreadable}). A body that cannot be read is answered, never thrown: 408 past the body deadline, 413
 * past a limit, 400 when it is malformed (no boundary, cut short).
 */
async function readUpload(
  body: UploadBody,
  fieldBytes: number,
  fileBytes: number,
  bodyTimeoutMs: number,
): Promise<Upload> {
  const refused = (error: unknown): Upload => ({
    ok: false,
    failure: uploadFailure(body.failed() ?? error, bodyTimeoutMs),
  });
  let parts;
  let first;
  try {
    parts = body.request.parts({
      limits: { fields: 1, files: 1, parts: 2, fieldSize: fieldBytes, fileSize: fileBytes },
    });
    first = await parts.next();
  } catch (error) {
    return refused(error);
  }
  const part = first.done === true ? undefined : first.value;
  if (part?.type !== 'field' || part.fieldname !== 'request')
    return { ok: false, failure: { status: 400, code: 'INVALID_REQUEST', message: UPLOAD_SHAPE } };
  let document: unknown = part.value;
  if (typeof document === 'string') {
    try {
      document = JSON.parse(document);
    } catch {
      return {
        ok: false,
        failure: {
          status: 400,
          code: 'INVALID_REQUEST',
          message: 'Invalid request: request: not valid JSON.',
        },
      };
    }
  }
  return {
    ok: true,
    document,
    next: async () => {
      let second;
      try {
        second = await parts.next();
      } catch (error) {
        throw new UploadUnreadable(error);
      }
      const file = second.done === true ? undefined : second.value;
      return file?.type === 'file' && file.fieldname === 'file' ? file.file : null;
    },
  };
}

/** The file part's chunks; a failure to read them (the body late, cut short, malformed) is {@link UploadUnreadable}. */
async function* uploadChunks(file: Readable): AsyncGenerator<Uint8Array, void, undefined> {
  try {
    for await (const chunk of file as AsyncIterable<Uint8Array>) yield chunk;
  } catch (error) {
    throw new UploadUnreadable(error);
  }
}

/** The job's source for the request's. */
function jobSourceOf(source: RenderRequest['source']): JobSource {
  switch (source.kind) {
    case 'scope':
      return { kind: 'pull', scope: { kind: source.scope.kind, id: source.scope.id }, mode: source.mode };
    case 'ndjson':
      return {
        kind: 'ndjson',
        scope: source.scope === undefined ? null : { kind: source.scope.kind, id: source.scope.id },
        ...(source.readTime === undefined ? {} : { readTime: source.readTime }),
      };
    case 'bundle':
      return { kind: 'bundle' };
    case 'demo':
      return { kind: 'demo', size: source.size };
  }
}

/** The answer's headers for a result. */
function resultHeaders(result: JobResult): Record<string, string> {
  return {
    'content-disposition': `attachment; filename="${result.fileName}"`,
    'content-length': String(result.bytes.byteLength),
    'x-gcportrait-view': result.viewHash,
    'x-gcportrait-detail': result.detailUsed,
    ...(result.scale === undefined ? {} : { 'x-gcportrait-scale': String(result.scale) }),
  };
}

export async function registerRenderRoute(app: FastifyInstance, options: RenderRouteOptions): Promise<void> {
  const { limits, authority } = options;
  const limiter = new TokenRateLimiter({ max: options.ratePerMinute ?? RENDER_RATE_LIMIT_PER_MINUTE });

  // Its own context: only this route takes multipart bodies.
  await app.register(async (scope) => {
    await scope.register(multipart, { throwFileSizeLimit: true });

    scope.post('/api/render', async (request, reply) => {
      const multipartBody = request.isMultipart();
      // A refused upload stops reading its body: the connection is closed rather than drained.
      const refuse = (failure: RenderFailure): FastifyReply => {
        if (multipartBody) reply.header('connection', 'close');
        return sendError(request, reply, failure);
      };

      const callerToken = authenticate(request, reply, limiter);
      if (callerToken === null) return reply;

      let document: unknown = request.body;
      let nextFile: (() => Promise<Readable | null>) | undefined;
      const uploadBody = multipartBody ? watchUploadBody(request) : null;
      // Why reading the upload failed: the request's own error (the body deadline's 408) before the reader's.
      const unreadable = (error: UploadUnreadable): RenderFailure =>
        uploadFailure(uploadBody?.failed() ?? error.cause, options.bodyTimeoutMs);
      if (uploadBody !== null) {
        const upload = await readUpload(
          uploadBody,
          options.fieldBytes,
          limits.maxBodyBytes,
          options.bodyTimeoutMs,
        );
        if (!upload.ok) return refuse(upload.failure);
        document = upload.document;
        nextFile = upload.next;
      }
      const parsed = RenderRequestSchema.safeParse(document);
      if (!parsed.success) return refuse(invalidRequest(parsed.error));
      const body = parsed.data;
      const { source } = body;
      const upload = source.kind === 'ndjson' || source.kind === 'bundle';
      if (upload !== multipartBody)
        return refuse({
          status: 415,
          code: 'UNSUPPORTED_MEDIA_TYPE',
          message: upload
            ? `The ${source.kind} source is an upload. ${UPLOAD_SHAPE}`
            : `The ${source.kind} source takes a JSON body (application/json), not multipart.`,
        });
      let file: Readable | null = null;
      if (nextFile !== undefined) {
        try {
          file = await nextFile();
        } catch (error) {
          if (!(error instanceof UploadUnreadable)) throw error;
          return refuse(unreadable(error));
        }
        if (file === null)
          return refuse({
            status: 415,
            code: 'UNSUPPORTED_MEDIA_TYPE',
            message: `The file part is missing. ${UPLOAD_SHAPE}`,
          });
      }

      // The source's authority: a pull's mode (its gate runs below), else a token Google calls valid.
      if (source.kind === 'scope') {
        const refused = refuseUnavailableMode(request, reply, source.mode, authority);
        if (refused !== null) return refused;
      } else {
        const facts = await tokenFacts(googleContextFor(request, reply, authority.upstream), callerToken);
        if (facts.kind === 'invalid')
          return refuse({ status: 401, code: 'UNAUTHENTICATED', message: SIGN_IN_AGAIN_MESSAGE });
        if (facts.kind === 'unknown')
          return refuse({
            status: 503,
            code: 'TOKEN_CHECK_UNAVAILABLE',
            message: 'Google could not confirm your sign-in just now. Try again in a moment.',
            retryable: true,
            retryAfter: RENDER_BUSY_RETRY_SECONDS,
          });
      }

      const unlock = options.lock.acquire(RENDER_LOCK_KEY);
      if (unlock === null)
        return refuse({
          status: 429,
          code: 'RENDER_BUSY',
          message: 'Another render is running on this instance. Try again in a few seconds.',
          retryable: true,
          retryAfter: RENDER_BUSY_RETRY_SECONDS,
        });
      let releaseSlot = (): void => undefined;
      if (source.kind === 'scope') {
        const slot = takeStreamSlot(request, reply, options.slots, callerToken);
        if (slot === null) {
          unlock();
          return reply;
        }
        releaseSlot = slot;
      }

      const started = Date.now();
      const stats: AssetListStats = { pages: 0, assets: 0, retries: 0 };
      // The job, once started: the end of the response stops it (a holder, as the callback is made before it).
      const current: { run?: RenderRun } = {};
      let outcome: string | undefined;
      let bytes = 0;
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort(new RenderTimeout('The render took longer than this instance allows.'));
      }, limits.timeoutMs);
      const life = watchResponse(reply, (ended: StreamOutcome) => {
        clearTimeout(timer);
        current.run?.stop();
        releaseSlot();
        unlock();
        // Counts only: never the token, the scope or the view.
        request.log.info(
          {
            render: {
              source: source.kind,
              format: body.format,
              theme: body.theme,
              assets: current.run?.assets ?? stats.assets,
              bytes,
              ms: Date.now() - started,
              outcome: outcome ?? ended,
            },
          },
          'render ended',
        );
      });
      life.signal.addEventListener(
        'abort',
        () => {
          controller.abort(life.signal.reason);
        },
        { once: true },
      );
      const fail = (failure: RenderFailure): FastifyReply => {
        outcome = failure.code;
        return refuse(failure);
      };

      let credentials;
      if (source.kind === 'scope') {
        const pull = await pullCredentials(
          request,
          reply,
          source,
          callerToken,
          authority,
          'render',
          life.signal,
        );
        if (!pull.ok) {
          outcome = 'refused';
          return pull.reply;
        }
        credentials = pull.credentials;
      }

      const spec: JobSpec = {
        source: jobSourceOf(source),
        options: {
          view: body.view,
          theme: body.theme,
          format: body.format,
          viewport: body.viewport,
          ...(body.scale === undefined ? {} : { scale: body.scale }),
          ...(body.width === undefined ? {} : { width: body.width }),
          ...(body.compressed === undefined ? {} : { compressed: body.compressed }),
          ...(body.fontSource === undefined ? {} : { fontSource: body.fontSource }),
        },
        maxAssets: limits.maxAssets,
        maxPixels: limits.maxPixels,
        ...(options.version === undefined ? {} : { version: options.version }),
      };
      const job = options.runner(spec);
      current.run = job;
      const { signal } = controller;
      let result: JobResult;
      try {
        if (source.kind === 'scope' && credentials !== undefined) {
          const frames = assetListFrames(
            assetListQueryOf(source),
            {
              client: authority.upstream,
              credentials,
              stats,
              budget: options.budget,
              onRetry: (event) => {
                request.log.warn({ upstream: 'cloudasset', ...event }, 'retrying upstream');
              },
            },
            signal,
          );
          const encoder = new TextEncoder();
          for await (const line of frames) {
            // A page Google answered after the end (the client gone, the time up) is not handed to the stopped job.
            if (signal.aborted) break;
            if (typeof line === 'string' && line.startsWith('{"t":"error"'))
              throw new PullFailure(JSON.parse(line) as ErrorFrame);
            if (stats.assets > limits.maxAssets)
              throw new RenderJobError('TOO_MANY_ASSETS', renderTooManyAssetsMessage(limits.maxAssets));
            await unlessAborted(job.push(typeof line === 'string' ? encoder.encode(line) : line), signal);
          }
        } else if (file !== null) {
          // Past RENDER_MAX_BODY_BYTES busboy cuts the file short and marks it truncated.
          const truncated = (): boolean => (file as Readable & { truncated?: boolean }).truncated === true;
          for await (const chunk of uploadChunks(file)) {
            if (truncated() || signal.aborted) break;
            await unlessAborted(job.push(chunk), signal);
          }
          if (truncated()) throw new UploadTooLarge();
        }
        if (signal.aborted) throw signal.reason as Error;
        result = await unlessAborted(job.end(), signal);
      } catch (error) {
        job.stop();
        if (life.signal.aborted) {
          outcome = 'client-gone';
          return reply;
        }
        if (error instanceof UploadTooLarge)
          return fail({
            status: 413,
            code: 'BODY_TOO_LARGE',
            message: 'The upload is larger than this instance accepts (RENDER_MAX_BODY_BYTES).',
          });
        if (error instanceof RenderTimeout)
          return fail({
            status: 503,
            code: 'RENDER_TIMEOUT',
            message: `${error.message} Narrow the data or the view, or ask for an SVG.`,
            retryable: false,
          });
        if (error instanceof PullFailure) {
          const failure = frameFailure(error.frame);
          // Google no longer accepts the caller's token: the sign-in answer every route gives.
          if (failure.status === 401) {
            outcome = failure.code;
            return sendError(request, reply, { status: 401, message: failure.message });
          }
          return fail(failure);
        }
        if (error instanceof RenderJobError) {
          if (error.detail !== undefined) request.log.error({ renderError: error.detail }, 'render failed');
          return fail(jobFailure(error, source.kind));
        }
        if (error instanceof UploadUnreadable) return fail(unreadable(error));
        throw error;
      }
      clearTimeout(timer);
      outcome = 'finished';
      bytes = result.bytes.byteLength;
      return sendPieces(reply, life, () => [result.bytes], {
        log: request.log,
        contentType: result.contentType,
        headers: resultHeaders(result),
        ...(options.stallMs === undefined ? {} : { stallMs: options.stallMs }),
      });
    });
  });
}
