// SPDX-License-Identifier: Apache-2.0
/** Helpers shared by this package's tests. Not part of the public API. */
import type { Asset } from '@gcportrait/model';

/** The values at a path with `*` stepping into every array element. */
export function valuesAt(value: unknown, path: readonly string[]): unknown[] {
  if (path.length === 0) return [value];
  const [step, ...rest] = path;
  if (step === '*') return Array.isArray(value) ? value.flatMap((item) => valuesAt(item, rest)) : [];
  if (typeof value !== 'object' || value === null || Array.isArray(value) || step === undefined) return [];
  return valuesAt((value as Record<string, unknown>)[step], rest);
}

/** `a.b[*].c['d.e']` → `['a', 'b', '*', 'c', 'd.e']`. */
export function parsePath(path: string): string[] {
  const steps: string[] = [];
  for (const match of path.matchAll(/\['([^']+)'\]|\[\*\]|([^.[\]]+)/g)) {
    steps.push(match[1] ?? match[2] ?? '*');
  }
  return steps;
}

/** Problems with `parent` and `ancestors` across a set of assets; empty when consistent. */
export function hierarchyProblems(assets: readonly Asset[]): string[] {
  const byName = new Map(assets.map((asset) => [asset.name, asset]));
  const containerParent = new Map<string, string>();
  for (const asset of assets) {
    if (
      asset.assetType === 'cloudresourcemanager.googleapis.com/Folder' ||
      asset.assetType === 'cloudresourcemanager.googleapis.com/Project'
    ) {
      // Folders (v2) name their parent `organizations/N` or `folders/N`; projects (v1) as `{ type, id }`.
      const parent = (asset.data as { parent: string | { type: string; id: string } }).parent;
      containerParent.set(
        asset.name.replace('//cloudresourcemanager.googleapis.com/', ''),
        typeof parent === 'string' ? parent : `${parent.type}s/${parent.id}`,
      );
    }
  }
  const problems: string[] = [];
  // The one organisation of the set (each demo size has its own number).
  const organisation = assets
    .find((asset) => asset.assetType === 'cloudresourcemanager.googleapis.com/Organization')
    ?.name.replace('//cloudresourcemanager.googleapis.com/', '');
  if (organisation === undefined) problems.push('no organisation');
  for (const asset of assets) {
    const { ancestors } = asset;
    if (ancestors.at(-1) !== organisation) problems.push(`${asset.name}: ancestors do not end at the org`);
    for (const ancestor of ancestors) {
      if (!byName.has(`//cloudresourcemanager.googleapis.com/${ancestor}`)) {
        problems.push(`${asset.name}: ancestor ${ancestor} does not exist`);
      }
    }
    for (let i = 0; i + 1 < ancestors.length; i++) {
      const child = ancestors[i] ?? '';
      if (containerParent.get(child) !== ancestors[i + 1]) {
        problems.push(`${asset.name}: ${child} is not a child of ${ancestors[i + 1] ?? ''}`);
      }
    }
    if (asset.assetType === 'cloudresourcemanager.googleapis.com/Organization') {
      if (asset.parent !== undefined) problems.push(`${asset.name}: the organisation has a parent`);
      continue;
    }
    if (asset.parent === undefined) {
      problems.push(`${asset.name}: no parent`);
      continue;
    }
    const parent = byName.get(asset.parent);
    if (parent === undefined) {
      problems.push(`${asset.name}: parent ${asset.parent} does not exist`);
      continue;
    }
    const isContainer = /^\/\/cloudresourcemanager\.googleapis\.com\/(organizations|folders|projects)\//.test(
      parent.name,
    );
    if (isContainer) {
      const parentRef = parent.name.replace('//cloudresourcemanager.googleapis.com/', '');
      const expected = asset.assetType.startsWith('cloudresourcemanager.googleapis.com/')
        ? ancestors[1]
        : ancestors[0];
      if (expected !== parentRef)
        problems.push(`${asset.name}: parent ${parentRef} is not its closest ancestor`);
    } else if (parent.ancestors.join('/') !== ancestors.join('/')) {
      problems.push(`${asset.name}: ancestors differ from those of its parent ${parent.name}`);
    }
  }
  return problems;
}

const CONTAINER_NAME = /^\/\/cloudresourcemanager\.googleapis\.com\//;
const TABLE_NAME = /^\/\/bigquery\.googleapis\.com\/projects\/([^/]+)\/datasets\/([^/]+)\/tables\/([^/]+)$/;

/**
 * References from `present` to the assets of `absent` (at one tick: what the history creates later or has
 * already removed), as `<from> -> <to>`; empty when there are none. Catalog-free, so it reads the forms the
 * generator writes rather than every rule: a relative resource name (bare, inside a full name or a self-link,
 * or with its project id swapped for the number or back) or a prefix of one, `gs://<bucket>`, and a BigQuery
 * table as `project.dataset.table`, `project:dataset.table` or a `{ projectId, datasetId, tableId }` object.
 * Folders and projects are left to `hierarchyProblems`.
 */
export function referencesToAbsent(
  present: readonly Asset[],
  absent: readonly Asset[],
  /** Project id → number and number → id. */
  projectAliases: ReadonlyMap<string, string>,
): string[] {
  const forms = new Map<string, string>();
  for (const asset of absent) {
    if (CONTAINER_NAME.test(asset.name)) continue;
    if (asset.assetType === 'storage.googleapis.com/Bucket') {
      forms.set(`gs://${asset.name.replace('//storage.googleapis.com/', '')}`, asset.name);
      continue;
    }
    const relative = asset.name.replace(/^\/\/[^/]+\//, '');
    forms.set(relative, asset.name);
    const [, project = '', rest = ''] = /^projects\/([^/]+)\/(.+)$/.exec(relative) ?? [];
    const alias = projectAliases.get(project);
    if (alias !== undefined) forms.set(`projects/${alias}/${rest}`, asset.name);
    const table = TABLE_NAME.exec(asset.name);
    if (table !== null) forms.set(`bq:${table.slice(1).join('.')}`, asset.name);
  }
  const found = new Set<string>();
  if (forms.size === 0) return [];
  const check = (from: Asset, key: string): void => {
    const target = forms.get(key);
    if (target !== undefined && target !== from.name) found.add(`${from.name} -> ${target}`);
  };
  const visitString = (from: Asset, value: string): void => {
    for (let at = value.indexOf('projects/'); at !== -1; at = value.indexOf('projects/', at + 1)) {
      let prefix = '';
      for (const segment of (/^[^\s`"',()]+/.exec(value.slice(at))?.[0] ?? '').split('/')) {
        prefix = prefix === '' ? segment : `${prefix}/${segment}`;
        check(from, prefix);
      }
    }
    for (const match of value.matchAll(/gs:\/\/[a-z0-9][a-z0-9._-]*/g)) check(from, match[0]);
    for (const match of value.matchAll(/([a-z][a-z0-9-]+)[.:]([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)/g)) {
      check(from, `bq:${match.slice(1).join('.')}`);
    }
  };
  const visit = (from: Asset, value: unknown): void => {
    if (typeof value === 'string') visitString(from, value);
    else if (Array.isArray(value)) for (const item of value) visit(from, item);
    else if (typeof value === 'object' && value !== null) {
      const { projectId, datasetId, tableId } = value as Record<string, unknown>;
      if (typeof projectId === 'string' && typeof datasetId === 'string' && typeof tableId === 'string') {
        check(from, `bq:${projectId}.${datasetId}.${tableId}`);
      }
      for (const item of Object.values(value)) visit(from, item);
    }
  };
  for (const asset of present) visit(asset, asset.data);
  return [...found].sort();
}

/** Collections whose objects Google owns and Cloud Asset Inventory does not list. */
const EXTERNAL_COLLECTIONS = new Set([
  'machineTypes',
  'diskTypes',
  'images',
  'licenses',
  'gateways',
  'interconnectLocations',
]);

/**
 * Compute references (self-links, and relative paths such as `projects/<id or number>/zones/<z>/…`) found
 * anywhere in the assets' data that name no asset. Google-owned objects and the private services access
 * tenant network are expected to dangle.
 */
export function danglingComputeReferences(assets: readonly Asset[]): string[] {
  const names = new Set(assets.map((a) => a.name));
  const idByNumber = new Map<string, string>();
  for (const asset of assets) {
    if (asset.assetType === 'cloudresourcemanager.googleapis.com/Project') {
      const data = asset.data as Record<string, unknown>;
      idByNumber.set(String(data['projectNumber']), String(data['projectId']));
    }
  }
  const reference =
    /^(?:https:\/\/www\.googleapis\.com\/compute\/v1\/)?projects\/([^/]+)\/(global|regions\/[^/]+|zones\/[^/]+)\/([A-Za-z]+)\/([^/]+)$/;
  const dangling = new Set<string>();
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      const match = reference.exec(value);
      if (match === null) return;
      const [, project = '', scope = '', collection = '', name = ''] = match;
      if (EXTERNAL_COLLECTIONS.has(collection) || project.endsWith('-tp')) return;
      const id = idByNumber.get(project) ?? project;
      const full = `//compute.googleapis.com/projects/${id}/${scope}/${collection}/${name}`;
      if (!names.has(full)) dangling.add(value);
    } else if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (typeof value === 'object' && value !== null) {
      Object.values(value).forEach(visit);
    }
  };
  for (const asset of assets) visit(asset.data);
  return [...dangling].sort();
}
