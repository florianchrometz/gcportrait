// SPDX-License-Identifier: Apache-2.0
/**
 * A clipboard for the tests: jsdom's navigator has none of its own. Put on the real navigator (axe reads it too) and
 * taken away again after the test. Imported by tests only.
 */
import { onTestFinished, vi, type Mock } from 'vitest';

type WriteText = (text: string) => Promise<void>;

/** Gives the navigator a clipboard whose `writeText` is the returned mock (by default one that succeeds). */
export function stubClipboard(writeText: WriteText = () => Promise.resolve()): Mock<WriteText> {
  const mock = vi.fn<WriteText>(writeText);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: mock } });
  onTestFinished(() => {
    Reflect.deleteProperty(navigator, 'clipboard');
  });
  return mock;
}
