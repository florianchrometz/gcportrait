// SPDX-License-Identifier: MIT
import type { LegalPages } from './api/config';
import { useAppState } from './state';

/**
 * Demo-only mode (AGENTS.md, Modes and hosting): an instance whose backend runs with DEMO_ONLY=true, such as the
 * maintainer's sign-in-free demo, and a demo build (`pnpm dev:demo`, `pnpm demo:static`), which builds that instance's
 * configuration in (api/demoConfig.ts). The app learns it from the configuration in the store, which
 * auth/AuthProvider.tsx put there from GET /api/config or from the build. The Connect page then offers the demo
 * organisations only, with the way to deploy gcportrait to one's own project; the top bar shows the demo badge; the
 * Permissions page explains that nothing can be checked here.
 */
export function useDemoOnly(): boolean {
  return useAppState(
    (state) => state.connect.backend.status === 'ready' && state.connect.backend.config.demoOnly,
  );
}

const NO_LEGAL_PAGES: LegalPages = { impressum: false, privacy: false, impressumUrl: null, privacyUrl: null };

/**
 * Which legal pages the instance publishes (`legal` in /api/config): none before the backend answered, when it did
 * not, or when a demo build named none.
 */
export function useLegalPages(): LegalPages {
  return useAppState((state) =>
    state.connect.backend.status === 'ready' ? state.connect.backend.config.legal : NO_LEGAL_PAGES,
  );
}
