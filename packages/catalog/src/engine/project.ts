// SPDX-License-Identifier: Apache-2.0
/**
 * Project ids and numbers. Cloud Asset Inventory puts project numbers into `parent` and `ancestors`, Compute
 * names and self-links use project ids, and newer APIs mostly use numbers in their names. The snapshot's
 * `ProjectIndex` (`@gcportrait/model`, built by its `buildProjectIndex`) maps one to the other; this module
 * answers "which project is this asset in" for templates and normalisers.
 */
import { isNumericId, isProjectRef, type Asset, type ProjectIndex } from '@gcportrait/model';

/** An index that knows no project. */
export const EMPTY_PROJECT_INDEX: ProjectIndex = Object.freeze({
  numberById: Object.freeze({}),
  idByNumber: Object.freeze({}),
});

/** A project reference, resolved as far as the index allows. */
export interface ProjectRef {
  readonly id?: string;
  readonly number?: string;
}

/** Resolves a project id or number (with or without `projects/`) through the index. */
export function resolveProject(ref: string, index: ProjectIndex): ProjectRef {
  const value = ref.startsWith('projects/') ? ref.slice('projects/'.length) : ref;
  if (isNumericId(value)) {
    const id = Object.hasOwn(index.idByNumber, value) ? index.idByNumber[value] : undefined;
    return id === undefined ? { number: value } : { id, number: value };
  }
  if (!isProjectRef(value)) return {};
  const number = Object.hasOwn(index.numberById, value) ? index.numberById[value] : undefined;
  return number === undefined ? { id: value } : { id: value, number };
}

/** The segment after the first `projects/` of a name, if any. */
export function projectSegment(name: string): string | undefined {
  const match = /(?:^|\/)projects\/([^/]+)/.exec(name);
  return match?.[1];
}

/**
 * The project an asset lives in: the closest `projects/…` ancestor, else the `projects/…` segment of its
 * name; completed through the index. Organisations, folders and other assets outside a project have none.
 */
export function assetProject(asset: Asset, index: ProjectIndex): ProjectRef {
  const ancestor = asset.ancestors.find((entry) => entry.startsWith('projects/'));
  const fromAncestor = ancestor === undefined ? {} : resolveProject(ancestor, index);
  const segment = projectSegment(asset.name);
  const fromName = segment === undefined ? {} : resolveProject(segment, index);
  const id = fromAncestor.id ?? fromName.id;
  const number = fromAncestor.number ?? fromName.number;
  return { ...(id === undefined ? {} : { id }), ...(number === undefined ? {} : { number }) };
}
