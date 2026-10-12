// SPDX-License-Identifier: MIT
/**
 * A binary min-heap of search states for the routers' A* searches, on typed arrays that grow by doubling (the
 * searches push millions of entries on a large layout, so nothing is allocated per entry). Entries are ordered
 * by priority, then by a tie key (the remaining-distance estimate: the state closer to the goal first), then by
 * state number, so the search visits states in the same order on every run.
 */
export class StateHeap {
  private priority = new Float64Array(1024);
  private tie = new Float64Array(1024);
  private state = new Int32Array(1024);
  private count = 0;

  get size(): number {
    return this.count;
  }

  clear(): void {
    this.count = 0;
  }

  private grow(): void {
    const capacity = this.state.length * 2;
    const priority = new Float64Array(capacity);
    priority.set(this.priority);
    const tie = new Float64Array(capacity);
    tie.set(this.tie);
    const state = new Int32Array(capacity);
    state.set(this.state);
    this.priority = priority;
    this.tie = tie;
    this.state = state;
  }

  push(priority: number, tie: number, state: number): void {
    if (this.count === this.state.length) this.grow();
    const p = this.priority;
    const t = this.tie;
    const s = this.state;
    let i = this.count;
    this.count += 1;
    while (i > 0) {
      const up = (i - 1) >> 1;
      const upPriority = p[up] as number;
      const upTie = t[up] as number;
      const upState = s[up] as number;
      if (
        upPriority < priority ||
        (upPriority === priority && (upTie < tie || (upTie === tie && upState < state)))
      )
        break;
      p[i] = upPriority;
      t[i] = upTie;
      s[i] = upState;
      i = up;
    }
    p[i] = priority;
    t[i] = tie;
    s[i] = state;
  }

  /** Removes and returns the first state; -1 when empty. */
  pop(): number {
    if (this.count === 0) return -1;
    const p = this.priority;
    const t = this.tie;
    const s = this.state;
    const top = s[0] as number;
    this.count -= 1;
    const n = this.count;
    if (n === 0) return top;
    const priority = p[n] as number;
    const tie = t[n] as number;
    const state = s[n] as number;
    let i = 0;
    for (;;) {
      let child = i * 2 + 1;
      if (child >= n) break;
      const right = child + 1;
      if (right < n) {
        const lp = p[child] as number;
        const rp = p[right] as number;
        if (
          rp < lp ||
          (rp === lp &&
            ((t[right] as number) < (t[child] as number) ||
              ((t[right] as number) === (t[child] as number) && (s[right] as number) < (s[child] as number))))
        )
          child = right;
      }
      const cp = p[child] as number;
      const ct = t[child] as number;
      const cs = s[child] as number;
      if (priority < cp || (priority === cp && (tie < ct || (tie === ct && state < cs)))) break;
      p[i] = cp;
      t[i] = ct;
      s[i] = cs;
      i = child;
    }
    p[i] = priority;
    t[i] = tie;
    s[i] = state;
    return top;
  }
}
