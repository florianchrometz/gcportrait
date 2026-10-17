// SPDX-License-Identifier: MIT
/**
 * @gcportrait/ingest — Cloud Asset Inventory NDJSON (exports and the backend's frame stream) into a model
 * Snapshot (the model's `SnapshotSchema`; the CAI facts in skill cai-ingestion). Pure and worker-safe: no
 * DOM, no Node APIs, no clock or random source of its own (the caller passes both). This file is the only
 * public surface.
 */
export { ingest, readLines, type ReadLinesOptions, type TextLine } from './ingest.js';

export {
  DEFAULT_MAX_LINE_BYTES,
  DEFAULT_PROGRESS_EVERY_BYTES,
  MAX_REPORTED_PROBLEMS,
  createIngestSession,
  type IngestEvent,
  type IngestOptions,
  type IngestReport,
  type IngestResult,
  type IngestSession,
  type IngestSettings,
  type ReadTimeOrigin,
  type ReadTimeSource,
  type UpstreamSummary,
} from './session.js';

export type { IngestChunk, IngestInput, IngestSource } from './sources.js';
export type { BlobLike, ByteStream, ByteStreamReader, ByteStreamReadResult } from './platform.js';

export {
  IngestError,
  type IngestErrorCode,
  type IngestErrorDetails,
  type IngestProblem,
  type IngestProblemCode,
  type UpstreamFailure,
} from './errors.js';

export { normaliseAsset, projectNumberOf, type NormaliseResult } from './normalise.js';

// A snapshot id as ingest makes it, for callers that give a snapshot a new id (the app's import of a copy).
export { ulid } from './ulid.js';

// The index itself is the model's ProjectIndex (import the type from @gcportrait/model); a stored snapshot's
// index is built by buildProjectIndex in @gcportrait/model, the same rule as report.projects.
export type { UnresolvedProjects } from './project-index.js';
