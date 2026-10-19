// SPDX-License-Identifier: Apache-2.0
/**
 * Writes a demo organisation to a file, or regenerates the committed fixtures.
 *
 *   pnpm --filter @gcportrait/demo-data generate --size L --out /tmp/demo-L.ndjson
 *   pnpm --filter @gcportrait/demo-data generate --size M --format snapshot --tick 2026-09-20 --out m.json
 *   pnpm --filter @gcportrait/demo-data fixtures            # rewrites fixtures/S.ndjson, M.ndjson, stats.json
 *
 * A relative `--out` is resolved against the directory pnpm was started from (INIT_CWD), not the package.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import {
  DEFAULT_SEED,
  DEMO_SIZES,
  DEMO_TODAY,
  checklistMarkdown,
  computeStats,
  historyFor,
  realismChecklist,
  snapshotAt,
  toCaiNdjson,
  toSnapshot,
  type DemoHistory,
} from '../src/index.js';
import type { DemoSize } from '@gcportrait/model';

export const FORMATS = ['cai', 'cai-export', 'snapshot', 'history', 'stats', 'checklist'] as const;
export type Format = (typeof FORMATS)[number];

export const FIXTURES_DIR = path.resolve(import.meta.dirname, '../fixtures');

const USAGE = `Usage:
  generate --size S|M|L|XL [--out FILE] [--format ${FORMATS.join('|')}]
           [--seed N] [--today YYYY-MM-DD] [--tick INDEX|YYYY-MM-DD]
  generate --fixtures

Formats:
  cai         NDJSON, one Cloud Asset Inventory record per line, as assets.list returns them (default)
  cai-export  NDJSON as exportAssets writes it to Cloud Storage (snake_case envelope keys)
  snapshot    the @gcportrait/model Snapshot JSON
  history     the 35-day history (base assets and per-tick mutations) as JSON
  stats       asset count and count per type as JSON
  checklist   the realism checklist as Markdown table rows

Without --out the output goes to standard output. --tick defaults to the last tick (today).`;

export interface GenerateCommand {
  readonly kind: 'generate';
  readonly size: DemoSize;
  readonly format: Format;
  readonly seed: number;
  readonly today: string;
  readonly tick: number | string | undefined;
  readonly out: string | undefined;
}

export type Command = GenerateCommand | { readonly kind: 'fixtures' } | { readonly kind: 'help' };

export function parseCommand(argv: readonly string[]): Command {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      size: { type: 'string' },
      out: { type: 'string' },
      format: { type: 'string', default: 'cai' },
      seed: { type: 'string' },
      today: { type: 'string' },
      tick: { type: 'string' },
      fixtures: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  if (values.help) return { kind: 'help' };
  if (values.fixtures) return { kind: 'fixtures' };
  const size = values.size;
  if (size === undefined || !(DEMO_SIZES as readonly string[]).includes(size)) {
    throw new Error(`--size must be one of ${DEMO_SIZES.join(', ')}`);
  }
  const format = values.format;
  if (!(FORMATS as readonly string[]).includes(format))
    throw new Error(`--format must be one of ${FORMATS.join(', ')}`);
  const seed = values.seed === undefined ? DEFAULT_SEED : Number(values.seed);
  if (!Number.isSafeInteger(seed) || seed < 0) throw new Error('--seed must be a non-negative integer');
  const tick =
    values.tick === undefined ? undefined : /^\d+$/.test(values.tick) ? Number(values.tick) : values.tick;
  return {
    kind: 'generate',
    size: size as DemoSize,
    format: format as Format,
    seed,
    today: values.today ?? DEMO_TODAY,
    tick,
    out: values.out,
  };
}

/** Formats a history (or one of its ticks) the way `--format` asks. */
export function render(history: DemoHistory, format: Format, tick: number | string | undefined): string {
  if (format === 'history') return `${JSON.stringify(history)}\n`;
  const org = snapshotAt(history, tick ?? history.ticks.length - 1);
  switch (format) {
    case 'cai':
      return toCaiNdjson(org.assets);
    case 'cai-export':
      return toCaiNdjson(org.assets, 'export');
    case 'snapshot':
      return `${JSON.stringify(toSnapshot(org))}\n`;
    case 'stats':
      return `${JSON.stringify(computeStats(org.assets), null, 2)}\n`;
    case 'checklist':
      return `${checklistMarkdown(realismChecklist(org.assets))}\n`;
  }
}

function historyCounts(history: DemoHistory): { adds: number; removes: number; changes: number } {
  let adds = 0;
  let removes = 0;
  let changes = 0;
  for (const tick of history.ticks) {
    for (const mutation of tick.mutations) {
      if (mutation.kind === 'add') adds += 1;
      else if (mutation.kind === 'remove') removes += 1;
      else changes += 1;
    }
  }
  return { adds, removes, changes };
}

/** The committed fixture files by name: S and M as CAI NDJSON, and the golden statistics of all sizes. */
export function renderFixtures(): Map<string, string> {
  const files = new Map<string, string>();
  const sizes: Record<string, unknown> = {};
  for (const size of DEMO_SIZES) {
    const history = historyFor(size, DEFAULT_SEED, DEMO_TODAY);
    const org = snapshotAt(history, history.ticks.length - 1);
    if (size === 'S' || size === 'M') files.set(`${size}.ndjson`, toCaiNdjson(org.assets));
    sizes[size] = { ...computeStats(org.assets), history: historyCounts(history) };
  }
  files.set('stats.json', `${JSON.stringify({ seed: DEFAULT_SEED, today: DEMO_TODAY, sizes }, null, 2)}\n`);
  return files;
}

function main(argv: readonly string[]): void {
  const command = parseCommand(argv);
  if (command.kind === 'help') {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  if (command.kind === 'fixtures') {
    mkdirSync(FIXTURES_DIR, { recursive: true });
    for (const [name, text] of renderFixtures()) {
      writeFileSync(path.join(FIXTURES_DIR, name), text);
      process.stdout.write(`wrote ${path.join(FIXTURES_DIR, name)}\n`);
    }
    return;
  }
  const history = historyFor(command.size, command.seed, command.today);
  const text = render(history, command.format, command.tick);
  if (command.out === undefined) {
    process.stdout.write(text);
    return;
  }
  const target = path.resolve(process.env['INIT_CWD'] ?? process.cwd(), command.out);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, text);
  process.stderr.write(`wrote demo:${command.size} (${command.format}) to ${target}\n`);
}

const invoked = process.argv[1];
if (invoked !== undefined && import.meta.url === pathToFileURL(invoked).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}\n`);
    process.exitCode = 1;
  }
}
