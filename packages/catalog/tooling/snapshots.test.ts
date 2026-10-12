// SPDX-License-Identifier: MIT
/** The committed official snapshots are well-formed, and each products companion matches its list. */
import { existsSync, readFileSync } from 'node:fs';
import { AssetTypeSchema } from '@gcportrait/model';
import { describe, expect, it } from 'vitest';
import { OFFICIAL_DIR, parseProductsFile, parseSnapshotText, snapshotFiles } from './files.js';

const snapshots = snapshotFiles(OFFICIAL_DIR);

describe('the committed official snapshots', () => {
  it('exist', () => {
    expect(snapshots.length).toBeGreaterThan(0);
  });

  it.each(snapshots)('$date is sorted in byte order, unique and well-formed', ({ date, file }) => {
    const text = readFileSync(file, 'utf8');
    expect(text.split('\n')[0]).toBe(`# Cloud Asset Inventory supported asset types, snapshot ${date}`);
    const ids = parseSnapshotText(text);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids).toEqual([...new Set(ids)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    for (const id of ids) expect(AssetTypeSchema.safeParse(id).success, id).toBe(true);
  });

  it.each(snapshots)('$date has a products companion that lists exactly its types, if any', ({ file }) => {
    const companion = file.replace(/\.txt$/, '.products.json');
    if (!existsSync(companion)) return;
    const productOf = parseProductsFile(JSON.parse(readFileSync(companion, 'utf8')) as unknown);
    expect([...productOf.keys()].sort()).toEqual([...parseSnapshotText(readFileSync(file, 'utf8'))].sort());
  });
});
