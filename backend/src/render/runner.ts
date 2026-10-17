// SPDX-License-Identifier: MIT
/**
 * How the render route runs a render job (backend/AGENTS.md, The render API). The default runner starts a
 * fresh `worker_threads` worker per render and terminates it when the render ends, times out or loses its
 * client: rasterising takes seconds of CPU that would otherwise stall `/healthz` and every stream, and the
 * WebAssembly rasteriser's memory (about 10 bytes per PNG pixel) is only given back when its thread ends. The
 * worker's heap is capped too; running out of it is `RENDER_TOO_LARGE`. The PNG comes back by transfer,
 * without a copy.
 *
 * In the bundle the worker is `dist/render-worker.mjs`, with the rasteriser's assets in `dist/render-assets/`
 * (bundle.ts names both through a build-time define); from source it is `worker.ts`, run by tsx's loader, which
 * workers inherit, with the assets from the installed packages. This module never loads the render library, so
 * neither does `dist/server.mjs`. The tests run the same job in process (in-process.ts).
 */
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

import type { JobErrorCode, JobInput, JobOutput, JobResult, JobSpec } from './protocol.js';

/** The render worker's old-generation heap, in MiB (a fixed limit). */
export const RENDER_WORKER_HEAP_MB = 1024;

/** Why a run failed: the job's own error, or the worker's (its heap exhausted, or it stopped). */
export class RenderJobError extends Error {
  readonly code: JobErrorCode | 'RENDER_TOO_LARGE';
  readonly upstream?: { readonly status?: number; readonly code?: string; readonly reason?: string };
  /** For the log: what went wrong inside the job (`INTERNAL`). */
  readonly detail?: string;

  constructor(
    code: RenderJobError['code'],
    message: string,
    upstream?: RenderJobError['upstream'],
    detail?: string,
  ) {
    super(message);
    this.name = 'RenderJobError';
    this.code = code;
    if (upstream !== undefined) this.upstream = upstream;
    if (detail !== undefined) this.detail = detail;
  }
}

/** One render job, seen from the route. */
export interface RenderRun {
  /** Hands the job the next chunk of data; resolves once it has read it, rejects with a {@link RenderJobError}. */
  push(chunk: Uint8Array): Promise<void>;
  /** Asks for the result once every chunk was pushed. */
  end(): Promise<JobResult>;
  /** Ends the job now (finished, timed out, the client gone, a refused pull); idempotent. */
  stop(): void;
  /** The asset count the job reported last. */
  readonly assets: number;
}

export type RenderRunner = (spec: JobSpec) => RenderRun;

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  // Nobody may be waiting yet when a job fails; the route awaits the promise later (or never, once stopped).
  promise.catch(() => undefined);
  return { promise, resolve, reject };
}

/**
 * The route's side of a job over a message channel: `send` delivers a message to the job, `close` ends it. Returns
 * the run, `receive` for the job's messages, and `fail` for a failure of the channel itself.
 */
export function createRun(
  send: (message: JobInput) => void,
  close: () => void,
): {
  readonly run: RenderRun;
  readonly receive: (output: JobOutput) => void;
  readonly fail: (error: RenderJobError) => void;
} {
  let ack: Deferred<undefined> | undefined;
  const result = deferred<JobResult>();
  let failure: RenderJobError | undefined;
  let closed = false;
  let assets = 0;

  const shut = (): void => {
    if (closed) return;
    closed = true;
    close();
  };
  const fail = (error: RenderJobError): void => {
    if (closed || failure !== undefined) return;
    failure = error;
    ack?.reject(error);
    result.reject(error);
    shut();
  };
  const receive = (output: JobOutput): void => {
    if (closed) return;
    switch (output.type) {
      case 'ack':
        ack?.resolve(undefined);
        return;
      case 'progress':
        assets = output.assets;
        return;
      case 'result':
        assets = output.result.assets;
        result.resolve(output.result);
        shut();
        return;
      case 'error':
        fail(new RenderJobError(output.code, output.message, output.upstream, output.detail));
        return;
    }
  };
  const run: RenderRun = {
    push(chunk) {
      if (failure !== undefined) return Promise.reject(failure);
      if (closed) return Promise.reject(new RenderJobError('INTERNAL', 'The render was stopped.'));
      ack = deferred<undefined>();
      send({ type: 'chunk', data: chunk });
      return ack.promise;
    },
    end() {
      if (!closed && failure === undefined) send({ type: 'end' });
      return result.promise;
    },
    stop: shut,
    get assets() {
      return assets;
    },
  };
  return { run, receive, fail };
}

/** Set by bundle.ts: the worker's file next to `server.mjs`. Undefined when running from source. */
declare const __GCPORTRAIT_RENDER_WORKER__: string | undefined;
/** Set by bundle.ts: the rasteriser's asset directory next to `server.mjs`. */
declare const __GCPORTRAIT_RENDER_ASSETS__: string | undefined;

export interface WorkerSource {
  readonly url: URL;
  /** The asset directory the bundle wrote, or null to take the installed packages (from source). */
  readonly assetDir: string | null;
}

/** Where the worker and its assets are: next to the bundle, or the sources under tsx. */
export function defaultWorkerSource(): WorkerSource {
  if (typeof __GCPORTRAIT_RENDER_WORKER__ === 'string' && typeof __GCPORTRAIT_RENDER_ASSETS__ === 'string')
    return {
      url: new URL(__GCPORTRAIT_RENDER_WORKER__, import.meta.url),
      assetDir: fileURLToPath(new URL(__GCPORTRAIT_RENDER_ASSETS__, import.meta.url)),
    };
  return { url: new URL('./worker.ts', import.meta.url), assetDir: null };
}

export interface WorkerRunnerOptions {
  readonly source?: WorkerSource;
  /** The worker's heap limit; default {@link RENDER_WORKER_HEAP_MB}. */
  readonly heapMb?: number;
}

/** The default runner: a fresh worker per render (see the module comment). */
export function workerRunner(options: WorkerRunnerOptions = {}): RenderRunner {
  const source = options.source ?? defaultWorkerSource();
  return (spec) => {
    const worker = new Worker(source.url, {
      workerData: { assetDir: source.assetDir },
      resourceLimits: { maxOldGenerationSizeMb: options.heapMb ?? RENDER_WORKER_HEAP_MB },
    });
    const channel = createRun(
      (message) => {
        worker.postMessage(message);
      },
      () => {
        void worker.terminate();
      },
    );
    worker.on('message', (output: JobOutput) => {
      channel.receive(output);
    });
    worker.on('error', (error: Error & { code?: string }) => {
      channel.fail(
        error.code === 'ERR_WORKER_OUT_OF_MEMORY'
          ? new RenderJobError(
              'RENDER_TOO_LARGE',
              'The render needed more memory than this instance gives one render. Narrow the data or the view.',
            )
          : new RenderJobError('INTERNAL', 'Internal error.', undefined, error.stack ?? error.message),
      );
    });
    worker.on('exit', (exitCode) => {
      channel.fail(
        new RenderJobError(
          'INTERNAL',
          'Internal error.',
          undefined,
          `render worker exited (${String(exitCode)})`,
        ),
      );
    });
    worker.postMessage({ type: 'start', spec } satisfies JobInput);
    return channel.run;
  };
}
