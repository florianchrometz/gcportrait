// SPDX-License-Identifier: MIT
/**
 * The compiled asset catalog (`catalog.json`), as a typed object. `pnpm catalog:build` writes the data into
 * `generated/compiled-catalog.ts` from the YAML under products/ and lenses/: a git-ignored build artefact that
 * the install (`prepare`) and the typecheck, lint and test scripts regenerate before they run. It is
 * validated here once, when the module is first imported.
 */
import { CatalogSchema, type Catalog } from '@gcportrait/model';
import { CATALOG_DATA } from './generated/compiled-catalog.js';

export const catalog: Catalog = CatalogSchema.parse(CATALOG_DATA);
