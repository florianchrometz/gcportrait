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

  it('keeps its name when its label is hidden from sight, and shows the label otherwise', async () => {
    const slider = (hideLabel?: boolean): ReactElement => (
      <Slider
        label="Timeline"
        min={0}
        max={34}
        value={34}
        onChange={() => undefined}
        {...(hideLabel === undefined ? {} : { hideLabel })}
      />
    );
    const labelOf = (): HTMLElement | null =>
      document.getElementById(
        screen.getByRole('slider', { name: 'Timeline' }).getAttribute('aria-labelledby') ?? '',
      );
    const { unmount } = renderInPage(slider(true));
    expect(labelOf()?.className).toBe('visually-hidden');
    await expectNoAxeViolations();
    unmount();
    for (const shown of [false, undefined]) {
      const view = renderInPage(slider(shown));
      expect(labelOf()?.classList.contains('visually-hidden')).toBe(false);
      view.unmount();
    }
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
    fireEvent.pointerDown(track, { buttons: 1, clientX: 100, pointerId: 1 });
    expect(slider.getAttribute('aria-valuenow')).toBe('0');
    expect(document.activeElement).toBe(slider);
    // A drag's moves carry the primary button (`buttons` 1), a finger's and a pen's tip's as a mouse's.
    fireEvent.pointerMove(track, { buttons: 1, clientX: 270, pointerId: 1 });
    expect(slider.getAttribute('aria-valuenow')).toBe('17');
    fireEvent.pointerUp(track, { pointerId: 1 });
    fireEvent.pointerMove(track, { buttons: 1, clientX: 440, pointerId: 1 });
    expect(slider.getAttribute('aria-valuenow')).toBe('17');
  });

  it.each([
    { pointerType: 'mouse', button: 2, held: 2, by: "a mouse's right button" },
    { pointerType: 'mouse', button: 1, held: 4, by: "a mouse's middle button" },
    { pointerType: 'pen', button: 2, held: 2, by: "a pen's barrel button" },
  ])(
    'ends a drag when the primary button comes up while $by is held, as a native range input does',
    ({ pointerType, button, held }) => {
      renderInPage(<Timeline />);
      const slider = screen.getByRole('slider', { name: 'Timeline' });
      const track = laidOutTrack(slider);
      const captured: number[] = [];
      const released: number[] = [];
      track.setPointerCapture = (pointerId) => {
        captured.push(pointerId);
      };
      track.hasPointerCapture = (pointerId) => captured.includes(pointerId) && !released.includes(pointerId);
      track.releasePointerCapture = (pointerId) => {
        released.push(pointerId);
      };
      fireEvent.pointerDown(track, { button: 0, buttons: 1, clientX: 270, pointerId: 1, pointerType });
      expect(slider.getAttribute('aria-valuenow')).toBe('17');
      // The other button pressed during the drag (a move with both held): the drag goes on.
      fireEvent.pointerMove(track, { button, buttons: 1 | held, clientX: 250, pointerId: 1, pointerType });
      expect(slider.getAttribute('aria-valuenow')).toBe('15');
      // The primary button released while the other is held: no pointerup until the last button is up, only a
      // move whose `buttons` lacks the primary bit. The drag ends there, the pointer's capture let go, and the
      // value stays where it was, for that move and every one after it.
      fireEvent.pointerMove(track, { button: 0, buttons: held, clientX: 200, pointerId: 1, pointerType });
      expect(slider.getAttribute('aria-valuenow')).toBe('15');
      expect(released).toEqual([1]);
      fireEvent.pointerMove(track, { button: -1, buttons: held, clientX: 120, pointerId: 1, pointerType });
      expect(slider.getAttribute('aria-valuenow')).toBe('15');
      // The other button up: the pointerup, and moves without a button after it.
      fireEvent.pointerUp(track, { button, buttons: 0, clientX: 120, pointerId: 1, pointerType });
      fireEvent.pointerMove(track, { button: -1, buttons: 0, clientX: 440, pointerId: 1, pointerType });
      expect(slider.getAttribute('aria-valuenow')).toBe('15');
      expect(document.activeElement).toBe(slider);
      // A new press of the primary button drags as ever.
      fireEvent.pointerDown(track, { button: 0, buttons: 1, clientX: 100, pointerId: 1, pointerType });
      fireEvent.pointerMove(track, { button: -1, buttons: 1, clientX: 140, pointerId: 1, pointerType });
      expect(slider.getAttribute('aria-valuenow')).toBe('4');
      expect(captured).toEqual([1, 1]);
    },
  );

  it("follows the pointer that drags it only: a hovering mouse neither moves nor ends a finger's drag", () => {
    renderInPage(<Timeline />);
    const slider = screen.getByRole('slider', { name: 'Timeline' });
    const track = laidOutTrack(slider);
    fireEvent.pointerDown(track, { button: 0, buttons: 1, clientX: 270, pointerId: 1, pointerType: 'touch' });
    expect(slider.getAttribute('aria-valuenow')).toBe('17');
    // A mouse moved over the track meanwhile, no button held: another pointer's move.
    fireEvent.pointerMove(track, {
      button: -1,
      buttons: 0,
      clientX: 440,
      pointerId: 2,
      pointerType: 'mouse',
    });
    expect(slider.getAttribute('aria-valuenow')).toBe('17');
    // The finger's drag goes on, and its lift ends it.
    fireEvent.pointerMove(track, {
      button: -1,
      buttons: 1,
      clientX: 300,
      pointerId: 1,
      pointerType: 'touch',
    });
    expect(slider.getAttribute('aria-valuenow')).toBe('20');
    fireEvent.pointerUp(track, { button: 0, buttons: 0, clientX: 300, pointerId: 1, pointerType: 'touch' });
    fireEvent.pointerMove(track, {
      button: -1,
      buttons: 0,
      clientX: 100,
      pointerId: 2,
      pointerType: 'mouse',
    });
    expect(slider.getAttribute('aria-valuenow')).toBe('20');
  });

  it('ends a drag the browser cancels', () => {
    renderInPage(<Timeline />);
    const slider = screen.getByRole('slider', { name: 'Timeline' });
    const track = laidOutTrack(slider);
    fireEvent.pointerDown(track, { button: 0, buttons: 1, clientX: 270, pointerId: 1, pointerType: 'touch' });
    fireEvent.pointerCancel(track, { pointerId: 1, pointerType: 'touch' });
    fireEvent.pointerMove(track, {
      button: -1,
      buttons: 1,
      clientX: 440,
      pointerId: 1,
      pointerType: 'touch',
    });
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
      fireEvent.pointerDown(track, { buttons: 1, clientX: 300, pointerId: 2, pointerType });
      fireEvent.pointerMove(track, { buttons: 1, clientX: 310, pointerId: 2, pointerType });
      fireEvent.pointerUp(track, { clientX: 310, pointerId: 2, pointerType });
      expect(slider.getAttribute('aria-valuenow')).toBe('21');
      expect(pointerMark(slider)).toBeNull();
    },
  );

  it.each([
    { pointerType: 'mouse', button: 2, by: "a mouse's right button" },
    { pointerType: 'mouse', button: 1, by: "a mouse's middle button" },
    { pointerType: 'pen', button: 2, by: "a pen's barrel button" },
    { pointerType: 'pen', button: 5, by: "a pen's eraser" },
  ])('moves nothing on a press of $by, as a native range input does', ({ pointerType, button }) => {
    renderInPage(<Timeline />);
    const slider = screen.getByRole('slider', { name: 'Timeline' });
    const track = laidOutTrack(slider);
    const captured: number[] = [];
    track.setPointerCapture = (pointerId) => {
      captured.push(pointerId);
    };
    const outside = screen.getByRole('button', { name: 'outside' });
    outside.focus();
    // Neither the value, nor focus, nor the mark; no drag and no capture. Its default is prevented, so the browser
    // does not move focus off the track either (a right press's context menu is not a default of the press).
    expect(fireEvent.pointerDown(track, { button, clientX: 100, pointerId: 1, pointerType })).toBe(false);
    fireEvent.pointerMove(track, { clientX: 270, pointerId: 1, pointerType });
    fireEvent.pointerUp(track, { button, clientX: 270, pointerId: 1, pointerType });
    expect(slider.getAttribute('aria-valuenow')).toBe('34');
    expect(document.activeElement).toBe(outside);
    expect(pointerMark(slider)).toBeNull();
    expect(captured).toEqual([]);
    // The primary button (a mouse's left, a pen's tip) presses and drags as ever.
    expect(
      fireEvent.pointerDown(track, { button: 0, buttons: 1, clientX: 100, pointerId: 2, pointerType }),
    ).toBe(false);
    expect(slider.getAttribute('aria-valuenow')).toBe('0');
    expect(document.activeElement).toBe(slider);
    expect(pointerMark(slider)).toBe('true');
    expect(captured).toEqual([2]);
    fireEvent.pointerMove(track, { buttons: 1, clientX: 270, pointerId: 2, pointerType });
    fireEvent.pointerUp(track, { button: 0, clientX: 270, pointerId: 2, pointerType });
    expect(slider.getAttribute('aria-valuenow')).toBe('17');
    // Nor does a press of the other button move the thumb that has focus now, which keeps it and its mark.
    fireEvent.pointerDown(track, { button, clientX: 440, pointerId: 3, pointerType });
    fireEvent.pointerUp(track, { button, clientX: 440, pointerId: 3, pointerType });
    expect(slider.getAttribute('aria-valuenow')).toBe('17');
    expect(document.activeElement).toBe(slider);
    expect(pointerMark(slider)).toBe('true');
  });

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
    const track = laidOutTrack(slider);
    const outside = screen.getByRole('button', { name: 'outside' });
    outside.focus();
    // A press and a drag neither move nor focus it. The press's default is prevented, as an active slider's is,
    // so the browser leaves focus where it is rather than moving it to the page (a right press's context menu is
    // not a default of the press).
    expect(fireEvent.pointerDown(track, { button: 0, buttons: 1, clientX: 100, pointerId: 1 })).toBe(false);
    fireEvent.pointerMove(track, { buttons: 1, clientX: 270, pointerId: 1 });
    fireEvent.pointerUp(track, { button: 0, buttons: 0, clientX: 270, pointerId: 1 });
    expect(document.activeElement).toBe(outside);
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
