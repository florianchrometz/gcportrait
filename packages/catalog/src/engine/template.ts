// SPDX-License-Identifier: Apache-2.0
/**
 * Label, subtitle and console-URL templates (skill gcp-asset-catalog §2): literal text with
 * `{{variable | filter | …}}` expressions. The grammar is `TemplateSchema` in `@gcportrait/model`; this module
 * parses and renders it.
 *
 * Variables: `name`, `assetType`, `location`, `projectId`, `projectNumber`, and `data` followed by `.key` and
 * `[n]` steps. Missing variables are tolerated: they render as the empty string, and the result reports that
 * something was missing so a console URL can be dropped instead of linking to a broken page.
 *
 * Filters, applied left to right:
 * - `lastSegment`: the text after the last `/`, ignoring trailing slashes (`a/b/c/` → `c`).
 * - `projectFromName`: the segment after `projects/` (`//x.googleapis.com/projects/p/…` → `p`).
 * - `regionFromName`: the segment after `regions/` or `locations/`, else after `zones/`, or a bare value,
 *   with a zone turned into its region (`regionOfZone` of `@gcportrait/model`): a zonal cluster's
 *   `…/locations/europe-west3-a/clusters/c` and a bare `us-central1-ai1a` give `europe-west3` and
 *   `us-central1`; a region, a multi-region or any other bare value is kept.
 * - `short(n)`: at most n characters (graphemes); longer text keeps n − 1 and ends with `…`.
 * - `lower`: lower case.
 * - `parentSegment(collection)`: the segment after the first `<collection>/` in the value, so a name can
 *   name its parents (`…/clusters/shop/k8s/namespaces/web` with `parentSegment(clusters)` → `shop`).
 * - `first(variable, …)`: when the value so far is missing, the first of the listed variables that has a
 *   value stands in (union-shaped resources: `{{data.run.location | first(data.gke.cluster)}}`); filters
 *   after it apply to whichever value it chose.
 * - `plural(word)` or `plural(word, words)`: a count with its noun, `1 instance` or `4 instances` (the plural
 *   is `word` + `s` unless given). A value that is exactly 1 (`1`, `1.0`) takes the singular, any other value
 *   the plural; a missing value stays missing, so its segment is dropped as usual.
 *
 * Labels and subtitles are rendered by segment ({@link renderDisplay}): the ` · `-separated parts of the
 * template, and a part whose expressions are all missing is dropped with its literal text, so a missing count
 * never leaves its unit word behind (`{{data.sizeGb}} GB · {{location}}` → `europe-west3`).
 */
import { regionOfZone } from '@gcportrait/model';
import { CatalogSyntaxError } from './syntax.js';

/** A variable an expression reads: `name`, …, or `data` with its steps. */
export interface TemplateVariable {
  /** `name`, `assetType`, `location`, `projectId`, `projectNumber`, or `data`. */
  readonly variable: string;
  /** Steps after `data` (keys and indices); empty for the other variables. */
  readonly dataPath: ReadonlyArray<string | number>;
}

export type TemplateFilter =
  | { readonly name: 'lastSegment' | 'projectFromName' | 'regionFromName' | 'lower' }
  | { readonly name: 'short'; readonly length: number }
  | { readonly name: 'parentSegment'; readonly collection: string }
  | { readonly name: 'first'; readonly alternatives: readonly TemplateVariable[] }
  | { readonly name: 'plural'; readonly singular: string; readonly plural: string };

export type TemplatePart =
  | { readonly kind: 'text'; readonly text: string }
  | {
      readonly kind: 'expression';
      /** `name`, `assetType`, `location`, `projectId`, `projectNumber`, or a `data` path. */
      readonly variable: string;
      /** Steps after `data` (keys and indices); empty for the other variables. */
      readonly dataPath: ReadonlyArray<string | number>;
      readonly filters: readonly TemplateFilter[];
    };

export interface Template {
  readonly source: string;
  readonly parts: readonly TemplatePart[];
}

/** What a template can read. */
export interface TemplateScope {
  readonly name: string;
  readonly assetType: string;
  readonly location?: string | undefined;
  readonly projectId?: string | undefined;
  readonly projectNumber?: string | undefined;
  readonly data: unknown;
}

const SIMPLE_VARIABLES = new Set(['name', 'assetType', 'location', 'projectId', 'projectNumber']);
const DATA_STEP = /^(?:\.([A-Za-z_][A-Za-z0-9_-]*)|\[([0-9]+)\])/;

type ExpressionPart = Extract<TemplatePart, { kind: 'expression' }>;

function parseVariable(text: string, source: string, at: number): TemplateVariable {
  if (SIMPLE_VARIABLES.has(text)) return { variable: text, dataPath: [] };
  if (!/^data(?:$|[.[])/.test(text)) throw new CatalogSyntaxError(`unknown variable ${text}`, source, at);
  const dataPath: Array<string | number> = [];
  let rest = text.slice('data'.length);
  while (rest.length > 0) {
    const step = DATA_STEP.exec(rest);
    if (step === null) throw new CatalogSyntaxError(`malformed data path ${text}`, source, at);
    dataPath.push(step[1] ?? Number(step[2]));
    rest = rest.slice(step[0].length);
  }
  if (dataPath.length === 0)
    throw new CatalogSyntaxError('data needs at least one .key or [n] step', source, at);
  return { variable: 'data', dataPath };
}

function parseFilter(text: string, source: string, at: number): TemplateFilter {
  const first = /^first\((.*)\)$/.exec(text);
  if (first !== null) {
    const names = (first[1] ?? '').split(',').map((piece) => piece.trim());
    if (names.some((name) => name === '')) throw new CatalogSyntaxError('first needs variables', source, at);
    return { name: 'first', alternatives: names.map((name) => parseVariable(name, source, at)) };
  }
  const plural = /^plural\(\s*([A-Za-z][A-Za-z0-9-]*)\s*(?:,\s*([A-Za-z][A-Za-z0-9-]*)\s*)?\)$/.exec(text);
  if (plural !== null) {
    const singular = plural[1] ?? '';
    return { name: 'plural', singular, plural: plural[2] ?? `${singular}s` };
  }
  const short = /^short\(([0-9]+)\)$/.exec(text);
  if (short !== null) return { name: 'short', length: Number(short[1]) };
  const parent = /^parentSegment\(([A-Za-z][A-Za-z0-9]*)\)$/.exec(text);
  if (parent !== null) return { name: 'parentSegment', collection: parent[1] ?? '' };
  if (text === 'lastSegment' || text === 'projectFromName' || text === 'regionFromName' || text === 'lower') {
    return { name: text };
  }
  throw new CatalogSyntaxError(`unknown filter ${text}`, source, at);
}

/** An expression's text split at the `|` that separate its filters (none appears inside parentheses). */
function splitFilters(text: string): string[] {
  return text.split('|').map((piece) => piece.trim());
}

/** Parses a template; throws a CatalogSyntaxError naming the position of the first problem. */
export function parseTemplate(source: string): Template {
  const parts: TemplatePart[] = [];
  let i = 0;
  while (i < source.length) {
    const open = source.indexOf('{{', i);
    const literalEnd = open === -1 ? source.length : open;
    const literal = source.slice(i, literalEnd);
    const brace = /[{}]/.exec(literal);
    if (brace !== null) throw new CatalogSyntaxError('stray brace', source, i + brace.index);
    if (literal.length > 0) parts.push({ kind: 'text', text: literal });
    if (open === -1) break;
    const close = source.indexOf('}}', open + 2);
    if (close === -1) throw new CatalogSyntaxError('unclosed {{', source, open);
    const [head = '', ...filterTexts] = splitFilters(source.slice(open + 2, close));
    if (head === '') throw new CatalogSyntaxError('empty expression', source, open);
    parts.push({
      kind: 'expression',
      ...parseVariable(head, source, open + 2),
      filters: filterTexts.map((filter) => parseFilter(filter, source, open + 2)),
    });
    i = close + 2;
  }
  return { source, parts };
}

/** Splits text into user-perceived characters, so `short(n)` never cuts an emoji or accent in half. */
const GRAPHEMES = new Intl.Segmenter('en', { granularity: 'grapheme' });

function segmentAfter(value: string, collections: readonly string[]): string | undefined {
  const segments = value.split('/');
  for (let i = 0; i < segments.length - 1; i += 1) {
    const segment = segments[i];
    if (segment !== undefined && collections.includes(segment)) {
      const next = segments[i + 1];
      if (next !== undefined && next !== '') return next;
    }
  }
  return undefined;
}

/** The last path segment, ignoring trailing slashes. */
export function lastSegment(value: string): string {
  const trimmed = value.replace(/\/+$/, '');
  return trimmed.slice(trimmed.lastIndexOf('/') + 1);
}

function applyFilter(value: string, filter: TemplateFilter, scope: TemplateScope): string {
  switch (filter.name) {
    case 'lastSegment':
      return lastSegment(value);
    case 'projectFromName':
      return segmentAfter(value, ['projects']) ?? '';
    case 'regionFromName': {
      // A zone may stand under `locations/` too (a zonal GKE cluster, a TPU node), so every segment goes
      // through the one rule.
      const location = segmentAfter(value, ['regions', 'locations']) ?? segmentAfter(value, ['zones']);
      if (location !== undefined) return regionOfZone(location);
      return value.includes('/') ? '' : regionOfZone(value);
    }
    case 'short': {
      const graphemes = Array.from(GRAPHEMES.segment(value), (piece) => piece.segment);
      return graphemes.length <= filter.length
        ? value
        : `${graphemes.slice(0, Math.max(filter.length - 1, 0)).join('')}…`;
    }
    case 'lower':
      return value.toLowerCase();
    case 'parentSegment':
      return segmentAfter(value, [filter.collection]) ?? '';
    case 'plural':
      if (value === '') return '';
      return `${value} ${Number(value) === 1 ? filter.singular : filter.plural}`;
    case 'first': {
      if (value !== '') return value;
      for (const alternative of filter.alternatives) {
        const text = variableText(alternative, scope);
        if (text !== undefined) return text;
      }
      return '';
    }
  }
}

function readData(data: unknown, path: ReadonlyArray<string | number>): unknown {
  let value = data;
  for (const step of path) {
    if (typeof step === 'number') {
      value = Array.isArray(value) ? (value as unknown[])[step] : undefined;
    } else {
      value =
        typeof value === 'object' && value !== null && !Array.isArray(value) && Object.hasOwn(value, step)
          ? (value as Record<string, unknown>)[step]
          : undefined;
    }
    if (value === undefined) return undefined;
  }
  return value;
}

function variableText(part: TemplateVariable, scope: TemplateScope): string | undefined {
  let value: unknown;
  switch (part.variable) {
    case 'name':
      value = scope.name;
      break;
    case 'assetType':
      value = scope.assetType;
      break;
    case 'location':
      value = scope.location;
      break;
    case 'projectId':
      value = scope.projectId;
      break;
    case 'projectNumber':
      value = scope.projectNumber;
      break;
    default:
      value = readData(scope.data, part.dataPath);
  }
  if (typeof value === 'string') return value === '' ? undefined : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

export interface Rendered {
  readonly text: string;
  /** Some expression had no value (a missing variable, or a filter that found nothing). */
  readonly missing: boolean;
}

/**
 * Renders a parsed template. `encode` is applied to each expression's value (console URLs percent-encode
 * them); literal text is kept as written.
 */
export function renderParsed(
  template: Template,
  scope: TemplateScope,
  encode: (value: string) => string = (value) => value,
): Rendered {
  let text = '';
  let missing = false;
  for (const part of template.parts) {
    if (part.kind === 'text') {
      text += part.text;
      continue;
    }
    const value = expressionValue(part, scope);
    if (value === '') missing = true;
    text += encode(value);
  }
  return { text, missing };
}

/** One expression's value: its variable through its filters; '' when missing. */
function expressionValue(part: ExpressionPart, scope: TemplateScope): string {
  let value = variableText(part, scope) ?? '';
  for (const filter of part.filters) value = applyFilter(value, filter, scope);
  return value;
}

/**
 * Renders a label or subtitle: the template's ` · `-separated segments, leaving out every segment that has
 * expressions and none of them a value (its literal text goes with it). Separators are not tidied here.
 */
export function renderDisplayParsed(template: Template, scope: TemplateScope): Rendered {
  const segments: Array<{ text: string; expressions: number; missing: number }> = [
    { text: '', expressions: 0, missing: 0 },
  ];
  let missing = false;
  for (const part of template.parts) {
    if (part.kind === 'text') {
      const [head = '', ...rest] = part.text.split('·');
      const current = segments.at(-1);
      if (current !== undefined) current.text += head;
      for (const piece of rest) segments.push({ text: piece, expressions: 0, missing: 0 });
      continue;
    }
    const value = expressionValue(part, scope);
    const current = segments.at(-1);
    if (current === undefined) continue;
    current.expressions += 1;
    current.text += value;
    if (value === '') {
      current.missing += 1;
      missing = true;
    }
  }
  const kept = segments.filter(
    (segment) => segment.expressions === 0 || segment.missing < segment.expressions,
  );
  return { text: kept.map((segment) => segment.text).join('·'), missing };
}

const cache = new Map<string, Template | null>();

function cachedTemplate(source: string): Template | null {
  let parsed = cache.get(source);
  if (parsed === undefined) {
    try {
      parsed = parseTemplate(source);
    } catch {
      parsed = null;
    }
    cache.set(source, parsed);
  }
  return parsed;
}

/** Renders a template source; a malformed template renders as nothing (the compiler reports it). */
export function renderTemplate(
  source: string,
  scope: TemplateScope,
  encode?: (value: string) => string,
): Rendered {
  const parsed = cachedTemplate(source);
  return parsed === null ? { text: '', missing: true } : renderParsed(parsed, scope, encode);
}

/** {@link renderDisplayParsed} for a template source; a malformed template renders as nothing. */
export function renderDisplay(source: string, scope: TemplateScope): Rendered {
  const parsed = cachedTemplate(source);
  return parsed === null ? { text: '', missing: true } : renderDisplayParsed(parsed, scope);
}
