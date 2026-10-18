// SPDX-License-Identifier: Apache-2.0
import { useAppMode } from '../mode';
import { isSourceUrl, SOURCE_LINK_TEXT } from '../source';
import { useAppState } from '../state';

/**
 * The footer's link to the app's source and its licence, on every route (frontend/AGENTS.md, The source link).
 * A demo build links the URL it built in (VITE_SOURCE_URL) and never calls the backend;
 * live mode shows the same URL at once and then
 * the backend's `sourceUrl` from GET /api/config, the operator's SOURCE_URL, so a self-hosted instance links to
 * the source of the version it runs. An answer that is missing or not an http(s) URL leaves the build-time URL.
 * The configuration is the one auth/AuthProvider.tsx put in the store (`connect.backend`), from the backend or from
 * the build.
 */
export function SourceLink({ className }: { readonly className?: string | undefined }) {
  const { sourceUrl } = useAppMode();
  const served = useAppState((state) =>
    state.connect.backend.status === 'ready' ? state.connect.backend.config.sourceUrl : null,
  );

  return (
    <a href={served !== null && isSourceUrl(served) ? served : sourceUrl} className={className}>
      {SOURCE_LINK_TEXT}
    </a>
  );
}
