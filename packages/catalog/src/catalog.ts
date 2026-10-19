// SPDX-License-Identifier: Apache-2.0
/**
 * The compiled asset catalog (`catalog.json`), as a typed object. `pnpm catalog:build` writes the data into
 * `generated/compiled-catalog.ts` from the YAML under products/ and lenses/: a git-ignored build artefact that
 * the install (`prepare`) and the typecheck, lint and test scripts regenerate before they run. The build writes
 * only data that passed `CatalogSchema`, as a constant typed `Catalog`, so it is exported as it is and not
 * parsed again on import, which would cost every worker, render job and test file that loads the catalog a
 * parse of the whole catalog for a deep-equal copy. tsc holds the module to the type, and
 * tooling/catalog.test.ts holds it to the schema and to a fresh compile.
 */
import type { Catalog } from '@gcportrait/model';
import { CATALOG_DATA } from './generated/compiled-catalog.js';

export const catalog: Catalog = CATALOG_DATA;
