// SPDX-License-Identifier: Apache-2.0
import { readSourceUrl } from '../source';
import { isLegalUrl, type PublicConfig } from './config';

/**
 * A demo build (AGENTS.md, Modes and hosting): the app in demo-only mode with its configuration built in, because
 * there is no backend to ask. `pnpm dev:demo` serves it on a checkout (`VITE_DEMO=1`, at the root of its origin) and
 * `pnpm demo:static` builds it for a static host (`VITE_STATIC_DEMO=1`, below `/demo/`; the maintainer's demo at
 * https://gcportrait.app/demo/). The two variables exclude each other: a build is one or the other.
 *
 * The configuration is what a demo-only instance's GET /api/config answers, built in at build time from these
 * variables (frontend/package.json's `dev:demo` and the root scripts/static-demo.mjs set them):
 *
 * - `VITE_APP_VERSION`: the version shown where an instance shows its backend's (`git describe` by default);
 * - `VITE_SOURCE_URL`: the footer's "Source (Apache-2.0)" link (source.ts);
 * - `VITE_LEGAL_IMPRESSUM_URL`, `VITE_LEGAL_PRIVACY_URL`: the Impressum and the privacy notice the footer links, as a
 *   demo-only instance links its LEGAL_IMPRESSUM_URL and LEGAL_PRIVACY_URL (https only; anything else links nothing).
 *
 * The app then runs exactly as on a demo-only instance (demoOnly.ts): the demo organisations only, no sign-in, nothing
 * read from Google Cloud, the way to deploy gcportrait to one's own project. auth/AuthProvider.tsx puts this
 * configuration into the store instead of asking /api/config, and the static bundle leaves the sign-in code out.
 */
export type DemoConfigEnv = {
  readonly VITE_DEMO?: string | undefined;
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
 * The demo build's public configuration, or null for every other build (the app then asks the backend). It is what a
 * demo-only instance answers: no OAuth client, no service-account mode, no account, no render API, and no `hostedBy`
 * line (nobody runs a service; the footer carries the non-affiliation notice).
 */
export function readDemoConfig(env: DemoConfigEnv): PublicConfig | null {
  if (env.VITE_DEMO !== '1' && env.VITE_STATIC_DEMO !== '1') return null;
  return {
    oauthClientId: null,
    saMode: false,
    saStrictExposure: false,
    backendServiceAccount: null,
    version: env.VITE_APP_VERSION?.trim() || UNKNOWN_VERSION,
    sourceUrl: readSourceUrl(env.VITE_SOURCE_URL),
    hostedBy: null,
    demo: false,
    demoOnly: true,
    legal: {
      impressum: false,
      privacy: false,
      impressumUrl: legalUrl(env.VITE_LEGAL_IMPRESSUM_URL),
      privacyUrl: legalUrl(env.VITE_LEGAL_PRIVACY_URL),
    },
    render: null,
  };
}
