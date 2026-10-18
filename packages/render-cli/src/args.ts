// SPDX-License-Identifier: Apache-2.0
/**
 * The command line of `pnpm render`, parsed into a command. Pure apart from reading `argv`. The view, the theme,
 * the viewport and the PNG's size are read by the model's `readRenderFlags` and checked by `RenderOptionsSchema`
 * as `POST /api/render` checks its fields, so the command takes exactly what the API takes (an invalid filter or
 * focus is an error, never silently dropped as the app's URL normaliser would), and the view is resolved by
 * `viewSpecOf`, as the API resolves it. The outputs, `--compare`, `--strict` and `--all` are this command's own.
 * Paths are left relative for the caller to resolve.
 */
import { parseArgs } from 'node:util';
import {
  DemoSizeSchema,
  DetailLevelSchema,
  FILTER_FLAG_KEYS,
  FocusKindSchema,
  LensIdSchema,
  RENDER_DEFAULT_VIEWPORT,
  RENDER_MAX_SCALE,
  RENDER_MAX_SIDE,
  VIEW_SPEC_MAX_DEPTH,
  decodeViewSpec,
  readRenderFlags,
  type DemoSize,
  type DetailLevel,
  type LensId,
  type RenderFormat,
  type RenderOptions,
  type ViewSpec,
} from '@gcportrait/model';
import { FIXTURES, THEMES, viewSpecOf, type DiagramTheme, type Viewport } from '@gcportrait/render';

export const USAGE = `Usage:
  pnpm render --fixture S|M|L|XL --lens LENS [--png FILE] [--svg FILE]
              [--drawio FILE [--drawio-plain] [--drawio-unversioned]]
              [--theme light|dark] [--detail auto|folders|projects|networks|all] [--focus kind=KIND[,NAME=VALUE...]]
              [--root NODE_ID] [--filter KEY=VALUE ...] [--flip ZONE_ID ...] [--hash VIEW_HASH]
              [--viewport WIDTHxHEIGHT] [--scale N | --width PX] [--compare EXPECTED.png [--max-diff N] [--diff FILE]]
              [--strict]
  pnpm render --all [--out DIR] [--fixtures S,M,L,XL] [--lenses LENS,...] [--themes light,dark]
              [--formats png,svg,drawio] [--drawio-plain] [--drawio-unversioned] [--detail LEVEL]
              [--viewport WIDTHxHEIGHT] [--scale N | --width PX] [--strict]
  pnpm render --list-fixtures

Draws a view of a demo organisation exactly as the app's renderer draws it (legend and title block included) and
writes it as PNG (resvg, 2× by default, on the theme's canvas colour with a 24 px margin), SVG and/or a draw.io file
(the same drawing as cells diagrams.net can edit). Output is byte-stable: the same arguments give the same bytes.
Without --png, --svg or --drawio the PNG goes to out/render/<fixture>-<lens>-<detail>-<theme>.png. A FILE of -
writes to standard output (then the report goes to standard error). The view, --theme, --viewport, --scale and
--width are checked as POST /api/render checks its fields: what the API refuses, this command refuses.

  --fixture    ${FIXTURES.join(', ')} (default M)
  --lens       ${LensIdSchema.options.join(', ')} (default overview)
  --theme      ${THEMES.join(', ')} (default light)
  --detail     ${DetailLevelSchema.options.join(', ')} (default auto: what the app opens at the viewport)
  --focus      kind=${FocusKindSchema.options.join('|')}, then its parameters:
               project=…, host=…, perimeter=…, application=… (e.g. kind=project,project=demo-web-1); a
               parameter's name starts with a letter
  --root       drill in: the id of the container to root the view at
  --filter     ${FILTER_FLAG_KEYS.boolean.join(', ')} (true or false;
               the key alone is true); ${FILTER_FLAG_KEYS.list.join(', ')} (comma-separated);
               ${FILTER_FLAG_KEYS.number.join(', ')} (1–${String(VIEW_SPEC_MAX_DEPTH)})
  --flip       a zone id to flip (expand a chip, collapse an open zone); repeatable
  --hash       the view part of an app URL (after #), e.g. snapshot=demo%3AM&lens=networking; replaces the
               view options above, and its demo snapshot names the fixture; a timeline day (tick) is refused
  --viewport   the canvas size detail auto fits, up to ${String(RENDER_MAX_SIDE)} px a side (default ${String(RENDER_DEFAULT_VIEWPORT.width)}x${String(RENDER_DEFAULT_VIEWPORT.height)})
  --scale      PNG pixels per drawing unit, up to ${String(RENDER_MAX_SCALE)} (default 2); --width sets the PNG width instead
               (margin included); a PNG beyond 16 384 px a side or 2^27 px is drawn at the largest scale that fits;
               either needs a PNG among the files written
  --drawio     the .drawio file, compressed as draw.io saves it; --drawio-plain writes its diagram as plain XML;
               its agent is gcportrait and this command's version, or gcportrait alone with --drawio-unversioned
               (as the render library writes it by default: a release changes no byte)
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
  /** The draw.io file's agent without the command's version (`gcportrait`, as the library writes it by default). */
  readonly drawioUnversioned: boolean;
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
  /** The draw.io files' agent without the command's version. */
  readonly drawioUnversioned: boolean;
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
  'drawio-unversioned': { type: 'boolean' },
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

/**
 * The render options of the view, theme, viewport and PNG flags, checked as the API checks a request for `format`
 * (the PNG-only and draw.io-only rules).
 */
function optionsOf(values: Values, format: RenderFormat): RenderOptions {
  const result = readRenderFlags(
    {
      hash: values.hash,
      lens: values.lens,
      detail: values.detail,
      focus: values.focus,
      root: values.root,
      filter: values.filter,
      flip: values.flip,
      theme: values.theme,
      viewport: values.viewport,
      scale: values.scale,
      width: values.width,
    },
    format,
  );
  if (!result.success) throw new UsageError(result.error);
  return result.options;
}

function rasterOf(options: RenderOptions): RasterChoice {
  return {
    ...(options.scale === undefined ? {} : { scale: options.scale }),
    ...(options.width === undefined ? {} : { width: options.width }),
  };
}

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
  for (const flag of ['drawio-plain', 'drawio-unversioned'] as const) {
    if (values[flag] === true && !formats.includes('drawio'))
      throw new UsageError(`--${flag} needs drawio in --formats`);
  }
  // Checked as the PNG's options when PNGs are among the formats, else as the first format's.
  const options = optionsOf(
    values,
    formats.includes('png') ? 'png' : formats.includes('svg') ? 'svg' : 'drawio',
  );
  return {
    kind: 'all',
    ...(values.out === undefined ? {} : { out: values.out }),
    fixtures: listOf('--fixtures', FIXTURES, values.fixtures),
    lenses: listOf('--lenses', LensIdSchema.options, values.lenses),
    themes: listOf('--themes', THEMES, values.themes),
    formats,
    drawioPlain: values['drawio-plain'] === true,
    drawioUnversioned: values['drawio-unversioned'] === true,
    detail: options.view.detail ?? 'auto',
    viewport: options.viewport,
    raster: rasterOf(options),
    strict: values.strict === true,
  };
}

/** The demo organisation a hash's snapshot names: the fixture of `--hash`. */
function fixtureOfHash(hash: string): DemoSize {
  const { snapshot } = decodeViewSpec(hash);
  const size = DemoSizeSchema.safeParse(snapshot.startsWith('demo:') ? snapshot.slice(5) : '');
  if (!size.success) throw new UsageError('--hash must name a demo snapshot (snapshot=demo:S|M|L|XL)');
  return size.data;
}

function parseRender(values: Values): RenderCommand {
  refuse(values, ALL_FLAGS, 'a single render (they belong to --all)');
  if (values.hash !== undefined) refuse(values, ['fixture'], '--hash (its demo snapshot names the fixture)');
  // Checked as the PNG's options when the command draws one (asked for, compared, or written by default), else as
  // the first file's: --scale and --width apply to a PNG only.
  const drawsPng =
    values.png !== undefined ||
    values.compare !== undefined ||
    (values.svg === undefined && values.drawio === undefined);
  const options = optionsOf(values, drawsPng ? 'png' : values.svg !== undefined ? 'svg' : 'drawio');
  const fixture =
    values.hash === undefined
      ? oneOf('--fixture', FIXTURES, values.fixture ?? 'M')
      : fixtureOfHash(values.hash);
  if ([values.png, values.svg, values.drawio].filter((file) => file === '-').length > 1) {
    throw new UsageError('only one of --png, --svg and --drawio can write to standard output');
  }
  for (const flag of ['drawio-plain', 'drawio-unversioned'] as const) {
    if (values[flag] === true && values.drawio === undefined)
      throw new UsageError(`--${flag} needs --drawio`);
  }
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
    spec: viewSpecOf(options.view, `demo:${fixture}`),
    theme: options.theme,
    viewport: options.viewport,
    raster: rasterOf(options),
    ...outputs,
    drawioPlain: values['drawio-plain'] === true,
    drawioUnversioned: values['drawio-unversioned'] === true,
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
