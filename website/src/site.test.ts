// SPDX-License-Identifier: MIT
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  EXPORT_DISCLAIMER,
  FOOTER_NOTICE,
  FOOTER_NOTICE_LEAD,
  INSTALLER_URL,
  INSTALL_COMMAND,
  LEGAL_LINKS,
  MAINTAINER_NAME,
  MAINTAINER_URL,
  NON_AFFILIATION_LONG,
  RELEASES_URL,
  REPOSITORY_URL,
  SITE_URL,
  repositoryFileUrl,
  siteUrl,
} from './site.js';

const REPO = path.resolve(import.meta.dirname, '..', '..');

/** A `export const NAME = ...;` declaration of a TypeScript file, its string literals joined. */
function constantOf(file: string, name: string): string {
  const source = readFileSync(path.join(REPO, file), 'utf8');
  const declaration = new RegExp(`export const ${name}\\s*=([^;]+);`).exec(source)?.[1] ?? '';
  return [...declaration.matchAll(/'([^']*)'|"([^"]*)"/g)].map((m) => m[1] ?? m[2] ?? '').join('');
}

describe('the non-affiliation wording and the repository', () => {
  it('keeps the long form equal to the app’s (frontend/src/branding.ts)', () => {
    expect(NON_AFFILIATION_LONG).toBe(constantOf('frontend/src/branding.ts', 'NON_AFFILIATION_LONG'));
    expect(NON_AFFILIATION_LONG).toContain('is not affiliated with, endorsed by, or sponsored by Google');
  });

  it('keeps the long form word for word: an independent open-source project, no maintainer named', () => {
    expect(NON_AFFILIATION_LONG).toBe(
      'gcportrait renders Google Cloud-style architecture diagrams. It is an independent open-source project and is ' +
        'not affiliated with, endorsed by, or sponsored by Google. Google Cloud and the Google Cloud product icons are ' +
        "trademarks of Google and are used under Google's icon usage terms.",
    );
    expect(NON_AFFILIATION_LONG).not.toContain(MAINTAINER_NAME);
  });

  it('keeps the footer notice equal to the app’s (frontend/src/branding.ts), ending with the maintainer’s name', () => {
    expect(FOOTER_NOTICE).toBe(constantOf('frontend/src/branding.ts', 'FOOTER_NOTICE'));
    expect(`${FOOTER_NOTICE}.`).toBe(
      'Not affiliated with Google / Google Cloud. gcportrait is an independent open-source project by Florian Chrometz.',
    );
    expect(`${FOOTER_NOTICE_LEAD}${MAINTAINER_NAME}`).toBe(FOOTER_NOTICE);
  });

  it('keeps the short line the footer notice’s first sentence', () => {
    expect(FOOTER_NOTICE.startsWith(`${EXPORT_DISCLAIMER} `)).toBe(true);
  });

  it('names the maintainer as the app does', () => {
    expect(MAINTAINER_NAME).toBe(constantOf('frontend/src/branding.ts', 'MAINTAINER_NAME'));
    expect(MAINTAINER_URL).toBe(constantOf('frontend/src/branding.ts', 'MAINTAINER_URL'));
  });

  it('links the Impressum and the privacy notice on the maintainer’s website, each naming its site', () => {
    expect(LEGAL_LINKS.map((link) => link.href)).toEqual([
      'https://florian-chrometz.de/legal/impressum',
      'https://florian-chrometz.de/legal/privacy-policy',
    ]);
    for (const link of LEGAL_LINKS) expect(link.site).toBe(new URL(link.href).host);
  });

  it('links the repository the app’s source link defaults to', () => {
    expect(REPOSITORY_URL).toBe(constantOf('frontend/src/source.ts', 'DEFAULT_SOURCE_URL'));
    expect(repositoryFileUrl('/docs/packages.md')).toBe(`${REPOSITORY_URL}/blob/main/docs/packages.md`);
    expect(repositoryFileUrl('docs/media', 'tree')).toBe(`${REPOSITORY_URL}/tree/main/docs/media`);
  });

  it('writes out the addresses it repeats, as they are computed (see INSTALLER_URL)', () => {
    expect(INSTALLER_URL).toBe(`${SITE_URL}/install.sh`);
    expect(INSTALL_COMMAND).toBe(`curl -fsSL ${SITE_URL}/install.sh | bash -s -- --project YOUR_PROJECT`);
    expect(RELEASES_URL).toBe(`${REPOSITORY_URL}/releases`);
  });

  it('keeps website/public/CNAME on the canonical host', () => {
    const cname = readFileSync(path.join(REPO, 'website/public/CNAME'), 'utf8');
    expect(cname).toBe('gcportrait.app\n');
    expect(siteUrl('/docs/')).toBe('https://gcportrait.app/docs/');
  });
});
