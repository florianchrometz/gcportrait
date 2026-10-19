// SPDX-License-Identifier: Apache-2.0
import { useLocation, type To } from '../router';

import { DIAGRAM_PATH } from '../routes';
import { useAppState } from '../state';

/**
 * The URL hash belongs to the ViewSpec (`@gcportrait/model`): on /diagram it encodes everything
 * that defines the view, so links are shareable. The router never writes it. The app store remembers
 * the last diagram hash (`state.view.lastDiagramHash`) so that leaving /diagram (for Settings, say)
 * and coming back through navigation restores the same view instead of a blank one.
 */

export { DIAGRAM_PATH };

/**
 * Where a link to the diagram should go: the current location while already on /diagram (so the link
 * never drops the hash), otherwise /diagram with the last remembered hash.
 */
export function useDiagramLinkTarget(): To {
  const location = useLocation();
  const lastDiagramHash = useAppState((state) => state.view.lastDiagramHash);
  if (location.pathname === DIAGRAM_PATH) {
    return { pathname: DIAGRAM_PATH, search: location.search, hash: location.hash };
  }
  return { pathname: DIAGRAM_PATH, hash: lastDiagramHash };
}
