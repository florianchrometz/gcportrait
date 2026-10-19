// SPDX-License-Identifier: Apache-2.0
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTempTree, runScript, type TempTree } from './testing/temp-tree.js';

/**
 * Deterministic bytes that gzip cannot shrink (a SHA-256 counter stream), so a test can place a file of a
 * known gzipped size, give or take gzip's few bytes of framing, on either side of a budget.
 */
function incompressible(byteCount: number, seed: string): Buffer {
  const chunks: Buffer[] = [];
  let length = 0;
  for (let counter = 0; length < byteCount; counter += 1) {
    const chunk = createHash('sha256')
      .update(`${seed}:${String(counter)}`)
      .digest();
    chunks.push(chunk);
    length += chunk.length;
  }
  return Buffer.concat(chunks).subarray(0, byteCount);
}

/** A file's text (its imports) followed by `body`. */
function withBody(text: string, body: string | Buffer): Buffer {
  return Buffer.concat([Buffer.from(text), typeof body === 'string' ? Buffer.from(body) : body]);
}

const SMALL_JS = 'export const greeting = "hello";\n'.repeat(200);
const SMALL_CSS = ':root { color-scheme: light dark; }\n'.repeat(100);

/** An index.html as Vite writes it: the entry script and its stylesheet. */
function indexHtml(entry: string, css?: string): string {
  return [
    '<!doctype html><html><head>',
    `<script type="module" crossorigin src="/assets/${entry}"></script>`,
    css === undefined ? '' : `<link rel="stylesheet" crossorigin href="/assets/${css}">`,
    '</head><body><div id="root"></div></body></html>',
  ].join('\n');
}

describe('check-bundle-size', () => {
  let tree: TempTree;
  let dist: string;

  beforeEach(() => {
    tree = createTempTree('bundle-size');
    dist = path.join(tree.root, 'frontend', 'dist');
  });

  afterEach(() => {
    tree.remove();
  });

  const check = (...extra: string[]) => runScript('check-bundle-size.mjs', ['--dist', dist, ...extra]);
  const write = (relPath: string, content: string | Buffer) => {
    tree.write(`frontend/dist/${relPath}`, content);
  };

  /** A build with every kind of chunk: entry, shared, lazy (with its CSS), worker, worker chunks. */
  function writeBuild(sizes: { entry?: Buffer; worker?: Buffer } = {}): void {
    write('index.html', indexHtml('index-AAAAAAAA.js', 'index-AAAAAAAA.css'));
    write(
      'assets/index-AAAAAAAA.js',
      withBody(
        [
          'import{a}from"./shared-BBBBBBBB.js";',
          'const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/Settings-CCCCCCCC.js","assets/Settings-CCCCCCCC.css"])))=>i.map(i=>d[i]);',
          'const page=()=>import(`./Settings-CCCCCCCC.js`);',
          'new Worker(`/assets/diagram.worker-DDDDDDDD.js`,{type:`module`});',
          '',
        ].join('\n'),
        sizes.entry ?? SMALL_JS,
      ),
    );
    write('assets/index-AAAAAAAA.css', SMALL_CSS);
    write('assets/shared-BBBBBBBB.js', SMALL_JS);
    write('assets/Settings-CCCCCCCC.js', `import"./shared-BBBBBBBB.js";\n${SMALL_JS}`);
    write('assets/Settings-CCCCCCCC.css', SMALL_CSS);
    write(
      'assets/diagram.worker-DDDDDDDD.js',
      'const role=self.name==="a"?import("./dataRole-EEEEEEEE.js"):import(\'./layoutRole-FFFFFFFF.js\');',
    );
    write(
      'assets/dataRole-EEEEEEEE.js',
      withBody('import{z}from"./codec-GGGGGGGG.js";\n', sizes.worker ?? SMALL_JS),
    );
    write('assets/layoutRole-FFFFFFFF.js', SMALL_JS);
    write('assets/codec-GGGGGGGG.js', SMALL_JS);
  }

  /** The lines of the section whose title starts with `title`, up to the next blank line after its table. */
  function section(stdout: string, title: string): string {
    const start = stdout.indexOf(title);
    if (start < 0) return '';
    const end = stdout.indexOf('\n\n', stdout.indexOf('Total (', start));
    return stdout.slice(start, end < 0 ? undefined : end);
  }

  it('exits 0 with a clear notice when the build output does not exist yet', () => {
    const result = check();
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('does not exist yet, so there is nothing to measure');
    expect(result.stdout).toContain('pnpm build');
  });

  it('classifies every chunk by thread: entry and static imports, lazy chunks, workers and their chunks', () => {
    writeBuild();
    const result = check();
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    const ui = section(result.stdout, 'UI thread, initial');
    expect(ui).toContain('budget 350.00 kB');
    expect(ui).toMatch(/File\s+Raw\s+Gzip/);
    expect(ui).toContain('assets/index-AAAAAAAA.js');
    expect(ui).toContain('assets/index-AAAAAAAA.css');
    expect(ui).toContain('assets/shared-BBBBBBBB.js');
    expect(ui).toContain('Total (3 files)');
    const lazy = section(result.stdout, 'UI thread, lazy');
    expect(lazy).toContain('(not counted)');
    expect(lazy).toContain('assets/Settings-CCCCCCCC.js');
    // Its stylesheet is named only in Vite's preload list, after the chunk.
    expect(lazy).toContain('assets/Settings-CCCCCCCC.css');
    const workers = section(result.stdout, 'Workers');
    expect(workers).toContain('budget 400.00 kB');
    for (const file of [
      'diagram.worker-DDDDDDDD',
      'dataRole-EEEEEEEE',
      'layoutRole-FFFFFFFF',
      'codec-GGGGGGGG',
    ])
      expect(workers).toContain(`assets/${file}.js`);
    expect(workers).toContain('Total (4 files)');
    expect(result.stdout).not.toContain('unclassified');
    expect(result.stdout).toMatch(
      /size-budget: OK\. UI thread \d+\.\d\d kB of 350\.00 kB \(\d+\.\d%\); workers \d+\.\d\d kB of 400\.00 kB/,
    );
  });

  it('classifies a build for a base path (the static demo below /demo/) the same way', () => {
    writeBuild();
    const html = indexHtml('index-AAAAAAAA.js', 'index-AAAAAAAA.css').replaceAll('/assets/', '/demo/assets/');
    write('index.html', html);
    const entry = path.join(dist, 'assets', 'index-AAAAAAAA.js');
    write(
      'assets/index-AAAAAAAA.js',
      readFileSync(entry, 'utf8').replace('`/assets/diagram.worker', '`/demo/assets/diagram.worker'),
    );
    const result = check();
    expect(result.status).toBe(0);
    expect(section(result.stdout, 'UI thread, initial')).toContain('Total (3 files)');
    expect(section(result.stdout, 'Workers')).toContain('Total (4 files)');
    expect(result.stdout).not.toContain('unclassified');
  });

  it('counts a lazy chunk of the first paint of /diagram, its stylesheet and its own imports, against the UI', () => {
    writeBuild();
    write(
      'assets/Settings-CCCCCCCC.js',
      `import"./shared-BBBBBBBB.js";import"./own-IIIIIIII.js";\n${SMALL_JS}`,
    );
    write('assets/own-IIIIIIII.js', SMALL_JS);
    const result = check('--first-paint', 'Settings');
    expect(result.status).toBe(0);
    const ui = section(result.stdout, 'UI thread, initial');
    for (const file of ['Settings-CCCCCCCC.js', 'Settings-CCCCCCCC.css', 'own-IIIIIIII.js'])
      expect(ui).toContain(`assets/${file}`);
    expect(ui).toContain('Total (6 files)');
    expect(result.stdout).not.toContain('UI thread, lazy');
  });

  it('fails when the UI thread exceeds 350 kB, whatever the workers take', () => {
    writeBuild({ entry: incompressible(360_000, 'ui') });
    const result = check();
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/size-budget: FAILED\. UI thread 36\d\.\d\d kB exceeds 350\.00 kB by/);
    expect(result.stderr).toMatch(/workers \d+\.\d\d kB of 400\.00 kB/);
  });

  it('fails when the workers together exceed 400 kB', () => {
    writeBuild({ worker: incompressible(410_000, 'worker') });
    const result = check();
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/UI thread \d+\.\d\d kB of 350\.00 kB/);
    expect(result.stderr).toMatch(/workers 41\d\.\d\d kB exceeds 400\.00 kB by/);
  });

  it('passes a build whose threads are each within budget although together they are not', () => {
    writeBuild({ entry: incompressible(300_000, 'ui'), worker: incompressible(300_000, 'worker') });
    const result = check();
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('size-budget: OK.');
  });

  it('counts what nothing classifies against the UI budget, and says so', () => {
    write('assets/vendor-1.js', incompressible(180_000, 'vendor'));
    write('assets/app-2.css', incompressible(180_000, 'app'));
    const result = check();
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('assets/vendor-1.js (unclassified)');
    expect(result.stdout).toContain('assets/app-2.css (unclassified)');
    expect(result.stdout).toContain(
      'Counted against the UI budget because nothing classifies them as lazy or worker code: 2 files (there is no index.html).',
    );
    expect(result.stderr).toMatch(/size-budget: FAILED\. UI thread 360\.\d\d kB exceeds 350\.00 kB/);
  });

  it('excludes font files and does not count data tables and other assets, but lists them', () => {
    write('index.html', indexHtml('app.js'));
    write('assets/app.js', SMALL_JS);
    write('assets/roboto-latin.woff2', incompressible(400_000, 'font-1'));
    write('assets/roboto-latin.woff', incompressible(400_000, 'font-2'));
    write('assets/catalog-data-HHHHHHHH.json', incompressible(400_000, 'table'));
    write('assets/hero.png', incompressible(400_000, 'image'));
    write('assets/app.js.map', incompressible(400_000, 'map'));
    const result = check();
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(section(result.stdout, 'UI thread, initial')).toContain('Total (1 file)');
    expect(result.stdout).toContain('Excluded by design: 2 font files.');
    expect(result.stdout).toContain(
      'Not counted (neither JavaScript nor CSS: data tables, images, maps): 3 files, assets/app.js.map, ' +
        'assets/catalog-data-HHHHHHHH.json, assets/hero.png.',
    );
  });

  it('names at most ten uncounted files', () => {
    for (let index = 0; index < 12; index += 1) {
      write(`assets/icon-${String(index).padStart(2, '0')}.svg`, '<svg/>\n');
    }
    const result = check();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('12 files, assets/icon-00.svg, ');
    expect(result.stdout).toContain('assets/icon-09.svg and 2 more.');
    expect(result.stdout).not.toContain('icon-10.svg');
  });

  it('passes with a notice when the build output has no assets directory', () => {
    write('index.html', '<!doctype html>\n');
    const result = check();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('No assets/ directory');
    expect(result.stdout).toContain('Total (0 files)');
  });

  it('appends a Markdown table per thread to the --summary file', () => {
    tree.write('summary.md', '# Earlier step\n');
    writeBuild();
    const result = check('--summary', path.join(tree.root, 'summary.md'));
    expect(result.status).toBe(0);
    const summary = tree.read('summary.md');
    expect(summary.startsWith('# Earlier step\n')).toBe(true);
    expect(summary).toContain('### Bundle size (gzip; fonts and data tables excluded)');
    expect(summary).toContain('(budget 350.00 kB)');
    expect(summary).toContain('(budget 400.00 kB)');
    expect(summary).toContain('(not counted)');
    expect(summary).toContain('| `assets/shared-BBBBBBBB.js` | 6.60 kB |');
    expect(summary).toContain('size-budget: OK.');
  });

  it('writes the missing-build notice to the --summary file too', () => {
    tree.write('summary.md', '');
    const result = check('--summary', path.join(tree.root, 'summary.md'));
    expect(result.status).toBe(0);
    expect(tree.read('summary.md')).toContain('does not exist yet');
  });

  // A minified zod 4 chunk as Vite writes it, cut down to the parts the guard looks for.
  const ZOD_CHUNK = [
    'const E=(n,f)=>{const c=function(i){i._zod??={};f(i);};Object.defineProperty(c,"name",{value:n});return c};',
    'const j=E(`$ZodType`,(e,t)=>{e._zod.def=t;});',
    'const Ye=E(`ZodError`,(e,t)=>{e.name=`ZodError`;});',
    'export{j,Ye};',
    '',
  ].join('\n');

  it('says the UI thread ships no zod when only a worker chunk bundles it', () => {
    writeBuild();
    write('assets/codec-GGGGGGGG.js', ZOD_CHUNK);
    const result = check();
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('No zod on the UI thread.');
  });

  it('fails when an initial UI chunk contains zod, whatever the sizes, and names the file and signatures', () => {
    writeBuild();
    write('assets/shared-BBBBBBBB.js', `${SMALL_JS}${ZOD_CHUNK}`);
    const result = check();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'zod on the UI thread (it belongs in the workers): assets/shared-BBBBBBBB.js (._zod, "$Zod…", "ZodError").',
    );
    expect(result.stderr).toMatch(
      /size-budget: FAILED\. UI thread \d+\.\d\d kB of 350\.00 kB \(\d+\.\d%\); workers \d+\.\d\d kB of 400\.00 kB \(\d+\.\d%\) \(gzipped\); zod on the UI thread in 1 file\./,
    );
  });

  it('fails when a lazy UI chunk or an unclassified file contains zod', () => {
    writeBuild();
    write('assets/Settings-CCCCCCCC.js', `import"./shared-BBBBBBBB.js";\n${ZOD_CHUNK}`);
    write('assets/stray-JJJJJJJJ.js', 'export const s={typeName:"ZodString"};\n');
    const result = check();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'assets/Settings-CCCCCCCC.js (._zod, "$Zod…", "ZodError"); assets/stray-JJJJJJJJ.js ("ZodObject")',
    );
    expect(result.stderr).toContain('zod on the UI thread in 2 files.');
  });

  it('does not take the word zod in an app string for zod itself', () => {
    writeBuild();
    write('assets/shared-BBBBBBBB.js', `${SMALL_JS}export const t="zod schemas live in the workers";\n`);
    const result = check();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('No zod on the UI thread');
  });

  it('puts the zod line into the --summary file', () => {
    tree.write('summary.md', '');
    writeBuild();
    const result = check('--summary', path.join(tree.root, 'summary.md'));
    expect(result.status).toBe(0);
    expect(tree.read('summary.md')).toContain('No zod on the UI thread.');
  });

  it('rejects unknown options and a --dist that is not a directory', () => {
    const unknown = check('--budget', '1');
    expect(unknown.status).toBe(2);
    expect(unknown.stderr).toContain('size-budget:');

    tree.write('frontend/dist', 'not a directory\n');
    const notADirectory = check();
    expect(notADirectory.status).toBe(2);
    expect(notADirectory.stderr).toContain('is not a directory');
  });
});
