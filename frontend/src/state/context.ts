// SPDX-License-Identifier: MIT
import { createContext } from 'react';

import type { AppStore } from './store';

/** The app store; AppStateProvider supplies it. */
export const AppStoreContext = createContext<AppStore | null>(null);
