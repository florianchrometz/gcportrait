// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
import { generateOrganization, toCaiAsset, toCaiNdjson } from '@gcportrait/demo-data';
import { LARGE_SNAPSHOT_ASSETS, migrateSnapshot, type Snapshot } from '@gcportrait/model';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AuthControls } from '../auth';
import { TEST_TOKEN as TOKEN, testAuth as auth } from '../auth/testing';
import { decodeJson } from '../snapshots/codec';
import { fakeLibrary, type FakeLibrary } from '../snapshots/testing';
import { stubBackend } from '../test/backend';
import { describeFailure } from './errors';
import { IDLE_PROGRESS, importProgressReducer, stageText, type ImportAction } from './progress';
import { runExportRead, runLivePull, streamRequestOf, type ImportDependencies, type PullTarget } from './run';
import { frames, line, streamBody as body } from './testing';
import { inProcessImportWorker } from './worker/inProcess';

const READ_TIME = '2026-10-10T11:59:58.123456Z';
const M = generateOrganization({ size: 'M' }).assets.map(toCaiAsset);
/** Demo M's assets as the backend streams them, read at READ_TIME. */
const M_FRAMES = frames(M, { readTime: READ_TIME });
const TARGET: PullTarget = {
  scope: { kind: 'organization', id: '30000000001', displayName: 'example.com' },
  mode: 'user',
  quotaProject: 'demo-quota-1',
};

/** A backend whose every answer is `answer()`. */
function backend(answer: () => Response): ReturnType<typeof stubBackend> {
  return stubBackend({ otherwise: answer });
}

function dependencies(
  controls: AuthControls = auth(),
  library: FakeLibrary = fakeLibrary(),
): ImportDependencies {
  const worker = inProcessImportWorker()();
  return { auth: controls, library, worker: () => Promise.resolve(worker.client) };
}

/** Runs the reducer over the dispatched actions, keeping them. */
function recorder(): { readonly dispatch: (action: ImportAction) => void; readonly actions: ImportAction[] } {
  const actions: ImportAction[] = [];
  return { actions, dispatch: (action) => actions.push(action) };
}

async function stored(library: FakeLibrary, ref: string): Promise<Snapshot> {
  const listed = library.records.get(ref);
  if (listed === undefined) throw new Error(`nothing stored under ${ref}`);
  return migrateSnapshot(await decodeJson(listed.record.blob));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a live pull', () => {
  it('asks the backend for the stream and stores the snapshot it reads, as Google reported it', async () => {
    const { calls } = backend(
      () => new Response(body(M_FRAMES).stream, { headers: { 'content-type': 'application/x-ndjson' } }),
    );
    const library = fakeLibrary();
    const { dispatch, actions } = recorder();
    const imported = await runLivePull(
      dependencies(auth(), library),
      TARGET,
      dispatch,
      new AbortController().signal,
    );
    if (imported === null) throw new Error(JSON.stringify(actions.at(-1)));

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.url).toBe('/api/assets/stream');
    expect(call?.init?.method).toBe('POST');
    expect(call?.headers.get('x-gcportrait-token')).toBe(TOKEN); // gcportrait's own header
    expect(call?.body).toEqual({
      scope: 'organizations/30000000001',
      contentType: 'RESOURCE',
      mode: 'user',
      quotaProject: 'demo-quota-1',
    });

    const snapshot = await stored(library, imported.ref);
    expect(snapshot.id).toBe(imported.ref);
    expect(snapshot.assets).toHaveLength(M.length);
    expect(snapshot.scope).toEqual(TARGET.scope);
    expect(snapshot.source).toEqual({ kind: 'api', detail: 'live pull' });
    expect(snapshot.readTime).toBe(READ_TIME);
    expect(snapshot.readTimeSource).toBe('api');
    expect(imported.warnings).toEqual([]);
    expect(library.calls).toEqual(['storePrepared api']);

    const final = actions.reduce(importProgressReducer, IDLE_PROGRESS);
    expect(final).toMatchObject({ phase: 'done', pages: 2, assets: M.length, result: { ref: imported.ref } });
    expect(final.bytes).toBe(new TextEncoder().encode(M_FRAMES).byteLength);
    expect(actions.map((action) => action.type)).toEqual(
      expect.arrayContaining(['start', 'connected', 'received', 'counted', 'storing', 'done']),
    );
  });

  it('sends no quota project in service-account mode, and a read time when asked', () => {
    expect(streamRequestOf({ ...TARGET, mode: 'sa', readTime: '2026-10-01T00:00:00Z' })).toEqual({
      scope: 'organizations/30000000001',
      contentType: 'RESOURCE',
      mode: 'sa',
      readTime: '2026-10-01T00:00:00Z',
    });
  });

  it('streams a 5 000-asset organisation into a stored snapshot in under 10 s', async () => {
    const assets = generateOrganization({ size: 'L' }).assets.slice(0, 5000).map(toCaiAsset);
    const text = frames(assets);
    backend(() => new Response(body(text, { chunk: 16 * 1024 }).stream));
    const library = fakeLibrary();
    const { dispatch, actions } = recorder();
    const started = performance.now();
    const imported = await runLivePull(
      dependencies(auth(), library),
      TARGET,
      dispatch,
      new AbortController().signal,
    );
    const elapsed = performance.now() - started;
    if (imported === null) throw new Error(JSON.stringify(actions.at(-1)));
    const snapshot = await stored(library, imported.ref);
    console.info(
      `Pull now, 5 000-asset mocked organisation: ${String(snapshot.assets.length)} assets, ` +
        `${(text.length / 1_000_000).toFixed(1)} MB through the import worker into a stored snapshot in ` +
        `${elapsed.toFixed(0)} ms (budget 10 000 ms)`,
    );
    expect(snapshot.assets).toHaveLength(5000);
    expect(actions.reduce(importProgressReducer, IDLE_PROGRESS)).toMatchObject({ phase: 'done', pages: 10 });
    expect(elapsed).toBeLessThan(10_000);
  }, 30_000); // Above the budget, so a slow run fails on the budget line and prints its time, not on the timeout.

  it('says what Google refused, reason included, and stores nothing', async () => {
    const message = 'Cloud Asset API has not been used in project demo-quota-1 before or it is disabled.';
    backend(
      () =>
        new Response(
          body(
            frames(M.slice(0, 600), {
              end: { message, status: 403, code: 'PERMISSION_DENIED', reason: 'SERVICE_DISABLED' },
            }),
          ).stream,
        ),
    );
    const library = fakeLibrary();
    const { dispatch, actions } = recorder();
    const imported = await runLivePull(
      dependencies(auth(), library),
      TARGET,
      dispatch,
      new AbortController().signal,
    );
    expect(imported).toBeNull();
    expect(library.calls).toEqual([]);
    const final = actions.reduce(importProgressReducer, IDLE_PROGRESS);
    expect(final.failure).toEqual(
      describeFailure(
        { kind: 'upstream', message, status: 403, code: 'PERMISSION_DENIED', reason: 'SERVICE_DISABLED' },
        { kind: 'pull', scope: 'example.com', quotaProject: 'demo-quota-1' },
      ),
    );
    expect(final.failure?.title).toBe('The Cloud Asset API is not enabled in demo-quota-1.');
  });

  it('tells the session when Google no longer accepts the token', async () => {
    backend(
      () =>
        new Response(
          body(frames([], { end: { message: 'Invalid credentials.', status: 401, code: 'UNAUTHENTICATED' } }))
            .stream,
        ),
    );
    const controls = auth();
    const { dispatch, actions } = recorder();
    await runLivePull(dependencies(controls), TARGET, dispatch, new AbortController().signal);
    expect(controls.rejectedTokens).toEqual([TOKEN]);
    expect(actions.reduce(importProgressReducer, IDLE_PROGRESS).failure?.title).toBe(
      'Google no longer accepts your sign-in.',
    );
  });

  it('refuses a stream cut short, without its done frame', async () => {
    backend(() => new Response(body(frames(M, { end: 'none' })).stream));
    const library = fakeLibrary();
    const { dispatch, actions } = recorder();
    expect(
      await runLivePull(dependencies(auth(), library), TARGET, dispatch, new AbortController().signal),
    ).toBeNull();
    expect(library.calls).toEqual([]);
    expect(actions.reduce(importProgressReducer, IDLE_PROGRESS).failure?.title).toBe(
      'The stream ended early, so nothing was stored.',
    );
  });

  it('says so when the connection breaks', async () => {
    backend(() => new Response(body(frames(M.slice(0, 10), { end: 'none' }), { fail: true }).stream));
    const { dispatch, actions } = recorder();
    await runLivePull(dependencies(), TARGET, dispatch, new AbortController().signal);
    expect(actions.reduce(importProgressReducer, IDLE_PROGRESS).failure?.title).toBe(
      'The connection to the backend broke.',
    );
  });

  it('passes the backend’s own refusal on (the stream cap)', async () => {
    backend(() =>
      Response.json(
        {
          statusCode: 429,
          error: 'Too Many Requests',
          message: 'Four asset streams are already running for this sign-in.',
          requestId: 'r1',
        },
        { status: 429 },
      ),
    );
    const { dispatch, actions } = recorder();
    await runLivePull(dependencies(), TARGET, dispatch, new AbortController().signal);
    expect(actions.reduce(importProgressReducer, IDLE_PROGRESS).failure).toMatchObject({
      title: 'Too many reads at once.',
      message: 'Four asset streams are already running for this sign-in.',
      retryable: true,
    });
  });

  it('asks nothing without a token', async () => {
    const { calls } = backend(() => new Response(''));
    const { dispatch, actions } = recorder();
    await runLivePull(dependencies(auth(null)), TARGET, dispatch, new AbortController().signal);
    expect(calls).toHaveLength(0);
    expect(actions.reduce(importProgressReducer, IDLE_PROGRESS).failure?.title).toBe(
      'You are not signed in.',
    );
  });

  it('cancels: the read stops, the worker drops the job, nothing is stored', async () => {
    const stream = body(frames(M.slice(0, 600), { end: 'none' }), { hang: true });
    backend(() => new Response(stream.stream));
    const library = fakeLibrary();
    const controller = new AbortController();
    const { actions } = recorder();
    const pending = runLivePull(
      dependencies(auth(), library),
      TARGET,
      (action) => {
        actions.push(action);
        if (action.type === 'counted' && (action.assets ?? 0) >= 500) controller.abort();
      },
      controller.signal,
    );
    expect(await pending).toBeNull();
    expect(actions.at(-1)?.type).toBe('cancelled');
    expect(stream.cancelled()).toBe(true);
    expect(library.calls).toEqual([]);
  });
});

describe('a read that passes LARGE_SNAPSHOT_ASSETS', () => {
  /** Demo M's frames with the backend's count saying 10 500 after the first page. */
  const LARGE_FRAMES = M_FRAMES.replace(
    line({ t: 'progress', pages: 1, assets: 500 }),
    line({ t: 'progress', pages: 21, assets: LARGE_SNAPSHOT_ASSETS + 500 }),
  );

  it('asks once, with the count read so far and what is read; yes stores it', async () => {
    expect(LARGE_FRAMES).not.toBe(M_FRAMES);
    backend(() => new Response(body(LARGE_FRAMES, { chunk: 4096 }).stream));
    const library = fakeLibrary();
    const asked: (readonly [number, string])[] = [];
    const confirmLarge: ImportDependencies['confirmLarge'] = (assets, kind) => {
      asked.push([assets, kind]);
      return Promise.resolve(true);
    };
    const { dispatch, actions } = recorder();
    const imported = await runLivePull(
      { ...dependencies(auth(), library), confirmLarge },
      TARGET,
      dispatch,
      new AbortController().signal,
    );
    if (imported === null) throw new Error(JSON.stringify(actions.at(-1)));
    expect(asked).toEqual([[LARGE_SNAPSHOT_ASSETS + 500, 'pull']]);
    expect(library.calls).toEqual(['storePrepared api']);
  });

  it('no stops the read: cancelled, nothing stored', async () => {
    const stream = body(LARGE_FRAMES, { chunk: 4096, hang: true });
    backend(() => new Response(stream.stream));
    const library = fakeLibrary();
    const { dispatch, actions } = recorder();
    const imported = await runLivePull(
      { ...dependencies(auth(), library), confirmLarge: () => Promise.resolve(false) },
      TARGET,
      dispatch,
      new AbortController().signal,
    );
    expect(imported).toBeNull();
    expect(actions.at(-1)?.type).toBe('cancelled');
    expect(library.calls).toEqual([]);
  });

  it('a small read never asks; a failed one takes its open question back', async () => {
    backend(() => new Response(body(M_FRAMES).stream));
    const confirmLarge = vi.fn<NonNullable<ImportDependencies['confirmLarge']>>(() => Promise.resolve(true));
    const { dispatch } = recorder();
    expect(
      await runLivePull({ ...dependencies(), confirmLarge }, TARGET, dispatch, new AbortController().signal),
    ).not.toBeNull();
    expect(confirmLarge).not.toHaveBeenCalled();

    const cut = LARGE_FRAMES.slice(0, LARGE_FRAMES.indexOf('"t":"done"') - 1);
    backend(() => new Response(body(cut).stream));
    let withdrawn = false;
    const open: ImportDependencies['confirmLarge'] = (_assets, _kind, signal) =>
      new Promise<boolean>((resolve) => {
        signal.addEventListener('abort', () => {
          withdrawn = true;
          resolve(false);
        });
      });
    const failed = await runLivePull(
      { ...dependencies(), confirmLarge: open },
      TARGET,
      dispatch,
      new AbortController().signal,
    );
    expect(failed).toBeNull();
    expect(withdrawn).toBe(true);
  });
});

describe('an export read from Cloud Storage', () => {
  const S = generateOrganization({ size: 'S' }).assets;
  const LINES = toCaiNdjson(S, 'export');

  it('reads the lines, infers the scope and marks the read time as estimated', async () => {
    const size = new TextEncoder().encode(LINES).byteLength;
    const { calls } = backend(
      () =>
        new Response(body(LINES, { chunk: 4096 }).stream, {
          headers: { 'x-gcportrait-export-bytes': String(size) },
        }),
    );
    const library = fakeLibrary();
    const { dispatch, actions } = recorder();
    const imported = await runExportRead(
      dependencies(auth(), library),
      'gs://demo-exports/export.json',
      null,
      dispatch,
      new AbortController().signal,
    );
    if (imported === null) throw new Error(JSON.stringify(actions.at(-1)));
    expect(calls[0]?.url).toBe('/api/export/read');
    expect(calls[0]?.body).toEqual({ gcsUri: 'gs://demo-exports/export.json' });
    const snapshot = await stored(library, imported.ref);
    expect(snapshot.assets).toHaveLength(S.length);
    expect(snapshot.scope).toEqual({ kind: 'organization', id: '30000000001', displayName: 'example.com' });
    expect(snapshot.source).toEqual({ kind: 'export', detail: 'gs://demo-exports/export.json' });
    expect(snapshot.readTimeSource).toBe('estimated-max-update-time');
    expect(imported.warnings.at(-1)).toMatch(/^The export does not say when it was taken/);
    const final = actions.reduce(importProgressReducer, IDLE_PROGRESS);
    expect(final).toMatchObject({ phase: 'done', totalBytes: size, bytes: size, kind: 'export' });
  });

  it('takes the read time and the scope from the operation.json given with it', async () => {
    backend(() => new Response(body(LINES).stream));
    const library = fakeLibrary();
    const { dispatch } = recorder();
    const imported = await runExportRead(
      dependencies(auth(), library),
      'gs://demo-exports/export.json',
      { readTime: '2026-10-08T06:00:01Z', scope: { kind: 'organization', id: '30000000001' } },
      dispatch,
      new AbortController().signal,
    );
    if (imported === null) throw new Error('failed');
    const snapshot = await stored(library, imported.ref);
    expect(snapshot.readTime).toBe('2026-10-08T06:00:01Z');
    expect(snapshot.readTimeSource).toBe('export-sidecar');
    // The sidecar names the scope by id; the export's own Organization asset gives its name.
    expect(snapshot.scope).toEqual({ kind: 'organization', id: '30000000001', displayName: 'example.com' });
    expect(imported.warnings).toEqual([]);
  });

  it('takes the read time typed for it, unless its operation.json names one, and says which', async () => {
    backend(() => new Response(body(LINES).stream));
    const library = fakeLibrary();
    const { dispatch } = recorder();
    const typed = await runExportRead(
      dependencies(auth(), library),
      'gs://demo-exports/export.json',
      null,
      dispatch,
      new AbortController().signal,
      '2026-10-05T14:30:00Z',
    );
    if (typed === null) throw new Error('failed');
    const snapshot = await stored(library, typed.ref);
    expect(snapshot.readTime).toBe('2026-10-05T14:30:00Z');
    expect(snapshot.readTimeSource).toBe('user');
    expect(typed.warnings).toEqual([]);

    backend(() => new Response(body(LINES).stream));
    const both = await runExportRead(
      dependencies(auth(), library),
      'gs://demo-exports/export.json',
      { readTime: '2026-10-08T06:00:01Z' },
      dispatch,
      new AbortController().signal,
      '2026-10-05T14:30:00Z',
    );
    if (both === null) throw new Error('failed');
    expect((await stored(library, both.ref)).readTimeSource).toBe('export-sidecar');
    expect(both.warnings).toEqual([
      "The export's operation.json names its read time, 2026-10-08 06:00 UTC, so the time typed, " +
        '2026-10-05 14:30 UTC, was not used.',
    ]);
  });

  it('refuses an export without assets', async () => {
    backend(() => new Response(body('not an asset\n').stream));
    const { dispatch, actions } = recorder();
    await runExportRead(dependencies(), 'gs://demo-exports/x', null, dispatch, new AbortController().signal);
    expect(actions.reduce(importProgressReducer, IDLE_PROGRESS).failure?.title).toBe(
      'No assets were found in the export.',
    );
  });
});

describe('a pull or a read cancelled while its snapshot is stored', () => {
  const S_LINES = toCaiNdjson(generateOrganization({ size: 'S' }).assets, 'export');

  /** A pull of demo M, or a Cloud Storage read of demo S's export, from a backend that streams it in full. */
  function read(
    kind: 'pull' | 'export',
    dependencies: ImportDependencies,
    dispatch: (action: ImportAction) => void,
    signal: AbortSignal,
  ): ReturnType<typeof runLivePull> {
    if (kind === 'pull') {
      backend(() => new Response(body(M_FRAMES).stream));
      return runLivePull(dependencies, TARGET, dispatch, signal);
    }
    backend(() => new Response(body(S_LINES).stream));
    return runExportRead(dependencies, 'gs://demo-exports/export.json', null, dispatch, signal);
  }

  /**
   * The fake library, with the run's Cancel pressed as the store step begins (`before` the library is called) or
   * while its write is in flight (`during`).
   */
  function cancelling(
    library: FakeLibrary,
    controller: AbortController,
    when: 'before' | 'during',
  ): ImportDependencies['library'] {
    return {
      storePrepared(prepared, options) {
        if (when === 'before') controller.abort();
        const storing = library.storePrepared(prepared, options);
        controller.abort();
        return storing;
      },
    };
  }

  it.each([
    { read: 'a pull', kind: 'pull', when: 'before' },
    { read: 'a pull', kind: 'pull', when: 'during' },
    { read: 'a Cloud Storage read', kind: 'export', when: 'before' },
    { read: 'a Cloud Storage read', kind: 'export', when: 'during' },
  ] as const)('$read cancelled $when its write stores nothing and says so', async ({ kind, when }) => {
    const library = fakeLibrary();
    const changes = vi.fn();
    library.subscribe(changes);
    const controller = new AbortController();
    const { dispatch, actions } = recorder();
    const imported = await read(
      kind,
      { ...dependencies(auth(), library), library: cancelling(library, controller, when) },
      dispatch,
      controller.signal,
    );
    expect(imported).toBeNull();
    expect(library.calls).toEqual([`storePrepared ${kind === 'pull' ? 'api' : 'export'}`]);
    expect(library.records.size).toBe(0);
    expect(changes).not.toHaveBeenCalled();
    const types = actions.map((action) => action.type);
    expect(types.at(-1)).toBe('cancelled');
    expect(types).not.toContain('done');
    const final = actions.reduce(importProgressReducer, IDLE_PROGRESS);
    expect(final).toMatchObject({ phase: 'cancelled', result: null, failure: null });
    expect(stageText(final)).toBe('Cancelled. Nothing was stored.');
  });
});
