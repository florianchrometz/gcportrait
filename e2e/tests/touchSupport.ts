// SPDX-License-Identifier: Apache-2.0
import type { CDPSession, Page } from '@playwright/test';

/** A point on the screen, in CSS pixels. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * Fingers on the screen through the Chrome DevTools Protocol: drags, pinches and presses Playwright's taps
 * cannot do. touch.spec.ts drives the canvas with them, mobile.spec.ts the breadcrumb swipe and the details
 * drawer's handle. The browser makes its own pointer, mouse and click events of them, as on a phone.
 */
export class Fingers {
  private readonly client: CDPSession;

  private constructor(client: CDPSession) {
    this.client = client;
  }

  static async on(page: Page): Promise<Fingers> {
    return new Fingers(await page.context().newCDPSession(page));
  }

  private send(
    type: 'touchStart' | 'touchMove' | 'touchEnd',
    points: ReadonlyArray<Point & { readonly id?: number }>,
  ): Promise<unknown> {
    return this.client.send('Input.dispatchTouchEvent', { type, touchPoints: [...points] });
  }

  /** One finger from `from` to `to`, in `steps` moves; `lift: false` leaves it down for a later `lift`. */
  async drag(
    from: Point,
    to: Point,
    { steps = 10, lift = true }: { readonly steps?: number; readonly lift?: boolean } = {},
  ): Promise<void> {
    await this.send('touchStart', [{ x: from.x, y: from.y }]);
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      await this.send('touchMove', [{ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }]);
    }
    if (lift) await this.send('touchEnd', []);
  }

  /** Two fingers either side of `centre`, level with it, from `from` to `to` pixels apart, in `steps` moves. */
  async pinch(centre: Point, from: number, to: number, steps = 10): Promise<void> {
    const pair = (apart: number): Array<Point & { id: number }> => [
      { x: centre.x - apart / 2, y: centre.y, id: 0 },
      { x: centre.x + apart / 2, y: centre.y, id: 1 },
    ];
    await this.send('touchStart', pair(from));
    for (let step = 1; step <= steps; step += 1)
      await this.send('touchMove', pair(from + ((to - from) * step) / steps));
    await this.send('touchEnd', []);
  }

  /** A finger down at `at`, left there until `lift`. */
  async hold(at: Point): Promise<void> {
    await this.send('touchStart', [{ x: at.x, y: at.y }]);
  }

  async lift(): Promise<void> {
    await this.send('touchEnd', []);
  }
}
