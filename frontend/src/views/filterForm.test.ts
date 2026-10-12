// @vitest-environment node
// SPDX-License-Identifier: MIT
/**
 * The Filters popover's form ↔ the ViewSpec's filters: every filter field both ways, the canonical
 * form the hash codec writes, the round trip through the URL hash, the active-filter count and reset.
 */
import { decodeViewSpec, encodeViewSpec, normalizeViewSpec, type ViewFilters } from '@gcportrait/model';
import { describe, expect, it } from 'vitest';

import {
  activeFilterCount,
  DEPTH_SLIDER_MAX,
  depthFromSlider,
  depthSliderMax,
  depthSliderValue,
  filtersOf,
  formOf,
  NO_FILTERS,
  withFormField,
  withListItem,
  type FilterForm,
} from './filterForm';

const EMPTY_FORM: FilterForm = {
  hideEmptyProjects: false,
  hideEmptyFolders: false,
  hideDisconnected: false,
  regions: [],
  projects: [],
  folders: [],
  includeTypes: [],
  excludeTypes: [],
  depth: 0,
  showRegions: 'default',
  showIdentities: 'default',
};

const FULL_FORM: FilterForm = {
  hideEmptyProjects: true,
  hideEmptyFolders: true,
  hideDisconnected: true,
  regions: ['europe-west3', 'us-central1'],
  projects: ['demo-net-1', 'demo-web-1'],
  folders: ['20000000001'],
  includeTypes: ['run.googleapis.com/*'],
  excludeTypes: ['compute.googleapis.com/Disk'],
  depth: 4,
  showRegions: 'show',
  showIdentities: 'hide',
};

/** The filters after a trip through the URL hash, as the app reads them back. */
function throughHash(filters: ViewFilters): ViewFilters {
  return decodeViewSpec(encodeViewSpec({ snapshot: 'demo:M', filters })).filters;
}

describe('the filter form and the ViewSpec filters', () => {
  it('maps the default filters to the empty form and back', () => {
    expect(formOf(NO_FILTERS)).toEqual(EMPTY_FORM);
    expect(filtersOf(EMPTY_FORM)).toEqual(NO_FILTERS);
    expect(activeFilterCount(NO_FILTERS)).toBe(0);
  });

  it('maps every filter field of the ViewSpec', () => {
    expect(filtersOf(FULL_FORM)).toEqual({
      hideEmptyProjects: true,
      hideEmptyFolders: true,
      hideDisconnected: true,
      regions: ['europe-west3', 'us-central1'],
      projects: ['demo-net-1', 'demo-web-1'],
      folders: ['20000000001'],
      includeTypes: ['run.googleapis.com/*'],
      excludeTypes: ['compute.googleapis.com/Disk'],
      depth: 4,
      showRegions: true,
      showIdentities: false,
    });
    expect(formOf(filtersOf(FULL_FORM))).toEqual(FULL_FORM);
    expect(activeFilterCount(filtersOf(FULL_FORM))).toBe(11);
  });

  it.each([
    ['hideEmptyProjects', true, 'hide=empty-projects'],
    ['hideEmptyFolders', true, 'hide=empty-folders'],
    ['hideDisconnected', true, 'hide=disconnected'],
    ['regions', ['us-central1'], 'regions=us-central1'],
    ['projects', ['demo-web-1'], 'projects=demo-web-1'],
    ['folders', ['20000000005'], 'folders=20000000005'],
    ['includeTypes', ['iam.googleapis.com/ServiceAccount'], 'include=iam.googleapis.com/ServiceAccount'],
    ['excludeTypes', ['compute.googleapis.com/*'], 'exclude=compute.googleapis.com/*'],
    ['depth', 2, 'depth=2'],
    ['showRegions', 'show', 'show-regions=1'],
    ['showRegions', 'hide', 'show-regions=0'],
    ['showIdentities', 'show', 'show-identities=1'],
    ['showIdentities', 'hide', 'show-identities=0'],
  ] as const)('writes %s = %j into the hash as %s, and reads it back', (field, value, hash) => {
    const filters = withFormField(NO_FILTERS, field, value as never);
    expect(encodeViewSpec({ snapshot: 'demo:M', filters })).toBe(`snapshot=demo:M&${hash}`);
    expect(formOf(throughHash(filters))[field]).toEqual(value);
    expect(activeFilterCount(filters)).toBe(1);
  });

  it('round-trips any form through the hash unchanged', () => {
    for (const form of [EMPTY_FORM, FULL_FORM, { ...FULL_FORM, depth: 64, regions: ['eu'] }]) {
      expect(formOf(throughHash(filtersOf(form)))).toEqual(form);
    }
  });

  it('writes the canonical form: lists de-duplicated and sorted, empty ones and defaults left out', () => {
    const filters = filtersOf({
      ...EMPTY_FORM,
      regions: ['us-central1', 'europe-west3', 'us-central1'],
      projects: [],
    });
    expect(filters).toEqual({ ...NO_FILTERS, regions: ['europe-west3', 'us-central1'] });
    expect('projects' in filters).toBe(false);
    expect(filters).toEqual(normalizeViewSpec({ filters }).filters);
  });

  it('keeps a depth within 1–64 and treats 0 as no limit', () => {
    expect(filtersOf({ ...EMPTY_FORM, depth: 0 }).depth).toBeUndefined();
    expect(filtersOf({ ...EMPTY_FORM, depth: 99 }).depth).toBe(64);
    expect(filtersOf({ ...EMPTY_FORM, depth: 2.4 }).depth).toBe(2);
  });

  it('lays the depth slider out shallow to deep, with No limit at the right end', () => {
    expect(DEPTH_SLIDER_MAX).toBe(12);
    expect(depthSliderMax(0)).toBe(12);
    expect(depthSliderValue(0)).toBe(13);
    expect(depthSliderValue(1)).toBe(1);
    expect(depthSliderValue(5)).toBe(5);
    expect(depthFromSlider(13, 12)).toBe(0);
    expect(depthFromSlider(12, 12)).toBe(12);
    expect(depthFromSlider(1, 12)).toBe(1);
    // A deeper limit from the hash widens the slider; No limit stays one step past it.
    expect(depthSliderMax(20)).toBe(20);
    expect(depthSliderValue(20)).toBe(20);
    expect(depthFromSlider(21, 20)).toBe(0);
  });

  it('drops values the hash could not hold (an invalid type pattern)', () => {
    expect(filtersOf({ ...EMPTY_FORM, includeTypes: ['not a type', 'run.googleapis.com/Service'] })).toEqual({
      ...NO_FILTERS,
      includeTypes: ['run.googleapis.com/Service'],
    });
  });

  it('adds and removes list items', () => {
    let filters = withListItem(NO_FILTERS, 'projects', 'demo-web-1', true);
    filters = withListItem(filters, 'projects', 'demo-net-1', true);
    filters = withListItem(filters, 'projects', 'demo-net-1', true);
    expect(filters.projects).toEqual(['demo-net-1', 'demo-web-1']);
    filters = withListItem(filters, 'projects', 'demo-web-1', false);
    expect(filters.projects).toEqual(['demo-net-1']);
    filters = withListItem(filters, 'projects', 'demo-net-1', false);
    expect(filters).toEqual(NO_FILTERS);
  });

  it('changes one field and leaves the others', () => {
    const before = filtersOf(FULL_FORM);
    const after = withFormField(before, 'hideEmptyFolders', false);
    expect(formOf(after)).toEqual({ ...FULL_FORM, hideEmptyFolders: false });
  });
});
