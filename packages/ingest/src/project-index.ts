// SPDX-License-Identifier: Apache-2.0
/**
 * Project numbers and project ids, matched up. Cloud Asset Inventory puts project *numbers* in `ancestors`
 * and `resource.parent`, while Compute names and self-links (and many other names) use project *ids*.
 *
 * The pairs are the model's `ProjectIndex`, built by the model's one pairing rule (`projectIndexBuilder` in
 * `@gcportrait/model`, the same code `buildProjectIndex` runs over a stored snapshot): only
 * `cloudresourcemanager.googleapis.com/Project` assets pair a number with an id, in snapshot order; the
 * number is the one in the asset name (`…/projects/<number>`), else `data.projectNumber`; the id is
 * `data.projectId`; a number or id that is already paired keeps its first pairing, so the two records stay
 * exact inverses. Ingest builds it once over the kept assets of a snapshot, so `report.projects` always
 * equals `buildProjectIndex(snapshot.assets)`.
 *
 * Everything the rule leaves unpaired is reported next to the index, as {@link UnresolvedProjects}: project
 * numbers in ancestors and parents, project ids in Compute asset names, and the project of every Compute
 * self-link anywhere inside `data` (`https://www.googleapis.com/compute/v1/projects/<id>/…`). A Compute asset
 * whose name carries an id and whose closest ancestor carries a number suggests a pair; such suggestions are
 * listed as hints (`inferred`) and never enter the index.
 */
import {
  ProjectRefSchema,
  projectIndexBuilder,
  type Asset,
  type ProjectIndex,
  type ProjectIndexBuilder,
} from '@gcportrait/model';
import { isProjectNumber, projectNumberOf } from './normalise.js';
import { compareDecimal, compareText } from './order.js';

/** What the project index could not pair, for the report (plain data: sorted lists and a sorted record). */
export interface UnresolvedProjects {
  /**
   * Project numbers seen in ancestors, parents, Project assets and Compute names or self-links that the
   * index has no id for: typically the projects of an export filtered by asset type (no Project assets).
   */
  readonly numbers: readonly string[];
  /**
   * Project ids of assets in the snapshot (the id in a Compute asset name, or a Project asset's id that lost
   * a conflicting claim) that the index has no number for.
   */
  readonly ids: readonly string[];
  /**
   * Project ids that only Compute self-links inside `data` refer to, outside the snapshot: a Shared VPC host
   * project outside the scope, public image projects (boot images and licences), service producers' tenant
   * projects (private services access peerings).
   */
  readonly referencedIds: readonly string[];
  /**
   * Likely ids for some of `numbers`, number → id: a Compute asset named `…/projects/<id>/…` whose closest
   * ancestor is `projects/<number>`. Hints for display only; they are never part of the index.
   */
  readonly inferred: Readonly<Record<string, string>>;
}

/** The project index of a snapshot, and what it leaves unresolved. */
export interface ProjectSummary {
  readonly index: ProjectIndex;
  readonly unresolved: UnresolvedProjects;
}

const PROJECT_TYPE = 'cloudresourcemanager.googleapis.com/Project';
const PROJECT_NAME_PREFIX = '//cloudresourcemanager.googleapis.com/projects/';
const COMPUTE_NAME_PREFIX = '//compute.googleapis.com/projects/';
/** The project segment of a Compute self-link: `…/compute/v1/projects/<id>/…` (also `beta` and `alpha`). */
const SELF_LINK_PROJECT = /\/compute\/(?:v1|beta|alpha)\/projects\/([^/\s"'\\]+)\//g;
const SELF_LINK_MARKER = '/compute/';

type RefKind = 'number' | 'id' | 'other';

function classifyRef(ref: string): RefKind {
  if (isProjectNumber(ref)) return 'number';
  return ProjectRefSchema.safeParse(ref).success ? 'id' : 'other';
}

/** Collects pairs, numbers and ids asset by asset; {@link Collector.summary} sorts them into the result. */
class Collector {
  /** The pairs, by the model's rule. */
  readonly #pairs: ProjectIndexBuilder = projectIndexBuilder();
  readonly #numbers = new Set<string>();
  /** Ids of projects that assets in the snapshot live in. */
  readonly #ids = new Set<string>();
  /** Ids that self-links refer to. */
  readonly #referenced = new Set<string>();
  /** number → id suggested by Compute names, first one wins. */
  readonly #hints = new Map<string, string>();
  /** `projects/<ref>` segments already classified: the same few refs recur in thousands of self-links. */
  readonly #kinds = new Map<string, RefKind>();

  add(asset: Asset): void {
    const number = projectNumberOf(asset);
    if (number !== undefined) this.#numbers.add(number);
    if (asset.parent?.startsWith(PROJECT_NAME_PREFIX) === true) {
      this.#addRef(asset.parent.slice(PROJECT_NAME_PREFIX.length), this.#ids);
    }
    if (asset.assetType === PROJECT_TYPE) this.#addProject(asset);
    if (asset.name.startsWith(COMPUTE_NAME_PREFIX)) {
      const ref = firstSegment(asset.name.slice(COMPUTE_NAME_PREFIX.length));
      if (this.#addRef(ref, this.#ids) === 'id' && number !== undefined && !this.#hints.has(number)) {
        this.#hints.set(number, ref);
      }
    }
    this.#scanSelfLinks(asset.data);
  }

  summary(): ProjectSummary {
    const index = this.#pairs.index();
    const hasNumber = (number: string): boolean => Object.hasOwn(index.idByNumber, number);
    const hasId = (id: string): boolean => Object.hasOwn(index.numberById, id);
    const ids = [...this.#ids].filter((id) => !hasId(id));
    const owned = new Set(ids);
    const inferred = new Map<string, string>();
    const suggested = new Set<string>();
    for (const [number, id] of this.#hints) {
      if (hasNumber(number) || hasId(id) || suggested.has(id)) continue;
      inferred.set(number, id);
      suggested.add(id);
    }
    return {
      index,
      unresolved: {
        numbers: [...this.#numbers].filter((number) => !hasNumber(number)).sort(compareDecimal),
        ids: ids.sort(compareText),
        referencedIds: [...this.#referenced].filter((id) => !hasId(id) && !owned.has(id)).sort(compareText),
        inferred: sortedRecord(inferred, compareDecimal),
      },
    };
  }

  #addProject(asset: Asset): void {
    const { number, id } = this.#pairs.add(asset);
    if (number !== undefined) this.#numbers.add(number);
    if (id !== undefined) this.#ids.add(id);
  }

  /** Records a `projects/<ref>` segment as a number, or as an id in `ids`, and says which it was. */
  #addRef(ref: string, ids: Set<string>): RefKind {
    let kind = this.#kinds.get(ref);
    if (kind === undefined) {
      kind = classifyRef(ref);
      this.#kinds.set(ref, kind);
    }
    if (kind === 'number') this.#numbers.add(ref);
    else if (kind === 'id') ids.add(ref);
    return kind;
  }

  /** Walks `data` (any depth, without recursion) and records the project of every Compute self-link in it. */
  #scanSelfLinks(data: unknown): void {
    const stack: unknown[] = [data];
    while (stack.length > 0) {
      const value = stack.pop();
      if (typeof value === 'string') {
        if (value.includes(SELF_LINK_MARKER)) {
          for (const match of value.matchAll(SELF_LINK_PROJECT)) {
            if (match[1] !== undefined) this.#addRef(match[1], this.#referenced);
          }
        }
      } else if (typeof value === 'object' && value !== null) {
        if (Array.isArray(value)) {
          for (const item of value as readonly unknown[]) stack.push(item);
        } else {
          const record = value as Record<string, unknown>;
          for (const key in record) stack.push(record[key]);
        }
      }
    }
  }
}

/** The project index of a snapshot's assets (in snapshot order) and what it leaves unresolved. */
export function summariseProjects(assets: Iterable<Asset>): ProjectSummary {
  const collector = new Collector();
  for (const asset of assets) collector.add(asset);
  return collector.summary();
}

function firstSegment(path: string): string {
  const slash = path.indexOf('/');
  return slash === -1 ? path : path.slice(0, slash);
}

function sortedRecord(
  entries: ReadonlyMap<string, string>,
  compare: (left: string, right: string) => number,
): Record<string, string> {
  return Object.fromEntries([...entries].sort(([left], [right]) => compare(left, right)));
}
