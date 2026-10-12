// SPDX-License-Identifier: MIT
/**
 * Inputs and outputs of the catalog compiler. The compiler itself is pure: the Node tooling reads the files
 * (YAML, JSON, the official snapshot) and hands their parsed content in, so tests can compile planted
 * catalogs from memory.
 */
import type { Catalog, NodeRole } from '@gcportrait/model';

/** One parsed data file. */
export interface SourceFile {
  /** Path relative to the catalog root, with `/` separators: `products/compute.googleapis.com.yaml`. */
  readonly path: string;
  /** The parsed YAML or JSON. */
  readonly content: unknown;
  /** The 1-based line of a path inside the content, when the loader knows it. */
  readonly lineOf?: (path: ReadonlyArray<PropertyKey>) => number | undefined;
  /**
   * The file's text as read: fixtures, so that findings in it can name their line, and YAML files, so that a
   * product file that does not validate can still be attributed to a group by the types it names.
   */
  readonly text?: string;
}

/** A data file that is not valid YAML or JSON: only its text, for attributing it to a group. */
export interface UnparsedFile {
  readonly path: string;
  readonly text: string;
}

/** Everything the catalog is compiled from. */
export interface CatalogSources {
  /** `products/<service>[.<suffix>].yaml`; several files may describe one service. */
  readonly products: readonly SourceFile[];
  /** `lenses/<lens id>.yaml`. */
  readonly lenses: readonly SourceFile[];
  /** `fixtures/<service>/<Type>.json`: one asset or an array of assets of that type. */
  readonly fixtures: readonly SourceFile[];
  /** `known-unmapped/<group>.yaml`: one file per authoring group (its owned types and its unmapped ones). */
  readonly knownUnmapped: readonly SourceFile[];
  /** `icon-keys.json`; undefined when the file is missing. */
  readonly iconKeys: SourceFile | undefined;
  /** Problems the loader found: unreadable or unparsable files, files with unexpected names. */
  readonly loadViolations: readonly Violation[];
  /**
   * The files behind the `load` violations that could be read but not parsed, with their text: a product file
   * mid-edit is attributed to the group whose types it names, so it never fails another group's scoped check.
   */
  readonly unparsed?: readonly UnparsedFile[];
}

/** The official supported-asset-types list (a dated snapshot under the gcp-asset-catalog skill). */
export interface OfficialList {
  /** The snapshot date, `YYYY-MM-DD`. */
  readonly date: string;
  /** Where it was read from, for messages. */
  readonly file: string;
  readonly types: ReadonlySet<string>;
  /** Product section of each type on the official page, when the snapshot's products file exists. */
  readonly productOf?: ReadonlyMap<string, string>;
}

export const VIOLATION_CODES = [
  'load',
  'schema',
  'file-name',
  'syntax',
  'duplicate-type',
  'product-mismatch',
  'not-official',
  'deprecated-but-official',
  'unmapped',
  'known-unmapped-but-mapped',
  'known-unmapped-not-official',
  'known-unmapped-duplicate',
  'known-unmapped-wrong-group',
  'group-owns',
  'group-overlap',
  'group-mixed-file',
  'product-file-group',
  'unknown-icon',
  'unused-icon',
  'rule-without-fixture',
  'rule-unproven',
  'template-unproven',
  'hidden-unproven',
  'fixture-invalid',
  'fixture-without-rules',
  'fixture-not-synthetic',
  'container-child',
  'lens-missing',
  'lens-pattern',
  'product-name',
  'generated-committed',
] as const;

export type ViolationCode = (typeof VIOLATION_CODES)[number];

/** One problem: a violation fails `pnpm catalog:check`; a warning is reported and does not. */
export interface Violation {
  readonly code: ViolationCode;
  readonly message: string;
  /** The file, relative to the catalog root (or the official list's path). */
  readonly file?: string;
  /** 1-based line in that file, when known. */
  readonly line?: number;
  /** Other files the problem involves (the first description of a duplicated type, say). */
  readonly related?: readonly string[];
}

export type RoleCounts = Record<NodeRole, number>;

/** Coverage of one authoring group (`known-unmapped/<group>.yaml`) over the official types it owns. */
export interface GroupCoverage {
  /** The file stem, e.g. `networking-fabric`: what `--group` takes. */
  readonly group: string;
  readonly title: string;
  /** `known-unmapped/<group>.yaml`. */
  readonly file: string;
  /** Official types the group owns (by its `owns` patterns, or by listing them). */
  readonly official: number;
  /** Of those, the ones the catalog maps, by role. */
  readonly mapped: RoleCounts & { readonly total: number };
  /** Of those, the ones listed as unmapped, with their reasons. */
  readonly unmapped: {
    readonly total: number;
    readonly byReason: Readonly<Record<string, number>>;
    readonly types: Readonly<Record<string, string>>;
  };
  /** Owned official types that are neither mapped nor listed (each also an `unmapped` violation). */
  readonly missing: readonly string[];
  /** Mapped share of `official`, one decimal. */
  readonly coveragePercent: number;
  /**
   * The group's product files, for `--group`: a shared service's files named after the group, other files
   * holding its types (a file that does not parse: by the type keys in its text), and files without types of
   * one of its services. Then its fixture files, by type.
   */
  readonly productFiles: readonly string[];
  readonly fixtureFiles: readonly string[];
}

/** The coverage report of skill gcp-asset-catalog §8; `--json` prints exactly this object. */
export interface CoverageReport {
  readonly officialList: { readonly date: string; readonly file: string; readonly total: number };
  /** Official types the catalog maps, by role, and their total. */
  readonly mapped: RoleCounts & { readonly total: number };
  /** Mapped official types as a percentage of the official total, one decimal. */
  readonly coveragePercent: number;
  /** Official types the catalog does not map: listed in known-unmapped/, or not (each a violation). */
  readonly unmapped: {
    readonly total: number;
    readonly known: number;
    readonly knownByReason: Readonly<Record<string, number>>;
    readonly unlisted: readonly string[];
  };
  /** Catalog types that are not on the official list: marked deprecated, or not (each a violation). */
  readonly notOfficial: { readonly deprecated: readonly string[]; readonly unmarked: readonly string[] };
  readonly unusedIconKeys: readonly string[];
  /**
   * Icon keys products and types use that `icon-keys.json` does not list yet: warnings, violations with
   * `--strict-icons` (packages/icons resolves every key either way).
   */
  readonly pendingIconKeys: readonly string[];
  /** `<type> relations[i]` (or `ips[i]`, `domains[i]`, `contains[i]`, `aliases[i]`) with no fixture proving them. */
  readonly rulesWithoutFixtures: readonly string[];
  /** Fixture files whose type has no catalog entry. */
  readonly fixturesWithoutRules: readonly string[];
  /**
   * Mapped types without a `console` template, sorted: the app offers their project's console home
   * instead. A count in the report, the list with `--verbose`; never a violation.
   */
  readonly typesWithoutConsole: readonly string[];
  /** Per authoring group, in file order. */
  readonly groups: readonly GroupCoverage[];
  /** Official types no group owns (by `owns` or by listing them). */
  readonly ungrouped: readonly string[];
  readonly counts: {
    readonly products: number;
    readonly productFiles: number;
    readonly types: number;
    readonly rules: number;
    readonly fixtures: number;
    readonly typesWithoutFixtures: number;
    readonly lenses: number;
    readonly iconKeys: number;
    readonly groups: number;
  };
  readonly violations: readonly Violation[];
  /** Reported, never failing (pending icon keys). */
  readonly warnings: readonly Violation[];
}

/** One value a rule read from one fixture, and what it became. */
export interface TraceResult {
  /** The fixture asset's name. */
  readonly fixture: string;
  /** The value as read (JSON text when it is not a string). */
  readonly raw: string;
  /** The normalised name, `alias:<key>`, address or host; undefined when nothing came of it (dangling). */
  readonly resolved?: string;
}

/** A rule (or template) of a type and what it produced on the type's fixtures. */
export interface RuleTrace {
  /** `relations[0] runsAs $.data.serviceAccount → serviceAccountEmail`, `ips[1] $.data.x`, `label {{…}}`. */
  readonly rule: string;
  readonly results: readonly TraceResult[];
}

/** The fixture resolution of every rule of one type (`pnpm catalog:check --verbose`). */
export interface TypeTrace {
  readonly assetType: string;
  readonly file: string;
  readonly rules: readonly RuleTrace[];
}

export interface CompileOptions {
  /** Semantic version stamped into the compiled catalog. */
  readonly version: string;
  /** Unknown icon keys fail instead of being warnings. */
  readonly strictIcons?: boolean;
  /** Also trace every rule's fixture resolution (`--verbose`). */
  readonly trace?: boolean;
}

export interface CompileResult {
  /**
   * The compiled catalog; undefined when the sources do not even validate against the schemas. It holds only
   * the types without a violation of their own, so a half-finished entry never reaches the graph builder.
   */
  readonly catalog: Catalog | undefined;
  /** Types described validly enough to compile but left out of `catalog` for a violation of their own. */
  readonly excluded: readonly string[];
  readonly report: CoverageReport;
  /** With `trace: true`: every type's rules, rule by rule, fixture by fixture. */
  readonly trace?: readonly TypeTrace[];
}
