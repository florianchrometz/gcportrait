// SPDX-License-Identifier: MIT
/**
 * The abort signal of a file import on a card (the Connect page's export card, import/LoadExport.tsx, and the
 * Snapshots page's import, ImportPanel.tsx): a fresh one for each import, aborted by the card's Cancel and when the
 * card leaves the page, so an import the person cancelled or left stores nothing (`library.importFiles`).
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';

export interface ImportSignal {
  /** The signal of a new import, which `cancel` and leaving the page abort. */
  readonly begin: () => AbortSignal;
  /** Aborts the running import, if there is one. */
  readonly cancel: () => void;
}

export function useImportSignal(): ImportSignal {
  const current = useRef<AbortController | null>(null);

  const cancel = useCallback((): void => {
    current.current?.abort();
    current.current = null;
  }, []);

  // Leaving the page cancels the import that runs.
  useEffect(() => cancel, [cancel]);

  const begin = useCallback((): AbortSignal => {
    current.current?.abort();
    const controller = new AbortController();
    current.current = controller;
    return controller.signal;
  }, []);

  return useMemo(() => ({ begin, cancel }), [begin, cancel]);
}
