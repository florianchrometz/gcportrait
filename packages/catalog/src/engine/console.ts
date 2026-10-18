// SPDX-License-Identifier: Apache-2.0
/**
 * Cloud Console links (the console action of skill gcp-diagram-style §6; skill gcp-asset-catalog §2): the one
 * place that turns an asset into a link to its Cloud Console page. The selected card's action, the card's
 * context menu and the details drawer all take their link from here, through the type's `console` template;
 * nothing else builds a console URL.
 *
 * A type without a template, or an asset that lacks a variable its template needs, has no resource link (a link
 * to a broken page is worse than none). The caller then offers the project's console home instead
 * ({@link consoleLinkFor}), and the resource name to copy. Nothing here opens anything: these are strings.
 */
import type { Asset, Catalog, CatalogType } from '@gcportrait/model';
import { assetProject, EMPTY_PROJECT_INDEX } from './project.js';
import { renderConsoleUrl, type RuleContext } from './rules.js';

/** The Cloud Console's origin; every template starts with it, and so does the project fallback. */
export const CONSOLE_ORIGIN = 'https://console.cloud.google.com';

const NO_PROJECTS: RuleContext = { projects: EMPTY_PROJECT_INDEX };

function typeOf(catalog: Pick<Catalog, 'types'>, assetType: string): CatalogType | undefined {
  return Object.hasOwn(catalog.types, assetType) ? catalog.types[assetType] : undefined;
}

/**
 * The asset's Cloud Console URL from its type's `console` template, or undefined when the catalog has no entry
 * or no template for the type, or the asset lacks a variable the template needs. Values are percent-encoded
 * (`/` kept). `ctx` resolves `projectId` and `projectNumber` through the snapshot's project index; without it
 * only what the asset's own name and ancestors say is known.
 */
export function consoleUrlFor(
  asset: Asset,
  catalog: Pick<Catalog, 'types'>,
  ctx: RuleContext = NO_PROJECTS,
): string | undefined {
  return renderConsoleUrl(asset, typeOf(catalog, asset.assetType), ctx);
}

/** The Cloud Console home of a project: the fallback for an asset whose type has no console template. */
export function projectConsoleUrl(projectId: string): string {
  return `${CONSOLE_ORIGIN}/home/dashboard?project=${encodeURIComponent(projectId)}`;
}

/** Where an asset's console action goes: its own page, or (no template) its project's console home. */
export type ConsoleLink =
  | { readonly kind: 'resource'; readonly url: string }
  | { readonly kind: 'project'; readonly url: string; readonly projectId: string };

/**
 * The asset's console action: its own page when {@link consoleUrlFor} has one, else its project's console home
 * when the asset lives in a project whose id is known, else undefined (an organisation or folder without a
 * template, an asset outside any project).
 */
export function consoleLinkFor(
  asset: Asset,
  catalog: Pick<Catalog, 'types'>,
  ctx: RuleContext = NO_PROJECTS,
): ConsoleLink | undefined {
  const url = consoleUrlFor(asset, catalog, ctx);
  if (url !== undefined) return { kind: 'resource', url };
  const projectId = assetProject(asset, ctx.projects).id;
  return projectId === undefined
    ? undefined
    : { kind: 'project', url: projectConsoleUrl(projectId), projectId };
}

/** The mapped types that have no `console` template, sorted (the `catalog:check` report counts them). */
export function typesWithoutConsole(catalog: Pick<Catalog, 'types'>): string[] {
  return Object.entries(catalog.types)
    .filter(([, type]) => type.console === undefined)
    .map(([assetType]) => assetType)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
