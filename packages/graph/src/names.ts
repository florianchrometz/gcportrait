// SPDX-License-Identifier: MIT
/**
 * Canonical name matching (AGENTS.md, Data and graph semantics). Cloud Asset Inventory names some services'
 * assets with the project id and others with the project number, and references are written in whichever
 * form the user typed or the API returned. The builder never rewrites an asset name; instead a reference
 * that matches no node is tried once more with its project segment swapped through the snapshot's project
 * index (number → id, or id → number), and the edge records which form matched. A reference that matches
 * neither way stays dangling with the value as read.
 */
import type { ProjectIndex } from '@gcportrait/model';

/** The form the matched name spells its project in, when the reference spelled it the other way. */
export type ProjectForm = 'id' | 'number';

/** A reference resolved to a node, and how. */
export interface NameMatch {
  readonly id: string;
  /** Present when the match needed the project segment swapped: the form of the matched name. */
  readonly matchedProject?: ProjectForm;
}

/** Where the first `projects/<ref>` segment of a full resource name starts and ends (after the service). */
function projectSpan(name: string): { start: number; end: number } | undefined {
  if (!name.startsWith('//')) return undefined;
  const serviceEnd = name.indexOf('/', 2);
  if (serviceEnd === -1) return undefined;
  const marker = name.indexOf('/projects/', serviceEnd);
  if (marker === -1) return undefined;
  const start = marker + '/projects/'.length;
  const slash = name.indexOf('/', start);
  const end = slash === -1 ? name.length : slash;
  return end > start ? { start, end } : undefined;
}

/**
 * The same name with its first project segment in the other form (an id for a number the index knows, a
 * number for an id it knows), or undefined when there is no project segment or the index cannot translate it.
 */
export function swapProject(
  name: string,
  projects: ProjectIndex,
): { readonly name: string; readonly form: ProjectForm } | undefined {
  const span = projectSpan(name);
  if (span === undefined) return undefined;
  const ref = name.slice(span.start, span.end);
  const id = Object.hasOwn(projects.idByNumber, ref) ? projects.idByNumber[ref] : undefined;
  const number = Object.hasOwn(projects.numberById, ref) ? projects.numberById[ref] : undefined;
  const swapped = id ?? number;
  if (swapped === undefined) return undefined;
  return {
    name: `${name.slice(0, span.start)}${swapped}${name.slice(span.end)}`,
    form: id === undefined ? 'number' : 'id',
  };
}

/**
 * A resolver from a full resource name to a node: the name itself when it is a node, else the name with its
 * project segment swapped (one swap, either direction), else nothing.
 */
export function nameResolver(
  isNode: (id: string) => boolean,
  projects: ProjectIndex,
): (name: string) => NameMatch | undefined {
  return (name) => {
    if (isNode(name)) return { id: name };
    const swapped = swapProject(name, projects);
    return swapped !== undefined && isNode(swapped.name)
      ? { id: swapped.name, matchedProject: swapped.form }
      : undefined;
  };
}
