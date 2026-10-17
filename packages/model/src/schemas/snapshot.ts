// SPDX-License-Identifier: MIT
/**
 * Snapshot: every asset of one scope at one read time, plus the versioned entry point that turns stored or
 * imported JSON into the current Snapshot shape (the README's "Migration policy").
 */
import * as z from 'zod';
import { AssetSchema } from './asset.js';
import {
  AssetTypeSchema,
  CountSchema,
  NonEmptyStringSchema,
  PROJECT_REF_PATTERN,
  TimestampSchema,
  UlidSchema,
} from './primitives.js';

/** The Snapshot format version this build writes and reads. Bump it only together with a migration. */
export const SNAPSHOT_SCHEMA_VERSION = 1;

/** The three kinds of Cloud Asset Inventory scope. */
export const ScopeKindSchema = z.enum(['organization', 'folder', 'project']);
export type ScopeKind = z.infer<typeof ScopeKindSchema>;

/** The scope a snapshot was read from: `organizations/<id>`, `folders/<id>` or `projects/<id or number>`. */
export const SnapshotScopeSchema = z.object({
  kind: ScopeKindSchema,
  /** The id without its prefix: an organisation or folder number, a project id or number. */
  id: z.string().regex(PROJECT_REF_PATTERN, 'must be an organisation, folder or project id'),
  displayName: NonEmptyStringSchema.exactOptional(),
});
export type SnapshotScope = z.infer<typeof SnapshotScopeSchema>;

/** Where the assets came from. */
export const SnapshotSourceKindSchema = z.enum(['api', 'export', 'demo']);
export type SnapshotSourceKind = z.infer<typeof SnapshotSourceKindSchema>;

export const SnapshotSourceSchema = z.object({
  kind: SnapshotSourceKindSchema,
  /** Free text: the export URI or file names, the demo fixture, the pull mode. Never a token. */
  detail: NonEmptyStringSchema.exactOptional(),
});
export type SnapshotSource = z.infer<typeof SnapshotSourceSchema>;

/**
 * Where a snapshot's `readTime` came from: `api` (the time a live pull asked Cloud Asset Inventory for, or the
 * read time the backend reported), `export-sidecar` (an export's operation metadata, read next to the files),
 * `user` (typed in by the user), or `estimated-max-update-time` (the latest asset `updateTime`, an estimate
 * the UI labels as such; skill cai-ingestion §1).
 */
export const SnapshotReadTimeSourceSchema = z.enum([
  'api',
  'export-sidecar',
  'user',
  'estimated-max-update-time',
]);
export type SnapshotReadTimeSource = z.infer<typeof SnapshotReadTimeSourceSchema>;

/** Counts computed by ingest. `bytes` is the size of the raw input that produced the snapshot. */
export const SnapshotStatsSchema = z.object({
  count: CountSchema,
  byType: z.record(AssetTypeSchema, z.int().min(1)),
  bytes: CountSchema,
});
export type SnapshotStats = z.infer<typeof SnapshotStatsSchema>;

export const SnapshotSchema = z
  .object({
    /** ULID assigned when the snapshot was created. */
    id: UlidSchema,
    schemaVersion: z.literal(SNAPSHOT_SCHEMA_VERSION),
    scope: SnapshotScopeSchema,
    /** The Cloud Asset Inventory read time (RFC 3339). */
    readTime: TimestampSchema,
    /** Where `readTime` came from; absent when unknown (a snapshot file that does not say, an input without any asset). */
    readTimeSource: SnapshotReadTimeSourceSchema.exactOptional(),
    source: SnapshotSourceSchema,
    contentType: z.literal('RESOURCE'),
    assets: z.array(AssetSchema),
    stats: SnapshotStatsSchema,
  })
  .superRefine((snapshot, ctx) => {
    const seen = new Set<string>();
    const byType = new Map<string, number>();
    snapshot.assets.forEach((asset, index) => {
      if (seen.has(asset.name)) {
        ctx.addIssue({ code: 'custom', path: ['assets', index, 'name'], message: 'duplicate asset name' });
      }
      seen.add(asset.name);
      byType.set(asset.assetType, (byType.get(asset.assetType) ?? 0) + 1);
    });
    if (snapshot.stats.count !== snapshot.assets.length) {
      ctx.addIssue({ code: 'custom', path: ['stats', 'count'], message: 'must equal the number of assets' });
    }
    const declared = Object.entries(snapshot.stats.byType);
    const consistent =
      declared.length === byType.size && declared.every(([type, count]) => byType.get(type) === count);
    if (!consistent) {
      ctx.addIssue({ code: 'custom', path: ['stats', 'byType'], message: 'must count the assets per type' });
    }
  });
export type Snapshot = z.infer<typeof SnapshotSchema>;

/** Why a document could not be turned into a Snapshot. */
export type SnapshotFormatProblem = 'not-an-object' | 'unknown-version' | 'newer-version' | 'invalid';

/** Thrown by {@link migrateSnapshot}. `issues` lists the schema violations when `problem` is `invalid`. */
export class SnapshotFormatError extends Error {
  readonly problem: SnapshotFormatProblem;
  readonly issues: readonly z.core.$ZodIssue[];

  constructor(problem: SnapshotFormatProblem, message: string, issues: readonly z.core.$ZodIssue[] = []) {
    super(message);
    this.name = 'SnapshotFormatError';
    this.problem = problem;
    this.issues = issues;
  }
}

const DocumentSchema = z.record(z.string(), z.unknown());
const VersionSchema = z.int().min(1);

/**
 * The only way to read a snapshot that was stored (IndexedDB) or loaded from a file: checks the format
 * version and validates the document. Throws {@link SnapshotFormatError}; never returns a partial snapshot.
 *
 * Migration policy: when the format changes, bump {@link SNAPSHOT_SCHEMA_VERSION}, keep a frozen copy of the
 * previous schema, and upgrade older documents here, one version step at a time, before the final parse
 * below. A document from a newer build is refused (`newer-version`) rather than guessed at.
 */
export function migrateSnapshot(input: unknown): Snapshot {
  const document = DocumentSchema.safeParse(input);
  if (!document.success) {
    throw new SnapshotFormatError('not-an-object', 'A snapshot must be a JSON object.');
  }
  const version = VersionSchema.safeParse(document.data['schemaVersion']);
  if (!version.success) {
    throw new SnapshotFormatError('unknown-version', 'The snapshot has no valid schemaVersion.');
  }
  if (version.data > SNAPSHOT_SCHEMA_VERSION) {
    throw new SnapshotFormatError(
      'newer-version',
      `The snapshot uses format version ${String(version.data)}; this build reads version ` +
        `${String(SNAPSHOT_SCHEMA_VERSION)}. Update gcportrait to open it.`,
    );
  }
  // Version 1 is the first format, so there is nothing to upgrade yet. Future migrations hook in here.
  const parsed = SnapshotSchema.safeParse(document.data);
  if (!parsed.success) {
    throw new SnapshotFormatError(
      'invalid',
      'The snapshot does not match the Snapshot schema.',
      parsed.error.issues,
    );
  }
  return parsed.data;
}
