// SPDX-License-Identifier: MIT
/// <reference types="astro/client" />

/**
 * Whether this build sends the website's page views (src/lib/analytics.ts, `analyticsEnabled`): astro.config.ts
 * defines it for the bundler, so a build with analytics off carries none of their code.
 */
declare const __WEBSITE_ANALYTICS__: boolean;
