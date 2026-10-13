// SPDX-License-Identifier: MIT
/**
 * The URL-hash codec for ViewSpec. The grammar, the keys and examples are in the package README. In short:
 * `key=value` fields joined by `&` in a fixed key order, list values joined by `,`, every value item
 * percent-encoded except for a readable safe set, defaults left out (the default view is the empty hash).
 * Decoding is total: unknown keys are ignored and a malformed value falls back to its default, field by
 * field, so any string decodes to a valid ViewSpec. No zod on this path (it runs on the UI thread): the
 * values are judged by normalize.ts's plain predicates, which accept exactly what the schemas accept.
 */
import type { LooseViewSpec, ViewSpec, ViewSpecInput } from '../schemas/view-spec.js';
import { DEFAULT_VIEW_SPEC, normalizeViewSpec } from './normalize.js';

/** `hide=` words and the boolean filters they set, in encoding order. */
const HIDE_FLAGS = [
  ['empty-projects', 'hideEmptyProjects'],
  ['empty-folders', 'hideEmptyFolders'],
  ['disconnected', 'hideDisconnected'],
] as const;

/** List-valued filter keys and their fields, in encoding order. */
const LIST_FILTERS = [
  ['regions', 'regions'],
  ['projects', 'projects'],
  ['folders', 'folders'],
  ['include', 'includeTypes'],
  ['exclude', 'excludeTypes'],
] as const;

/** Tri-state switches (absent, on, off) and their fields, in encoding order. */
const SWITCH_FILTERS = [
  ['show-regions', 'showRegions'],
  ['show-identities', 'showIdentities'],
] as const;

/** Switch values the decoder accepts; the encoder writes `1` and `0`. */
const SWITCH_VALUES = new Map<string | undefined, boolean>([
  ['1', true],
  ['true', true],
  ['0', false],
  ['false', false],
]);

/** Focus parameters are written as `focus.<name>=<value>`. */
const FOCUS_PARAM_PREFIX = 'focus.';

/**
 * Percent-encodes one value item as UTF-8. Letters, digits and `- . _ ~ * / : @` stay as they are; everything
 * else, including the separators `& = , #`, `+`, `%`, spaces and `! ' ( )`, is escaped with upper-case hex.
 */
function escapeItem(value: string): string {
  return encodeURIComponent(value)
    .replace(/[!'()]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%(?:2F|3A|40)/g, (escaped) => decodeURIComponent(escaped));
}

/** The text of one value item, or undefined when its percent-encoding is malformed. `+` is a literal plus. */
function unescapeItem(item: string): string | undefined {
  try {
    return decodeURIComponent(item);
  } catch {
    return undefined;
  }
}

/** A scalar field's items: none when the value is absent or equals the default. */
function scalar(value: string | undefined, omitted?: string): string[] {
  return value === undefined || value === omitted ? [] : [value];
}

function switchWord(value: boolean | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value ? '1' : '0';
}

/**
 * Serialises a view into a URL hash (without the leading `#`). The spec is normalised first, so equivalent
 * specs encode identically and the default view encodes to the empty string.
 */
export function encodeViewSpec(input: ViewSpecInput | LooseViewSpec): string {
  const spec = normalizeViewSpec(input);
  const { filters } = spec;
  const fields: string[] = [];
  const put = (key: string, items: readonly string[]): void => {
    if (items.length > 0) fields.push(`${key}=${items.map(escapeItem).join(',')}`);
  };

  put('snapshot', scalar(spec.snapshot, DEFAULT_VIEW_SPEC.snapshot));
  put('tick', scalar(spec.tick));
  put('lens', scalar(spec.lens, DEFAULT_VIEW_SPEC.lens));
  if (spec.focus) {
    put('focus', [spec.focus.kind]);
    for (const [name, value] of Object.entries(spec.focus.params)) put(FOCUS_PARAM_PREFIX + name, [value]);
  }
  put('root', scalar(spec.root));
  put('detail', scalar(spec.detail, DEFAULT_VIEW_SPEC.detail));
  put(
    'hide',
    HIDE_FLAGS.filter(([, field]) => filters[field]).map(([word]) => word),
  );
  for (const [key, field] of LIST_FILTERS) put(key, filters[field] ?? []);
  put('depth', scalar(filters.depth?.toString()));
  for (const [key, field] of SWITCH_FILTERS) put(key, scalar(switchWord(filters[field])));
  put('flips', spec.flips);
  put('selection', scalar(spec.selection));
  put('highlight', scalar(spec.highlight));
  return fields.join('&');
}

/** The hash's fields by key, values still encoded. The first occurrence of a key wins. */
function readFields(hash: string): Map<string, string> {
  const fields = new Map<string, string>();
  const body = hash.startsWith('#') ? hash.slice(1) : hash;
  for (const field of body.split('&')) {
    const separator = field.indexOf('=');
    if (separator < 1) continue;
    const key = field.slice(0, separator);
    if (!fields.has(key)) fields.set(key, field.slice(separator + 1));
  }
  return fields;
}

/** A decimal string as a number, so the depth schema can judge it; anything else is passed on unchanged. */
function integer(raw: string | undefined): unknown {
  return raw !== undefined && /^[0-9]+$/.test(raw) ? Number(raw) : raw;
}

/**
 * Parses a URL hash (with or without the leading `#`) into a valid ViewSpec. Never throws: unknown keys are
 * ignored, a malformed scalar takes its default, and a list keeps only its well-formed items.
 */
export function decodeViewSpec(hash: string): ViewSpec {
  const fields = readFields(hash);
  const one = (key: string): string | undefined => {
    const raw = fields.get(key);
    return raw === undefined ? undefined : unescapeItem(raw);
  };
  const list = (key: string): (string | undefined)[] => (fields.get(key)?.split(',') ?? []).map(unescapeItem);

  const hidden = new Set(list('hide'));
  const filters: Record<string, unknown> = { depth: integer(one('depth')) };
  for (const [word, field] of HIDE_FLAGS) filters[field] = hidden.has(word);
  for (const [key, field] of LIST_FILTERS) filters[field] = list(key);
  for (const [key, field] of SWITCH_FILTERS) filters[field] = SWITCH_VALUES.get(one(key));

  const params = [...fields]
    .filter(([key]) => key.startsWith(FOCUS_PARAM_PREFIX))
    .map(([key, raw]) => [key.slice(FOCUS_PARAM_PREFIX.length), unescapeItem(raw)] as const);

  return normalizeViewSpec({
    snapshot: one('snapshot'),
    tick: one('tick'),
    lens: one('lens'),
    focus: { kind: one('focus'), params: Object.fromEntries(params) },
    root: one('root'),
    filters,
    detail: one('detail'),
    flips: list('flips'),
    selection: one('selection'),
    highlight: one('highlight'),
  });
}
