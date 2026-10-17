// SPDX-License-Identifier: MIT
/**
 * The contract of the asset catalog's rule engine (`@gcportrait/catalog`, skill gcp-asset-catalog §5): the
 * project index it reads next to an asset, and the relations it hands to the graph builder. Plain records
 * only, so both cross worker boundaries unchanged.
 */
import * as z from 'zod';
import type { Asset } from './asset.js';
import { CatalogRelationKindSchema } from './catalog.js';
import {
  CountSchema,
  NUMERIC_ID_PATTERN,
  NumericIdSchema,
  PROJECT_REF_PATTERN,
  ProjectRefSchema,
  ResourceNameSchema,
} from './primitives.js';

type Issue = { path: PropertyKey[]; message: string };

function projectIndexIssues(index: {
  numberById: Record<string, string>;
  idByNumber: Record<string, string>;
}): Issue[] {
  const issues: Issue[] = [];
  for (const [id, number] of Object.entries(index.numberById)) {
    if (index.idByNumber[number] !== id) {
      issues.push({ path: ['numberById', id], message: `idByNumber must map ${number} back to ${id}` });
    }
  }
  for (const [number, id] of Object.entries(index.idByNumber)) {
    if (index.numberById[id] !== number) {
      issues.push({ path: ['idByNumber', number], message: `numberById must map ${id} back to ${number}` });
    }
  }
  return issues;
}

/**
 * The snapshot's projects, id ↔ number, built from its Resource Manager `Project` assets. Compute names and
 * self-links use project ids while most newer APIs use numbers; normalisers and templates translate through
 * this index and never hard-code either form. The two records are inverse of each other.
 */
export const ProjectIndexSchema = z
  .strictObject({
    /** Project id → project number. */
    numberById: z.record(ProjectRefSchema, NumericIdSchema),
    /** Project number → project id. */
    idByNumber: z.record(NumericIdSchema, ProjectRefSchema),
  })
  .superRefine((index, ctx) => {
    for (const issue of projectIndexIssues(index)) ctx.addIssue({ code: 'custom', ...issue });
  });
export type ProjectIndex = z.infer<typeof ProjectIndexSchema>;

const RESOURCE_MANAGER_PROJECT = 'cloudresourcemanager.googleapis.com/Project';
const TRAILING_PROJECT = /\/projects\/([^/]+)$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** What one Resource Manager project asset says about its number and id; either half may be missing. */
export interface ProjectPair {
  readonly number?: string;
  readonly id?: string;
}

/**
 * The number and id a `cloudresourcemanager.googleapis.com/Project` asset declares: the number from its name
 * (`//cloudresourcemanager.googleapis.com/projects/<number>`), else from `data.projectNumber` (a decimal
 * string); the id from `data.projectId` (a project id, never a number). Any other asset declares nothing.
 */
export function projectPairOf(asset: Pick<Asset, 'assetType' | 'name' | 'data'>): ProjectPair {
  if (asset.assetType !== RESOURCE_MANAGER_PROJECT || !isRecord(asset.data)) return {};
  const fromName = TRAILING_PROJECT.exec(asset.name)?.[1];
  const declared = asset.data['projectNumber'];
  const number =
    fromName !== undefined && NUMERIC_ID_PATTERN.test(fromName)
      ? fromName
      : typeof declared === 'string' && NUMERIC_ID_PATTERN.test(declared)
        ? declared
        : undefined;
  const id = asset.data['projectId'];
  const validId =
    typeof id === 'string' && PROJECT_REF_PATTERN.test(id) && !NUMERIC_ID_PATTERN.test(id) ? id : undefined;
  return { ...(number === undefined ? {} : { number }), ...(validId === undefined ? {} : { id: validId }) };
}

/** Strings in code-point order. */
function compareText(a: string, b: string): number {
  return Number(a > b) - Number(a < b);
}

/** Decimal strings in numeric order (no leading zeros: shorter is smaller). */
function compareDecimal(a: string, b: string): number {
  return a.length - b.length || compareText(a, b);
}

/** Builds a project index asset by asset, for callers that see the assets one at a time (ingest). */
export interface ProjectIndexBuilder {
  /** Takes the pair the asset declares, if it is a complete one nobody claimed yet; returns what it declared. */
  add(asset: Pick<Asset, 'assetType' | 'name' | 'data'>): ProjectPair;
  /** The index so far: ids in code-point order, numbers in numeric order. */
  index(): ProjectIndex;
}

/**
 * The one pairing rule of the project index: only Resource Manager `Project` assets
 * pair a number with an id ({@link projectPairOf}), in the order they are added; a number or an id that is
 * already paired keeps its first pairing, so the two records stay exact inverses of each other.
 */
export function projectIndexBuilder(): ProjectIndexBuilder {
  const numberById = new Map<string, string>();
  const idByNumber = new Map<string, string>();
  return {
    add(asset) {
      const pair = projectPairOf(asset);
      const { number, id } = pair;
      if (number !== undefined && id !== undefined && !idByNumber.has(number) && !numberById.has(id)) {
        idByNumber.set(number, id);
        numberById.set(id, number);
      }
      return pair;
    },
    index() {
      return {
        numberById: Object.fromEntries([...numberById].sort(([a], [b]) => compareText(a, b))),
        idByNumber: Object.fromEntries([...idByNumber].sort(([a], [b]) => compareDecimal(a, b))),
      };
    },
  };
}

/**
 * The project index of a set of assets, from their Resource Manager `Project` assets (see
 * {@link projectIndexBuilder} for the rule). Ingest builds the same index while it reads a snapshot, and the
 * catalog's rule engine and the graph builder build it from a stored one: one rule, one implementation.
 */
export function buildProjectIndex(
  assets: Iterable<Pick<Asset, 'assetType' | 'name' | 'data'>>,
): ProjectIndex {
  const builder = projectIndexBuilder();
  for (const asset of assets) builder.add(asset);
  return builder.index();
}

const ALIAS_KEY = /^\S+$/;

/** A key of the graph's alias index, such as a service-account email: non-empty, no whitespace. */
export const AliasKeySchema = z.string().regex(ALIAS_KEY, 'must be a non-empty key without whitespace');

/**
 * The alias-index key of a value: trimmed and lower-cased (e-mail addresses and host names compare without
 * case). Normalisers that yield `{ by: 'alias' }` write their key with it, and the graph builder indexes the
 * values of each catalog type's `aliases` paths with it, so the two always meet. Undefined for a value that
 * is empty or has whitespace inside.
 */
export function aliasKey(value: string): string | undefined {
  const key = value.trim().toLowerCase();
  return ALIAS_KEY.test(key) ? key : undefined;
}

/**
 * Where a relation points: a full resource name, or an alias the graph builder looks up in its alias index
 * (service-account emails, which name no asset by themselves).
 */
export const RelationTargetSchema = z.discriminatedUnion('by', [
  z.strictObject({ by: z.literal('name'), name: ResourceNameSchema }),
  z.strictObject({ by: z.literal('alias'), alias: AliasKeySchema }),
]);
export type RelationTarget = z.infer<typeof RelationTargetSchema>;

/** One relation a catalog rule produced for one asset (`evaluateRelations` in `@gcportrait/catalog`). */
export const EvaluatedRelationSchema = z.strictObject({
  kind: CatalogRelationKindSchema,
  /** Position of the producing rule in the type's `relations`. */
  rule: CountSchema,
  /** The value as read from the asset; JSON text when it is not a string. Kept for dangling references. */
  raw: z.string(),
  /** Absent when the value is not a reference its normaliser understands (then it is dangling). */
  target: RelationTargetSchema.exactOptional(),
  /** Yields to a stronger edge from the same asset. */
  weak: z.literal(true).exactOptional(),
  /** Drawn from the target's side: the edge runs target → asset (`reverse: true` on the rule). */
  reverse: z.literal(true).exactOptional(),
});
export type EvaluatedRelation = z.infer<typeof EvaluatedRelationSchema>;

/**
 * One container a type's `nestsIn` rules name for one asset (`evaluateNestsIn` in `@gcportrait/catalog`), in
 * rule order and then document order: the graph builder nests the asset in the first one that is an
 * acceptable container, and draws `kind` to the others' targets when the rule names one.
 */
export const EvaluatedNestingSchema = z.strictObject({
  /** Position of the producing rule in the type's `nestsIn` list. */
  rule: CountSchema,
  /** The value as read from the asset; JSON text when it is not a string. */
  raw: z.string(),
  /** Absent when the value is not a reference its normaliser understands. */
  target: RelationTargetSchema.exactOptional(),
  /** The relation drawn instead when the asset does not nest in the target. */
  kind: CatalogRelationKindSchema.exactOptional(),
});
export type EvaluatedNesting = z.infer<typeof EvaluatedNestingSchema>;
