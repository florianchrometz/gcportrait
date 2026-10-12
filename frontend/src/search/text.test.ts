// @vitest-environment node
// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';

import type { RevealContext, SearchHit } from './protocol';
import type { RevealFacts } from './reveal';
import { hitDescription, offerLabel, resultCount, revealReasons } from './text';

const HIT: SearchHit = {
  id: '//compute.googleapis.com/projects/demo-vm-1/zones/europe-west3-a/instances/bastion',
  label: 'bastion',
  kind: 'resource',
  typeName: 'Compute Engine instance',
  project: 'demo-vm-1',
  icon: 'compute_engine',
  hidden: false,
  tier: 'exact',
};

const CONTEXT: RevealContext = {
  label: 'bastion',
  typeName: 'Compute Engine instance',
  root: 'Retail web (prod)',
  lensTitle: 'Networking',
  everythingTitle: 'Everything',
  drillTarget: 'Retail batch VMs (prod)',
};

const FACTS: RevealFacts = {
  shown: 'absent',
  expandable: false,
  outsideRoot: false,
  outsideFocus: false,
  lens: 'listed',
  hidden: 'no',
  filtered: false,
};

describe('hitDescription', () => {
  it('says the type and the project, and what matched when it is not the label', () => {
    expect(hitDescription(HIT)).toBe('Compute Engine instance · demo-vm-1');
    expect(hitDescription({ ...HIT, match: { field: 'ip', value: '10.0.14.5' } })).toBe(
      'Compute Engine instance · demo-vm-1 · IP 10.0.14.5',
    );
    expect(hitDescription({ ...HIT, match: { field: 'domain', value: 'bastion.corp.example.com' } })).toBe(
      'Compute Engine instance · demo-vm-1 · bastion.corp.example.com',
    );
    expect(hitDescription({ ...HIT, match: { field: 'ancestor', value: 'Retail' } })).toBe(
      'Compute Engine instance · demo-vm-1 · in Retail',
    );
    // The project id and the type are on the line already; a full name is too long to repeat.
    expect(hitDescription({ ...HIT, match: { field: 'project', value: 'demo-vm-1' } })).toBe(
      'Compute Engine instance · demo-vm-1',
    );
    expect(hitDescription({ ...HIT, match: { field: 'id', value: HIT.id } })).toBe(
      'Compute Engine instance · demo-vm-1',
    );
  });

  it('marks hidden-by-default results, and leaves out a missing project', () => {
    const folder: SearchHit = {
      id: '//cloudresourcemanager.googleapis.com/folders/20000000006',
      label: 'Retail',
      kind: 'folder',
      typeName: 'Resource Manager folder',
      icon: 'folder',
      hidden: true,
      tier: 'fuzzy',
    };
    expect(hitDescription(folder)).toBe('Resource Manager folder · hidden by default');
  });
});

describe('resultCount', () => {
  it('counts the matches and says when only the first are listed', () => {
    expect(resultCount(0, 0)).toBe('No results');
    expect(resultCount(1, 1)).toBe('1 result');
    expect(resultCount(7, 7)).toBe('7 results');
    expect(resultCount(138, 20)).toBe('138 results, the first 20 listed');
  });
});

describe('revealReasons and offerLabel', () => {
  it('says why, one sentence per fact', () => {
    expect(revealReasons({ ...FACTS, outsideRoot: true, lens: 'unlisted' }, CONTEXT)).toEqual([
      'It is outside Retail web (prod), the container this view is drilled into.',
      'The Networking lens does not draw the type Compute Engine instance.',
    ]);
    expect(revealReasons({ ...FACTS, hidden: 'role', filtered: true }, CONTEXT)).toEqual([
      'The type Compute Engine instance is hidden by default.',
      'The filters may leave it out.',
    ]);
    expect(revealReasons(FACTS, CONTEXT)).toEqual(['This view leaves it out.']);
  });

  it('names an offer by its steps, in order', () => {
    expect(offerLabel(['drill-in'], CONTEXT)).toBe('Show details of Retail batch VMs (prod)');
    expect(offerLabel(['drill-in', 'everything-lens'], CONTEXT)).toBe(
      'Show details of Retail batch VMs (prod) and switch to the Everything lens',
    );
    expect(offerLabel(['include-type', 'everything-lens', 'clear-filters'], CONTEXT)).toBe(
      'Include the type Compute Engine instance, switch to the Everything lens and clear the filters',
    );
    const organisation: RevealContext = {
      label: CONTEXT.label,
      typeName: CONTEXT.typeName,
      lensTitle: CONTEXT.lensTitle,
      everythingTitle: CONTEXT.everythingTitle,
    };
    expect(offerLabel(['drill-in'], organisation)).toBe('Show the whole organisation');
  });
});
