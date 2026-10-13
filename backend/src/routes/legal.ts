// SPDX-License-Identifier: MIT
import type { FastifyInstance } from 'fastify';

import type { ServerConfig } from '../config.js';
import { LegalResponseSchema, toFastifySchema, type LegalResponse } from '../schemas.js';

/**
 * GET /api/legal (AGENTS.md, Modes and hosting): the instance's Impressum and privacy notice as Markdown,
 * from LEGAL_DIR or LEGAL_BUNDLE (legal.ts), or null for a page it does not publish. Public by design, like
 * the pages themselves; registered in every mode, demo-only included. The SPA asks for it only on /impressum
 * and /privacy, and shows the footer's links only for the pages `legal` in /api/config names. The texts are
 * read once at start-up.
 */
export function registerLegalRoute(app: FastifyInstance, config: ServerConfig): void {
  const body: LegalResponse = { impressum: config.legal.impressum, privacy: config.legal.privacy };
  app.get<{ Reply: LegalResponse }>(
    '/api/legal',
    { schema: { response: { 200: toFastifySchema(LegalResponseSchema) } } },
    () => Promise.resolve(body),
  );
}
