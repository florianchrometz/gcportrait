// SPDX-License-Identifier: Apache-2.0
import { render, type RenderResult } from '@testing-library/react';
import type { ReactNode } from 'react';

/**
 * Renders `children` the way a page holds them (a main landmark with a level-1 heading), so axe judges the
 * component and not the missing page around it.
 */
export function renderInPage(children: ReactNode): RenderResult {
  return render(
    <main>
      <h1>Test page</h1>
      {children}
      <button type="button">outside</button>
    </main>,
  );
}
