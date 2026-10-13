// SPDX-License-Identifier: MIT
/**
 * `pnpm render-scene`: builds the Scene of a view of a demo organisation and prints a summary (or the whole
 * scene and report as JSON). The same path as the app: CAI NDJSON → ingest → graph builder → scene builder,
 * with the real asset catalog.
 *
 *   pnpm render-scene --fixture M --lens networking
 *   pnpm render-scene --fixture S --lens overview --focus kind=project,project=demo-web-1 --detail all
 *   pnpm render-scene --fixture M --lens everything --filter hideEmptyProjects=true --filter regions=us-central1
 *   pnpm render-scene --fixture L --lens networking --json > scene.json
 *
 * S and M are read from demo-data's committed NDJSON fixtures; L is generated (and serialised to NDJSON first,
 * so it takes the same ingest path).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { catalog } from '@gcportrait/catalog';
import {
  DEMO_ORGANIZATION_DOMAIN,
  DEMO_ORGANIZATION_IDS,
  DEMO_TODAY,
  generateOrganization,
  toCaiNdjson,
} from '@gcportrait/demo-data';
import { ingest } from '@gcportrait/ingest';
import {
  DetailLevelSchema,
  FocusKindSchema,
  LensIdSchema,
  RelationKindSchema,
  ViewFiltersSchema,
  ZoneKindSchema,
  normalizeViewSpec,
  type Catalog,
  type SceneBuild,
  type SceneNode,
  type Snapshot,
  type ViewSpec,
} from '@gcportrait/model';
import { buildGraphWithReport, buildSceneWithReport, flipIdOf, viewportBudget } from '../src/index.js';

export const FIXTURES_DIR = path.resolve(import.meta.dirname, '../../demo-data/fixtures');
const FIXTURES = ['S', 'M', 'L'] as const;
type Fixture = (typeof FIXTURES)[number];

/**
 * The banner: the command's name, first in the summary and alone on standard error with `--json`. It carries
 * no affiliation line (it belongs in footers and long-form texts only: agents.md, Non-affiliation, brand and
 * legal).
 */
export const BANNER = 'gcportrait render-scene';

export const USAGE = `Usage:
  pnpm render-scene --fixture S|M|L [--lens LENS] [--focus kind=KIND[,NAME=VALUE...]] [--root NODE_ID]
                    [--detail auto|folders|projects|networks|all] [--filter KEY=VALUE ...] [--flip ZONE_ID ...]
                    [--budget N | --viewport WIDTHxHEIGHT] [--selection NODE_ID] [--highlight TEXT] [--json]

Builds the scene of a view of a demo organisation and prints a summary: zones by kind, cards, edges by kind,
chips, dangling references and warnings. --json prints the scene and its report instead.

  --lens       ${LensIdSchema.options.join(', ')} (default overview)
  --focus      kind=${FocusKindSchema.options.join('|')}, then its parameters:
               project=…, host=…, perimeter=…, application=… (e.g. kind=project,project=demo-web-1)
  --filter     hideEmptyProjects, hideEmptyFolders, hideDisconnected, showRegions, showIdentities (true|false);
               regions, projects, folders, includeTypes, excludeTypes (comma-separated); depth (1–64)
  --flip       a zone id to flip (expand a chip, collapse an open zone); repeatable
  --budget     the rect budget of detail level auto (default: the 1280×800 viewport's, 73)`;

export class UsageError extends Error {}

export interface Command {
  readonly fixture: Fixture;
  readonly spec: ViewSpec;
  readonly budget: number | undefined;
  readonly json: boolean;
}

const BOOLEAN_FILTERS = [
  'hideEmptyProjects',
  'hideEmptyFolders',
  'hideDisconnected',
  'showRegions',
  'showIdentities',
];
const LIST_FILTERS = ['regions', 'projects', 'folders', 'includeTypes', 'excludeTypes'];

function parseBoolean(key: string, value: string): boolean {
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  throw new UsageError(`--filter ${key} takes true or false, not "${value}"`);
}

/** The `--filter` values, each checked against the ViewSpec schema. */
function parseFilters(entries: readonly string[]): Record<string, unknown> {
  const filters: Record<string, unknown> = {};
  for (const entry of entries) {
    const at = entry.indexOf('=');
    const key = at < 0 ? entry : entry.slice(0, at);
    const value = at < 0 ? 'true' : entry.slice(at + 1);
    if (BOOLEAN_FILTERS.includes(key)) filters[key] = parseBoolean(key, value);
    else if (LIST_FILTERS.includes(key)) filters[key] = value.split(',').filter((item) => item !== '');
    else if (key === 'depth') filters[key] = Number(value);
    else throw new UsageError(`unknown filter "${key}"`);
  }
  // Every value must survive validation: the app's normaliser drops invalid ones silently, a CLI should not.
  const result = ViewFiltersSchema.partial().safeParse(filters);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new UsageError(`invalid --filter ${String(issue?.path[0] ?? '')}: ${issue?.message ?? 'invalid'}`);
  }
  return filters;
}

function parseFocus(value: string | undefined): ViewSpec['focus'] {
  if (value === undefined) return undefined;
  const pairs = value.split(',').map((pair) => {
    const at = pair.indexOf('=');
    if (at < 0) throw new UsageError(`--focus takes NAME=VALUE pairs, not "${pair}"`);
    return [pair.slice(0, at), pair.slice(at + 1)] as const;
  });
  const params = Object.fromEntries(pairs);
  const kind = FocusKindSchema.safeParse(params.kind);
  if (!kind.success) throw new UsageError(`--focus needs kind=${FocusKindSchema.options.join('|')}`);
  delete params.kind;
  return { kind: kind.data, params };
}

function parseBudget(budget: string | undefined, viewport: string | undefined): number | undefined {
  if (budget !== undefined) {
    const value = Number(budget);
    if (!Number.isInteger(value) || value < 1)
      throw new UsageError(`--budget takes a positive integer, not "${budget}"`);
    return value;
  }
  if (viewport === undefined) return undefined;
  const match = /^(\d+)x(\d+)$/.exec(viewport);
  if (match === null) throw new UsageError(`--viewport takes WIDTHxHEIGHT, not "${viewport}"`);
  return viewportBudget(Number(match[1]), Number(match[2]));
}

export function parseCommand(argv: readonly string[]): Command | 'help' {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      fixture: { type: 'string', default: 'M' },
      lens: { type: 'string', default: 'overview' },
      focus: { type: 'string' },
      root: { type: 'string' },
      detail: { type: 'string', default: 'auto' },
      filter: { type: 'string', multiple: true, default: [] },
      flip: { type: 'string', multiple: true, default: [] },
      budget: { type: 'string' },
      viewport: { type: 'string' },
      selection: { type: 'string' },
      highlight: { type: 'string' },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  if (values.help) return 'help';
  const fixture = FIXTURES.find((size) => size === values.fixture);
  if (fixture === undefined)
    throw new UsageError(`--fixture takes ${FIXTURES.join(', ')}, not "${values.fixture}"`);
  const lens = LensIdSchema.safeParse(values.lens);
  if (!lens.success)
    throw new UsageError(`--lens takes ${LensIdSchema.options.join(', ')}, not "${values.lens}"`);
  const detail = DetailLevelSchema.safeParse(values.detail);
  if (!detail.success) {
    throw new UsageError(`--detail takes ${DetailLevelSchema.options.join(', ')}, not "${values.detail}"`);
  }
  const focus = parseFocus(values.focus);
  const spec = normalizeViewSpec({
    snapshot: `demo:${fixture}`,
    lens: lens.data,
    detail: detail.data,
    filters: parseFilters(values.filter),
    flips: values.flip.map(flipIdOf),
    ...(focus === undefined ? {} : { focus }),
    ...(values.root === undefined ? {} : { root: values.root }),
    ...(values.selection === undefined ? {} : { selection: values.selection }),
    ...(values.highlight === undefined ? {} : { highlight: values.highlight }),
  });
  return { fixture, spec, budget: parseBudget(values.budget, values.viewport), json: values.json };
}

/** The demo organisation as CAI NDJSON: the committed fixture for S and M, generated for L. */
export function fixtureNdjson(fixture: Fixture): string {
  if (fixture === 'L') return toCaiNdjson(generateOrganization({ size: 'L' }).assets);
  return readFileSync(path.join(FIXTURES_DIR, `${fixture}.ndjson`), 'utf8');
}

/** Ingests a demo organisation the way the app does, deterministically (fixed clock and entropy). */
export async function loadFixture(fixture: Fixture): Promise<Snapshot> {
  const readTime = `${DEMO_TODAY}T00:00:00Z`;
  const { snapshot } = await ingest(fixtureNdjson(fixture), {
    scope: {
      kind: 'organization',
      id: DEMO_ORGANIZATION_IDS[fixture],
      displayName: DEMO_ORGANIZATION_DOMAIN,
    },
    source: { kind: 'demo', detail: `demo:${fixture}` },
    readTime,
    clock: () => Date.parse(readTime),
    entropy: () => 0.5,
  });
  return snapshot;
}

function plural(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? '' : 's'}`;
}

function counted<T extends string>(order: readonly T[], values: readonly T[]): string {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const parts = order.flatMap((key) => {
    const count = counts.get(key);
    return count === undefined ? [] : [`${key} ${String(count)}`];
  });
  return parts.length === 0 ? 'none' : parts.join(', ');
}

/** A human-readable summary of a scene and its report. */
export function summarize(
  fixture: Fixture,
  snapshot: Snapshot,
  catalogVersion: string,
  build: SceneBuild,
): string {
  const { scene, report } = build;
  const nodes: SceneNode[] = [];
  const visit = (list: readonly SceneNode[]): void => {
    for (const node of list) {
      nodes.push(node);
      if (node.type === 'zone') visit(node.children);
    }
  };
  visit(scene.children);
  const zones = nodes.flatMap((node) => (node.type === 'zone' ? [node] : []));
  const cards = nodes.flatMap((node) => (node.type === 'card' ? [node] : []));
  const chips = zones.filter((zone) => zone.collapsed !== undefined);
  const products = [...new Set(cards.map((card) => card.product))].sort();
  const { detail, focus, root } = report;
  const focusLine =
    focus === undefined
      ? 'none'
      : focus.status === 'applied'
        ? `${focus.kind}${focus.anchor === undefined ? '' : ` ${focus.anchor}`} (${plural(focus.projects.length, 'project')})`
        : `${focus.kind}: error ${focus.error.code}: ${focus.error.message}`;
  const rootLine =
    root.used === undefined
      ? `${scene.metadata.rootLabel} (the whole scope)`
      : `${scene.metadata.rootLabel} (${root.used})`;
  const lines = [
    BANNER,
    `fixture    demo ${fixture}: ${String(snapshot.assets.length)} assets read at ${snapshot.readTime}; catalog ${catalogVersion}`,
    `view       lens ${scene.metadata.lens} · detail ${detail.requested}${detail.requested === 'auto' ? ` → ${detail.used} (budget ${String(detail.budget)}${detail.ceiling === 'all' ? '' : `, lens ceiling ${detail.ceiling}`})` : ''}`,
    `rects      ${String(scene.metadata.rectCount)} drawn; per level: folders ${String(detail.rectCounts.folders)}, projects ${String(detail.rectCounts.projects)}, networks ${String(detail.rectCounts.networks)}, all ${String(detail.rectCounts.all)}`,
    `root       ${rootLine}`,
    `focus      ${focusLine}`,
    `zones      ${String(zones.length)}: ${counted(
      ZoneKindSchema.options,
      zones.map((zone) => zone.kind),
    )}`,
    `chips      ${String(chips.length)}: ${counted(
      ZoneKindSchema.options,
      chips.map((zone) => zone.kind),
    )}`,
    `cards      ${String(cards.length)} from ${String(products.length)} products`,
    `edges      ${String(scene.edges.length)} standing for ${String(report.counts.relations)} relations: ${counted(
      RelationKindSchema.options,
      scene.edges.map((edge) => edge.kind),
    )}`,
    `external   ${String(report.counts.stubs)} stubs · overlays ${String(report.overlays.length)} · held back ${String(report.counts.held)} hidden`,
    `dangling   ${String(report.counts.dangling)} references of visible nodes (not drawn)`,
    `warnings   ${report.warnings.length === 0 ? 'none' : report.warnings.join(' | ')}`,
  ];
  return `${lines.join('\n')}\n`;
}

export interface Io {
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
}

/** Runs the command; returns the exit code (0 ok, 2 usage error). */
export async function run(argv: readonly string[], io: Io, sceneCatalog: Catalog = catalog): Promise<number> {
  let command: Command | 'help';
  try {
    command = parseCommand(argv);
  } catch (error) {
    if (!(error instanceof UsageError) && !(error instanceof TypeError)) throw error;
    io.err(`render-scene: ${error.message}\n\n${USAGE}\n`);
    return 2;
  }
  if (command === 'help') {
    io.out(`${USAGE}\n`);
    return 0;
  }
  const snapshot = await loadFixture(command.fixture);
  const { graph } = buildGraphWithReport(snapshot, sceneCatalog);
  const build = buildSceneWithReport(graph, command.spec, sceneCatalog, {
    readTime: snapshot.readTime,
    ...(snapshot.scope.displayName === undefined ? {} : { rootLabel: snapshot.scope.displayName }),
    ...(command.budget === undefined ? {} : { viewportBudget: command.budget }),
  });
  if (command.json) {
    io.err(`${BANNER}\n`);
    io.out(`${JSON.stringify(build, null, 2)}\n`);
  } else {
    io.out(summarize(command.fixture, snapshot, sceneCatalog.version, build));
  }
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const code = await run(process.argv.slice(2), {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  });
  process.exitCode = code;
}
