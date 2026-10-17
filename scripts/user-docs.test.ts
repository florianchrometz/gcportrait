// SPDX-License-Identifier: MIT
/**
 * scripts/user-docs.mjs: the user guides' generated lens blocks and the staleness checks that keep
 * docs/configuration.md and every command in the guides true to the tree, the rasteriser's version named once
 * and as installed, and the width of every Markdown file.
 * The last test is the check itself, on the repository: it fails when a guide is stale or a Markdown line too
 * wide (run `node scripts/user-docs.mjs` for the list, `--write` for the generated blocks).
 */
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  backendEnvironment,
  checkUserDocs,
  codeIn,
  commandProblem,
  commandsIn,
  dependencyVersions,
  generateLensDoc,
  helpFlags,
  largeSnapshotAssets,
  largeSnapshotProblems,
  lensTableLines,
  lensTypesLines,
  markdownWidthProblems,
  overlongLines,
  quickStartVariables,
  RASTERISER,
  RASTERISER_DOC,
  rasteriserVersionProblems,
  readVariableRegistry,
  replaceBlock,
  resvgVersionsIn,
  sectionTableRows,
  typesByService,
  unregisteredTokens,
  verificationLogLines,
  WIDTH,
  wrapWords,
} from './user-docs.mjs';
import { SCRIPTS_DIR, createTempTree, type TempTree } from './testing/temp-tree.js';

const REPO = path.resolve(SCRIPTS_DIR, '..');

const LENSES = {
  networking: {
    title: 'Networking',
    description: 'VPC networks and\n  how they are joined.',
    types: [
      'cloudresourcemanager.googleapis.com/Project',
      'compute.googleapis.com/Network',
      'compute.googleapis.com/Subnetwork',
      'dns.googleapis.com/*',
    ],
    relationKinds: ['contains', 'attaches', 'peers'],
    showHidden: false,
    defaultDetail: 'networks',
  },
  everything: {
    title: 'Everything',
    description: 'Every asset type.',
    types: ['*'],
    relationKinds: ['contains'],
    showHidden: true,
    defaultDetail: 'auto',
  },
};

describe('the generated lens blocks', () => {
  it('wraps words at the width, the first line after its prefix and the rest indented', () => {
    expect(wrapWords(['alpha,', 'beta,', 'gamma'], '- x: ', '  ', 16)).toEqual([
      '- x: alpha,',
      '  beta, gamma',
    ]);
    expect(wrapWords(['a-very-long-word'], '- ', '  ', 5)).toEqual(['- a-very-long-word']);
  });

  it('groups types by service in the order listed, a glob as *, the lens-wide * as its own service', () => {
    expect(typesByService(['a.example/X', 'b.example/*', 'a.example/Y', 'a.example/X', '*'])).toEqual([
      ['a.example', ['X', 'Y']],
      ['b.example', ['*']],
      ['*', ['*']],
    ]);
  });

  it('writes one table row per lens: intent on one line, arrows without contains, the ceiling, hidden types', () => {
    expect(lensTableLines(LENSES)).toEqual([
      '| Lens | What it is for | Arrows it draws | `auto` opens at most at | Hidden types |',
      '|---|---|---|---|---|',
      '| **Networking** (`networking`) | VPC networks and how they are joined. | `attaches`, `peers` | `networks` | held back (`N hidden`) |',
      '| **Everything** (`everything`) | Every asset type. | none | no limit | shown |',
    ]);
  });

  it('lists each lens type bundle by service', () => {
    expect(lensTypesLines(LENSES)).toEqual([
      '**Networking** (`networking`): 4 entries',
      '',
      '- `cloudresourcemanager.googleapis.com`: Project',
      '- `compute.googleapis.com`: Network, Subnetwork',
      '- `dns.googleapis.com`: every type (`*`)',
      '',
      '**Everything** (`everything`): 1 entry',
      '',
      '- every asset type (`*`), hidden types included, known to the catalog or not',
    ]);
  });

  it('replaces only what lies between a block’s markers, and refuses missing markers', () => {
    const text = 'a\n<!-- user-docs:x:start (generated) -->\nold\n<!-- user-docs:x:end -->\nb\n';
    expect(replaceBlock(text, 'x', ['new', 'lines'])).toBe(
      'a\n<!-- user-docs:x:start (generated) -->\nnew\nlines\n<!-- user-docs:x:end -->\nb\n',
    );
    expect(replaceBlock(text, 'y', ['new'])).toBeNull();
    const doc = generateLensDoc('no markers', LENSES);
    expect(doc.problems).toHaveLength(2);
  });
});

describe('the configuration checks', () => {
  it('reads the schema’s variables and the literal defaults parseConfig gives them', () => {
    const source = [
      "const DEFAULT_SOURCE_URL = 'https://example.com/src';",
      'const EnvSchema = z.object({',
      '  PORT: optional(z.coerce.number()),',
      '  HOST: optional(z.string()),',
      '  SOURCE_URL: optional(',
      '    z.string(),',
      '  ),',
      '});',
      "port: vars.PORT ?? 8080, host: vars.HOST ?? '0.0.0.0', sourceUrl: vars.SOURCE_URL ?? DEFAULT_SOURCE_URL,",
    ].join('\n');
    const env = backendEnvironment(source);
    expect(env.names).toEqual(['PORT', 'HOST', 'SOURCE_URL']);
    expect([...env.defaults]).toEqual([
      ['PORT', '8080'],
      ['HOST', '0.0.0.0'],
      ['SOURCE_URL', 'https://example.com/src'],
    ]);
  });

  it('reads the flags of a --help and the default each states', () => {
    const help = [
      'Usage: x --project ID',
      '',
      'Where:',
      '  --project ID       The project (required).',
      '  --region REGION    The region (default: europe-west3).',
      '  --service NAME     The name (default: gcportrait; at most 22',
      '                     characters).',
      '  --image TAG        A release (default: latest, the newest).',
      '  -h, --help         This help.',
    ].join('\n');
    expect([...helpFlags(help)]).toEqual([
      ['--project', null],
      ['--region', 'europe-west3'],
      ['--service', 'gcportrait'],
      ['--image', 'latest'],
      ['--help', null],
      ['-h', null],
    ]);
  });

  it('reads the rows of a section’s table, escaped pipes kept inside their cell', () => {
    const text =
      '## A\n\n| Flag | Default |\n|---|---|\n| `--image TAG\\|IMAGE` | `latest` |\n\n## B\n| `x` | y |\n';
    expect(sectionTableRows(text, 'A')).toEqual([
      ['Flag', 'Default'],
      ['`--image TAG\\|IMAGE`', '`latest`'],
    ]);
    expect(sectionTableRows(text, 'C')).toBeNull();
  });
});

describe('the shared fenced-code boundaries', () => {
  it.each(['`', '~'])('keeps shorter, mismatched and suffixed %s fences inside code', (marker) => {
    const opening = marker.repeat(4);
    const other = marker === '`' ? '~~~~' : '````';
    const logged = ['Verified', 'on', '2026-10-11'].join(' ');
    const wide = 'words '.repeat(23).trimEnd();
    const content = [
      'pnpm install',
      marker.repeat(3),
      other,
      `${opening}text`,
      `    ${opening}`,
      'pnpm check',
      logged,
      wide,
      '$ pnpm test',
    ];
    const markdown = [`  ${opening} sh extra`, ...content, ` ${opening}${marker} \t`, logged, wide].join(
      '\n',
    );
    expect(commandsIn(markdown).filter((command) => command.startsWith('pnpm '))).toEqual([
      'pnpm install',
      'pnpm check',
      'pnpm test',
    ]);
    expect(codeIn(markdown)).toEqual(content);
    expect(verificationLogLines(markdown).map((problem) => /^line (\d+)/.exec(problem)?.[1])).toEqual([
      '10',
      '12',
    ]);
    expect(overlongLines(markdown)).toEqual([{ line: 13, columns: wide.length }]);
  });

  it('reads tilde shell and text blocks, but keeps commands inside another language literal', () => {
    const markdown = [
      '~~~bash',
      'infra/deploy.sh --project P \\',
      '  --dry-run',
      '~~~',
      '~~~text',
      '$ pnpm check',
      'pnpm output-only',
      '~~~',
      '````json',
      '```',
      '`pnpm not-a-command`',
      '````',
      'Run `pnpm install`.',
    ].join('\r\n');
    expect(commandsIn(markdown)).toEqual([
      'infra/deploy.sh --project P --dry-run',
      'pnpm check',
      'pnpm install',
    ]);
  });

  it('keeps an unclosed block through the end of the document', () => {
    const markdown = ['~~~~sh', 'pnpm install', '~~~', 'pnpm check'].join('\n');
    expect(commandsIn(markdown)).toEqual(['pnpm install', '~~~', 'pnpm check']);
    expect(codeIn(markdown)).toEqual(['pnpm install', '~~~', 'pnpm check']);
  });

  it('refuses backticks in a backtick opener’s info string', () => {
    const logged = ['Verified', 'on', '2026-10-11'].join(' ');
    const markdown = ['```sh `invalid`', logged, 'Run `pnpm check`.'].join('\n');
    expect(verificationLogLines(markdown)).toHaveLength(1);
    expect(commandsIn(markdown)).toContain('pnpm check');
  });

  it('ignores fence-like values in frontmatter without shifting reported line numbers', () => {
    const wide = 'words '.repeat(23).trimEnd();
    expect(overlongLines(['---', '```', '---', wide].join('\n'))).toEqual([
      { line: 4, columns: wide.length },
    ]);
  });
});

describe('the commands in a guide', () => {
  const markdown = [
    'Run `pnpm dev:demo`, then `LEGAL_DIR=~/x pnpm --filter @gcportrait/backend start`.',
    '',
    '```sh',
    '$ pnpm install && pnpm check   # both',
    'infra/deploy.sh --project P \\',
    '  --region europe-west3 --dry-run',
    '```',
    '',
    '```text',
    '$ pnpm -s render --help',
    'pnpm nothing here: output',
    '$ infra/deploy.sh --project P \\',
    '    --dry-run',
    'output: --not-a-flag',
    '```',
    '',
    '```json',
    '{"pnpm": "not a command"}',
    '```',
  ].join('\n');

  it('finds them in shell blocks, prompt lines of text blocks and inline code', () => {
    expect(commandsIn(markdown)).toEqual([
      'pnpm dev:demo',
      'pnpm --filter @gcportrait/backend start',
      'pnpm install',
      'pnpm check',
      'infra/deploy.sh --project P --region europe-west3 --dry-run',
      'pnpm -s render --help',
      'infra/deploy.sh --project P --dry-run',
    ]);
  });

  it('knows which exist', () => {
    const tree = {
      rootScripts: new Set(['dev:demo', 'check', 'render']),
      packages: new Map([['@gcportrait/backend', new Set(['start', 'test'])]]),
      flags: new Map([['infra/deploy.sh', new Set(['--project', '--region', '--dry-run'])]]),
      exists: (file: string) => file === 'scripts/user-docs.mjs',
    };
    expect(commandsIn(markdown).map((command) => commandProblem(command, tree))).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(commandProblem('pnpm missing-script', tree)).toMatch(/no root script missing-script/);
    expect(commandProblem('pnpm --filter @gcportrait/backend dev', tree)).toMatch(/has no script dev/);
    expect(commandProblem('pnpm --filter @gcportrait/nope test', tree)).toMatch(/no workspace package/);
    expect(commandProblem('pnpm --filter @gcportrait/<pkg> test', tree)).toBeNull();
    expect(commandProblem('infra/deploy.sh --project P --colour', tree)).toMatch(/has no flag --colour/);
    expect(commandProblem('node scripts/user-docs.mjs --write', tree)).toBeNull();
    expect(commandProblem('node scripts/gone.mjs', tree)).toMatch(/does not exist/);
  });

  it('checks the installer line and a downloaded installer against the installer’s flags and deploy.sh’s', () => {
    const tree = {
      rootScripts: new Set<string>(),
      packages: new Map<string, Set<string>>(),
      flags: new Map([['infra/install.sh', new Set(['--version', '--dir', '--project', '--dry-run'])]]),
      exists: () => false,
    };
    const line = 'curl -fsSL https://gcportrait.app/install.sh | bash -s -- --project YOUR_PROJECT --dry-run';
    expect(commandsIn(`\`\`\`sh\n${line}\n\`\`\`\n`)).toEqual([
      'curl -fsSL https://gcportrait.app/install.sh',
      'bash -s -- --project YOUR_PROJECT --dry-run',
    ]);
    expect(commandProblem('bash -s -- --version v1.2.3 --project P --dry-run', tree)).toBeNull();
    expect(commandProblem('bash -s -- --project P --colour', tree)).toBe(
      '`bash -s -- --project P --colour`: infra/install.sh has no flag --colour',
    );
    expect(commandProblem('bash install.sh --project P --dir x', tree)).toBeNull();
    expect(commandProblem('bash ./install.sh --project P --colour', tree)).toMatch(
      /infra\/install\.sh has no flag --colour/,
    );
    expect(commandProblem('infra/install.sh --project P --colour', tree)).toMatch(/has no flag --colour/);
    // Any other script piped to bash is not the installer.
    expect(commandProblem('bash -c true --colour', tree)).toBeNull();
  });
});

describe('verification logs in a guide', () => {
  // The dated phrases a guide may not hold are assembled, so that this file holds none of them either.
  const VERIFIED = ['Verified', 'on'].join(' ');
  const DAY = '2026-10-11';

  it('finds dated verification lines and headings about verifying, outside code', () => {
    const markdown = [
      '# Guide',
      '',
      `What to do. ${VERIFIED} ${DAY} ([section 9](#9-verified-on)).`,
      '',
      '## 9. How this page was verified',
      '',
      '```text',
      `echo ${VERIFIED.toLowerCase()} ${DAY}`,
      '```',
      '',
      'A check that was verified by the tests, said in passing, is no log.',
    ].join('\n');
    expect(verificationLogLines(markdown)).toEqual([
      // The line, cut at 60 characters.
      `line 3 logs a verification ("What to do. ${VERIFIED} ${DAY} ([section 9](#9-verified-"): a guide says what to do, not when or where it was checked`,
      'line 5 logs a verification ("## 9. How this page was verified"): a guide says what to do, not when or where it was checked',
    ]);
    expect(verificationLogLines('# Guide\n\nOpen the address.\n')).toEqual([]);
  });

  it('finds dated notes, machines, measured and timed runs, first versions, and prompts in code', () => {
    const logs = [
      `The website serves phones (maintainer ${['decision', 'of'].join(' ')} ${DAY}).`,
      'On 2026-01-15 the domain still answers with a placeholder page.',
      '(The button was called "Go" until 2026-01-15.)',
      'on the maintainer’s macOS 27 Firefox does not start without it',
      'With Node 22.23.2 and pnpm 10.18.1:',
      'Measured on an Apple M1 (8 cores).',
      'the pull path took 48 s',
      'the scene is 12 s (before: 9.5 s without the close-ups)',
      'Run against the first version’s script, the check fails.',
    ];
    const kept = [
      'The legend reads "added since 2026-09-23" for that day.',
      'The view pins the clock to 2026-10-08 09:30 UTC.',
      'macOS, Linux and Cloud Shell have curl; Node 22 runs it.',
      'A deploy takes about 3 minutes.',
    ];
    const markdown = [
      '# Guide',
      '',
      ...logs,
      ...kept,
      '',
      '```sh',
      'pnpm media',
      '```',
      '',
      '```text',
      '$ pnpm media',
      'media: done.',
      '```',
    ].join('\n');
    const found = verificationLogLines(markdown);
    expect(found.map((problem) => /^line (\d+)/.exec(problem)?.[1])).toEqual([
      ...logs.map((_, index) => String(index + 3)),
      String(3 + logs.length + kept.length + 6),
    ]);
    expect(found.at(-1)).toBe(
      `line ${String(3 + logs.length + kept.length + 6)} records a run ("$ pnpm media"): show the command without a prompt and its output; a guide keeps no record of runs`,
    );
  });
});

describe('the variables of the self-hosting guide', () => {
  const registry = {
    names: new Set(['YOUR_PROJECT', 'YOUR_REGION', 'YOUR_OAUTH_CLIENT_ID', 'YOUR_EMAIL']),
    tokens: (text: string) => [...text.matchAll(/\bYOUR_[A-Z0-9_]*[A-Z0-9]\b/g)].map((match) => match[0]),
  };

  it('are the quick start’s three, nothing optional', () => {
    const guide = [
      '```sh',
      'curl -fsSL https://gcportrait.app/install.sh | bash -s -- --project YOUR_PROJECT',
      '```',
      'Then `--oauth-client-id YOUR_OAUTH_CLIENT_ID`, and `--member="user:YOUR_EMAIL"`; in prose YOUR_REGION is text.',
    ].join('\n');
    expect(quickStartVariables(guide, registry)).toEqual({ extra: [], missing: [] });
    // Inline code of one token names the variable in a sentence: no field.
    expect(quickStartVariables(`${guide}\n\nThe region, \`YOUR_REGION\`, is optional.`, registry)).toEqual({
      extra: [],
      missing: [],
    });
    expect(quickStartVariables(`${guide}\n\n\`... --region YOUR_REGION\``, registry)).toEqual({
      extra: ['YOUR_REGION'],
      missing: [],
    });
    expect(quickStartVariables('`--project YOUR_PROJECT`', registry)).toEqual({
      extra: [],
      missing: ['YOUR_OAUTH_CLIENT_ID', 'YOUR_EMAIL'],
    });
  });
});

describe('the variables in a document’s code', () => {
  const markdown = [
    'Prose with YOUR_PROSE is not code; `infra/deploy.sh --project YOUR_PROJECT` is, and so is `` `YOUR_TICKED` ``.',
    '',
    '1. A step:',
    '',
    '   ```sh',
    '   gcloud projects add-iam-policy-binding YOUR_PROJECT_ID --member="user:YOUR_EMAIL"',
    '   ```',
    '',
    '~~~text',
    'OAUTH_CLIENT_ID=x YOUR_UNKNOWN',
    '```',
    'still inside the tilde fence: YOUR_FENCED',
    '~~~',
    'After the block: `YOUR_UNKNOWN` again, and `PROJECT_ID`, which is text, and `a span that goes on',
    'to the next line with YOUR_WRAPPED`.',
  ].join('\n');

  it('reads fenced blocks (indented ones and tildes too) and inline code, not prose', () => {
    expect(codeIn(markdown)).toEqual([
      'infra/deploy.sh --project YOUR_PROJECT',
      '`YOUR_TICKED`',
      '   gcloud projects add-iam-policy-binding YOUR_PROJECT_ID --member="user:YOUR_EMAIL"',
      'OAUTH_CLIENT_ID=x YOUR_UNKNOWN',
      '```',
      'still inside the tilde fence: YOUR_FENCED',
      'YOUR_UNKNOWN',
      'PROJECT_ID',
      'a span that goes on to the next line with YOUR_WRAPPED',
    ]);
  });

  it('reports each token the registry does not list, once', () => {
    const registry = {
      names: new Set(['YOUR_PROJECT', 'YOUR_PROJECT_ID', 'YOUR_EMAIL']),
      tokens: (text: string) => [...text.matchAll(/\bYOUR_[A-Z0-9_]*[A-Z0-9]\b/g)].map((match) => match[0]),
    };
    expect(unregisteredTokens(markdown, registry)).toEqual([
      'YOUR_TICKED',
      'YOUR_UNKNOWN',
      'YOUR_FENCED',
      'YOUR_WRAPPED',
    ]);
  });

  it('loads the registry of @gcportrait/model itself', () => {
    const registry = readVariableRegistry(REPO);
    expect(registry.names.has('YOUR_PROJECT')).toBe(true);
    expect(registry.names.has('PROJECT_ID')).toBe(false);
    expect(registry.tokens('gs://YOUR_PROJECT-YOUR_SERVICE-builds YOUR_Xs')).toEqual([
      'YOUR_PROJECT',
      'YOUR_SERVICE',
    ]);
  });
});

describe('the large-snapshot threshold in the modes guide', () => {
  const MODULE = "export const DEMO_REF_PREFIX = 'demo:';\nexport const LARGE_SNAPSHOT_ASSETS = 10_000;\n";

  it('reads the model’s number', () => {
    expect(largeSnapshotAssets(MODULE)).toBe(10_000);
    expect(largeSnapshotAssets('export const LARGE_SNAPSHOT_ASSETS = limit();')).toBeNull();
  });

  it('holds the guide to it, across a line break, and refuses another number or none', () => {
    expect(largeSnapshotProblems('Drawing more than 10,000\nassets at once is slow.', MODULE)).toEqual([]);
    expect(largeSnapshotProblems('Drawing more than 20,000 assets at once is slow.', MODULE)).toEqual([
      'docs/modes.md: it says "more than 20,000 assets", the model 10,000',
    ]);
    expect(largeSnapshotProblems('Large snapshots are slow.', MODULE)).toEqual([
      'docs/modes.md: it does not say "more than 10,000 assets"',
    ]);
    expect(largeSnapshotProblems('', 'nothing')).toEqual([
      'packages/model/src/schemas/vocabulary.ts no longer declares LARGE_SNAPSHOT_ASSETS as a number',
    ]);
  });
});

describe('the rasteriser’s version, named once', () => {
  let tree: TempTree;

  beforeEach(() => {
    tree = createTempTree('user-docs-rasteriser');
  });

  afterEach(() => {
    tree.remove();
  });

  it('reads the versions of resvg a document names, in code or not, across a line break', () => {
    expect(
      resvgVersionsIn(
        'resvg’s build, `@resvg/resvg-wasm`\n2.6.2, as the native `@resvg/resvg-js` 2.6.2, @resvg/resvg-js 2.7 and resvg v0.45.1 do',
      ),
    ).toEqual([
      { name: '@resvg/resvg-wasm', version: '2.6.2' },
      { name: '@resvg/resvg-js', version: '2.6.2' },
      { name: '@resvg/resvg-js', version: '2.7' },
      { name: 'resvg', version: '0.45.1' },
    ]);
    // The package alone, a command's argument, a scale and a word that only ends in resvg name no version.
    expect(
      resvgVersionsIn(
        '`@resvg/resvg-wasm` (pinned exactly), `pnpm add @resvg/resvg-wasm@2.6.2`, resvg 2×, xresvg 1.2',
      ),
    ).toEqual([]);
  });

  it('reads a workspace package’s declared and installed version of a dependency', () => {
    tree.write(
      'packages/render/package.json',
      JSON.stringify({ dependencies: { '@resvg/resvg-wasm': '2.6.2' } }),
    );
    tree.write(
      'packages/render/node_modules/@resvg/resvg-wasm/package.json',
      JSON.stringify({ name: '@resvg/resvg-wasm', version: '2.6.2' }),
    );
    expect(dependencyVersions(tree.root, 'packages/render', '@resvg/resvg-wasm')).toEqual({
      declared: '2.6.2',
      installed: '2.6.2',
    });
    tree.write('packages/other/package.json', JSON.stringify({ devDependencies: { x: '1.0.0' } }));
    expect(dependencyVersions(tree.root, 'packages/other', '@resvg/resvg-wasm')).toEqual({
      declared: null,
      installed: null,
    });
  });

  it('holds the goldens’ README to the version installed, and refuses a version anywhere else', () => {
    expect(RASTERISER).toEqual({ name: '@resvg/resvg-wasm', workspace: 'packages/render' });
    const docs = (golden: string, other = '`@resvg/resvg-wasm` (pinned exactly)') =>
      new Map([
        [RASTERISER_DOC, golden],
        ['docs/packages.md', other],
      ]);
    const pinned = { declared: '2.6.2', installed: '2.6.2' };
    const golden = 'rasterised by `@resvg/resvg-wasm`\n2.6.2, which draws as the native `@resvg/resvg-js`';
    expect(rasteriserVersionProblems(pinned, docs(golden))).toEqual([]);
    // A bump installs another version: the README's number fails, as does a declaration that is not exact.
    expect(rasteriserVersionProblems({ declared: '^2.7.0', installed: '2.7.0' }, docs(golden))).toEqual([
      'packages/render/package.json declares @resvg/resvg-wasm ^2.7.0, not exactly the version installed, 2.7.0',
      'e2e/baselines/render/README.md: it names @resvg/resvg-wasm 2.6.2, the version installed is 2.7.0',
    ]);
    expect(rasteriserVersionProblems(pinned, docs('rasterised by `@resvg/resvg-wasm`'))).toEqual([
      'e2e/baselines/render/README.md: it does not name @resvg/resvg-wasm 2.6.2, the version installed',
    ]);
    expect(
      rasteriserVersionProblems(pinned, docs(`${golden} 2.6.2`, 'resvg 2.6.2 and `pixelmatch` 7.2.0')),
    ).toEqual([
      'e2e/baselines/render/README.md: it names @resvg/resvg-js 2.6.2; it names the version of @resvg/resvg-wasm alone',
      "docs/packages.md: it names resvg 2.6.2; only e2e/baselines/render/README.md names resvg's version (name the package alone, pinned in packages/render/package.json)",
    ]);
    expect(rasteriserVersionProblems({ declared: '2.6.2', installed: null }, docs(golden))).toEqual([
      '@resvg/resvg-wasm is not installed for packages/render; run `pnpm install`',
    ]);
  });
});

/** Prose of exactly `columns` columns, in words of four letters. */
const prose = (columns: number): string => {
  const text = 'word '.repeat(Math.ceil(columns / 5)).slice(0, columns);
  return text.endsWith(' ') ? `${text.slice(0, -1)}x` : text;
};

describe('the width of a Markdown document', () => {
  it('reports a line over 110 columns with its number and width, in prose, a list item and a heading', () => {
    expect(WIDTH).toBe(110);
    const markdown = [
      '# Title',
      prose(110),
      prose(111),
      `- ${prose(109)}`,
      `  ${prose(120)}`,
      `## ${prose(108)}`,
    ].join('\n');
    expect(overlongLines(markdown)).toEqual([
      { line: 3, columns: 111 },
      { line: 4, columns: 111 },
      { line: 5, columns: 122 },
      { line: 6, columns: 111 },
    ]);
  });

  it('counts code points, not bytes or UTF-16 units', () => {
    // 110 code points: two of them outside the Basic Multilingual Plane, an arrow of three bytes.
    const wide = `${prose(104)} → ${String.fromCodePoint(0x1d465)} ${String.fromCodePoint(0x1d466)}`;
    expect(Array.from(wide)).toHaveLength(110);
    expect(wide.length).toBe(112);
    expect(overlongLines(wide)).toEqual([]);
    expect(overlongLines(`${wide}x`)).toEqual([{ line: 1, columns: 111 }]);
  });

  it('exempts the frontmatter, fenced code, table rows, URLs and a line of one word or one HTML tag', () => {
    const markdown = [
      '---',
      `description: ${prose(130)}`,
      '---',
      '<!-- SPDX-License-Identifier: MIT -->',
      '',
      `| ${prose(126)} |`,
      `  | ${prose(124)} |`,
      `See ${prose(100)} https://example.com/a and more.`,
      `Or gs://bucket-name/${prose(110)}, or mailto:someone@example.com ${prose(100)}.`,
      '````sh',
      prose(130),
      '```',
      prose(130),
      '````',
      '- A list item with code:',
      '',
      '  ~~~text',
      `  ${prose(130)}`,
      '  ~~~',
      '',
      `  \`${'x'.repeat(128)}\``,
      `- \`${'y'.repeat(128)}\``,
      `<img src="docs/media/a.png" width="400" alt="${prose(100)}">`,
      `  <walkthrough-open-file filePath="docs/a.md">${'z'.repeat(100)}</walkthrough-open-file>,`,
      `<!-- user-docs:x:start (${prose(110)}) -->`,
      prose(111),
    ].join('\n');
    expect(overlongLines(markdown)).toEqual([{ line: 26, columns: 111 }]);
  });

  it('holds prose beside an HTML tag, and a line after a closed fence, to the width', () => {
    const markdown = [
      `<p>${prose(108)}`,
      `<a href="docs/a.md">${prose(91)}</a>`,
      '```',
      prose(130),
      '```',
      prose(111),
    ].join('\n');
    expect(overlongLines(markdown)).toEqual([
      { line: 1, columns: 111 },
      { line: 2, columns: 115 },
      { line: 6, columns: 111 },
    ]);
  });
});

describe('the width of the Markdown files of a tree', () => {
  let tree: TempTree;

  beforeEach(() => {
    tree = createTempTree('user-docs-width');
  });

  afterEach(() => {
    tree.remove();
  });

  it('fails on a line over 110 columns outside the exemptions, in every Markdown file the tree holds', () => {
    tree.write(
      'docs/guide.md',
      [
        '<!-- SPDX-License-Identifier: MIT -->',
        '',
        prose(111),
        '',
        `| ${prose(126)} |`,
        `A link to https://example.com/${prose(100)}.`,
        '```',
        prose(130),
        '```',
      ].join('\n'),
    );
    tree.write('README.md', `${prose(110)}\n`);
    tree.write('packages/x/README.md', `# x\n\n${prose(112)}\n`);
    expect(markdownWidthProblems(tree.root)).toEqual([
      'docs/guide.md:3: 111 columns, the limit is 110',
      'packages/x/README.md:3: 112 columns, the limit is 110',
    ]);
  });

  it('skips the generated CHANGELOGs, the changesets, what the walk skips and files other than Markdown', () => {
    tree.write('CHANGELOG.md', `${prose(130)}\n`);
    tree.write('packages/x/CHANGELOG.md', `${prose(130)}\n`);
    tree.write('.changeset/a-change.md', `---\n'x': patch\n---\n\n${prose(130)}\n`);
    tree.write('node_modules/y/README.md', `${prose(130)}\n`);
    tree.write('notes.txt', `${prose(130)}\n`);
    expect(markdownWidthProblems(tree.root)).toEqual([]);
    tree.write('.changeset/README.md', `${prose(111)}\n`);
    expect(markdownWidthProblems(tree.root)).toEqual([
      '.changeset/README.md:1: 111 columns, the limit is 110',
    ]);
  });
});

describe('the user guides of this repository', () => {
  it('are current with the tree: no verification logs, configuration.md, the lens blocks, every command, the rasteriser’s version', () => {
    expect(checkUserDocs(REPO)).toEqual([]);
  });
});
