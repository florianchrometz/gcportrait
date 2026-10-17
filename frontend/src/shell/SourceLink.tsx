// SPDX-License-Identifier: MIT
import { useAppMode } from '../mode';
import { isSourceUrl, SOURCE_LINK_TEXT } from '../source';
import { useAppState } from '../state';

/**
 * The footer's link to the app's source and its licence, on every route (frontend/AGENTS.md, The source link): a courtesy to the
 * people who use an instance. Demo mode links to the build-time URL (VITE_SOURCE_URL) and never calls the backend;
 * live mode shows the same URL at once and then
 * the backend's `sourceUrl` from GET /api/config, the operator's SOURCE_URL, so a self-hosted instance links to
 * the source of the version it runs. An answer that is missing or not an http(s) URL leaves the build-time URL.
 * The configuration is the one auth/AuthProvider.tsx fetched once for the page (the store's `connect.backend`).
 */
export function SourceLink({ className }: { readonly className?: string | undefined }) {
  const { demo, sourceUrl } = useAppMode();
  const served = useAppState((state) =>
    state.connect.backend.status === 'ready' ? state.connect.backend.config.sourceUrl : null,
  );

  return (
    <a href={!demo && served !== null && isSourceUrl(served) ? served : sourceUrl} className={className}>
      {SOURCE_LINK_TEXT}
    </a>
  );
}
