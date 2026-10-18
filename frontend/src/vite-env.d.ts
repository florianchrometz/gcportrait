// SPDX-License-Identifier: MIT

/** Build-time environment the SPA reads (Vite exposes only VITE_-prefixed variables). */
declare global {
  interface ImportMetaEnv {
    /** "1" serves the app as a demo build (pnpm dev:demo): demo-only, with the configuration built in. */
    readonly VITE_DEMO?: string;
    /**
     * Where the source of this build is published: the footer's "Source (MIT)" link in a demo build, and live
     * mode's fallback. Default: https://github.com/florianchrometz/gcportrait (source.ts).
     */
    readonly VITE_SOURCE_URL?: string;
    /**
     * "1" builds the static demo (`pnpm demo:static`, api/demoConfig.ts): the same demo-only configuration built
     * in, for a static host under a base path (`/demo/` by default).
     */
    readonly VITE_STATIC_DEMO?: string;
    /** A demo build's version (`git describe` by default for the static demo; scripts/static-demo.mjs). */
    readonly VITE_APP_VERSION?: string;
    /** A demo build's linked Impressum and privacy notice (https URLs; scripts/static-demo.mjs). */
    readonly VITE_LEGAL_IMPRESSUM_URL?: string;
    readonly VITE_LEGAL_PRIVACY_URL?: string;
  }
}

export {};
