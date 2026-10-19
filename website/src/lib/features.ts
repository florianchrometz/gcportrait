// SPDX-License-Identifier: Apache-2.0
/**
 * The features' copy: what each feature of gcportrait is called and what it does, in src/data/features.json.
 *
 * That file is the one source of the two front pages' feature blurbs. The landing page (src/pages/index.astro)
 * shows each entry as a feature's heading and paragraph, and `scripts/readme.test.ts` fails when the README's
 * feature cells say anything else, so the site and the README cannot promise different things (the export
 * formats, most of all) a release apart.
 *
 * A paragraph is one sentence or more of plain prose, may carry inline `<code>` (the landing page renders it
 * into the paragraph), and says nothing that only one of the two pages can know: counts the build computes,
 * guide links and page-specific notes stay in the page.
 */
import features from '../data/features.json' with { type: 'json' };

export type FeatureCopy = {
  /** The entry's name, stable across releases; the landing page asks for its features by it. */
  readonly id: string;
  /** The feature's heading on the landing page and in the README's feature cell. */
  readonly title: string;
  /** The paragraph under that heading, identical on both pages. */
  readonly blurb: string;
};

export const FEATURES: readonly FeatureCopy[] = features;

/** A feature's copy by id; an id the list does not have fails the build, never renders an empty feature. */
export function featureCopy(id: string): FeatureCopy {
  const copy = FEATURES.find((entry) => entry.id === id);
  if (copy === undefined) throw new Error(`website: no feature ${id} in src/data/features.json`);
  return copy;
}
