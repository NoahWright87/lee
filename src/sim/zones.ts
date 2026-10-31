// Deck danger zones (Phase 8): "these tiles of this deck will be hit in N
// seconds." The same idea as the red X for shells, but on a deck: a set of tiles
// that flash during a warning time and then take an effect (damage, a push,
// water). Ness bites, head smashes and tail slaps use it; bosses and traps can
// too. A zone is data (kind, tiles, warning, which way it pushes); what it does
// when it lands is the world's job (`World.zoneImpact`), so a new attack is a
// new kind there, not a new system.
//
// Tapping a zone sends the Lees standing in it to the nearest safe tiles (an
// order, see orders.ts).

import type { Boat } from './boat';
import { sideFacing, type ContactSide } from './contact';
import { standingTile, type Lee } from './crew';
import { dist, toLocal, toWorld, type Vec } from './math';
import type { World } from './world';

export type ZoneKind = 'bite' | 'smash' | 'slap';

export interface DangerZone {
  id: number;
  boat: Boat;
  kind: ZoneKind;
  /** Tile indices on `boat`'s deck. */
  tiles: number[];
  /** Seconds from creation to impact, and seconds elapsed. */
  warn: number;
  elapsed: number;
  impacted: boolean;
  /** Seconds left to linger after impact (drawn only). */
  linger: number;
  /** Who made it (a Ness id), or 0. */
  source: number;
  /** Which way a push goes, in the deck's local frame (unit). */
  push: Vec;
  /** The side of the deck the attack comes from. */
  side: ContactSide;
}

const LINGER = 0.45;

export class ZoneSystem {
  readonly list: DangerZone[] = [];
  private nextId = 1;

  add(z: Omit<DangerZone, 'id' | 'elapsed' | 'impacted' | 'linger'>): DangerZone {
    const zone: DangerZone = { ...z, id: this.nextId++, elapsed: 0, impacted: false, linger: LINGER };
    this.list.push(zone);
    return zone;
  }

  /** 0 → 1 as the impact nears. */
  static progress(z: DangerZone): number {
    return z.warn > 0 ? Math.min(1, z.elapsed / z.warn) : 1;
  }

  /** Zones that have not landed yet. */
  pending(boat?: Boat): DangerZone[] {
    return this.list.filter((z) => !z.impacted && (!boat || z.boat === boat));
  }

  /** Is this Lee standing where something is about to land? */
  inDanger(lee: Lee): boolean {
    if (!lee.alive || lee.swing) return false;
    const tile = standingTile(lee);
    return this.list.some((z) => !z.impacted && z.boat === lee.deck && z.tiles.includes(tile));
  }

  /** Drop what a Ness has put up (it dove, or died). */
  cancel(source: number): void {
    for (let i = this.list.length - 1; i >= 0; i--) if (this.list[i].source === source && !this.list[i].impacted) this.list.splice(i, 1);
  }

  step(w: World, dt: number): void {
    for (const z of this.list) {
      if (z.boat.sinkingSince !== null && !z.impacted) {
        z.impacted = true;
        z.linger = 0;
        continue;
      }
      if (!z.impacted) {
        z.elapsed += dt;
        if (z.elapsed >= z.warn) {
          z.impacted = true;
          w.zoneImpact(z);
        }
      } else z.linger -= dt;
    }
    for (let i = this.list.length - 1; i >= 0; i--) if (this.list[i].impacted && this.list[i].linger <= 0) this.list.splice(i, 1);
  }
}

/** The center of a zone in the world (it moves with the boat). */
export function zoneCenter(z: DangerZone): Vec {
  let x = 0;
  let y = 0;
  for (const i of z.tiles) {
    x += z.boat.grid.tiles[i].center.x;
    y += z.boat.grid.tiles[i].center.y;
  }
  const n = Math.max(1, z.tiles.length);
  return toWorld({ x: x / n, y: y / n }, z.boat.motion, z.boat.motion.heading);
}

/** How far out from its center a zone reaches, m (for a tap target). */
export function zoneRadius(z: DangerZone): number {
  const c = toLocal(zoneCenter(z), z.boat.motion, z.boat.motion.heading);
  let r = 0;
  for (const i of z.tiles) r = Math.max(r, dist(c, z.boat.grid.tiles[i].center));
  return r + Math.min(z.boat.grid.tileW, z.boat.grid.tileH) * 0.5;
}

/** Which way "away from the attacker" is, in the deck's local frame. */
export function pushAway(side: ContactSide): Vec {
  switch (side) {
    case 'starboard':
      return { x: 0, y: -1 };
    case 'port':
      return { x: 0, y: 1 };
    case 'bow':
      return { x: -1, y: 0 };
    case 'stern':
      return { x: 1, y: 0 };
  }
}

/**
 * The tiles a block attack covers: `depth` tiles in from the side the attacker is on, `width` tiles
 * along that side centered on it (0 width = the whole side). Never empty: it falls back to the tile nearest the attacker.
 */
export function blockTiles(boat: Boat, from: Vec, depth: number, width: number): { tiles: number[]; side: ContactSide } {
  const side = sideFacing(boat, from);
  const l = toLocal(from, boat.motion, boat.motion.heading);
  const g = boat.grid;
  const across = side === 'starboard' || side === 'port';
  let lo = Infinity;
  let hi = -Infinity;
  for (const t of g.tiles) {
    const v = across ? t.center.y : t.center.x;
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  const step = across ? g.tileH : g.tileW;
  const along = across ? g.tileW : g.tileH;
  const tiles: number[] = [];
  for (const t of g.tiles) {
    const v = across ? t.center.y : t.center.x;
    const d = side === 'starboard' || side === 'bow' ? (hi - v) / step : (v - lo) / step;
    if (d > depth - 0.5) continue;
    const a = across ? t.center.x - l.x : t.center.y - l.y;
    if (width > 0 && Math.abs(a) > (width * along) / 2) continue;
    tiles.push(t.index);
  }
  return { tiles: tiles.length ? tiles : [nearestTile(boat, l)], side };
}

/** The tiles within `radius` tiles of the tile nearest a point (a bite). */
export function circleTiles(boat: Boat, from: Vec, radius: number): { tiles: number[]; side: ContactSide } {
  const l = toLocal(from, boat.motion, boat.motion.heading);
  const near = boat.grid.tiles[nearestTile(boat, l)];
  const r = Math.max(0.5, radius) * Math.min(boat.grid.tileW, boat.grid.tileH);
  const tiles = boat.grid.tiles.filter((t) => dist(t.center, near.center) <= r + 1e-6).map((t) => t.index);
  return { tiles, side: sideFacing(boat, from) };
}

function nearestTile(boat: Boat, local: Vec): number {
  let best = 0;
  let bestD = Infinity;
  for (const t of boat.grid.tiles) {
    const d = dist(t.center, local);
    if (d < bestD) {
      bestD = d;
      best = t.index;
    }
  }
  return best;
}
