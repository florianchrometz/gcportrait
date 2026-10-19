// SPDX-License-Identifier: Apache-2.0
/**
 * For tests only (codec/view-hash.property.test.ts; not part of the `./testing` export): `normalizeViewSpec`
 * written with zod, every field judged by its zod schema's `safeParse`. The zod-free normaliser
 * (codec/normalize.ts) must give the same result for any input; this is the oracle the property test compares
 * it with.
 */
import * as z from 'zod';
import { DetailLevelSchema, LensIdSchema } from '../schemas/lens.js';
import {
  AssetTypePatternSchema,
  LocationSchema,
  NumericIdSchema,
  ProjectRefSchema,
  TextSchema,
} from '../schemas/primitives.js';
import { TickSchema } from '../schemas/timeline.js';
import {
  DEFAULT_VIEW_SPEC,
  DepthSchema,
  FlipIdSchema,
  FocusKindSchema,
  FocusParamNameSchema,
  SnapshotRefSchema,
  VIEW_SPEC_MAX_FLIPS,
  type Focus,
  type ViewFilters,
  type ViewSpec,
} from '../schemas/view-spec.js';

const PlainRecordSchema = z.record(z.string(), z.unknown());

function plainRecord(value: unknown): Record<string, unknown> {
  return PlainRecordSchema.safeParse(value).data ?? {};
}

function valid<T>(schema: z.ZodType<T>, value: unknown): T | undefined {
  const result = schema.safeParse(value);
  return result.success ? result.data : undefined;
}

function validItems<T>(schema: z.ZodType<T>, value: unknown): T[] {
  const items: unknown[] = Array.isArray(value) ? value : [];
  return items.flatMap((item) => {
    const result = schema.safeParse(item);
    return result.success ? [result.data] : [];
  });
}

function canonicalSet(schema: z.ZodType<string>, value: unknown): string[] | undefined {
  const items = [...new Set(validItems(schema, value))].sort();
  return items.length > 0 ? items : undefined;
}

function canonicalFocus(value: unknown): Focus | undefined {
  const focus = plainRecord(value);
  const kind = valid(FocusKindSchema, focus['kind']);
  if (kind === undefined) return undefined;
  const params = Object.entries(plainRecord(focus['params']))
    .flatMap(([name, text]): [string, string][] => {
      const parsed = valid(TextSchema, text);
      return FocusParamNameSchema.safeParse(name).success && parsed !== undefined ? [[name, parsed]] : [];
    })
    .sort(([a], [b]) => (a < b ? -1 : 1));
  return { kind, params: Object.fromEntries(params) };
}

function canonicalFilters(value: unknown): ViewFilters {
  const input = plainRecord(value);
  const result: ViewFilters = {
    hideEmptyProjects: valid(z.boolean(), input['hideEmptyProjects']) ?? false,
    hideEmptyFolders: valid(z.boolean(), input['hideEmptyFolders']) ?? false,
    hideDisconnected: valid(z.boolean(), input['hideDisconnected']) ?? false,
  };
  const lists = [
    ['regions', LocationSchema],
    ['projects', ProjectRefSchema],
    ['folders', NumericIdSchema],
    ['includeTypes', AssetTypePatternSchema],
    ['excludeTypes', AssetTypePatternSchema],
  ] as const;
  for (const [field, schema] of lists) {
    const items = canonicalSet(schema, input[field]);
    if (items) result[field] = items;
  }
  const depth = valid(DepthSchema, input['depth']);
  if (depth !== undefined) result.depth = depth;
  const showRegions = valid(z.boolean(), input['showRegions']);
  if (showRegions !== undefined) result.showRegions = showRegions;
  const showIdentities = valid(z.boolean(), input['showIdentities']);
  if (showIdentities !== undefined) result.showIdentities = showIdentities;
  return result;
}

export function referenceNormalize(input: unknown): ViewSpec {
  const loose = plainRecord(input);
  const newestFirst = [...new Set(validItems(FlipIdSchema, loose['flips']).reverse())];
  const spec: ViewSpec = {
    snapshot: valid(SnapshotRefSchema, loose['snapshot']) ?? DEFAULT_VIEW_SPEC.snapshot,
    lens: valid(LensIdSchema, loose['lens']) ?? DEFAULT_VIEW_SPEC.lens,
    filters: canonicalFilters(loose['filters']),
    detail: valid(DetailLevelSchema, loose['detail']) ?? DEFAULT_VIEW_SPEC.detail,
    flips: newestFirst.slice(0, VIEW_SPEC_MAX_FLIPS).reverse(),
  };
  const tick = valid(TickSchema, loose['tick']);
  if (tick !== undefined) spec.tick = tick;
  const focus = canonicalFocus(loose['focus']);
  if (focus) spec.focus = focus;
  for (const field of ['root', 'selection', 'highlight'] as const) {
    const text = valid(TextSchema, loose[field]);
    if (text !== undefined) spec[field] = text;
  }
  return spec;
}
