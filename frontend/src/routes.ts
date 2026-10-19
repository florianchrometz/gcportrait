// SPDX-License-Identifier: Apache-2.0

/** The diagram route: the only place where the URL hash is a ViewSpec (`@gcportrait/model`). */
export const DIAGRAM_PATH = '/diagram';

/**
 * The router's basename for the build's base path (Vite's `base`, `import.meta.env.BASE_URL`): "/", the router's
 * default, for an app served at the root of its origin (every instance), and the path without its trailing slash for
 * one served below it (the static demo at `/demo/`). The routes themselves (`/diagram`, `/settings`, …)
 * stay the same either way.
 */
export function routerBasename(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

/**
 * The address of an app path for a link that leaves the router (the "Copy link" button): the build's base path, then
 * the path ("/diagram" with base "/demo/" → "/demo/diagram").
 */
export function appPath(path: string, baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`;
}
