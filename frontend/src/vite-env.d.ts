// SPDX-License-Identifier: MIT

/** Build-time environment the SPA reads (Vite exposes only VITE_-prefixed variables). */
declare global {
  interface ImportMetaEnv {
    /** "1" builds or serves the app in demo mode (pnpm dev:demo). */
    readonly VITE_DEMO?: string;
    /**
     * Where the source of this build is published: the footer's "Source (MIT)" link in demo mode, and live
     * mode's fallback. Default: https://github.com/florianchrometz/gcportrait (source.ts).
     */
    readonly VITE_SOURCE_URL?: string;
    /**
     * "1" builds the static demo (`pnpm demo:static`, api/staticConfig.ts): demo-only mode with its configuration built
     * in, for a static host under a base path (`/demo/` by default).
     */
    readonly VITE_STATIC_DEMO?: string;
    /** The static demo's version (`git describe` by default; scripts/static-demo.mjs). */
    readonly VITE_APP_VERSION?: string;
    /** The static demo's linked Impressum and privacy notice (https URLs; scripts/static-demo.mjs). */
    readonly VITE_LEGAL_IMPRESSUM_URL?: string;
    readonly VITE_LEGAL_PRIVACY_URL?: string;
  }
}

export {};
