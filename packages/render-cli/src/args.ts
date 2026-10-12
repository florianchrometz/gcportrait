// SPDX-License-Identifier: MIT
/**
 * The command line of `pnpm render`, parsed into a command. Pure apart from reading `argv`: every value is
 * checked here (an invalid filter or focus is an error, never silently dropped as the app's URL normaliser
 * would), and paths are left relative for the caller to resolve.
 */
import { parseArgs } from 'node:util';
import { flipIdOf } from '@gcportrait/graph';
import {
  DemoSizeSchema,
  DetailLevelSchema,
  FocusKindSchema,
  LensIdSchema,
  ViewFiltersSchema,
  decodeViewSpec,
  normalizeViewSpec,
  type DemoSize,
  type DetailLevel,
  type LensId,
  type ViewSpec,
} from '@gcportrait/model';
import {
  DEFAULT_VIEWPORT,
  FIXTURES,
  isTheme,
  MAX_SCALE,
  RASTER_LIMITS,
  THEMES,
  type DiagramTheme,
  type Viewport,
} from '@gcportrait/render';

export const USAGE = `Usage:
  pnpm render --fixture S|M|L|XL --lens LENS [--png FILE] [--svg FILE] [--drawio FILE [--drawio-plain]]
              [--theme light|dark] [--detail auto|folders|projects|networks|all] [--focus kind=KIND[,NAME=VALUE...]]
              [--root NODE_ID] [--filter KEY=VALUE ...] [--flip ZONE_ID ...] [--hash VIEW_HASH]
              [--viewport WIDTHxHEIGHT] [--scale N | --width PX] [--compare EXPECTED.png [--max-diff N] [--diff FILE]]
              [--strict]
  pnpm render --all [--out DIR] [--fixtures S,M,L,XL] [--lenses LENS,...] [--themes light,dark]
              [--formats png,svg,drawio] [--drawio-plain] [--detail LEVEL] [--viewport WIDTHxHEIGHT]
              [--scale N | --width PX] [--strict]
  pnpm render --list-fixtures

Draws a view of a demo organisation exactly as the app draws it (legend and title block included) and writes
it as PNG (resvg, 2× by default, on the theme's canvas colour with a 24 px margin), SVG and/or a draw.io file (the
same drawing as cells diagrams.net can edit). Output is byte-stable: the same arguments give the same bytes. Without
--png, --svg or --drawio the PNG goes to out/render/<fixture>-<lens>-<detail>-<theme>.png. A FILE of - writes to
standard output (then the report goes to standard error).

  --fixture    ${FIXTURES.join(', ')} (default M)
  --lens       ${LensIdSchema.options.join(', ')} (default overview)
  --theme      ${THEMES.join(', ')} (default light)
  --detail     ${DetailLevelSchema.options.join(', ')} (default auto: what the app opens at the viewport)
  --focus      kind=${FocusKindSchema.options.join('|')}, then its parameters:
               project=…, host=…, perimeter=…, application=… (e.g. kind=project,project=demo-web-1)
  --root       drill in: the id of the container to root the view at
  --filter     hideEmptyProjects, hideEmptyFolders, hideDisconnected, showRegions, showIdentities (true|false);
               regions, projects, folders, includeTypes, excludeTypes (comma-separated); depth (1–64)
  --flip       a zone id to flip (expand a chip, collapse an open zone); repeatable
  --hash       the view part of an app URL (after #), e.g. snapshot=demo%3AM&lens=networking; replaces the
               view options above, and its demo snapshot names the fixture
  --viewport   the canvas size detail auto fits (default ${String(DEFAULT_VIEWPORT.width)}x${String(DEFAULT_VIEWPORT.height)})
  --scale      PNG pixels per drawing unit, up to ${String(MAX_SCALE)} (default 2); --width sets the PNG width instead
               (margin included); a PNG beyond 16 384 px a side or 2^27 px is drawn at the largest scale that fits
  --drawio     the .drawio file, compressed as draw.io saves it; --drawio-plain writes its diagram as plain XML
  --compare    compare the PNG with EXPECTED.png (pixelmatch, threshold 0); exit 1 when more than --max-diff
               pixels (default 0) differ; --diff writes the differences as an image
  --strict     exit 1 when the layout breaks an invariant (overlap, edge through a card, …)
  --all        every fixture × lens × theme into --out (default out/render/all), with an index.json`;

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

export type OutputFormat = 'png' | 'svg' | 'drawio';

export interface RasterChoice {
  readonly scale?: number;
  readonly width?: number;
}

export interface RenderCommand {
  readonly kind: 'render';
  readonly fixture: DemoSize;
  readonly spec: ViewSpec;
  readonly theme: DiagramTheme;
  readonly viewport: Viewport;
  readonly raster: RasterChoice;
  /** At least one of them; `-` is standard output. */
  readonly png?: string;
  readonly svg?: string;
  readonly drawio?: string;
  /** The draw.io file's diagram as plain XML rather than compressed. */
  readonly drawioPlain: boolean;
  readonly compare?: { readonly expected: string; readonly maxDiff: number; readonly diff?: string };
  readonly strict: boolean;
}

export interface AllCommand {
  readonly kind: 'all';
  readonly out?: string;
  readonly fixtures: readonly DemoSize[];
  readonly lenses: readonly LensId[];
  readonly themes: readonly DiagramTheme[];
  readonly formats: readonly OutputFormat[];
  /** The draw.io files' diagrams as plain XML rather than compressed. */
  readonly drawioPlain: boolean;
  readonly detail: DetailLevel;
  readonly viewport: Viewport;
  readonly raster: RasterChoice;
  readonly strict: boolean;
}

export type Command =
  { readonly kind: 'help' } | { readonly kind: 'list-fixtures' } | RenderCommand | AllCommand;

/** The file name (without extension) of a demo view: `M-networking-auto-light`. */
export function viewFileName(
  fixture: DemoSize,
  lens: LensId,
  detail: DetailLevel,
  theme: DiagramTheme,
): string {
  return `${fixture}-${lens}-${detail}-${theme}`;
}

const BOOLEAN_FILTERS = new Set([
  'hideEmptyProjects',
  'hideEmptyFolders',
  'hideDisconnected',
  'showRegions',
  'showIdentities',
]);
const LIST_FILTERS = new Set(['regions', 'projects', 'folders', 'includeTypes', 'excludeTypes']);

function parseFilters(entries: readonly string[]): Record<string, unknown> {
  const filters: Record<string, unknown> = {};
  for (const entry of entries) {
    const at = entry.indexOf('=');
    const key = at < 0 ? entry : entry.slice(0, at);
    const value = at < 0 ? 'true' : entry.slice(at + 1);
    if (BOOLEAN_FILTERS.has(key)) {
      if (value !== 'true' && value !== 'false') {
        throw new UsageError(`--filter ${key} takes true or false, not "${value}"`);
      }
      filters[key] = value === 'true';
    } else if (LIST_FILTERS.has(key)) {
      filters[key] = value.split(',').filter((item) => item !== '');
    } else if (key === 'depth') {
      filters[key] = Number(value);
    } else {
      throw new UsageError(`unknown filter "${key}"`);
    }
  }
  const result = ViewFiltersSchema.partial().safeParse(filters);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new UsageError(`invalid --filter ${String(issue?.path[0] ?? '')}: ${issue?.message ?? 'invalid'}`);
  }
  return filters;
}

function parseFocus(value: string): NonNullable<ViewSpec['focus']> {
  const params: Record<string, string> = {};
  let kind: string | undefined;
  for (const pair of value.split(',')) {
    const at = pair.indexOf('=');
    if (at <= 0) throw new UsageError(`--focus takes NAME=VALUE pairs, not "${pair}"`);
    const name = pair.slice(0, at);
    if (name === 'kind') kind = pair.slice(at + 1);
    else params[name] = pair.slice(at + 1);
  }
  const parsed = FocusKindSchema.safeParse(kind);
  if (!parsed.success) throw new UsageError(`--focus needs kind=${FocusKindSchema.options.join('|')}`);
  return { kind: parsed.data, params };
}

function parseViewport(value: string | undefined): Viewport {
  if (value === undefined) return DEFAULT_VIEWPORT;
  const match = /^(\d{1,5})x(\d{1,5})$/.exec(value);
  const width = Number(match?.[1]);
  const height = Number(match?.[2]);
  if (match === null || width < 1 || height < 1) {
    throw new UsageError(`--viewport takes WIDTHxHEIGHT, not "${value}"`);
  }
  return { width, height };
}

function parseRaster(scale: string | undefined, width: string | undefined): RasterChoice {
  if (scale !== undefined && width !== undefined) throw new UsageError('give --scale or --width, not both');
  if (scale !== undefined) {
    const value = Number(scale);
    if (!(value > 0) || value > MAX_SCALE) {
      throw new UsageError(`--scale takes a number above 0 and up to ${String(MAX_SCALE)}, not "${scale}"`);
    }
    return { scale: value };
  }
  if (width !== undefined) {
    const value = Number(width);
    if (!Number.isInteger(value) || value < 1 || value > RASTER_LIMITS.side) {
      throw new UsageError(
        `--width takes a whole number of pixels (1–${String(RASTER_LIMITS.side)}), not "${width}"`,
      );
    }
    return { width: value };
  }
  return {};
}

function oneOf<T extends string>(flag: string, options: readonly T[], value: string): T {
  const found = options.find((option) => option === value);
  if (found === undefined) throw new UsageError(`${flag} takes ${options.join(', ')}, not "${value}"`);
  return found;
}

function listOf<T extends string>(
  flag: string,
  options: readonly T[],
  value: string | undefined,
  fallback: readonly T[] = options,
): T[] {
  if (value === undefined) return [...fallback];
  const items = value.split(',').filter((item) => item !== '');
  if (items.length === 0) throw new UsageError(`${flag} needs at least one value`);
  return [...new Set(items.map((item) => oneOf(flag, options, item)))];
}

const OPTIONS = {
  fixture: { type: 'string' },
  lens: { type: 'string' },
  theme: { type: 'string' },
  detail: { type: 'string' },
  focus: { type: 'string' },
  root: { type: 'string' },
  filter: { type: 'string', multiple: true },
  flip: { type: 'string', multiple: true },
  hash: { type: 'string' },
  viewport: { type: 'string' },
  scale: { type: 'string' },
  width: { type: 'string' },
  png: { type: 'string' },
  svg: { type: 'string' },
  drawio: { type: 'string' },
  'drawio-plain': { type: 'boolean' },
  compare: { type: 'string' },
  'max-diff': { type: 'string' },
  diff: { type: 'string' },
  strict: { type: 'boolean' },
  all: { type: 'boolean' },
  out: { type: 'string' },
  fixtures: { type: 'string' },
  lenses: { type: 'string' },
  themes: { type: 'string' },
  formats: { type: 'string' },
  'list-fixtures': { type: 'boolean' },
  help: { type: 'boolean' },
} as const;

type Values = ReturnType<typeof parseArgs<{ options: typeof OPTIONS; strict: true }>>['values'];

function refuse(values: Values, names: readonly (keyof Values)[], mode: string): void {
  const given = names.filter((name) => values[name] !== undefined);
  if (given.length > 0) throw new UsageError(`--${String(given[0])} cannot be used with ${mode}`);
}

const VIEW_FLAGS = ['lens', 'detail', 'focus', 'root', 'filter', 'flip'] as const;
const SINGLE_FLAGS = [
  'fixture',
  'lens',
  'theme',
  'focus',
  'root',
  'filter',
  'flip',
  'hash',
  'png',
  'svg',
  'drawio',
  'compare',
  'max-diff',
  'diff',
] as const;
const ALL_FLAGS = ['out', 'fixtures', 'lenses', 'themes', 'formats'] as const;

function parseAll(values: Values): AllCommand {
  refuse(values, SINGLE_FLAGS, '--all');
  const formats = listOf('--formats', ['png', 'svg', 'drawio'] as const, values.formats, ['png', 'svg']);
  if (values['drawio-plain'] === true && !formats.includes('drawio'))
    throw new UsageError('--drawio-plain needs drawio in --formats');
  return {
    kind: 'all',
    ...(values.out === undefined ? {} : { out: values.out }),
    fixtures: listOf('--fixtures', FIXTURES, values.fixtures),
    lenses: listOf('--lenses', LensIdSchema.options, values.lenses),
    themes: listOf('--themes', THEMES, values.themes),
    formats,
    drawioPlain: values['drawio-plain'] === true,
    detail: oneOf('--detail', DetailLevelSchema.options, values.detail ?? 'auto'),
    viewport: parseViewport(values.viewport),
    raster: parseRaster(values.scale, values.width),
    strict: values.strict === true,
  };
}

function specFromHash(hash: string): { fixture: DemoSize; spec: ViewSpec } {
  const spec = decodeViewSpec(hash.startsWith('#') ? hash : `#${hash}`);
  const size = DemoSizeSchema.safeParse(spec.snapshot.startsWith('demo:') ? spec.snapshot.slice(5) : '');
  if (!size.success) throw new UsageError('--hash must name a demo snapshot (snapshot=demo:S|M|L|XL)');
  return { fixture: size.data, spec };
}

function parseRender(values: Values): RenderCommand {
  refuse(values, ALL_FLAGS, 'a single render (they belong to --all)');
  let fixture: DemoSize;
  let spec: ViewSpec;
  if (values.hash !== undefined) {
    refuse(values, ['fixture', ...VIEW_FLAGS], '--hash (the hash holds the whole view)');
    ({ fixture, spec } = specFromHash(values.hash));
  } else {
    fixture = oneOf('--fixture', FIXTURES, values.fixture ?? 'M');
    const focus = values.focus === undefined ? undefined : parseFocus(values.focus);
    spec = normalizeViewSpec({
      snapshot: `demo:${fixture}`,
      lens: oneOf('--lens', LensIdSchema.options, values.lens ?? 'overview'),
      detail: oneOf('--detail', DetailLevelSchema.options, values.detail ?? 'auto'),
      filters: parseFilters(values.filter ?? []),
      flips: (values.flip ?? []).map(flipIdOf),
      ...(focus === undefined ? {} : { focus }),
      ...(values.root === undefined ? {} : { root: values.root }),
    });
  }
  const themeName = values.theme ?? 'light';
  if (!isTheme(themeName)) throw new UsageError(`--theme takes ${THEMES.join(', ')}, not "${themeName}"`);
  if ([values.png, values.svg, values.drawio].filter((file) => file === '-').length > 1) {
    throw new UsageError('only one of --png, --svg and --drawio can write to standard output');
  }
  if (values['drawio-plain'] === true && values.drawio === undefined)
    throw new UsageError('--drawio-plain needs --drawio');
  if (values.compare === undefined) {
    const orphan = (['max-diff', 'diff'] as const).find((name) => values[name] !== undefined);
    if (orphan !== undefined) throw new UsageError(`--${orphan} needs --compare`);
  }
  let compare: RenderCommand['compare'];
  if (values.compare !== undefined) {
    const maxDiff = Number(values['max-diff'] ?? '0');
    if (!Number.isInteger(maxDiff) || maxDiff < 0) {
      throw new UsageError(`--max-diff takes a whole number of pixels, not "${values['max-diff'] ?? ''}"`);
    }
    compare = {
      expected: values.compare,
      maxDiff,
      ...(values.diff === undefined ? {} : { diff: values.diff }),
    };
  }
  const outputs = {
    ...(values.png === undefined ? {} : { png: values.png }),
    ...(values.svg === undefined ? {} : { svg: values.svg }),
    ...(values.drawio === undefined ? {} : { drawio: values.drawio }),
  };
  return {
    kind: 'render',
    fixture,
    spec,
    theme: themeName,
    viewport: parseViewport(values.viewport),
    raster: parseRaster(values.scale, values.width),
    ...outputs,
    drawioPlain: values['drawio-plain'] === true,
    ...(compare === undefined ? {} : { compare }),
    strict: values.strict === true,
  };
}

export function parseCommand(argv: readonly string[]): Command {
  let values: Values;
  try {
    ({ values } = parseArgs({ args: [...argv], options: OPTIONS, strict: true, allowPositionals: false }));
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
  if (values.help === true) return { kind: 'help' };
  if (values['list-fixtures'] === true) {
    const others = (Object.keys(values) as (keyof Values)[]).filter((key) => key !== 'list-fixtures');
    if (others.length > 0) throw new UsageError(`--${String(others[0])} cannot be used with --list-fixtures`);
    return { kind: 'list-fixtures' };
  }
  return values.all === true ? parseAll(values) : parseRender(values);
}
