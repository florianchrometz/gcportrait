// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';

import {
  FEATURE_LIST,
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

  it('describes the software as MIT with its repository, its author a Person, never an Organization', () => {
    const app = softwareApplicationLd({ author: AUTHOR });
    expect(app['@type']).toBe('SoftwareApplication');
    expect(app.license).toBe('https://opensource.org/licenses/MIT');
    expect(app.sameAs).toEqual(['https://github.com/florianchrometz/gcportrait']);
    expect(app.description).toEqual(
      expect.stringContaining('is not affiliated with, endorsed by, or sponsored by Google'),
    );
    expect(app.applicationCategory).toBe('DeveloperApplication');
    expect(app.featureList).toEqual([...FEATURE_LIST]);
    expect(FEATURE_LIST.map((feature) => feature.split(':')[0])).toEqual(['Self-hosted', 'Web app', 'API']);
    expect(sourceCodeLd().codeRepository).toBe('https://github.com/florianchrometz/gcportrait');
    const person = personLd(AUTHOR);
    expect(person['@type']).toBe('Person');
    for (const data of [app, sourceCodeLd(), person])
      expect(JSON.stringify(data)).not.toContain('Organization');
  });
});
