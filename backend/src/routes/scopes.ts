// SPDX-License-Identifier: MIT
/**
 * `POST /api/scopes/search` (the scope picker of docs/permissions.md; skill cai-ingestion §1; the quota-project
 * spike's §3, rows h1–h4): the organisations, folders and projects the caller can see whose name or id matches what
 * the person typed, for the scope picker. Resource Manager v3 `organizations:search`, `folders:search` and
 * `projects:search` run side by side with the caller's own token (GET with query parameters; an empty result is
 * `{}`).
 *
 * How the text becomes a Resource Manager query (measured against the API on 2026-10-10):
 * - the text splits into at most five terms of `[A-Za-z0-9._-]` (other characters, quotes and non-ASCII letters
 *   among them, are refused by the query syntax and act as separators);
 * - folders: `state:ACTIVE AND displayName:*t*` for each term; projects: `state:ACTIVE AND (name:*t* OR id:*t*)`;
 *   matching is case-insensitive and by substring;
 * - organisations accept only `domain:` and `directoryCustomerId:` queries, so they are listed (a person sees
 *   few) and matched here, like any text the terms do not cover (non-ASCII letters).
 *
 * Paginated: `nextPageToken` (opaque to the browser) carries the three kinds' own page tokens; a kind without one
 * is exhausted. One kind failing does not fail the others: it is listed in `problems`.
 *
 * Answers: 200 with `{ scopes, nextPageToken?, problems }`; 400 (body or page token); 401 (no token, or Google did
 * not accept it); 403 (the token lacks the OAuth scope Resource Manager needs); 429 (the rate limit per token
 * hash); 502 (no kind answered).
 */
import { NumericIdSchema, ProjectRefSchema, ScopeKindSchema, type ScopeKind } from '@gcportrait/model';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { UpstreamSummarySchema } from '../preflight/schemas.js';
import { toFastifySchema } from '../schemas.js';
import {
  callGoogle,
  isRecord,
  isScopeInsufficient,
  isUnauthenticated,
  RESOURCE_MANAGER_URL,
  summaryOf,
  type GoogleCallContext,
  type GoogleOutcome,
} from '../upstream/google.js';
import type { UpstreamClient } from '../upstream/request.js';
import {
  authenticate,
  firstIssue,
  googleContextFor,
  sendError,
  sendUnauthenticated,
  SIGN_IN_AGAIN_MESSAGE,
} from '../upstream/route-support.js';
import { SCOPE_COLLECTIONS } from '../upstream/scope.js';
import { TokenRateLimiter } from '../upstream/token-limit.js';

/** Searches per token hash and minute: the picker searches as the person types (debounced). */
export const SEARCH_PER_MINUTE = 120;

export const SCOPE_KINDS: readonly ScopeKind[] = ['organization', 'folder', 'project'];
export const DEFAULT_PAGE_SIZE = 30;
const MAX_TERMS = 5;
const MAX_PAGE_TOKEN_LENGTH = 2048;

/** Text without control characters. */
// eslint-disable-next-line no-control-regex -- control characters are exactly what is refused here.
const PLAIN_TEXT = /^[^\u0000-\u001f\u007f]*$/;

export const ScopeSearchRequestSchema = z.strictObject({
  /** What the person typed; empty lists every scope the caller can see (a page at a time). */
  query: z.string().max(100).regex(PLAIN_TEXT, 'must not contain control characters').default(''),
  /** The kinds to search; all three by default. */
  kinds: z.array(ScopeKindSchema).min(1).max(3).optional(),
  /** Results per kind and page. */
  pageSize: z.number().int().min(1).max(100).optional(),
  /** `nextPageToken` of the previous answer for the same query and kinds. */
  pageToken: z.string().max(8192).optional(),
});
export type ScopeSearchRequest = z.infer<typeof ScopeSearchRequestSchema>;

export const ScopeSearchResultSchema = z.object({
  kind: ScopeKindSchema,
  /** The scope as the preflight and the stream take it: `organizations/123`, `folders/456`, `projects/my-id`. */
  scope: z.string(),
  /** The organisation or folder number, or the project id. */
  id: z.string(),
  displayName: z.string(),
  /** `organizations/…` or `folders/…`, when Google names a parent. */
  parent: z.string().optional(),
  /** A project's number. */
  projectNumber: z.string().optional(),
});
export type ScopeSearchResult = z.infer<typeof ScopeSearchResultSchema>;

export const ScopeSearchResponseSchema = z.object({
  scopes: z.array(ScopeSearchResultSchema),
  nextPageToken: z.string().optional(),
  /** Kinds whose search failed, with what Google answered; the other kinds' results are still listed. */
  problems: z.array(z.object({ kind: ScopeKindSchema, upstream: UpstreamSummarySchema })),
});
export type ScopeSearchResponse = z.infer<typeof ScopeSearchResponseSchema>;

type PageTokens = Partial<Record<ScopeKind, string>>;

/** Upstream page tokens are opaque base64-ish strings. */
const UPSTREAM_PAGE_TOKEN = /^[A-Za-z0-9_\-=.~+/]{1,2048}$/;

export function encodePageToken(tokens: PageTokens): string | undefined {
  const entries = SCOPE_KINDS.flatMap((kind) => {
    const token = tokens[kind];
    return token === undefined ? [] : [[kind, token] as const];
  });
  return entries.length === 0
    ? undefined
    : Buffer.from(JSON.stringify(Object.fromEntries(entries)), 'utf8').toString('base64url');
}

/** The page tokens in `text`, or null when it is not one this route wrote. */
export function decodePageToken(text: string): PageTokens | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(text, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const tokens: PageTokens = {};
  for (const [key, value] of Object.entries(parsed)) {
    const kind = ScopeKindSchema.safeParse(key);
    if (!kind.success || typeof value !== 'string' || value.length > MAX_PAGE_TOKEN_LENGTH) return null;
    if (!UPSTREAM_PAGE_TOKEN.test(value)) return null;
    tokens[kind.data] = value;
  }
  return Object.keys(tokens).length === 0 ? null : tokens;
}

/** The query's terms for Resource Manager, and whether they say everything the text says. */
export function searchTerms(text: string): { readonly terms: readonly string[]; readonly complete: boolean } {
  const trimmed = text.trim();
  const terms = trimmed.split(/[^A-Za-z0-9._-]+/).filter((term) => term !== '');
  const complete = /^[A-Za-z0-9._\-\s]*$/.test(trimmed) && terms.length <= MAX_TERMS;
  return { terms: terms.slice(0, MAX_TERMS), complete };
}

/** The Resource Manager query for a kind, or undefined for none (organisations; or nothing typed and no filter). */
export function upstreamQuery(kind: ScopeKind, terms: readonly string[]): string | undefined {
  if (kind === 'organization') return undefined;
  const clauses =
    kind === 'folder'
      ? terms.map((term) => `displayName:*${term}*`)
      : terms.map((term) => `(name:*${term}* OR id:*${term}*)`);
  return ['state:ACTIVE', ...clauses].join(' AND ');
}

/** Whether a result matches every word of the text (case-insensitive substrings of its name or id). */
export function matchesText(text: string, result: Pick<ScopeSearchResult, 'displayName' | 'id'>): boolean {
  const words = text
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== '');
  const name = result.displayName.toLowerCase();
  const id = result.id.toLowerCase();
  return words.every((word) => name.includes(word) || id.includes(word));
}

const PARENT_PATTERN = /^(?:organizations|folders)\/[1-9][0-9]{0,24}$/;

function idOfName(name: unknown, collection: string): string | undefined {
  if (typeof name !== 'string' || !name.startsWith(`${collection}/`)) return undefined;
  const id = name.slice(collection.length + 1);
  return NumericIdSchema.safeParse(id).success && id.length <= 25 ? id : undefined;
}

function isActive(entry: Record<string, unknown>): boolean {
  return entry.state === undefined || entry.state === 'ACTIVE';
}

/** One Resource Manager result as a picker entry; undefined for anything malformed or not active. */
export function resultOf(kind: ScopeKind, entry: unknown): ScopeSearchResult | undefined {
  if (!isRecord(entry) || !isActive(entry)) return undefined;
  const parent =
    typeof entry.parent === 'string' && PARENT_PATTERN.test(entry.parent) ? entry.parent : undefined;
  const withParent = parent === undefined ? {} : { parent };
  const displayName = typeof entry.displayName === 'string' ? entry.displayName.trim() : '';
  if (kind === 'project') {
    const projectId = entry.projectId;
    if (
      typeof projectId !== 'string' ||
      !ProjectRefSchema.safeParse(projectId).success ||
      projectId.length > 100
    ) {
      return undefined;
    }
    const number = idOfName(entry.name, 'projects');
    return {
      kind,
      scope: `projects/${projectId}`,
      id: projectId,
      displayName: displayName === '' ? projectId : displayName,
      ...withParent,
      ...(number === undefined ? {} : { projectNumber: number }),
    };
  }
  const collection = SCOPE_COLLECTIONS[kind];
  const id = idOfName(entry.name, collection);
  if (id === undefined) return undefined;
  return {
    kind,
    scope: `${collection}/${id}`,
    id,
    displayName: displayName === '' ? id : displayName,
    ...withParent,
  };
}

const LIST_KEY: Readonly<Record<ScopeKind, string>> = {
  organization: 'organizations',
  folder: 'folders',
  project: 'projects',
};

interface KindPage {
  readonly kind: ScopeKind;
  readonly outcome: GoogleOutcome;
  readonly results: readonly ScopeSearchResult[];
  readonly nextPageToken?: string;
}

async function searchKind(
  context: GoogleCallContext,
  token: string,
  kind: ScopeKind,
  terms: readonly string[],
  pageSize: number,
  pageToken: string | undefined,
): Promise<KindPage> {
  const parameters = new URLSearchParams();
  const query = upstreamQuery(kind, terms);
  if (query !== undefined) parameters.set('query', query);
  parameters.set('pageSize', String(pageSize));
  if (pageToken !== undefined) parameters.set('pageToken', pageToken);
  const outcome = await callGoogle(context, {
    operation: `resourcemanager.${SCOPE_COLLECTIONS[kind]}.search`,
    method: 'GET',
    url: `${RESOURCE_MANAGER_URL}/${SCOPE_COLLECTIONS[kind]}:search?${parameters.toString()}`,
    token,
    attempts: 2,
  });
  if (outcome.kind !== 'answer' || outcome.httpStatus !== 200 || !isRecord(outcome.body)) {
    return { kind, outcome, results: [] };
  }
  const list = outcome.body[LIST_KEY[kind]];
  const results = (Array.isArray(list) ? list : []).flatMap((entry) => {
    const result = resultOf(kind, entry);
    return result === undefined ? [] : [result];
  });
  const next = outcome.body.nextPageToken;
  return {
    kind,
    outcome,
    results,
    ...(typeof next === 'string' && UPSTREAM_PAGE_TOKEN.test(next) ? { nextPageToken: next } : {}),
  };
}

function failed(page: KindPage): boolean {
  return page.outcome.kind !== 'answer' || page.outcome.httpStatus !== 200;
}

export interface ScopeSearchRouteOptions {
  readonly upstream: UpstreamClient;
  readonly perMinute?: number;
}

export function registerScopeSearchRoute(app: FastifyInstance, options: ScopeSearchRouteOptions): void {
  const limiter = new TokenRateLimiter({ max: options.perMinute ?? SEARCH_PER_MINUTE });

  app.post<{ Reply: ScopeSearchResponse }>(
    '/api/scopes/search',
    { schema: { response: { 200: toFastifySchema(ScopeSearchResponseSchema) } } },
    async (request, reply) => {
      const token = authenticate(request, reply, limiter);
      if (token === null) return reply;
      const parsed = ScopeSearchRequestSchema.safeParse(request.body ?? {});
      if (!parsed.success)
        return sendError(request, reply, 400, `Invalid request: ${firstIssue(parsed.error)}.`);
      const body = parsed.data;
      const requested = SCOPE_KINDS.filter((kind) => body.kinds === undefined || body.kinds.includes(kind));
      let pageTokens: PageTokens = {};
      if (body.pageToken !== undefined) {
        const decoded = decodePageToken(body.pageToken);
        if (decoded === null)
          return sendError(request, reply, 400, 'Invalid request: pageToken is not valid.');
        pageTokens = decoded;
      }
      const kinds =
        body.pageToken === undefined ? requested : requested.filter((kind) => pageTokens[kind] !== undefined);
      const { terms, complete } = searchTerms(body.query);
      const context = googleContextFor(request, reply, options.upstream);
      const pageSize = body.pageSize ?? DEFAULT_PAGE_SIZE;

      const pages = await Promise.all(
        kinds.map((kind) => searchKind(context, token, kind, terms, pageSize, pageTokens[kind])),
      );
      if (pages.some((page) => isUnauthenticated(page.outcome))) {
        return sendUnauthenticated(request, reply, SIGN_IN_AGAIN_MESSAGE);
      }
      const failures = pages.filter(failed);
      if (pages.length > 0 && failures.length === pages.length) {
        const [first] = failures;
        const upstream = first === undefined ? undefined : summaryOf(first.outcome);
        if (first !== undefined && isScopeInsufficient(first.outcome)) {
          return sendError(
            request,
            reply,
            403,
            'Sign in again and allow gcportrait to see your Google Cloud resources.',
            upstream,
          );
        }
        return sendError(request, reply, 502, 'Google did not answer the search; try again.', upstream);
      }

      const scopes = pages.flatMap((page) =>
        page.kind === 'organization' || !complete
          ? page.results.filter((result) => matchesText(body.query, result))
          : page.results,
      );
      const next = encodePageToken(
        Object.fromEntries(
          pages.flatMap((page) =>
            page.nextPageToken === undefined ? [] : [[page.kind, page.nextPageToken]],
          ),
        ),
      );
      return reply.code(200).send({
        scopes,
        ...(next === undefined ? {} : { nextPageToken: next }),
        problems: failures.map((page) => ({ kind: page.kind, upstream: summaryOf(page.outcome) })),
      });
    },
  );
}
