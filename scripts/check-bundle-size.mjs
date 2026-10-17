// SPDX-License-Identifier: MIT
// @ts-check
/**
 * Bundle-size budgets for the SPA (frontend/AGENTS.md, Bundle budgets). The build in frontend/dist is
 * split by thread and each part has its own budget, both gzipped:
 *
 *   UI thread  350 kB  the entry script, every chunk it imports statically, and the CSS index.html links, plus a
 *                      lazily imported chunk only when it is part of the first paint of /diagram
 *                      (`DIAGRAM_FIRST_PAINT` below; none is today);
 *   workers    400 kB  every worker script the UI thread starts and every chunk a worker loads, statically or on
 *                      demand, in total.
 *
 * Fonts and the fetched JSON data tables are excluded by design; other assets (images, source maps) are not
 * counted either. Lazily imported UI chunks outside the first paint of /diagram are listed but count against
 * neither budget. A JavaScript or CSS file that none of these reaches is counted against the UI budget, so a
 * file the classification misses can only make the check stricter.
 *
 * How files are classified: index.html names the entry script(s) and stylesheet(s); each JavaScript file's own
 * references name the rest: static imports (`import … from "./x.js"`, `import "./x.js"`), dynamic imports
 * (`import("./x.js")`), worker scripts (`new Worker("/assets/x.js", …)`), and the dependency lists Vite writes
 * for preloading (`"assets/x.css"`). Plain ESM over the build's own output, no source maps or manifest needed
 * (the build publishes neither).
 *
 * Usage:
 *   node scripts/check-bundle-size.mjs                    measure frontend/dist (run `pnpm build` first)
 *   node scripts/check-bundle-size.mjs --dist <dir>       measure another build output directory (the static
 *                                                         demo: --dist dist/demo, files named below /demo/)
 *   node scripts/check-bundle-size.mjs --summary <file>   also append the result as Markdown to <file>
 *                                                         (CI passes $GITHUB_STEP_SUMMARY)
 *   node scripts/check-bundle-size.mjs --first-paint <chunk>  count another lazy chunk (by name) as part of
 *                                                         the first paint of /diagram (repeatable; for
 *                                                         trying a split before DIAGRAM_FIRST_PAINT names it)
 *
 * Each file is gzipped on its own at zlib's default level, the level most web servers use, and the gzipped
 * sizes are summed per part. 1 kB is 1000 bytes.
 *
 * No zod on the UI thread (zod runs in the workers only; AGENTS.md, Architecture and code): every JavaScript
 * file the UI thread loads (the initial chunks, the lazy ones and anything unclassified) is searched for
 * zod's signatures (`ZOD_SIGNATURES` below: names a minifier keeps, such as zod 4's `._zod` property and its
 * `"$ZodType"` constructor names), and a match fails the check whatever the sizes; the workers may bundle
 * zod.
 *
 * Exit code 0 when both parts are within their budgets and the UI thread has no zod, and also when there is no
 * build output yet (with a notice saying so); 1 when either part is above its budget or a UI-thread file contains
 * zod; 2 on a usage error. Node built-ins only.
 */
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { gzipSync } from 'node:zlib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_DIST = path.join(ROOT, 'frontend', 'dist');

/** The UI thread's budget: 350 kB gzipped. */
const UI_BUDGET_BYTES = 350_000;

/** The workers' budget: 400 kB gzipped, all worker scripts and their chunks together. */
const WORKER_BUDGET_BYTES = 400_000;

/**
 * Lazily imported chunks that are part of the first paint of /diagram, by chunk name (the file name without its
 * content hash: `DiagramPage` for `DiagramPage-1a2b3c.js`). They count against the UI budget with the chunks they
 * import statically. Empty while the diagram page and everything on it load with the entry.
 */
const DIAGRAM_FIRST_PAINT = /** @type {readonly string[]} */ ([]);

/**
 * What gives zod away in a minified chunk: names a minifier keeps (property names and string literals), by zod
 * version. Each is specific enough on its own (none is a word an app would write), so one match is enough.
 */
const ZOD_SIGNATURES = /** @type {ReadonlyArray<{ name: string, pattern: RegExp }>} */ ([
  // zod 4: every schema keeps its internals on `_zod` (`inst._zod.def`, `schema._zod.run`).
  { name: '._zod', pattern: /\._zod\b/ },
  // zod 4 core: `$constructor("$ZodType", …)`, `"$ZodObject"`, `"$ZodError"`.
  { name: '"$Zod…"', pattern: /["'`]\$Zod[A-Z]\w*["'`]/ },
  // zod 3 and 4: the error class's name, set as a string (`name = "ZodError"`).
  { name: '"ZodError"', pattern: /["'`]ZodError["'`]/ },
  // zod 3: the first-party type names (`typeName: "ZodString"`, `ZodFirstPartyTypeKind`).
  { name: '"ZodObject"', pattern: /["'`]Zod(?:Object|String|Number|Array|Union|Effects|Optional)["'`]/ },
]);

/** Extensions of the files that count against a budget. */
const COUNTED_EXTENSIONS = new Set(['.js', '.mjs', '.css']);

/** Font files, excluded from the budgets by design. */
const FONT_EXTENSIONS = new Set(['.woff', '.woff2', '.ttf', '.otf', '.eot']);

/** How many of the uncounted files are named in the output before the rest is summarised as "N more". */
const LISTED_OTHER_FILES = 10;

/**
 * @typedef {{ relPath: string, raw: number, gzip: number }} MeasuredFile
 * @typedef {'ui' | 'first-paint' | 'lazy' | 'worker' | 'unreached'} Part
 * @typedef {{ static: Set<string>, dynamic: Set<string>, workers: Set<string>, other: Set<string> }} References
 * @typedef {{
 *   files: Map<string, MeasuredFile & { part: Part }>,
 *   fonts: string[],
 *   other: string[],
 *   hasAssets: boolean,
 *   hasIndex: boolean,
 *   zod: Map<string, string[]>,
 * }} Measurement
 */

/**
 * Every regular file under `dir` (recursively, symbolic links not followed), as a POSIX path relative to
 * `base`, in sorted order.
 * @param {string} base
 * @param {string} dir
 * @returns {string[]}
 */
function listFiles(base, dir) {
  /** @type {string[]} */
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(base, absPath));
    else if (entry.isFile()) files.push(path.relative(base, absPath).split(path.sep).join('/'));
  }
  return files.sort();
}

/**
 * The build file a reference names, as a path relative to the dist directory, or null when it names none:
 * `./x.js` and `../x.js` relative to the referring file, `/assets/x.js` from the site root, `assets/x.js` from
 * the base (Vite's preload lists). A build for a base path (the static demo's `/demo/`) names its files
 * below it (`/demo/assets/x.js`): an absolute reference also counts for the build file it names below its first
 * segments.
 * @param {string} specifier
 * @param {string} from the referring file, relative to dist ('' for index.html)
 * @param {ReadonlySet<string>} known
 * @returns {string | null}
 */
function resolveReference(specifier, from, known) {
  const clean = specifier.split(/[?#]/)[0] ?? '';
  if (clean.startsWith('.')) {
    const candidate = path.posix.join(path.posix.dirname(from), clean);
    return known.has(candidate) ? candidate : null;
  }
  const segments = clean.replace(/^\/+/, '').split('/');
  const below = clean.startsWith('/')
    ? segments.map((_, at) => segments.slice(at).join('/'))
    : [segments.join('/')];
  return below.find((candidate) => candidate !== '' && known.has(candidate)) ?? null;
}

const QUOTED = String.raw`(["'\x60])([^"'\x60\s]+?)\1`;
const STATIC_IMPORT = new RegExp(String.raw`(?:\bfrom|\bimport)\s*${QUOTED}`, 'g');
const DYNAMIC_IMPORT = new RegExp(String.raw`\bimport\(\s*${QUOTED}\s*\)`, 'g');
const WORKER = new RegExp(String.raw`\bnew\s+(?:Shared)?Worker\(\s*(?:new\s+URL\(\s*)?${QUOTED}`, 'g');
const ANY_STRING = new RegExp(QUOTED, 'g');

/**
 * What a JavaScript file refers to, resolved to build files.
 * @param {string} code
 * @param {string} relPath
 * @param {ReadonlySet<string>} known
 * @returns {References}
 */
function referencesOf(code, relPath, known) {
  /** @type {References} */
  const found = { static: new Set(), dynamic: new Set(), workers: new Set(), other: new Set() };
  /** @type {Array<[RegExp, Set<string>]>} */
  const kinds = [
    [STATIC_IMPORT, found.static],
    [DYNAMIC_IMPORT, found.dynamic],
    [WORKER, found.workers],
    [ANY_STRING, found.other],
  ];
  for (const [pattern, into] of kinds) {
    for (const match of code.matchAll(pattern)) {
      const target = resolveReference(match[2] ?? '', relPath, known);
      if (target !== null && target !== relPath) into.add(target);
    }
  }
  for (const target of [...found.static, ...found.dynamic, ...found.workers]) found.other.delete(target);
  return found;
}

/**
 * The scripts and stylesheets index.html loads.
 * @param {string} html
 * @param {ReadonlySet<string>} known
 * @returns {string[]}
 */
function entriesOf(html, known) {
  /** @type {string[]} */
  const entries = [];
  for (const tag of html.matchAll(/<(script|link)\b[^>]*>/gi)) {
    const text = tag[0];
    const attribute = /\b(?:src|href)\s*=\s*(["'])([^"']+)\1/i.exec(text);
    if (attribute === null) continue;
    if (tag[1]?.toLowerCase() === 'link' && !/\brel\s*=\s*["']?(?:stylesheet|modulepreload)\b/i.test(text))
      continue;
    const target = resolveReference(attribute[2] ?? '', '', known);
    if (target !== null) entries.push(target);
  }
  return entries;
}

/**
 * The chunk name of a build file: its base name without Vite's 8-character content hash and the extension.
 * @param {string} relPath
 * @returns {string}
 */
function chunkName(relPath) {
  const base = path.posix.basename(relPath).replace(/\.[^.]+$/, '');
  return base.replace(/-[A-Za-z0-9_-]{8}$/, '');
}

/**
 * Sorts and measures the files under `<distDir>/assets` and classifies the counted ones by thread.
 * @param {string} distDir
 * @param {ReadonlySet<string>} firstPaint the lazy chunks of the first paint of /diagram, by name
 * @returns {Measurement}
 */
function measure(distDir, firstPaint) {
  const assetsDir = path.join(distDir, 'assets');
  const indexPath = path.join(distDir, 'index.html');
  /** @type {Measurement} */
  const result = {
    files: new Map(),
    fonts: [],
    other: [],
    hasAssets: existsSync(assetsDir),
    hasIndex: existsSync(indexPath),
    zod: new Map(),
  };
  if (!result.hasAssets) return result;
  /** @type {Map<string, Buffer>} */
  const contents = new Map();
  for (const relPath of listFiles(distDir, assetsDir)) {
    const extension = path.posix.extname(relPath).toLowerCase();
    if (FONT_EXTENSIONS.has(extension)) {
      result.fonts.push(relPath);
    } else if (COUNTED_EXTENSIONS.has(extension)) {
      const content = readFileSync(path.join(distDir, relPath));
      contents.set(relPath, content);
      result.files.set(relPath, {
        relPath,
        raw: content.length,
        gzip: gzipSync(content).length,
        part: 'unreached',
      });
    } else {
      result.other.push(relPath);
    }
  }

  const known = new Set(contents.keys());
  /** @type {Map<string, References>} */
  const references = new Map();
  for (const [relPath, content] of contents) {
    if (relPath.endsWith('.css')) continue;
    references.set(relPath, referencesOf(content.toString('utf8'), relPath, known));
  }
  const refs = (/** @type {string} */ relPath) =>
    references.get(relPath) ?? {
      static: new Set(),
      dynamic: new Set(),
      workers: new Set(),
      other: new Set(),
    };

  /**
   * Marks `roots` and what they reach through `follow` with `part`, never re-marking a file already classified.
   * @param {Iterable<string>} roots
   * @param {Part} part
   * @param {(refs: References) => Iterable<string>} follow
   */
  const mark = (roots, part, follow) => {
    const queue = [...roots];
    for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
      const entry = result.files.get(file);
      if (entry === undefined || entry.part !== 'unreached') continue;
      entry.part = part;
      queue.push(...follow(refs(file)));
    }
  };
  const inPart = (/** @type {Part[]} */ ...parts) =>
    [...result.files.values()].filter((file) => parts.includes(file.part)).map((file) => file.relPath);

  // The UI thread: index.html's scripts and stylesheets and their static imports.
  const entries = result.hasIndex ? entriesOf(readFileSync(indexPath, 'utf8'), known) : [];
  mark(entries, 'ui', (found) => found.static);
  // Lazy UI chunks, the ones of the first paint of /diagram first; their CSS comes through preload lists.
  for (let changed = true; changed;) {
    const before = inPart('unreached').length;
    const lazyRoots = inPart('ui', 'first-paint', 'lazy').flatMap((file) => [...refs(file).dynamic]);
    mark(
      lazyRoots.filter((file) => firstPaint.has(chunkName(file))),
      'first-paint',
      (found) => found.static,
    );
    mark(lazyRoots, 'lazy', (found) => found.static);
    changed = inPart('unreached').length !== before;
  }
  // Workers: the scripts the UI thread starts, and everything they load.
  const workerRoots = inPart('ui', 'first-paint', 'lazy').flatMap((file) => [...refs(file).workers]);
  mark(workerRoots, 'worker', (found) => [...found.static, ...found.dynamic, ...found.workers]);
  // A stylesheet the UI thread only names in Vite's preload lists belongs to the lazy chunk it is named after.
  const preloaded = inPart('ui', 'first-paint', 'lazy')
    .flatMap((file) => [...refs(file).other])
    .filter((file) => file.endsWith('.css'));
  mark(
    preloaded.filter((file) => firstPaint.has(chunkName(file))),
    'first-paint',
    () => [],
  );
  mark(preloaded, 'lazy', () => []);
  // zod on the UI thread: any JavaScript file that is not worker code (initial, lazy or unclassified).
  for (const [relPath, entry] of result.files) {
    if (entry.part === 'worker' || relPath.endsWith('.css')) continue;
    const found = zodSignatures(contents.get(relPath)?.toString('utf8') ?? '');
    if (found.length > 0) result.zod.set(relPath, found);
  }
  return result;
}

/**
 * The zod signatures a file's code contains (their names), in `ZOD_SIGNATURES` order.
 * @param {string} code
 * @returns {string[]}
 */
function zodSignatures(code) {
  return ZOD_SIGNATURES.filter(({ pattern }) => pattern.test(code)).map(({ name }) => name);
}

/**
 * The line that says whether the UI thread ships zod, and which files do.
 * @param {Measurement} measurement
 * @returns {string}
 */
function zodLine(measurement) {
  if (measurement.zod.size === 0) return 'No zod on the UI thread.';
  const files = [...measurement.zod.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([file, found]) => `${file} (${found.join(', ')})`);
  return (
    `zod on the UI thread (it belongs in the workers): ${files.join('; ')}. Import the zod-free ` +
    'codec and vocabularies of @gcportrait/model on the UI thread, never a *Schema.'
  );
}

/**
 * @param {number} bytes
 * @returns {string}
 */
function kB(bytes) {
  return `${(bytes / 1000).toFixed(2)} kB`;
}

/**
 * @param {readonly MeasuredFile[]} files
 * @returns {{ raw: number, gzip: number }}
 */
function totals(files) {
  return files.reduce((sum, file) => ({ raw: sum.raw + file.raw, gzip: sum.gzip + file.gzip }), {
    raw: 0,
    gzip: 0,
  });
}

/**
 * @param {number} count
 * @param {string} noun
 * @returns {string}
 */
function plural(count, noun) {
  return `${String(count)} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * @typedef {{ title: string, files: MeasuredFile[], budget: number | null }} Section
 */

/**
 * The measured files by budget, largest first within each.
 * @param {Measurement} measurement
 * @returns {{ ui: Section, lazy: Section, workers: Section }}
 */
function sections(measurement) {
  const files = [...measurement.files.values()].sort(
    (a, b) => b.gzip - a.gzip || (a.relPath < b.relPath ? -1 : 1),
  );
  /** @param {(file: MeasuredFile & { part: Part }) => boolean} test */
  const pick = (test) => files.filter(test).map(({ relPath, raw, gzip }) => ({ relPath, raw, gzip }));
  return {
    ui: {
      title:
        'UI thread, initial: entry, static imports, CSS (and lazy chunks of the first paint of /diagram)',
      files: pick((file) => file.part === 'ui' || file.part === 'first-paint' || file.part === 'unreached'),
      budget: UI_BUDGET_BYTES,
    },
    lazy: {
      title: 'UI thread, lazy: loaded later, not part of the first paint of /diagram (not counted)',
      files: pick((file) => file.part === 'lazy'),
      budget: null,
    },
    workers: {
      title: 'Workers: worker scripts and every chunk they load',
      files: pick((file) => file.part === 'worker'),
      budget: WORKER_BUDGET_BYTES,
    },
  };
}

/**
 * The plain-text table of one section.
 * @param {Section} section
 * @param {ReadonlySet<string>} unreached
 * @returns {string}
 */
function textTable(section, unreached) {
  const total = totals(section.files);
  /** @type {string[][]} */
  const rows = [
    ['File', 'Raw', 'Gzip'],
    ...section.files.map((file) => [
      unreached.has(file.relPath) ? `${file.relPath} (unclassified)` : file.relPath,
      kB(file.raw),
      kB(file.gzip),
    ]),
    [`Total (${plural(section.files.length, 'file')})`, kB(total.raw), kB(total.gzip)],
  ];
  const widths = [0, 1, 2].map((column) => Math.max(...rows.map((row) => (row[column] ?? '').length)));
  const format = (/** @type {string[]} */ row) =>
    `  ${(row[0] ?? '').padEnd(widths[0] ?? 0)}  ${(row[1] ?? '').padStart(widths[1] ?? 0)}  ${(
      row[2] ?? ''
    ).padStart(widths[2] ?? 0)}`;
  const rule = `  ${'-'.repeat((widths[0] ?? 0) + (widths[1] ?? 0) + (widths[2] ?? 0) + 4)}`;
  const lines = rows.map(format);
  lines.splice(1, 0, rule);
  lines.splice(lines.length - 1, 0, rule);
  const budget = section.budget === null ? '' : `, budget ${kB(section.budget)}`;
  return `${section.title}${budget}:\n\n${lines.join('\n')}`;
}

/**
 * The lines that account for the files that do not count against a budget.
 * @param {Measurement} measurement
 * @returns {string[]}
 */
function exclusionNotes(measurement) {
  /** @type {string[]} */
  const notes = [];
  if (measurement.fonts.length > 0) {
    notes.push(`Excluded by design: ${plural(measurement.fonts.length, 'font file')}.`);
  }
  if (measurement.other.length > 0) {
    const shown = measurement.other.slice(0, LISTED_OTHER_FILES);
    const more = measurement.other.length - shown.length;
    notes.push(
      `Not counted (neither JavaScript nor CSS: data tables, images, maps): ` +
        `${plural(measurement.other.length, 'file')}, ` +
        `${shown.join(', ')}${more > 0 ? ` and ${String(more)} more` : ''}.`,
    );
  }
  const unreached = [...measurement.files.values()].filter((file) => file.part === 'unreached');
  if (unreached.length > 0) {
    notes.push(
      `Counted against the UI budget because nothing classifies them as lazy or worker code: ` +
        `${plural(unreached.length, 'file')}${measurement.hasIndex ? '' : ' (there is no index.html)'}.`,
    );
  }
  return notes;
}

/**
 * The Markdown version of the result, for the GitHub Actions job summary.
 * @param {Measurement} measurement
 * @param {string} verdict
 * @returns {string}
 */
function markdownSummary(measurement, verdict) {
  const parts = sections(measurement);
  /** @type {string[]} */
  const lines = ['### Bundle size (gzip; fonts and data tables excluded)', ''];
  for (const section of [parts.ui, parts.workers, parts.lazy]) {
    if (section.budget === null && section.files.length === 0) continue;
    const total = totals(section.files);
    const budget = section.budget === null ? 'not counted' : `budget ${kB(section.budget)}`;
    lines.push(
      `**${section.title}** (${budget})`,
      '',
      '| File | Raw | Gzip |',
      '| --- | ---: | ---: |',
      ...section.files.map((file) => `| \`${file.relPath}\` | ${kB(file.raw)} | ${kB(file.gzip)} |`),
      `| **Total** (${plural(section.files.length, 'file')}) | ${kB(total.raw)} | **${kB(total.gzip)}** |`,
      '',
    );
  }
  lines.push(
    ...exclusionNotes(measurement).map((note) => `${note}\n`),
    `${zodLine(measurement)}\n`,
    verdict,
    '',
  );
  return lines.join('\n');
}

/**
 * @param {string | undefined} summaryPath
 * @param {string} markdown
 */
function appendSummary(summaryPath, markdown) {
  if (summaryPath !== undefined && summaryPath !== '') appendFileSync(summaryPath, `${markdown}\n`);
}

/**
 * @param {readonly string[]} argv
 */
function parseCli(argv) {
  return parseArgs({
    args: [...argv],
    options: {
      dist: { type: 'string' },
      summary: { type: 'string' },
      'first-paint': { type: 'string', multiple: true },
    },
    strict: true,
    allowPositionals: false,
  });
}

/**
 * @param {string} label
 * @param {number} gzip
 * @param {number} budget
 * @returns {string}
 */
function budgetLine(label, gzip, budget) {
  const share = ((gzip / budget) * 100).toFixed(1);
  return gzip <= budget
    ? `${label} ${kB(gzip)} of ${kB(budget)} (${share}%)`
    : `${label} ${kB(gzip)} exceeds ${kB(budget)} by ${kB(gzip - budget)} (${share}%)`;
}

/**
 * @param {readonly string[]} argv
 * @returns {number} exit code
 */
function main(argv) {
  /** @type {ReturnType<typeof parseCli>} */
  let parsed;
  try {
    parsed = parseCli(argv);
  } catch (error) {
    console.error(`size-budget: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  const distDir = path.resolve(parsed.values.dist ?? DEFAULT_DIST);
  const relDist = path.relative(ROOT, distDir);
  const shownDist =
    relDist === '' || relDist.startsWith('..') || path.isAbsolute(relDist) ? distDir : relDist;
  const summaryPath = parsed.values.summary;

  if (!existsSync(distDir)) {
    const notice =
      `size-budget: ${shownDist} does not exist yet, so there is nothing to measure. ` +
      'Run `pnpm build` first. Skipping the check (exit 0).';
    console.log(notice);
    appendSummary(summaryPath, `### Bundle size\n\n${notice}\n`);
    return 0;
  }
  if (!statSync(distDir).isDirectory()) {
    console.error(`size-budget: ${shownDist} is not a directory.`);
    return 2;
  }

  const firstPaint = new Set([...DIAGRAM_FIRST_PAINT, ...(parsed.values['first-paint'] ?? [])]);
  const measurement = measure(distDir, firstPaint);
  const parts = sections(measurement);
  const ui = totals(parts.ui.files).gzip;
  const workers = totals(parts.workers.files).gzip;
  const noZod = measurement.zod.size === 0;
  const within = ui <= UI_BUDGET_BYTES && workers <= WORKER_BUDGET_BYTES && noZod;
  const verdict =
    `size-budget: ${within ? 'OK' : 'FAILED'}. ` +
    `${budgetLine('UI thread', ui, UI_BUDGET_BYTES)}; ${budgetLine('workers', workers, WORKER_BUDGET_BYTES)} ` +
    `(gzipped)${noZod ? '' : `; zod on the UI thread in ${plural(measurement.zod.size, 'file')}`}.`;

  console.log(`Bundle size of ${shownDist}/assets (gzip; fonts and data tables excluded), by thread.\n`);
  if (!measurement.hasAssets) {
    console.log(`  No assets/ directory in ${shownDist}; no JavaScript or CSS to count.\n`);
  }
  const unreached = new Set(
    [...measurement.files.values()].filter((file) => file.part === 'unreached').map((file) => file.relPath),
  );
  console.log(textTable(parts.ui, unreached));
  console.log('');
  console.log(textTable(parts.workers, unreached));
  if (parts.lazy.files.length > 0) {
    console.log('');
    console.log(textTable(parts.lazy, unreached));
  }
  const notes = exclusionNotes(measurement);
  if (notes.length > 0) console.log(`\n${notes.join('\n')}`);
  console.log('');
  if (noZod) console.log(zodLine(measurement));
  else console.error(zodLine(measurement));
  console.log('');
  if (within) console.log(verdict);
  else console.error(verdict);
  appendSummary(summaryPath, markdownSummary(measurement, verdict));
  return within ? 0 : 1;
}

process.exitCode = main(process.argv.slice(2));
