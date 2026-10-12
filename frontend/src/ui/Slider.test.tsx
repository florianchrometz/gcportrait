// SPDX-License-Identifier: MIT
import { fireEvent, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState, type ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { expectNoAxeViolations } from '../test/axe';
import { renderInPage } from '../test/page';
import { clampToStep, Slider } from './Slider';

function Timeline({ disabled }: { readonly disabled?: boolean }): ReactElement {
  const [day, setDay] = useState(34);
  return (
    <Slider
      label="Timeline"
      min={0}
      max={34}
      value={day}
      onChange={setDay}
      valueText={(value) => `day ${String(value + 1)} of 35`}
      {...(disabled === true ? { disabled: true } : {})}
    />
  );
}

describe('Slider', () => {
  it('is a named slider with its value as text', async () => {
    renderInPage(<Timeline />);
    const slider = screen.getByRole('slider', { name: 'Timeline' });
    expect(slider.getAttribute('aria-valuemin')).toBe('0');
    expect(slider.getAttribute('aria-valuemax')).toBe('34');
    expect(slider.getAttribute('aria-valuenow')).toBe('34');
    expect(slider.getAttribute('aria-valuetext')).toBe('day 35 of 35');
    await expectNoAxeViolations();
  });

  it('moves with the arrows, Page Up/Down, Home and End, within its range', async () => {
    renderInPage(<Timeline />);
    const slider = screen.getByRole('slider', { name: 'Timeline' });
    slider.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(slider.getAttribute('aria-valuenow')).toBe('34');
    await userEvent.keyboard('{ArrowLeft}{ArrowDown}');
    expect(slider.getAttribute('aria-valuenow')).toBe('32');
    await userEvent.keyboard('{PageDown}');
    expect(slider.getAttribute('aria-valuenow')).toBe('29');
    await userEvent.keyboard('{Home}');
    expect(slider.getAttribute('aria-valuetext')).toBe('day 1 of 35');
    await userEvent.keyboard('{PageUp}{ArrowUp}');
    expect(slider.getAttribute('aria-valuenow')).toBe('4');
    await userEvent.keyboard('{End}');
    expect(slider.getAttribute('aria-valuenow')).toBe('34');
  });

  it('follows a press and a drag on the track', () => {
    renderInPage(<Timeline />);
    const slider = screen.getByRole('slider', { name: 'Timeline' });
    const track = slider.parentElement;
    if (track === null) throw new Error('no track');
    track.getBoundingClientRect = () => DOMRect.fromRect({ x: 100, y: 0, width: 340, height: 4 });
    fireEvent.pointerDown(track, { clientX: 100, pointerId: 1 });
    expect(slider.getAttribute('aria-valuenow')).toBe('0');
    expect(document.activeElement).toBe(slider);
    fireEvent.pointerMove(track, { clientX: 270, pointerId: 1 });
    expect(slider.getAttribute('aria-valuenow')).toBe('17');
    fireEvent.pointerUp(track, { pointerId: 1 });
    fireEvent.pointerMove(track, { clientX: 440, pointerId: 1 });
    expect(slider.getAttribute('aria-valuenow')).toBe('17');
  });

  it('is inert when disabled', async () => {
    renderInPage(<Timeline disabled />);
    const slider = screen.getByRole('slider', { name: 'Timeline' });
    expect(slider.getAttribute('aria-disabled')).toBe('true');
    slider.focus();
    await userEvent.keyboard('{Home}');
    expect(slider.getAttribute('aria-valuenow')).toBe('34');
    await expectNoAxeViolations();
  });

  it('keeps values on the step grid', () => {
    expect(clampToStep(3.4, 0, 10, 1)).toBe(3);
    expect(clampToStep(0.36, 0, 1, 0.1)).toBe(0.4);
    expect(clampToStep(-4, 0, 10, 2)).toBe(0);
    expect(clampToStep(99, 0, 10, 3)).toBe(10);
  });
});
