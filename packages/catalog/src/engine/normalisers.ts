// SPDX-License-Identifier: MIT
/**
 * Normalisers (skill gcp-asset-catalog §5): each turns one value read from an asset into a full resource name,
 * or into an alias the graph builder looks up (service-account emails), or into nothing when the value is not
 * a reference it understands. They are pure: the result depends on the value and the context only.
 *
 * Common to all of them: surrounding whitespace and trailing slashes are ignored, and a value that is a whole
 * URL-encoded full name (`%2F%2Fservice%2F…`) is decoded first. Encoded segments inside a name are kept
 * verbatim, because they are part of the canonical name (tag bindings, for instance).
 */
import {
  aliasKey,
  type Asset,
  type NormaliserName,
  type ProjectIndex,
  type RelationTarget,
} from '@gcportrait/model';
import { assetProject, projectSegment, resolveProject } from './project.js';
import { regionOfZone } from './template.js';

export interface NormaliserContext {
  /** The asset the value was read from. */
  readonly asset: Asset;
  /** The snapshot's project index. */
  readonly projects: ProjectIndex;
  /**
   * `name` and `siblingName`: the service of a relative value (the rule's `service`, else the asset's own
   * service).
   */
  readonly service: string;
  /** `kmsKey`: keep the key version instead of resolving to the key. */
  readonly versionLevel: boolean;
  /** `siblingName`: the rule's pattern, e.g. `{parent}/targets/{id}`. */
  readonly pattern?: string | undefined;
  /** `k8sRef`: the rule's default kind, `Kind` or `group/Kind`. */
  readonly k8sKind?: string | undefined;
}

export type Normaliser = (value: unknown, ctx: NormaliserContext) => RelationTarget | undefined;

const SERVICE = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;
const FULL_NAME = /^\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)\/(\S+)$/;
const NUMBER = /^[1-9][0-9]*$/;
const PROJECT_REF = /^[a-z0-9][a-z0-9.:-]*$/;
const API_VERSION = /^v[0-9]+(?:(?:alpha|beta|p[0-9]+beta)[0-9]*)?$/;
const COMPUTE_SELF_LINK =
  /^(?:https?:\/\/)?(?:www|compute)\.googleapis\.com\/compute\/(?:v1|beta|alpha|staging_v1)\/(\S+)$/;
const EMAIL = /^[^@\s/:]+@[^@\s/:]+\.[^@\s/:]+$/;
const BUCKET = /^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/;
const DATASET = /^[A-Za-z0-9_]+$/;
const TABLE = /^[^/\s.]+$/;
const REGION = /^[a-z]+-[a-z]+[0-9]+$/;
const SQL_INSTANCE = /^[a-z][a-z0-9-]*$/;

function named(name: string): RelationTarget | undefined {
  return FULL_NAME.test(name) ? { by: 'name', name } : undefined;
}

/** Trims, drops trailing slashes and decodes a value that is a whole URL-encoded full name. */
function clean(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  let text = value.trim().replace(/\/+$/, '');
  if (/^%2F%2F/i.test(text)) {
    try {
      text = decodeURIComponent(text);
    } catch {
      return undefined;
    }
  }
  return text === '' || /\s/.test(text) ? undefined : text;
}

function stripPrefix(text: string, prefixes: readonly string[]): string {
  for (const prefix of prefixes) if (text.startsWith(prefix)) return text.slice(prefix.length);
  return text;
}

// ---------------------------------------------------------------------------------------------------------
// Compute

/**
 * A Compute reference in any of its spellings → `//compute.googleapis.com/projects/<id>/…`. Compute names use
 * project ids, so a project number is translated through the index when it can be.
 */
function compute(value: unknown, ctx: NormaliserContext): RelationTarget | undefined {
  const text = clean(value);
  if (text === undefined) return undefined;
  const full = FULL_NAME.exec(text);
  if (full !== null && full[1] !== 'compute.googleapis.com') return named(text);
  let relative = full?.[2] ?? COMPUTE_SELF_LINK.exec(text)?.[1] ?? text;
  if (/^(?:global|regions|zones)\//.test(relative)) {
    const project = assetProject(ctx.asset, ctx.projects).id;
    if (project === undefined) return undefined;
    relative = `projects/${project}/${relative}`;
  }
  const match = /^projects\/([^/]+)((?:\/[^/]+){2,})$/.exec(relative);
  if (match === null) return undefined;
  const [, project = '', rest = ''] = match;
  const id = NUMBER.test(project) ? (resolveProject(project, ctx.projects).id ?? project) : project;
  return named(`//compute.googleapis.com/projects/${id}${rest}`);
}

// ---------------------------------------------------------------------------------------------------------
// Generic names

/**
 * Any resource reference → a full name: full names are kept, `https://<service>.googleapis.com/<version>/<path>`
 * URLs and `<service>.googleapis.com/<path>` values take their service from the host, relative names
 * (`projects/…`, `tagKeys/…`) take the rule's target service. Other URLs and hosts are not resource names.
 */
function name(value: unknown, ctx: NormaliserContext): RelationTarget | undefined {
  const text = clean(value);
  if (text === undefined) return undefined;
  if (FULL_NAME.test(text)) return named(text);
  if (COMPUTE_SELF_LINK.test(text)) return compute(text, ctx);
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(text)) {
    const url = /^https:\/\/([a-z0-9-]+\.googleapis\.com)\/(\S+)$/.exec(text);
    if (url === null) return undefined;
    const [, host = '', path = ''] = url;
    const segments = path.split('/');
    const rest = API_VERSION.test(segments[0] ?? '') ? segments.slice(1) : segments;
    return rest.length >= 2 ? named(`//${host}/${rest.join('/')}`) : undefined;
  }
  const relative = text.replace(/^\/+/, '');
  const [first = '', ...rest] = relative.split('/');
  if (rest.length === 0) return undefined;
  if (first.includes('.')) {
    return SERVICE.test(first) && first.endsWith('.googleapis.com') && rest.length >= 2
      ? named(`//${relative}`)
      : undefined;
  }
  return named(`//${ctx.service}/${relative}`);
}

// ---------------------------------------------------------------------------------------------------------
// Service accounts

function alias(value: string): RelationTarget | undefined {
  const key = aliasKey(value);
  return key === undefined ? undefined : { by: 'alias', alias: key };
}

/**
 * A service-account reference → an alias request for its email (its `aliasKey`, lower case): `sa@p.iam.gserviceaccount.com`,
 * `serviceAccount:sa@…`, `projects/p/serviceAccounts/sa@…`. `default` stands for the project's Compute
 * default service account. A full name with a numeric unique id is already a name and is kept.
 */
function serviceAccountEmail(value: unknown, ctx: NormaliserContext): RelationTarget | undefined {
  let text = clean(value);
  if (text === undefined) return undefined;
  if (FULL_NAME.test(text) && /\/serviceAccounts\/[0-9]+$/.test(text)) return named(text);
  text = stripPrefix(text, ['serviceAccount:']);
  const marker = text.lastIndexOf('/serviceAccounts/');
  if (marker !== -1) text = text.slice(marker + '/serviceAccounts/'.length);
  if (text === 'default') {
    const number = assetProject(ctx.asset, ctx.projects).number;
    return number === undefined ? undefined : alias(`${number}-compute@developer.gserviceaccount.com`);
  }
  return EMAIL.test(text) ? alias(text) : undefined;
}

// ---------------------------------------------------------------------------------------------------------
// Storage, BigQuery, Pub/Sub

/** A bucket reference (`gs://b/…`, `b`, `projects/_/buckets/b`, storage URLs) → `//storage.googleapis.com/b`. */
function gcsUri(value: unknown): RelationTarget | undefined {
  const text = clean(value);
  if (text === undefined) return undefined;
  const path = stripPrefix(text, [
    'gs://',
    '//storage.googleapis.com/',
    'https://storage.googleapis.com/storage/v1/b/',
    'https://storage.googleapis.com/',
    'https://storage.cloud.google.com/',
    'storage.googleapis.com/',
    'projects/_/buckets/',
  ]);
  if (path.includes('://')) return undefined;
  const bucket = path.split('/')[0] ?? '';
  return BUCKET.test(bucket) ? named(`//storage.googleapis.com/${bucket}`) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function bigqueryName(project: string, dataset: string, table?: string): RelationTarget | undefined {
  if (!PROJECT_REF.test(project) || !DATASET.test(dataset)) return undefined;
  if (table === undefined) return named(`//bigquery.googleapis.com/projects/${project}/datasets/${dataset}`);
  return TABLE.test(table)
    ? named(`//bigquery.googleapis.com/projects/${project}/datasets/${dataset}/tables/${table}`)
    : undefined;
}

/**
 * A dataset or table reference → `//bigquery.googleapis.com/projects/p/datasets/d[/tables/t]`. Accepts
 * resource paths (with or without the service), `bq://p.d.t`, `p.d.t`, `p:d.t`, and reference objects
 * `{ projectId?, datasetId, tableId? }` (the asset's project when `projectId` is absent).
 */
function bigqueryUri(value: unknown, ctx: NormaliserContext): RelationTarget | undefined {
  if (isRecord(value)) {
    const { projectId, datasetId, tableId } = value;
    const project = typeof projectId === 'string' ? projectId : assetProject(ctx.asset, ctx.projects).id;
    if (project === undefined || typeof datasetId !== 'string') return undefined;
    if (tableId !== undefined && typeof tableId !== 'string') return undefined;
    return bigqueryName(project, datasetId, tableId);
  }
  const text = clean(value);
  if (text === undefined) return undefined;
  const path = stripPrefix(text, [
    'bq://',
    '//bigquery.googleapis.com/',
    'https://bigquery.googleapis.com/bigquery/v2/',
    'https://www.googleapis.com/bigquery/v2/',
    'bigquery.googleapis.com/',
  ]);
  const resource = /^projects\/([^/]+)\/datasets\/([^/]+)(?:\/tables\/([^/]+))?$/.exec(path);
  if (resource !== null) return bigqueryName(resource[1] ?? '', resource[2] ?? '', resource[3]);
  if (path.includes('/')) return undefined;
  const colon = path.lastIndexOf(':');
  const project = colon === -1 ? path.split('.')[0] : path.slice(0, colon);
  const rest = colon === -1 ? path.split('.').slice(1) : path.slice(colon + 1).split('.');
  const [dataset, table, extra] = rest;
  if (project === undefined || dataset === undefined || extra !== undefined) return undefined;
  return bigqueryName(project, dataset, table);
}

/** A topic, subscription, schema or snapshot path (with or without the service) → its Pub/Sub full name. */
function pubsubUri(value: unknown): RelationTarget | undefined {
  const text = clean(value);
  if (text === undefined) return undefined;
  const path = stripPrefix(text, [
    '//pubsub.googleapis.com/',
    'https://pubsub.googleapis.com/v1/',
    'pubsub.googleapis.com/',
  ]);
  const match = /^projects\/([^/]+)\/(?:topics|subscriptions|schemas|snapshots)\/[^/]+$/.exec(path);
  return match !== null && PROJECT_REF.test(match[1] ?? '')
    ? named(`//pubsub.googleapis.com/${path}`)
    : undefined;
}

// ---------------------------------------------------------------------------------------------------------
// KMS, Cloud SQL, Artifact Registry, projects

/**
 * A Cloud KMS key or key version → the key's full name, or the version's with `versionLevel`. Accepts the
 * relative path, the full name, and the `//cloudkms.googleapis.com/v1/…` and `https://…/v1/…` spellings.
 */
function kmsKey(value: unknown, ctx: NormaliserContext): RelationTarget | undefined {
  const text = clean(value);
  if (text === undefined) return undefined;
  const path = stripPrefix(text, [
    '//cloudkms.googleapis.com/v1/',
    '//cloudkms.googleapis.com/',
    'https://cloudkms.googleapis.com/v1/',
    'cloudkms.googleapis.com/',
  ]);
  const match =
    /^(projects\/[^/]+\/locations\/[^/]+\/keyRings\/[^/]+\/cryptoKeys\/[^/]+)(\/cryptoKeyVersions\/[^/]+)?$/.exec(
      path,
    );
  if (match === null) return undefined;
  const key = match[1] ?? '';
  const version = ctx.versionLevel ? (match[2] ?? '') : '';
  return named(`//cloudkms.googleapis.com/${key}${version}`);
}

/**
 * Cloud Asset Inventory names `sqladmin.googleapis.com/Instance` assets in the `cloudsql.googleapis.com`
 * family (`//cloudsql.googleapis.com/projects/<id>/instances/<name>`), not after the type's service.
 */
const CLOUD_SQL_INSTANCE_PREFIX = '//cloudsql.googleapis.com/projects/';

/**
 * A Cloud SQL instance reference → `//cloudsql.googleapis.com/projects/p/instances/i`, the asset name CAI
 * gives the instance: a connection name `p:region:i`, a `p:i` pair (replica `masterInstanceName`), either with
 * a domain-scoped project (`example.com:p:…`), a `projects/p/instances/i` path, or a full name in the
 * `cloudsql` or `sqladmin` family.
 */
function cloudSqlConnectionName(value: unknown): RelationTarget | undefined {
  const text = clean(value);
  if (text === undefined) return undefined;
  const path = stripPrefix(text, [
    '//cloudsql.googleapis.com/',
    '//sqladmin.googleapis.com/',
    'cloudsql.googleapis.com/',
    'sqladmin.googleapis.com/',
  ]);
  const resource = /^projects\/([^/]+)\/instances\/([^/]+)$/.exec(path);
  if (resource !== null) {
    const [, project = '', instance = ''] = resource;
    return PROJECT_REF.test(project) && SQL_INSTANCE.test(instance)
      ? named(`${CLOUD_SQL_INSTANCE_PREFIX}${project}/instances/${instance}`)
      : undefined;
  }
  const parts = path.split(':');
  if (parts.length > 1 && (parts[0] ?? '').includes('.'))
    parts.splice(0, 2, `${parts[0] ?? ''}:${parts[1] ?? ''}`);
  const [project = '', ...rest] = parts;
  const instance = rest.at(-1) ?? '';
  const region = rest.length === 2 ? (rest[0] ?? '') : undefined;
  if (rest.length < 1 || rest.length > 2 || (region !== undefined && !REGION.test(region))) return undefined;
  return PROJECT_REF.test(project) && SQL_INSTANCE.test(instance)
    ? named(`${CLOUD_SQL_INSTANCE_PREFIX}${project}/instances/${instance}`)
    : undefined;
}

const GCR_LOCATIONS: Readonly<Record<string, string>> = {
  '': 'us',
  'us.': 'us',
  'eu.': 'europe',
  'asia.': 'asia',
};

/**
 * A container image or package path → its Artifact Registry repository:
 * `<location>-<format>.pkg.dev/<project>/<repo>/…` and `[us.|eu.|asia.]gcr.io/<project>/…` (gcr.io paths are
 * served by repositories named after the host). Domain-scoped projects (`example.com/p`) become `example.com:p`.
 * Images from other registries (Docker Hub, …) are not references to assets and yield nothing.
 */
function artifactImage(value: unknown): RelationTarget | undefined {
  const text = clean(value);
  if (text === undefined) return undefined;
  const path = stripPrefix(text, ['https://', 'docker://']);
  const repository = (project: string, location: string, repo: string): RelationTarget | undefined =>
    PROJECT_REF.test(project) && /^[a-z0-9][a-z0-9.-]*$/.test(repo)
      ? named(
          `//artifactregistry.googleapis.com/projects/${project}/locations/${location}/repositories/${repo}`,
        )
      : undefined;
  const takeProject = (segments: string[]): string | undefined => {
    const first = segments.shift();
    if (first === undefined) return undefined;
    if (!first.includes('.')) return first;
    const second = segments.shift();
    return second === undefined ? undefined : `${first}:${second}`;
  };
  const registry = /^([a-z0-9-]+)-[a-z]+\.pkg\.dev\/(.+)$/.exec(path);
  if (registry !== null) {
    const segments = (registry[2] ?? '').split('/');
    const project = takeProject(segments);
    const repo = segments[0]?.split(/[:@]/)[0];
    return project === undefined || repo === undefined
      ? undefined
      : repository(project, registry[1] ?? '', repo);
  }
  const gcr = /^((?:us\.|eu\.|asia\.)?)gcr\.io\/(.+)$/.exec(path);
  if (gcr !== null) {
    const host = gcr[1] ?? '';
    const segments = (gcr[2] ?? '').split('/');
    const project = takeProject(segments);
    const location = GCR_LOCATIONS[host];
    return project === undefined || location === undefined || segments.length === 0
      ? undefined
      : repository(project, location, `${host}gcr.io`);
  }
  return undefined;
}

/**
 * A project number or id (`123`, `projects/123`, `my-project`, a Resource Manager full name, or a number
 * value) →
 * `//cloudresourcemanager.googleapis.com/projects/<number>`. An id the index does not know stays an id: the
 * name is well-formed and matches no asset, so the reference shows as dangling.
 */
function projectNumberOrId(value: unknown, ctx: NormaliserContext): RelationTarget | undefined {
  const text =
    typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? String(value) : clean(value);
  if (text === undefined) return undefined;
  const ref = stripPrefix(stripPrefix(text, ['//cloudresourcemanager.googleapis.com/']), ['projects/']);
  if (ref.includes('/') || !PROJECT_REF.test(ref)) return undefined;
  const project = resolveProject(ref, ctx.projects);
  const key = project.number ?? project.id;
  return key === undefined ? undefined : named(`//cloudresourcemanager.googleapis.com/projects/${key}`);
}

// ---------------------------------------------------------------------------------------------------------
// Sibling names

const ZONE_NAME = /^[a-z]+-[a-z]+[0-9]+-[a-z]$/;
const PATH_SEGMENT = /^[A-Za-z0-9_.~:@+-]+$/;
const LOCATION_COLLECTIONS = ['locations', 'regions', 'zones'] as const;

/** A value read by a `siblingName` rule, taken apart. */
interface SiblingReference {
  /** The referenced id: a bare value, a path's last segment, an object's `name`. */
  readonly id?: string;
  /** A path value's segments (relative: no service, no scheme). */
  readonly path?: readonly string[];
  /** An object value's string properties. */
  readonly keys: ReadonlyMap<string, string>;
}

/** A path value without its service or URL prefix: `//s/a/b`, `https://s.googleapis.com/v1/a/b`, `/a/b` → `a/b`. */
function relativePath(text: string): string[] | undefined {
  let rest = text;
  const full = FULL_NAME.exec(rest);
  if (full !== null) rest = full[2] ?? '';
  else {
    const selfLink = COMPUTE_SELF_LINK.exec(rest);
    if (selfLink !== null) rest = selfLink[1] ?? '';
    else if (/^[a-z][a-z0-9+.-]*:\/\//.test(rest)) {
      const url = /^https:\/\/[a-z0-9-]+\.googleapis\.com\/(\S+)$/.exec(rest);
      if (url === null) return undefined;
      const segments = (url[1] ?? '').split('/');
      rest = (API_VERSION.test(segments[0] ?? '') ? segments.slice(1) : segments).join('/');
    } else {
      rest = rest.replace(/^\/+/, '');
      const [first = ''] = rest.split('/');
      if (first.includes('.')) {
        if (!SERVICE.test(first) || !first.endsWith('.googleapis.com')) return undefined;
        rest = rest.slice(first.length + 1);
      }
    }
  }
  const segments = rest.split('/');
  return segments.length >= 2 && segments.every((segment) => PATH_SEGMENT.test(segment))
    ? segments
    : undefined;
}

function siblingReference(value: unknown): SiblingReference | undefined {
  if (isRecord(value)) {
    const keys = new Map<string, string>();
    for (const [key, entry] of Object.entries(value)) {
      const text = clean(entry);
      if (text !== undefined) keys.set(key, text);
    }
    const nameValue = keys.get('name');
    if (nameValue === undefined || !nameValue.includes('/')) {
      return { ...(nameValue === undefined ? {} : { id: nameValue }), keys };
    }
    const path = relativePath(nameValue);
    return path === undefined ? undefined : { id: path.at(-1) ?? '', path, keys };
  }
  const text = clean(value);
  if (text === undefined) return undefined;
  if (!text.includes('/')) return PATH_SEGMENT.test(text) ? { id: text, keys: new Map() } : undefined;
  const path = relativePath(text);
  return path === undefined ? undefined : { id: path.at(-1) ?? '', path, keys: new Map() };
}

/** The segment after the first of `collections` in a path. */
function segmentAfter(path: readonly string[], collections: readonly string[]): string | undefined {
  for (let i = 0; i < path.length - 1; i += 1) {
    if (collections.includes(path[i] ?? '')) return path[i + 1];
  }
  return undefined;
}

/** The asset's own name as relative segments (`//s/a/b/c` → `a`, `b`, `c`). */
function ownPath(asset: Asset): string[] {
  const full = FULL_NAME.exec(asset.name);
  return full === null ? [] : (full[2] ?? '').split('/');
}

/**
 * The value of one placeholder of a `siblingName` pattern: from the reference first (an object's keys, a
 * path's own segments), then from the asset that holds the reference.
 */
function placeholder(name: string, ref: SiblingReference, ctx: NormaliserContext): string | undefined {
  const own = ownPath(ctx.asset);
  const project = (): string | undefined => {
    const fromKeys = ref.keys.get('project') ?? ref.keys.get('projectId');
    if (fromKeys !== undefined) return fromKeys.replace(/^projects\//, '');
    const fromPath = ref.path === undefined ? undefined : segmentAfter(ref.path, ['projects']);
    if (fromPath !== undefined) return fromPath;
    const fromName = projectSegment(ctx.asset.name);
    if (fromName !== undefined) return fromName;
    const fromAsset = assetProject(ctx.asset, ctx.projects);
    return fromAsset.id ?? fromAsset.number;
  };
  const location = (): string | undefined =>
    ref.keys.get('location') ??
    ref.keys.get('region') ??
    ref.keys.get('zone') ??
    (ref.path === undefined ? undefined : segmentAfter(ref.path, LOCATION_COLLECTIONS)) ??
    ctx.asset.location ??
    segmentAfter(own, LOCATION_COLLECTIONS);
  switch (name) {
    case 'id':
      return ref.id;
    case 'parent': {
      const parent = ref.path !== undefined && ref.path.length > 2 ? ref.path.slice(0, -2) : own.slice(0, -2);
      return parent.length === 0 ? undefined : parent.join('/');
    }
    case 'project':
      return project();
    case 'projectId': {
      const current = project();
      return current === undefined ? undefined : resolveProject(current, ctx.projects).id;
    }
    case 'projectNumber': {
      const current = project();
      return current === undefined ? undefined : resolveProject(current, ctx.projects).number;
    }
    case 'location':
      return location();
    case 'region': {
      const value = location();
      return value === undefined ? undefined : regionOfZone(value);
    }
    case 'zone': {
      const value =
        ref.keys.get('zone') ??
        (ref.path === undefined ? undefined : segmentAfter(ref.path, ['zones'])) ??
        (ctx.asset.location !== undefined && ZONE_NAME.test(ctx.asset.location)
          ? ctx.asset.location
          : undefined) ??
        segmentAfter(own, ['zones']);
      return value;
    }
    default:
      return name.startsWith('.') ? ref.keys.get(name.slice(1)) : undefined;
  }
}

/**
 * A reference that names its target by id, or by a path that has to be rebuilt, completed from the asset
 * that holds it: the rule's `pattern` (`{parent}/targets/{id}`, `projects/{project}/locations/{region}/
 * services/{id}`) is filled in and the result belongs to the rule's `service` (default: the asset's own).
 * A placeholder takes its value from the reference first (an object's keys `project`/`projectId`,
 * `location`/`region`/`zone`, `name`; a path value's own `projects/`, `locations/`, `regions/`, `zones/`
 * segments, its last segment as `{id}` and everything above its last `<collection>/<id>` pair as
 * `{parent}`), then from the asset (its name's project segment, else its project; its location; its own
 * name's parent path). Values that are not ids, paths or objects, and patterns with a placeholder that has
 * no value, yield nothing.
 */
function siblingName(value: unknown, ctx: NormaliserContext): RelationTarget | undefined {
  const { pattern } = ctx;
  if (pattern === undefined) return undefined;
  const ref = siblingReference(value);
  if (ref === undefined) return undefined;
  const segments: string[] = [];
  for (const part of pattern.split('/')) {
    const slot = /^\{(.+)\}$/.exec(part)?.[1];
    if (slot === undefined) {
      segments.push(part);
      continue;
    }
    const filled = placeholder(slot, ref, ctx);
    if (filled === undefined || filled === '') return undefined;
    segments.push(filled);
  }
  const relative = segments.join('/');
  if (relative.split('/').some((segment) => !PATH_SEGMENT.test(segment))) return undefined;
  return named(`//${ctx.service}/${relative}`);
}

// ---------------------------------------------------------------------------------------------------------
// Kubernetes

/** Kinds that are not namespaced; their objects sit directly under the cluster's `k8s/`. */
const CLUSTER_SCOPED_KINDS = new Set([
  'APIService',
  'ClusterRole',
  'ClusterRoleBinding',
  'CustomResourceDefinition',
  'GatewayClass',
  'IngressClass',
  'MutatingWebhookConfiguration',
  'Namespace',
  'Node',
  'PersistentVolume',
  'PriorityClass',
  'StorageClass',
  'ValidatingWebhookConfiguration',
]);

/**
 * The API groups Kubernetes itself serves. Cloud Asset Inventory writes their objects' names with the group as
 * one segment (`…/k8s/namespaces/n/apps/deployments/d`, `…/networking.k8s.io/ingresses/i`), the core group with
 * none (`…/pods/p`), and every other group, served by a custom resource definition, behind `apis/`
 * (`…/apis/gateway.networking.k8s.io/httproutes/r`), as its resource-name-format page lists them.
 */
const BUILT_IN_GROUPS: ReadonlySet<string> = new Set([
  'admissionregistration.k8s.io',
  'apiextensions.k8s.io',
  'apiregistration.k8s.io',
  'apps',
  'authentication.k8s.io',
  'authorization.k8s.io',
  'autoscaling',
  'batch',
  'certificates.k8s.io',
  'coordination.k8s.io',
  'discovery.k8s.io',
  'events.k8s.io',
  'extensions',
  'flowcontrol.apiserver.k8s.io',
  'internal.apiserver.k8s.io',
  'networking.k8s.io',
  'node.k8s.io',
  'policy',
  'rbac.authorization.k8s.io',
  'resource.k8s.io',
  'scheduling.k8s.io',
  'storage.k8s.io',
  'storagemigration.k8s.io',
]);

/** The path segment(s) of an API group in an object's name: none, `/<group>`, or `/apis/<group>`. */
export function kubernetesGroupPath(group: string): string {
  if (group === '') return '';
  return BUILT_IN_GROUPS.has(group) ? `/${group}` : `/apis/${group}`;
}

/** The lower-case plural Kubernetes uses in resource paths: `ReplicaSet` → `replicasets`. */
export function kubernetesPlural(kind: string): string {
  const lower = kind.toLowerCase();
  if (lower === 'endpoints') return lower;
  if (/(?:s|x|z|ch|sh)$/.test(lower)) return `${lower}es`;
  if (/[^aeiou]y$/.test(lower)) return `${lower.slice(0, -1)}ies`;
  return `${lower}s`;
}

/**
 * An `ownerReferences[*]` entry `{ apiVersion, kind, name }` → the owner's full name in the same cluster
 * (and namespace, unless the kind is cluster-scoped): `…/k8s/namespaces/<ns>/<group>/<plural>/<name>`, with
 * no group segment for the core API (`apiVersion: v1`) and `apis/<group>` for a group Kubernetes does not
 * serve itself ({@link kubernetesGroupPath}).
 */
function k8sOwner(value: unknown, ctx: NormaliserContext): RelationTarget | undefined {
  if (!isRecord(value)) return undefined;
  const { apiVersion, kind, name: ownerName } = value;
  if (typeof apiVersion !== 'string' || typeof kind !== 'string' || typeof ownerName !== 'string')
    return undefined;
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(kind) || !/^[a-z0-9][a-z0-9.-]*$/.test(ownerName)) return undefined;
  const marker = ctx.asset.name.indexOf('/k8s/');
  if (marker === -1) return undefined;
  const cluster = ctx.asset.name.slice(0, marker + '/k8s'.length);
  const namespace = /\/k8s\/namespaces\/([^/]+)/.exec(ctx.asset.name)?.[1];
  const slash = apiVersion.indexOf('/');
  const group = kubernetesGroupPath(slash === -1 ? '' : apiVersion.slice(0, slash));
  const scope = CLUSTER_SCOPED_KINDS.has(kind)
    ? ''
    : namespace === undefined
      ? undefined
      : `/namespaces/${namespace}`;
  if (scope === undefined) return undefined;
  return named(`${cluster}${scope}${group}/${kubernetesPlural(kind)}/${ownerName}`);
}

const K8S_NAME = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;
const K8S_KIND = /^[A-Z][A-Za-z0-9]*$/;
const K8S_GROUP = /^(?:[a-z0-9-]+(?:\.[a-z0-9-]+)*)?$/;

/** `Kind` or `group/Kind` → its parts (the core group is ''). */
function kubernetesKind(text: string | undefined): { group: string; kind: string } | undefined {
  if (text === undefined) return undefined;
  const slash = text.lastIndexOf('/');
  const group = slash === -1 ? '' : text.slice(0, slash);
  const kind = text.slice(slash + 1);
  return K8S_KIND.test(kind) && K8S_GROUP.test(group) ? { group, kind } : undefined;
}

/**
 * A Kubernetes object reference without an `apiVersion` → the object's full name in the asset's cluster:
 * a bare name (a pod's `spec.nodeName`, a claim's `spec.volumeName`, an Ingress backend's service name) of
 * the rule's `k8sKind`, or an object `{ name, kind?, group? | apiGroup? | apiVersion?, namespace? }` (a
 * volume's `claimRef`, an HTTPRoute's `backendRefs` and `parentRefs`, a role binding's `roleRef`). The kind is
 * the object's, else the rule's; the group is the object's `group` or `apiGroup` (`''` is the core group),
 * else the group of its `apiVersion`, else the rule's group when the kinds agree, else the core group; the
 * namespace is the object's, else the asset's own, and cluster-scoped kinds (nodes, persistent volumes,
 * cluster roles, …) have none. The name is `…/k8s[/namespaces/<ns>][/<group path>]/<plural>/<name>`, as for
 * `k8sOwner` ({@link kubernetesGroupPath}: a built-in group as one segment, any other behind `apis/`).
 */
function k8sRef(value: unknown, ctx: NormaliserContext): RelationTarget | undefined {
  const marker = ctx.asset.name.indexOf('/k8s/');
  if (marker === -1) return undefined;
  const cluster = ctx.asset.name.slice(0, marker + '/k8s'.length);
  const ownNamespace = /\/k8s\/namespaces\/([^/]+)/.exec(ctx.asset.name)?.[1];
  const fallback = kubernetesKind(ctx.k8sKind);
  let objectName: string | undefined;
  let kind: string | undefined;
  let group: string | undefined;
  let namespace = ownNamespace;
  if (isRecord(value)) {
    const text = (key: string): string | undefined => {
      const entry = value[key];
      return typeof entry === 'string' ? entry.trim() : undefined;
    };
    const present = (key: string): string | undefined => {
      const entry = text(key);
      return entry === '' ? undefined : entry;
    };
    objectName = present('name');
    kind = present('kind') ?? fallback?.kind;
    const apiVersion = present('apiVersion');
    group =
      text('group') ??
      text('apiGroup') ??
      (apiVersion === undefined
        ? kind === fallback?.kind
          ? fallback?.group
          : ''
        : apiVersion.includes('/')
          ? apiVersion.slice(0, apiVersion.indexOf('/'))
          : '');
    namespace = present('namespace') ?? ownNamespace;
  } else {
    objectName = clean(value);
    kind = fallback?.kind;
    group = fallback?.group;
  }
  if (objectName === undefined || kind === undefined || group === undefined) return undefined;
  if (!K8S_NAME.test(objectName) || !K8S_KIND.test(kind) || !K8S_GROUP.test(group)) return undefined;
  const scope = CLUSTER_SCOPED_KINDS.has(kind)
    ? ''
    : namespace === undefined
      ? undefined
      : `/namespaces/${namespace}`;
  if (scope === undefined) return undefined;
  return named(`${cluster}${scope}${kubernetesGroupPath(group)}/${kubernetesPlural(kind)}/${objectName}`);
}

// ---------------------------------------------------------------------------------------------------------
// Logging

/**
 * A log sink destination → the full name of the bucket, dataset, topic, log bucket or project it writes to.
 */
function logSinkDestination(value: unknown, ctx: NormaliserContext): RelationTarget | undefined {
  const text = clean(value);
  if (text === undefined) return undefined;
  const match = /^(?:\/\/)?([a-z]+)\.googleapis\.com\/(.+)$/.exec(text);
  if (match === null) return undefined;
  const [, service, rest = ''] = match;
  switch (service) {
    case 'storage':
      return gcsUri(rest);
    case 'bigquery':
      return bigqueryUri(rest, ctx);
    case 'pubsub':
      return pubsubUri(rest);
    case 'logging':
      if (/^projects\/[^/]+$/.test(rest)) return projectNumberOrId(rest, ctx);
      return /^(?:projects|folders|organizations|billingAccounts)\/[^/]+\/locations\/[^/]+\/buckets\/[^/]+$/.test(
        rest,
      )
        ? named(`//logging.googleapis.com/${rest}`)
        : undefined;
    default:
      return undefined;
  }
}

/** Every normaliser, by the name a rule's `normalize` field uses. */
export const NORMALISERS: Readonly<Record<NormaliserName, Normaliser>> = Object.freeze({
  name,
  computeSelfLink: compute,
  computeRelative: compute,
  serviceAccountEmail,
  gcsUri,
  bigqueryUri,
  pubsubUri,
  kmsKey,
  cloudSqlConnectionName,
  artifactImage,
  projectNumberOrId,
  k8sOwner,
  logSinkDestination,
  siblingName,
  k8sRef,
});

/** Applies one normaliser by name. */
export function normalise(
  normaliser: NormaliserName,
  value: unknown,
  ctx: NormaliserContext,
): RelationTarget | undefined {
  return NORMALISERS[normaliser](value, ctx);
}
