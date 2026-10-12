// SPDX-License-Identifier: MIT
import { useEffect } from 'react';

import { WORDMARK } from '../branding';

/** Sets the browser tab title for a page: "<page> · gcportrait". */
export function useDocumentTitle(pageTitle: string): void {
  useEffect(() => {
    document.title = `${pageTitle} · ${WORDMARK}`;
  }, [pageTitle]);
}
