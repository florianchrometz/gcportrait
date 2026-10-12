// SPDX-License-Identifier: MIT
// @ts-check
/**
 * Reads the icon keys the asset catalog uses straight from its data files: the `icon` of every product file
 * (`packages/catalog/products/*.yaml`) and of every type in it, and the keys listed in
 * `packages/catalog/icon-keys.json`. The icons package reads the files rather than importing
 * `@gcportrait/catalog`, which packages other than graph may not import (eslint.config.js).
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

/** The icons package directory. */
export const PACKAGE_DIR = fileURLToPath(new URL('../..', import.meta.url));

/** The catalog package directory, next to this one. */
export const CATALOG_DIR = path.join(PACKAGE_DIR, '..', 'catalog');

/**
 * @typedef {object} CatalogIconUse
 * @property {string} key the icon key
 * @property {string} file the product file, relative to the catalog package
 * @property {string} where `icon` (the product's) or `types.<asset type>.icon`
 */

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Every icon key a product file uses, with where it is used, in file and type order.
 * @param {string} [catalogDir]
 * @returns {CatalogIconUse[]}
 */
export function catalogIconUses(catalogDir = CATALOG_DIR) {
  const productsDir = path.join(catalogDir, 'products');
  /** @type {CatalogIconUse[]} */
  const uses = [];
  const files = readdirSync(productsDir)
    .filter((name) => name.endsWith('.yaml'))
    .sort();
  for (const name of files) {
    const file = `products/${name}`;
    /** @type {unknown} */
    const document = parse(readFileSync(path.join(productsDir, name), 'utf8'));
    if (!isRecord(document)) continue;
    if (typeof document.icon === 'string') uses.push({ key: document.icon, file, where: 'icon' });
    const types = document.types;
    if (!isRecord(types)) continue;
    for (const [assetType, entry] of Object.entries(types)) {
      if (isRecord(entry) && typeof entry.icon === 'string') {
        uses.push({ key: entry.icon, file, where: `types.${assetType}.icon` });
      }
    }
  }
  return uses;
}

/**
 * The keys listed in `packages/catalog/icon-keys.json`.
 * @param {string} [catalogDir]
 * @returns {string[]}
 */
export function catalogIconKeyList(catalogDir = CATALOG_DIR) {
  /** @type {unknown} */
  const document = JSON.parse(readFileSync(path.join(catalogDir, 'icon-keys.json'), 'utf8'));
  if (!isRecord(document) || !Array.isArray(document.keys))
    throw new Error('icon-keys.json has no "keys" list');
  return document.keys.map((key) => {
    if (typeof key !== 'string') throw new Error('icon-keys.json lists a key that is not a string');
    return key;
  });
}

/**
 * The union of the keys the product files use and the keys `icon-keys.json` lists, sorted.
 * @param {string} [catalogDir]
 * @returns {string[]}
 */
export function catalogIconKeys(catalogDir = CATALOG_DIR) {
  const keys = new Set([
    ...catalogIconUses(catalogDir).map((use) => use.key),
    ...catalogIconKeyList(catalogDir),
  ]);
  return [...keys].sort();
}

/**
 * @typedef {object} CatalogProduct
 * @property {string} product the product's display name (`product` of its file)
 * @property {string} key the product's icon key
 */

/**
 * Every product name with its icon key, one per distinct pair, in file order: what the drift check matches the
 * name of a new upstream icon against.
 * @param {string} [catalogDir]
 * @returns {CatalogProduct[]}
 */
export function catalogProducts(catalogDir = CATALOG_DIR) {
  const productsDir = path.join(catalogDir, 'products');
  /** @type {Map<string, CatalogProduct>} */
  const products = new Map();
  for (const name of readdirSync(productsDir)
    .filter((file) => file.endsWith('.yaml'))
    .sort()) {
    /** @type {unknown} */
    const document = parse(readFileSync(path.join(productsDir, name), 'utf8'));
    if (!isRecord(document) || typeof document.product !== 'string' || typeof document.icon !== 'string')
      continue;
    const pair = { product: document.product, key: document.icon };
    products.set(`${pair.product}\u0000${pair.key}`, pair);
  }
  return [...products.values()];
}
