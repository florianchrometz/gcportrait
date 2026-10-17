// SPDX-License-Identifier: MIT
/**
 * The render flags of the command lines (`pnpm render`, `pnpm render-scene`) read into the render options: one
 * reader for both, checked by `RenderOptionsSchema`, so a command line takes exactly what `POST /api/render`
 * takes (backend/AGENTS.md, The render API). The reader knows each flag's grammar only:
 * `--focus kind=KIND[,NAME=VALUE…]`, `--filter KEY=VALUE` (a boolean key alone is `KEY=true`; a boolean filter takes
 * `true` or `false`, a list filter comma-separated items, `depth` a number), `--viewport WIDTHxHEIGHT`, and a
 * number for `--scale` and `--width`. Every value is then judged by the schema, and each of its issues is told
 * in the flag's words (`--filter depth: Too small: …`), quoting what was typed where that helps; the API's own
 * messages never name a value, a command line's may.
 */
import * as z from 'zod';

import { RenderOptionsSchema, type RenderFormat, type RenderOptions } from './render.js';
import { ViewFiltersSchema } from './view-spec.js';

/** The flags as a command line gave them, each one optional: an absent flag takes the field's default. */
export interface RenderFlags {
  /** `--hash`: an app link's view (the part after `#`); excludes the other view flags. */
  readonly hash?: string | undefined;
  readonly lens?: string | undefined;
  readonly detail?: string | undefined;
  /** `--focus kind=KIND[,NAME=VALUE…]`. */
  readonly focus?: string | undefined;
  /** `--root NODE_ID`: drill in. */
  readonly root?: string | undefined;
  /** `--filter KEY=VALUE`, repeatable; empty is none. */
  readonly filter?: readonly string[] | undefined;
  /** `--flip ZONE_ID`, repeatable; empty is none. */
  readonly flip?: readonly string[] | undefined;
  readonly theme?: string | undefined;
  /** `--viewport WIDTHxHEIGHT`: the canvas the `auto` detail level fits. */
  readonly viewport?: string | undefined;
  /** `--scale N`: PNG pixels per drawing unit. */
  readonly scale?: string | undefined;
  /** `--width PX`: the PNG's width. */
  readonly width?: string | undefined;
}

/** The render options the flags name, or every problem with them in one message. */
export type RenderFlagsResult =
  | { readonly success: true; readonly options: RenderOptions }
  | { readonly success: false; readonly error: string };

/** How `--filter KEY=VALUE` writes a filter: `true` or `false`, comma-separated items, or a number. */
export type FilterFlagKind = 'boolean' | 'list' | 'number';

function kindOf(schema: z.ZodType): FilterFlagKind {
  const inner: unknown = schema instanceof z.ZodExactOptional ? schema.unwrap() : schema;
  if (inner instanceof z.ZodBoolean) return 'boolean';
  if (inner instanceof z.ZodArray) return 'list';
  return 'number';
}

/** Each filter's kind, read from `ViewFiltersSchema` in its order, so no second list of the filters exists. */
const FILTER_KINDS: ReadonlyMap<string, FilterFlagKind> = new Map(
  Object.entries(ViewFiltersSchema.shape).map(([key, schema]) => [key, kindOf(schema)]),
);

function keysOf(kind: FilterFlagKind): readonly string[] {
  return Object.freeze([...FILTER_KINDS].flatMap(([key, of]) => (of === kind ? [key] : [])));
}

/** The filters `--filter` takes, by how it writes them, in the schema's order (for a command's usage text). */
export const FILTER_FLAG_KEYS: Readonly<Record<FilterFlagKind, readonly string[]>> = Object.freeze({
  boolean: keysOf('boolean'),
  list: keysOf('list'),
  number: keysOf('number'),
});

/** The fields that are given (not `undefined`), as an object. */
function given(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}

/** A flag's number, or its text when it holds none, so that the schema refuses it and the message quotes it. */
function numberOf(text: string): number | string {
  const value = Number(text);
  return text.trim() === '' || Number.isNaN(value) ? text : value;
}

/** `kind=KIND[,NAME=VALUE…]` as a focus; a pair without `=` is a problem. */
function focusOf(text: string, problems: string[]): Record<string, unknown> {
  let kind: string | undefined;
  const params: [string, string][] = [];
  for (const pair of text.split(',')) {
    const at = pair.indexOf('=');
    if (at < 0) problems.push(`--focus takes NAME=VALUE pairs, not "${pair}"`);
    else if (pair.slice(0, at) === 'kind') kind = pair.slice(at + 1);
    else params.push([pair.slice(0, at), pair.slice(at + 1)]);
  }
  return given({ kind, params: Object.fromEntries(params) });
}

/** A filter's text as its field takes it; the text of an unknown filter is left for the schema to refuse. */
function filterValue(kind: FilterFlagKind | undefined, text: string): unknown {
  if (kind === 'boolean') return text === 'true' ? true : text === 'false' ? false : text;
  if (kind === 'list') return text.split(',').filter((item) => item !== '');
  if (kind === 'number') return numberOf(text);
  return text;
}

/** `KEY=VALUE` entries (a boolean key alone is `KEY=true`) as filters; the last entry of a key wins. */
function filtersOf(entries: readonly string[], problems: string[]): Record<string, unknown> {
  const filters = new Map<string, unknown>();
  for (const entry of entries) {
    const at = entry.indexOf('=');
    const key = at < 0 ? entry : entry.slice(0, at);
    const kind = FILTER_KINDS.get(key);
    if (at < 0 && kind !== undefined && kind !== 'boolean') {
      problems.push(`--filter ${key} needs a value: ${key}=VALUE`);
      continue;
    }
    filters.set(key, filterValue(kind, at < 0 ? 'true' : entry.slice(at + 1)));
  }
  return Object.fromEntries(filters);
}

/** `WIDTHxHEIGHT` as a viewport; anything else is a problem. */
function viewportOf(text: string, problems: string[]): Record<string, unknown> {
  const match = /^(\d+)x(\d+)$/.exec(text);
  if (match === null) problems.push(`--viewport takes WIDTHxHEIGHT, not "${text}"`);
  return { width: Number(match?.[1]), height: Number(match?.[2]) };
}

/** `, not "…"` with what was typed (a flag's text, or the number read from it), when the issue reports it. */
function quoted(input: unknown): string {
  return typeof input === 'string' || typeof input === 'number' ? `, not "${String(input)}"` : '';
}

/**
 * An issue of the options in the command line's words: the flag, the filter, focus parameter or viewport side it
 * is about, then what is wrong.
 */
function messageOf(issue: z.core.$ZodIssue): string {
  const [field, ...rest] = issue.path[0] === 'view' ? issue.path.slice(1) : issue.path;
  const flag = field === 'filters' ? '--filter' : field === 'flips' ? '--flip' : `--${String(field)}`;
  const label = [
    flag,
    ...rest.filter((part): part is string => typeof part === 'string' && part !== 'params'),
  ].join(' ');
  switch (issue.code) {
    case 'invalid_value':
      return field === 'focus'
        ? `--focus needs kind=${issue.values.join('|')}${quoted(issue.input)}`
        : `${label} takes ${issue.values.join(', ')}${quoted(issue.input)}`;
    case 'invalid_type': {
      const takes =
        issue.expected === 'boolean'
          ? 'true or false'
          : issue.expected === 'int'
            ? 'a whole number'
            : 'a number';
      return `${label} takes ${takes}${quoted(issue.input)}`;
    }
    // The one object whose keys come from the command line is the filters.
    case 'unrecognized_keys':
      return `${label} takes ${[...FILTER_KINDS.keys()].join(', ')}, not ${issue.keys.map((key) => `"${key}"`).join(', ')}`;
    // The one record is a focus's parameters.
    case 'invalid_key':
      return `${flag} parameter "${String(issue.input)}": ${issue.issues.map((inner) => inner.message).join('; ')}`;
    default:
      return `${label}: ${issue.message}`;
  }
}

/**
 * The render options of a command line's flags, checked by `RenderOptionsSchema` with `format` (default `png`) for
 * its PNG-only and draw.io-only rules; on failure, every problem in one message (`; ` between them).
 */
export function readRenderFlags(flags: RenderFlags, format: RenderFormat = 'png'): RenderFlagsResult {
  const problems: string[] = [];
  const view = given({
    hash: flags.hash,
    lens: flags.lens,
    detail: flags.detail,
    focus: flags.focus === undefined ? undefined : focusOf(flags.focus, problems),
    root: flags.root,
    filters:
      flags.filter === undefined || flags.filter.length === 0 ? undefined : filtersOf(flags.filter, problems),
    flips: flags.flip === undefined || flags.flip.length === 0 ? undefined : [...flags.flip],
  });
  const input = given({
    view,
    theme: flags.theme,
    format,
    viewport: flags.viewport === undefined ? undefined : viewportOf(flags.viewport, problems),
    scale: flags.scale === undefined ? undefined : numberOf(flags.scale),
    width: flags.width === undefined ? undefined : numberOf(flags.width),
  });
  if (problems.length > 0) return { success: false, error: problems.join('; ') };
  const result = RenderOptionsSchema.safeParse(input, { reportInput: true });
  return result.success
    ? { success: true, options: result.data }
    : { success: false, error: result.error.issues.map(messageOf).join('; ') };
}
