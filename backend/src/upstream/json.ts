// SPDX-License-Identifier: Apache-2.0
/**
 * The one reader of the JSON that Google answers with (and of the identity's answers and credential files,
 * ../auth/identity.ts): a body that is not well-formed UTF-8 or not JSON reads as `undefined`, never as an
 * exception, so every caller treats it as an answer it does not understand and fails closed (backend/AGENTS.md, Quota project and the permission check). Nothing here logs, keeps or echoes a body.
 */

/** A JSON object: not null and not an array. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `text` parsed as JSON, or undefined when it is not JSON. */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** A body read as UTF-8 (a leading byte-order mark dropped) and parsed as JSON; undefined if it is not both. */
export function readJson(body: Uint8Array): unknown {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    return undefined;
  }
  return parseJson(text);
}
