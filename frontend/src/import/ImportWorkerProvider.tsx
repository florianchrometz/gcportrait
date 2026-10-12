// SPDX-License-Identifier: MIT
/**
 * The import worker for the page's live pulls and export reads (worker/): started on first use, one per page, as
 * the fourth role of the app's worker script (WORKER_ROLES.imports). Its code, and the worker itself, load only
 * when someone first pulls or reads an export. Tests wrap the page in an `ImportWorkerProvider` with the
 * in-process worker (worker/inProcess.ts), since jsdom has no Web Workers.
 */
import { createContext, useContext, useEffect, useState, type ReactElement, type ReactNode } from 'react';

import type { ImportClient, ImportWorker, ImportWorkerFactory } from './worker/client';

type ClientSource = () => Promise<ImportClient>;

let pageWorker: Promise<ImportWorker> | null = null;

/** The page's import worker, a real Web Worker, started on first use. */
const browserClient: ClientSource = async () => {
  pageWorker ??= import('./worker/browser').then(({ createBrowserImportWorker }) =>
    createBrowserImportWorker(),
  );
  return (await pageWorker).client;
};

const ImportWorkerContext = createContext<ClientSource>(browserClient);

export function ImportWorkerProvider({
  factory,
  children,
}: {
  readonly factory: ImportWorkerFactory;
  readonly children: ReactNode;
}): ReactElement {
  const [source] = useState(() => {
    let worker: ImportWorker | null = null;
    return {
      client: (): Promise<ImportClient> => {
        worker ??= factory();
        return Promise.resolve(worker.client);
      },
      dispose: (): void => {
        worker?.dispose();
        worker = null;
      },
    };
  });
  useEffect(() => source.dispose, [source]);
  return <ImportWorkerContext value={source.client}>{children}</ImportWorkerContext>;
}

/** The import worker's client, started when first asked for. */
export function useImportClient(): ClientSource {
  return useContext(ImportWorkerContext);
}
