// SPDX-License-Identifier: MIT
/**
 * The real catalog's data files and its fixture assets, for the tests that run the real data (not a command-line
 * tool): the sources as the loader reads them, every fixture asset parsed, and the project index they make.
 */
import { AssetSchema, buildProjectIndex, type Asset } from '@gcportrait/model';
import { loadSources } from './files.js';

export const sources = loadSources();

/** Every asset of every fixture file, in file order. */
export const fixtures: Asset[] = sources.fixtures.flatMap((file) =>
  (Array.isArray(file.content) ? (file.content as unknown[]) : [file.content]).map((item) =>
    AssetSchema.parse(item),
  ),
);

/** The rule engine's context over the fixtures: the demo projects' ids and numbers. */
export const ctx = { projects: buildProjectIndex(fixtures) };

/** The fixture asset with this full resource name. */
export function fixtureNamed(name: string): Asset {
  const found = fixtures.find((asset) => asset.name === name);
  if (found === undefined) throw new Error(`no fixture ${name}`);
  return found;
}

/** The first fixture asset of a type. */
export function firstFixtureOf(assetType: string): Asset {
  const found = fixtures.find((asset) => asset.assetType === assetType);
  if (found === undefined) throw new Error(`no fixture of ${assetType}`);
  return found;
}
