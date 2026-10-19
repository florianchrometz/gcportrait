// SPDX-License-Identifier: Apache-2.0
// @ts-check
/**
 * Formats the files the icon scripts write with the repository's Prettier settings, so that `pnpm format:check`
 * accepts generated output byte for byte.
 */
import * as prettier from 'prettier';

/**
 * @param {string} filePath where the text will be written (selects the parser and the config)
 * @param {string} text
 * @returns {Promise<string>}
 */
export async function formatFile(filePath, text) {
  const config = (await prettier.resolveConfig(filePath)) ?? {};
  return prettier.format(text, { ...config, filepath: filePath });
}

/**
 * @param {string} filePath
 * @param {unknown} value
 * @returns {Promise<string>}
 */
export async function formatJson(filePath, value) {
  return formatFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
