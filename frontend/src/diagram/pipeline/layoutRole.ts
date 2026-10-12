// SPDX-License-Identifier: MIT
/**
 * The layout role of the diagram worker (diagram.worker.ts): `@gcportrait/layout`'s handler with its
 * memo and cancellation, and a clock for the report's timings.
 */
import { createLayoutWorkerHandler, type LayoutWorkerResponse } from '@gcportrait/layout';

export function startRole(post: (message: LayoutWorkerResponse) => void): (message: unknown) => void {
  return createLayoutWorkerHandler(post, { clock: () => performance.now() });
}
