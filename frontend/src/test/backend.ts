// SPDX-License-Identifier: Apache-2.0
/**
 * The backend as the tests stand it in: GET /api/config's answer (`publicConfig`), and a `fetch` that answers the
 * routes a test names, records every call with its parsed JSON body, and fails any other request as a dropped
 * connection would (`stubBackend`). Synthetic values only (AGENTS.md, Data and graph semantics). Imported by tests
 * only.
 */
import { vi, type Mock } from 'vitest';

import type { PublicConfig } from '../api/config';
import { readDemoConfig } from '../api/demoConfig';
import { watchRequest } from './requests';

/** What a live instance without sign-in or service-account mode answers on GET /api/config. */
export function publicConfig(overrides: Partial<PublicConfig> = {}): PublicConfig {
  return {
    oauthClientId: null,
    saMode: false,
    saStrictExposure: false,
    backendServiceAccount: null,
    version: '0.0.0-test',
    sourceUrl: 'https://git.example.org/gcportrait',
    hostedBy: null,
    demo: false,
    demoOnly: false,
    legal: { impressum: false, privacy: false, impressumUrl: null, privacyUrl: null },
    render: null,
    ...overrides,
  };
}

/** The static demo's build settings in the tests: its source and the operator's legal pages elsewhere. */
export const STATIC_DEMO = {
  source: 'https://git.example.org/me/gcportrait',
  impressum: 'https://operator.example.com/legal/impressum',
  privacy: 'https://operator.example.com/legal/privacy-policy',
} as const;

/** A demo build's configuration (api/demoConfig.ts) as `pnpm dev:demo` serves it: no legal pages named. */
export function demoBuildConfig(): PublicConfig {
  const config = readDemoConfig({ VITE_DEMO: '1' });
  if (config === null) throw new Error('the demo configuration is missing');
  return config;
}

/** The static demo's built-in configuration (api/demoConfig.ts) for `STATIC_DEMO`'s settings. */
export function staticDemoConfig(): PublicConfig {
  const config = readDemoConfig({
    VITE_STATIC_DEMO: '1',
    VITE_APP_VERSION: '1.0.0',
    VITE_SOURCE_URL: STATIC_DEMO.source,
    VITE_LEGAL_IMPRESSUM_URL: STATIC_DEMO.impressum,
    VITE_LEGAL_PRIVACY_URL: STATIC_DEMO.privacy,
  });
  if (config === null) throw new Error('the static configuration is missing');
  return config;
}

/** The address a `fetch` call asked for. */
export function requestUrl(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : input instanceof URL ? input.href : input;
}

/** A request's JSON body (null without a text body). */
export function jsonBody(init: RequestInit | undefined): unknown {
  return typeof init?.body === 'string' ? JSON.parse(init.body) : null;
}

/** What a stubbed request carried: its JSON body parsed, any other text as it is, null without a text body. */
function recordedBody(init: RequestInit | undefined): unknown {
  try {
    return jsonBody(init);
  } catch {
    return init?.body;
  }
}

export interface BackendCall {
  readonly url: string;
  readonly init: RequestInit | undefined;
  /** The parsed JSON body (another text body as it is), null without one. */
  readonly body: unknown;
  readonly headers: Headers;
  /**
   * Whether the app called the request off: its signal aborted before the answer (src/test/requests.ts; under
   * StrictMode the first mount's clean-up calls off what its effect asked for).
   */
  readonly calledOff: () => boolean;
}

type Answer = (call: BackendCall) => Response | Promise<Response>;

export interface BackendOptions {
  /** What GET /api/config answers (usually `publicConfig(…)`); without it, that request fails too. */
  readonly config?: unknown;
  /** Answers by exact address. */
  readonly routes?: Readonly<Record<string, Answer>>;
  /** Answers every other request; without it, they fail as a dropped connection would. */
  readonly otherwise?: Answer;
  /** Holds every answer until `release()`, to look at the page while the backend is asked. */
  readonly held?: boolean;
}

export interface StubbedBackend {
  readonly fetch: Mock<typeof globalThis.fetch>;
  /** Every request, in order. */
  readonly calls: BackendCall[];
  /** The addresses asked for, in order. */
  readonly urls: () => string[];
  /** The addresses of the requests the app kept (none called off), in order: what a build asks for. */
  readonly keptUrls: () => string[];
  /** The JSON bodies sent to `url`, in order. */
  readonly bodies: (url: string) => unknown[];
  /** Lets held answers through. */
  readonly release: () => void;
}

/**
 * Stands the backend in as the global `fetch` (undone by `vi.unstubAllGlobals`). A request whose signal is already
 * aborted is refused as the browser refuses it.
 */
export function stubBackend(options: BackendOptions = {}): StubbedBackend {
  const calls: BackendCall[] = [];
  let release = (): void => undefined;
  const released =
    options.held === true
      ? new Promise<void>((resolve) => {
          release = resolve;
        })
      : Promise.resolve();
  const routes: Record<string, Answer> = { ...options.routes };
  if (options.config !== undefined && routes['/api/config'] === undefined)
    routes['/api/config'] = () => Response.json(options.config);
  const answerOf = (call: BackendCall): Promise<Response> => {
    if (call.init?.signal?.aborted === true) return Promise.reject(new DOMException('aborted', 'AbortError'));
    const answer = routes[call.url] ?? options.otherwise;
    if (answer === undefined) return Promise.reject(new TypeError(`unexpected request to ${call.url}`));
    return released.then(() => answer(call));
  };
  const fetch = vi.fn<typeof globalThis.fetch>((input, init) => {
    let calledOff = (): boolean => false;
    const call: BackendCall = {
      url: requestUrl(input),
      init,
      body: recordedBody(init),
      headers: new Headers(init?.headers),
      calledOff: () => calledOff(),
    };
    calls.push(call);
    const answered = answerOf(call);
    calledOff = watchRequest(init?.signal, answered);
    return answered;
  });
  vi.stubGlobal('fetch', fetch);
  return {
    fetch,
    calls,
    urls: () => calls.map((call) => call.url),
    keptUrls: () => calls.filter((call) => !call.calledOff()).map((call) => call.url),
    bodies: (url) => calls.filter((call) => call.url === url).map((call) => call.body),
    release: () => {
      release();
    },
  };
}
