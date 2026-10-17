// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';

import { brandDrawing, type Drawing } from '../src/lib/brand.js';
import { repoRoot } from '../src/lib/repo.js';
import { field, logoMarkup } from '../src/lib/testing/helpers.js';
import {
  CLOUD_RUN_BUTTON_URL,
  CLOUD_SHELL_URL,
  EXPORT_DISCLAIMER,
  FOOTER_NOTICE_LEAD,
  IMPRESSUM_URL,
  LEGAL_LINKS,
  MAINTAINER_NAME,
  MAINTAINER_URL,
  NON_AFFILIATION_LONG,
  PRIVACY_URL,
  REPOSITORY_URL,
  TELEMETRYDECK_APP_ID,
  TELEMETRYDECK_TARGET,
} from '../src/site.js';
import {
  ANALYTICS_PREFIX,
  checkBrand,
  checkDemo,
  checkDemoLinks,
  DEMO_POLICY,
  DEMO_ROUTES,
  inlineScriptSources,
  checkExports,
  checkFooterNotice,
  checkInstaller,
  checkLandingStatement,
  checkLegalLinks,
  checkLinks,
  checkPage,
  checkRepositoryLinks,
  checkStartLinks,
  cssAddresses,
  diagramsNetFile,
  INSTALLER_SOURCE,
  INSTALLER_TYPES,
  exportDrawioProblems,
  exportSvgProblems,
  keepsMediaInBox,
  linkName,
  scriptConnectionProblems,
  timelineShorthands,
  urlPathOf,
} from './check-site.js';
import { CONTENT_TYPES } from './serve.js';

const SLUG = 'florianchrometz/gcportrait';
const HEADER = `<header><a class="button header-github has-facts" href="${REPOSITORY_URL}" rel="noopener" aria-label="gcportrait on GitHub: version 1.0.0, 1.2k stars, 3 forks" data-repository="${SLUG}"><span>GitHub</span> <span class="repo-facts"><span class="repo-fact" data-fact="version"><span class="fact-value">v1.0.0</span></span><span class="repo-fact" data-fact="stars"><span class="fact-value">1.2k</span></span><span class="repo-fact" data-fact="forks"><span class="fact-value">3</span></span></span></a></header>`;

/** The footer notice as src/components/Footer.astro writes it: the maintainer's name linked, then a full stop. */
const FOOTER_NOTICE_HTML = `<p class="footer-notice">${FOOTER_NOTICE_LEAD}<a href="${MAINTAINER_URL}">${MAINTAINER_NAME}</a>.</p>`;

/** The repository widget's live requests as the build minifies them (src/lib/star-count.ts): the allowed requests. */
const STAR_FETCH =
  'async function m(e,t=4e3){if(!i(e))return;let n=AbortSignal.timeout(t),o=fetch(`https://api.github.com/repos/${e}`,{headers:{Accept:`application/vnd.github+json`},credentials:`omit`,referrerPolicy:`no-referrer`,signal:n}).then(p).catch(()=>void 0),s=fetch(`https://api.github.com/repos/${e}/releases/latest`,{headers:{Accept:`application/vnd.github+json`},credentials:`omit`,referrerPolicy:`no-referrer`,signal:n}).then(p).catch(()=>void 0),[c,u]=await Promise.all([o,s]);if(c===void 0)return}';

/** The footer's legal links as src/components/Footer.astro writes them. */
const LEGAL_NAV = `<nav aria-label="Legal"><h2>Legal</h2><ul>${LEGAL_LINKS.map(
  (link) =>
    `<li><a class="external" href="${link.href}" rel="noopener" data-legal>${link.label}<span class="visually-hidden"> (external site, ${link.site})</span><svg class="external-mark" aria-hidden="true"><path d="M6 3h7v7M13 3 4 12"/></svg></a></li>`,
).join('')}</ul></nav>`;

function page(
  path: string,
  head: string,
  body: string,
  header = HEADER,
  legal = LEGAL_NAV,
): { path: string; html: string } {
  return {
    path,
    html: `<!doctype html><html lang="en"><head>${head}</head><body>${header}${body}<footer>${legal}${FOOTER_NOTICE_HTML}</footer></body></html>`,
  };
}

const VIEWPORT = '<meta name="viewport" content="width=device-width, initial-scale=1">';

/** A start button as src/components/StartLink.astro writes it: a new tab, its mark inline, the new-tab note. */
function startButton(href: string, label: string): string {
  return `<a class="button" href="${href.replace(/&/g, '&amp;')}" target="_blank" rel="noopener" data-start="x"><svg class="start-mark" viewBox="0 0 16 16" aria-hidden="true"><path d="M1 1h14"/></svg>${label}<span class="visually-hidden"> (opens in a new tab)</span></a>`;
}

/** The landing page's hero with "Self-host" and the two start buttons beside it. */
const LANDING_HERO = `<section class="hero"><div class="button-row"><a class="button" href="/docs/self-host/">Self-host</a> ${startButton(CLOUD_SHELL_URL, 'Open in Cloud Shell')} ${startButton(CLOUD_RUN_BUTTON_URL, 'Run on Google Cloud')}</div></section>`;

const GOOD_HEAD = [
  VIEWPORT,
  '<title>Self-hosting gcportrait · gcportrait</title>',
  '<meta name="description" content="Run gcportrait on Cloud Run in your own Google Cloud project in about 10 minutes.">',
  '<link rel="canonical" href="https://gcportrait.app/docs/self-host/">',
  '<meta property="og:type" content="article"><meta property="og:site_name" content="gcportrait">',
  '<meta property="og:title" content="t"><meta property="og:description" content="d">',
  '<meta property="og:url" content="https://gcportrait.app/docs/self-host/">',
  '<meta property="og:image" content="https://gcportrait.app/_astro/docs-self-host.jpg">',
  '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">',
  '<meta property="og:image:alt" content="Self-host">',
  '<meta name="twitter:card" content="summary_large_image">',
  '<script type="application/ld+json">{"@type":"TechArticle"}</script>',
].join('');

/** The parts of a checked page that a test may swap; anything left out is the good page's. */
type PageParts = {
  readonly h1?: string;
  readonly path?: string;
  readonly head?: string;
  readonly header?: string;
  readonly legal?: string;
};

/**
 * What checkPage finds on a page whose main content is its level-1 heading (`h1`, "Self-hosting" by default) and then
 * `content`, every other part the good page's unless given; at another `path` the head names that path.
 */
function problemsOf(content: string, parts: PageParts = {}): string[] {
  const { h1 = 'Self-hosting', path = '/docs/self-host/', header = HEADER, legal = LEGAL_NAV } = parts;
  const head = parts.head ?? GOOD_HEAD.replaceAll('/docs/self-host/', path);
  return checkPage(page(path, head, `<h1>${h1}</h1>${content}`, header, legal));
}

/** problemsOf as one text, for `toContain`. */
function problems(content: string, parts: PageParts = {}): string {
  return problemsOf(content, parts).join('\n');
}

describe('checkPage', () => {
  it('accepts a page with everything in place', () => {
    const good = page(
      '/docs/self-host/',
      GOOD_HEAD,
      '<h1>Self-hosting</h1><img src="/_astro/a.webp" alt="A still" width="10" height="5"><p>See <a href="/">home</a>.</p>',
    );
    expect(checkPage(good)).toEqual([]);
  });

  it('reports what is missing or not allowed', () => {
    const bad = page(
      '/docs/self-host/',
      GOOD_HEAD.replace(/<meta name="description"[^>]*>/, '').replace(
        '"@type":"TechArticle"',
        '"@type":"Organization"',
      ),
      '<h1>A</h1><h1>B</h1><img src="https://example.com/x.png"><link rel="stylesheet" href="https://fonts.example.com/a.css"><p>text<a href="/">glued</a></p>',
    );
    const found = checkPage(bad).join('\n');
    expect(found).toContain('no meta description');
    expect(found).toContain('JSON-LD names an Organization');
    expect(found).toContain('2 level-1 headings');
    expect(found).toContain('an image without alt');
    expect(found).toContain('<img src> loads from another host');
    expect(found).toContain('<link href> loads from another host');
    expect(found).toContain('text runs into an element without a space');
  });

  it('keeps titles and descriptions to what search results show whole, and the statement out of the metadata', () => {
    const long = 'A title that goes on and on about what the page holds, far past the limit';
    expect(
      problems('', { head: GOOD_HEAD.replace(/<title>[^<]*<\/title>/, `<title>${long}</title>`) }),
    ).toContain(`the title has ${String(long.length)} characters (at most 60)`);
    const description = 'd'.repeat(161);
    expect(
      problems('', {
        head: GOOD_HEAD.replace(/(<meta name="description" content=")[^"]*/, `$1${description}`),
      }),
    ).toContain('the meta description has 161 characters (50 to 160)');
    const statement = NON_AFFILIATION_LONG.replace(/'/g, '&#39;');
    const stated = problems('', {
      head: GOOD_HEAD.replace(
        '<meta property="og:description" content="d">',
        `<meta property="og:description" content="${statement}">`,
      ).replace(
        '{"@type":"TechArticle"}',
        JSON.stringify({
          '@type': 'SoftwareApplication',
          description: `It draws diagrams. ${NON_AFFILIATION_LONG}`,
        }),
      ),
    });
    expect(stated).toContain('JSON-LD states an affiliation');
    expect(stated).toContain('<meta og:description> states an affiliation');
  });

  it('accepts diagrams.net as a link target and refuses it as a resource, as any other host', () => {
    const open = `https://app.diagrams.net/?url=${encodeURIComponent('https://gcportrait.app/_astro/S-light.drawio')}`;
    const linked = page(
      '/docs/self-host/',
      GOOD_HEAD,
      `<h1>Self-hosting</h1><p>See <a href="${open}" target="_blank" rel="noopener">diagrams.net</a>.</p>`,
    );
    expect(checkPage(linked)).toEqual([]);
    const loaded = page(
      '/docs/self-host/',
      GOOD_HEAD,
      '<h1>Self-hosting</h1><img src="https://app.diagrams.net/images/logo.png" alt="x" width="1" height="1"><script src="https://app.diagrams.net/js/viewer.min.js"></script>',
    );
    expect(checkPage(loaded)).toEqual([
      '/docs/self-host/: <script src> loads from another host: https://app.diagrams.net/js/viewer.min.js',
      '/docs/self-host/: <img src> loads from another host: https://app.diagrams.net/images/logo.png',
    ]);
  });

  it('requires every code block to be keyboard-focusable or wrapping', () => {
    const copy = '<button type="button" data-code-copy hidden>Copy</button>';
    expect(
      problems(
        `${copy}<pre tabindex="0"><code>x</code></pre>${copy}<pre class="wrap" aria-label="y"><code>y</code></pre>`,
      ),
    ).toBe('');
    expect(problems(`${copy}<pre><code>x</code></pre>`)).toContain('is not keyboard-focusable');
  });

  describe('command variables: a field for each token in code, the panel listing the fields, Copy buttons', () => {
    const block = (code: string): string =>
      `<div class="code-block"><div class="code-bar"><button type="button" data-code-copy hidden>Copy</button></div><pre tabindex="0"><code>${code}</code></pre></div>`;
    const panel = (...names: string[]): string =>
      `<ul>${names.map((name) => `<li class="variable" data-var-row="${name}">x</li>`).join('')}</ul>`;
    const GOOD = `${panel('YOUR_PROJECT', 'YOUR_REGION')}${block(`infra/deploy.sh --project ${field('YOUR_PROJECT')}`)}<p><code>--region=${field('YOUR_REGION')}</code> or <code>YOUR_EMAIL</code></p>`;

    it('accepts registered variables as fields, listed in the panel, a Copy button on each code block', () => {
      expect(problems(GOOD)).toBe('');
    });

    it('refuses a token in code that is not a variable of COMMAND_VARIABLES', () => {
      expect(problems(`${GOOD}<p><code>x YOUR_NOT_A_VARIABLE</code></p>`)).toContain(
        'its code names YOUR_NOT_A_VARIABLE, which is not a variable of COMMAND_VARIABLES',
      );
    });

    it('refuses a panel that lacks a field’s variable or lists one no field stands for', () => {
      expect(
        problems(GOOD.replace(panel('YOUR_PROJECT', 'YOUR_REGION'), panel('YOUR_PROJECT', 'YOUR_EMAIL'))),
      ).toMatch(/lacks YOUR_REGION[\s\S]*lists YOUR_EMAIL, which no field stands for/);
    });

    it('refuses a variable shown as text in a code block', () => {
      expect(problems(`${GOOD}${block('gcloud projects describe YOUR_PROJECT')}`)).toContain(
        'a code block shows YOUR_PROJECT as text, not as a field',
      );
    });

    it('refuses a field that does not show its token', () => {
      expect(problems(GOOD.replace('>YOUR_REGION</span>', '>europe-west3</span>'))).toContain(
        'the field of YOUR_REGION shows "europe-west3", not its token',
      );
    });

    it('requires a Copy button for each code block', () => {
      expect(problems(`${GOOD}<pre tabindex="0"><code>x</code></pre>`)).toContain(
        '2 code blocks, 1 Copy buttons',
      );
    });

    it('outside the docs, needs no panel or Copy button for commands as text, but a Copy button with fields', () => {
      const landing = { path: '/' };
      expect(
        problems(
          `${LANDING_HERO}<pre class="wrap" tabindex="0"><code>infra/deploy.sh --project YOUR_PROJECT</code></pre>`,
          landing,
        ),
      ).toBe('');
      // The landing page's commands have fields: a Copy button for each code block, as a docs page has.
      expect(problems(`${LANDING_HERO}${GOOD}`, landing)).toBe('');
      expect(
        problems(
          `${panel('YOUR_PROJECT')}<pre class="wrap" tabindex="0"><code>infra/deploy.sh --project ${field('YOUR_PROJECT')}</code></pre>`,
          landing,
        ),
      ).toContain('1 code blocks, 0 Copy buttons');
    });
  });

  describe('the header’s GitHub link to the repository, in the same tab', () => {
    it('is accepted without facts too', () => {
      const header = HEADER.replace(' has-facts', '').replace(': version 1.0.0, 1.2k stars, 3 forks', '');
      expect(problems('', { header })).toBe('');
    });

    it.each([
      ['missing', '', '0 GitHub links in the header (one)'],
      [
        'going elsewhere',
        HEADER.replace(REPOSITORY_URL, 'https://example.com/'),
        "the header's GitHub link goes to https://example.com/",
      ],
      [
        'named without the project',
        HEADER.replace('gcportrait on GitHub', 'GitHub'),
        'is named "GitHub: version 1.0.0, 1.2k stars, 3 forks"',
      ],
      [
        'opening another tab',
        HEADER.replace('rel="noopener"', 'target="_blank" rel="noopener"'),
        'opens another tab or window',
      ],
      [
        'without data-repository',
        HEADER.replace(` data-repository="${SLUG}"`, ''),
        `the header's GitHub link has data-repository="", not the repository's ${SLUG}`,
      ],
      [
        'naming another repository in data-repository',
        HEADER.replace(`data-repository="${SLUG}"`, 'data-repository="someone/else"'),
        'has data-repository="someone/else"',
      ],
    ])('is refused %s', (_case, header, problem) => {
      expect(problems('', { header })).toContain(problem);
    });
  });

  it('allows the repository widget’s fetches in an inline script, and no other host', () => {
    const inline = (script: string): string => problems(`<script type="module">${script}</script>`);
    expect(inline(STAR_FETCH)).toBe('');
    expect(inline(STAR_FETCH.replace('api.github.com', 'example.com'))).toContain(
      'a script fetches from another host: https://example.com/repos/',
    );
    // JSON-LD is data, not a script: its addresses are the page's own metadata.
    const head = `${GOOD_HEAD}<script type="application/ld+json">{"url":"https://example.com/"}</script>`;
    expect(problemsOf('', { head })).toEqual([]);
  });

  it('keeps the 404 page out of search results', () => {
    const head = GOOD_HEAD.replace(/<link rel="canonical"[^>]*>/, '').replace(
      /<meta property="og:url"[^>]*>/,
      '',
    );
    const notFound = { h1: 'Not found', path: '/404.html' };
    expect(problemsOf('', { ...notFound, head: `${head}<meta name="robots" content="noindex">` })).toEqual(
      [],
    );
    const found = problems('', { ...notFound, head: GOOD_HEAD });
    expect(found).toContain('the 404 page is not marked noindex');
    expect(found).toContain('the 404 page names a canonical URL');
  });

  describe('the viewport meta tag: one, for phones, leaving zooming alone', () => {
    it('is accepted as width=device-width, initial-scale=1', () => {
      expect(problems('', { head: GOOD_HEAD })).toBe('');
    });

    it.each([
      ['missing', GOOD_HEAD.replace(VIEWPORT, ''), '0 viewport meta tags (one)'],
      ['given twice', `${GOOD_HEAD}${VIEWPORT}`, '2 viewport meta tags (one)'],
      [
        'at a fixed width',
        GOOD_HEAD.replace('width=device-width, ', 'width=1280, '),
        'not width=device-width, initial-scale=1',
      ],
      [
        'with a maximum scale',
        GOOD_HEAD.replace('initial-scale=1', 'initial-scale=1, maximum-scale=1'),
        'limits zooming',
      ],
      [
        'with user-scalable=no',
        GOOD_HEAD.replace('initial-scale=1', 'initial-scale=1,user-scalable=no'),
        'limits zooming',
      ],
    ])('is refused %s', (_case, head, problem) => {
      expect(problems('', { head })).toContain(problem);
    });
  });

  describe('tables in a keyboard-focusable scroll box, nothing wider than a phone inline', () => {
    const coverage = (content: string): string => problems(content, { h1: 'Coverage', path: '/coverage/' });
    const TABLE = '<table><tr><td>1</td></tr></table>';

    it.each([
      [
        'a table in a focusable .table-scroll box',
        `<div class="table-scroll" tabindex="0" data-astro-cid-x>\n  ${TABLE}</div>`,
      ],
      [
        'inline widths a 320-pixel phone holds',
        '<div style="width: 300px"></div><p style="min-width:20rem">x</p>',
      ],
    ])('accepts %s', (_case, content) => {
      expect(coverage(content)).toBe('');
    });

    it.each([
      ['a table on its own', TABLE, '1 table(s) not in a .table-scroll box'],
      [
        'a table in another box',
        `<div class="prose">${TABLE}</div>`,
        '1 table(s) not in a .table-scroll box',
      ],
      [
        'a scroll box without tabindex',
        `<div class="table-scroll">${TABLE}</div>`,
        'a .table-scroll box is not keyboard-focusable',
      ],
      [
        'an inline width wider than a phone',
        '<div style="color: red; width: 480px"></div>',
        'an inline width of 480px, wider than a 320-pixel phone',
      ],
      [
        'an inline min-width wider than a phone',
        '<pre tabindex="0" style="min-width: 30rem"><code>x</code></pre>',
        'an inline min-width of 30rem',
      ],
    ])('refuses %s', (_case, content, problem) => {
      expect(coverage(content)).toContain(problem);
    });
  });

  it('requires the footer notice on every page', () => {
    const withoutStatement = {
      path: '/x/',
      html: '<html lang="en"><head></head><body><h1>x</h1></body></html>',
    };
    expect(checkPage(withoutStatement).join('\n')).toContain('the footer lacks the footer notice');
  });
});

describe('scriptConnectionProblems', () => {
  it('allows the repository widget’s fetches of https://api.github.com/repos/…, minified or not, and the site’s own paths', () => {
    expect(scriptConnectionProblems(STAR_FETCH)).toEqual([]);
    expect(
      scriptConnectionProblems(
        "const response = await fetch(`https://api.github.com/repos/${slug}`, {\n  headers: { Accept: 'application/vnd.github+json' },\n  credentials: 'omit',\n});",
      ),
    ).toEqual([]);
    expect(scriptConnectionProblems('fetch("/sitemap.xml").then((r)=>r.text())')).toEqual([]);
    expect(
      scriptConnectionProblems(
        'const s=document.createElementNS("http://www.w3.org/2000/svg","svg");if(/^\\/\\//.test(a))b()',
      ),
    ).toEqual([]);
    expect(scriptConnectionProblems('')).toEqual([]);
  });

  it.each([
    [
      'a POST to another host',
      'fetch("https://example.com/collect",{method:"POST"})',
      'a script fetches from another host: https://example.com/collect',
    ],
    [
      'a protocol-relative address',
      "window.fetch('//cdn.example.com/x.json')",
      'a script fetches from another host: //cdn.example.com/x.json',
    ],
    [
      'GitHub over http',
      'fetch(`http://api.github.com/repos/${e}`,{credentials:`omit`})',
      'a script fetches from another host: http://api.github.com/repos/',
    ],
    [
      'a host that only starts like GitHub’s API',
      'fetch(`https://api.github.com.example.net/repos/${e}`,{credentials:`omit`})',
      'a script fetches from another host: https://api.github.com.example.net/repos/',
    ],
    [
      'another path of GitHub’s API',
      'fetch(`https://api.github.com/user`,{credentials:`omit`})',
      'a script fetches from another host: https://api.github.com/user',
    ],
    [
      'an address it does not write out',
      'let u=`https://api.github.com/repos/${e}`;fetch(u,{credentials:`omit`})',
      'a script fetches an address it does not write out: fetch(u,{credentials:`omit`})',
    ],
    [
      'the widget’s fetch without credentials',
      STAR_FETCH.replace('credentials:`omit`,', ''),
      "a script fetches https://api.github.com/repos/… without credentials: 'omit'",
    ],
    [
      'the widget’s fetch with credentials: include',
      STAR_FETCH.replace('credentials:`omit`', 'credentials:`include`'),
      "without credentials: 'omit'",
    ],
    [
      'the latest release’s fetch without credentials',
      STAR_FETCH.slice(0, STAR_FETCH.indexOf('/releases/latest')) +
        STAR_FETCH.slice(STAR_FETCH.indexOf('/releases/latest')).replace('credentials:`omit`,', ''),
      "a script fetches https://api.github.com/repos/… without credentials: 'omit'",
    ],
  ])('refuses %s', (_case, source, problem) => {
    expect(scriptConnectionProblems(source).join('\n')).toContain(problem);
  });

  // credentials: 'omit' counts only at the top level of the options, once, with nothing that could override it.
  it.each([
    [',{credentials:"omit"}', true],
    [", { 'credentials': 'omit', headers: { Accept: 'x' } }", true],
    [',{signal:AbortSignal.timeout(n),credentials:`omit`,}', true],
    // Nested: an inner object's credentials is not the request's.
    [',{credentials:`include`,x:{credentials:`omit`}}', false],
    [',{headers:{credentials:"omit"}}', false],
    // Twice: the last one wins in JavaScript.
    [',{credentials:"omit",credentials:"include"}', false],
    // A spread or a computed key could set it.
    [',{...o,credentials:"omit"}', false],
    [',{credentials:"omit",...o}', false],
    [',{[k]:"include",credentials:"omit"}', false],
    // Not written out, or not a plain 'omit'.
    [',options', false],
    ['', false],
    [',{credentials}', false],
    [',{credentials:c}', false],
    [',{credentials:`om${""}it`}', false],
    [',{credentials:"omit"+""}', false],
    [',{"credentials,x":"omit"}', false],
  ])("takes the star fetch's options «%s» as credentials: 'omit': %s", (options, taken) => {
    const found = scriptConnectionProblems(`fetch(\`https://api.github.com/repos/\${e}\`${options})`).join(
      '\n',
    );
    if (taken) expect(found).toBe('');
    else expect(found).toContain("without credentials: 'omit'");
  });

  describe('the page views sent to TelemetryDeck (docs/website.md, "Analytics")', () => {
    /** The SDK's request as the build minifies it (@telemetrydeck/sdk, `_post`), in the file that names its target. */
    const SDK_POST =
      'var i=class{target=`https://nom.telemetrydeck.com/v2/`;_post(e){let{target:t}=this;return fetch(t,{method:`POST`,mode:`cors`,headers:{"Content-Type":`application/json`},body:JSON.stringify(e)})}};export{i as default};';

    it('allows TelemetryDeck’s ingestion host by name, and nothing that only looks like it', () => {
      expect(ANALYTICS_PREFIX).toBe('https://nom.telemetrydeck.com/');
      expect(TELEMETRYDECK_TARGET.startsWith(ANALYTICS_PREFIX)).toBe(true);
      expect(
        scriptConnectionProblems(`var r=\`${TELEMETRYDECK_APP_ID}\`,i=\`${TELEMETRYDECK_TARGET}\`;`),
      ).toEqual([]);
      for (const host of [
        'https://nom.telemetrydeck.com.example.net/v2/',
        'https://telemetrydeck.com/v2/',
        'http://nom.telemetrydeck.com/v2/',
        'https://cdn.telemetrydeck.com/websdk/telemetrydeck.min.js',
      ]) {
        expect(scriptConnectionProblems(`var i=\`${host}\`;`).join('\n')).toContain(
          'a script names another host',
        );
      }
    });

    it('accepts the SDK’s own request, the one fetch whose address is a variable, as the build writes it', () => {
      expect(scriptConnectionProblems(SDK_POST)).toEqual([]);
      // A POST written out to the ingestion address is the same request.
      expect(
        scriptConnectionProblems(
          'fetch(`https://nom.telemetrydeck.com/v2/`,{method:`POST`,credentials:`omit`,body:b})',
        ),
      ).toEqual([]);
    });

    it('accepts the SDK as it is installed (its published file, without its comments, as the build writes it)', () => {
      const sdk = createRequire(import.meta.url).resolve('@telemetrydeck/sdk');
      const source = readFileSync(path.join(path.dirname(sdk), 'telemetrydeck.js'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      expect(source).toContain(TELEMETRYDECK_TARGET);
      expect(scriptConnectionProblems(source)).toEqual([]);
    });

    it.each([
      [
        'in a script that does not name the ingestion address',
        SDK_POST.replace('nom.telemetrydeck.com/v2/', ''),
      ],
      ['twice in one script', SDK_POST.replace('_post(e){', '_post(e){fetch(u,{method:`POST`});')],
      ['with credentials', SDK_POST.replace('mode:`cors`', 'credentials:`include`')],
      ['as a GET', SDK_POST.replace('method:`POST`', 'method:`GET`')],
      ['with options it does not write out', 'var i=`https://nom.telemetrydeck.com/v2/`;fetch(t,o)'],
      ['with an address it computes', 'var i=`https://nom.telemetrydeck.com/v2/`;fetch(i+e,{method:`POST`})'],
    ])('refuses a fetch with a variable for its address %s', (_case, source) => {
      expect(scriptConnectionProblems(source).join('\n')).toContain(
        'a script fetches an address it does not write out',
      );
    });

    it('refuses the ingestion address fetched other than as a POST without credentials', () => {
      expect(scriptConnectionProblems('fetch(`https://nom.telemetrydeck.com/v2/`)').join('\n')).toContain(
        'other than as a POST without credentials',
      );
      expect(
        scriptConnectionProblems(
          'fetch(`https://nom.telemetrydeck.com/v2/`,{method:`POST`,credentials:`include`})',
        ).join('\n'),
      ).toContain('other than as a POST without credentials');
      // sendBeacon stays refused, to this host too.
      expect(
        scriptConnectionProblems('navigator.sendBeacon(`https://nom.telemetrydeck.com/v2/`,b)').join('\n'),
      ).toContain('a script uses sendBeacon');
    });
  });

  it('refuses another host named anywhere in a script, and every other way to send a request', () => {
    const one = (source: string): string => scriptConnectionProblems(source).join('\n');
    expect(one('new Image().src="https://tracker.example.com/p.gif"')).toContain(
      'a script names another host: https://tracker.example.com',
    );
    expect(one('import("https://esm.example.com/lib.js")')).toContain(
      'a script names another host: https://esm.example.com',
    );
    expect(one('const host=`//cdn.example.com`')).toContain('a script names another host: //cdn.example.com');
    for (const api of ['XMLHttpRequest', 'WebSocket', 'EventSource', 'sendBeacon', 'importScripts']) {
      expect(one(`x=${api}`)).toContain(`a script uses ${api}`);
    }
    expect(one('new WebSocket("wss://socket.example.com")')).toContain(
      'a script names another host: wss://socket.example.com',
    );
  });
});

describe('cssAddresses (resources from another host in CSS)', () => {
  it.each([
    [
      '@font-face',
      '@font-face{font-family:X;src:url(https://fonts.example.com/x.woff2) format("woff2")}',
      'https://fonts.example.com/x.woff2',
    ],
    [
      'url() in single quotes',
      ".hero{background:url('//cdn.example.com/bg.png')}",
      '//cdn.example.com/bg.png',
    ],
    [
      'url() with spaces and double quotes',
      '.a{background-image:url( "http://img.example.com/a.png" )}',
      'http://img.example.com/a.png',
    ],
    ['@import of a string', '@import "https://css.example.com/a.css";', 'https://css.example.com/a.css'],
    ['@import url()', '@import url(//css.example.com/a.css);', '//css.example.com/a.css'],
    [
      'image-set()',
      '.b{background-image:image-set("https://img.example.com/b.avif" 1x)}',
      'https://img.example.com/b.avif',
    ],
  ])('finds the address on another host in %s', (_case, css, address) => {
    expect(cssAddresses(css)).toEqual([address]);
  });

  it('leaves the site’s own files, data: URLs (namespaces and base64 included) and comments alone', () => {
    expect(
      cssAddresses(
        [
          '@font-face{font-family:Roboto;src:url(/_astro/roboto-latin-400-normal.woff2) format("woff2")}',
          ".var{mask:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3C/svg%3E\")}",
          '.c{background:url(data:image/png;base64,//8AAAA//+/w==)}',
          ".d{background:url('data:image/gif;base64,R0lGOD//lhAQ==')}",
          '/* url(https://example.com/x.png) */ .e{grid-area:1/1/2/2;font:14px/1.5 Roboto}',
          '.f{background:url(./g.png)}',
        ].join(''),
      ),
    ).toEqual([]);
  });

  it('is applied to <style> blocks, style attributes and every srcset candidate of a page', () => {
    expect(
      problems('<style>@font-face{font-family:X;src:url(https://fonts.example.com/x.woff2)}</style>'),
    ).toContain('a <style> loads from another host: https://fonts.example.com/x.woff2');
    expect(problems('<div style="background:url(&quot;//cdn.example.com/a.png&quot;)"></div>')).toContain(
      'a style attribute loads from another host: //cdn.example.com/a.png',
    );
    expect(
      problems(
        '<img src="/a.png" srcset="/a.png 1x, https://img.example.com/a@2x.png 2x" alt="a" width="1" height="1">',
      ),
    ).toContain('<img srcset> loads from another host: https://img.example.com/a@2x.png');
    expect(
      problems('<picture><source srcset="/a.webp 720w, //img.example.com/b.webp 1440w"></picture>'),
    ).toContain('<source srcset> loads from another host: //img.example.com/b.webp');
    expect(problems('<video poster="https://img.example.com/p.jpg"></video>')).toContain(
      '<video poster> loads from another host',
    );
    expect(problems('<svg><image href="https://img.example.com/i.png"></image></svg>')).toContain(
      '<image href> loads from another host',
    );
    expect(
      problems(
        '<img src="/a.png" srcset="/_astro/a-720.webp 720w, /_astro/a-1440.webp 1440w" alt="a" width="1" height="1"><style>.x{background:url(/b.png)}</style><p style="color:red">x</p>',
      ),
    ).toBe('');
  });
});

describe('checkLegalLinks (the Impressum and the privacy notice on the maintainer’s website)', () => {
  const footer = (legal: string): string[] => problemsOf('', { legal });

  it('accepts both external links in the footer, as the footer writes them', () => {
    expect(footer(LEGAL_NAV)).toEqual([]);
  });

  it('refuses a page without them, with one twice, without noopener, or not named as external', () => {
    const [impressum, privacy] = LEGAL_LINKS;
    expect(footer('')).toEqual([
      `/docs/self-host/: 0 footer links to the Impressum at ${impressum?.href ?? ''} (one)`,
      `/docs/self-host/: 0 footer links to the Privacy at ${privacy?.href ?? ''} (one)`,
    ]);
    expect(footer(LEGAL_NAV + LEGAL_NAV).join('\n')).toContain('2 footer links to the Impressum');
    expect(footer(LEGAL_NAV.replace('rel="noopener" data-legal>Privacy', 'data-legal>Privacy'))).toEqual([
      '/docs/self-host/: the footer\'s Privacy link has no rel="noopener"',
    ]);
    expect(footer(LEGAL_NAV.replace(/<span class="visually-hidden">[^<]*<\/span>/g, ''))).toEqual([
      '/docs/self-host/: the footer\'s Impressum link is not named as an external site ("Impressum")',
      '/docs/self-host/: the footer\'s Privacy link is not named as an external site ("Privacy")',
    ]);
    // Only the footer counts: links elsewhere on the page do not stand in for it.
    const elsewhere: string[] = [];
    checkLegalLinks(`<main>${LEGAL_NAV}</main><footer></footer>`, (message) => elsewhere.push(message));
    expect(elsewhere).toHaveLength(2);
  });
});

describe('checkBrand (the favicon and the logo from brand/icon.svg)', () => {
  const source = readFileSync(path.join(repoRoot(), 'brand', 'icon.svg'), 'utf8');
  const ICON = '<link rel="icon" href="/favicon.svg" type="image/svg+xml">';
  const CSS =
    '@media (prefers-color-scheme:dark){.logo-shape[data-astro-cid-x1]{fill:var(--dark-fill);stroke:var(--dark-stroke);stroke-width:var(--dark-stroke-width)}}';
  const pages = [
    {
      path: '/',
      html: `<head>${ICON}</head><header>${logoMarkup(brandDrawing())}</header><footer>${logoMarkup(brandDrawing())}</footer>`,
    },
  ];

  it('accepts the build’s favicon and logos drawn from the source', () => {
    expect(checkBrand(pages, source, source, CSS)).toEqual([]);
  });

  it('refuses a favicon that is not the source, a logo of another drawing, no icon link, no dark rule', () => {
    const drawing = brandDrawing();
    const recoloured: Drawing = {
      ...drawing,
      shapes: drawing.shapes.map((shape, index) =>
        index === 1 ? { ...shape, dark: { ...shape.dark, fill: '#123456' } } : shape,
      ),
    };
    const moved: Drawing = {
      ...drawing,
      shapes: drawing.shapes.map((shape, index) => (index === 0 ? { ...shape, rx: '8' } : shape)),
    };
    expect(
      checkBrand(
        [
          { path: '/a/', html: `<header>${logoMarkup(recoloured)}</header>` },
          { path: '/b/', html: `<head>${ICON}</head><header>${logoMarkup(moved)}</header>` },
          { path: '/c/', html: `<head>${ICON}</head><p>no logo</p>` },
        ],
        source.replace('#1a73e8', '#1a73e9'),
        source,
        '',
      ),
    ).toEqual([
      'favicon.svg is not brand/icon.svg as it is',
      '/a/: 0 icon links (one, to /favicon.svg)',
      "/a/: the logo is not the favicon's drawing: shape 2, dark: fill #123456, not #1c3a5e",
      "/b/: the logo is not the favicon's drawing: shape 1: rx 8, not 9",
      '/c/: no logo (<svg class="logo">)',
      'no stylesheet gives the logo its dark colours (.logo-shape under prefers-color-scheme: dark)',
    ]);
    expect(checkBrand(pages, undefined, source, CSS)).toEqual([
      'favicon.svg is missing (the build copies brand/icon.svg)',
    ]);
  });
});

describe('keepsMediaInBox', () => {
  it('finds the rule that keeps images and videos within their box, minified or not', () => {
    expect(keepsMediaInBox('a{color:red}img,video,svg{max-width:100%;height:auto;display:block}')).toBe(true);
    expect(keepsMediaInBox('img,\nvideo {\n  display: block;\n  max-width: 100%;\n}')).toBe(true);
    expect(keepsMediaInBox('img{max-width:100%}')).toBe(false);
    expect(keepsMediaInBox('img,video{max-width:1440px}')).toBe(false);
    expect(keepsMediaInBox('@media (min-width:40rem){img,video{max-width:100%}}')).toBe(false);
    expect(keepsMediaInBox('/* img,video{max-width:100%} */ p{margin:0}')).toBe(false);
  });
});

describe('timelineShorthands (scroll-driven animations as longhands)', () => {
  it('finds an animation shorthand that names a scroll or view timeline, as the minifier writes it', () => {
    expect(
      timelineShorthands(
        '.site-header{animation:header-scrolled linear both scroll(root);animation-range:0 4rem}',
      ),
    ).toEqual(['animation:header-scrolled linear both scroll(root)']);
    expect(timelineShorthands('.x { animation: fade 1s view(block) }')).toEqual([
      'animation: fade 1s view(block)',
    ]);
  });

  it('accepts the longhands, a shorthand without a timeline, and comments', () => {
    expect(
      timelineShorthands(
        '.site-header{animation-name:header-scrolled;animation-timing-function:linear;animation-fill-mode:both;animation-duration:auto;animation-timeline:scroll(root);animation-range:0 4rem}',
      ),
    ).toEqual([]);
    expect(timelineShorthands('.menu{animation:menu-enter .3s cubic-bezier(.05,.7,.1,1)}')).toEqual([]);
    expect(timelineShorthands('/* animation: x scroll(root) */ p{margin:0}')).toEqual([]);
    expect(timelineShorthands('.x{--animation:x scroll(root)}')).toEqual([]);
  });
});

describe('checkLinks', () => {
  it('finds internal links and anchors that do not resolve', () => {
    const pages = [
      {
        path: '/',
        html: '<a href="/docs/">docs</a><a href="/docs/#missing">x</a><a href="/nowhere/">y</a><a href="https://example.com/">ok</a>',
      },
      {
        path: '/docs/',
        html: '<h2 id="start">Start</h2><a href="#start">s</a><a href="../licenses/roboto-LICENSE.txt">l</a>',
      },
    ];
    const problems = checkLinks(pages, (urlPath) => urlPath === '/licenses/roboto-LICENSE.txt');
    expect(problems).toEqual([
      '/: a link to /docs/#missing whose anchor is not on the page',
      '/: a link to /nowhere/ that does not resolve',
    ]);
  });

  it('finds links into the repository that name no file or folder of it', () => {
    const blob = `${REPOSITORY_URL}/blob/main`;
    const tree = `${REPOSITORY_URL}/tree/main`;
    const pages = [
      {
        path: '/docs/faq/',
        html: [
          `<a href="${blob}/docs/packages.md#data-flow">packages</a>`,
          `<a href="${tree}/docs/media">media</a>`,
          `<a href="${tree}/infra/">infra</a>`,
          `<a href="${blob}/docs/gone.md">gone</a>`,
          `<a href="${blob}/docs/gone.md">the same link again</a>`,
          `<a href="${tree}/docs/nowhere">nowhere</a>`,
          `<a href="${blob}/../outside.md">outside</a>`,
          `<a href="${REPOSITORY_URL}/issues">issues</a>`,
          `<a href="${REPOSITORY_URL}/releases">releases</a>`,
          `<a href="${tree}/">the repository</a>`,
        ].join(''),
      },
    ];
    const existing = new Set(['docs/packages.md', 'docs/media', 'infra']);
    expect(checkRepositoryLinks(pages, (repoPath) => existing.has(repoPath))).toEqual([
      `/docs/faq/: a link to ${blob}/docs/gone.md, which names no file or folder of the repository`,
      `/docs/faq/: a link to ${tree}/docs/nowhere, which names no file or folder of the repository`,
      `/docs/faq/: a link to ${blob}/../outside.md, which names no file or folder of the repository`,
    ]);
  });

  it('maps built files to their URL paths', () => {
    expect(urlPathOf('index.html')).toBe('/');
    expect(urlPathOf('docs/self-host/index.html')).toBe('/docs/self-host/');
    expect(urlPathOf('404.html')).toBe('/404.html');
  });
});

describe('checkExports', () => {
  const svg = (lines: readonly string[], desc: string, extra = ''): Buffer =>
    Buffer.from(
      `<svg width="10" height="10"><title>gcportrait diagram of example.com, Overview lens</title><desc>${desc}</desc>${lines.map((line) => `<text x="0" y="0">${line}</text>`).join('')}${extra}</svg>`,
    );
  // The title block's three lines and the <desc> of an export: no affiliation line (a drawing never carries one).
  const titleBlock = [
    'example.com',
    'Overview lens · read 2026-10-08T00:00:00+00:00',
    'gcportrait.app - Visualize your Google Cloud Infrastructure',
  ];
  const desc = 'example.com, Overview lens, read 2026-10-08T00:00:00+00:00. Drawn with gcportrait.';
  const good = svg(titleBlock, desc);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  /** A draw.io file whose labels are `lines`, compressed as diagrams.net saves it unless `plain`. */
  const drawio = (lines: readonly string[], plain = false, style = 'text;html=1;'): Buffer => {
    const font = encodeURIComponent('https://fonts.googleapis.com/css2?family=Roboto');
    const cells = lines
      .map(
        (line, index) =>
          `<mxCell id="t${String(index)}" value="&lt;div&gt;${line}&lt;/div&gt;" style="${style}fontSource=${font};" vertex="1" parent="3"/>`,
      )
      .join('');
    const model = `<mxGraphModel background="#ffffff"><root><mxCell id="0"/>${cells}</root></mxGraphModel>`;
    const body = plain ? model : deflateRawSync(encodeURIComponent(model)).toString('base64');
    return Buffer.from(`<mxfile host="gcportrait"><diagram id="d" name="n">${body}</diagram></mxfile>\n`);
  };
  const goodDrawio = drawio(titleBlock);
  const files: Record<string, Buffer> = {
    '/_astro/S-light.png': png,
    '/_astro/S-light.svg': good,
    '/_astro/S-light.drawio': goodDrawio,
    '/_astro/S-dark.png': png,
    '/_astro/S-dark.svg': good,
    '/_astro/S-dark.drawio': goodDrawio,
  };
  const open = (file: string): string =>
    `https://app.diagrams.net/?url=${encodeURIComponent(`https://gcportrait.app${file}`)}`;
  const links = (theme: string): string =>
    [
      `<a data-export="png" href="/_astro/S-${theme}.png" download="gcportrait-demo-S-${theme}.png" aria-label="Download PNG (1 kB), S, ${theme} theme">Download PNG <span>(1 kB)</span></a>`,
      `<a data-export="svg" href="/_astro/S-${theme}.svg" download="gcportrait-demo-S-${theme}.svg">Download SVG</a>`,
      `<a data-export="svg-open" href="/_astro/S-${theme}.svg">Open SVG</a>`,
      `<a data-export="drawio" href="/_astro/S-${theme}.drawio" download="gcportrait-demo-S-${theme}.drawio">Download draw.io</a>`,
      `<a data-export="drawio-open" href="${open(`/_astro/S-${theme}.drawio`)}" target="_blank" rel="noopener" aria-label="Open in diagrams.net, S, ${theme} theme (opens in a new tab)">Open in diagrams.net</a>`,
    ].join('');
  const exportsPage = { path: '/exports/', html: `${links('light')}${links('dark')}` };

  it('accepts links to the build’s own PNGs, SVGs and draw.io files, and diagrams.net opening them', () => {
    expect(exportSvgProblems(good.toString())).toEqual([]);
    expect(exportDrawioProblems(goodDrawio.toString())).toEqual([]);
    expect(checkExports([exportsPage, { path: '/', html: links('light') }], (file) => files[file])).toEqual(
      [],
    );
  });

  it('refuses another host, a missing file, a download without its name, an SVG with an affiliation line', () => {
    const page = {
      path: '/',
      html: [
        '<a data-export="png" href="https://example.org/S.png" download="x.png">PNG</a>',
        '<a data-export="png" href="/_astro/gone.png" download="gone.png">PNG</a>',
        '<a data-export="svg" href="/_astro/S-light.svg">SVG</a>',
        '<a data-export="svg-open" href="/_astro/bare.svg" download="bare.svg">Open</a>',
      ].join(''),
    };
    const bare = svg(
      [...titleBlock, EXPORT_DISCLAIMER],
      `${desc} ${EXPORT_DISCLAIMER}`,
      '<image href="https://example.org/i.png"/>',
    );
    expect(
      checkExports([exportsPage, page], (file) => (file === '/_astro/bare.svg' ? bare : files[file])),
    ).toEqual([
      '/: export link https://example.org/S.png (png): not a file of the site itself',
      '/: export link /_astro/gone.png (png): not in the build',
      '/: export link /_astro/S-light.svg (svg): has no download name ending in .svg',
      '/: export link /_astro/bare.svg (svg-open): downloads the SVG instead of opening it',
      `/: export link /_astro/bare.svg (svg-open): its title block carries the affiliation line "${EXPORT_DISCLAIMER}"`,
      '/: export link /_astro/bare.svg (svg-open): its <desc> states an affiliation',
      '/: export link /_astro/bare.svg (svg-open): it loads something from another host',
    ]);
  });

  it('finds the line in the <title>, as an entity, elsewhere in the file, and any other affiliation sentence, the long form included', () => {
    const problems = (lines: readonly string[], text: string, extra = ''): string[] =>
      exportSvgProblems(svg(lines, text, extra).toString());
    expect(problems(titleBlock, desc)).toEqual([]);
    expect(
      exportSvgProblems(
        good.toString().replace('Overview lens</title>', `Overview lens. ${EXPORT_DISCLAIMER}</title>`),
      ),
    ).toEqual(['its <title> states an affiliation']);
    expect(problems([...titleBlock, 'Not affiliated with Google &#x2F; Google Cloud.'], desc)).toEqual([
      `its title block carries the affiliation line "${EXPORT_DISCLAIMER}"`,
    ]);
    expect(problems(titleBlock, desc, `<!-- ${EXPORT_DISCLAIMER} -->`)).toEqual([
      'it states an affiliation outside its title block, <title> and <desc>',
    ]);
    expect(problems(titleBlock, `${desc} Not affiliated with Google in any way.`)).toEqual([
      'its <desc> states an affiliation',
    ]);
    expect(problems(titleBlock, `${desc} ${NON_AFFILIATION_LONG.replace(/'/g, '&#39;')}`)).toEqual([
      'its <desc> states an affiliation',
    ]);
  });

  it('requires the /exports/ page with a PNG, an SVG, a draw.io file and a diagrams.net link of each theme', () => {
    expect(checkExports([], (file) => files[file])).toEqual([
      '/exports/: the sample exports page was not built',
    ]);
    expect(checkExports([{ path: '/exports/', html: links('light') }], (file) => files[file])).toEqual([
      '/exports/: no PNG of the dark theme to download',
      '/exports/: no SVG of the dark theme to download',
      '/exports/: no draw.io file of the dark theme to download',
      '/exports/: no "Open in diagrams.net" link of the dark theme',
    ]);
  });

  it('wants a draw.io file compressed, readable, without an affiliation line, naming only the fonts’ stylesheet', () => {
    expect(exportDrawioProblems(drawio(titleBlock, true).toString())).toEqual([
      'its diagram is plain XML, not compressed as diagrams.net saves it',
    ]);
    expect(exportDrawioProblems(drawio([...titleBlock, EXPORT_DISCLAIMER]).toString())).toEqual([
      'a label states an affiliation',
    ]);
    expect(
      exportDrawioProblems(
        drawio(titleBlock, false, 'shape=image;image=https://example.org/i.png;').toString(),
      ),
    ).toEqual(['it names another address: https://example.org/i.png']);
    expect(exportDrawioProblems('<svg/>')).toEqual(['not a draw.io file with one diagram']);
    expect(exportDrawioProblems('<mxfile><diagram>%%%</diagram></mxfile>')).toEqual([
      'its diagram does not inflate as diagrams.net reads it',
    ]);
  });

  it('opens in diagrams.net only a draw.io file of the site, in a new tab that says so; links the host freely', () => {
    expect(diagramsNetFile(open('/_astro/S-light.drawio'))).toBe('/_astro/S-light.drawio');
    expect(
      diagramsNetFile('https://app.diagrams.net/?url=https://gcportrait.app/_astro/S-light.drawio'),
    ).toBeNull();
    expect(diagramsNetFile(open('/_astro/S-light.svg'))).toBeNull();
    expect(
      diagramsNetFile(`https://app.diagrams.net/?url=${encodeURIComponent('https://example.org/S.drawio')}`),
    ).toBeNull();
    const page = {
      path: '/',
      html: [
        `<a data-export="drawio-open" href="${open('/_astro/S-light.drawio')}">Open in diagrams.net</a>`,
        `<a data-export="drawio-open" href="${open('/_astro/gone.drawio')}" target="_blank" rel="noopener">Open (opens in a new tab)</a>`,
        `<a data-export="drawio-open" href="https://example.org/" target="_blank" rel="noopener">Open (opens in a new tab)</a>`,
        '<a href="https://app.diagrams.net/">diagrams.net</a>',
        '<a href="https://app.diagrams.net/?url=https%3A%2F%2Fexample.org%2Fx.drawio">a file</a>',
      ].join(''),
    };
    expect(checkExports([exportsPage, page], (file) => files[file])).toEqual([
      '/: export link https://app.diagrams.net/?url=https%3A%2F%2Fgcportrait.app%2F_astro%2FS-light.drawio (drawio-open): does not open a new tab (target="_blank")',
      '/: export link https://app.diagrams.net/?url=https%3A%2F%2Fgcportrait.app%2F_astro%2FS-light.drawio (drawio-open): has no rel="noopener"',
      '/: export link https://app.diagrams.net/?url=https%3A%2F%2Fgcportrait.app%2F_astro%2FS-light.drawio (drawio-open): does not say in its name that it opens a new tab ("(opens in a new tab)")',
      '/: export link https://app.diagrams.net/?url=https%3A%2F%2Fgcportrait.app%2F_astro%2Fgone.drawio (drawio-open): not in the build',
      '/: export link https://example.org/ (drawio-open): not https://app.diagrams.net/?url= with the address of a draw.io file on https://gcportrait.app',
      '/: a link that opens a file in diagrams.net outside the exports\' "Open in diagrams.net" links: https://app.diagrams.net/?url=https%3A%2F%2Fexample.org%2Fx.drawio',
    ]);
  });

  it('names each link as the browsers do: what it shows first, and no space before a punctuation mark', () => {
    // A visually hidden span is absolutely placed, so the browsers read it as a block, with a space before it.
    expect(linkName({}, 'Open SVG\n  <span class="visually-hidden">, S, light theme</span>\n')).toBe(
      'Open SVG , S, light theme',
    );
    expect(linkName({}, 'Open the demo<span class="visually-hidden"> (opens in a new tab)</span>')).toBe(
      'Open the demo (opens in a new tab)',
    );
    expect(linkName({ 'aria-label': 'Open SVG, S, light theme' }, 'Open SVG')).toBe(
      'Open SVG, S, light theme',
    );
    const page = {
      path: '/',
      html: [
        '<a data-export="svg-open" href="/_astro/S-light.svg">Open SVG<span class="visually-hidden">, S, light theme</span></a>',
        '<a data-export="svg-open" href="/_astro/S-light.svg" aria-label="SVG, S, light theme">Open SVG</a>',
        '<a data-export="svg-open" href="/_astro/S-light.svg" aria-label="Open SVG , S, light theme">Open SVG</a>',
      ].join(''),
    };
    expect(checkExports([exportsPage, page], (file) => files[file])).toEqual([
      '/: export link /_astro/S-light.svg (svg-open): its name "Open SVG , S, light theme" has a space before ","',
      '/: export link /_astro/S-light.svg (svg-open): its name "SVG, S, light theme" does not begin with the text it shows, "Open SVG"',
      '/: export link /_astro/S-light.svg (svg-open): its name "Open SVG , S, light theme" has a space before ","',
    ]);
  });
});

describe('checkDemoLinks (every "Try the demo" link goes to /demo/, in a new tab)', () => {
  const found = (html: string, pageUrl?: string): string[] => {
    const problems: string[] = [];
    checkDemoLinks(html, (message) => problems.push(message), pageUrl);
    return problems;
  };
  const NOTE = '<span class="visually-hidden"> (opens in a new tab)</span>';
  /** A link to the demo as src/components/DemoLink.astro writes it. */
  const demoLink = (text: string, href = '/demo/'): string =>
    `<a class="button" href="${href}" target="_blank" rel="noopener">${text}${NOTE}</a>`;

  it('accepts links to /demo/ that open a new tab and say so, in a page or a guide', () => {
    expect(found(`${demoLink('Try the demo')} ${demoLink('Open the demo')} ${demoLink('demo')}`)).toEqual([]);
    expect(found(demoLink('https://gcportrait.app/demo/', 'https://gcportrait.app/demo/'))).toEqual([]);
    expect(found(demoLink('a view', 'https://gcportrait.app/demo/diagram'))).toEqual([]);
    // Other links of the site, and other sites' demos, are left as they are.
    expect(found('<a href="/docs/">Docs</a><a href="https://example.com/demo/">theirs</a>')).toEqual([]);
  });

  it('refuses any other target or a demo host', () => {
    expect(
      found(
        '<a href="https://demo.gcportrait.app">Try the demo</a><a href="https://demo.example.com/x">a demo</a>',
      ),
    ).toEqual([
      'the "Try the demo" link goes to https://demo.gcportrait.app, not /demo/',
      'a link to a demo host: https://demo.gcportrait.app',
      'a link to a demo host: https://demo.example.com/x',
    ]);
    expect(found(demoLink('Open the demo', '/demo'))).toEqual([
      'the "Open the demo (opens in a new tab)" link goes to /demo, not /demo/',
    ]);
  });

  it('refuses a link to the demo that opens in the same tab, without noopener, or without saying so', () => {
    expect(found('<a class="button" href="/demo/">Try the demo</a>')).toEqual([
      'the "Try the demo" link to /demo/ does not open a new tab (target="_blank")',
      'the "Try the demo" link to /demo/ has no rel="noopener"',
      'the "Try the demo" link to /demo/ does not say it opens a new tab ("(opens in a new tab)", visually hidden)',
    ]);
    expect(found(demoLink('demo').replace(' rel="noopener"', ''))).toEqual([
      'the "demo (opens in a new tab)" link to /demo/ has no rel="noopener"',
    ]);
    expect(
      found('<a href="https://gcportrait.app/demo/diagram" target="_blank" rel="noopener">a view</a>'),
    ).toEqual([
      'the "a view" link to https://gcportrait.app/demo/diagram does not say it opens a new tab ("(opens in a new tab)", visually hidden)',
    ]);
    // A relative link is resolved against the page it is on.
    expect(found('<a href="../demo/">the demo</a>', 'https://gcportrait.app/docs/').join('\n')).toContain(
      'does not open a new tab',
    );
  });
});

describe('checkStartLinks (the Cloud Shell and Cloud Run buttons, in a new tab)', () => {
  const found = (html: string, landing = false): string[] => {
    const problems: string[] = [];
    checkStartLinks(html, (message) => problems.push(message), landing);
    return problems;
  };
  const NOTE = '<span class="visually-hidden"> (opens in a new tab)</span>';
  const MARK = '<svg class="start-mark" viewBox="0 0 16 16" aria-hidden="true"><path d="M1 1h14"/></svg>';
  const SHELL = startButton(CLOUD_SHELL_URL, 'Open in Cloud Shell');
  const RUN = startButton(CLOUD_RUN_BUTTON_URL, 'Run on Google Cloud');

  it('accepts both buttons in a new tab with their mark, and the hero offering both', () => {
    expect(found(`${LANDING_HERO}<section>${SHELL}${RUN}</section>`, true)).toEqual([]);
    // A guide's link to either address is text, not a button.
    expect(
      found(`<p><a href="${CLOUD_SHELL_URL.replace(/&/g, '&amp;')}">Open in Cloud Shell</a></p>`),
    ).toEqual([]);
  });

  it('refuses a button in the same tab, without noopener, without the note or with an image for its mark', () => {
    expect(found(SHELL.replace(' target="_blank"', '').replace(' rel="noopener"', ''))).toEqual([
      'the "Open in Cloud Shell" button does not open a new tab (target="_blank")',
      'the "Open in Cloud Shell" button has no rel="noopener"',
    ]);
    expect(
      found(RUN.replace(NOTE, '').replace(MARK, '<img src="https://deploy.cloud.run/button.svg" alt="">')),
    ).toEqual([
      'the "Run on Google Cloud" button reads "Run on Google Cloud"',
      'the "Run on Google Cloud" button does not say it opens a new tab ("(opens in a new tab)", visually hidden)',
      'the "Run on Google Cloud" button does not draw its mark inline (<svg>, no <img>)',
    ]);
  });

  it('requires the landing page’s hero to offer each once', () => {
    expect(
      found(
        `<section class="hero"><a class="button" href="/docs/self-host/">Self-host</a>${SHELL}</section>${RUN}`,
        true,
      ),
    ).toEqual(['0 "Run on Google Cloud" buttons in the hero (one)']);
  });
});

describe('checkFooterNotice and checkLandingStatement (footers and long-form texts only)', () => {
  const found = (check: typeof checkFooterNotice, html: string): string[] => {
    const problems: string[] = [];
    check(html, (message) => problems.push(message));
    return problems;
  };
  const LONG = `<p>${NON_AFFILIATION_LONG.replace(/'/g, '&#39;')}</p>`;
  const AUTHOR = `<section class="section" aria-labelledby="author"><h2 id="author">About the author</h2>${LONG}</section>`;

  it('accepts the footer notice with the maintainer’s name linked', () => {
    expect(found(checkFooterNotice, `<footer>${FOOTER_NOTICE_HTML}</footer>`)).toEqual([]);
  });

  it('refuses a footer without it, with the long form instead, or with the name not linked', () => {
    expect(found(checkFooterNotice, `<footer>${LONG}</footer>`)).toEqual([
      `the footer lacks the footer notice "${FOOTER_NOTICE_LEAD}${MAINTAINER_NAME}."`,
    ]);
    expect(
      found(checkFooterNotice, `<footer><p>${FOOTER_NOTICE_LEAD}${MAINTAINER_NAME}.</p></footer>`),
    ).toEqual([`the footer notice does not link ${MAINTAINER_NAME} to ${MAINTAINER_URL}`]);
    expect(found(checkFooterNotice, `<main>${FOOTER_NOTICE_HTML}</main><footer></footer>`)).toHaveLength(1);
  });

  it('keeps the long form in the landing page’s author section and out of every other section', () => {
    expect(
      found(checkLandingStatement, `<main>${AUTHOR}<section><h2 id="try">Try</h2></section></main>`),
    ).toEqual([]);
    expect(
      found(
        checkLandingStatement,
        `<main>${AUTHOR}<section aria-labelledby="try"><h2 id="try">See your own environment</h2>${LONG}</section></main>`,
      ),
    ).toEqual([
      'the non-affiliation long form appears 1 time(s) outside the author section (the footers and the author section only)',
    ]);
    expect(found(checkLandingStatement, `<main><section aria-labelledby="author"></section></main>`)).toEqual(
      ["the author section lacks the long-form statement (docs/author.md's closing paragraph)"],
    );
    // The footer is the footer notice's place, not the long form's; this check leaves it to checkFooterNotice.
    expect(found(checkLandingStatement, `<main>${AUTHOR}</main><footer>${LONG}</footer>`)).toEqual([]);
  });
});

describe('checkDemo (the static demo at /demo/)', () => {
  const BOOTSTRAP = "<script>document.documentElement.setAttribute('data-theme', 'light');</script>";
  const policy = (extra = ''): string =>
    Object.entries({
      ...DEMO_POLICY,
      'script-src': [...(DEMO_POLICY['script-src'] ?? []), ...inlineScriptSources(BOOTSTRAP)],
    })
      .map(([name, values]) => [name, ...values].join(' '))
      .join('; ') + extra;
  const index = (head = ''): string =>
    `<!doctype html><html lang="en"><head><meta charset="UTF-8" /><meta http-equiv="Content-Security-Policy" content="${policy()}" /><meta name="referrer" content="no-referrer" />${BOOTSTRAP}<script type="module" crossorigin src="/demo/assets/index-1.js"></script><link rel="stylesheet" crossorigin href="/demo/assets/index-1.css"><link rel="icon" href="/demo/favicon.svg" type="image/svg+xml">${head}</head><body><div id="root"></div></body></html>`;
  const ICON = '<svg viewBox="0 0 48 48"><rect/></svg>';
  const APP = `const config={impressumUrl:"${IMPRESSUM_URL}",privacyUrl:"${PRIVACY_URL}",sourceUrl:"${REPOSITORY_URL}"};`;

  function files(overrides: Record<string, string | undefined> = {}): {
    files: string[];
    read: (file: string) => string | undefined;
  } {
    const html = index();
    const all: Record<string, string | undefined> = {
      'index.html': html,
      ...Object.fromEntries(DEMO_ROUTES.map((route) => [`${route}.html`, html])),
      'assets/index-1.js': APP,
      'assets/index-1.css': 'body{}',
      'favicon.svg': ICON,
      'licenses/gcportrait-LICENSE.txt': 'MIT License',
      'licenses/THIRD_PARTY_NOTICES.txt': 'notices',
      ...overrides,
    };
    return {
      files: Object.keys(all).filter((file) => all[file] !== undefined),
      read: (file) => all[file],
    };
  }

  it('accepts the bundle the build writes', () => {
    expect(checkDemo(files(), ICON)).toEqual([]);
  });

  it('requires the demo, every route copy, the favicon and the licences', () => {
    expect(checkDemo(files({ 'index.html': undefined }), ICON)).toEqual([
      '/demo/: no static demo (index.html; the build runs `pnpm demo:static`, astro.config.ts)',
    ]);
    expect(
      checkDemo(
        files({
          'settings.html': undefined,
          'diagram.html': '<html></html>',
          'favicon.svg': '<svg/>',
          'licenses/THIRD_PARTY_NOTICES.txt': undefined,
        }),
        ICON,
      ),
    ).toEqual([
      '/demo/: diagram.html is not a copy of index.html',
      "/demo/: no settings.html (the settings route's copy of index.html)",
      '/demo/: favicon.svg is not brand/icon.svg as it is',
      '/demo/: licenses/THIRD_PARTY_NOTICES.txt is missing',
    ]);
  });

  it('requires the demo-only policy, first, with the inline script’s hash and no host', () => {
    const page = (html: string) => {
      const view = files({ 'index.html': html });
      return checkDemo(
        { files: view.files, read: (file) => (file.endsWith('.html') ? html : view.read(file)) },
        ICON,
      );
    };
    expect(
      page(index().replace("connect-src 'self'", "connect-src 'self' https://accounts.google.com/gsi/")),
    ).toEqual([
      `/demo/: the policy's connect-src is "'self' https://accounts.google.com/gsi/", not "'self'"`,
      '/demo/: index.html names accounts.google.com',
    ]);
    expect(page(index().replace(BOOTSTRAP, '<script>other()</script>'))[0]).toMatch(
      /the policy's script-src is/,
    );
    expect(page(index().replace(/<meta http-equiv[^>]*>/, ''))).toEqual([
      '/demo/: 0 Content Security Policy <meta> elements (one)',
    ]);
    expect(page(index().replace('<meta name="referrer" content="no-referrer" />', ''))).toEqual([
      '/demo/: no <meta name="referrer" content="no-referrer"> (the backend\'s Referrer-Policy)',
    ]);
    expect(
      page(index().replace(`content="${policy()}"`, `content="${policy("; frame-ancestors 'none'")}"`)),
    ).toEqual(['/demo/: the policy has frame-ancestors, which the demo-only policy does not']);
    expect(
      page(
        index().replace(
          '<meta charset="UTF-8" />',
          '<meta charset="UTF-8" /><link rel="preload" href="/demo/assets/index-1.css">',
        ),
      ),
    ).toEqual(['/demo/: the page loads or runs something before its policy <meta>']);
  });

  it('refuses a load from another host or outside /demo/, a sign-in host anywhere, a footer without its links', () => {
    const html = index(
      '<script src="https://accounts.google.com/gsi/client"></script><link rel="stylesheet" href="/_astro/site.css">',
    );
    const view = files({
      'assets/index-1.js': 'fetch("/api/config")',
      'assets/index-1.css': '@import url(https://fonts.example.com/x.css);',
    });
    expect(
      checkDemo(
        { files: view.files, read: (file) => (file.endsWith('.html') ? html : view.read(file)) },
        ICON,
      ),
    ).toEqual([
      '/demo/: loads from another host: https://accounts.google.com/gsi/client',
      '/demo/: loads /_astro/site.css, outside /demo/',
      '/demo/: index.html names accounts.google.com',
      '/demo/: assets/index-1.css loads from another host: https://fonts.example.com/x.css',
      `/demo/: no script of the demo carries ${IMPRESSUM_URL} for its footer`,
      `/demo/: no script of the demo carries ${PRIVACY_URL} for its footer`,
      `/demo/: no script of the demo carries ${REPOSITORY_URL} for its footer`,
    ]);
  });

  it('refuses the site’s analytics anywhere in the demo: the app never sends any', () => {
    const view = files({
      'assets/index-1.js': `${APP}import("./telemetrydeck.js")`,
      'assets/chunk.js': `var r="${TELEMETRYDECK_APP_ID}";`,
      'licenses/THIRD_PARTY_NOTICES.txt': '@telemetrydeck/sdk 2.0.4 MIT',
    });
    expect(checkDemo(view, ICON)).toEqual([
      '/demo/: assets/index-1.js names TelemetryDeck (the demo is the app, which sends no analytics)',
      '/demo/: licenses/THIRD_PARTY_NOTICES.txt names TelemetryDeck (the demo is the app, which sends no analytics)',
      '/demo/: assets/chunk.js names TelemetryDeck (the demo is the app, which sends no analytics)',
    ]);
  });
});

describe('checkInstaller (the one-line installer at /install.sh)', () => {
  const source = readFileSync(path.join(repoRoot(), INSTALLER_SOURCE));
  const robots =
    'User-agent: *\nAllow: /\nDisallow: /install.sh\n\nSitemap: https://gcportrait.app/sitemap.xml\n';
  const sitemap = '<urlset><url><loc>https://gcportrait.app/</loc></url></urlset>';

  it('accepts infra/install.sh as it is, served the way GitHub Pages serves a .sh file, kept out of search', () => {
    // What the preview server and GitHub Pages send for .sh is accepted: curl takes any type.
    expect(CONTENT_TYPES['.sh']).toBe('application/x-sh');
    expect(checkInstaller(Buffer.from(source), source, CONTENT_TYPES['.sh'], robots, sitemap)).toEqual([]);
    for (const type of INSTALLER_TYPES)
      expect(checkInstaller(source, source, `${type}; charset=utf-8`, robots, sitemap)).toEqual([]);
  });

  it('refuses a missing or changed copy, another type, a sitemap entry and a robots.txt that lets it in', () => {
    const changed = Buffer.concat([source, Buffer.from('\necho extra\n')]);
    expect(checkInstaller(undefined, source, 'text/plain', robots, sitemap)).toEqual([
      'install.sh is missing (the build copies infra/install.sh)',
    ]);
    expect(checkInstaller(changed, source, 'text/plain', robots, sitemap)).toEqual([
      'install.sh is not infra/install.sh byte for byte',
    ]);
    expect(checkInstaller(source, source, 'application/octet-stream', robots, sitemap)).toEqual([
      'install.sh would be served as application/octet-stream, not as one of text/x-shellscript, text/plain, application/x-sh',
    ]);
    expect(
      checkInstaller(
        source,
        source,
        undefined,
        'User-agent: *\nAllow: /\n',
        '<urlset><url><loc>https://gcportrait.app/install.sh</loc></url></urlset>',
      ),
    ).toEqual([
      'install.sh would be served as no known type, not as one of text/x-shellscript, text/plain, application/x-sh',
      'robots.txt does not keep /install.sh out (Disallow)',
      'sitemap.xml lists /install.sh, which is no page',
    ]);
  });

  it('is never a copy in public/: the build copies the one source', () => {
    expect(existsSync(path.join(repoRoot(), 'website', 'public', 'install.sh'))).toBe(false);
  });
});
