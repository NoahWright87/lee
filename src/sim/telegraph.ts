// Telegraphs: "something will hit this spot in N seconds." The red X is drawn
// from these and only these. Shells use them today; Ness surfacing, bombs, etc.
// can create them the same way with their own warning time.

import type { Vec } from './math';

/** 'shell' = a red X (scaled by `size` for big splashes); 'area' = a shaded disk of `size` meters (a burst of pellets). */
export type TelegraphKind = 'shell' | 'area';

export interface Telegraph {
  id: number;
  kind: TelegraphKind;
  pos: Vec;
  /** Seconds from creation to impact. */
  warnTime: number;
  elapsed: number;
  /** Seconds left to linger after impact (render fade-out). */
  linger: number;
  impacted: boolean;
  /** X size multiplier ('shell') or disk radius in meters ('area'). */
  size: number;
}

export class TelegraphSystem {
  readonly list: Telegraph[] = [];
  private nextId = 1;

  add(kind: TelegraphKind, pos: Vec, warnTime: number, linger: number, size = 1): Telegraph {
    const t: Telegraph = { id: this.nextId++, kind, pos: { ...pos }, warnTime, elapsed: 0, linger, impacted: false, size };
    this.list.push(t);
    return t;
  }

  /** 0 at creation → 1 at impact. */
  static progress(t: Telegraph): number {
    return t.warnTime > 0 ? Math.min(1, t.elapsed / t.warnTime) : 1;
  }

  step(dt: number): void {
    for (const t of this.list) {
      t.elapsed += dt;
      if (!t.impacted && t.elapsed >= t.warnTime) t.impacted = true;
      else if (t.impacted) t.linger -= dt;
    }
    for (let i = this.list.length - 1; i >= 0; i--) {
      if (this.list[i].impacted && this.list[i].linger <= 0) this.list.splice(i, 1);
    }
  }
}
