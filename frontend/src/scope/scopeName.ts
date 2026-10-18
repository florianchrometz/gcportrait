// SPDX-License-Identifier: Apache-2.0
/**
 * Scope names as the person types them and as the backend takes them (skill cai-ingestion §1): `organizations/ID`,
 * `folders/ID`, `projects/ID_OR_NUMBER`. Zod-free (the UI thread ships no zod): the two patterns repeat
 * `NUMERIC_ID_PATTERN` and `PROJECT_REF_PATTERN` of `@gcportrait/model`, and scopeName.test.ts checks them against the
 * model's schemas, so they cannot drift. The backend validates again (backend/src/upstream/scope.ts).
 */

import {
  NUMERIC_ID_PATTERN,
  PROJECT_REF_PATTERN,
  SCOPE_COLLECTIONS,
  SCOPE_KINDS,
  isProjectRef as modelIsProjectRef,
  type ScopeKind,
} from '@gcportrait/model';

export type { ScopeKind };

/** A scope the person picked: from the search, from the recent list, or typed. */
export interface ScopeChoice {
  readonly kind: ScopeKind;
  /** `organizations/123`, `folders/456`, `projects/my-project`. */
  readonly scope: string;
  /** The organisation or folder number, the project id (or number). */
  readonly id: string;
  /** What Resource Manager calls it, when known. */
  readonly displayName?: string;
  /** `organizations/…` or `folders/…`, when known. */
  readonly parent?: string;
}

export { SCOPE_KINDS };

export const COLLECTION_OF = SCOPE_COLLECTIONS;

/** Singular and plural nouns, for labels and group headings. */
export const KIND_LABELS: Readonly<Record<ScopeKind, { readonly one: string; readonly many: string }>> = {
  organization: { one: 'Organisation', many: 'Organisations' },
  folder: { one: 'Folder', many: 'Folders' },
  project: { one: 'Project', many: 'Projects' },
};

/** `@gcportrait/model`'s NUMERIC_ID_PATTERN: an organisation or folder number. */
export const NUMBER_PATTERN = NUMERIC_ID_PATTERN;
/** `@gcportrait/model`'s PROJECT_REF_PATTERN: a project id, a domain-scoped id or a project number. */
export { PROJECT_REF_PATTERN };

const MAX_ID_LENGTH = 100;

/** Whether text is a project id or number the backend accepts as a quota project. */
export function isProjectRef(text: string): boolean {
  return text.length <= MAX_ID_LENGTH && modelIsProjectRef(text);
}

/** The scope named by `text` (surrounding spaces ignored), or null. */
export function parseScopeName(text: string): ScopeChoice | null {
  const trimmed = text.trim();
  const slash = trimmed.indexOf('/');
  if (slash < 0) return null;
  const collection = trimmed.slice(0, slash);
  const id = trimmed.slice(slash + 1);
  const kind = SCOPE_KINDS.find((candidate) => COLLECTION_OF[candidate] === collection);
  if (kind === undefined || id.length === 0 || id.length > MAX_ID_LENGTH) return null;
  const valid = kind === 'project' ? PROJECT_REF_PATTERN.test(id) : NUMBER_PATTERN.test(id);
  return valid ? { kind, scope: `${collection}/${id}`, id } : null;
}

/**
 * What is wrong with text the person seems to be typing as a scope name (it starts like one), for the picker's
 * hint; null when it is a valid name or does not look like one (then it is search text).
 */
export function scopeNameProblem(text: string): string | null {
  const trimmed = text.trim();
  const slash = trimmed.indexOf('/');
  if (slash < 0) return null;
  if (parseScopeName(trimmed) !== null) return null;
  const collection = trimmed.slice(0, slash);
  const id = trimmed.slice(slash + 1);
  if (collection === 'organizations') {
    return id === ''
      ? 'Type the organisation number after the slash.'
      : 'An organisation id is a number, such as organizations/123456789012.';
  }
  if (collection === 'folders') {
    return id === ''
      ? 'Type the folder number after the slash.'
      : 'A folder id is a number, such as folders/123456789012.';
  }
  if (collection === 'projects') {
    return id === ''
      ? 'Type the project id or number after the slash.'
      : 'A project id has lower-case letters, digits and hyphens, such as projects/my-project.';
  }
  return 'A scope is organizations/ID, folders/ID or projects/ID.';
}

/** A one-line description of a scope: "Demo app 1 (projects/demo-app-1)", or the name alone. */
export function describeScope(choice: Pick<ScopeChoice, 'scope' | 'displayName'>): string {
  return choice.displayName === undefined || choice.displayName === choice.scope
    ? choice.scope
    : `${choice.displayName} (${choice.scope})`;
}
