// SPDX-License-Identifier: MIT
/**
 * The render job (AGENTS.md, Exports and the render API): a plain function of `post`, so the same code runs
 * in a render worker (worker.ts) and in process (in-process.ts, the tests). It reads the source with the
 * render library's readers (the app's own: the demo loader, the bundle reader, the import handler for NDJSON
 * and a pull's frames), checks the asset limit, and draws with `renderView`, the code `pnpm render` runs. One
 * job per handler; messages after its end are ignored.
 */
import {
  checkAssetCount,
  createSnapshotReader,
  initRasteriser,
  renderView,
  snapshotFromBundle,
  snapshotFromDemo,
  SnapshotInputError,
  ViewRefusedError,
  type RenderAssets,
  type SnapshotReader,
} from '@gcportrait/render';
import type { DemoSize, Snapshot, SnapshotRef } from '@gcportrait/model';

import type { JobInput, JobOutput, JobResult, JobSpec } from './protocol.js';

export interface JobEnvironment {
  /** The rasteriser's assets (the bundle's asset directory); default the installed packages. */
  readonly assets?: RenderAssets;
  /** For the snapshot id of read data (tests pass fixed ones). */
  readonly clock?: () => number;
  readonly entropy?: () => number;
}

/** Posts a message, with the buffers to move rather than copy (a worker's transfer list). */
export type JobPost = (message: JobOutput, transfer?: readonly ArrayBuffer[]) => void;

/** The bytes in an ArrayBuffer of their own, which can be moved to another thread. */
function ownBuffer(bytes: Uint8Array): Uint8Array {
  return bytes.byteOffset === 0 &&
    bytes.byteLength === bytes.buffer.byteLength &&
    bytes.buffer instanceof ArrayBuffer
    ? bytes
    : new Uint8Array(bytes);
}

function errorOf(error: unknown): JobOutput {
  if (error instanceof SnapshotInputError) {
    switch (error.code) {
      case 'UPSTREAM':
        return {
          type: 'error',
          code: 'UPSTREAM',
          message: error.message,
          ...(error.upstream === undefined ? {} : { upstream: error.upstream }),
        };
      case 'CANCELLED':
        return { type: 'error', code: 'INTERNAL', message: error.message };
      default:
        return { type: 'error', code: error.code, message: error.message };
    }
  }
  if (error instanceof ViewRefusedError)
    return { type: 'error', code: 'VIEW_REFUSED', message: error.message };
  return {
    type: 'error',
    code: 'INTERNAL',
    message: 'Internal error.',
    detail: error instanceof Error ? (error.stack ?? error.message) : String(error),
  };
}

export function createRenderJob(
  post: JobPost,
  environment: JobEnvironment = {},
): (message: JobInput) => void {
  let spec: JobSpec | undefined;
  let reader: SnapshotReader | undefined;
  const chunks: Uint8Array[] = [];
  let done = false;

  const finish = (output: JobOutput, transfer?: readonly ArrayBuffer[]): void => {
    if (done) return;
    done = true;
    post(output, transfer);
  };

  const draw = async (snapshot: Snapshot, job: JobSpec, snapshotRef: SnapshotRef): Promise<void> => {
    checkAssetCount(snapshot, job.maxAssets);
    post({ type: 'progress', assets: snapshot.assets.length });
    if (job.options.format === 'png') await initRasteriser(environment.assets);
    const rendered = renderView(snapshot, job.options, {
      snapshotRef,
      maxPixels: job.maxPixels,
      ...(job.version === undefined ? {} : { version: job.version }),
    });
    const bytes = ownBuffer(rendered.bytes);
    const result: JobResult = {
      bytes,
      contentType: rendered.contentType,
      fileName: rendered.fileName,
      viewHash: rendered.viewHash,
      detailUsed: rendered.detailUsed,
      ...(rendered.scale === undefined ? {} : { scale: rendered.scale }),
      assets: rendered.assets,
    };
    finish({ type: 'result', result }, [bytes.buffer as ArrayBuffer]);
  };

  const snapshotOf = async (job: JobSpec): Promise<{ snapshot: Snapshot; ref: SnapshotRef }> => {
    switch (job.source.kind) {
      case 'demo': {
        const size: DemoSize = job.source.size;
        return { snapshot: await snapshotFromDemo(size), ref: `demo:${size}` };
      }
      case 'bundle': {
        let text: string;
        try {
          text = new TextDecoder('utf-8', { fatal: true }).decode(concat(chunks));
        } catch {
          throw new SnapshotInputError('INVALID_FILE', 'The file is not UTF-8 text.');
        }
        chunks.length = 0;
        return { snapshot: snapshotFromBundle(text), ref: '' };
      }
      case 'ndjson':
      case 'pull':
        if (reader === undefined) throw new Error('no reader');
        return { snapshot: await reader.end(), ref: '' };
    }
  };

  return (message: JobInput): void => {
    if (done) return;
    try {
      switch (message.type) {
        case 'start': {
          if (spec !== undefined) return;
          spec = message.spec;
          const { source } = spec;
          if (source.kind === 'ndjson' || source.kind === 'pull') {
            reader = createSnapshotReader({
              kind: source.kind === 'pull' ? 'pull' : 'export',
              scope: source.scope,
              ...(source.kind === 'ndjson' && source.readTime !== undefined
                ? { readTime: source.readTime }
                : {}),
              detail:
                source.kind === 'ndjson'
                  ? 'render API upload'
                  : source.mode === 'sa'
                    ? 'live pull, service account'
                    : 'live pull',
              maxAssets: spec.maxAssets,
              ...(environment.clock === undefined ? {} : { clock: environment.clock }),
              ...(environment.entropy === undefined ? {} : { entropy: environment.entropy }),
            });
          }
          return;
        }
        case 'chunk': {
          if (spec === undefined) return;
          if (reader === undefined) chunks.push(message.data);
          else {
            const before = reader.assets;
            reader.push(message.data);
            // Reading stopped (too many assets, a bundle sent as NDJSON): the route learns it now, not at the end.
            if (reader.failure !== undefined) {
              finish(errorOf(reader.failure));
              return;
            }
            if (reader.assets !== before) post({ type: 'progress', assets: reader.assets });
          }
          post({ type: 'ack' });
          return;
        }
        case 'end': {
          const job = spec;
          if (job === undefined) return;
          snapshotOf(job)
            .then(({ snapshot, ref }) => draw(snapshot, job, ref))
            .catch((error: unknown) => {
              finish(errorOf(error));
            });
          return;
        }
      }
    } catch (error) {
      finish(errorOf(error));
    }
  };
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
