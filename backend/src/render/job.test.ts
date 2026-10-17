// SPDX-License-Identifier: MIT
/**
 * The render job (job.ts) on its own messages: every chunk acknowledged once read, progress, exactly one
 * result or error, the asset limit as soon as it is passed, the app's messages for files it cannot read, and
 * the run's channel (runner.ts) failing a push once the job failed. Synthetic data only (AGENTS.md, Security
 * and privacy, principle 6).
 */
import { RenderOptionsSchema, type RenderOptionsInput } from '@gcportrait/model';
import { describe, expect, it } from 'vitest';

import { syntheticAsset } from '../stream/google.testing.js';
import { inProcessRunner } from './in-process.js';
import { createRenderJob } from './job.js';
import type { JobOutput, JobSource, JobSpec } from './protocol.js';
import { RenderJobError } from './runner.js';

const spec = (
  source: JobSource,
  options: RenderOptionsInput = { format: 'svg' },
  maxAssets = 60_000,
): JobSpec => ({
  source,
  options: RenderOptionsSchema.parse(options),
  maxAssets,
  maxPixels: 2 ** 26,
});

const encoder = new TextEncoder();
const ndjson = (count: number): Uint8Array =>
  encoder.encode(
    Array.from({ length: count }, (_, index) => `${JSON.stringify(syntheticAsset(index))}\n`).join(''),
  );

/** Runs the job on `chunks` and collects what it posts until its result or error. */
async function drive(job: JobSpec, chunks: readonly Uint8Array[]): Promise<JobOutput[]> {
  const posted: JobOutput[] = [];
  let finished: () => void = () => undefined;
  const done = new Promise<void>((resolve) => {
    finished = resolve;
  });
  const handle = createRenderJob(
    (message) => {
      posted.push(message);
      if (message.type === 'result' || message.type === 'error') finished();
    },
    { clock: () => Date.parse('2026-10-08T00:00:00Z'), entropy: () => 0.5 },
  );
  handle({ type: 'start', spec: job });
  for (const chunk of chunks) handle({ type: 'chunk', data: chunk });
  handle({ type: 'end' });
  await done;
  // Messages after the end are ignored.
  handle({ type: 'end' });
  return posted;
}

describe('the render job', () => {
  it('reports impossible PNG geometry as a refused view rather than an internal failure', async () => {
    const posted = await drive({ ...spec({ kind: 'demo', size: 'S' }, {}), maxPixels: 1 }, []);
    expect(posted.at(-1)).toMatchObject({
      type: 'error',
      code: 'VIEW_REFUSED',
      message:
        'This diagram cannot fit within the PNG size limits. Export SVG or draw.io, or narrow the view.',
    });
  });

  it('acknowledges every chunk, reports progress and answers once with the drawing', async () => {
    const bytes = ndjson(40);
    const half = Math.floor(bytes.byteLength / 2);
    const posted = await drive(spec({ kind: 'ndjson', scope: null }), [
      bytes.subarray(0, half),
      bytes.subarray(half),
    ]);
    expect(posted.filter((message) => message.type === 'ack')).toHaveLength(2);
    const result = posted.at(-1);
    expect(result?.type).toBe('result');
    if (result?.type !== 'result') return;
    expect(result.result).toMatchObject({
      contentType: 'image/svg+xml; charset=utf-8',
      assets: 40,
      viewHash: '',
    });
    expect(new TextDecoder().decode(result.result.bytes)).toMatch(
      /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<svg /,
    );
    expect(posted.filter((message) => message.type === 'result' || message.type === 'error')).toHaveLength(1);
  });

  it('stops at once when the data passes the asset limit, before acknowledging a chunk', async () => {
    const many = await drive(spec({ kind: 'ndjson', scope: null }, { format: 'svg' }, 10), [ndjson(400)]);
    expect(many.at(-1)).toMatchObject({ type: 'error', code: 'TOO_MANY_ASSETS' });
    expect(many.some((message) => message.type === 'ack')).toBe(false);
  });

  it.each([
    [
      'a file that is not UTF-8',
      spec({ kind: 'bundle' }),
      [new Uint8Array([0xff, 0xfe, 0x00])],
      { code: 'INVALID_FILE', message: 'The file is not UTF-8 text.' },
    ],
    [
      'a bundle that is not JSON',
      spec({ kind: 'bundle' }),
      [encoder.encode('{"format":"gcportrait.snapshot",')],
      { code: 'INVALID_FILE', message: 'The file is not valid JSON.' },
    ],
    [
      'a view the snapshot cannot show',
      spec({ kind: 'demo', size: 'S' }, { format: 'svg', view: { root: 'nowhere' } }),
      [],
      { code: 'VIEW_REFUSED' },
    ],
    [
      'a pull that ends without its done frame',
      spec({ kind: 'pull', scope: { kind: 'folder', id: '20000000001' }, mode: 'user' }),
      [encoder.encode('{"t":"progress","pages":0,"assets":0}\n')],
      { code: 'CUT_SHORT' },
    ],
  ] as const)('refuses %s', async (_name, job, chunks, error) => {
    const posted = await drive(job, chunks);
    expect(posted.at(-1)).toMatchObject({ type: 'error', ...error });
  });

  it('fails the run’s next push once the job failed', async () => {
    // Read progress is reported every 256 KiB: 400 synthetic assets are past it.
    const run = inProcessRunner()(spec({ kind: 'ndjson', scope: null }, { format: 'svg' }, 5));
    await expect(run.push(ndjson(400))).rejects.toBeInstanceOf(RenderJobError);
    await expect(run.push(ndjson(1))).rejects.toMatchObject({ code: 'TOO_MANY_ASSETS' });
    await expect(run.end()).rejects.toMatchObject({ code: 'TOO_MANY_ASSETS' });
  });
});
