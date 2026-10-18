// SPDX-License-Identifier: Apache-2.0
/**
 * What the diagram page and the top bar share outside the app store (src/state): the workers (created on first
 * use, once per app), the catalog's lens list for the lens picker, and the drawn diagram for the Export menu.
 * The scope on screen is the store's (`selectScope`).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';

import type { ExportSource } from '../export/source';
import type { LensInfo } from './pipeline/protocol';
import type { DiagramWorkers, DiagramWorkersFactory } from './pipeline/workers';

export interface DiagramSession {
  /** The workers, created on first call; null when the app was started without any (some tests). */
  readonly workers: () => DiagramWorkers | null;
  /** The catalog's lenses with their titles, once the data worker has sent them. */
  readonly lenses: readonly LensInfo[] | null;
  /** Asks the data worker for the lens list (once). */
  readonly requestLenses: () => void;
  /** The diagram on screen, for the Export menu; null when nothing is drawn. */
  readonly exportSource: ExportSource | null;
  readonly setExportSource: (source: ExportSource | null) => void;
}

const DiagramSessionContext = createContext<DiagramSession>({
  workers: () => null,
  lenses: null,
  requestLenses: () => undefined,
  exportSource: null,
  setExportSource: () => undefined,
});

export function DiagramSessionProvider({
  factory,
  children,
}: {
  readonly factory?: DiagramWorkersFactory | undefined;
  readonly children: ReactNode;
}): ReactElement {
  const created = useRef<DiagramWorkers | null>(null);
  const asked = useRef(false);
  const [lenses, setLenses] = useState<readonly LensInfo[] | null>(null);
  const [exportSource, setExportSource] = useState<ExportSource | null>(null);

  const workers = useCallback((): DiagramWorkers | null => {
    if (factory === undefined) return null;
    created.current ??= factory();
    return created.current;
  }, [factory]);

  const requestLenses = useCallback((): void => {
    if (asked.current) return;
    const pair = workers();
    if (pair === null) return;
    asked.current = true;
    pair.data.lenses().then(setLenses, () => {
      asked.current = false;
    });
  }, [workers]);

  useEffect(
    () => () => {
      created.current?.dispose();
      created.current = null;
      asked.current = false;
    },
    [],
  );

  const value = useMemo<DiagramSession>(
    () => ({ workers, lenses, requestLenses, exportSource, setExportSource }),
    [workers, lenses, requestLenses, exportSource],
  );
  return <DiagramSessionContext value={value}>{children}</DiagramSessionContext>;
}

export function useDiagramSession(): DiagramSession {
  return useContext(DiagramSessionContext);
}

/** "load-balancing" → "Load balancing": the picker's label until the catalog's titles arrive. */
export function humanLensId(id: string): string {
  const words = id.replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
