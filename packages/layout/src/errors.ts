// SPDX-License-Identifier: MIT
/**
 * Typed errors. The layout refuses a Scene it cannot draw correctly instead of drawing half of it (skill
 * gcp-diagram-layout §2 rule 5): the UI shows the code and the offending ids.
 */

export type LayoutInputErrorCode =
  /** Two Scene nodes share an id (or one node object appears twice in the tree). */
  | 'duplicate-id'
  /** An edge names a node that is not in the Scene. */
  | 'unknown-endpoint'
  /** A node object contains itself: the tree is not a tree. */
  | 'cycle'
  /** A collapsed zone (a chip) still has children in the Scene. */
  | 'collapsed-with-children'
  /** The Scene nests deeper than `MAX_SCENE_DEPTH` levels. */
  | 'too-deep'
  /** A layout option is not a finite, non-negative number, or a range is inverted. */
  | 'invalid-option';

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
