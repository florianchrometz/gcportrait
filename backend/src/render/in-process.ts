// SPDX-License-Identifier: Apache-2.0
/**
 * The render job in process: the same job as the worker's (job.ts), with its messages delivered on the next
 * microtask as a worker would deliver them. For the tests, which compare its bytes with the library's and the
 * command line's; never the server's default (runner.ts), as it would draw on the main thread. Not part of
 * `dist/server.mjs`.
 */
import { createRenderJob, type JobEnvironment } from './job.js';
import type { JobInput } from './protocol.js';
import { createRun, type RenderRunner } from './runner.js';

export function inProcessRunner(environment: JobEnvironment = {}): RenderRunner {
  return (spec) => {
    let handle: ((message: JobInput) => void) | undefined;
    const channel = createRun(
      (message) => {
        queueMicrotask(() => handle?.(message));
      },
      () => {
        handle = undefined;
      },
    );
    handle = createRenderJob((output) => {
      queueMicrotask(() => {
        channel.receive(output);
      });
    }, environment);
    handle({ type: 'start', spec });
    return channel.run;
  };
}
