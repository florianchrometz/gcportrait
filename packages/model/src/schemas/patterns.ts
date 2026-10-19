// SPDX-License-Identifier: Apache-2.0
/**
 * The identifier and timestamp patterns of the schemas in primitives.ts, in a module of their own that imports
 * nothing (no zod), so code that only needs to test a string against one (the URL-hash codec's zod-free
 * normaliser, codec/normalize.ts) does not pull the schema library into its bundle. primitives.ts re-exports
 * them; the package's own modules and tests import them from either.
 */

/**
 * A canonical ULID: 26 upper-case Crockford base-32 characters; the leading 0–7 keeps the timestamp in range.
 */
export const ULID_PATTERN = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

/** An API service host, e.g. `compute.googleapis.com` or `apps.k8s.io`. */
export const SERVICE_PATTERN = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;

/** A Cloud Asset Inventory asset type: `<service>/<Kind>`, e.g. `compute.googleapis.com/Instance`. */
export const ASSET_TYPE_PATTERN = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+\/[A-Za-z][A-Za-z0-9]*$/;

/** An asset type, every type of one service (`<service>/*`), or every type (`*`). */
export const ASSET_TYPE_PATTERN_OR_GLOB = /^(?:\*|[a-z0-9-]+(?:\.[a-z0-9-]+)+\/(?:\*|[A-Za-z][A-Za-z0-9]*))$/;

/** A full resource name: `//<service>/<path>`, kept verbatim from Cloud Asset Inventory. */
export const RESOURCE_NAME_PATTERN = /^\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)+\/./;

/**
 * One entry of an asset's `ancestors` list, closest first: `projects/…`, `folders/…` or `organizations/…`.
 */
export const ANCESTOR_PATTERN = /^(?:organizations|folders|projects)\/[^/\s]+$/;

/** A project id, a legacy domain-scoped project id (`example.com:app`) or a project number. */
export const PROJECT_REF_PATTERN = /^[a-z0-9][a-z0-9.:-]*$/;

/**
 * A decimal number with no sign and no leading zero, as used for project, folder and organisation numbers.
 */
export const NUMERIC_ID_PATTERN = /^[1-9][0-9]*$/;

/** A location: `global`, a region, a zone or a multi-region such as `EU`. */
export const LOCATION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]*$/;

/**
 * A lower-case DNS name, optionally a wildcard (`*.example.com`); underscores are allowed
 * (`_acme-challenge`).
 */
export const DOMAIN_PATTERN =
  /^(?=.{1,253}$)(?:\*\.)?[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?(?:\.[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?)*$/;

/** An icon key in `packages/icons`, e.g. `compute_engine`. */
export const ICON_KEY_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

/** Text without lone UTF-16 surrogates, so that it survives UTF-8 and percent-encoding unchanged. */
export const WELL_FORMED_TEXT_PATTERN = /^\P{Cs}+$/u;

/**
 * An RFC 3339 timestamp with UTC indicator (Z/z) or a numeric offset (+/-HH:MM),
 * with optional fractional seconds.
 */
export const RFC3339_PATTERN =
  /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})$/;
