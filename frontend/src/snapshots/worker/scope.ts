// SPDX-License-Identifier: MIT
/**
 * The scope of an imported Cloud Asset Inventory export. An export file does not say which organisation, folder
 * or project it was taken from, but every asset's `ancestors` end at the root of its hierarchy (closest first,
 * skill cai-ingestion §2), so the root most assets share is the scope: an organisation for an organisation or
 * folder export, a project for a project without an organisation. Its display name comes from the root's own
 * Resource Manager asset when the export holds it (the organisation's `displayName`, the project's id). Files of
 * different exports imported together name several roots; `roots` counts them so the import can say so.
 */
import type { Asset, ScopeKind, SnapshotScope } from '@gcportrait/model';

const ROOT_KINDS: ReadonlyArray<readonly [prefix: string, kind: ScopeKind]> = [
  ['organizations/', 'organization'],
  ['folders/', 'folder'],
  ['projects/', 'project'],
];

const RESOURCE_MANAGER = '//cloudresourcemanager.googleapis.com/';

function stringField(data: unknown, key: string): string | undefined {
  if (typeof data !== 'object' || data === null) return undefined;
  const value = (data as Record<string, unknown>)[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

export interface InferredScope {
  /** The root most assets share, as the snapshot's scope. */
  readonly scope: SnapshotScope;
  /** How many different roots the assets name (1 for the files of one export). */
  readonly roots: number;
}

/** The scope the assets share, or undefined when none of them names an ancestor. */
export function inferScope(assets: readonly Asset[]): InferredScope | undefined {
  const counts = new Map<string, number>();
  for (const asset of assets) {
    const root = asset.ancestors.at(-1);
    if (root !== undefined) counts.set(root, (counts.get(root) ?? 0) + 1);
  }
  let best: string | undefined;
  for (const [root, count] of counts) {
    if (best === undefined || count > (counts.get(best) ?? 0) || (count === counts.get(best) && root < best))
      best = root;
  }
  if (best === undefined) return undefined;
  const root = best;
  const match = ROOT_KINDS.find(([prefix]) => root.startsWith(prefix));
  if (match === undefined) return undefined;
  const [prefix, kind] = match;
  const id = root.slice(prefix.length);
  const own = assets.find((asset) => asset.name === `${RESOURCE_MANAGER}${root}`);
  const displayName =
    kind === 'project' ? stringField(own?.data, 'projectId') : stringField(own?.data, 'displayName');
  const scope: SnapshotScope = displayName === undefined ? { kind, id } : { kind, id, displayName };
  return { scope, roots: counts.size };
}
