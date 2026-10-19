// SPDX-License-Identifier: Apache-2.0
/**
 * The catalog compiler (skill gcp-asset-catalog §2, §3 and §8): validates the product,
 * lens, fixture, known-unmapped and icon-key files, proves every rule against its fixtures with the rule
 * engine itself, checks the catalog against the official asset-type list, and assembles `catalog.json`.
 * Several product files may describe one service (`products/<service>[.<suffix>].yaml`); their types merge,
 * and a type described twice is an error naming both files. Every product file belongs to an authoring group
 * (`known-unmapped/<group>.yaml`): a file whose suffix names a group is that group's (a shared service's files
 * must be named so), any other file belongs to the group that owns its types, so a scoped check (`--group`)
 * sees exactly its group's files, also while they do not parse. A problem is blamed on the file that has to
 * change: a type mapped in another group's file fails that file, not the owner's list. The compiled catalog
 * holds only the types whose own description (the one that stays) has no violation. Pure: the tooling reads
 * the files and passes their parsed content in.
 */
import {
  AssetSchema,
  AssetTypeSchema,
  CatalogEntrySchema,
  CatalogSchema,
  CatalogTypeEntrySchema,
  IconKeySchema,
  LensIdSchema,
  LensSchema,
  NonEmptyStringSchema,
  buildProjectIndex,
  compareText,
  type Asset,
  type Catalog,
  type CatalogEntry,
  type CatalogProduct,
  type CatalogType,
  type CatalogTypeEntry,
  type Lens,
  type LensId,
} from '@gcportrait/model';
import { findNonSyntheticData } from '@gcportrait/model/testing';
import * as z from 'zod';
import { parseJsonPath } from '../engine/jsonpath.js';
import { parsePredicate } from '../engine/predicate.js';
import {
  evaluateAliases,
  evaluateContains,
  evaluateNestsIn,
  evaluateRelations,
  extractDomains,
  extractIps,
  hiddenWhenMatches,
  matchesTypePattern,
  nestsByParent,
  serviceOf,
  templateScope,
} from '../engine/rules.js';
import { CatalogSyntaxError } from '../engine/syntax.js';
import { parseTemplate, renderTemplate } from '../engine/template.js';
import { analyseGroups, parseGroups, type Group, type GroupAnalysis } from './groups.js';
import { traceType } from './trace.js';
import type {
  CatalogSources,
  CompileOptions,
  CompileResult,
  CoverageReport,
  GroupCoverage,
  OfficialList,
  RoleCounts,
  SourceFile,
  TypeTrace,
  Violation,
  ViolationCode,
} from './types.js';

export { KnownUnmappedSchema } from './groups.js';

/** A product file with its type entries left unparsed; they are validated one by one. */
const ProductEnvelopeSchema = CatalogEntrySchema.extend({ types: z.record(AssetTypeSchema, z.unknown()) });

/**
 * `icon-keys.json`: the icon keys the catalog declares (`packages/icons` resolves every key a product file
 * uses): a key used but not listed is a pending key (a warning; a violation with `strictIcons`), and a listed
 * key nothing uses is a violation.
 */
export const IconKeysSchema = z.strictObject({
  description: NonEmptyStringSchema,
  keys: z.array(IconKeySchema),
});

const FIXTURE_PATH = /^fixtures\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)\/([A-Za-z][A-Za-z0-9]*)\.json$/;
const LENS_PATH = /^lenses\/([a-z-]+)\.yaml$/;
const PRODUCT_PATH = /^products\/[^/]+\.yaml$/;
const PRODUCT_SUFFIX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** A mapping key that is an asset type, at the start of a line: how a product file names its types. */
const TYPE_KEY = /^[ \t]*["']?([a-z0-9-]+(?:\.[a-z0-9-]+)+\/[A-Za-z][A-Za-z0-9]*)["']?[ \t]*:/gm;

interface TypeRecord {
  readonly assetType: string;
  readonly file: SourceFile;
  readonly product: CatalogEntry;
  readonly entry: CatalogTypeEntry;
}

/** One product file, parsed or not, and the group it belongs to. */
interface ProductRecord {
  readonly path: string;
  /** Undefined when the file is not valid YAML. */
  readonly file?: SourceFile;
  /** The product envelope (types still unparsed), when it validates. */
  readonly envelope?: z.infer<typeof ProductEnvelopeSchema>;
  /** Every type the file names, valid or not (for a file that does not parse: the type keys in its text). */
  readonly declared: readonly string[];
  /** The service its name gives, and the suffix after it (undefined for `products/<service>.yaml`). */
  service?: string | undefined;
  suffix?: string | undefined;
  /** The group its suffix names (`suffixNamesGroup`): then the file is that group's, whatever it holds. */
  named?: Group | undefined;
  /** The groups it belongs to: one, unless an unnamed file mixes types of several groups. */
  groups: readonly Group[];
}

/** The asset types a product file's text names as mapping keys (for a file that does not parse). */
export function typeKeysIn(text: string): string[] {
  return [...new Set([...text.matchAll(TYPE_KEY)].map((match) => match[1] ?? ''))].filter(
    (key) => AssetTypeSchema.safeParse(key).success,
  );
}

/** Whether a product file's suffix names a group: the group's stem, alone or followed by `-<more>`. */
export function suffixNamesGroup(suffix: string, stem: string): boolean {
  return suffix === stem || suffix.startsWith(`${stem}-`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pathText(path: ReadonlyArray<PropertyKey>): string {
  return path
    .map((segment, index) =>
      typeof segment === 'number' ? `[${String(segment)}]` : `${index === 0 ? '' : '.'}${String(segment)}`,
    )
    .join('');
}

function emptyRoles(): RoleCounts {
  return { container: 0, core: 0, leaf: 0, hidden: 0 };
}

function percent(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 1000) / 10;
}

/** Whether a product file's name fits its service: `products/<service>.yaml` or `products/<service>.<suffix>.yaml`. */
export function productFileFits(path: string, service: string): boolean {
  if (path === `products/${service}.yaml`) return true;
  const prefix = `products/${service}.`;
  if (!path.startsWith(prefix) || !path.endsWith('.yaml')) return false;
  return PRODUCT_SUFFIX.test(path.slice(prefix.length, -'.yaml'.length));
}

/** A type as `catalog.json` stores it: where it comes from, its effective icon, no `hiddenWhen: null`. */
function compileType({ assetType, product, entry }: TypeRecord): CatalogType {
  const { hiddenWhen, icon, ...rest } = entry;
  return {
    assetType,
    product: product.product,
    service: product.service,
    ...rest,
    icon: icon ?? product.icon,
    ...(typeof hiddenWhen === 'string' ? { hiddenWhen } : {}),
  };
}

/** Compiles and checks the catalog. Never throws for data of any shape; problems become violations. */
export function compileCatalog(
  sources: CatalogSources,
  official: OfficialList,
  options: CompileOptions,
): CompileResult {
  const violations: Violation[] = [...sources.loadViolations];
  const warnings: Violation[] = [];
  /**
   * Type → the product files with a violation under `types.<type>`. A type whose surviving description is in
   * one of them is left out of catalog.json; a broken copy elsewhere does not take the good one down.
   */
  const faulty = new Map<string, Set<string>>();
  const problem = (
    code: ViolationCode,
    message: string,
    file?: SourceFile | string,
    path: ReadonlyArray<PropertyKey> = [],
    related: readonly string[] = [],
  ): Violation => {
    const source = typeof file === 'string' ? undefined : file;
    const line = source?.lineOf?.(path);
    const filePath = typeof file === 'string' ? file : file?.path;
    return {
      code,
      message,
      ...(filePath === undefined ? {} : { file: filePath }),
      ...(line === undefined ? {} : { line }),
      ...(related.length === 0 ? {} : { related: [...related] }),
    };
  };
  const collect = (violation: Violation, path: ReadonlyArray<PropertyKey>): void => {
    violations.push(violation);
    const [key, assetType] = path;
    const { file } = violation;
    if (file?.startsWith('products/') === true && key === 'types' && typeof assetType === 'string') {
      faulty.set(assetType, (faulty.get(assetType) ?? new Set<string>()).add(file));
    }
  };
  const add = (
    code: ViolationCode,
    message: string,
    file?: SourceFile | string,
    path: ReadonlyArray<PropertyKey> = [],
    related: readonly string[] = [],
  ): void => {
    collect(problem(code, message, file, path, related), path);
  };
  const schemaIssues = (file: SourceFile, issues: ReadonlyArray<z.core.$ZodIssue>): void => {
    for (const issue of issues) {
      add('schema', `${pathText(issue.path) || '(file)'}: ${issue.message}`, file, issue.path);
    }
  };

  // Groups first: ownership decides which group a product file belongs to and which of two descriptions of a
  // type stays. The group files' own problems are reported with the group checks below.
  const deferred: Array<() => void> = [];
  const ownership = parseGroups(
    sources.knownUnmapped,
    (code, message, file, path, related) => {
      deferred.push(() => {
        add(code, message, file, path, related);
      });
    },
    (file, issues) => {
      deferred.push(() => {
        schemaIssues(file, issues);
      });
    },
  );
  const groupIndex = new Map(ownership.groups.map((group, i) => [group, i]));
  const byGroupOrder = (a: Group, b: Group): number => (groupIndex.get(a) ?? 0) - (groupIndex.get(b) ?? 0);
  const ownersOf = (assetTypes: Iterable<string>): Group[] =>
    [
      ...new Set(
        [...assetTypes]
          .map((assetType) => ownership.ownerOf(assetType))
          .filter((g): g is Group => g !== undefined),
      ),
    ].sort(byGroupOrder);

  // Product files, parsed or not -----------------------------------------------------------------------------
  const records: ProductRecord[] = [];
  for (const file of sources.products) {
    const parsed = ProductEnvelopeSchema.safeParse(file.content);
    if (parsed.success) {
      records.push({
        path: file.path,
        file,
        envelope: parsed.data,
        declared: Object.keys(parsed.data.types),
        groups: [],
      });
      continue;
    }
    schemaIssues(file, parsed.error.issues);
    const named =
      isRecord(file.content) && isRecord(file.content['types']) ? Object.keys(file.content['types']) : [];
    const declared = named.filter((key) => AssetTypeSchema.safeParse(key).success);
    records.push({
      path: file.path,
      file,
      declared: declared.length > 0 ? declared : typeKeysIn(file.text ?? ''),
      groups: [],
    });
  }
  const unparsedText = new Map((sources.unparsed ?? []).map((file) => [file.path, file.text]));
  const unparsedPaths = new Set(
    sources.loadViolations
      .map((violation) => violation.file)
      .filter((path): path is string => path !== undefined && PRODUCT_PATH.test(path)),
  );
  for (const path of unparsedPaths) {
    if (!records.some((r) => r.path === path)) {
      records.push({ path, declared: typeKeysIn(unparsedText.get(path) ?? ''), groups: [] });
    }
  }
  /** Every type a product file names, valid or not; an invalid one fails on its own, not as unmapped. */
  const declaredTypes = new Set(records.flatMap((r) => r.declared));

  // Which groups own each service: a service several groups own is shared, and its files carry their group's name.
  const ownersOfService = new Map<string, Set<Group>>();
  const typeUniverse = new Set([
    ...official.types,
    ...declaredTypes,
    ...ownership.groups.flatMap((group) => [
      ...group.types.keys(),
      ...group.owns.filter((pattern) => !pattern.endsWith('*')),
    ]),
  ]);
  for (const assetType of typeUniverse) {
    const service = serviceOf(assetType);
    const owners = ownersOfService.get(service) ?? new Set<Group>();
    const owner = ownership.ownerOf(assetType);
    if (owner !== undefined) owners.add(owner);
    ownersOfService.set(service, owners);
  }
  const serviceOwners = (service: string | undefined): Group[] =>
    service === undefined ? [] : [...(ownersOfService.get(service) ?? [])].sort(byGroupOrder);
  const services = [...ownersOfService.keys()].sort((a, b) => b.length - a.length);
  const stemOf = (r: ProductRecord): string => r.path.slice('products/'.length, -'.yaml'.length);
  for (const r of records) {
    const stem = stemOf(r);
    const fromEnvelope = r.envelope?.service;
    r.service =
      fromEnvelope !== undefined && productFileFits(r.path, fromEnvelope)
        ? fromEnvelope
        : services.find((service) => stem === service || stem.startsWith(`${service}.`));
    if (r.service !== undefined && stem !== r.service) r.suffix = stem.slice(r.service.length + 1);
    const { suffix } = r;
    // The longest group name the suffix starts with: `load-balancing-edge-certs` names load-balancing-edge.
    r.named =
      suffix === undefined
        ? undefined
        : ownership.groups
            .filter((group) => suffixNamesGroup(suffix, group.stem))
            .sort((a, b) => b.stem.length - a.stem.length)[0];
    const declaredOwners = ownersOf(r.declared);
    r.groups =
      r.named !== undefined
        ? [r.named]
        : declaredOwners.length > 0
          ? declaredOwners
          : serviceOwners(r.service);
  }
  // Deterministic order: by service, the plain <service>.yaml first, then by group (group file order), then
  // name. The first file of a product sets its icon; the owner's file keeps a type described twice.
  const rank = (r: ProductRecord): number =>
    r.groups.length === 0
      ? Number.MAX_SAFE_INTEGER
      : Math.min(...r.groups.map((g) => groupIndex.get(g) ?? 0));
  records.sort(
    (a, b) =>
      compareText(a.service ?? stemOf(a), b.service ?? stemOf(b)) ||
      Number(a.suffix !== undefined) - Number(b.suffix !== undefined) ||
      rank(a) - rank(b) ||
      compareText(a.path, b.path),
  );

  // Types: each validated on its own, so one bad entry does not hide the rest of the product.
  const parsedProducts: Array<{
    file: SourceFile;
    entry: CatalogEntry;
    issues: Array<{ path: PropertyKey[]; message: string }>;
  }> = [];
  const descriptions = new Map<string, TypeRecord[]>();
  for (const r of records) {
    if (r.file === undefined || r.envelope === undefined) continue;
    const validTypes: Record<string, CatalogTypeEntry> = {};
    const issues: Array<{ path: PropertyKey[]; message: string }> = [];
    for (const [assetType, value] of Object.entries(r.envelope.types)) {
      const typeEntry = CatalogTypeEntrySchema.safeParse(value);
      if (typeEntry.success) validTypes[assetType] = typeEntry.data;
      else {
        for (const issue of typeEntry.error.issues) {
          const path = ['types', assetType, ...issue.path];
          issues.push({ path, message: `${pathText(path)}: ${issue.message}` });
        }
      }
    }
    const entry: CatalogEntry = { ...r.envelope, types: validTypes };
    parsedProducts.push({ file: r.file, entry, issues });
    for (const [assetType, typeEntry] of Object.entries(validTypes)) {
      descriptions.set(assetType, [
        ...(descriptions.get(assetType) ?? []),
        { assetType, file: r.file, product: entry, entry: typeEntry },
      ]);
    }
  }
  // A type described in several files keeps the description in its owner's file (else the first one).
  const types = new Map<string, TypeRecord>();
  const groupsOfFile = new Map(
    records.flatMap((r) => (r.file === undefined ? [] : [[r.file, r.groups] as const])),
  );
  for (const [assetType, list] of descriptions) {
    const owner = ownership.ownerOf(assetType);
    const home =
      list.find((d) => {
        const groups = groupsOfFile.get(d.file) ?? [];
        return groups.length === 1 && groups[0] === owner;
      }) ?? list[0];
    if (home !== undefined) types.set(assetType, home);
  }
  const products: Array<{ file: SourceFile; entry: CatalogEntry }> = [];
  for (const { file, entry, issues } of parsedProducts) {
    for (const issue of issues) add('schema', issue.message, file, issue.path);
    if (!productFileFits(file.path, entry.service)) {
      add(
        'file-name',
        `a product file is named after its service: products/${entry.service}.yaml or products/${entry.service}.<suffix>.yaml`,
        file,
        ['service'],
      );
    }
    products.push({ file, entry });
    for (const assetType of Object.keys(entry.types)) {
      if (serviceOf(assetType) !== entry.service) {
        add(
          'file-name',
          `${assetType} belongs in a product file of ${serviceOf(assetType)}: products/${serviceOf(assetType)}[.<suffix>].yaml`,
          file,
          ['types', assetType],
        );
      }
      const home = types.get(assetType);
      if (home !== undefined && home.file !== file) {
        const owner = ownership.ownerOf(assetType);
        add(
          'duplicate-type',
          `${assetType} is described in both ${home.file.path} and ${file.path}: describe it once${owner === undefined ? '' : ` (${owner.stem} owns it)`}`,
          file,
          ['types', assetType],
          [home.file.path],
        );
      }
    }
  }

  // Products of one service merge by product name; they must agree on the product icon, which the first file in
  // the order above sets (the plain <service>.yaml, else the first group's file in group file order).
  const merged = new Map<string, { product: CatalogProduct; file: SourceFile }>();
  for (const { file, entry } of products) {
    const key = `${entry.service}\u0000${entry.product}`;
    const first = merged.get(key);
    if (first === undefined) {
      merged.set(key, {
        product: { product: entry.product, service: entry.service, icon: entry.icon, types: [] },
        file,
      });
    } else if (first.product.icon !== entry.icon) {
      add(
        'product-mismatch',
        `${entry.product} (${entry.service}) has icon ${first.product.icon} in ${first.file.path}, the first file of the product, and ${entry.icon} here: use ${first.product.icon} (override single types with their own icon)`,
        file,
        ['icon'],
        [first.file.path],
      );
    }
  }

  // Group of each product file: one group per file, and a shared service's files named after their group.
  // A file named after a group is that group's: another group's type in it is blamed there, where it has to go.
  const fileOf = (service: string, owner: Group): string =>
    serviceOwners(service).length > 1 ? `products/${service}.${owner.stem}.yaml` : `products/${service}.yaml`;
  for (const r of records) {
    const file = r.file ?? r.path;
    const { named } = r;
    if (named !== undefined) {
      for (const assetType of r.declared) {
        const owner = ownership.ownerOf(assetType);
        if (owner === undefined || owner === named) continue;
        add(
          'product-file-group',
          `${assetType} is owned by ${owner.stem}, but this file is ${named.stem}'s (by its name): remove ${assetType} from this file; ${owner.stem} maps it in its own file (${fileOf(serviceOf(assetType), owner)}). If ${named.stem} should own it, say so in your report rather than editing ${owner.file.path}`,
          file,
          ['types', assetType],
          [owner.file.path],
        );
      }
      continue;
    }
    const owners = ownersOf(r.declared);
    if (owners.length > 1) {
      add(
        'group-mixed-file',
        `describes types of several groups (${owners.map((group) => group.stem).join(', ')}): a product file holds one group's types, so groups never edit the same file`,
        file,
        ['types'],
        owners.map((group) => group.file.path),
      );
      continue;
    }
    const { service } = r;
    const sharing = serviceOwners(service);
    if (service === undefined || sharing.length < 2) continue;
    // A shared service's file whose name names no group.
    const [owner] = owners;
    const names = sharing.map((group) => `products/${service}.${group.stem}.yaml`);
    const shared = `${service} is shared by ${sharing.map((group) => group.stem).join(', ')}, so each group's file is products/${service}.<group>.yaml (${names.join(', ')})`;
    add(
      'product-file-group',
      owner === undefined
        ? `names no group: ${shared}`
        : `holds types of ${owner.stem}: name it products/${service}.${owner.stem}.yaml (or …${owner.stem}-<more>.yaml); ${shared}`,
      file,
    );
  }

  // Syntax of paths, predicates and templates -------------------------------------------------------------
  for (const { assetType, file, entry } of types.values()) {
    const at = (...path: PropertyKey[]): PropertyKey[] => ['types', assetType, ...path];
    const check = (path: PropertyKey[], parse: () => unknown): void => {
      try {
        parse();
      } catch (error) {
        if (!(error instanceof CatalogSyntaxError)) throw error;
        add('syntax', `${assetType} ${pathText(path)}: ${error.message}`, file, at(...path));
      }
    };
    entry.relations.forEach((rule, i) => {
      check(['relations', i, 'to'], () => parseJsonPath(rule.to));
    });
    (entry.nestsIn ?? []).forEach((rule, i) => {
      check(['nestsIn', i, 'to'], () => parseJsonPath(rule.to));
    });
    entry.ips.forEach((path, i) => {
      check(['ips', i], () => parseJsonPath(path));
    });
    entry.domains.forEach((path, i) => {
      check(['domains', i], () => parseJsonPath(path));
    });
    entry.contains.forEach((rule, i) => {
      if (typeof rule === 'string') check(['contains', i], () => parseJsonPath(rule));
    });
    (entry.aliases ?? []).forEach((path, i) => {
      check(['aliases', i], () => parseJsonPath(path));
    });
    const { hiddenWhen, subtitle, console: consoleUrl } = entry;
    if (typeof hiddenWhen === 'string') check(['hiddenWhen'], () => parsePredicate(hiddenWhen));
    check(['label'], () => parseTemplate(entry.label));
    if (subtitle !== undefined) check(['subtitle'], () => parseTemplate(subtitle));
    if (consoleUrl !== undefined) check(['console'], () => parseTemplate(consoleUrl));
  }

  // The official list and deprecations -------------------------------------------------------------------
  const notOfficialDeprecated: string[] = [];
  const notOfficialUnmarked: string[] = [];
  for (const { assetType, file, entry } of types.values()) {
    const listed = official.types.has(assetType);
    if (!listed && entry.deprecated === undefined) {
      notOfficialUnmarked.push(assetType);
      add(
        'not-official',
        `${assetType} is not on the official list of ${official.date}: fix the identifier, remove the entry, or mark it deprecated: <date>`,
        file,
        ['types', assetType],
      );
    } else if (!listed) {
      notOfficialDeprecated.push(assetType);
    } else if (entry.deprecated !== undefined) {
      add(
        'deprecated-but-official',
        `${assetType} is marked deprecated but is on the official list of ${official.date}`,
        file,
        ['types', assetType, 'deprecated'],
      );
    }
  }

  // Groups: ownership and the known-unmapped lists ----------------------------------------------------------
  for (const report of deferred) report();
  const analysis: GroupAnalysis = analyseGroups(
    ownership,
    official.types,
    new Map(
      [...types].map(([assetType, { file }]) => [assetType, { file, groups: groupsOfFile.get(file) ?? [] }]),
    ),
    add,
  );

  const unlisted: string[] = [];
  const knownByReason: Record<string, number> = {};
  let unmappedKnown = 0;
  const mapped: RoleCounts = emptyRoles();
  for (const assetType of [...official.types].sort(compareText)) {
    const record = types.get(assetType);
    if (record !== undefined) {
      mapped[record.entry.role] += 1;
      continue;
    }
    const listing = analysis.listed.get(assetType);
    if (declaredTypes.has(assetType)) continue;
    if (listing === undefined) {
      unlisted.push(assetType);
      const owner = analysis.ownerOf(assetType);
      add(
        'unmapped',
        owner === undefined
          ? `${assetType} is on the official list but in no catalog file and no group: map it, or own and list it in a known-unmapped/<group>.yaml`
          : `${assetType} is on the official list but neither in the catalog nor listed in ${owner.file.path}, which owns it`,
        owner?.file,
        owner === undefined ? [] : ['types'],
      );
    } else {
      unmappedKnown += 1;
      knownByReason[listing.reason] = (knownByReason[listing.reason] ?? 0) + 1;
    }
  }

  // Product names ---------------------------------------------------------------------------------------------
  const productOf = official.productOf;
  if (productOf !== undefined) {
    for (const { file, entry } of products) {
      const sections = new Set<string>();
      for (const assetType of Object.keys(entry.types)) {
        const section = productOf.get(assetType);
        if (section !== undefined) sections.add(section);
      }
      if (sections.size > 0 && !sections.has(entry.product)) {
        add(
          'product-name',
          `product "${entry.product}" is not the official product of any of its types (official: ${[...sections].sort(compareText).join(', ')})`,
          file,
          ['product'],
        );
      }
    }
  }

  // Icon keys -------------------------------------------------------------------------------------------------
  const declaredIcons = new Set<string>();
  const iconFile = sources.iconKeys;
  if (iconFile !== undefined) {
    const parsed = IconKeysSchema.safeParse(iconFile.content);
    if (parsed.success) {
      parsed.data.keys.forEach((key, i) => {
        if (declaredIcons.has(key)) add('schema', `icon key ${key} is listed twice`, iconFile, ['keys', i]);
        declaredIcons.add(key);
      });
    } else {
      schemaIssues(iconFile, parsed.error.issues);
    }
  }
  const usedIcons = new Set<string>();
  const pendingIcons = new Set<string>();
  const useIcon = (icon: string, file: SourceFile, path: PropertyKey[]): void => {
    usedIcons.add(icon);
    if (iconFile === undefined || declaredIcons.has(icon)) return;
    pendingIcons.add(icon);
    const finding = problem(
      'unknown-icon',
      `icon key ${icon} is not in icon-keys.json yet${options.strictIcons === true ? '' : ' (pending: a warning without --strict-icons)'}`,
      file,
      path,
    );
    if (options.strictIcons === true) collect(finding, path);
    else warnings.push(finding);
  };
  for (const { file, entry } of products) {
    useIcon(entry.icon, file, ['icon']);
    for (const [assetType, typeEntry] of Object.entries(entry.types)) {
      if (typeEntry.icon !== undefined) useIcon(typeEntry.icon, file, ['types', assetType, 'icon']);
    }
  }
  const unusedIconKeys = [...declaredIcons].filter((key) => !usedIcons.has(key)).sort(compareText);
  for (const key of unusedIconKeys) {
    add('unused-icon', `icon key ${key} is declared but no product or type uses it`, iconFile, ['keys']);
  }

  // Fixtures --------------------------------------------------------------------------------------------------
  const fixturesByType = new Map<string, Asset[]>();
  const fixtureFilesByType = new Map<string, string[]>();
  const fixturesWithoutRules: string[] = [];
  for (const file of sources.fixtures) {
    const match = FIXTURE_PATH.exec(file.path);
    if (match === null) {
      add('file-name', 'a fixture lives at fixtures/<service>/<Type>.json', file);
      continue;
    }
    const assetType = `${match[1] ?? ''}/${match[2] ?? ''}`;
    fixtureFilesByType.set(assetType, [...(fixtureFilesByType.get(assetType) ?? []), file.path]);
    const items: unknown[] = Array.isArray(file.content) ? (file.content as unknown[]) : [file.content];
    if (items.length === 0) add('fixture-invalid', 'a fixture file holds at least one asset', file);
    const assets: Asset[] = [];
    items.forEach((item, i) => {
      const path = Array.isArray(file.content) ? [i] : [];
      const parsed = AssetSchema.safeParse(item);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          add(
            'fixture-invalid',
            `${pathText([...path, ...issue.path]) || '(asset)'}: ${issue.message}`,
            file,
            [...path, ...issue.path],
          );
        }
        return;
      }
      if (parsed.data.assetType !== assetType) {
        add('fixture-invalid', `assetType must be ${assetType} in this file`, file, [...path, 'assetType']);
        return;
      }
      assets.push(parsed.data);
    });
    const text = file.text ?? JSON.stringify(file.content, null, 2);
    for (const finding of findNonSyntheticData(text)) {
      violations.push({
        code: 'fixture-not-synthetic',
        message: `${finding.kind} ${finding.value} (fixtures use synthetic data only)`,
        file: file.path,
        ...(file.text === undefined ? {} : { line: finding.line }),
      });
    }
    if (!declaredTypes.has(assetType)) {
      fixturesWithoutRules.push(file.path);
      add('fixture-without-rules', `${assetType} has no catalog entry: add one or remove the fixture`, file);
    }
    fixturesByType.set(assetType, [...(fixturesByType.get(assetType) ?? []), ...assets]);
  }
  const ctx = { projects: buildProjectIndex([...fixturesByType.values()].flat()) };

  // Rules proven by fixtures ----------------------------------------------------------------------------------
  const rulesWithoutFixtures: string[] = [];
  let ruleCount = 0;
  let typesWithoutFixtures = 0;
  const trace: TypeTrace[] = [];
  for (const { assetType, file, entry } of types.values()) {
    const fixtures = fixturesByType.get(assetType) ?? [];
    if (options.trace === true) trace.push(traceType(assetType, file.path, entry, fixtures, ctx));
    const rules: Array<{ label: string; path: PropertyKey[]; proven: (asset: Asset) => boolean }> = [];
    entry.relations.forEach((rule, i) => {
      rules.push({
        label: `relations[${String(i)}] (${rule.to} → ${rule.normalize})`,
        path: ['relations', i],
        proven: (asset) =>
          evaluateRelations(asset, { relations: [rule] }, ctx).some((r) => r.target !== undefined),
      });
    });
    (entry.nestsIn ?? []).forEach((rule, i) => {
      rules.push({
        label: `nestsIn[${String(i)}] (${rule.to} → ${rule.normalize})`,
        path: ['nestsIn', i],
        proven: (asset) =>
          evaluateNestsIn(asset, { nestsIn: [rule] }, ctx).some((n) => n.target !== undefined),
      });
    });
    entry.ips.forEach((path, i) => {
      rules.push({
        label: `ips[${String(i)}] (${path})`,
        path: ['ips', i],
        proven: (asset) => extractIps(asset, { ips: [path] }).length > 0,
      });
    });
    entry.domains.forEach((path, i) => {
      rules.push({
        label: `domains[${String(i)}] (${path})`,
        path: ['domains', i],
        proven: (asset) => extractDomains(asset, { domains: [path] }).length > 0,
      });
    });
    entry.contains.forEach((rule, i) => {
      if (typeof rule !== 'string') return;
      rules.push({
        label: `contains[${String(i)}] (${rule})`,
        path: ['contains', i],
        proven: (asset) => evaluateContains(asset, { contains: [rule] }, ctx).names.length > 0,
      });
    });
    (entry.aliases ?? []).forEach((path, i) => {
      rules.push({
        label: `aliases[${String(i)}] (${path})`,
        path: ['aliases', i],
        proven: (asset) => evaluateAliases(asset, { aliases: [path] }).length > 0,
      });
    });
    ruleCount += rules.length;
    const { hiddenWhen } = entry;
    if (typeof hiddenWhen === 'string') {
      // A hiddenWhen predicate is proven by a fixture it hides and one it leaves visible.
      const matching = fixtures.filter((asset) => hiddenWhenMatches(asset, entry)).length;
      const missing = [
        ...(matching === 0 ? ['one it matches (starts hidden)'] : []),
        ...(matching === fixtures.length ? ['one it does not match (stays visible)'] : []),
      ];
      if (missing.length > 0) {
        add(
          'hidden-unproven',
          `${assetType} hiddenWhen: no fixture exercises both outcomes; add ${missing.join(' and ')} to fixtures/${serviceOf(assetType)}/${assetType.slice(assetType.indexOf('/') + 1)}.json (${hiddenWhen})`,
          file,
          ['types', assetType, 'hiddenWhen'],
        );
      }
    }
    if (fixtures.length === 0) {
      typesWithoutFixtures += 1;
      if (rules.length > 0) {
        for (const rule of rules) rulesWithoutFixtures.push(`${assetType} ${rule.label}`);
        add(
          'rule-without-fixture',
          `${assetType} has ${String(rules.length)} rule(s) but no fixtures/${serviceOf(assetType)}/${assetType.slice(assetType.indexOf('/') + 1)}.json`,
          file,
          ['types', assetType],
        );
      }
      continue;
    }
    for (const rule of rules) {
      if (!fixtures.some(rule.proven)) {
        add(
          'rule-unproven',
          `${assetType} ${rule.label}: no fixture yields a well-formed value through it`,
          file,
          ['types', assetType, ...rule.path],
        );
      }
    }
    const templates: Array<[string, string | undefined]> = [
      ['label', entry.label],
      ['subtitle', entry.subtitle],
      ['console', entry.console],
    ];
    for (const [field, template] of templates) {
      if (template === undefined) continue;
      const complete = fixtures.some((asset) => !renderTemplate(template, templateScope(asset, ctx)).missing);
      if (!complete) {
        add(
          'template-unproven',
          `${assetType} ${field}: some variable is missing on every fixture (${template})`,
          file,
          ['types', assetType, field],
        );
      }
    }
  }

  // Containers and their children ----------------------------------------------------------------------------
  for (const { assetType, file, entry } of types.values()) {
    entry.contains.forEach((rule, i) => {
      if (typeof rule === 'string') return;
      const child = rule.byParent;
      const path = ['types', assetType, 'contains', i];
      if (!official.types.has(child) && !types.has(child)) {
        add(
          'container-child',
          `${assetType} contains ${child}, which is neither official nor in the catalog`,
          file,
          path,
        );
        return;
      }
      const reverse = types
        .get(child)
        ?.entry.contains.some((r) => typeof r !== 'string' && r.byParent === assetType);
      if (child !== assetType && reverse === true) {
        add('container-child', `${assetType} and ${child} contain each other`, file, path);
      }
      const parents = fixturesByType.get(assetType) ?? [];
      const children = fixturesByType.get(child) ?? [];
      if (parents.length > 0 && children.length > 0) {
        const nests = children.some((c) => parents.some((p) => c.name !== p.name && nestsByParent(c, p)));
        if (!nests) {
          add(
            'container-child',
            `no fixture of ${child} nests in a fixture of ${assetType} (by parent or by name)`,
            file,
            path,
          );
        }
      }
    });
  }

  // Lenses ----------------------------------------------------------------------------------------------------
  const lenses = new Map<LensId, Lens>();
  const allTypes = new Set([...official.types, ...types.keys()]);
  for (const file of sources.lenses) {
    const id = LensIdSchema.safeParse(LENS_PATH.exec(file.path)?.[1]);
    if (!id.success) {
      add(
        'file-name',
        `a lens file is lenses/<lens id>.yaml with an id of ${LensIdSchema.options.join(', ')}`,
        file,
      );
      continue;
    }
    const parsed = LensSchema.safeParse(file.content);
    if (!parsed.success) {
      schemaIssues(file, parsed.error.issues);
      continue;
    }
    parsed.data.types.forEach((pattern, i) => {
      if (![...allTypes].some((assetType) => matchesTypePattern(pattern, assetType))) {
        add('lens-pattern', `${pattern} matches no official or catalog type`, file, ['types', i]);
      }
    });
    lenses.set(id.data, parsed.data);
  }
  for (const id of LensIdSchema.options) {
    if (!lenses.has(id)) add('lens-missing', `lenses/${id}.yaml is missing`);
  }

  // Assemble catalog.json: only the types whose surviving description has no violation ---------------------------
  const isFaulty = ({ assetType, file }: TypeRecord): boolean =>
    faulty.get(assetType)?.has(file.path) === true;
  const excluded = [...types.values()]
    .filter(isFaulty)
    .map(({ assetType }) => assetType)
    .sort(compareText);
  let catalog: Catalog | undefined;
  if (lenses.size === LensIdSchema.options.length) {
    const compiledTypes: Record<string, CatalogType> = {};
    for (const typeRecord of [...types.values()].sort((a, b) => compareText(a.assetType, b.assetType))) {
      if (isFaulty(typeRecord)) continue;
      merged
        .get(`${typeRecord.product.service}\u0000${typeRecord.product.product}`)
        ?.product.types.push(typeRecord.assetType);
      compiledTypes[typeRecord.assetType] = compileType(typeRecord);
    }
    const compiledProducts = [...merged.values()]
      .map(({ product }) => product)
      .filter((product) => product.types.length > 0)
      .sort((a, b) => compareText(a.service, b.service) || compareText(a.product, b.product));
    const parsed = CatalogSchema.safeParse({
      version: options.version,
      officialListDate: official.date,
      products: compiledProducts,
      types: compiledTypes,
      lenses: Object.fromEntries(LensIdSchema.options.map((id) => [id, lenses.get(id)])),
    });
    if (parsed.success) catalog = parsed.data;
    else
      for (const issue of parsed.error.issues)
        add('schema', `catalog.json ${pathText(issue.path)}: ${issue.message}`);
  }

  // Coverage per group --------------------------------------------------------------------------------------
  const groups = analysis.groups.map((group): GroupCoverage => {
    const owned = [...official.types]
      .filter((assetType) => analysis.ownerOf(assetType) === group)
      .sort(compareText);
    const roles = emptyRoles();
    const unmappedTypes: Record<string, string> = {};
    const byReason: Record<string, number> = {};
    const missing: string[] = [];
    for (const assetType of owned) {
      const record = types.get(assetType);
      const listing = analysis.listed.get(assetType);
      if (record !== undefined) roles[record.entry.role] += 1;
      else if (listing !== undefined && listing.group === group) {
        unmappedTypes[assetType] = listing.reason;
        byReason[listing.reason] = (byReason[listing.reason] ?? 0) + 1;
      } else if (!declaredTypes.has(assetType)) missing.push(assetType);
    }
    const total = roles.container + roles.core + roles.leaf + roles.hidden;
    // The group's product files: a shared service's files named after it, other files holding its types (also
    // those that do not parse, by the type keys in their text), and files without types of its services.
    const productFiles = records.filter((r) => r.groups.includes(group)).map((r) => r.path);
    const fixtureFiles = [...fixtureFilesByType]
      .filter(([assetType]) => analysis.ownerOf(assetType) === group)
      .flatMap(([, files]) => files);
    for (const violation of sources.loadViolations) {
      const match = violation.file === undefined ? null : FIXTURE_PATH.exec(violation.file);
      if (match !== null && analysis.ownerOf(`${match[1] ?? ''}/${match[2] ?? ''}`) === group) {
        fixtureFiles.push(violation.file ?? '');
      }
    }
    return {
      group: group.stem,
      title: group.title,
      file: group.file.path,
      official: owned.length,
      mapped: { ...roles, total },
      unmapped: { total: Object.keys(unmappedTypes).length, byReason, types: unmappedTypes },
      missing,
      coveragePercent: percent(total, owned.length),
      productFiles: [...new Set(productFiles)].sort(compareText),
      fixtureFiles: [...new Set(fixtureFiles)].sort(compareText),
    };
  });
  const ungrouped = [...official.types]
    .filter((assetType) => analysis.ownerOf(assetType) === undefined)
    .sort(compareText);

  const officialTotal = official.types.size;
  const mappedTotal = mapped.container + mapped.core + mapped.leaf + mapped.hidden;
  const report: CoverageReport = {
    officialList: { date: official.date, file: official.file, total: officialTotal },
    mapped: { ...mapped, total: mappedTotal },
    coveragePercent: percent(mappedTotal, officialTotal),
    unmapped: {
      total: officialTotal - mappedTotal,
      known: unmappedKnown,
      knownByReason: Object.fromEntries(Object.entries(knownByReason).sort(([a], [b]) => compareText(a, b))),
      unlisted,
    },
    notOfficial: {
      deprecated: notOfficialDeprecated.sort(compareText),
      unmarked: notOfficialUnmarked.sort(compareText),
    },
    unusedIconKeys,
    pendingIconKeys: [...pendingIcons].sort(compareText),
    rulesWithoutFixtures: rulesWithoutFixtures.sort(compareText),
    fixturesWithoutRules: fixturesWithoutRules.sort(compareText),
    typesWithoutConsole: [...types.values()]
      .filter((record) => record.entry.console === undefined)
      .map((record) => record.assetType)
      .sort(compareText),
    groups,
    ungrouped,
    counts: {
      products: merged.size,
      productFiles: products.length,
      types: types.size,
      rules: ruleCount,
      fixtures: sources.fixtures.length,
      typesWithoutFixtures,
      lenses: lenses.size,
      iconKeys: declaredIcons.size,
      groups: analysis.groups.length,
    },
    violations,
    warnings,
  };
  return { catalog, excluded, report, ...(options.trace === true ? { trace } : {}) };
}
