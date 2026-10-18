// SPDX-License-Identifier: MIT
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { REPOSITORY_URL } from '../site.js';
import {
  FIELD_HINT,
  excerpt,
  renderCommandBlock,
  renderInlineCode,
  renderMarkdown,
  rewriteHref,
  safeHref,
} from './markdown.js';
import { field } from './testing/helpers.js';

const PAGES = new Map([
  ['docs/self-host.md', '/docs/self-host/'],
  ['docs/permissions.md', '/docs/permissions/'],
]);

describe('rewriteHref', () => {
  it('keeps same-page anchors and external links', () => {
    expect(rewriteHref('#quick-start', 'docs/self-host.md', PAGES)).toBe('#quick-start');
    expect(rewriteHref('https://cloud.google.com/sdk', 'docs/self-host.md', PAGES)).toBe(
      'https://cloud.google.com/sdk',
    );
    expect(rewriteHref('mailto:someone@example.com', 'docs/self-host.md', PAGES)).toBe(
      'mailto:someone@example.com',
    );
  });

  it('turns a guide that is a page of the site into that page, with its anchor', () => {
    expect(rewriteHref('self-host.md#custom-domain', 'docs/permissions.md', PAGES)).toBe(
      '/docs/self-host/#custom-domain',
    );
    expect(rewriteHref('../docs/permissions.md', 'docs/self-host.md', PAGES)).toBe('/docs/permissions/');
  });

  it('sends anything else in the repository to GitHub, folders as trees', () => {
    expect(rewriteHref('legal/data-processing-inventory.md', 'docs/faq.md', PAGES)).toBe(
      `${REPOSITORY_URL}/blob/main/docs/legal/data-processing-inventory.md`,
    );
    expect(rewriteHref('../AGENTS.md#security-and-privacy', 'docs/faq.md', PAGES)).toBe(
      `${REPOSITORY_URL}/blob/main/AGENTS.md#security-and-privacy`,
    );
    expect(rewriteHref('../infra/', 'docs/faq.md', PAGES)).toBe(`${REPOSITORY_URL}/tree/main/infra`);
    expect(rewriteHref('media', 'docs/faq.md', PAGES, (target) => target === 'docs/media')).toBe(
      `${REPOSITORY_URL}/tree/main/docs/media`,
    );
  });
});

/** The attributes in an opening tag after its name (` type="button" hidden`), a boolean one as ''. */
function attributesOf(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const [, name = '', value = ''] of tag.matchAll(/\s([^\s=>"'/]+)(?:="([^"]*)")?/g))
    attributes[name] = value;
  return attributes;
}

/** An element of rendered HTML: its name, attributes and child elements, and its text with its children's. */
type HtmlElement = {
  readonly name: string;
  readonly attributes: Record<string, string>;
  readonly children: HtmlElement[];
  text: string;
  /** Where its closing tag ends in the HTML it was read from. */
  end: number;
};

/**
 * The element whose opening tag starts at `at` in `html`, read with all it holds. rehype-stringify closes every element
 * it writes (an SVG `<path>` too), so a closing tag that closes another element, or none, throws.
 */
function elementAt(html: string, at: number): HtmlElement {
  const token = /<(\/?)([a-z][a-z0-9-]*)([^>]*)>|[^<]+/y;
  token.lastIndex = at;
  const open: HtmlElement[] = [];
  for (let match = token.exec(html); match !== null; match = token.exec(html)) {
    const [whole, closing, name, tag = ''] = match;
    if (name === undefined) {
      for (const element of open) element.text += whole;
    } else if (closing === '/') {
      const element = open.pop();
      if (element?.name !== name)
        throw new Error(`</${name}> closes <${element?.name ?? 'nothing'}> in ${html}`);
      element.end = token.lastIndex;
      if (open.length === 0) return element;
    } else {
      const element: HtmlElement = { name, attributes: attributesOf(tag), children: [], text: '', end: -1 };
      open.at(-1)?.children.push(element);
      open.push(element);
    }
  }
  throw new Error(`the element at ${String(at)} is not closed in ${html}`);
}

/** What an element holds, in order: each child element as `name.class`, or as `name` when it has no class. */
function outline(element: HtmlElement | undefined): string[] {
  return (element?.children ?? []).map(({ name, attributes }) =>
    attributes.class === undefined ? name : `${name}.${attributes.class}`,
  );
}

/** The child element that `outline` writes as `entry`; undefined for none. */
function childOf(element: HtmlElement | undefined, entry: string): HtmlElement | undefined {
  return element?.children[outline(element).indexOf(entry)];
}

/** Each Copy-bar code block in rendered HTML, in order, read with all it holds. */
function codeBlocks(html: string): HtmlElement[] {
  return [...html.matchAll(/<div\b[^>]*\bclass="code-block"/g)].map((found) => elementAt(html, found.index));
}

/**
 * A code block as the page's script (src/lib/fillable-page.ts) and Base.astro use it. The block (`data-code-block`)
 * holds the hint (with `hint`), the bar and the code (a `pre`, with any class), in that order and nothing else, so the
 * bar sits directly above the code. The hint and the bar show only with JavaScript (Base.astro hides `data-var-js`
 * without it), so what needs the script is inside them: the hint's pencil mark (decoration only) and its text, the one
 * hint; the bar's note (`data-code-note`, `noteId`) saying what is left to fill (`note`), then the Copy button, a plain
 * button (`type="button"`, `data-code-copy`) the note describes, hidden until the script shows it, its icon decoration
 * only and its label (`data-copy-label`) the text the script turns into "Copied".
 */
function expectCodeBlock(
  block: HtmlElement | undefined,
  { noteId, note, hint }: { noteId: string; note: string; hint: boolean },
): void {
  expect(block?.attributes).toMatchObject({ class: 'code-block', 'data-code-block': '' });
  expect(outline(block)).toEqual([
    ...(hint ? ['p.code-hint'] : []),
    'div.code-bar',
    expect.stringMatching(/^pre(\.|$)/),
  ]);
  if (hint) {
    const line = childOf(block, 'p.code-hint');
    expect(line?.attributes).toMatchObject({ 'data-var-js': '' });
    expect(outline(line)).toEqual(['span.var-mark']);
    expect(childOf(line, 'span.var-mark')?.attributes).toMatchObject({ 'aria-hidden': 'true' });
    expect(line?.text).toBe(FIELD_HINT);
  }
  const bar = childOf(block, 'div.code-bar');
  expect(bar?.attributes).toMatchObject({ 'data-var-js': '' });
  expect(outline(bar)).toEqual(['span.code-note', 'button.code-copy']);
  const noteSpan = childOf(bar, 'span.code-note');
  expect(noteSpan?.attributes).toMatchObject({ id: noteId, 'data-code-note': '' });
  expect(noteSpan?.text).toBe(note);
  const button = childOf(bar, 'button.code-copy');
  expect(button?.attributes).toMatchObject({
    type: 'button',
    'data-code-copy': '',
    'aria-describedby': noteId,
    hidden: '',
  });
  const [icon, label, ...rest] = button?.children ?? [];
  expect(rest).toEqual([]);
  expect(icon?.name).toBe('svg');
  expect(icon?.attributes).toMatchObject({ 'aria-hidden': 'true' });
  expect(label?.name).toBe('span');
  expect(label?.attributes).toMatchObject({ 'data-copy-label': '' });
  expect(label?.text).toBe('Copy');
}

describe('a guide’s link to the demo', () => {
  it('opens a new tab and says so; other links stay as they are', () => {
    const { html } = renderMarkdown(
      [
        'Open <https://gcportrait.app/demo/> or [a view](https://gcportrait.app/demo/diagram).',
        '',
        'Not [the docs](https://gcportrait.app/docs/), [another](https://demo.example.com/demo/) or [ours](https://gcportrait.app/demos/).',
      ].join('\n'),
      { sourcePath: 'docs/getting-started.md', pages: PAGES },
    );
    const note = '<span class="visually-hidden"> (opens in a new tab)</span>';
    expect(html).toContain(
      `<a href="https://gcportrait.app/demo/" target="_blank" rel="noopener">https://gcportrait.app/demo/${note}</a>`,
    );
    expect(html).toContain(
      `<a href="https://gcportrait.app/demo/diagram" target="_blank" rel="noopener">a view${note}</a>`,
    );
    expect(html).toContain('<a href="https://gcportrait.app/docs/">the docs</a>');
    expect(html).toContain('<a href="https://demo.example.com/demo/">another</a>');
    expect(html).toContain('<a href="https://gcportrait.app/demos/">ours</a>');
    expect(html.match(/target="_blank"/g)).toHaveLength(2);
  });
});

describe('renderMarkdown', () => {
  const source = [
    '<!-- SPDX-License-Identifier: MIT -->',
    '',
    '# Self-hosting gcportrait',
    '',
    'gcportrait renders Google Cloud-style architecture diagrams. It is an independent open-source project and is',
    'not affiliated with, endorsed by, or sponsored by Google. Google Cloud and the Google Cloud product icons are',
    "trademarks of Google and are used under Google's icon usage terms.",
    '',
    'A gcportrait instance is one Cloud Run service. See [permissions](permissions.md#the-grant).',
    '',
    '<details><summary>raw</summary><script>alert(1)</script></details>',
    '',
    '## Quick start',
    '',
    '[![Open in Cloud Shell](https://gstatic.com/cloudssh/images/open-btn.svg)](https://shell.cloud.google.com/)',
    '',
    'Run `infra/deploy.sh --build` or `europe-west3-docker.pkg.dev/YOUR_PROJECT/ghcr/florianchrometz/gcportrait`.',
    '',
    '### A detail',
    '',
    '| a | b |',
    '|---|---|',
    '| 1 | 2 |',
    '',
    '```sh',
    'echo `--build`',
    '```',
  ].join('\n');
  const rendered = renderMarkdown(source, { sourcePath: 'docs/self-host.md', pages: PAGES, dropTitle: true });

  it('takes the title from the first level-1 heading and leaves it out of the body', () => {
    expect(rendered.title).toBe('Self-hosting gcportrait');
    expect(rendered.html).not.toContain('<h1');
  });

  it('skips the non-affiliation statement for the lead and collects the headings with GitHub’s ids', () => {
    expect(rendered.lead).toBe('A gcportrait instance is one Cloud Run service. See permissions.');
    expect(rendered.headings).toEqual([
      { depth: 2, id: 'quick-start', text: 'Quick start' },
      { depth: 3, id: 'a-detail', text: 'A detail' },
    ]);
  });

  it('drops raw HTML from the source, and never loads an image from another host', () => {
    expect(rendered.html).not.toContain('<script');
    expect(rendered.html).not.toContain('<details');
    expect(rendered.html).not.toContain('SPDX');
    expect(rendered.html).not.toContain('<img');
    expect(rendered.html).toContain(
      '<a href="https://shell.cloud.google.com/"><span class="md-image-alt">Open in Cloud Shell</span></a>',
    );
  });

  it('rewrites links, wraps tables for scrolling and lets only long inline code wrap', () => {
    expect(rendered.html).toContain('<a href="/docs/permissions/#the-grant">permissions</a>');
    expect(rendered.html).toContain('<div class="table-scroll" tabindex="0"><table>');
    expect(rendered.html).toContain('<code>infra/deploy.sh --build</code>');
    expect(rendered.html).toContain('<code class="code-long">europe-west3-docker.pkg.dev/');
    expect(rendered.html).toMatch(
      /<pre tabindex="0"><code class="language-sh">echo `--build`\n<\/code><\/pre>/,
    );
  });

  it('renders the package guide’s app modules as a two-column table, not a paragraph', () => {
    const guide = readFileSync(new URL('../../../docs/packages.md', import.meta.url), 'utf8');
    const section = guide.split("### The app's modules\n")[1]?.split('\n### ')[0];
    expect(section).toBeDefined();
    const { html } = renderMarkdown(section ?? '', { sourcePath: 'docs/packages.md' });
    const tableStart = html.indexOf('<div class="table-scroll"');
    expect(tableStart).toBeGreaterThanOrEqual(0);
    const wrapper = elementAt(html, tableStart);
    expect(wrapper.attributes.tabindex).toBe('0');
    const table = childOf(wrapper, 'table');
    const header = childOf(childOf(table, 'thead'), 'tr');
    expect(outline(header)).toEqual(['th', 'th']);
    expect(header?.children.map((cell) => cell.text.trim())).toEqual([
      'Module (frontend/src/)',
      'Responsibility',
    ]);
    const rows = childOf(table, 'tbody')?.children ?? [];
    expect(rows).toHaveLength(14);
    for (const row of rows) {
      expect(row.name).toBe('tr');
      expect(outline(row)).toEqual(['td', 'td']);
      expect(row.children[1]?.text.trim().length).toBeGreaterThan(0);
    }
    expect(rows[0]?.children[0]?.text.trim()).toBe('state/');
    expect(rows.at(-1)?.children[0]?.text.trim()).toBe('storage/, theme/, pages/');
  });

  it('makes code blocks focusable, turns empty header cells into data cells and marks command cells', () => {
    const table = renderMarkdown(
      [
        '| | Demo | Sign-in |',
        '|---|---|---|',
        '| **Reads** | synthetic | live |',
        '',
        '| Mode | Command |',
        '|---|---|',
        '| export | `gcloud asset export --organization=SCOPE_ID --content-type=resource` |',
        '| role | `roles/serviceusage.serviceUsageConsumer` |',
        '',
        '```',
        'a very long line',
        '```',
      ].join('\n'),
      { sourcePath: 'docs/modes.md' },
    ).html;
    expect(table).toContain('<thead>\n<tr>\n<td></td>\n<th>Demo</th>');
    expect(table).not.toMatch(/<th>\s*<\/th>/);
    expect(table).toContain('<td class="cell-command"><code class="code-long">gcloud asset export');
    // A long role is no command: it has no space, so it wraps where it must.
    expect(table).toContain(
      '<td><code class="code-long">roles/serviceusage.serviceUsageConsumer</code></td>',
    );
    expect(table).toContain('<pre tabindex="0"><code>a very long line');
  });

  it('makes the variables in code fields and gives each code block a Copy bar, for the docs pages only', () => {
    const source = [
      'Run `infra/deploy.sh --project YOUR_PROJECT --region YOUR_REGION`; the commands show `YOUR_EMAIL`.',
      '',
      '```sh',
      'gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \\',
      '  --member="serviceAccount:gcportrait-backend@YOUR_PROJECT.iam.gserviceaccount.com" # YOUR_UNKNOWN',
      '```',
      '',
      '```text',
      'no variables here',
      '```',
    ].join('\n');
    const docs = renderMarkdown(source, { sourcePath: 'docs/self-host.md', fillable: true });
    expect(docs.html).toContain(
      `<code class="code-long">infra/deploy.sh --project ${field('YOUR_PROJECT')} --region ${field('YOUR_REGION')}</code>`,
    );
    // A token alone in inline code names the variable in a sentence: it stays text.
    expect(docs.html).toContain('the commands show <code>YOUR_EMAIL</code>.');
    expect(docs.html).toContain(
      `gcloud projects add-iam-policy-binding ${field('YOUR_PROJECT_ID')} \\\n  --member="serviceAccount:gcportrait-backend@${field('YOUR_PROJECT')}.iam.gserviceaccount.com" # YOUR_UNKNOWN`,
    );
    expect(docs.variables).toEqual(['YOUR_PROJECT', 'YOUR_REGION', 'YOUR_PROJECT_ID']);
    expect(docs.unknownTokens).toEqual(['YOUR_UNKNOWN']);
    expect(docs.codeBlocks).toBe(2);
    // The first code block with fields carries the hint above its bar; the next one only its bar.
    // Each bar's note says what is left to fill and describes its Copy button, which the page's script shows.
    const [first, second, ...more] = codeBlocks(docs.html);
    expect(more).toEqual([]);
    expectCodeBlock(first, { noteId: 'code-1-note', note: '2 values to fill', hint: true });
    expectCodeBlock(second, { noteId: 'code-2-note', note: '', hint: false });
    expect(docs.html.split(FIELD_HINT)).toHaveLength(2);
    // The code itself stays focusable for scrolling, with its language.
    const code = childOf(first, 'pre');
    expect(code?.attributes).toEqual({ tabindex: '0' });
    expect(outline(code)).toEqual(['code.language-sh']);

    const plain = renderMarkdown(source, { sourcePath: 'docs/author.md' });
    expect(plain.html).not.toContain('data-var');
    expect(plain.html).not.toContain('code-block');
    expect(plain.variables).toEqual([]);
    expect(plain.codeBlocks).toBe(2);
  });

  it('puts the hint on the first code block with fields, not on an earlier block without', () => {
    const source = [
      '```text',
      'no variables',
      '```',
      '',
      '```sh',
      'gcloud config set project YOUR_PROJECT',
      '```',
    ];
    const docs = renderMarkdown(source.join('\n'), { sourcePath: 'docs/self-host.md', fillable: true });
    expect(docs.html.indexOf(FIELD_HINT)).toBeGreaterThan(docs.html.indexOf('no variables'));
    expect(docs.html.split(FIELD_HINT)).toHaveLength(2);
    const none = renderMarkdown('```text\nno variables\n```', { sourcePath: 'docs/x.md', fillable: true });
    expect(none.html).not.toContain(FIELD_HINT);
  });

  it('renders a page’s own commands as a guide’s: fields, the Copy bar, the hint where asked', () => {
    const deploy = renderCommandBlock(
      'cd gcportrait\ninfra/deploy.sh --project YOUR_PROJECT # YOUR_UNKNOWN',
      {
        id: 'deploy',
        label: 'Deploy commands',
        wrap: true,
        hint: true,
      },
    );
    expect(deploy.variables).toEqual(['YOUR_PROJECT']);
    expect(deploy.unknownTokens).toEqual(['YOUR_UNKNOWN']);
    // The command's HTML is its code block, whole.
    const [block, ...more] = codeBlocks(deploy.html);
    expect(more).toEqual([]);
    expect(deploy.html.startsWith('<div class="code-block"')).toBe(true);
    expect(block?.end).toBe(deploy.html.length);
    expectCodeBlock(block, { noteId: 'deploy-note', note: '1 value to fill', hint: true });
    const code = childOf(block, 'pre.wrap');
    expect(code?.attributes).toMatchObject({ tabindex: '0', 'aria-label': 'Deploy commands' });
    expect(outline(code)).toEqual(['code']);
    expect(code?.text).toBe('cd gcportrait\ninfra/deploy.sh --project YOUR_PROJECT # YOUR_UNKNOWN');
    expect(deploy.html).toContain(
      `infra/deploy.sh --project ${field('YOUR_PROJECT')} # YOUR_UNKNOWN</code></pre></div>`,
    );
    const grant = renderCommandBlock('gcloud projects describe YOUR_PROJECT_ID', {
      id: 'grant',
      label: 'Grant',
      hint: false,
    });
    expect(grant.html).not.toContain('code-hint');
    expect(grant.html).toContain('<pre tabindex="0" aria-label="Grant"><code>');
    // Without a field there is nothing to hint at.
    expect(renderCommandBlock('ls', { id: 'x', label: 'x', hint: true }).html).not.toContain('code-hint');

    expect(renderInlineCode('infra/uninstall.sh --project YOUR_PROJECT')).toEqual({
      html: `<code class="code-long">infra/uninstall.sh --project ${field('YOUR_PROJECT')}</code>`,
      variables: ['YOUR_PROJECT'],
      unknownTokens: [],
    });
    expect(renderInlineCode('YOUR_EMAIL').html).toBe('<code>YOUR_EMAIL</code>');
  });

  it('keeps a link only for http, https, mailto or no scheme; any other link becomes its text', () => {
    const links = renderMarkdown(
      [
        '[js](javascript:alert(1)) [tab](<java\tscript:alert(1)>) [upper](JavaScript:alert(1))',
        '[data](data:text/html;base64,PHNjcmlwdD4=) [vb](vbscript:msgbox) [file](file:///etc/passwd)',
        '[web](https://example.com/) [mail](mailto:someone@example.com) [guide](permissions.md#the-grant) [here](#a)',
      ].join('\n\n'),
      { sourcePath: 'docs/self-host.md', pages: PAGES },
    ).html;
    expect(links).not.toMatch(/javascript|data:|vbscript|file:/i);
    for (const text of ['js', 'tab', 'upper', 'data', 'vb', 'file'])
      expect(links).toContain(`<span>${text}</span>`);
    expect(links).toContain('<a href="https://example.com/">web</a>');
    expect(links).toContain('<a href="mailto:someone@example.com">mail</a>');
    expect(links).toContain('<a href="/docs/permissions/#the-grant">guide</a>');
    expect(links).toContain('<a href="#a">here</a>');
    expect(safeHref(' javascript:alert(1)')).toBeUndefined();
    expect(safeHref('java\nscript:alert(1)')).toBeUndefined();
    expect(safeHref('//example.com/x')).toBe('//example.com/x');
    expect(safeHref('docs/a:b.md')).toBe('docs/a:b.md');
  });

  it('resolves a repository image through the caller, or links it', () => {
    const withImage = renderMarkdown('![A still](media/stills/hero-light.png)', {
      sourcePath: 'docs/x.md',
      resolveImage: (repoPath) =>
        repoPath === 'docs/media/stills/hero-light.png' ? '/_astro/hero.png' : undefined,
    });
    expect(withImage.html).toContain(
      '<img src="/_astro/hero.png" alt="A still" loading="lazy" decoding="async">',
    );
    const without = renderMarkdown('![A still](media/other.png)', { sourcePath: 'docs/x.md' });
    expect(without.html).toContain(`<a href="${REPOSITORY_URL}/blob/main/docs/media/other.png">A still</a>`);
  });
});

describe('excerpt', () => {
  it('cuts at a word and marks the cut', () => {
    expect(excerpt('short text')).toBe('short text');
    const long = 'word '.repeat(60);
    const cut = excerpt(long, 50);
    expect(cut.length).toBeLessThanOrEqual(50);
    expect(cut.endsWith('word…')).toBe(true);
  });
});
