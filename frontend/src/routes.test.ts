// @vitest-environment node
// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';

import { appPath, DIAGRAM_PATH, routerBasename } from './routes';

describe('the base path (the static demo below /demo/)', () => {
  it('gives the router no basename at the root, and the path without its slash below it', () => {
    expect(routerBasename('/')).toBe('/');
    expect(routerBasename('/demo/')).toBe('/demo');
    expect(routerBasename('/a/b/')).toBe('/a/b');
  });

  it('puts an app path below the base', () => {
    expect(appPath(DIAGRAM_PATH, '/')).toBe('/diagram');
    expect(appPath(DIAGRAM_PATH, '/demo/')).toBe('/demo/diagram');
  });
});
