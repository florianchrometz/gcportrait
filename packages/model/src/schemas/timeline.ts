// SPDX-License-Identifier: MIT
/**
 * Timeline types shared by `packages/graph` (diff) and the UI (skill cai-ingestion §5, docs/timeline.md).
 */
import * as z from 'zod';
import { DateSchema, ResourceNameSchema } from './primitives.js';

/**
 * A timeline tick. A day tick is a UTC calendar day, `YYYY-MM-DD`: today and the previous 34 days at 00:00 UTC. An
 * extra tick (an export or a manual pull of the same scope kept in the browser) is its read time to the
 * second in UTC, `YYYY-MM-DDTHH:MM:SSZ`, so a link names it the same way in every browser that holds it.
 */
export const TickSchema = z.union([DateSchema, z.iso.datetime({ precision: 0 })]);
export type Tick = z.infer<typeof TickSchema>;

/**
 * The difference between the displayed tick and the previously displayed one, as asset names: `added` exist
 * now but did not before, `removed` existed before but not now, `changed` exist in both with a different
 * `updateTime`. A name appears in at most one list, once.
 */
export const DiffSchema = z
  .strictObject({
    added: z.array(ResourceNameSchema),
    removed: z.array(ResourceNameSchema),
    changed: z.array(ResourceNameSchema),
  })
  .superRefine((diff, ctx) => {
    const seen = new Set<string>();
    for (const list of ['added', 'removed', 'changed'] as const) {
      diff[list].forEach((name, index) => {
        if (seen.has(name))
          ctx.addIssue({ code: 'custom', path: [list, index], message: `${name} is listed twice` });
        seen.add(name);
      });
    }
  });
export type Diff = z.infer<typeof DiffSchema>;
