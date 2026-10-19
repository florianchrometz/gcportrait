// SPDX-License-Identifier: Apache-2.0
/**
 * The data worker's handler (pipeline/dataHandler.ts) in a test: requests sent under numbered ids, and each answer
 * awaited by its id as it is posted. Nothing here counts ticks or sleeps: an answer resolves the moment the handler
 * posts it however many steps it took, and a request that is never answered fails by the test's own timeout. The
 * waits use no timer, so they also work under `vi.useFakeTimers` (the handler's idle timer).
 */
import { normalizeViewSpec, type ViewSpecInput } from '@gcportrait/model';

import type { NodeDetails } from '../../drawer/types';
import { createDataHandler, type DataHandlerEnvironment } from '../pipeline/dataHandler';
import type { DataResponse, DataStage, SceneAnswer, Viewport } from '../pipeline/protocol';

/** The canvas size the tests ask for: the app's 1280 × 800 fallback. */
export const TEST_VIEWPORT: Viewport = { width: 1280, height: 800 };

export interface DataHarness {
  /** Every response posted so far, progress included, in order. */
  readonly responses: readonly DataResponse[];
  /** Sends `request` under the next id (any `id` it carries is replaced) and returns that id. */
  readonly send: (request: Readonly<Record<string, unknown>>) => number;
  /** Hands the handler `message` exactly as it is (a malformed request). */
  readonly sendRaw: (message: unknown) => void;
  /** The answer to request `id` (anything but its progress), once the handler posts it. */
  readonly answerTo: (id: number) => Promise<DataResponse>;
  /** Sends `request` and waits for its answer. */
  readonly ask: (request: Readonly<Record<string, unknown>>) => Promise<DataResponse>;
  /** The Scene answer for a view (and the day to compare it with), failing on any other answer. */
  readonly scene: (spec: ViewSpecInput, diffFrom?: unknown) => Promise<SceneAnswer>;
  /** The details drawer's facts about `node` on `day` (null: the snapshot's own day). */
  readonly details: (node: string, day: string | null, snapshot?: string) => Promise<NodeDetails | null>;
  /** The progress stages reported for request `id`. */
  readonly stages: (id: number) => DataStage[];
  /** The id of the request sent last. */
  readonly lastId: () => number;
}

const isAnswer = (response: DataResponse): boolean =>
  response.type !== 'progress' && response.type !== 'job-progress';

export function dataHarness(environment: DataHandlerEnvironment = {}): DataHarness {
  const responses: DataResponse[] = [];
  const waiting = new Map<number, Array<(response: DataResponse) => void>>();
  const handle = createDataHandler((response) => {
    responses.push(response);
    if (!isAnswer(response)) return;
    const waiters = waiting.get(response.id);
    waiting.delete(response.id);
    for (const resolve of waiters ?? []) resolve(response);
  }, environment);
  let id = 0;

  const send = (request: Readonly<Record<string, unknown>>): number => {
    id += 1;
    handle({ ...request, id });
    return id;
  };
  const answerTo = (asked: number): Promise<DataResponse> => {
    const posted = responses.find((response) => response.id === asked && isAnswer(response));
    if (posted !== undefined) return Promise.resolve(posted);
    return new Promise((resolve) => {
      waiting.set(asked, [...(waiting.get(asked) ?? []), resolve]);
    });
  };
  const ask = (request: Readonly<Record<string, unknown>>): Promise<DataResponse> => answerTo(send(request));

  return {
    responses,
    send,
    sendRaw: (message) => {
      handle(message);
    },
    answerTo,
    ask,
    async scene(spec, diffFrom) {
      const answer = await ask({
        type: 'scene',
        spec: normalizeViewSpec(spec),
        viewport: TEST_VIEWPORT,
        ...(diffFrom === undefined ? {} : { diffFrom }),
      });
      if (answer.type !== 'scene') throw new Error(`no Scene: ${JSON.stringify(answer)}`);
      return answer.answer;
    },
    async details(node, day, snapshot = 'demo:S') {
      const answer = await ask({ type: 'details', snapshot, node, day: { tick: day } });
      if (answer.type !== 'details') throw new Error(`no details: ${JSON.stringify(answer)}`);
      return answer.details;
    },
    stages: (asked) =>
      responses.flatMap((response) =>
        response.type === 'progress' && response.id === asked ? [response.stage] : [],
      ),
    lastId: () => id,
  };
}
