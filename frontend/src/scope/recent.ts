// SPDX-License-Identifier: MIT
/**
 * What the scope picker remembers in this browser's preferences (IndexedDB, `storage/preferences.ts`): the scopes
 * picked most recently, and the quota project last picked for each scope (the last pick per scope is
 * remembered in the preferences). Ids and display names only, never a token or an email. Values are
 * checked on every read, so a stale or hand-edited entry is dropped instead of breaking the picker.
 */
import { isProjectRef, parseScopeName, type ScopeChoice } from './scopeName';

/** How many recent scopes are kept. */
export const MAX_RECENT_SCOPES = 8;

/** Quota projects remembered, for as many scopes. */
export const MAX_QUOTA_PROJECTS = 50;

const MAX_DISPLAY_NAME = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** One stored entry as a ScopeChoice, or null when it is not one. */
function recentOf(value: unknown): ScopeChoice | null {
  if (!isRecord(value) || typeof value.scope !== 'string') return null;
  const parsed = parseScopeName(value.scope);
  if (parsed === null || parsed.scope !== value.scope) return null;
  const displayName =
    typeof value.displayName === 'string' && value.displayName.length <= MAX_DISPLAY_NAME
      ? value.displayName
      : undefined;
  const parent =
    typeof value.parent === 'string' && /^(?:organizations|folders)\/[1-9][0-9]*$/.test(value.parent)
      ? value.parent
      : undefined;
  return {
    ...parsed,
    ...(displayName === undefined ? {} : { displayName }),
    ...(parent === undefined ? {} : { parent }),
  };
}

/** The `recentScopes` preference, checked: valid entries only, no repeats, at most MAX_RECENT_SCOPES. */
export function parseRecentScopes(value: unknown): readonly ScopeChoice[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<string>();
  const result: ScopeChoice[] = [];
  for (const entry of value) {
    const choice = recentOf(entry);
    if (choice === null || seen.has(choice.scope)) continue;
    seen.add(choice.scope);
    result.push(choice);
    if (result.length >= MAX_RECENT_SCOPES) break;
  }
  return result;
}

/** The list with `choice` first (moved there if it was already in it), cut to MAX_RECENT_SCOPES. */
export function withRecent(list: readonly ScopeChoice[], choice: ScopeChoice): readonly ScopeChoice[] {
  const entry: ScopeChoice = {
    kind: choice.kind,
    scope: choice.scope,
    id: choice.id,
    ...(choice.displayName === undefined ? {} : { displayName: choice.displayName }),
    ...(choice.parent === undefined ? {} : { parent: choice.parent }),
  };
  return [entry, ...list.filter((item) => item.scope !== choice.scope)].slice(0, MAX_RECENT_SCOPES);
}

/** The `quotaProjects` preference (scope → project), checked. */
export function parseQuotaProjects(value: unknown): Readonly<Record<string, string>> | undefined {
  if (!isRecord(value)) return undefined;
  const result: Record<string, string> = {};
  let count = 0;
  for (const [scope, project] of Object.entries(value)) {
    if (parseScopeName(scope)?.scope !== scope || typeof project !== 'string' || !isProjectRef(project))
      continue;
    result[scope] = project;
    count += 1;
    if (count >= MAX_QUOTA_PROJECTS) break;
  }
  return result;
}

/** The map with `project` remembered for `scope` (or forgotten, for null), newest last, cut to the cap. */
export function withQuotaProject(
  map: Readonly<Record<string, string>>,
  scope: string,
  project: string | null,
): Readonly<Record<string, string>> {
  const entries = Object.entries(map).filter(([key]) => key !== scope);
  if (project !== null) entries.push([scope, project]);
  return Object.fromEntries(entries.slice(-MAX_QUOTA_PROJECTS));
}
