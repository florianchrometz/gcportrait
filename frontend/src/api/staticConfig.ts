// SPDX-License-Identifier: MIT
import { readSourceUrl } from '../source';
import { isLegalUrl, type PublicConfig } from './config';

/**
 * The static demo (`pnpm demo:static`; agents.md, Modes and hosting): the app built in demo-only mode for a static
 * host, the maintainer's demo at https://gcportrait.app/demo/ on GitHub Pages. There is no backend to ask, so the
 * public configuration that a demo-only instance's GET /api/config would answer is built in at build time, from these
 * variables (the root command scripts/static-demo.mjs sets them):
 *
 * - `VITE_STATIC_DEMO`: "1" for the static demo's bundle;
 * - `VITE_APP_VERSION`: the version shown where an instance shows its backend's (`git describe` by default);
 * - `VITE_SOURCE_URL`: the footer's "Source (MIT)" link (source.ts), as in the build-time demo mode;
 * - `VITE_LEGAL_IMPRESSUM_URL`, `VITE_LEGAL_PRIVACY_URL`: the Impressum and the privacy notice the footer links, as a
 *   demo-only instance links its LEGAL_IMPRESSUM_URL and LEGAL_PRIVACY_URL (https only; anything else links nothing).
 *
 * The app then runs exactly as on a demo-only instance (demoOnly.ts): the demo organisations only, no sign-in, nothing
 * read from Google Cloud, the way to deploy gcportrait to one's own project. auth/AuthProvider.tsx puts this
 * configuration into the store instead of asking /api/config, and the static bundle leaves the sign-in code out.
 */
export type StaticDemoEnv = {
  readonly VITE_STATIC_DEMO?: string | undefined;
  readonly VITE_APP_VERSION?: string | undefined;
  readonly VITE_SOURCE_URL?: string | undefined;
  readonly VITE_LEGAL_IMPRESSUM_URL?: string | undefined;
  readonly VITE_LEGAL_PRIVACY_URL?: string | undefined;
};

/** The version when the build names none. */
export const UNKNOWN_VERSION = 'unknown';

function legalUrl(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return isLegalUrl(trimmed) ? trimmed : null;
}

/**
 * The static demo's public configuration, or null for every other build (the app then asks the backend, or, in the
 * build-time demo mode, nobody). It is what a demo-only instance answers: no OAuth client, no service-account mode,
 * no account, no render API, and no `hostedBy` line (nobody runs a service; the footer carries the non-affiliation
 * notice).
 */
export function readStaticConfig(env: StaticDemoEnv): PublicConfig | null {
  if (env.VITE_STATIC_DEMO !== '1') return null;
  return {
    oauthClientId: null,
    saMode: false,
    saStrictExposure: false,
    backendServiceAccount: null,
    version: env.VITE_APP_VERSION?.trim() || UNKNOWN_VERSION,
    sourceUrl: readSourceUrl(env.VITE_SOURCE_URL),
    demo: false,
    demoOnly: true,
    legal: {
      impressum: false,
      privacy: false,
      impressumUrl: legalUrl(env.VITE_LEGAL_IMPRESSUM_URL),
      privacyUrl: legalUrl(env.VITE_LEGAL_PRIVACY_URL),
    },
  };
}
