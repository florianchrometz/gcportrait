// SPDX-License-Identifier: Apache-2.0
import { afterAll, describe, expect, it, vi } from 'vitest';
import { run } from './generate-metrics.js';

describe('the metrics command', () => {
  const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  afterAll(() => {
    write.mockRestore();
  });

  it('finds the committed table byte for byte what it writes (--check), under a banner that names the command', async () => {
    expect(await run(['--check'])).toBe(0);
    expect(write).toHaveBeenCalledWith('gcportrait layout metrics\n');
    expect(write).not.toHaveBeenCalledWith(expect.stringMatching(/affiliated/i));
    expect(write).toHaveBeenCalledWith(expect.stringContaining('is up to date'));
  });
});
