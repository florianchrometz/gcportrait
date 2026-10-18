// SPDX-License-Identifier: Apache-2.0
/**
 * The builder's memo: what the builder works out for one asset on its own — its node, and the
 * relations, `nestsIn` containers and `contains` children its type's rules produce — kept by the asset object. A
 * caller that builds the Graphs of several days of one history, whose unchanged assets are the same objects (the
 * app's data worker and its timeline days), evaluates the catalog's rules once per asset instead of once per day.
 *
 * The rules read nothing but the asset, its catalog entry and the snapshot's project index (`RuleContext`), so an
 * entry holds while the build's catalog is the same object and its project index has the same content; a build
 * with another catalog or another index starts the memo empty. Assets are never changed after they are read, and
 * the builder never changes what it keeps here (its nodes are replaced, not edited), so a build with a memo is
 * deep-equal to a build without one (build.property.test.ts). The entries are held weakly: an asset no snapshot
 * holds any more takes its entry with it.
 */
import type { ContainedChildren } from '@gcportrait/catalog';
import type {
  Asset,
  Catalog,
  EvaluatedNesting,
  EvaluatedRelation,
  GraphNode,
  ProjectIndex,
} from '@gcportrait/model';

/** What the builder works out for one asset from the asset, its catalog entry and the project index. */
export interface AssetFacts {
  readonly node: GraphNode;
  readonly relations: readonly EvaluatedRelation[];
  /** The `nestsIn` rules' targets; undefined for a type without such rules. */
  readonly nestsIn: readonly EvaluatedNesting[] | undefined;
  /** A container's `contains` rules; undefined for anything else. */
  readonly contains: ContainedChildren | undefined;
}

/** Two project indexes with the same pairs. */
function sameIndex(a: ProjectIndex, b: ProjectIndex): boolean {
  if (a === b) return true;
  const sameRecord = (x: Readonly<Record<string, string>>, y: Readonly<Record<string, string>>): boolean => {
    const keys = Object.keys(x);
    if (keys.length !== Object.keys(y).length) return false;
    return keys.every((key) => Object.hasOwn(y, key) && y[key] === x[key]);
  };
  return sameRecord(a.numberById, b.numberById) && sameRecord(a.idByNumber, b.idByNumber);
}

/**
 * A memo for `buildGraph` and `buildGraphWithReport` (`BuildOptions.memo`): one per caller, used for every build
 * whose assets may repeat. It changes no result, only how long a build takes.
 */
export class BuildMemo {
  #catalog: Catalog | null = null;
  #projects: ProjectIndex | null = null;
  #facts = new WeakMap<Asset, AssetFacts>();

  /** The entries that hold for a build with `catalog` and `projects`; emptied when either differs from before. */
  factsFor(catalog: Catalog, projects: ProjectIndex): WeakMap<Asset, AssetFacts> {
    if (this.#catalog !== catalog || this.#projects === null || !sameIndex(this.#projects, projects)) {
      this.#catalog = catalog;
      this.#facts = new WeakMap();
    }
    this.#projects = projects;
    return this.#facts;
  }
}
