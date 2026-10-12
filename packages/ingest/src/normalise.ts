// SPDX-License-Identifier: MIT
/**
 * One Cloud Asset Inventory asset (content type RESOURCE), turned into a model {@link Asset}
 * (the model's `AssetSchema`): `name`, `assetType`, `ancestors` and `updateTime` are kept as they are,
 * `resource.parent`, `resource.location` and `resource.data` move to the top level, and everything else
 * (`resource.version`, the discovery fields, …) is dropped. `data` is passed on by reference, never copied
 * or changed. The model's `AssetSchema` is the judge of what is valid.
 *
 * The asset envelope comes in two key styles. `assets.list` answers in the API's JSON (camelCase:
 * `assetType`, `updateTime`), while the NDJSON files that `exportAssets` writes to Cloud Storage keep the
 * protobuf field names (snake_case: `asset_type`, `update_time`, `resource.discovery_document_uri`). Both are
 * read; `resource.parent`, `resource.data`, `resource.location`, `name` and `ancestors` are spelled the same
 * in both, and `data` itself is the resource's own API JSON either way.
 */
import { AssetSchema, type Asset } from '@gcportrait/model';

/** The outcome of {@link normaliseAsset}. */
export type NormaliseResult =
  { readonly ok: true; readonly asset: Asset } | { readonly ok: false; readonly message: string };

/** A plain JSON object (not an array, not null). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** An envelope field read in either key style, and which spelling it was found under (for messages). */
type EnvelopeField =
  | { readonly ok: true; readonly spelling: 'camel' | 'snake' | 'absent'; readonly value: unknown }
  | { readonly ok: false; readonly message: string };

/**
 * Reads a top-level field that `assets.list` spells `camel` and an export file spells `snake`. An asset that
 * carries both with different values is ambiguous and reported.
 */
function envelopeField(raw: Record<string, unknown>, camel: string, snake: string): EnvelopeField {
  const camelValue = raw[camel];
  const snakeValue = raw[snake];
  if (camelValue === undefined) {
    return { ok: true, spelling: snakeValue === undefined ? 'absent' : 'snake', value: snakeValue };
  }
  if (snakeValue !== undefined && snakeValue !== camelValue) {
    return { ok: false, message: `${camel}, ${snake}: the two spellings disagree.` };
  }
  return { ok: true, spelling: 'camel', value: camelValue };
}

/**
 * Normalises one raw asset, in either key style. Missing `ancestors` become `[]`; a missing, `null` or empty
 * `resource.parent` or `resource.location` is left out; a missing `resource` or `resource.data` becomes
 * `data: null`. Anything else that does not fit the model `Asset` (a missing name, a malformed asset type or
 * timestamp, an ancestor that is not `projects/…`, `folders/…` or `organizations/…`) is reported, never
 * repaired.
 */
export function normaliseAsset(raw: unknown): NormaliseResult {
  if (!isRecord(raw)) return { ok: false, message: 'An asset must be a JSON object.' };
  const resource = raw['resource'];
  if (resource !== undefined && resource !== null && !isRecord(resource)) {
    return { ok: false, message: 'resource: must be an object.' };
  }
  const assetType = envelopeField(raw, 'assetType', 'asset_type');
  if (!assetType.ok) return assetType;
  const updateTime = envelopeField(raw, 'updateTime', 'update_time');
  if (!updateTime.ok) return updateTime;
  const candidate: Record<string, unknown> = {
    name: raw['name'],
    assetType: assetType.value,
    ancestors: raw['ancestors'] ?? [],
    updateTime: updateTime.value,
    data: resource?.['data'] ?? null,
  };
  const parent = resource?.['parent'];
  if (parent !== undefined && parent !== null && parent !== '') candidate['parent'] = parent;
  const location = resource?.['location'];
  if (location !== undefined && location !== null && location !== '') candidate['location'] = location;

  const parsed = AssetSchema.safeParse(candidate);
  if (parsed.success) return { ok: true, asset: parsed.data };
  // Messages name a field as the input spells it; a missing one in the style of the other envelope field.
  const snake = assetType.spelling === 'snake' || updateTime.spelling === 'snake';
  const keys: ReadonlyMap<string, string> = new Map([
    ['assetType', snake && assetType.spelling !== 'camel' ? 'asset_type' : 'assetType'],
    ['updateTime', snake && updateTime.spelling !== 'camel' ? 'update_time' : 'updateTime'],
    ['parent', 'resource.parent'],
    ['location', 'resource.location'],
    ['data', 'resource.data'],
  ]);
  return { ok: false, message: describeIssue(parsed.error.issues, keys) };
}

/** `field.path: message` for the first schema issue, naming the field as the input spelled it. */
function describeIssue(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
  keys: ReadonlyMap<string, string>,
): string {
  const [issue = { path: [], message: 'does not match the Asset schema.' }] = issues;
  const path = issue.path.map(String);
  const renamed = keys.get(path[0] ?? '');
  if (renamed !== undefined) path[0] = renamed;
  return `${path.length === 0 ? 'asset' : path.join('.')}: ${issue.message}`;
}

const PROJECT_ANCESTOR_PREFIX = 'projects/';

/**
 * The project number an asset belongs to: the first `projects/<number>` entry of its ancestors (closest
 * first). A Project asset's own number is its first ancestor. Organisations and folders have none.
 */
export function projectNumberOf(asset: Pick<Asset, 'ancestors'>): string | undefined {
  for (const ancestor of asset.ancestors) {
    if (ancestor.startsWith(PROJECT_ANCESTOR_PREFIX)) {
      const number = ancestor.slice(PROJECT_ANCESTOR_PREFIX.length);
      if (isProjectNumber(number)) return number;
    }
  }
  return undefined;
}

/** A project number: decimal digits, no sign, no leading zero. Project ids always start with a letter. */
export function isProjectNumber(value: string): boolean {
  return /^[1-9][0-9]*$/.test(value);
}
