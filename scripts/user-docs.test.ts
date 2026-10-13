// SPDX-License-Identifier: MIT
/**
 * scripts/user-docs.mjs: the user guides' generated lens blocks and the staleness checks that keep
 * docs/configuration.md and every command in the guides true to the tree. The last test is the check itself, on
 * the repository: it fails when a guide is stale (run `node scripts/user-docs.mjs` for the list, `--write` for
 * the generated blocks).
 */
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  backendEnvironment,
  checkUserDocs,
  codeIn,
  commandProblem,
  commandsIn,
  generateLensDoc,
  helpFlags,
  lensTableLines,
  lensTypesLines,
  quickStartVariables,
  readVariableRegistry,
  replaceBlock,
  sectionTableRows,
  typesByService,
  unregisteredTokens,
  verificationLogLines,
  wrapWords,
} from './user-docs.mjs';
import { SCRIPTS_DIR } from './testing/temp-tree.js';

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

describe('the user guides of this repository', () => {
  it('are current with the tree: no verification logs, configuration.md, the lens blocks, every command', () => {
    expect(checkUserDocs(REPO)).toEqual([]);
  });
});
