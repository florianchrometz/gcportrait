// SPDX-License-Identifier: MIT
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation, type To } from 'react-router';

import { DIAGRAM_PATH } from '../routes';

/**
 * The URL hash belongs to the ViewSpec (`@gcportrait/model`): on /diagram it encodes everything
 * that defines the view, so links are shareable. The router never writes it. This module remembers the
 * last diagram hash so that leaving /diagram (for Settings, say) and coming back through the navigation
 * restores the same view instead of a blank one.
 *
 * Code changes the view only through the app store's actions (src/state, `useDiagramActions()`), which write
 * the hash through the router, so the router's location and this memory stay current.
 */

export { DIAGRAM_PATH };

type ViewHashMemory = {
  readonly lastDiagramHash: string;
  readonly remember: (hash: string) => void;
};

const ViewHashContext = createContext<ViewHashMemory>({ lastDiagramHash: '', remember: () => undefined });

export function ViewHashProvider({ children }: { readonly children: ReactNode }) {
  const [lastDiagramHash, setLastDiagramHash] = useState('');
  const value = useMemo<ViewHashMemory>(
    () => ({ lastDiagramHash, remember: setLastDiagramHash }),
    [lastDiagramHash],
  );
  return <ViewHashContext value={value}>{children}</ViewHashContext>;
}

/** Called by the diagram page: records its hash whenever it changes. */
export function useRememberDiagramHash(): void {
  const { hash } = useLocation();
  const { remember } = useContext(ViewHashContext);
  useEffect(() => {
    remember(hash);
  }, [hash, remember]);
}

/**
 * Where a link to the diagram should go: the current location while already on /diagram (so the link
 * never drops the hash), otherwise /diagram with the last remembered hash.
 */
export function useDiagramLinkTarget(): To {
  const location = useLocation();
  const { lastDiagramHash } = useContext(ViewHashContext);
  if (location.pathname === DIAGRAM_PATH) {
    return { pathname: DIAGRAM_PATH, search: location.search, hash: location.hash };
  }
  return { pathname: DIAGRAM_PATH, hash: lastDiagramHash };
}
