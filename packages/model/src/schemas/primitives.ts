// SPDX-License-Identifier: Apache-2.0
/**
 * Identifier and timestamp formats shared by every schema in this package. The patterns live in patterns.ts
 * (no zod) and are re-exported here for the package's own modules and tests (the tests build their fast-check
 * arbitraries from them); the public API re-exports only the schemas.
 */
import * as z from 'zod';
import {
  ANCESTOR_PATTERN,
  ASSET_TYPE_PATTERN,
  ASSET_TYPE_PATTERN_OR_GLOB,
  DOMAIN_PATTERN,
  ICON_KEY_PATTERN,
  LOCATION_PATTERN,
  NUMERIC_ID_PATTERN,
  PROJECT_REF_PATTERN,
  RESOURCE_NAME_PATTERN,
  SERVICE_PATTERN,
  ULID_PATTERN,
  WELL_FORMED_TEXT_PATTERN,
} from './patterns.js';

export {
  ANCESTOR_PATTERN,
  ASSET_TYPE_PATTERN,
  ASSET_TYPE_PATTERN_OR_GLOB,
  DOMAIN_PATTERN,
  ICON_KEY_PATTERN,
  LOCATION_PATTERN,
  NUMERIC_ID_PATTERN,
  PROJECT_REF_PATTERN,
  RESOURCE_NAME_PATTERN,
  SERVICE_PATTERN,
  ULID_PATTERN,
  WELL_FORMED_TEXT_PATTERN,
};

/** A non-empty string. */
export const NonEmptyStringSchema = z.string().min(1);

/** Non-empty, well-formed text: any characters, but no lone UTF-16 surrogates. */
export const TextSchema = z.string().regex(WELL_FORMED_TEXT_PATTERN, 'must be non-empty, well-formed text');

/** A ULID in canonical upper-case form. */
export const UlidSchema = z.string().regex(ULID_PATTERN, 'must be a canonical upper-case ULID');

/** An API service host such as `run.googleapis.com`. */
export const ServiceNameSchema = z
  .string()
  .regex(SERVICE_PATTERN, 'must be a service host such as run.googleapis.com');

/** A Cloud Asset Inventory asset type such as `compute.googleapis.com/Instance`. */
export const AssetTypeSchema = z
  .string()
  .regex(ASSET_TYPE_PATTERN, 'must be an asset type such as compute.googleapis.com/Instance');

/** An asset type, a `<service>/*` glob or `*`. */
export const AssetTypePatternSchema = z
  .string()
  .regex(ASSET_TYPE_PATTERN_OR_GLOB, 'must be an asset type, a <service>/* glob or *');

/** A full resource name such as `//compute.googleapis.com/projects/p/zones/z/instances/i`. */
export const ResourceNameSchema = z
  .string()
  .regex(RESOURCE_NAME_PATTERN, 'must be a full resource name starting with //<service>/');

/** A project id or number. */
export const ProjectRefSchema = z.string().regex(PROJECT_REF_PATTERN, 'must be a project id or number');

/** A project, folder or organisation number. */
export const NumericIdSchema = z.string().regex(NUMERIC_ID_PATTERN, 'must be a decimal number');

/** A location such as `global`, `europe-west3`, `europe-west3-a` or `EU`. */
export const LocationSchema = z.string().regex(LOCATION_PATTERN, 'must be a location such as europe-west3');

/** An IPv4 or IPv6 address or CIDR range. */
export const IpSchema = z.union([z.ipv4(), z.ipv6(), z.cidrv4(), z.cidrv6()]);

/** A lower-case DNS name, possibly a wildcard. */
export const DomainSchema = z.string().regex(DOMAIN_PATTERN, 'must be a lower-case DNS name');

/** An icon key such as `cloud_run`. */
export const IconKeySchema = z.string().regex(ICON_KEY_PATTERN, 'must be an icon key such as cloud_run');

/** An RFC 3339 timestamp with a `Z` or numeric offset and any number of fractional digits. */
export const TimestampSchema = z.iso.datetime({ offset: true });

/** A calendar date `YYYY-MM-DD` (validated, so `2026-02-29` is rejected). */
export const DateSchema = z.iso.date();

/** A non-negative integer. */
export const CountSchema = z.int().min(0);
