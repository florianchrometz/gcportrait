// SPDX-License-Identifier: MIT
/**
 * The unit tests mount under StrictMode (setup.ts), as development does: on mount an effect runs, cleans up and
 * runs again, also in `renderApp`. The request log (requests.ts) counts what the app kept of what it asked for: the
 * request a clean-up calls off is left out, two requests of an effect whose clean-up forgets its own are both kept,
 * and a request aborted after its answer is still kept.
 */
import { render, screen } from '@testing-library/react';
import { useEffect, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { fakeLibrary } from '../snapshots/testing';
import { publicConfig, stubBackend } from './backend';
import { renderApp, WHOLE_APP_TIMEOUT } from './renderApp';
import { requestLog, type RequestLog } from './requests';

/** A component whose effect asks `log` for something, and aborts it in its clean-up if `callOff`. */
function Asking({ log, callOff }: { readonly log: RequestLog<string>; readonly callOff: boolean }): null {
  useEffect(() => {
    const controller = new AbortController();
    void log.record('asked', controller.signal, new Promise<never>(() => undefined));
    return () => {
      if (callOff) controller.abort();
    };
  }, [log, callOff]);
  return null;
}

describe('StrictMode in the unit tests', () => {
  it('runs each effect, its clean-up and the effect again when a component mounts', () => {
    const steps: string[] = [];
    function Probe(): ReactElement {
      useEffect(() => {
        steps.push('effect');
        return () => {
          steps.push('clean-up');
        };
      }, []);
      return <p>probe</p>;
    }
    const { unmount } = render(<Probe />);
    expect(steps).toEqual(['effect', 'clean-up', 'effect']);
    unmount();
    expect(steps).toEqual(['effect', 'clean-up', 'effect', 'clean-up']);
  });

  it(
    'mounts the whole app twice too: the first mount’s request for the configuration is called off',
    async () => {
      const backend = stubBackend({ config: publicConfig() });
      try {
        renderApp('/', { demoConfig: null, snapshots: fakeLibrary() });
        await screen.findByText(/Backend version 0\.0\.0-test/);
        expect(backend.urls()).toEqual(['/api/config', '/api/config']);
        expect(backend.calls.map((call) => call.calledOff())).toEqual([true, false]);
        expect(backend.keptUrls()).toEqual(['/api/config']);
      } finally {
        vi.unstubAllGlobals();
      }
    },
    WHOLE_APP_TIMEOUT.timeout,
  );
});

describe('requestLog', () => {
  it('leaves out the request a clean-up calls off', () => {
    const log = requestLog<string>();
    render(<Asking log={log} callOff />);
    expect(log.all()).toEqual(['asked', 'asked']);
    expect(log.kept()).toEqual(['asked']);
  });

  it('keeps both requests of an effect whose clean-up leaves its request running', () => {
    const log = requestLog<string>();
    render(<Asking log={log} callOff={false} />);
    expect(log.kept()).toEqual(['asked', 'asked']);
  });

  it('keeps a request aborted after its answer, and leaves out one aborted before it is made', async () => {
    const log = requestLog<string>();
    const answered = new AbortController();
    await log.record('answered', answered.signal, Promise.resolve('answer'));
    answered.abort();
    const early = new AbortController();
    early.abort();
    await log
      .record('aborted first', early.signal, Promise.reject(new DOMException('aborted', 'AbortError')))
      .catch(() => undefined);
    expect(log.all()).toEqual(['answered', 'aborted first']);
    expect(log.kept()).toEqual(['answered']);
  });
});
