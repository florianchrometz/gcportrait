// SPDX-License-Identifier: MIT
import { createContext, useContext } from 'react';

import type { PublicConfig } from './api/config';
import { readStaticConfig, type StaticDemoEnv } from './api/staticConfig';
import { DEFAULT_SOURCE_URL, readSourceUrl } from './source';

/**
 * How the app runs. Demo mode (`VITE_DEMO=1`, `pnpm dev:demo`) uses synthetic organisations only and never
 * calls the backend, so it works without Google Cloud, without a backend, and offline (agents.md, Product rules).
 * `sourceUrl` is the build-time target of the footer's "Source (MIT)" link (VITE_SOURCE_URL, source.ts):
 * all demo mode has, and live mode's fallback until (or unless) the backend's /api/config names its own.
 * `staticConfig` is the static demo's built-in configuration (`VITE_STATIC_DEMO=1`, `pnpm demo:static`;
 * api/staticConfig.ts): set, the app runs as on a demo-only instance without asking any backend; absent or null, live
 * mode asks GET /api/config.
 */
export type AppMode = {
  readonly demo: boolean;
  readonly sourceUrl: string;
  readonly staticConfig?: PublicConfig | null;
};

export function readAppMode(
  env: StaticDemoEnv & {
    readonly VITE_DEMO?: string | undefined;
  },
): AppMode {
  const staticConfig = readStaticConfig(env);
  if (env.VITE_DEMO === '1' && staticConfig !== null) {
    throw new Error('VITE_DEMO=1 and VITE_STATIC_DEMO=1 exclude each other: build one or the other.');
  }
  return {
    demo: env.VITE_DEMO === '1',
    sourceUrl: readSourceUrl(env.VITE_SOURCE_URL),
    ...(staticConfig === null ? {} : { staticConfig }),
  };
}

export const AppModeContext = createContext<AppMode>({ demo: false, sourceUrl: DEFAULT_SOURCE_URL });

export function useAppMode(): AppMode {
  return useContext(AppModeContext);
}
