// SPDX-License-Identifier: MIT
/**
 * Predicates: `hiddenWhen` on a type, and the body of a JSONPath filter `[?(…)]`.
 *
 *   predicate = or
 *   or        = and *( "||" and )
 *   and       = unary *( "&&" unary )
 *   unary     = "!" unary / "(" or ")" / test
 *   test      = path [ compare value / "in" list / "not in" list / "exists" / "missing"
 *                    / ( "startsWith" / "endsWith" / "contains" ) string ]
 *   compare   = "==" / "!=" / "<" / "<=" / ">" / ">="
 *   value     = string / number / "true" / "false" / "null"     ; strings in '…' or "…"
 *   list      = "[" [ value *( "," value ) ] "]"
 *
 * A path selects zero or more values, so every test is defined over that set:
 * - a bare path holds when some value is truthy (not null, false, 0 or the empty string);
 * - `exists` when some value is not null, `missing` when none is;
 * - `==`, `in`, `startsWith`, `endsWith`, `contains`, `<`… hold when some value matches;
 * - `!=` and `not in` hold when there is at least one value and none matches, so a missing field never
 *   satisfies them (`$.data.state != 'ACTIVE'` does not hide an asset whose state is unknown).
 * Numbers compare with numeric strings by value (`$.data.sizeGb > 100` reads "200"), since many APIs
 * serialise 64-bit integers as strings.
 */
import { parseJsonPath, selectValues, type JsonPath } from './jsonpath.js';
import { CatalogSyntaxError, readQuoted } from './syntax.js';

export type Literal = string | number | boolean | null;

export type Comparison = '==' | '!=' | '<' | '<=' | '>' | '>=';

export type Test =
  | { readonly op: 'truthy' | 'exists' | 'missing' }
  | { readonly op: 'compare'; readonly comparison: Comparison; readonly value: Literal }
  | { readonly op: 'in' | 'notIn'; readonly values: readonly Literal[] }
  | { readonly op: 'startsWith' | 'endsWith' | 'contains'; readonly value: string };

export type Predicate =
  | { readonly kind: 'or' | 'and'; readonly items: readonly Predicate[] }
  | { readonly kind: 'not'; readonly item: Predicate }
  | { readonly kind: 'test'; readonly path: JsonPath; readonly test: Test };

type Token =
  | { readonly type: 'path'; readonly text: string; readonly at: number }
  | { readonly type: 'string'; readonly value: string; readonly at: number }
  | { readonly type: 'number'; readonly value: number; readonly at: number }
  | { readonly type: 'word' | 'symbol'; readonly text: string; readonly at: number };

const SYMBOLS = ['==', '!=', '<=', '>=', '&&', '||', '<', '>', '!', '(', ')', '[', ']', ','] as const;
const PATH_END = new Set([' ', '\t', '\n', '=', '!', '<', '>', '&', '|', ')', ',']);

function readPath(source: string, start: number): number {
  let depth = 0;
  let i = start;
  while (i < source.length) {
    const char = source.charAt(i);
    if (depth > 0 && (char === "'" || char === '"')) {
      i = readQuoted(source, i).end;
      continue;
    }
    if (char === '[' || char === '(') depth += 1;
    else if (char === ']' || (char === ')' && depth > 0)) depth -= 1;
    else if (depth === 0 && PATH_END.has(char)) break;
    i += 1;
  }
  return i;
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const char = source.charAt(i);
    if (/\s/.test(char)) {
      i += 1;
      continue;
    }
    if (char === '$' || char === '@') {
      const end = readPath(source, i);
      tokens.push({ type: 'path', text: source.slice(i, end), at: i });
      i = end;
      continue;
    }
    if (char === "'" || char === '"') {
      const quoted = readQuoted(source, i);
      tokens.push({ type: 'string', value: quoted.value, at: i });
      i = quoted.end;
      continue;
    }
    const number = /^-?[0-9]+(?:\.[0-9]+)?/.exec(source.slice(i));
    if (number !== null) {
      tokens.push({ type: 'number', value: Number(number[0]), at: i });
      i += number[0].length;
      continue;
    }
    const word = /^[A-Za-z]+/.exec(source.slice(i));
    if (word !== null) {
      tokens.push({ type: 'word', text: word[0], at: i });
      i += word[0].length;
      continue;
    }
    const symbol = SYMBOLS.find((candidate) => source.startsWith(candidate, i));
    if (symbol === undefined) throw new CatalogSyntaxError(`unexpected ${JSON.stringify(char)}`, source, i);
    tokens.push({ type: 'symbol', text: symbol, at: i });
    i += symbol.length;
  }
  return tokens;
}

class Parser {
  private index = 0;
  private readonly tokens: Token[];
  private readonly source: string;
  private readonly allowCurrent: boolean;

  constructor(source: string, allowCurrent: boolean) {
    this.source = source;
    this.allowCurrent = allowCurrent;
    this.tokens = tokenize(source);
  }

  parse(): Predicate {
    const predicate = this.or();
    const rest = this.peek();
    if (rest !== undefined) this.fail('unexpected input', rest.at);
    return predicate;
  }

  private peek(): Token | undefined {
    return this.tokens[this.index];
  }

  private fail(message: string, at: number = this.source.length): never {
    throw new CatalogSyntaxError(message, this.source, at);
  }

  private isSymbol(text: string): boolean {
    const token = this.peek();
    return token?.type === 'symbol' && token.text === text;
  }

  private isWord(text: string): boolean {
    const token = this.peek();
    return token?.type === 'word' && token.text === text;
  }

  private expectSymbol(text: string): void {
    if (!this.isSymbol(text)) this.fail(`expected ${text}`, this.peek()?.at);
    this.index += 1;
  }

  private or(): Predicate {
    const items = [this.and()];
    while (this.isSymbol('||')) {
      this.index += 1;
      items.push(this.and());
    }
    return items.length === 1 && items[0] !== undefined ? items[0] : { kind: 'or', items };
  }

  private and(): Predicate {
    const items = [this.unary()];
    while (this.isSymbol('&&')) {
      this.index += 1;
      items.push(this.unary());
    }
    return items.length === 1 && items[0] !== undefined ? items[0] : { kind: 'and', items };
  }

  private unary(): Predicate {
    if (this.isSymbol('!')) {
      this.index += 1;
      return { kind: 'not', item: this.unary() };
    }
    if (this.isSymbol('(')) {
      this.index += 1;
      const inner = this.or();
      this.expectSymbol(')');
      return inner;
    }
    return this.test();
  }

  private literal(): Literal {
    const token = this.peek();
    if (token === undefined) return this.fail('expected a value');
    this.index += 1;
    if (token.type === 'string' || token.type === 'number') return token.value;
    if (token.type === 'word') {
      if (token.text === 'true') return true;
      if (token.text === 'false') return false;
      if (token.text === 'null') return null;
    }
    return this.fail('expected a quoted string, a number, true, false or null', token.at);
  }

  private list(): Literal[] {
    this.expectSymbol('[');
    const values: Literal[] = [];
    if (this.isSymbol(']')) {
      this.index += 1;
      return values;
    }
    values.push(this.literal());
    while (this.isSymbol(',')) {
      this.index += 1;
      values.push(this.literal());
    }
    this.expectSymbol(']');
    return values;
  }

  private string(): string {
    const token = this.peek();
    if (token?.type !== 'string') return this.fail('expected a quoted string', token?.at);
    this.index += 1;
    return token.value;
  }

  private test(): Predicate {
    const token = this.peek();
    if (token?.type !== 'path') return this.fail('expected a path starting with $', token?.at);
    this.index += 1;
    let path: JsonPath;
    try {
      path = parseJsonPath(token.text, { allowCurrent: this.allowCurrent });
    } catch (error) {
      if (error instanceof CatalogSyntaxError) this.fail(error.message, token.at);
      throw error;
    }
    const next = this.peek();
    if (next?.type === 'symbol' && ['==', '!=', '<', '<=', '>', '>='].includes(next.text)) {
      this.index += 1;
      const value = this.literal();
      return { kind: 'test', path, test: { op: 'compare', comparison: next.text as Comparison, value } };
    }
    if (next?.type === 'word') {
      switch (next.text) {
        case 'exists':
        case 'missing':
          this.index += 1;
          return { kind: 'test', path, test: { op: next.text } };
        case 'in':
          this.index += 1;
          return { kind: 'test', path, test: { op: 'in', values: this.list() } };
        case 'not':
          this.index += 1;
          if (!this.isWord('in')) this.fail('expected in after not', this.peek()?.at);
          this.index += 1;
          return { kind: 'test', path, test: { op: 'notIn', values: this.list() } };
        case 'startsWith':
        case 'endsWith':
        case 'contains':
          this.index += 1;
          return { kind: 'test', path, test: { op: next.text, value: this.string() } };
        default:
          this.fail(`unknown operator ${next.text}`, next.at);
      }
    }
    return { kind: 'test', path, test: { op: 'truthy' } };
  }
}

/** Parses a predicate; throws a CatalogSyntaxError naming the position of the first problem. */
export function parsePredicate(source: string, options: { allowCurrent?: boolean } = {}): Predicate {
  return new Parser(source, options.allowCurrent === true).parse();
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && /^-?[0-9]+(?:\.[0-9]+)?$/.test(value.trim())) return Number(value);
  return undefined;
}

function equals(value: unknown, literal: Literal): boolean {
  if (value === literal) return true;
  if (typeof literal === 'number') return asNumber(value) === literal;
  return false;
}

function compare(value: unknown, comparison: Comparison, literal: Literal): boolean {
  if (comparison === '==') return equals(value, literal);
  if (comparison === '!=') return !equals(value, literal);
  const left = asNumber(value);
  const right = asNumber(literal);
  if (left === undefined || right === undefined) return false;
  switch (comparison) {
    case '<':
      return left < right;
    case '<=':
      return left <= right;
    case '>':
      return left > right;
    case '>=':
      return left >= right;
  }
}

function runTest(test: Test, values: readonly unknown[]): boolean {
  switch (test.op) {
    case 'truthy':
      return values.some((value) => value !== null && value !== false && value !== 0 && value !== '');
    case 'exists':
      return values.some((value) => value !== null);
    case 'missing':
      return values.every((value) => value === null);
    case 'compare':
      if (test.comparison === '!=') {
        return values.length > 0 && values.every((value) => compare(value, '!=', test.value));
      }
      return values.some((value) => compare(value, test.comparison, test.value));
    case 'in':
      return values.some((value) => test.values.some((literal) => equals(value, literal)));
    case 'notIn':
      return (
        values.length > 0 && values.every((value) => test.values.every((literal) => !equals(value, literal)))
      );
    case 'startsWith':
      return values.some((value) => typeof value === 'string' && value.startsWith(test.value));
    case 'endsWith':
      return values.some((value) => typeof value === 'string' && value.endsWith(test.value));
    case 'contains':
      return values.some((value) => typeof value === 'string' && value.includes(test.value));
  }
}

/** Whether a parsed predicate holds; `root` is what `$` refers to, `current` what `@` refers to. */
export function testPredicate(predicate: Predicate, root: unknown, current: unknown = root): boolean {
  switch (predicate.kind) {
    case 'or':
      return predicate.items.some((item) => testPredicate(item, root, current));
    case 'and':
      return predicate.items.every((item) => testPredicate(item, root, current));
    case 'not':
      return !testPredicate(predicate.item, root, current);
    case 'test':
      return runTest(predicate.test, selectValues(predicate.path, root, current));
  }
}

const cache = new Map<string, Predicate | null>();

/** Whether a predicate holds for a value (usually an Asset); false when the predicate is malformed. */
export function evaluatePredicate(source: string, root: unknown): boolean {
  let parsed = cache.get(source);
  if (parsed === undefined) {
    try {
      parsed = parsePredicate(source);
    } catch {
      parsed = null;
    }
    cache.set(source, parsed);
  }
  return parsed !== null && testPredicate(parsed, root);
}
