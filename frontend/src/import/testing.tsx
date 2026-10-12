// SPDX-License-Identifier: MIT
/**
 * The Connect page's import controls in a test harness: a memory router, the app store with a given `connect`
 * slice, a stand-in sign-in, a snapshot library, and the in-process import worker. Imported by tests only.
 */
import { render, type RenderResult } from '@testing-library/react';
import { useLayoutEffect, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router';

import type { AuthControls } from '../auth';
import { AuthContext } from '../auth/context';
import { testAuth } from '../auth/testing';
import type { SnapshotLibrary } from '../snapshots/library';
import { SnapshotLibraryProvider } from '../snapshots/SnapshotLibraryProvider';
import { AppStateProvider, useAppStore, type ConnectSlice } from '../state';
import { LocationProbe } from '../test/location';
import { ImportWorkerProvider } from './ImportWorkerProvider';
import { inProcessImportWorker } from './worker/inProcess';

function ConnectState({ connect }: { readonly connect: Partial<ConnectSlice> }): null {
  const store = useAppStore();
  useLayoutEffect(() => {
    store.updateConnect((current) => ({ ...current, ...connect }));
  }, [store, connect]);
  return null;
}

export function renderImport(
  children: ReactNode,
  options: {
    readonly connect: Partial<ConnectSlice>;
    readonly library: SnapshotLibrary;
    readonly auth?: AuthControls;
  },
): RenderResult {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <AppStateProvider>
        <ConnectState connect={options.connect} />
        <AuthContext value={options.auth ?? testAuth()}>
          <SnapshotLibraryProvider library={options.library}>
            <ImportWorkerProvider factory={inProcessImportWorker()}>
              <main>
                <h1>Connect</h1>
                {children}
              </main>
            </ImportWorkerProvider>
          </SnapshotLibraryProvider>
        </AuthContext>
      </AppStateProvider>
      <LocationProbe />
    </MemoryRouter>,
  );
}

/** One NDJSON line of the backend's asset stream. */
export function line(frame: unknown): string {
  return `${JSON.stringify(frame)}\n`;
}

/**
 * The backend's frames for `assets` in pages of `pageSize` (by default 500), as backend/src/stream/asset-list.ts
 * writes them, ending with `done` at `readTime`, nothing (`'none'`: a stream cut short) or an error frame.
 */
export function frames(
  assets: readonly unknown[],
  options: {
    readonly pageSize?: number;
    readonly readTime?: string;
    readonly end?: 'done' | 'none' | Record<string, unknown>;
  } = {},
): string {
  const pageSize = options.pageSize ?? 500;
  let text = line({ t: 'progress', pages: 0, assets: 0 });
  let pages = 0;
  for (let start = 0; start < assets.length; start += pageSize) {
    pages += 1;
    text += line({ t: 'page', assets: assets.slice(start, start + pageSize) });
    text += line({ t: 'progress', pages, assets: Math.min(assets.length, start + pageSize) });
  }
  const end = options.end ?? 'done';
  if (end === 'done')
    text += line({ t: 'done', assets: assets.length, readTime: options.readTime ?? '2026-10-10T11:59:58Z' });
  else if (end !== 'none') text += line({ t: 'error', ...end });
  return text;
}

/** A response body that arrives in `chunk`-byte pieces; `hang` keeps it open after the last one, `fail` breaks it. */
export function streamBody(
  text: string,
  options: { readonly chunk?: number; readonly hang?: boolean; readonly fail?: boolean } = {},
): { readonly stream: ReadableStream<Uint8Array>; readonly cancelled: () => boolean } {
  const bytes = new TextEncoder().encode(text);
  const chunk = options.chunk ?? 64 * 1024;
  let offset = 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        if (options.fail === true) controller.error(new TypeError('network error'));
        else if (options.hang !== true) controller.close();
        return options.hang === true ? new Promise<void>(() => undefined) : undefined;
      }
      controller.enqueue(bytes.slice(offset, offset + chunk));
      offset += chunk;
      return undefined;
    },
    cancel() {
      cancelled = true;
    },
  });
  return { stream, cancelled: () => cancelled };
}

/** A response body the test feeds piece by piece. */
export function controlledBody(): {
  readonly stream: ReadableStream<Uint8Array>;
  send(text: string): void;
  end(): void;
} {
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(started) {
      controller = started;
    },
  });
  const encoder = new TextEncoder();
  return {
    stream,
    send: (text) => controller?.enqueue(encoder.encode(text)),
    end: () => controller?.close(),
  };
}
