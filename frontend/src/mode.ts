// SPDX-License-Identifier: Apache-2.0
import { createContext, useContext } from 'react';

import type { PublicConfig } from './api/config';
import { readDemoConfig, type DemoConfigEnv } from './api/demoConfig';
import { DEFAULT_SOURCE_URL, readSourceUrl } from './source';

/**
 * How this build runs. `sourceUrl` is the build-time target of the footer's "Source (Apache-2.0)" link (VITE_SOURCE_URL,
 * source.ts), which live mode falls back to until (or unless) the backend's /api/config names its own.
 * `demoConfig` is the demo-only configuration built in when no backend answers (`VITE_DEMO=1`, `pnpm dev:demo`;
 * `VITE_STATIC_DEMO=1`, `pnpm demo:static`; api/demoConfig.ts): set, the app runs as on a demo-only instance and asks
 * nobody; null, live mode asks GET /api/config.
 */
export type AppMode = {
  readonly sourceUrl: string;
  readonly demoConfig: PublicConfig | null;
};

export function readAppMode(env: DemoConfigEnv): AppMode {
  if (env.VITE_DEMO === '1' && env.VITE_STATIC_DEMO === '1') {
    throw new Error('VITE_DEMO=1 and VITE_STATIC_DEMO=1 exclude each other: build one or the other.');
  }
  return {
    sourceUrl: readSourceUrl(env.VITE_SOURCE_URL),
    demoConfig: readDemoConfig(env),
  };
}

export const AppModeContext = createContext<AppMode>({
  sourceUrl: DEFAULT_SOURCE_URL,
  demoConfig: null,
});

export function useAppMode(): AppMode {
  return useContext(AppModeContext);
}
