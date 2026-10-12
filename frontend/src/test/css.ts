// SPDX-License-Identifier: MIT
/**
 * Reading the app's stylesheets for the CSS guards (tokens, focus). Those tests run in Node
 * (`// @vitest-environment node`), but the frontend's types are the browser's (no `@types/node`), and Vitest stubs
 * stylesheets imported with `?raw` (vitest.config.ts), so the sheets are read from disk through a module name the
 * type checker does not resolve. Imported by tests only.
 */

/** The file-system functions the guards need. */
interface FileSystem {
  readonly readFileSync: (path: string | URL, encoding: 'utf8') => string;
  readonly readdirSync: (path: string | URL, options: { readonly recursive: true }) => string[];
}
const FS_MODULE: string = 'node:fs';
const fs = (await import(/* @vite-ignore */ FS_MODULE)) as FileSystem;

/** frontend/src/. */
const SOURCE = new URL('../', import.meta.url);

/** A file under frontend/src/, by its path from there. */
export function readSource(path: string): string {
  return fs.readFileSync(new URL(path, SOURCE), 'utf8');
}

/** Every file under `directory` (a path from frontend/src/, '' for all of it) that `keep` takes, sorted, by its path from frontend/src/. */
export function sourceFiles(directory: string, keep: (path: string) => boolean): string[] {
  const base = directory === '' ? '' : `${directory.replace(/\/$/, '')}/`;
  return fs
    .readdirSync(new URL(base, SOURCE), { recursive: true })
    .map((path) => `${base}${path.replaceAll('\\', '/')}`)
    .filter(keep)
    .sort();
}

/** The stylesheet without its comments. */
export function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** The declarations of the first block whose selector list starts with `selector` ('' when there is none). */
export function block(css: string, selector: string): string {
  const start = css.indexOf(selector);
  if (start < 0) return '';
  const open = css.indexOf('{', start);
  return css.slice(open, css.indexOf('}', open));
}

/** The declarations of a theme's block in a token sheet (`:root[data-theme='light']` or `…'dark'`). */
export function themeBlock(css: string, theme: 'light' | 'dark'): string {
  return block(css, `:root[data-theme='${theme}']`);
}

/** A token's value in a block of declarations, with a var() reference to the same block resolved. */
export function token(declarations: string, name: string): string {
  const match = new RegExp(`${name}:\\s*([^;]+);`).exec(declarations);
  if (match?.[1] === undefined) throw new Error(`${name} is not defined`);
  const value = match[1].trim();
  const reference = /^var\((--[\w-]+)\)$/.exec(value);
  return reference?.[1] === undefined ? value : token(declarations, reference[1]);
}
