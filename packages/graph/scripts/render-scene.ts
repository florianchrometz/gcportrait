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
  FILTER_FLAG_KEYS,
  FocusKindSchema,
  LensIdSchema,
  RENDER_MAX_SIDE,
  RelationKindSchema,
  VIEW_SPEC_MAX_DEPTH,
  ViewSpecSchema,
  ZoneKindSchema,
  readRenderFlags,
  type Catalog,
  type SceneBuild,
  type SceneNode,
  type Snapshot,
  type ViewSpec,
} from '@gcportrait/model';
import { buildGraphWithReport, buildSceneWithReport, viewSpecOf, viewportBudget } from '../src/index.js';

export const FIXTURES_DIR = path.resolve(import.meta.dirname, '../../demo-data/fixtures');
const FIXTURES = ['S', 'M', 'L'] as const;
type Fixture = (typeof FIXTURES)[number];

/**
 * The banner: the command's name, first in the summary and alone on standard error with `--json`. It carries
 * no affiliation line (it belongs in footers and long-form texts only: AGENTS.md, Non-affiliation, brand and
 * legal).
 */
export const BANNER = 'gcportrait render-scene';

export const USAGE = `Usage:
  pnpm render-scene --fixture S|M|L [--lens LENS] [--focus kind=KIND[,NAME=VALUE...]] [--root NODE_ID]
                    [--detail auto|folders|projects|networks|all] [--filter KEY=VALUE ...] [--flip ZONE_ID ...]
                    [--budget N | --viewport WIDTHxHEIGHT] [--selection NODE_ID] [--highlight TEXT] [--json]

Builds the scene of a view of a demo organisation and prints a summary: zones by kind, cards, edges by kind,
chips, dangling references and warnings. --json prints the scene and its report instead. The view flags and
--viewport are pnpm render's, checked as POST /api/render checks its fields.

  --lens       ${LensIdSchema.options.join(', ')} (default overview)
  --detail     ${DetailLevelSchema.options.join(', ')} (default auto)
  --focus      kind=${FocusKindSchema.options.join('|')}, then its parameters:
               project=…, host=…, perimeter=…, application=… (e.g. kind=project,project=demo-web-1); a
               parameter's name starts with a letter
  --filter     ${FILTER_FLAG_KEYS.boolean.join(', ')} (true or false;
               the key alone is true); ${FILTER_FLAG_KEYS.list.join(', ')} (comma-separated);
               ${FILTER_FLAG_KEYS.number.join(', ')} (1–${String(VIEW_SPEC_MAX_DEPTH)})
  --flip       a zone id to flip (expand a chip, collapse an open zone); repeatable
  --budget     the rect budget of detail level auto (default: the 1280×800 viewport's, 73)
  --viewport   the canvas whose budget auto fits instead, up to ${String(RENDER_MAX_SIDE)} px a side`;

export class UsageError extends Error {}

export interface Command {
  readonly fixture: Fixture;
  readonly spec: ViewSpec;
  readonly budget: number | undefined;
  readonly json: boolean;
}

function parseBudget(budget: string): number {
  const value = Number(budget);
  if (!Number.isInteger(value) || value < 1)
    throw new UsageError(`--budget takes a positive integer, not "${budget}"`);
  return value;
}

export function parseCommand(argv: readonly string[]): Command | 'help' {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      fixture: { type: 'string', default: 'M' },
      lens: { type: 'string' },
      focus: { type: 'string' },
      root: { type: 'string' },
      detail: { type: 'string' },
      filter: { type: 'string', multiple: true },
      flip: { type: 'string', multiple: true },
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
  // The view and the viewport as `pnpm render` and the render API read them.
  const read = readRenderFlags({
    lens: values.lens,
    detail: values.detail,
    focus: values.focus,
    root: values.root,
    filter: values.filter,
    flip: values.flip,
    viewport: values.viewport,
  });
  if (!read.success) throw new UsageError(read.error);
  const { view, viewport } = read.options;
  const checkedSpec = ViewSpecSchema.safeParse({
    ...viewSpecOf(view, `demo:${fixture}`),
    ...(values.selection === undefined ? {} : { selection: values.selection }),
    ...(values.highlight === undefined ? {} : { highlight: values.highlight }),
  });
  if (!checkedSpec.success)
    throw new UsageError(
      checkedSpec.error.issues.map((issue) => `--${issue.path.join(' ')}: ${issue.message}`).join('; '),
    );
  let budget: number | undefined;
  if (values.budget !== undefined) budget = parseBudget(values.budget);
  else if (values.viewport !== undefined) budget = viewportBudget(viewport.width, viewport.height);
  return { fixture, spec: checkedSpec.data, budget, json: values.json };
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
