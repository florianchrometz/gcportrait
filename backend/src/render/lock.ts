// SPDX-License-Identifier: MIT
/**
 * One render at a time per instance (agents.md, Exports and the render API): a render keeps the instance's
 * only CPU busy and holds hundreds of MiB, so a second one waits for another instance (Cloud Run adds them)
 * rather than sharing this one. In memory only; the lock is given back exactly once, however the render ends.
 */
export class RenderLock {
  #held = false;

  /** Takes the lock; returns the function that gives it back (idempotent), or null when a render runs. */
  acquire(): (() => void) | null {
    if (this.#held) return null;
    this.#held = true;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#held = false;
    };
  }

  /** Whether a render runs (tests: proves nothing leaks). */
  get held(): boolean {
    return this.#held;
  }
}
