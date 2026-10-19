// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';

import { NON_AFFILIATION_LONG } from '../site.js';
import {
  FEATURE_LIST,
  articleLd,
  canonicalUrl,
  fullTitle,
  jsonLdText,
  personLd,
  softwareApplicationLd,
  sourceCodeLd,
} from './seo.js';

const AUTHOR = {
  name: 'Florian Chrometz',
  url: 'https://florian-chrometz.de',
  sameAs: ['https://github.com/florianchrometz'],
};

describe('page metadata', () => {
  it('titles the landing page by the product and every other page by itself', () => {
    expect(fullTitle({ title: 'Diagrams', path: '/' })).toBe('gcportrait: Diagrams');
    expect(fullTitle({ title: 'Self-hosting gcportrait', path: '/docs/self-host/' })).toBe(
      'Self-hosting gcportrait · gcportrait',
    );
    expect(canonicalUrl('/docs/')).toBe('https://gcportrait.app/docs/');
  });

  it('writes JSON-LD that cannot close its script element', () => {
    const text = jsonLdText({ description: '</script><!-- & -->' });
    expect(text).not.toContain('<');
    expect(text).not.toContain('>');
    expect(JSON.parse(text)).toEqual({ description: '</script><!-- & -->' });
  });

  it('describes the software as Apache-2.0 with its repository, its author a Person, never an Organization', () => {
    const app = softwareApplicationLd({ author: AUTHOR });
    expect(app['@type']).toBe('SoftwareApplication');
    expect(app.license).toBe('https://www.apache.org/licenses/LICENSE-2.0');
    expect(app.sameAs).toEqual(['https://github.com/florianchrometz/gcportrait']);
    // The statement is in the footer and the author section, never in metadata.
    expect(app.description).toEqual(
      expect.stringMatching(/^gcportrait creates a Google Cloud architecture diagram/),
    );
    expect(JSON.stringify(app)).not.toContain('affiliated');
    expect(JSON.stringify(app)).not.toContain(NON_AFFILIATION_LONG);
    expect(app.applicationCategory).toBe('DeveloperApplication');
    expect(app.applicationSubCategory).toBe('Google Cloud architecture diagrams');
    expect(app.featureList).toEqual([...FEATURE_LIST]);
    expect(FEATURE_LIST.map((feature) => feature.split(':')[0])).toEqual(['Self-hosted', 'Web app', 'API']);
    expect(sourceCodeLd().codeRepository).toBe('https://github.com/florianchrometz/gcportrait');
    const person = personLd(AUTHOR);
    expect(person['@type']).toBe('Person');
    for (const data of [app, sourceCodeLd(), person])
      expect(JSON.stringify(data)).not.toContain('Organization');
  });

  it('names a guide’s author as the author section’s Person, with the name search engines attribute to', () => {
    const article = articleLd({ title: 'API', description: 'd', path: '/docs/api/', author: AUTHOR });
    expect(article.author).toEqual({
      '@type': 'Person',
      '@id': 'https://gcportrait.app/#author',
      name: AUTHOR.name,
      url: 'https://florian-chrometz.de',
    });
  });
});
