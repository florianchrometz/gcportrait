// SPDX-License-Identifier: Apache-2.0
/**
 * The catalog's rule engine: what one catalog type entry says about one asset. This is the single
 * implementation of the rule semantics; the compiler's fixture runner and the graph builder both call it.
 * Everything here is pure and deterministic, and never throws on asset data of any shape.
 */
import {
  DEFAULT_LABEL_TEMPLATE,
  DomainSchema,
  IpSchema,
  aliasKey,
  type Asset,
  type CatalogTypeEntry,
  type EvaluatedNesting,
  type EvaluatedRelation,
  type NestsInRule,
  type ProjectIndex,
  type RelationRule,
  type RelationTarget,
} from '@gcportrait/model';
import { evaluateJsonPath } from './jsonpath.js';
import { normalise, type NormaliserContext } from './normalisers.js';
import { evaluatePredicate } from './predicate.js';
import { assetProject } from './project.js';
import { lastSegment, renderDisplay, renderTemplate, type TemplateScope } from './template.js';

/** What the rules read besides the asset and its catalog entry. */
export interface RuleContext {
  /** The snapshot's project index (`buildProjectIndex`). */
  readonly projects: ProjectIndex;
}

/** The service host of an asset type: `compute.googleapis.com/Network` → `compute.googleapis.com`. */
export function serviceOf(assetType: string): string {
  const slash = assetType.indexOf('/');
  return slash === -1 ? assetType : assetType.slice(0, slash);
}

/**
 * Whether a lens type pattern matches an asset type: the type itself, `<service>/*` for every type of a
 * service, or `*` for every type.
 */
export function matchesTypePattern(pattern: string, assetType: string): boolean {
  if (pattern === '*') return true;
  if (pattern.endsWith('/*')) return serviceOf(assetType) === pattern.slice(0, -2);
  return pattern === assetType;
}

function raw(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function isAbsent(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

function targetKey(target: RelationTarget): string {
  return target.by === 'name' ? target.name : `alias:${target.alias}`;
}

/** The normaliser context of one rule on one asset. */
function referenceContext(
  asset: Asset,
  rule: Pick<RelationRule, 'service' | 'versionLevel' | 'pattern' | 'k8sKind'>,
  ctx: RuleContext,
): NormaliserContext {
  return {
    asset,
    projects: ctx.projects,
    service: rule.service ?? serviceOf(asset.assetType),
    versionLevel: rule.versionLevel === true,
    pattern: rule.pattern,
    k8sKind: rule.k8sKind,
  };
}

/**
 * Every relation the type's rules produce for the asset, in rule order and then document order. Each value a
 * rule's `to` path selects is normalised; a value its normaliser does not understand is still returned,
 * without a `target`, so the graph builder can count it as dangling. Absent values (null, empty strings)
 * produce nothing, a reference to the asset itself is dropped, and a relation produced twice (same kind,
 * same direction, same target) is returned once, weak only if every producing rule is weak. A `reverse`
 * rule's relations are marked: the graph builder draws them from the target to the asset.
 */
export function evaluateRelations(
  asset: Asset,
  entry: Pick<CatalogTypeEntry, 'relations'> | undefined,
  ctx: RuleContext,
): EvaluatedRelation[] {
  if (entry === undefined) return [];
  const byKey = new Map<string, EvaluatedRelation>();
  entry.relations.forEach((rule, index) => {
    const normaliserContext = referenceContext(asset, rule, ctx);
    const reverse = rule.reverse === true;
    for (const value of evaluateJsonPath(rule.to, asset)) {
      if (isAbsent(value)) continue;
      const target = normalise(rule.normalize, value, normaliserContext);
      if (target?.by === 'name' && target.name === asset.name) continue;
      const key = `${rule.kind}\u0000${reverse ? 'in' : 'out'}\u0000${target === undefined ? `raw:${raw(value)}` : targetKey(target)}`;
      const existing = byKey.get(key);
      if (existing !== undefined) {
        if (existing.weak === true && rule.weak !== true) {
          byKey.set(key, {
            kind: existing.kind,
            rule: existing.rule,
            raw: existing.raw,
            ...(existing.target === undefined ? {} : { target: existing.target }),
            ...(existing.reverse === true ? { reverse: true as const } : {}),
          });
        }
        continue;
      }
      byKey.set(key, {
        kind: rule.kind,
        rule: index,
        raw: raw(value),
        ...(target === undefined ? {} : { target }),
        ...(rule.weak === true ? { weak: true as const } : {}),
        ...(reverse ? { reverse: true as const } : {}),
      });
    }
  });
  return [...byKey.values()];
}

/**
 * The containers a type's `nestsIn` rules name for the asset (child-side containment), in rule order and then
 * document order, each target once; a value the normaliser does not understand comes without a `target`. The
 * graph builder nests the asset in the first target that is an acceptable container and draws the rule's
 * `kind`, when it has one, to every other target.
 */
export function evaluateNestsIn(
  asset: Asset,
  entry: { readonly nestsIn?: readonly NestsInRule[] | undefined } | undefined,
  ctx: RuleContext,
): EvaluatedNesting[] {
  const out: EvaluatedNesting[] = [];
  const seen = new Set<string>();
  (entry?.nestsIn ?? []).forEach((rule, index) => {
    const normaliserContext = referenceContext(asset, rule, ctx);
    for (const value of evaluateJsonPath(rule.to, asset)) {
      if (isAbsent(value)) continue;
      const target = normalise(rule.normalize, value, normaliserContext);
      if (target?.by === 'name' && target.name === asset.name) continue;
      const key = target === undefined ? `raw:${raw(value)}` : targetKey(target);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        rule: index,
        raw: raw(value),
        ...(target === undefined ? {} : { target }),
        ...(rule.kind === undefined ? {} : { kind: rule.kind }),
      });
    }
  });
  return out;
}

/** What a container's `contains` rules say: child names read from its data, and child types by parent. */
export interface ContainedChildren {
  /** Names (or aliases) read through the JSONPath rules, normalised like `name` in the container's service. */
  readonly names: RelationTarget[];
  /** Asset types whose assets nest here when `nestsByParent` holds. */
  readonly byParent: string[];
}

/** Evaluates a container's `contains` rules for one asset. */
export function evaluateContains(
  asset: Asset,
  entry: Pick<CatalogTypeEntry, 'contains'> | undefined,
  ctx: RuleContext,
): ContainedChildren {
  const names: RelationTarget[] = [];
  const byParent: string[] = [];
  if (entry === undefined) return { names, byParent };
  const seen = new Set<string>();
  const normaliserContext: NormaliserContext = {
    asset,
    projects: ctx.projects,
    service: serviceOf(asset.assetType),
    versionLevel: false,
  };
  for (const rule of entry.contains) {
    if (typeof rule !== 'string') {
      if (!byParent.includes(rule.byParent)) byParent.push(rule.byParent);
      continue;
    }
    for (const value of evaluateJsonPath(rule, asset)) {
      const target = isAbsent(value) ? undefined : normalise('name', value, normaliserContext);
      if (target === undefined || seen.has(targetKey(target))) continue;
      seen.add(targetKey(target));
      names.push(target);
    }
  }
  return { names, byParent };
}

/**
 * Whether `child` nests in `container` for a `byParent` rule: its `parent` is the container, or its name
 * continues the container's name (`…/instances/i` → `…/instances/i/databases/d`). When several containers
 * match, the graph builder picks the innermost (longest name).
 */
export function nestsByParent(
  child: Pick<Asset, 'name' | 'parent'>,
  container: Pick<Asset, 'name'>,
): boolean {
  return child.parent === container.name || child.name.startsWith(`${container.name}/`);
}

/**
 * The alias keys the type's `aliases` paths read from the asset (each string value through `aliasKey`, the key
 * normalisers write for `{ by: 'alias' }` targets), de-duplicated, in order. The graph builder indexes the
 * asset under each, so a relation whose target is such an alias resolves to it.
 */
export function evaluateAliases(
  asset: Asset,
  entry: Pick<CatalogTypeEntry, 'aliases'> | undefined,
): string[] {
  const out = new Set<string>();
  for (const path of entry?.aliases ?? []) {
    for (const value of evaluateJsonPath(path, asset)) {
      const key = typeof value === 'string' ? aliasKey(value) : undefined;
      if (key !== undefined) out.add(key);
    }
  }
  return [...out];
}

/** Whether the type's `hiddenWhen` predicate holds for the asset (whatever the type's role). */
export function hiddenWhenMatches(
  asset: Asset,
  entry: Pick<CatalogTypeEntry, 'hiddenWhen'> | undefined,
): boolean {
  return typeof entry?.hiddenWhen === 'string' && evaluatePredicate(entry.hiddenWhen, asset);
}

/** Whether the asset starts hidden: its type's role is `hidden`, or its `hiddenWhen` predicate holds. */
export function isHiddenByDefault(
  asset: Asset,
  entry: Pick<CatalogTypeEntry, 'role' | 'hiddenWhen'> | undefined,
): boolean {
  if (entry === undefined) return false;
  return entry.role === 'hidden' || hiddenWhenMatches(asset, entry);
}

/** What templates can read about an asset. */
export function templateScope(asset: Asset, ctx: RuleContext): TemplateScope {
  const project = assetProject(asset, ctx.projects);
  return {
    name: asset.name,
    assetType: asset.assetType,
    location: asset.location,
    projectId: project.id,
    projectNumber: project.number,
    data: asset.data,
  };
}

/** Collapses whitespace and the ` · ` separators that missing variables leave behind. */
function tidy(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/(?:\s*·\s*){2,}/g, ' · ')
    .replace(/^[\s·]+|[\s·]+$/g, '');
}

function dataField(asset: Asset, key: string): string | undefined {
  const data = asset.data;
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return undefined;
  const value = (data as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/**
 * The asset's label: its type's `label` template, or for a type the catalog does not know (and whenever the
 * template renders empty) `data.displayName`, else the last segment of `data.name`, else the last segment
 * of the asset name. Never empty.
 */
export function renderLabel(
  asset: Asset,
  entry: Pick<CatalogTypeEntry, 'label'> | undefined,
  ctx: RuleContext,
): string {
  if (entry !== undefined) {
    const label = tidy(renderDisplay(entry.label, templateScope(asset, ctx)).text);
    if (label !== '') return label;
  }
  const displayName = dataField(asset, 'displayName');
  if (displayName !== undefined) return displayName;
  const dataName = dataField(asset, 'name');
  if (dataName !== undefined && lastSegment(dataName) !== '') return lastSegment(dataName);
  const fallback = tidy(renderTemplate(DEFAULT_LABEL_TEMPLATE, templateScope(asset, ctx)).text);
  return fallback === '' ? asset.name : fallback;
}

/** The asset's subtitle, or undefined when the type has none or it renders empty. */
export function renderSubtitle(
  asset: Asset,
  entry: Pick<CatalogTypeEntry, 'subtitle'> | undefined,
  ctx: RuleContext,
): string | undefined {
  if (entry?.subtitle === undefined) return undefined;
  const subtitle = tidy(renderDisplay(entry.subtitle, templateScope(asset, ctx)).text);
  return subtitle === '' ? undefined : subtitle;
}

function encodeUrlValue(value: string): string {
  return encodeURIComponent(value).replace(/%2F/g, '/');
}

/**
 * The asset's Cloud Console URL, or undefined when the type has none or any variable it needs is missing (a
 * link to a broken page is worse than no link). Values are percent-encoded; `/` is kept.
 */
export function renderConsoleUrl(
  asset: Asset,
  entry: Pick<CatalogTypeEntry, 'console'> | undefined,
  ctx: RuleContext,
): string | undefined {
  if (entry?.console === undefined) return undefined;
  const rendered = renderTemplate(entry.console, templateScope(asset, ctx), encodeUrlValue);
  return rendered.missing ? undefined : rendered.text;
}

const IPV4_WITH_SUFFIX = /^((?:[0-9]{1,3}\.){3}[0-9]{1,3}(?:\/[0-9]{1,2})?)(?::[0-9]+)?(?:[/@].*)?$/;
const BRACKETED_IPV6 = /^\[([0-9A-Fa-f:.]+)\](?::[0-9]+)?$/;

/** The host of an absolute URL (`scheme://[user@]host[:port]/…`), brackets kept for IPv6. */
function urlHost(url: string): string | undefined {
  return /^[A-Za-z][A-Za-z0-9+.-]*:\/\/(?:[^@/?#]*@)?(\[[^\]/]+\]|[^/:?#]+)/.exec(url)?.[1];
}

function isIp(value: string): boolean {
  return IpSchema.safeParse(value).success;
}

/** One value read by an `ips` path → an address or range, or undefined. Ports and paths are dropped. */
export function toIp(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  let text = value.trim();
  if (text.includes('://')) {
    const host = urlHost(text);
    if (host === undefined) return undefined;
    text = host.replace(/^\[|\]$/g, '');
  }
  const candidate = isIp(text)
    ? text
    : (IPV4_WITH_SUFFIX.exec(text)?.[1] ?? BRACKETED_IPV6.exec(text)?.[1] ?? undefined);
  return candidate !== undefined && isIp(candidate) ? candidate.toLowerCase() : undefined;
}

/** One value read by a `domains` path → a lower-case host name, or undefined. Hosts are taken from URLs. */
export function toDomain(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  let host = value.trim().toLowerCase();
  if (host.includes('://')) {
    host = urlHost(host) ?? '';
  } else {
    host = host.split('/')[0] ?? '';
    host = host.replace(/:[0-9]+$/, '');
  }
  host = host.replace(/\.$/, '');
  if (!host.includes('.') || toIp(host) !== undefined) return undefined;
  return DomainSchema.safeParse(host).success ? host : undefined;
}

function extract(
  asset: Asset,
  paths: readonly string[],
  convert: (value: unknown) => string | undefined,
): string[] {
  const out = new Set<string>();
  for (const path of paths) {
    for (const value of evaluateJsonPath(path, asset)) {
      const converted = convert(value);
      if (converted !== undefined) out.add(converted);
    }
  }
  return [...out];
}

/** The addresses and ranges the type's `ips` paths read, valid ones only, de-duplicated, in order. */
export function extractIps(asset: Asset, entry: Pick<CatalogTypeEntry, 'ips'> | undefined): string[] {
  return entry === undefined ? [] : extract(asset, entry.ips, toIp);
}

/** The host names the type's `domains` paths read (hosts taken from URLs), de-duplicated, in order. */
export function extractDomains(asset: Asset, entry: Pick<CatalogTypeEntry, 'domains'> | undefined): string[] {
  return entry === undefined ? [] : extract(asset, entry.domains, toDomain);
}
