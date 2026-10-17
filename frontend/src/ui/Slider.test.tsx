// SPDX-License-Identifier: MIT
import { fireEvent, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState, type ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { expectNoAxeViolations } from '../test/axe';
import { renderInPage } from '../test/page';
import { clampToStep, Slider } from './Slider';

/** The slider's track, laid out from x 100 at ten pixels per day of the 0 to 34 range (jsdom lays nothing out). */
function laidOutTrack(slider: HTMLElement): HTMLElement {
  const track = slider.parentElement;
  if (track === null) throw new Error('no track');
  track.getBoundingClientRect = () => DOMRect.fromRect({ x: 100, y: 0, width: 340, height: 4 });
  return track;
}

/** The mark that hides the focus ring of a thumb a pointer's press focused (null without it). */
function pointerMark(slider: HTMLElement): string | null {
  return slider.getAttribute('data-pointer-focus');
}

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
    const track = laidOutTrack(slider);
    fireEvent.pointerDown(track, { clientX: 100, pointerId: 1 });
    expect(slider.getAttribute('aria-valuenow')).toBe('0');
    expect(document.activeElement).toBe(slider);
    fireEvent.pointerMove(track, { clientX: 270, pointerId: 1 });
    expect(slider.getAttribute('aria-valuenow')).toBe('17');
    fireEvent.pointerUp(track, { pointerId: 1 });
    fireEvent.pointerMove(track, { clientX: 440, pointerId: 1 });
    expect(slider.getAttribute('aria-valuenow')).toBe('17');
  });

  it.each([
    { pointerType: 'mouse', by: 'a mouse' },
    { pointerType: 'pen', by: 'a pen' },
    { pointerType: 'touch', by: 'a finger' },
  ])(
    'hides the ring of a thumb that $by pressed into focus until a key is pressed on it, as on a native range input',
    async ({ pointerType }) => {
      renderInPage(<Timeline />);
      const slider = screen.getByRole('slider', { name: 'Timeline' });
      const track = laidOutTrack(slider);
      expect(pointerMark(slider)).toBeNull();
      fireEvent.pointerDown(track, { clientX: 270, pointerId: 1, pointerType });
      fireEvent.pointerUp(track, { clientX: 270, pointerId: 1, pointerType });
      expect(document.activeElement).toBe(slider);
      expect(slider.getAttribute('aria-valuenow')).toBe('17');
      expect(pointerMark(slider)).toBe('true');
      // A shortcut with Ctrl, Alt or Meta leaves the mark, as it leaves a native range input's ring off.
      fireEvent.keyDown(slider, { key: 'c', ctrlKey: true });
      fireEvent.keyDown(slider, { key: 'Alt', altKey: true });
      fireEvent.keyDown(slider, { key: 'Meta', metaKey: true });
      expect(pointerMark(slider)).toBe('true');
      // The window losing focus leaves focus on the thumb, and the mark with it.
      fireEvent.blur(slider);
      expect(document.activeElement).toBe(slider);
      expect(pointerMark(slider)).toBe('true');
      // The first key takes it off, so the ring shows again; the key moves the thumb as ever.
      await userEvent.keyboard('{ArrowLeft}');
      expect(pointerMark(slider)).toBeNull();
      expect(slider.getAttribute('aria-valuenow')).toBe('16');
      // A drag along the track after it: the thumb has focus already, and its ring stays.
      fireEvent.pointerDown(track, { clientX: 300, pointerId: 2, pointerType });
      fireEvent.pointerMove(track, { clientX: 310, pointerId: 2, pointerType });
      fireEvent.pointerUp(track, { clientX: 310, pointerId: 2, pointerType });
      expect(slider.getAttribute('aria-valuenow')).toBe('21');
      expect(pointerMark(slider)).toBeNull();
    },
  );

  it('takes the mark off when focus leaves the thumb, and Tab back to it shows the ring', async () => {
    renderInPage(<Timeline />);
    const slider = screen.getByRole('slider', { name: 'Timeline' });
    const track = laidOutTrack(slider);
    fireEvent.pointerDown(track, { clientX: 270, pointerId: 1 });
    fireEvent.pointerUp(track, { clientX: 270, pointerId: 1 });
    expect(pointerMark(slider)).toBe('true');
    await userEvent.click(screen.getByRole('button', { name: 'outside' }));
    expect(document.activeElement).not.toBe(slider);
    expect(pointerMark(slider)).toBeNull();
    await userEvent.tab({ shift: true });
    expect(document.activeElement).toBe(slider);
    expect(pointerMark(slider)).toBeNull();
    // A press on the thumb that has keyboard focus leaves its ring as it is.
    fireEvent.pointerDown(track, { clientX: 100, pointerId: 2 });
    fireEvent.pointerUp(track, { clientX: 100, pointerId: 2 });
    expect(slider.getAttribute('aria-valuenow')).toBe('0');
    expect(pointerMark(slider)).toBeNull();
    // A press that moves focus to it from elsewhere marks it again; Tab away and back by Shift+Tab: no mark.
    await userEvent.click(screen.getByRole('button', { name: 'outside' }));
    fireEvent.pointerDown(track, { clientX: 100, pointerId: 3 });
    fireEvent.pointerUp(track, { clientX: 100, pointerId: 3 });
    expect(pointerMark(slider)).toBe('true');
    await userEvent.tab();
    expect(document.activeElement).not.toBe(slider);
    await userEvent.tab({ shift: true });
    expect(document.activeElement).toBe(slider);
    expect(pointerMark(slider)).toBeNull();
  });

  it('is inert when disabled', async () => {
    renderInPage(<Timeline disabled />);
    const slider = screen.getByRole('slider', { name: 'Timeline' });
    expect(slider.getAttribute('aria-disabled')).toBe('true');
    // A press neither moves nor focuses it.
    fireEvent.pointerDown(laidOutTrack(slider), { clientX: 100, pointerId: 1 });
    expect(document.activeElement).not.toBe(slider);
    expect(pointerMark(slider)).toBeNull();
    expect(slider.getAttribute('aria-valuenow')).toBe('34');
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
