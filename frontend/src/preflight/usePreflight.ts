// SPDX-License-Identifier: MIT
/**
 * Runs the permission check for the scope, mode and quota project in the app store (`connect`), and keeps its
 * result there (`connect.preflight`), so the Connect page and the Permissions page show the same one. One check at
 * a time per store: a newer one cancels the older. A result is forgotten when the person signs out.
 */
import { useCallback, useEffect } from 'react';

import { useAuth } from '../auth';
import { useAppState, useAppStore, type AppStore } from '../state';
import { requestPreflight, type PreflightRequest } from './api';
import { IDLE_PREFLIGHT, sameRequest, type PreflightState } from './state';

export interface PreflightControls {
  /** What a check would ask now, or null while no scope is picked. */
  readonly request: PreflightRequest | null;
  readonly state: PreflightState;
  /** The result on show answers another scope, mode or quota project than the ones picked now. */
  readonly stale: boolean;
  /** Whether a check can run (signed in, a scope picked). */
  readonly canCheck: boolean;
  readonly check: () => void;
}

/** The check in flight per store, so a newer one cancels it. */
const inFlight = new WeakMap<AppStore, AbortController>();

export function usePreflight(): PreflightControls {
  const store = useAppStore();
  const auth = useAuth();
  const scope = useAppState((state) => state.connect.scope);
  const mode = useAppState((state) => state.connect.mode);
  const quotaProject = useAppState((state) => state.connect.quotaProject);
  const state = useAppState((state) => state.connect.preflight);
  const status = useAppState((state) => state.connect.session.status);

  const request: PreflightRequest | null =
    scope === null
      ? null
      : {
          scope: scope.scope,
          mode,
          ...(mode === 'user' && quotaProject !== null ? { quotaProject } : {}),
        };
  const signedIn = status === 'signed-in';

  useEffect(() => {
    if (status !== 'signed-out' && status !== 'unavailable') return;
    inFlight.get(store)?.abort();
    store.updateConnect((connect) =>
      connect.preflight.status === 'idle' ? connect : { ...connect, preflight: IDLE_PREFLIGHT },
    );
  }, [status, store]);

  const scopeName = request?.scope;
  const requestMode = request?.mode;
  const requestQuota = request?.quotaProject;
  const check = useCallback((): void => {
    if (scopeName === undefined || requestMode === undefined || !signedIn) return;
    const asked: PreflightRequest = {
      scope: scopeName,
      mode: requestMode,
      ...(requestQuota === undefined ? {} : { quotaProject: requestQuota }),
    };
    inFlight.get(store)?.abort();
    const controller = new AbortController();
    inFlight.set(store, controller);
    store.updateConnect((connect) => ({ ...connect, preflight: { status: 'checking', request: asked } }));
    const settle = (next: PreflightState): void => {
      if (controller.signal.aborted) return;
      inFlight.delete(store);
      store.updateConnect((connect) => ({ ...connect, preflight: next }));
    };
    requestPreflight(auth, asked, controller.signal).then(
      (outcome) => {
        switch (outcome.kind) {
          case 'answer':
            settle({ status: 'done', request: asked, answer: outcome.answer });
            return;
          case 'signed-out':
            settle({
              status: 'failed',
              request: asked,
              message: 'Your sign-in has ended. Sign in again, then check again.',
            });
            return;
          case 'error':
            settle({ status: 'failed', request: asked, message: outcome.message });
        }
      },
      () => {
        // Cancelled by a newer check or a sign-out: that one reports.
      },
    );
  }, [auth, store, scopeName, requestMode, requestQuota, signedIn]);

  const stale = request !== null && state.status !== 'idle' && !sameRequest(state.request, request);
  return { request, state, stale, canCheck: request !== null && signedIn, check };
}
