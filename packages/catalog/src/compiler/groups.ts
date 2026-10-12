// SPDX-License-Identifier: MIT
/**
 * Authoring groups (ADR 0021): `known-unmapped/<group>.yaml` says which official
 * types a group owns (`owns`: exact types or `<service>/*` globs) and which of them it has not mapped yet
 * (`types`, each with a reason). Ownership lets `pnpm catalog:check --group <group>` check one group's files
 * while others are mid-edit, and the coverage report count per group. Pure.
 */
import { AssetTypePatternSchema, AssetTypeSchema, NonEmptyStringSchema } from '@gcportrait/model';
import { z } from 'zod';
import { serviceOf } from '../engine/rules.js';
import type { SourceFile } from './types.js';

/** `known-unmapped/<group>.yaml`. */
export const KnownUnmappedSchema = z.strictObject({
  /** What the group covers, e.g. `Networking fabric`. */
  title: NonEmptyStringSchema,
  /**
   * The types the group owns, mapped or not: exact asset types, or `<service>/*` for a whole service. The most
   * specific pattern wins, so a group may own a whole service while another owns one of its types.
   */
  owns: z.array(AssetTypePatternSchema).default(() => []),
  /** Owned official types not mapped yet, each with the reason; each must match the group's own `owns`. */
  types: z.record(AssetTypeSchema, NonEmptyStringSchema).default(() => ({})),
});

/** A group file's path: `known-unmapped/<stem>.yaml`, the stem in lower-case kebab case. */
export const GROUP_FILE = /^known-unmapped\/([a-z0-9]+(?:-[a-z0-9]+)*)\.yaml$/;

export interface Group {
  /** The file stem: what `--group` takes. */
  readonly stem: string;
  readonly title: string;
  readonly file: SourceFile;
  readonly owns: readonly string[];
  /** Listed (unmapped) type → reason. */
  readonly types: ReadonlyMap<string, string>;
}

/** Reports one problem; the compiler's violation collector. */
export type AddViolation = (
  code:
    | 'schema'
    | 'file-name'
    | 'known-unmapped-but-mapped'
    | 'known-unmapped-not-official'
    | 'known-unmapped-duplicate'
    | 'known-unmapped-wrong-group'
    | 'group-owns'
    | 'group-overlap',
  message: string,
  file: SourceFile,
  path: ReadonlyArray<PropertyKey>,
  related?: readonly string[],
) => void;

/** The groups and who owns what: needs only the group files, so the compiler resolves it before anything else. */
export interface Ownership {
  /** The groups whose file parsed, in path order. */
  readonly groups: readonly Group[];
  /** The group that owns a type: the one with the most specific `owns` pattern matching it. */
  readonly ownerOf: (assetType: string) => Group | undefined;
  /** Every group whose `owns` matches a type at the winning specificity; more than one is a `group-overlap`. */
  readonly claimants: (assetType: string) => readonly Group[];
}

export interface GroupAnalysis extends Ownership {
  /** Each listed type's first listing. */
  readonly listed: ReadonlyMap<string, { readonly group: Group; readonly reason: string }>;
}

/**
 * Where each mapped type is described (the description that stays), and the groups that file belongs to: a
 * listed type mapped in its owner's file is a stale listing; mapped in another group's file, it is that file's
 * problem (`product-file-group`), and the owner's listing stays until the owner maps it.
 */
export type MappedTypes = ReadonlyMap<
  string,
  { readonly file: SourceFile; readonly groups?: readonly Group[] }
>;

function comparePaths(a: SourceFile, b: SourceFile): number {
  if (a.path < b.path) return -1;
  return a.path > b.path ? 1 : 0;
}

/** Parses the group files and resolves ownership; reports misnamed and invalid group files through `add`. */
export function parseGroups(
  files: readonly SourceFile[],
  add: AddViolation,
  schemaIssues: (file: SourceFile, issues: ReadonlyArray<z.core.$ZodIssue>) => void,
): Ownership {
  const groups: Group[] = [];
  // In path order, whatever order the loader used, so "first" listings and owners are deterministic.
  for (const file of [...files].sort(comparePaths)) {
    const stem = GROUP_FILE.exec(file.path)?.[1];
    if (stem === undefined) {
      add(
        'file-name',
        'a group file is known-unmapped/<group>.yaml, the group in lower-case kebab case',
        file,
        [],
      );
      continue;
    }
    const parsed = KnownUnmappedSchema.safeParse(file.content);
    if (!parsed.success) {
      schemaIssues(file, parsed.error.issues);
      continue;
    }
    groups.push({
      stem,
      title: parsed.data.title,
      file,
      owns: parsed.data.owns,
      types: new Map(Object.entries(parsed.data.types)),
    });
  }

  // Patterns by what they match; exact types win over <service>/*, which wins over *.
  const exact = new Map<string, Group[]>();
  const byService = new Map<string, Group[]>();
  const everything: Group[] = [];
  const push = (map: Map<string, Group[]>, key: string, group: Group): void => {
    const list = map.get(key) ?? [];
    if (!list.includes(group)) list.push(group);
    map.set(key, list);
  };
  for (const group of groups) {
    for (const pattern of group.owns) {
      if (pattern === '*') {
        if (!everything.includes(group)) everything.push(group);
      } else if (pattern.endsWith('/*')) push(byService, pattern.slice(0, -2), group);
      else push(exact, pattern, group);
    }
  }
  const claimants = (assetType: string): readonly Group[] =>
    exact.get(assetType) ?? byService.get(serviceOf(assetType)) ?? everything;
  return { groups, claimants, ownerOf: (assetType) => claimants(assetType)[0] };
}

/** Checks the group files against the official list and the catalog; reports every inconsistency through `add`. */
export function analyseGroups(
  ownership: Ownership,
  official: ReadonlySet<string>,
  mapped: MappedTypes,
  add: AddViolation,
): GroupAnalysis {
  const { groups, claimants, ownerOf } = ownership;

  // Listings: the first one counts; a second is a duplicate.
  const listed = new Map<string, { group: Group; reason: string }>();
  for (const group of groups) {
    for (const [assetType, reason] of group.types) {
      const first = listed.get(assetType);
      if (first !== undefined) {
        add(
          'known-unmapped-duplicate',
          `${assetType} is listed in both ${first.group.file.path} and ${group.file.path}: keep it in the group that owns it`,
          group.file,
          ['types', assetType],
          [first.group.file.path],
        );
        continue;
      }
      listed.set(assetType, { group, reason });
    }
  }

  const universe = new Set([...official, ...mapped.keys(), ...listed.keys()]);
  for (const assetType of [...universe].sort()) {
    const [first, ...others] = claimants(assetType);
    if (first === undefined) continue;
    for (const other of others) {
      add(
        'group-overlap',
        `${assetType} is owned by both ${first.file.path} and ${other.file.path} at the same specificity: one of them must give it up`,
        other.file,
        ['owns'],
        [first.file.path],
      );
    }
  }

  for (const group of groups) {
    for (const [assetType] of group.types) {
      if (listed.get(assetType)?.group !== group) continue;
      const owner = ownerOf(assetType);
      const product = mapped.get(assetType);
      // Stale only once the owner maps the type in a file of its own: mapped in another group's file, it is that
      // file's problem (product-file-group, a note for the owner), and this line stays until the owner maps it.
      const byOwner =
        owner === undefined ||
        product?.groups === undefined ||
        product.groups.length === 0 ||
        product.groups.includes(owner);
      if (product !== undefined && byOwner) {
        add(
          'known-unmapped-but-mapped',
          `${assetType} is mapped in ${product.file.path} now: remove it from ${group.file.path}`,
          group.file,
          ['types', assetType],
          [product.file.path],
        );
      }
      if (!official.has(assetType)) {
        add(
          'known-unmapped-not-official',
          `${assetType} is not on the official list: remove it from ${group.file.path}`,
          group.file,
          ['types', assetType],
        );
      }
      if (owner === undefined) {
        add(
          'known-unmapped-wrong-group',
          `${assetType} is listed here but no group owns it: add it (or its <service>/*) to owns`,
          group.file,
          ['types', assetType],
        );
      } else if (owner !== group) {
        add(
          'known-unmapped-wrong-group',
          `${assetType} is owned by ${owner.file.path} (its owns patterns): list it there, not in ${group.file.path}`,
          group.file,
          ['types', assetType],
          [owner.file.path],
        );
      }
    }
    group.owns.forEach((pattern, i) => {
      const matches =
        pattern === '*'
          ? universe.size > 0
          : pattern.endsWith('/*')
            ? [...universe].some((assetType) => serviceOf(assetType) === pattern.slice(0, -2))
            : universe.has(pattern);
      if (!matches) {
        add('group-owns', `${pattern} matches no official or catalog type`, group.file, ['owns', i]);
      }
    });
  }

  return { ...ownership, listed };
}
