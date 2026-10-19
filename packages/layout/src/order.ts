// SPDX-License-Identifier: Apache-2.0
/**
 * Deterministic sibling order (skill gcp-diagram-layout §4): zones before cards; zones by kind rank (folder,
 * project, VPC, subnet, region, product container, bundle); then by label in code-point order
 * (locale-independent); then by id. Ids are unique, so the order is total and never depends on the order the
 * Scene lists its children in.
 */
export { compareCodePoints, compareSiblings, type Orderable } from '@gcportrait/model';
