// SPDX-License-Identifier: Apache-2.0
/**
 * The asset catalog's data shapes (skill gcp-asset-catalog §2 and §7): one YAML
 * entry per product, one YAML file per lens, and the compiled `catalog.json` the app loads. Entries and
 * lenses are strict, so a misspelt key in a YAML file fails validation instead of being ignored.
 */
import * as z from 'zod';
import { NodeRoleSchema } from './graph.js';
import { DetailLevelSchema, LensIdSchema } from './lens.js';
import {
  AssetTypePatternSchema,
  AssetTypeSchema,
  DateSchema,
  IconKeySchema,
  NonEmptyStringSchema,
  ServiceNameSchema,
} from './primitives.js';
import { RelationKindSchema } from './relation.js';

/** The normalisers of skill gcp-asset-catalog §5: each turns a field value into a full resource name. */
export const NormaliserNameSchema = z.enum([
  'name',
  'computeSelfLink',
  'computeRelative',
  'serviceAccountEmail',
  'gcsUri',
  'bigqueryUri',
  'pubsubUri',
  'kmsKey',
  'cloudSqlConnectionName',
  'artifactImage',
  'projectNumberOrId',
  'k8sOwner',
  'logSinkDestination',
  'siblingName',
  'k8sRef',
]);
export type NormaliserName = z.infer<typeof NormaliserNameSchema>;

/**
 * Variables a label, subtitle or console template may read (skill gcp-asset-catalog §2), besides `data.*`.
 */
export const TEMPLATE_VARIABLES = ['name', 'assetType', 'location', 'projectId', 'projectNumber'] as const;

/**
 * Template filters; `short(n)` takes a length, `parentSegment(collection)` a path collection such as
 * `clusters` (the segment that follows it in the value: `…/clusters/shop/k8s/…` → `shop`),
 * `first(variables)` a comma-separated list of variables whose first present value stands in when the value
 * itself is missing (`{{data.run.location | first(data.gke.cluster, data.customTarget.customTargetType)}}`), and
 * `plural(word)` a noun (optionally `plural(word, words)` with an irregular plural) that turns a count into
 * "1 word" or "n words" (`{{data.size | plural(instance)}}`).
 */
export const TEMPLATE_FILTERS = [
  'lastSegment',
  'projectFromName',
  'regionFromName',
  'short(n)',
  'lower',
  'parentSegment(collection)',
  'first(variables)',
  'plural(word)',
] as const;

/** `data` followed by at least one `.key` or `[index]` step. */
const DATA_PATH = String.raw`data(?:\.[A-Za-z_][A-Za-z0-9_-]*|\[[0-9]+\])+`;
const TEMPLATE_VARIABLE = `(?:${TEMPLATE_VARIABLES.join('|')}|${DATA_PATH})`;
/** A `plural(word)` noun: letters, then letters, digits or hyphens (`instance`, `VM`, `node-pool`). */
const PLURAL_WORD = '[A-Za-z][A-Za-z0-9-]*';
const FILTER_ALTERNATIVES = TEMPLATE_FILTERS.map((filter) =>
  filter
    .replace('(n)', String.raw`\([0-9]+\)`)
    .replace('(collection)', String.raw`\([A-Za-z][A-Za-z0-9]*\)`)
    .replace('(variables)', String.raw`\(\s*${TEMPLATE_VARIABLE}(?:\s*,\s*${TEMPLATE_VARIABLE})*\s*\)`)
    .replace('(word)', String.raw`\(\s*${PLURAL_WORD}(?:\s*,\s*${PLURAL_WORD})?\s*\)`),
);
const TEMPLATE_FILTER = `(?:${FILTER_ALTERNATIVES.join('|')})`;
const TEMPLATE_EXPRESSION = String.raw`\{\{\s*${TEMPLATE_VARIABLE}(?:\s*\|\s*${TEMPLATE_FILTER})*\s*\}\}`;

/** Literal text (no braces) and `{{variable | filter …}}` expressions. */
export const TEMPLATE_PATTERN = new RegExp(`^(?:[^{}]|${TEMPLATE_EXPRESSION})+$`);

/** A mustache template over the asset, e.g. `"{{data.machineType | lastSegment}} · {{location}}"`. */
export const TemplateSchema = z
  .string()
  .regex(
    TEMPLATE_PATTERN,
    [
      'must be text with {{variable | filter}} expressions',
      `variables: ${TEMPLATE_VARIABLES.join(', ')}, data.*`,
      `filters: ${TEMPLATE_FILTERS.join(', ')}`,
    ].join('; '),
  );

/** A JSONPath evaluated on the asset, e.g. `$.data.networkInterfaces[*].subnetwork`. */
export const JsonPathSchema = z.string().regex(/^\$[.[]/, 'must be a JSONPath starting with $. or $[');

/** A predicate over the asset, e.g. `$.data.status in ['TERMINATED']`. */
export const PredicateSchema = z.string().regex(/^\$[.[]/, 'must be a predicate starting with a JSONPath');

/** Kinds a catalog rule may produce. `shares` is derived by the graph builder and never written in YAML. */
export const CatalogRelationKindSchema = RelationKindSchema.exclude(['shares']);
export type CatalogRelationKind = z.infer<typeof CatalogRelationKindSchema>;

/**
 * The placeholders of a `siblingName` pattern (skill gcp-asset-catalog §5). Each takes its value from the
 * reference first (an object's keys, a path's own segments), then from the asset that holds it: `id` the
 * referenced id (a bare value, a path's last segment, an object's `name`), `parent` the path above the
 * referenced resource (a path value's, else the asset's own), `project`, `projectId`, `projectNumber`,
 * `location`, `region` (a zone's region) and `zone`; `.key` reads a string property of an object value.
 */
export const SIBLING_PATTERN_PLACEHOLDERS = [
  'id',
  'parent',
  'project',
  'projectId',
  'projectNumber',
  'location',
  'region',
  'zone',
  '.key',
] as const;

const PATTERN_SEGMENT = String.raw`(?:[A-Za-z0-9_.~:@+-]+|\{(?:id|parent|project|projectId|projectNumber|location|region|zone|\.[A-Za-z_][A-Za-z0-9_]*)\})`;

/** A `siblingName` pattern: `/`-separated literal segments and placeholders, e.g. `{parent}/targets/{id}`. */
export const SiblingPatternSchema = z
  .string()
  .regex(
    new RegExp(`^${PATTERN_SEGMENT}(?:/${PATTERN_SEGMENT})*$`),
    `must be a relative name of literal segments and placeholders: ${SIBLING_PATTERN_PLACEHOLDERS.map((p) => `{${p}}`).join(', ')}`,
  );

/**
 * A Kubernetes kind for `k8sRef`, with its API group unless it is a core kind: `Node`, `Service`,
 * `gateway.networking.k8s.io/Gateway`.
 */
export const KubernetesKindSchema = z
  .string()
  .regex(/^(?:[a-z0-9-]+(?:\.[a-z0-9-]+)*\/)?[A-Z][A-Za-z0-9]*$/, 'must be Kind or group/Kind');

/** How a reference is read and normalised: the part relation rules and `nestsIn` rules share. */
const referenceShape = {
  /** JSONPath to the referencing field(s). */
  to: JsonPathSchema,
  normalize: NormaliserNameSchema,
  /**
   * `name` and `siblingName`: the service of the target (`projects/p/locations/l/connectors/c` →
   * `//vpcaccess.googleapis.com/…`). Without it, the target belongs to the asset's own service.
   */
  service: ServiceNameSchema.exactOptional(),
  /** `siblingName` only (required there): the target's relative name, e.g. `{parent}/targets/{id}`. */
  pattern: SiblingPatternSchema.exactOptional(),
  /** `k8sRef` only: the kind of a bare name, and of an object reference that names none. */
  k8sKind: KubernetesKindSchema.exactOptional(),
};

type ReferenceOptions = {
  normalize: NormaliserName;
  service?: string;
  pattern?: string;
  k8sKind?: string;
  versionLevel?: boolean;
};

/** The option fields that belong to one normaliser each. */
function referenceIssues(rule: ReferenceOptions): Array<{ path: string[]; message: string }> {
  const issues: Array<{ path: string[]; message: string }> = [];
  if (rule.versionLevel !== undefined && rule.normalize !== 'kmsKey')
    issues.push({ path: ['versionLevel'], message: 'versionLevel applies to the kmsKey normaliser only' });
  if (rule.service !== undefined && rule.normalize !== 'name' && rule.normalize !== 'siblingName')
    issues.push({
      path: ['service'],
      message: 'service applies to the name and siblingName normalisers only',
    });
  if (rule.pattern !== undefined && rule.normalize !== 'siblingName')
    issues.push({ path: ['pattern'], message: 'pattern applies to the siblingName normaliser only' });
  if (rule.pattern === undefined && rule.normalize === 'siblingName')
    issues.push({ path: ['pattern'], message: 'the siblingName normaliser needs a pattern' });
  if (rule.k8sKind !== undefined && rule.normalize !== 'k8sRef')
    issues.push({ path: ['k8sKind'], message: 'k8sKind applies to the k8sRef normaliser only' });
  return issues;
}

export const RelationRuleSchema = z
  .strictObject({
    kind: CatalogRelationKindSchema,
    ...referenceShape,
    /** Drawn only when no stronger edge from the same asset exists (NIC network vs. subnet). */
    weak: z.boolean().exactOptional(),
    /**
     * Drawn from the target's side: the edge runs target → asset (a Cloud SQL replica names its primary, and
     * the primary `replicates` to the replica). A copy of an edge the target draws itself merges with it.
     */
    reverse: z.boolean().exactOptional(),
    /** `kmsKey` only: keep the key version instead of resolving to the key. */
    versionLevel: z.boolean().exactOptional(),
  })
  .superRefine((rule, ctx) => {
    for (const issue of referenceIssues(rule)) ctx.addIssue({ code: 'custom', ...issue });
  });
export type RelationRule = z.infer<typeof RelationRuleSchema>;

/**
 * Child-side containment: the asset nests in the container its reference names (an instance in its managed
 * group, a volume in its storage pool), unless that container is in another project or would close a cycle.
 * `kind` is the relation drawn instead when the asset does not nest there; without it nothing is drawn.
 */
export const NestsInRuleSchema = z
  .strictObject({
    ...referenceShape,
    kind: CatalogRelationKindSchema.exactOptional(),
  })
  .superRefine((rule, ctx) => {
    for (const issue of referenceIssues(rule)) ctx.addIssue({ code: 'custom', ...issue });
  });
export type NestsInRule = z.infer<typeof NestsInRuleSchema>;

/**
 * What nests in a container: a JSONPath to child names, or every asset of a type whose parent is this one.
 */
export const ContainsRuleSchema = z.union([JsonPathSchema, z.strictObject({ byParent: AssetTypeSchema })]);
export type ContainsRule = z.infer<typeof ContainsRuleSchema>;

/** The default label: the last segment of the asset name. */
export const DEFAULT_LABEL_TEMPLATE = '{{name | lastSegment}}';

/**
 * How the scene draws a container type (skill gcp-diagram-layout §2, skill gcp-diagram-style §4): `vpc` and
 * `subnet` are the network layers of the nesting order (their own tints, opened by the `networks` detail
 * level), `region` a location-like zone, `product` a product's own container (the default for containers),
 * `group` a bundle. The resource hierarchy (folders, projects) is structural and needs no zone kind.
 */
export const CatalogZoneKindSchema = z.enum(['vpc', 'subnet', 'region', 'product', 'group']);
export type CatalogZoneKind = z.infer<typeof CatalogZoneKindSchema>;

/** One asset type in a product entry. */
export const CatalogTypeEntrySchema = z
  .strictObject({
    role: NodeRoleSchema,
    label: TemplateSchema.default(DEFAULT_LABEL_TEMPLATE),
    subtitle: TemplateSchema.exactOptional(),
    /** Per-type icon override; the product icon otherwise. */
    icon: IconKeySchema.exactOptional(),
    /** Cloud Console URL template. */
    console: TemplateSchema.refine(
      (url) => url.startsWith('https://'),
      'must be an https:// URL',
    ).exactOptional(),
    /** JSONPaths yielding IPv4/IPv6 addresses or CIDR ranges. */
    ips: z.array(JsonPathSchema).default(() => []),
    /** JSONPaths yielding host names or URLs (the host is extracted). */
    domains: z.array(JsonPathSchema).default(() => []),
    relations: z.array(RelationRuleSchema).default(() => []),
    /** Containers only: what nests inside. */
    contains: z.array(ContainsRuleSchema).default(() => []),
    /**
     * Child-side containment: the container(s) the asset nests in, tried in order before its attachments
     * (one rule, or a list of them; stored as a list).
     */
    nestsIn: z
      .union([NestsInRuleSchema, z.array(NestsInRuleSchema).min(1)])
      .transform((rules) => (Array.isArray(rules) ? rules : [rules]))
      .exactOptional(),
    /** Containers only: how the scene draws the zone; `product` when absent. */
    zoneKind: CatalogZoneKindSchema.exactOptional(),
    /**
     * JSONPaths whose values are alternative keys for the asset (an IAM service account's `$.data.email`):
     * the graph builder's alias index maps each key (`aliasKey`) to the asset, so a relation whose normaliser
     * yields an alias resolves to it.
     */
    aliases: z.array(JsonPathSchema).min(1).exactOptional(),
    /** Matching assets start hidden. `null` is the same as leaving it out. */
    hiddenWhen: PredicateSchema.nullable().exactOptional(),
    notes: NonEmptyStringSchema.exactOptional(),
    /** The date the type left the official list; kept for saved views until removed. */
    deprecated: DateSchema.exactOptional(),
  })
  .refine((entry) => entry.role === 'container' || entry.contains.length === 0, {
    path: ['contains'],
    message: 'only container types have contains rules',
  })
  .refine((entry) => entry.role === 'container' || entry.zoneKind === undefined, {
    path: ['zoneKind'],
    message: 'only container types have a zone kind',
  });
export type CatalogTypeEntry = z.infer<typeof CatalogTypeEntrySchema>;

/** One product file: `packages/catalog/products/<service>.yaml`. */
export const CatalogEntrySchema = z.strictObject({
  /** Official product name as on the supported-asset-types page. */
  product: NonEmptyStringSchema,
  service: ServiceNameSchema,
  /** Product icon key; types fall back to it, and it falls back to the category icon. */
  icon: IconKeySchema,
  types: z.record(AssetTypeSchema, CatalogTypeEntrySchema),
});
export type CatalogEntry = z.infer<typeof CatalogEntrySchema>;
export type CatalogEntryInput = z.input<typeof CatalogEntrySchema>;

/** One lens file: `packages/catalog/lenses/<lens id>.yaml` (skill gcp-asset-catalog §7). */
export const LensSchema = z.strictObject({
  title: NonEmptyStringSchema,
  description: NonEmptyStringSchema,
  /** Asset types, `<service>/*` globs, or `*` for every type. */
  types: z.array(AssetTypePatternSchema).min(1),
  relationKinds: z.array(RelationKindSchema),
  showHidden: z.boolean().default(false),
  defaultDetail: DetailLevelSchema.default('auto'),
});
export type Lens = z.infer<typeof LensSchema>;

/** A product in the compiled catalog: its types are listed by id and described in `Catalog.types`. */
export const CatalogProductSchema = z.strictObject({
  product: NonEmptyStringSchema,
  service: ServiceNameSchema,
  icon: IconKeySchema,
  types: z.array(AssetTypeSchema),
});
export type CatalogProduct = z.infer<typeof CatalogProductSchema>;

/** A type in the compiled catalog: its entry plus where it comes from and its resolved icon. */
export const CatalogTypeSchema = CatalogTypeEntrySchema.safeExtend({
  assetType: AssetTypeSchema,
  product: NonEmptyStringSchema,
  service: ServiceNameSchema,
  /** The effective icon: the type's override or the product icon. */
  icon: IconKeySchema,
});
export type CatalogType = z.infer<typeof CatalogTypeSchema>;

type Issue = { path: PropertyKey[]; message: string };

function catalogIssues(catalog: { products: CatalogProduct[]; types: Record<string, CatalogType> }): Issue[] {
  const issues: Issue[] = [];
  const listed = new Set<string>();
  catalog.products.forEach((product, p) => {
    product.types.forEach((assetType, t) => {
      if (catalog.types[assetType]?.product !== product.product || listed.has(assetType)) {
        issues.push({
          path: ['products', p, 'types', t],
          message: `${assetType} must be described once, by this product`,
        });
      }
      listed.add(assetType);
    });
  });
  for (const [assetType, type] of Object.entries(catalog.types)) {
    if (type.assetType !== assetType) {
      issues.push({ path: ['types', assetType, 'assetType'], message: 'must equal the key' });
    }
    if (!listed.has(assetType))
      issues.push({ path: ['types', assetType], message: 'not listed by any product' });
  }
  return issues;
}

/** The compiled `catalog.json`. */
export const CatalogSchema = z
  .strictObject({
    /** Semantic version of the catalog data. */
    version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/, 'must be a semantic version'),
    /** Date of the official supported-asset-types snapshot the catalog was checked against. */
    officialListDate: DateSchema,
    products: z.array(CatalogProductSchema),
    types: z.record(AssetTypeSchema, CatalogTypeSchema),
    /** Every lens, by id. */
    lenses: z.record(LensIdSchema, LensSchema),
  })
  .superRefine((catalog, ctx) => {
    for (const issue of catalogIssues(catalog)) ctx.addIssue({ code: 'custom', ...issue });
  });
export type Catalog = z.infer<typeof CatalogSchema>;
