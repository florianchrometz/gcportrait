// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { isRegion, isZone, regionOfZone, zoneRegion } from './locations.js';
import { LOCATION_PATTERN } from './patterns.js';

/** A location, whether it is a region and a zone, and the region a zone lies in (or the location itself). */
const LOCATIONS: readonly (readonly [string, boolean, boolean, string])[] = [
  ['europe-west3', true, false, 'europe-west3'],
  ['us-central1', true, false, 'us-central1'],
  ['northamerica-northeast1', true, false, 'northamerica-northeast1'],
  ['europe-west3-b', false, true, 'europe-west3'],
  ['us-central1-f', false, true, 'us-central1'],
  // AI zones: the region, then `ai`, the deployment group and the letter of the zone they follow.
  ['us-central1-ai1a', false, true, 'us-central1'],
  ['us-west4-ai2b', false, true, 'us-west4'],
  // A sovereign cloud's region and zones: the same shape after `u-`.
  ['u-france-east1', true, false, 'u-france-east1'],
  ['u-france-east1-a', false, true, 'u-france-east1'],
  ['u-germany-northeast1', true, false, 'u-germany-northeast1'],
  ['u-germany-northeast1-c', false, true, 'u-germany-northeast1'],
  // Multi-regions and multi-region configurations are locations of their own.
  ['us', false, false, 'us'],
  ['eu', false, false, 'eu'],
  ['nam4', false, false, 'nam4'],
  ['nam-eur-asia1', false, false, 'nam-eur-asia1'],
  ['global', false, false, 'global'],
  // As Cloud Asset Inventory writes them: lower case only, and nothing that only looks like a zone.
  ['EU', false, false, 'EU'],
  ['EUROPE-WEST3-B', false, false, 'EUROPE-WEST3-B'],
  ['europe-west3-', false, false, 'europe-west3-'],
  ['europe-west3-b-1', false, false, 'europe-west3-b-1'],
  ['zones/europe-west3-b', false, false, 'zones/europe-west3-b'],
  ['u-france', false, false, 'u-france'],
  ['x-france-east1-a', false, false, 'x-france-east1-a'],
  ['u-u-france-east1', false, false, 'u-u-france-east1'],
  ['', false, false, ''],
];

describe('locations', () => {
  it.each(LOCATIONS)('%j: region %j, zone %j, in %j', (location, region, zone, regionOf) => {
    expect(isRegion(location)).toBe(region);
    expect(isZone(location)).toBe(zone);
    expect(zoneRegion(location)).toBe(zone ? regionOf : undefined);
    expect(regionOfZone(location)).toBe(regionOf);
  });

  it('gives a zone a region, and every region and zone is a location', () => {
    for (const [location, region, zone] of LOCATIONS) {
      if (zone) expect(isRegion(zoneRegion(location) ?? '')).toBe(true);
      if (region || zone) expect(LOCATION_PATTERN.test(location)).toBe(true);
    }
  });
});
