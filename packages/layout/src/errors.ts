// SPDX-License-Identifier: Apache-2.0
/**
 * Typed errors. The layout refuses a Scene it cannot draw correctly instead of drawing half of it (skill
 * gcp-diagram-layout §2 rule 5): the UI shows the code and the offending ids.
 */

import type { LayoutInputErrorCode } from '@gcportrait/model';

export type { LayoutInputErrorCode } from '@gcportrait/model';

export class LayoutInputError extends Error {
  readonly code: LayoutInputErrorCode;
  /**
   * The ids at fault: the duplicated id, an edge's two ends, the ids around a cycle, a chip and its children,
   * the top-level node and the node below the depth limit, the option names.
   */
  readonly ids: readonly string[];

  constructor(code: LayoutInputErrorCode, ids: readonly string[], message: string) {
    super(message);
    this.name = 'LayoutInputError';
    this.code = code;
    this.ids = ids;
  }
}
