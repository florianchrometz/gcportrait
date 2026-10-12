// SPDX-License-Identifier: MIT
/**
 * Builders and fakes the website's tests share (no page or build code imports this): a variable's field as the docs
 * pages write it, the logo as src/components/Logo.astro writes it, and a fetch that answers from the test.
 */
import { vi } from 'vitest';

import { logoShapeAttributes, type Drawing } from '../brand.js';

/** A command variable's field, as src/lib/markdown.ts writes it into code (the token as its text). */
export function field(name: string): string {
  return `<span class="var" data-var="${name}">${name}</span>`;
}

/** The logo as src/components/Logo.astro writes it: its shapes' attributes, with Astro's scoping attribute `cid`. */
export function logoMarkup(drawing: Drawing, cid = 'data-astro-cid-x1'): string {
  const rects = drawing.shapes.map(
    (shape) =>
      `<rect class="logo-shape" ${Object.entries(logoShapeAttributes(shape))
        .map(([name, value]) => `${name}="${value}"`)
        .join(' ')} ${cid}></rect>`,
  );
  return `<svg class="logo" width="30" height="30" viewBox="${drawing.viewBox}" aria-hidden="true" focusable="false" ${cid}>${rects.join('')}</svg>`;
}

/** A JSON answer with `status`, as GitHub's REST API sends one. */
export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** One request a fake fetch saw. */
export type FetchCall = { readonly url: string; readonly init: RequestInit | undefined };

/**
 * A fetch that records its calls and answers with `answer`. With `global: true` it also stands in for the global
 * fetch (the browser's) until `vi.unstubAllGlobals()`.
 */
export function fakeFetch(
  answer: (url: string, init: RequestInit | undefined) => Promise<Response>,
  { global = false }: { global?: boolean } = {},
): { fetch: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const impl = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    return answer(url, init);
  });
  if (global) vi.stubGlobal('fetch', impl);
  return { fetch: impl, calls };
}
