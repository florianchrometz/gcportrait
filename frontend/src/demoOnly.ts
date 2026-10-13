// SPDX-License-Identifier: MIT
import type { LegalPages } from './api/config';
import { useAppState } from './state';

/**
 * Demo-only mode (AGENTS.md, Modes and hosting): an instance whose backend runs with DEMO_ONLY=true, such as the
 * maintainer's sign-in-free demo. Unlike the build-time demo mode (`useAppMode().demo`, no backend at all), the app
 * learns it at run time from GET /api/config (`demoOnly`), which auth/AuthProvider.tsx fetched into the store. The
 * Connect page then offers the demo organisations only, with the way to deploy gcportrait to one's own project; the
 * top bar shows the demo badge; the Permissions page explains that nothing can be checked here.
 */
export function useDemoOnly(): boolean {
  return useAppState(
    (state) => state.connect.backend.status === 'ready' && state.connect.backend.config.demoOnly === true,
  );
}

const NO_LEGAL_PAGES: LegalPages = { impressum: false, privacy: false };

/**
 * Which legal pages the instance publishes (`legal` in /api/config): none in the build-time demo mode, before the
 * backend answered, when it did not, or when it publishes none.
 */
export function useLegalPages(): LegalPages {
  return useAppState((state) =>
    state.connect.backend.status === 'ready'
      ? (state.connect.backend.config.legal ?? NO_LEGAL_PAGES)
      : NO_LEGAL_PAGES,
  );
}
