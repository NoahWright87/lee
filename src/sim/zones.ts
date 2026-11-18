// Deck danger zones: "these tiles of this deck will be hit in N seconds." The same
// idea as the red X for shells, but on a deck. A zone is data: a boat, a warning
// time, and a SHAPE in the world (a rectangle from where an attack starts to where it
// lands, with a full-damage circle at the end). Each step the tiles under that shape
// are worked out afresh, so a boat that sails out from under it takes nothing, and the
// ⚠️ bubble (and any Lee told to step out) follows what is actually in danger. What a
// zone does when it lands is the world's job (`World.zoneImpact`).
//
// Tapping a zone's bubble sends the Lees standing in it to the nearest safe tiles (an
// order, see orders.ts).

import type { Boat } from './boat';
import { standingTile, type Lee } from './crew';
import { closestOnSegment, dist, toWorld, type Vec } from './math';
import type { World } from './world';

export type ZoneKind = 'bite';

/** Where a zone is in the world right now. */
export interface ZoneShape {
  /** The attack's start and end (world): a rectangle `width` wide between them. */
  a: Vec;
  b: Vec;
  width: number;
  /** The circle at `b` where it lands hardest, m. */
  tip: number;
  /** Damage along the rectangle outside the tip, as a share of the tip's. */
  neckShare: number;
}

export interface DangerZone {
  id: number;
  boat: Boat;
  kind: ZoneKind;
  /** Tiles under the shape right now, and how hard each is hit (1 at the tip, `neckShare` along the neck). */
  tiles: number[];
  weights: Map<number, number>;
  /** Seconds from creation to impact, and seconds elapsed. */
  warn: number;
  elapsed: number;
  impacted: boolean;
  /** Seconds left to linger after impact (drawn only). */
  linger: number;
  /** Who made it (a Ness id), or 0. */
  source: number;
  shape: () => ZoneShape;
}

const LINGER = 0.45;

/** The tiles of `boat` under a shape, with a weight each (the tip counts in full). */
export function tilesUnder(boat: Boat, s: ZoneShape): Map<number, number> {
  const out = new Map<number, number>();
  const half = Math.min(boat.grid.tileW, boat.grid.tileH) * 0.5;
  for (const t of boat.grid.tiles) {
    const c = toWorld(t.center, boat.motion, boat.motion.heading);
    if (dist(c, s.b) <= s.tip + half * 0.6) {
      out.set(t.index, 1);
      continue;
    }
    const q = closestOnSegment(c, s.a, s.b);
    if (dist(c, q) <= s.width / 2 + half * 0.6) out.set(t.index, Math.max(0, s.neckShare));
  }
  return out;
}

export class ZoneSystem {
  readonly list: DangerZone[] = [];
  private nextId = 1;

  add(z: { boat: Boat; warn: number; source: number; shape: () => ZoneShape }): DangerZone {
    const zone: DangerZone = { ...z, kind: 'bite', id: this.nextId++, tiles: [], weights: new Map(), elapsed: 0, impacted: false, linger: LINGER };
    this.refresh(zone);
    this.list.push(zone);
    return zone;
  }

  /** 0 → 1 as the impact nears. */
  static progress(z: DangerZone): number {
    return z.warn > 0 ? Math.min(1, z.elapsed / z.warn) : 1;
  }

  private refresh(z: DangerZone): void {
    z.weights = tilesUnder(z.boat, z.shape());
    z.tiles = [...z.weights.keys()];
  }

  /** Zones that have not landed yet. */
  pending(boat?: Boat): DangerZone[] {
    return this.list.filter((z) => !z.impacted && (!boat || z.boat === boat));
  }

  /** Is this Lee standing where something is about to land? */
  inDanger(lee: Lee): boolean {
    if (!lee.alive || lee.swing) return false;
    const tile = standingTile(lee);
    return this.list.some((z) => !z.impacted && z.boat === lee.deck && z.weights.get(tile)! > 0);
  }

  /** Drop what a Ness has put up (it fled, or died). */
  cancel(source: number): void {
    for (let i = this.list.length - 1; i >= 0; i--) if (this.list[i].source === source && !this.list[i].impacted) this.list.splice(i, 1);
  }

  step(w: World, dt: number): void {
    for (const z of this.list) {
      if (z.impacted) {
        z.linger -= dt;
        continue;
      }
      if (z.boat.sinkingSince !== null) {
        z.impacted = true;
        z.linger = 0;
        continue;
      }
      this.refresh(z);
      z.elapsed += dt;
      if (z.elapsed >= z.warn) {
        z.impacted = true;
        w.zoneImpact(z);
      }
    }
    for (let i = this.list.length - 1; i >= 0; i--) if (this.list[i].impacted && this.list[i].linger <= 0) this.list.splice(i, 1);
  }
}

/** Where a zone's bubble and impact are: the aim point, fixed in the world (it does not follow your boat; sail or step out of it). */
export function zoneCenter(z: DangerZone): Vec {
  return z.shape().b;
}

/** How far out from the aim point a tap still counts, m. */
export function zoneRadius(z: DangerZone): number {
  return z.shape().tip + 1;
}
