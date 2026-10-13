// SPDX-License-Identifier: MIT
/**
 * Streaming an NDJSON response (the backend streams and forgets; agents.md, Security and privacy, principle
 * 1). The producer is an async generator of lines, and it is asked for its next line only once the response
 * has written the previous one out to the connection: `Readable.from` alone pulls the next line as soon as a
 * line has been queued on the socket, whether or not the client takes it, so a client that stops reading
 * would keep every line queued for it in memory, uncounted (a live-pull page of up to 25 MiB per stream). A
 * producer can therefore keep what a line costs (a page's budget claim, page-budget.ts) until it is asked for
 * more. A line longer than {@link WRITE_PIECE_BYTES} is written in copies of that size, so no piece waiting
 * on the socket keeps the whole line alive. A piece that has to wait must be taken whole within
 * {@link STREAM_STALL_MS}, or the connection is closed: a minimum rate (about 17 KiB/s for 1 MiB pieces),
 * which cuts off a client that reads too slowly as well as one that stopped.
 *
 * When the client goes away (or stalls) the stream's signal aborts, which cancels the upstream request in
 * flight and any backoff wait, and the generator is closed; `onEnd` runs exactly once however the response
 * ends (finished, failed, the client gone or stalled, or answered with an error before streaming began).
 *
 * `sendPieces` is the same writer for any content type: the render API sends its images through it.
 */
import type { ServerResponse } from 'node:http';
import { Readable } from 'node:stream';

import type { FastifyBaseLogger, FastifyReply } from 'fastify';

import { frameLine } from './frames.js';

/** The abort reason when the client closed the connection before the response ended. */
export class ClientGoneError extends Error {
  override readonly name = 'ClientGoneError';
}

/** The abort reason when the client stopped taking the response and the server closed the connection. */
export class ClientStalledError extends Error {
  override readonly name = 'ClientStalledError';
}

export const NDJSON_CONTENT_TYPE = 'application/x-ndjson; charset=utf-8';

/**
 * How long a response waits for its client to take a piece that has to wait (one written while the
 * connection's buffers are full; at most {@link WRITE_PIECE_BYTES}) before it closes the connection. The wait
 * is per piece and is not restarted when the client takes part of it, so a client must read at least about
 * 17 KiB/s while a large page streams: one that reads more slowly is cut off like one that stopped
 * (`client-stalled`), and gives back its stream slot and its page's claim. A faster client may stream for as
 * long as Google answers (within Cloud Run's request timeout).
 */
export const STREAM_STALL_MS = 60_000;

/** The largest piece of a line written to the response at once. */
export const WRITE_PIECE_BYTES = 1024 * 1024;

export type StreamOutcome = 'finished' | 'client-gone' | 'client-stalled';

/** One response's life: its abort signal and its end, watched from the moment a stream slot is taken. */
export interface StreamLife {
  /** Aborts when the client closes the connection early, or when it stalls ({@link StreamLife.stalled}). */
  readonly signal: AbortSignal;
  /** Runs `onEnd` now unless it already ran (the generator's end; the connection's close calls it too). */
  readonly end: () => void;
  /** Ends the response because the client stopped reading: aborts `signal` and closes the connection. */
  readonly stalled: () => void;
}

/** Watches the reply's connection: aborts `signal` if it closes early, runs `onEnd` once when it is over. */
export function watchResponse(reply: FastifyReply, onEnd: (outcome: StreamOutcome) => void): StreamLife {
  const controller = new AbortController();
  let ended = false;
  let stalled = false;
  const end = (): void => {
    if (ended) return;
    ended = true;
    onEnd(stalled ? 'client-stalled' : controller.signal.aborted ? 'client-gone' : 'finished');
  };
  reply.raw.once('close', () => {
    if (!reply.raw.writableFinished)
      controller.abort(new ClientGoneError('The client closed the connection.'));
    end();
  });
  return {
    signal: controller.signal,
    end,
    stalled: () => {
      if (controller.signal.aborted) return;
      stalled = true;
      controller.abort(new ClientStalledError('The client stopped reading the response.'));
      reply.raw.destroy();
    },
  };
}

export interface NdjsonOptions {
  readonly log: FastifyBaseLogger;
  /** Extra response headers (sent before the first line). */
  readonly headers?: Readonly<Record<string, string>>;
  /** {@link STREAM_STALL_MS}; tests lower it. */
  readonly stallMs?: number;
}

/**
 * A line as the pieces it is written in: itself, or copies of at most {@link WRITE_PIECE_BYTES} (copies, so
 * a piece still queued on the socket does not keep the whole line's buffer alive once its producer lets go).
 */
function* piecesOf(line: string | Uint8Array): Generator<string | Uint8Array, void, undefined> {
  if (typeof line === 'string' || line.byteLength <= WRITE_PIECE_BYTES) {
    yield line;
    return;
  }
  for (let start = 0; start < line.byteLength; start += WRITE_PIECE_BYTES)
    yield new Uint8Array(line.subarray(start, start + WRITE_PIECE_BYTES));
}

/**
 * Waits until the response holds no more than its high-water mark of unwritten bytes (at once when it already
 * does). True when it does, false when the stream ended first (the client left, or did not take the piece
 * within `stallMs`: then {@link StreamLife.stalled} has closed the connection). Above the high-water mark the
 * socket (or, before the response has one, the response itself) has refused a write and announces with
 * `drain` when it took everything. The timer runs from the start of the wait: the piece must be taken whole
 * within `stallMs`.
 */
function written(response: ServerResponse, life: StreamLife, stallMs: number): Promise<boolean> {
  if (life.signal.aborted) return Promise.resolve(false);
  if (response.writableLength <= response.writableHighWaterMark) return Promise.resolve(true);
  const { socket } = response;
  return new Promise<boolean>((resolve) => {
    const settle = (value: boolean): void => {
      clearTimeout(timer);
      response.off('drain', check);
      socket?.off('drain', check);
      life.signal.removeEventListener('abort', aborted);
      resolve(value);
    };
    function check(): void {
      if (response.writableLength <= response.writableHighWaterMark) settle(true);
    }
    function aborted(): void {
      settle(false);
    }
    const timer = setTimeout(() => {
      life.stalled();
      settle(false);
    }, stallMs);
    response.on('drain', check);
    socket?.on('drain', check);
    life.signal.addEventListener('abort', aborted, { once: true });
  });
}

export interface PiecesOptions {
  readonly log: FastifyBaseLogger;
  readonly contentType: string;
  /** Extra response headers (sent before the first piece). */
  readonly headers?: Readonly<Record<string, string>>;
  /** {@link STREAM_STALL_MS}; tests lower it. */
  readonly stallMs?: number;
  /** Written when the producer throws (a bug), after the error is logged; by default the response just ends. */
  readonly failure?: string;
}

/**
 * Sends `produce`'s chunks as the response body with status 200, whatever their content type, each written out in
 * pieces of at most {@link WRITE_PIECE_BYTES} before the next is asked for, with the stall rule above (a client that
 * does not take a piece within `stallMs` is cut off). The NDJSON streams and the render API's images go
 * out through it. An exception the producer lets escape (a bug) is logged and ends the response, after
 * `options.failure` when one is given; its text is never sent.
 */
export function sendPieces(
  reply: FastifyReply,
  life: StreamLife,
  produce: (signal: AbortSignal) => AsyncIterable<string | Uint8Array> | Iterable<string | Uint8Array>,
  options: PiecesOptions,
): FastifyReply {
  const stallMs = options.stallMs ?? STREAM_STALL_MS;

  async function* guarded(): AsyncGenerator<string | Uint8Array, void, undefined> {
    try {
      for await (const line of produce(life.signal)) {
        for (const piece of piecesOf(line)) {
          // Readable.from asks for more as soon as the piece is queued on the socket; the producer is asked
          // only once the socket has written it out (leaving the loop closes the producer, which gives back
          // its claims).
          yield piece;
          if (!(await written(reply.raw, life, stallMs))) return;
        }
      }
    } catch (error) {
      if (life.signal.aborted) return;
      options.log.error({ err: error }, 'stream failed');
      if (options.failure !== undefined) yield options.failure;
    } finally {
      life.end();
    }
  }

  for (const [name, value] of Object.entries(options.headers ?? {})) reply.header(name, value);
  return reply
    .code(200)
    .header('content-type', options.contentType)
    .send(Readable.from(guarded(), { objectMode: false }));
}

/**
 * Sends `produce`'s lines as the response body with status 200, each written out before the next is asked
 * for. The producer reports upstream failures as `error` frames itself; an exception it lets escape (a bug)
 * is logged and ends the stream with a generic `error` frame on a line of its own, never with its text.
 */
export function sendNdjson(
  reply: FastifyReply,
  life: StreamLife,
  produce: (signal: AbortSignal) => AsyncIterable<string | Uint8Array> | Iterable<string>,
  options: NdjsonOptions,
): FastifyReply {
  return sendPieces(reply, life, produce, {
    ...options,
    contentType: NDJSON_CONTENT_TYPE,
    // A line of its own: the stream may have stopped in the middle of an export line.
    failure: `\n${frameLine({ t: 'error', message: 'Internal error.' })}`,
  });
}
