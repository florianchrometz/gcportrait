// SPDX-License-Identifier: MIT
/** The ViewSpec of a render's view: a hash decoded as the app decodes it, or explicit fields normalised. */
import { encodeViewSpec, normalizeViewSpec } from '@gcportrait/model';
import { describe, expect, it } from 'vitest';

import { flipIdOf } from './flip.js';
import { viewSpecOf } from './render-view.js';

const FOLDER = '//cloudresourcemanager.googleapis.com/folders/20000000001';
const PROJECT = '//cloudresourcemanager.googleapis.com/projects/10000000001';

describe('viewSpecOf', () => {
  it('fills in the defaults: the overview at auto detail', () => {
    expect(viewSpecOf({}, 'demo:S')).toEqual(normalizeViewSpec({ snapshot: 'demo:S' }));
  });

  it('normalises explicit fields and turns the flips’ zone ids into flip tokens', () => {
    expect(
      viewSpecOf(
        {
          lens: 'networking',
          detail: 'projects',
          focus: { kind: 'project', params: { project: 'demo-web-1' } },
          root: FOLDER,
          filters: { regions: ['global', 'europe-west3'], showRegions: false },
          flips: [PROJECT],
        },
        'demo:M',
      ),
    ).toEqual(
      normalizeViewSpec({
        snapshot: 'demo:M',
        lens: 'networking',
        detail: 'projects',
        focus: { kind: 'project', params: { project: 'demo-web-1' } },
        root: FOLDER,
        filters: { regions: ['europe-west3', 'global'], showRegions: false },
        flips: [flipIdOf(PROJECT)],
      }),
    );
  });

  it('decodes a hash with or without its #, replacing its snapshot and keeping the rest', () => {
    const hash = encodeViewSpec({ snapshot: 'demo:L', lens: 'security', detail: 'all', selection: PROJECT });
    const expected = normalizeViewSpec({
      snapshot: 'demo:M',
      lens: 'security',
      detail: 'all',
      selection: PROJECT,
    });
    expect(viewSpecOf({ hash }, 'demo:M')).toEqual(expected);
    expect(viewSpecOf({ hash: `#${hash}` }, 'demo:M')).toEqual(expected);
    expect(viewSpecOf({ hash: 'lens=nope&detail=networks' }, '')).toEqual(
      normalizeViewSpec({ detail: 'networks' }),
    );
  });
});
