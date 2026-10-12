// SPDX-License-Identifier: MIT
import { screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState, type ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { expectNoAxeViolations } from '../test/axe';
import { renderInPage } from '../test/page';
import { SegmentedControl } from './SegmentedControl';

const LEVELS = ['auto', 'folders', 'projects', 'networks', 'all'] as const;
type Level = (typeof LEVELS)[number];

function Detail({ disabled }: { readonly disabled?: boolean }): ReactElement {
  const [value, setValue] = useState<Level>('auto');
  return (
    <SegmentedControl
      label="Detail"
      options={LEVELS.map((level) => ({
        value: level,
        label: level.charAt(0).toUpperCase() + level.slice(1),
      }))}
      value={value}
      onChange={setValue}
      {...(disabled === true ? { disabled: true } : {})}
    />
  );
}

const checked = (): string | undefined =>
  screen.getAllByRole('radio').find((radio) => radio.getAttribute('aria-checked') === 'true')?.textContent ??
  undefined;

describe('SegmentedControl (radio group)', () => {
  it('is a named radio group with one tab stop on the checked option', async () => {
    renderInPage(<Detail />);
    expect(screen.getByRole('radiogroup', { name: 'Detail' })).toBeDefined();
    const radios = screen.getAllByRole('radio');
    expect(radios.map((radio) => radio.tabIndex)).toEqual([0, -1, -1, -1, -1]);
    expect(checked()).toBe('Auto');
    await expectNoAxeViolations();
  });

  it('moves and chooses with the arrows (wrapping), Home and End; a click chooses', async () => {
    renderInPage(<Detail />);
    screen.getAllByRole('radio')[0]?.focus();
    await userEvent.keyboard('{ArrowRight}{ArrowRight}');
    expect(checked()).toBe('Projects');
    expect(document.activeElement?.textContent).toBe('Projects');
    await userEvent.keyboard('{End}{ArrowRight}');
    expect(checked()).toBe('Auto');
    await userEvent.keyboard('{ArrowLeft}');
    expect(checked()).toBe('All');
    await userEvent.keyboard('{Home}');
    expect(checked()).toBe('Auto');
    await userEvent.click(screen.getByRole('radio', { name: 'Networks' }));
    expect(checked()).toBe('Networks');
    expect(screen.getAllByRole('radio').map((radio) => radio.tabIndex)).toEqual([-1, -1, -1, 0, -1]);
  });

  it('is inert when disabled: focusable, chooses nothing', async () => {
    renderInPage(<Detail disabled />);
    expect(screen.getByRole('radiogroup', { name: 'Detail' }).getAttribute('aria-disabled')).toBe('true');
    screen.getAllByRole('radio')[0]?.focus();
    await userEvent.keyboard('{ArrowRight}');
    await userEvent.click(screen.getByRole('radio', { name: 'All' }));
    expect(checked()).toBe('Auto');
    await expectNoAxeViolations();
  });
});
