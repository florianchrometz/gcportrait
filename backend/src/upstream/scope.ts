// SPDX-License-Identifier: MIT
/**
 * Cloud Asset Inventory scopes as request bodies name them (skill cai-ingestion §1): `organizations/ID`,
 * `folders/ID` or `projects/ID_OR_NUMBER`. A scope is validated here, with the identifier schemas of
 * `@gcportrait/model`, before anything reaches Google, and the same parsed value builds every URL of one
 * request (the gate uses the same string in all three of its calls).
 */
import { NumericIdSchema, type ScopeKind } from '@gcportrait/model';
import * as z from 'zod';

/** The collection name of each scope kind, as Resource Manager and CAI spell it in paths. */
export const SCOPE_COLLECTIONS = {
  organization: 'organizations',
  folder: 'folders',
  project: 'projects',
} as const satisfies Readonly<Record<ScopeKind, string>>;

/** A parsed, validated scope. */
export interface ParsedScope {
  readonly kind: ScopeKind;
  /** The id without its prefix: an organisation or folder number, a project id or number. */
  readonly id: string;
  /** `organizations/123`, `folders/456`, `projects/my-project`. */
  readonly name: string;
}

/** Longest id accepted: numbers have at most 20 digits; a domain-scoped project id is longer than a plain one. */
const MAX_ID_LENGTH = 100;

/**
 * A project as Google names one (`@gcportrait/model`'s ProjectRefSchema is looser, for ids read from data):
 * a number, or an id of 6 to 30 lower-case letters, digits and hyphens that starts with a letter and does not end
 * with a hyphen, or a legacy domain-scoped id, a domain name and a colon before an id (`example.com:my-project`).
 * Anything else, such as `evil.com`, never reaches Google: the host of every call is fixed anyway, so this only
 * spares a call that could not succeed.
 */
const PROJECT_NUMBER = /^[1-9][0-9]{0,19}$/;
const PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const DOMAIN_SCOPED_PROJECT_ID =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+:[a-z][a-z0-9-]{0,61}[a-z0-9]$/;

/** Whether `id` names a project the way Google does (a number, an id, or a domain-scoped id). */
export function isProjectRef(id: string): boolean {
  return (
    id.length <= MAX_ID_LENGTH &&
    (PROJECT_NUMBER.test(id) || PROJECT_ID.test(id) || DOMAIN_SCOPED_PROJECT_ID.test(id))
  );
}

const KIND_BY_COLLECTION: ReadonlyMap<string, ScopeKind> = new Map(
  (Object.entries(SCOPE_COLLECTIONS) as [ScopeKind, string][]).map(([kind, collection]) => [
    collection,
    kind,
  ]),
);

/** The scope named by `text`, or null when it is not `organizations/ID`, `folders/ID` or `projects/ID`. */
export function parseScope(text: string): ParsedScope | null {
  const slash = text.indexOf('/');
  if (slash < 0) return null;
  const kind = KIND_BY_COLLECTION.get(text.slice(0, slash));
  const id = text.slice(slash + 1);
  if (kind === undefined || id.length === 0 || id.length > MAX_ID_LENGTH) return null;
  const valid = kind === 'project' ? isProjectRef(id) : NumericIdSchema.safeParse(id).success;
  return valid ? { kind, id, name: `${SCOPE_COLLECTIONS[kind]}/${id}` } : null;
}

/** The scope's path segment for a Google URL (the id percent-encoded, as a domain-scoped id has a colon). */
export function scopePath(scope: ParsedScope): string {
  return `${SCOPE_COLLECTIONS[scope.kind]}/${encodeURIComponent(scope.id)}`;
}

export const SCOPE_FORMAT_MESSAGE = 'must be organizations/ID, folders/ID or projects/ID_OR_NUMBER';

/** A scope in a request body; parses to {@link ParsedScope}. The message never echoes the value. */
export const ScopeNameSchema = z
  .string()
  .max(MAX_ID_LENGTH + 'organizations/'.length)
  .transform((text, context) => {
    const scope = parseScope(text);
    if (scope === null) {
      context.addIssue({ code: 'custom', message: SCOPE_FORMAT_MESSAGE });
      return z.NEVER;
    }
    return scope;
  });

/** A project id (or number) to send as the quota project (`x-goog-user-project`). */
export const QuotaProjectSchema = z
  .string()
  .max(MAX_ID_LENGTH)
  .refine(isProjectRef, 'must be a project id or number');
