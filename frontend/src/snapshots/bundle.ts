// SPDX-License-Identifier: MIT
/**
 * The snapshot file gcportrait exports and imports: a `.gcportrait.json` bundle (frontend/README.md, "Snapshots").
 * One JSON object whose `format` key comes first, so a reader can recognise it from its first bytes:
 *
 * ```json
 * {"format":"gcportrait.snapshot","version":1,"exportedAt":"2026-10-10T12:00:00.000Z","generator":"gcportrait",
 *  "snapshot":{…a model Snapshot…},"history":{…optional…}}
 * ```
 *
 * A bundle carries no non-affiliation line: the statement goes in footers and long-form texts, never with an exported
 * file (ADR 0018). Bundles written before 2026-10-12 have a `notice` key with the short line; the reader ignores it,
 * as it ignores every key it does not read.
 *
 * `snapshot` is the model's Snapshot (read back through `migrateSnapshot`, so its own `schemaVersion` migrates
 * as the model's policy says); `history`, present for demo organisations, is their 35-day history as a base and
 * daily mutations (`DemoHistory` of `@gcportrait/demo-data`). A bundle written by `bundleParts` and read by
 * `parseBundle` (worker/parse.ts, which only the worker loads) gives back the same snapshot and history
 * (worker/parse.test.ts). Raw Cloud Asset Inventory NDJSON is imported too (worker/handler.ts) but never written:
 * it would lose the scope and the read time. This module is the page's half: names and writing, no schemas.
 */
import { WORDMARK } from '../branding';
import { fileNamePart, readTimePart } from '../export/fileName';

export const BUNDLE_FORMAT = 'gcportrait.snapshot';
export const BUNDLE_VERSION = 1;
export const BUNDLE_EXTENSION = '.gcportrait.json';

/** What a bundle file starts with (after an optional byte-order mark and white space). */
const BUNDLE_START = /^\uFEFF?\s*\{\s*"format"\s*:\s*"gcportrait\.snapshot"/;

/** Whether a file is a bundle: by its name, or by its first bytes (`head`, a few hundred characters). */
export function isBundle(name: string, head: string): boolean {
  return name.toLowerCase().endsWith(BUNDLE_EXTENSION) || BUNDLE_START.test(head);
}

/** `gcportrait_example.com_20261008T000000Z.gcportrait.json`, named like the diagram's exports. */
export function bundleFileName(scope: string, readTime: string): string {
  return `${[WORDMARK, fileNamePart(scope, 'scope'), readTimePart(readTime)].join('_')}${BUNDLE_EXTENSION}`;
}

/**
 * The bundle as Blob parts around the snapshot's and the history's JSON, which are passed through unparsed (a
 * stored record's documents are already JSON): `new Blob(bundleParts(…))` is the file.
 */
export function bundleParts(exportedAt: string, snapshot: Blob, history?: Blob): BlobPart[] {
  const head = JSON.stringify({
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    exportedAt,
    generator: WORDMARK,
  });
  const parts: BlobPart[] = [`${head.slice(0, -1)},"snapshot":`, snapshot];
  if (history !== undefined) parts.push(',"history":', history);
  parts.push('}');
  return parts;
}
