// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';

import {
  DIAGRAM_TAGLINE,
  FOOTER_NOTICE,
  FOOTER_NOTICE_LEAD,
  MAINTAINER_LINK_LABEL,
  MAINTAINER_NAME,
  MAINTAINER_URL,
  NON_AFFILIATION_FOOTER,
  NON_AFFILIATION_LONG,
  NON_AFFILIATION_STATEMENT,
  TAGLINE,
  WORDMARK,
} from './branding';

describe('branding constants', () => {
  it('pins the wordmark and tagline', () => {
    expect(WORDMARK).toBe('gcportrait');
    expect(TAGLINE).toBe('gcportrait.app - Visualize your Google Cloud Infrastructure');
    expect(DIAGRAM_TAGLINE).toBe(TAGLINE);
  });

  it('pins the non-affiliation notices and maintainer link', () => {
    expect(FOOTER_NOTICE).toBe(
      'Not affiliated with Google / Google Cloud. gcportrait is an independent open-source project by Florian Chrometz',
    );
    expect(NON_AFFILIATION_FOOTER).toBe(FOOTER_NOTICE);
    expect(NON_AFFILIATION_LONG).toBe(
      'gcportrait renders Google Cloud-style architecture diagrams. It is an independent open-source project and ' +
        'is not affiliated with, endorsed by, or sponsored by Google. Google Cloud and the Google Cloud product ' +
        "icons are trademarks of Google and are used under Google's icon usage terms.",
    );
    expect(NON_AFFILIATION_STATEMENT).toBe(NON_AFFILIATION_LONG);
    expect(NON_AFFILIATION_LONG).not.toContain(MAINTAINER_NAME);
    expect(`${FOOTER_NOTICE_LEAD}${MAINTAINER_NAME}`).toBe(FOOTER_NOTICE);
    expect(MAINTAINER_URL).toBe('https://florian-chrometz.de');
    expect(MAINTAINER_LINK_LABEL).toBe('Florian Chrometz (personal website)');
  });
});
