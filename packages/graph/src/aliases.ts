// SPDX-License-Identifier: Apache-2.0
/**
 * The alias index: names an asset is referenced by besides its full resource name. Relation rules hand the
 * builder an alias when the referenced value names no asset by itself (`RelationTarget` `{ by: 'alias' }`).
 *
 * - Every catalog type's `aliases` paths (an IAM service account's `$.data.email`, say) → the asset, keyed by
 *   the model's `aliasKey`, which is also how normalisers such as `serviceAccountEmail` write their aliases.
 *   The catalog says which types have aliases; the builder keeps no list of its own.
 * - Project ids and project numbers → the Resource Manager project node, from the snapshot's project index
 *   (the same pairing the catalog's normalisers translate through).
 */
import { evaluateAliases } from '@gcportrait/catalog';
import type { Asset, CatalogTypeEntry, ProjectIndex } from '@gcportrait/model';
import { PROJECT_TYPE } from './structure.js';

export interface AliasIndex {
  readonly aliases: Map<string, string>;
  /** Keys claimed by a second node; the first claim (in name order) is kept. */
  readonly conflicts: number;
}

/** Builds the alias index from assets in name order; `typeOf` is each asset's catalog entry, if any. */
export function buildAliases(
  assets: readonly Asset[],
  projects: ProjectIndex,
  typeOf: (asset: Asset) => Pick<CatalogTypeEntry, 'aliases'> | undefined,
): AliasIndex {
  const aliases = new Map<string, string>();
  let conflicts = 0;
  const claim = (key: string, id: string): void => {
    const existing = aliases.get(key);
    if (existing === undefined) aliases.set(key, id);
    else if (existing !== id) conflicts += 1;
  };
  for (const asset of assets) {
    for (const key of evaluateAliases(asset, typeOf(asset))) claim(key, asset.name);
    if (asset.assetType === PROJECT_TYPE) {
      // A project node is named by its number; its id comes from the project index.
      const number = /\/projects\/([1-9][0-9]*)$/.exec(asset.name)?.[1];
      if (number === undefined) continue;
      claim(number, asset.name);
      const id = Object.hasOwn(projects.idByNumber, number) ? projects.idByNumber[number] : undefined;
      if (id !== undefined) claim(id, asset.name);
    }
  }
  return { aliases, conflicts };
}
