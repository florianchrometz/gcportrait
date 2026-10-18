// SPDX-License-Identifier: Apache-2.0
/**
 * A demo organisation's 35-day history (packages/demo-data): what the app stores in IndexedDB and writes into a
 * `.gcportrait.json` bundle, and what the render API's headless entry replays. It crosses three package
 * boundaries, so it is declared once here (AGENTS.md, Data and graph semantics).
 */
import * as z from 'zod';
import { AssetSchema } from './asset.js';
import { DateSchema, TimestampSchema } from './primitives.js';
import { DemoSizeSchema } from './view-spec.js';

/** One change between two consecutive ticks. */
export const MutationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('add'), asset: AssetSchema }).readonly(),
  z
    .object({
      kind: z.literal('change'),
      /** The asset as it is after the change (new `updateTime`). */
      asset: AssetSchema,
      /** Dotted paths inside `data` that changed. */
      fields: z.array(z.string()).readonly(),
    })
    .readonly(),
  z.object({ kind: z.literal('remove'), name: z.string(), assetType: z.string() }).readonly(),
]);
export type Mutation = z.infer<typeof MutationSchema>;

/**
 * One day of a history. Its tick is a day (`YYYY-MM-DD`), never an extra tick's read time: a history is 35 days
 * (`TickSchema` also takes a read time, for a timeline's extra ticks).
 */
export const HistoryTickSchema = z
  .object({
    tick: DateSchema,
    /** `<tick>T00:00:00Z`: the CAI read time of this tick. */
    readTime: TimestampSchema,
    /** What happened since the previous tick (during the day before `tick`); empty for the first tick. */
    mutations: z.array(MutationSchema).readonly(),
  })
  .readonly();
export type HistoryTick = z.infer<typeof HistoryTickSchema>;

/**
 * The organisation at its first tick (`base`) and every mutation since, replayed to the last tick (`today`).
 * Unknown keys are stripped, so a newer bundle still parses; the last tick must be `today`.
 */
export const DemoHistorySchema = z
  .object({
    size: DemoSizeSchema,
    seed: z.int(),
    today: DateSchema,
    /** The organisation at the first tick, sorted by name. */
    base: z.array(AssetSchema).readonly(),
    /** 35 ticks, oldest first; the last one is `today`. */
    ticks: z.array(HistoryTickSchema).min(1).readonly(),
  })
  .readonly()
  .superRefine((history, ctx) => {
    // The min(1) and the day check report on their own; this adds one issue, at `ticks`, only when both hold.
    if (history.ticks.length === 0 || !DateSchema.safeParse(history.today).success) return;
    if (history.ticks.at(-1)?.tick !== history.today)
      ctx.addIssue({ code: 'custom', path: ['ticks'], message: 'the last tick is not the history day' });
  });
export type DemoHistory = z.infer<typeof DemoHistorySchema>;
