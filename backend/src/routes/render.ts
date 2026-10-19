// SPDX-License-Identifier: Apache-2.0
/**
 * POST /api/render orchestrates source admission, the render worker and the answer. Policy:
 * backend/AGENTS.md, The render API; wire format: docs/api.md. Model render options plus source are
 * the JSON body for scope/demo, or the multipart request field before the file for ndjson/bundle.
 *
 * Check order: caller token and rate limit → schema → source authority (pull mode/gate through
 * ../stream/pull.ts; tokeninfo validity otherwise) → instance render lock → pull stream slot → job.
 * A pull sends assetListFrames to the job and waits for each acknowledgement before advancing,
 * returning that page's claim then. The deadline starts at the lock; lock, slot and worker are released
 * on every exit, including late or unreadable uploads. After cancellation nothing more reaches the
 * stopped job, and outstanding job refusals remain handled.
 *
 * ../stream/ndjson.ts sends the answer in pieces; ../errors.ts and ../render/errors.ts map refusals
 * before any image byte. The route records one counts-only outcome line (backend/README.md, "Render API").
 */
import multipart, { type Multipart, type MultipartFile } from '@fastify/multipart';
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
  isClientGoneError,
  sendClientGone,
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

/** The upload passed `RENDER_MAX_BODY_BYTES`. */
class UploadTooLarge extends Error {}

/** Reading the upload's file part failed: the body was late, cut short or malformed (`cause`). */
class UploadUnreadable extends Error {
  constructor(cause: unknown) {
    super('The upload could not be read.', { cause });
  }
}

/** The upload violated multipart constraints (oversized JSON part or extra trailing parts). */
class UploadError extends Error {
  readonly statusCode: number;
  constructor(code: 'field-too-large' | 'bad-parts', message: string) {
    super(message);
    this.statusCode = code === 'field-too-large' ? 413 : 400;
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

/** The uploaded file part and its multipart stream iterator for trailing checks. */
interface UploadFile {
  readonly filePart: MultipartFile;
  readonly parts: AsyncIterableIterator<Multipart>;
}

/** The multipart parts of an upload: the `request` field's text and the `file` part's stream. */
type Upload =
  | { readonly ok: true; readonly document: unknown; readonly next: () => Promise<UploadFile | null> }
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
  try {
    const parts = body.request.parts({
      limits: { fields: 1, files: 1, parts: 2, fieldSize: fieldBytes, fileSize: fileBytes },
    });
    const first = await parts.next();
    const part = first.done === true ? undefined : first.value;
    if (part?.type !== 'field' || part.fieldname !== 'request')
      return { ok: false, failure: { status: 400, code: 'INVALID_REQUEST', message: UPLOAD_SHAPE } };
    if (part.valueTruncated || part.fieldnameTruncated)
      throw new UploadError('field-too-large', 'The request JSON part exceeds the 64 KiB field limit.');
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
        if (file?.type !== 'file' || file.fieldname !== 'file') return null;
        return { filePart: file, parts };
      },
    };
  } catch (error) {
    return refused(error);
  }
}

/** The file part's chunks; a failure to read them (the body late, cut short, malformed) is {@link UploadUnreadable}. */
async function* uploadChunks(
  filePart: MultipartFile,
  parts: AsyncIterableIterator<Multipart>,
): AsyncGenerator<Uint8Array, void, undefined> {
  try {
    for await (const chunk of filePart.file as AsyncIterable<Uint8Array>) yield chunk;
    if (filePart.file.truncated) throw new UploadTooLarge();
    let trailing;
    try {
      trailing = await parts.next();
    } catch (error) {
      throw new UploadUnreadable(error);
    }
    if (!trailing.done) {
      if (trailing.value.type === 'file') trailing.value.file.resume();
      throw new UploadError('bad-parts', 'Extra multipart parts after the file are not allowed.');
    }
  } catch (error) {
    if (error instanceof UploadTooLarge) throw error;
    if (error instanceof UploadUnreadable) throw error;
    if (error instanceof UploadError) throw error;
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
      let nextFile: (() => Promise<UploadFile | null>) | undefined;
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
      let file: UploadFile | null = null;
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
        const factsContext = googleContextFor(request, reply, authority.upstream);
        let facts;
        try {
          facts = await tokenFacts(factsContext, callerToken);
        } catch (error) {
          if (isClientGoneError(error, factsContext.signal)) {
            return sendClientGone(reply);
          }
          throw error;
        }
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
      const timeout = AbortSignal.timeout(limits.timeoutMs);
      const life = watchResponse(reply, (ended: StreamOutcome) => {
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
      const signal = AbortSignal.any([life.signal, timeout]);
      const fail = (failure: RenderFailure): FastifyReply => {
        outcome = failure.code;
        return refuse(failure);
      };

      let streamed = false;
      try {
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
            outcome = life.signal.aborted ? 'client-gone' : 'refused';
            return await pull.reply;
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
            const truncated = (): boolean => file.filePart.file.truncated;
            for await (const chunk of uploadChunks(file.filePart, file.parts)) {
              if (truncated() || signal.aborted) break;
              await unlessAborted(job.push(chunk), signal);
            }
            if (truncated()) throw new UploadTooLarge();
          }
          if (signal.aborted) throw signal.reason as Error;
          result = await unlessAborted(job.end(), signal);
        } catch (error) {
          job.stop();
          if (life.signal.aborted || isClientGoneError(error, life.signal)) {
            outcome = 'client-gone';
            return await reply;
          }
          if (error instanceof UploadTooLarge)
            return await fail({
              status: 413,
              code: 'BODY_TOO_LARGE',
              message: 'The upload is larger than this instance accepts (RENDER_MAX_BODY_BYTES).',
            });
          if (timeout.aborted && error === timeout.reason)
            return await fail({
              status: 503,
              code: 'RENDER_TIMEOUT',
              message:
                'The render took longer than this instance allows. Narrow the data or the view, or ask for an SVG.',
              retryable: false,
            });
          if (error instanceof PullFailure) {
            const failure = frameFailure(error.frame);
            // Google no longer accepts the caller's token: the sign-in answer every route gives.
            if (failure.status === 401) {
              outcome = failure.code;
              return await sendError(request, reply, { status: 401, message: failure.message });
            }
            return await fail(failure);
          }
          if (error instanceof RenderJobError) {
            if (error.detail !== undefined) request.log.error({ renderError: error.detail }, 'render failed');
            return await fail(jobFailure(error, source.kind));
          }
          if (error instanceof UploadError)
            return await fail({
              status: error.statusCode,
              code: error.statusCode === 413 ? 'BODY_TOO_LARGE' : 'INVALID_REQUEST',
              message: error.message,
            });
          if (error instanceof UploadUnreadable) return await fail(unreadable(error));
          throw error;
        }
        outcome = 'finished';
        bytes = result.bytes.byteLength;
        const sent = sendPieces(reply, life, () => [result.bytes], {
          log: request.log,
          contentType: result.contentType,
          headers: resultHeaders(result),
          ...(options.stallMs === undefined ? {} : { stallMs: options.stallMs }),
        });
        streamed = true;
        return await sent;
      } finally {
        if (!streamed) life.end();
      }
    });
  });
}
