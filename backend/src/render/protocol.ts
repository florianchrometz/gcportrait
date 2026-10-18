// SPDX-License-Identifier: Apache-2.0
/**
 * The render job's messages, between the route on the main thread and the job in a render worker (worker.ts)
 * or in process (in-process.ts, the tests): `start` names the source and the options, `chunk` hands over the
 * data a piece at a time (a pull's frames, an upload's bytes), each answered with `ack` once the job has read
 * it, and `end` asks for the result. The job answers with `progress` (assets read so far), then exactly one
 * `result` or `error`. Types only: the main thread never loads the render library.
 */
import type { DemoSize, RenderOptions, ScopeKind } from '@gcportrait/model';

/** Where a job's snapshot comes from. */
export type JobSource =
  | { readonly kind: 'demo'; readonly size: DemoSize }
  | { readonly kind: 'bundle' }
  | {
      readonly kind: 'ndjson';
      readonly scope: { readonly kind: ScopeKind; readonly id: string } | null;
      readonly readTime?: string;
    }
  | {
      readonly kind: 'pull';
      readonly scope: { readonly kind: ScopeKind; readonly id: string };
      readonly mode: 'user' | 'sa';
    };

export interface JobSpec {
  readonly source: JobSource;
  readonly options: RenderOptions;
  /** RENDER_MAX_ASSETS. */
  readonly maxAssets: number;
  /** RENDER_MAX_PIXELS (a PNG's). */
  readonly maxPixels: number;
  /** The instance's version, for a draw.io file's `agent`. */
  readonly version?: string;
}

export type JobInput =
  | { readonly type: 'start'; readonly spec: JobSpec }
  | { readonly type: 'chunk'; readonly data: Uint8Array }
  | { readonly type: 'end' };

/** Why a job failed; the route turns each into its HTTP answer (errors.ts). */
export type JobErrorCode =
  | 'INVALID_FILE'
  | 'EMPTY_SNAPSHOT'
  | 'TOO_MANY_ASSETS'
  | 'VIEW_REFUSED'
  | 'UPSTREAM'
  | 'CUT_SHORT'
  | 'INTERNAL';

export interface JobResult {
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly fileName: string;
  readonly viewHash: string;
  readonly detailUsed: string;
  readonly scale?: number;
  readonly assets: number;
}

export type JobOutput =
  | { readonly type: 'ack' }
  | { readonly type: 'progress'; readonly assets: number }
  | { readonly type: 'result'; readonly result: JobResult }
  | {
      readonly type: 'error';
      readonly code: JobErrorCode;
      /** For the person who asked (the app's own message for a file it cannot read); never a stack. */
      readonly message: string;
      /** For `UPSTREAM`: an `error` frame's status, code and reason. */
      readonly upstream?: { readonly status?: number; readonly code?: string; readonly reason?: string };
      /** For `INTERNAL`: the error's stack, for the server's log only (the job never holds a token). */
      readonly detail?: string;
    };
