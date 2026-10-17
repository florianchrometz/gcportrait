// SPDX-License-Identifier: MIT
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * The instance's legal pages (backend/AGENTS.md, Demo-only mode and legal pages): an Impressum and a privacy notice, written by
 * whoever runs the instance and handed to the backend at start-up, never kept in the repository (they name a
 * person and an address). The SPA shows them at /impressum and /privacy, rendered from Markdown with a
 * renderer that never emits raw HTML (frontend/src/legal/), and links them from its footer only when they
 * exist. Two ways in, one of them at a time (config.ts):
 *
 * - `LEGAL_DIR`: a directory holding `impressum.md` and/or `privacy.md` (local runs, compose, any volume);
 * - `LEGAL_BUNDLE`: the same texts as one JSON object of base64 strings, `{"impressum":"…","privacy":"…"}`, which
 *   `infra/deploy.sh --legal-dir` builds from such a directory and sets as an environment variable on Cloud Run
 *   (no Secret Manager secret, no grant, nothing to clean up; the texts are public anyway).
 *
 * Both are read once, checked (UTF-8, size, no control characters) and kept in memory; a problem stops start-up
 * with a message that names the variable and the file, never the text.
 */

export const LEGAL_PAGES = ['impressum', 'privacy'] as const;
export type LegalPage = (typeof LEGAL_PAGES)[number];

/** Markdown per page, or null when the instance publishes no such page. */
export type LegalTexts = Readonly<Record<LegalPage, string | null>>;

export const NO_LEGAL_TEXTS: LegalTexts = Object.freeze({ impressum: null, privacy: null });

/** The largest text accepted, in bytes of UTF-8: an Impressum or privacy notice is a few kilobytes. */
export const MAX_LEGAL_TEXT_BYTES = 64 * 1024;

/** A legal text that cannot be used; the message names where it came from and why, never its content. */
export class LegalTextError extends Error {
  override readonly name = 'LegalTextError';
}

/** The file of a page in LEGAL_DIR. */
export function legalFileName(page: LegalPage): string {
  return `${page}.md`;
}

/** C0 controls other than tab and line feed, and DEL: never part of a Markdown text. */
// eslint-disable-next-line no-control-regex -- the point of the pattern is to find control characters
const CONTROL_CHARACTER = /[\u0000-\u0008\u000b-\u001f\u007f]/;

/**
 * The text of `bytes` as the SPA gets it: UTF-8 (strictly), without a byte order mark, with line feeds only, and
 * not blank. `where` names the source in a refusal ("LEGAL_DIR/impressum.md").
 */
export function legalTextOf(bytes: Uint8Array, where: string): string {
  if (bytes.byteLength > MAX_LEGAL_TEXT_BYTES) {
    throw new LegalTextError(`${where} is larger than ${String(MAX_LEGAL_TEXT_BYTES / 1024)} KiB`);
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    throw new LegalTextError(`${where} is not valid UTF-8`);
  }
  text = text.replace(/\r\n?/g, '\n');
  if (CONTROL_CHARACTER.test(text)) {
    throw new LegalTextError(`${where} contains control characters`);
  }
  if (text.trim() === '') throw new LegalTextError(`${where} is empty`);
  return text;
}

/** Reads `impressum.md` and `privacy.md` from `dir`; either may be missing, not both. */
export function readLegalDir(dir: string): LegalTexts {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new LegalTextError('LEGAL_DIR is not a directory');
  }
  const texts: Record<LegalPage, string | null> = { impressum: null, privacy: null };
  for (const page of LEGAL_PAGES) {
    const file = path.join(dir, legalFileName(page));
    if (!existsSync(file)) continue;
    if (!statSync(file).isFile()) throw new LegalTextError(`LEGAL_DIR/${legalFileName(page)} is not a file`);
    texts[page] = legalTextOf(readFileSync(file), `LEGAL_DIR/${legalFileName(page)}`);
  }
  if (texts.impressum === null && texts.privacy === null) {
    throw new LegalTextError('LEGAL_DIR holds neither impressum.md nor privacy.md');
  }
  return Object.freeze(texts);
}

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/**
 * Parses LEGAL_BUNDLE: a JSON object whose only keys are `impressum` and `privacy` (at least one), each the
 * standard base64 of that page's UTF-8 Markdown.
 */
export function parseLegalBundle(value: string): LegalTexts {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new LegalTextError('LEGAL_BUNDLE is not JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new LegalTextError('LEGAL_BUNDLE must be a JSON object with "impressum" and/or "privacy"');
  }
  const record = parsed as Record<string, unknown>;
  const unknownKeys = Object.keys(record).filter((key) => !(LEGAL_PAGES as readonly string[]).includes(key));
  if (unknownKeys.length > 0) {
    throw new LegalTextError(
      `LEGAL_BUNDLE has keys other than "impressum" and "privacy" (${String(unknownKeys.length)} of them)`,
    );
  }
  const texts: Record<LegalPage, string | null> = { impressum: null, privacy: null };
  for (const page of LEGAL_PAGES) {
    const encoded = record[page];
    if (encoded === undefined) continue;
    if (typeof encoded !== 'string' || encoded === '' || !BASE64.test(encoded)) {
      throw new LegalTextError(`LEGAL_BUNDLE.${page} must be a base64 string`);
    }
    texts[page] = legalTextOf(Buffer.from(encoded, 'base64'), `LEGAL_BUNDLE.${page}`);
  }
  if (texts.impressum === null && texts.privacy === null) {
    throw new LegalTextError('LEGAL_BUNDLE holds neither "impressum" nor "privacy"');
  }
  return Object.freeze(texts);
}
