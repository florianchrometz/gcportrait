// SPDX-License-Identifier: MIT
/**
 * Caller-token extraction and SHA-256 keys for in-memory limits. Header precedence and IAP handling
 * follow AGENTS.md, Security and privacy, Tokens; forwarding and logging follow principles 1 and 2.
 * The parser below distinguishes an absent preferred header from a malformed one.
 */
import { createHash } from 'node:crypto';

import type { FastifyRequest } from 'fastify';

/** The request header that carries the caller's token (lower case, as Node delivers header names). */
export const TOKEN_HEADER = 'x-gcportrait-token';

/** RFC 6750 `b64token` syntax, at most 4 KiB: anything else is not a token. */
const TOKEN = /^[A-Za-z0-9._~+/-]{1,4096}=*$/;
/** The scheme is case-insensitive and followed by one or more spaces (RFC 7235 §2.1, `auth-scheme 1*SP token68`). */
const BEARER = /^bearer +([A-Za-z0-9._~+/-]{1,4096}=*)$/i;

/**
 * The caller's token: `X-Gcportrait-Token` when the request carries it, else `Authorization: Bearer`; null when
 * there is none or the one that counts is malformed.
 */
export function callerTokenOf(request: Pick<FastifyRequest, 'headers'>): string | null {
  const own = request.headers[TOKEN_HEADER];
  if (own !== undefined) {
    // Sent twice, Node joins the values with ", ", which is not a token; an array never is one either.
    if (typeof own !== 'string') return null;
    const token = own.trim();
    return TOKEN.test(token) ? token : null;
  }
  const header = request.headers.authorization;
  if (typeof header !== 'string') return null;
  const match = BEARER.exec(header.trim());
  return match?.[1] ?? null;
}

/** A key for a token in the in-memory caps: its SHA-256, hex. */
export function tokenKeyOf(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
