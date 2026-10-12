// SPDX-License-Identifier: MIT
import type { FastifyInstance } from 'fastify';

import type { ServerConfig } from '../config.js';
import { PublicConfigResponseSchema, toFastifySchema, type PublicConfigResponse } from '../schemas.js';

/**
 * GET /api/config (docs/api.md): the public configuration the SPA starts from. No auth, by design: nothing here is a
 * secret. The OAuth web client id is what Google Identity Services needs in the browser, `saMode` and
 * `backendServiceAccount` tell the Connect and Permissions pages whether service-account mode is offered and which
 * account to grant (with the mode on, the account Application Default Credentials resolved to), `saStrictExposure`
 * whether its gate also refuses scopes the account can see on its own, `hostedBy` says who runs the instance before
 * anyone signs in, `sourceUrl` is the target of the footer's source link, `demoOnly` says the instance serves the demo only
 * (ADR 0032), `legal` which legal pages it serves as texts (routes/legal.ts) and the addresses of those it links
 * instead (LEGAL_IMPRESSUM_URL, LEGAL_PRIVACY_URL), and `render` the limits of the render API, or null where it is
 * off (ADR 0033).
 */

/**
 * The `hostedBy` line: "Hosted by NAME.", or null without a name. It carries no non-affiliation line: the app's
 * footer says that on every page (ADR 0018, placement of 2026-10-12: footers and long-form texts only).
 */
export function hostedByLine(hostedBy: string | null): string | null {
  const name = hostedBy?.replace(/[.\s]+$/u, '') ?? '';
  return name === '' ? null : `Hosted by ${name}.`;
}

/**
 * The answer of GET /api/config. In demo-only mode it names no OAuth client, no service-account mode and no
 * account, whatever else is set (config.ts refuses a client id and service-account mode with DEMO_ONLY=true, so this
 * is a second line of defence).
 */
export function publicConfigOf(config: ServerConfig): PublicConfigResponse {
  const live = !config.demoOnly;
  return {
    oauthClientId: live ? config.oauthClientId : null,
    saMode: live && config.saModeEnabled,
    saStrictExposure: live && config.saModeEnabled && config.saStrictExposure,
    backendServiceAccount: live ? config.backendServiceAccount : null,
    version: config.version,
    sourceUrl: config.sourceUrl,
    hostedBy: hostedByLine(config.hostedBy),
    demo: false,
    demoOnly: config.demoOnly,
    legal: {
      impressum: config.legal.impressum !== null,
      privacy: config.legal.privacy !== null,
      impressumUrl: config.legalUrls.impressum,
      privacyUrl: config.legalUrls.privacy,
    },
    render:
      live && config.render !== null
        ? {
            maxAssets: config.render.maxAssets,
            maxPixels: config.render.maxPixels,
            maxBodyBytes: config.render.maxBodyBytes,
            timeoutMs: config.render.timeoutMs,
          }
        : null,
  };
}

export function registerConfigRoute(app: FastifyInstance, config: ServerConfig): void {
  const body = publicConfigOf(config);
  app.get<{ Reply: PublicConfigResponse }>(
    '/api/config',
    { schema: { response: { 200: toFastifySchema(PublicConfigResponseSchema) } } },
    () => Promise.resolve(body),
  );
}
