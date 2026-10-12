// SPDX-License-Identifier: MIT
/**
 * The JSONPath subset the catalog uses to read asset fields (`to`, `ips`, `domains`, `contains`, predicates).
 * Implemented here rather than taken from a library so that every path is validated when the catalog is
 * compiled, evaluation never runs script, and the same grammar serves the browser, workers and Node.
 *
 * Grammar (a path starts at the asset, `$`, or inside a filter at the current item, `@`):
 *
 *   path      = ( "$" / "@" ) *step
 *   step      = "." name / ".*" / "[*]" / "[" index "]" / "[" quoted "]" / "[" union "]" / "[?(" predicate ")]"
 *   name      = 1*( ALPHA / DIGIT / "_" / "-" / "$" )
 *   index     = [ "-" ] 1*DIGIT                  ; negative counts from the end
 *   quoted    = "'" chars "'" / DQUOTE chars DQUOTE   ; any key, e.g. ['run.googleapis.com/ingress']
 *   union     = ( quoted / index ) 1*( "," ( quoted / index ) )
 *
 * Not supported, and rejected when the catalog is compiled: recursive descent (`..`), slices, script
 * expressions. A filter keeps the array elements (or object values) for which its predicate holds; the
 * predicate grammar is the one in `predicate.ts`, with paths starting at `@`.
 */
import { parsePredicate, type Predicate, testPredicate } from './predicate.js';
import { CatalogSyntaxError, readQuoted } from './syntax.js';

export type PathStep =
  | { readonly kind: 'key'; readonly key: string }
  | { readonly kind: 'index'; readonly index: number }
  | { readonly kind: 'wildcard' }
  | { readonly kind: 'union'; readonly members: ReadonlyArray<string | number> }
  | { readonly kind: 'filter'; readonly predicate: Predicate };

export interface JsonPath {
  readonly source: string;
  /** `$` (the asset) or `@` (the current item inside a filter). */
  readonly root: '$' | '@';
  readonly steps: readonly PathStep[];
}

const NAME_CHAR = /[A-Za-z0-9_$-]/;

/** Finds the `]` closing a bracket opened at `start`, skipping quoted strings and nested brackets. */
function closingBracket(source: string, start: number): number {
  let depth = 0;
  let i = start;
  while (i < source.length) {
    const char = source.charAt(i);
    if (char === "'" || char === '"') {
      i = readQuoted(source, i).end;
      continue;
    }
    if (char === '[' || char === '(') depth += 1;
    if (char === ']' || char === ')') {
      depth -= 1;
      if (depth === 0) {
        if (char !== ']') throw new CatalogSyntaxError('unbalanced brackets', source, i);
        return i;
      }
    }
    i += 1;
  }
  throw new CatalogSyntaxError('unclosed [', source, start);
}

function parseBracket(source: string, inner: string, offset: number): PathStep {
  const body = inner.trim();
  if (body === '*') return { kind: 'wildcard' };
  if (body.startsWith('?')) {
    const match = /^\?\s*\(([\s\S]*)\)$/.exec(body);
    if (match === null) throw new CatalogSyntaxError('a filter must read [?(…)]', source, offset);
    return { kind: 'filter', predicate: parsePredicate(match[1] ?? '', { allowCurrent: true }) };
  }
  const members: Array<string | number> = [];
  let i = 0;
  while (i < body.length) {
    const char = body.charAt(i);
    if (char === ' ') {
      i += 1;
      continue;
    }
    if (char === "'" || char === '"') {
      const quoted = readQuoted(body, i);
      members.push(quoted.value);
      i = quoted.end;
    } else {
      const match = /^-?[0-9]+/.exec(body.slice(i));
      if (match === null) {
        throw new CatalogSyntaxError(
          'expected *, an index, a quoted key, a union or a filter',
          source,
          offset + i,
        );
      }
      members.push(Number(match[0]));
      i += match[0].length;
    }
    while (body[i] === ' ') i += 1;
    if (i < body.length) {
      if (body[i] !== ',')
        throw new CatalogSyntaxError('expected , between union members', source, offset + i);
      i += 1;
    }
  }
  if (members.length === 0) throw new CatalogSyntaxError('empty brackets', source, offset);
  const [only] = members;
  if (members.length === 1 && only !== undefined) {
    return typeof only === 'number' ? { kind: 'index', index: only } : { kind: 'key', key: only };
  }
  return { kind: 'union', members };
}

/** Parses a path; throws a CatalogSyntaxError naming the position of the first problem. */
export function parseJsonPath(source: string, options: { allowCurrent?: boolean } = {}): JsonPath {
  const root = source[0];
  if (root !== '$' && !(root === '@' && options.allowCurrent === true)) {
    throw new CatalogSyntaxError(
      options.allowCurrent === true ? 'a path starts with $ or @' : 'a path starts with $',
      source,
      0,
    );
  }
  const steps: PathStep[] = [];
  let i = 1;
  while (i < source.length) {
    const char = source.charAt(i);
    if (char === '.') {
      if (source[i + 1] === '.')
        throw new CatalogSyntaxError('recursive descent (..) is not supported', source, i);
      if (source[i + 1] === '*') {
        steps.push({ kind: 'wildcard' });
        i += 2;
        continue;
      }
      let end = i + 1;
      while (end < source.length && NAME_CHAR.test(source.charAt(end))) end += 1;
      if (end === i + 1) throw new CatalogSyntaxError('expected a name after .', source, i);
      steps.push({ kind: 'key', key: source.slice(i + 1, end) });
      i = end;
      continue;
    }
    if (char === '[') {
      const end = closingBracket(source, i);
      const inner = source.slice(i + 1, end);
      if (/^\s*-?[0-9]*\s*:/.test(inner)) throw new CatalogSyntaxError('slices are not supported', source, i);
      steps.push(parseBracket(source, inner, i + 1));
      i = end + 1;
      continue;
    }
    throw new CatalogSyntaxError(`unexpected ${JSON.stringify(char)}`, source, i);
  }
  return { source, root, steps };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function children(value: unknown): unknown[] {
  if (Array.isArray(value)) return value as unknown[];
  if (isRecord(value)) return Object.values(value);
  return [];
}

function member(value: unknown, key: string | number): unknown {
  if (typeof key === 'number') {
    if (!Array.isArray(value)) return undefined;
    const list = value as unknown[];
    return list[key < 0 ? list.length + key : key];
  }
  return isRecord(value) && Object.hasOwn(value, key) ? value[key] : undefined;
}

function applyStep(nodes: readonly unknown[], step: PathStep): unknown[] {
  const out: unknown[] = [];
  const push = (value: unknown): void => {
    if (value !== undefined) out.push(value);
  };
  for (const node of nodes) {
    switch (step.kind) {
      case 'key':
        push(member(node, step.key));
        break;
      case 'index':
        push(member(node, step.index));
        break;
      case 'union':
        for (const key of step.members) push(member(node, key));
        break;
      case 'wildcard':
        for (const child of children(node)) push(child);
        break;
      case 'filter':
        for (const child of children(node)) if (testPredicate(step.predicate, child, child)) push(child);
        break;
    }
  }
  return out;
}

/**
 * The values a parsed path selects, in document order. `root` is what `$` refers to, `current` what `@`
 * refers to (the same value outside a filter). Missing members select nothing; `null` is a value.
 */
export function selectValues(path: JsonPath, root: unknown, current: unknown = root): unknown[] {
  let nodes: unknown[] = [path.root === '$' ? root : current];
  for (const step of path.steps) {
    nodes = applyStep(nodes, step);
    if (nodes.length === 0) break;
  }
  return nodes;
}

const cache = new Map<string, JsonPath | null>();

/** Parses a `$` path once and remembers it; `undefined` when it is malformed (the compiler reports it). */
export function cachedPath(source: string): JsonPath | undefined {
  let parsed = cache.get(source);
  if (parsed === undefined) {
    try {
      parsed = parseJsonPath(source);
    } catch {
      parsed = null;
    }
    cache.set(source, parsed);
  }
  return parsed ?? undefined;
}

/** The values a `$` path selects from a value (usually an Asset); nothing when the path is malformed. */
export function evaluateJsonPath(source: string, root: unknown): unknown[] {
  const path = cachedPath(source);
  return path === undefined ? [] : selectValues(path, root);
}
