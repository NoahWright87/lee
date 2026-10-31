// Close quarters (Phase 7): how two boats get connected and how Lees get across.
//
//   hooks  → throw (telegraphed, dodgeable) → land as a LINE → lines reel the
//            two hulls together slowly (more lines, faster; heavier boats, slower)
//   ropes  → one Lee at a time, tap to send; cut one and the Lee falls short
//   planks → lowered onto a hull within reach: a bridge for Lees of either side
//   poles  → shove the boats apart (cut the lines first, or it only strains)
//
// Lees cross ONLY over a rope or a lowered plank. Everything here is about
// boats and rails: nothing assumes both ends are ships (a latching Ness later
// is just another thing a line can join; pulling uses each end's mass).

import { FACING_ANGLE } from '../config/slots';
import type { Tuning } from '../config/tuning';
import { distanceToHull, shipStats, type Boat } from './boat';
import { hullGap } from './contact';
import type { RailState, Tile } from './grid';
import { itemParam } from './loadout';
import { clamp, dist, toLocal, toWorld, wrapAngle, type Vec } from './math';

const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });

// ------------------------------------------------------------ rails

/** A rail item and where it sits. */
export interface RailRef {
  boat: Boat;
  tile: Tile;
  rail: RailState;
}

export function railTileOf(boat: Boat, rail: RailState): Tile | null {
  for (const tile of boat.grid.tiles) if (tile.rails.includes(rail)) return tile;
  return null;
}

/** Every intact rail item of a kind on a boat (its tile not blown out). */
export function railsOf(boat: Boat, kind: RailState['kind']): RailRef[] {
  const out: RailRef[] = [];
  for (const tile of boat.grid.tiles) {
    for (const rail of tile.rails) if (rail.kind === kind && !rail.destroyed && !tile.blown) out.push({ boat, tile, rail });
  }
  return out;
}

export function tileWorld(boat: Boat, tile: Tile): Vec {
  return toWorld(tile.center, boat.motion, boat.motion.heading);
}

/** Where a rail item sits (world): the outer edge of its tile on the side it faces. */
export function railPoint(boat: Boat, tile: Tile, rail: RailState): Vec {
  const a = FACING_ANGLE[rail.facing];
  const half = Math.abs(Math.cos(a)) > 0.5 ? boat.grid.tileW / 2 : boat.grid.tileH / 2;
  return toWorld({ x: tile.center.x + Math.cos(a) * half, y: tile.center.y + Math.sin(a) * half }, boat.motion, boat.motion.heading);
}

/** How far this boat's rail item at `tile` is from the other boat's hull, m (from the tile centre when no rail is given). */
export function railGap(boat: Boat, tile: Tile, other: Boat, rail?: RailState): number {
  return distanceToHull(other, rail ? railPoint(boat, tile, rail) : tileWorld(boat, tile));
}

export function hookRange(t: Tuning, item: string): number {
  return Math.max(0, t.pistol.range * t.lines.hookRange) * Math.max(0.1, itemParam(t, item, 'range') || 1);
}

/** Does this rail look out toward a world point (so a hook thrown from it doesn't go through its own hull)? */
export function railFaces(boat: Boat, rail: RailState, toward: Vec, from: Vec): boolean {
  const a = FACING_ANGLE[rail.facing] + boat.motion.heading;
  return Math.cos(a) * (toward.x - from.x) + Math.sin(a) * (toward.y - from.y) > 0;
}

/** Can this hook be thrown at `target` from where it is right now (in range, and facing it)? */
export function hookReaches(ref: RailRef, target: Boat, t: Tuning): boolean {
  const { boat, tile, rail } = ref;
  const from = railPoint(boat, tile, rail);
  return railGap(boat, tile, target, rail) <= hookRange(t, rail.item) && railFaces(boat, rail, nearestHullPoint(target, from), from);
}

export function ropeReach(t: Tuning, item: string): number {
  return Math.max(0, t.lines.ropeRange) * Math.max(0.1, itemParam(t, item, 'reach') || 1);
}

// ------------------------------------------------------------ crossings

/** A way for a Lee to get from one deck to another right now. */
export interface Crossing {
  kind: 'rope' | 'plank';
  /** The rail item and the boat/tile it sits on. */
  ref: RailRef;
  /** Tile of `from` the Lee has to stand on to cross. */
  departTile: number;
  /** Tile of `to` it lands on (-1: whichever is nearest where it left). */
  landTile: number;
}

function nearestTile(boat: Boat, world: Vec): number {
  const l = toLocal(world, boat.motion, boat.motion.heading);
  let best = 0;
  let bestD = Infinity;
  for (const tile of boat.grid.tiles) {
    const d = dist(l, tile.center);
    if (d < bestD - 1e-9) {
      bestD = d;
      best = tile.index;
    }
  }
  return best;
}

/**
 * Every way across from `from` to `to`: ropes on `from` within swing reach of
 * `to`; planks lowered from `from` (it departs from the plank) or from `to`
 * (a bridge onto the rail it lands on: it departs from the nearest tile);
 * and ropes of `to` for the way home (it lands on the rope's tile).
 */
export function crossings(from: Boat, to: Boat, t: Tuning): Crossing[] {
  if (from.sinkingSince !== null && to.sinkingSince !== null) return [];
  const out: Crossing[] = [];
  for (const ref of railsOf(from, 'rope')) {
    if (railGap(from, ref.tile, to, ref.rail) <= ropeReach(t, ref.rail.item)) out.push({ kind: 'rope', ref, departTile: ref.tile.index, landTile: -1 });
  }
  for (const ref of railsOf(from, 'planks')) {
    if (ref.rail.lowered) out.push({ kind: 'plank', ref, departTile: ref.tile.index, landTile: -1 });
  }
  for (const ref of railsOf(to, 'planks')) {
    if (!ref.rail.lowered) continue;
    const w = railPoint(to, ref.tile, ref.rail);
    if (distanceToHull(from, w) <= Math.max(0, t.lines.plankReach) * 1.5) out.push({ kind: 'plank', ref, departTile: nearestTile(from, w), landTile: ref.tile.index });
  }
  for (const ref of railsOf(to, 'rope')) {
    const w = railPoint(to, ref.tile, ref.rail);
    if (distanceToHull(from, w) <= ropeReach(t, ref.rail.item)) out.push({ kind: 'rope', ref, departTile: nearestTile(from, w), landTile: ref.tile.index });
  }
  return out;
}

export function canCross(from: Boat, to: Boat, t: Tuning): boolean {
  return crossings(from, to, t).length > 0;
}

// ------------------------------------------------------------ hooks and lines

export interface HookFlight {
  id: number;
  owner: Boat;
  target: Boat;
  ref: RailRef;
  /** Launch point and where it comes down (world). */
  from: Vec;
  to: Vec;
  elapsed: number;
  flight: number;
}

/** A hooked line between two hulls. */
export interface Line {
  id: number;
  owner: Boat;
  target: Boat;
  ref: RailRef;
  /** Where it's fixed on the target's hull (the target's frame). */
  attach: Vec;
  hp: number;
  maxHp: number;
  since: number;
  /** The widest the hulls may be apart while it holds (hull gap, m). It shrinks as the lines reel in. */
  limit: number;
}

export type LineEvent =
  | { type: 'hookThrown'; flight: HookFlight }
  | { type: 'hookLanded'; line: Line }
  | { type: 'hookMissed'; flight: HookFlight }
  | { type: 'lineCut'; line: Line; by: 'hacked' | 'broke' | 'sank' }
  | { type: 'shoved'; a: Boat; b: Boat };

export interface LineContext {
  tuning: Tuning;
  time: number;
  /** Boats that count as out of the fight (lines to them are dropped). */
  gone: (b: Boat) => boolean;
}

const pairKey = (a: Boat, b: Boat): string => (a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`);

interface Push {
  a: Boat;
  b: Boat;
  until: number;
}

export class LineSystem {
  readonly flights: HookFlight[] = [];
  readonly lines: Line[] = [];
  private pushes: Push[] = [];
  private nextId = 1;

  linesOf(boat: Boat): Line[] {
    return this.lines.filter((l) => l.owner === boat || l.target === boat);
  }

  between(a: Boat, b: Boat): Line[] {
    return this.lines.filter((l) => (l.owner === a && l.target === b) || (l.owner === b && l.target === a));
  }

  /** Lines holding `boat` (ours or theirs). */
  held(boat: Boat): boolean {
    return this.lines.some((l) => l.owner === boat || l.target === boat);
  }

  /** How wide a gap between the hulls the pair's lines now allow (the shortest line), or null with no lines. */
  limit(a: Boat, b: Boat): number | null {
    const l = this.between(a, b);
    return l.length ? Math.min(...l.map((x) => x.limit)) : null;
  }

  /**
   * Throw a hook from this rail at `target`. Null (nothing thrown) if the hook
   * isn't ready, is already out, or the target is out of reach. The hook comes
   * down where the target's hull will be if it holds its course: change
   * course and it misses.
   */
  throwHook(ref: RailRef, target: Boat, t: Tuning, time: number): HookFlight | null {
    const { boat, tile, rail } = ref;
    if (rail.kind !== 'hook' || rail.destroyed || tile.blown || rail.out || rail.readyAt > time) return null;
    if (!hookReaches(ref, target, t)) return null;
    const from = railPoint(boat, tile, rail);
    const flight = Math.max(0.05, t.lines.hookFlight);
    // The hull point nearest the launch, carried forward by the target's velocity over the flight.
    const q = nearestHullPoint(target, from);
    const to = { x: q.x + target.motion.vx * flight, y: q.y + target.motion.vy * flight };
    const f: HookFlight = { id: this.nextId++, owner: boat, target, ref, from, to, elapsed: 0, flight };
    rail.out = true;
    this.flights.push(f);
    return f;
  }

  /** A harpoon (or anything shot) that struck `target` holds on: a line from this gun, like a hook that landed. */
  land(ref: RailRef, target: Boat, at: Vec, t: Tuning, time: number): Line {
    const mult = Math.max(0.1, itemParam(t, ref.rail.item, 'hp') || 1);
    const hp = Math.max(0.1, t.lines.lineHp) * mult;
    const line: Line = { id: this.nextId++, owner: ref.boat, target, ref, attach: toLocal(nearestHullPoint(target, at), target.motion, target.motion.heading), hp, maxHp: hp, since: time, limit: 0 };
    line.limit = Math.max(t.lines.closeGap, hullGap(ref.boat, target).gap);
    ref.rail.out = true;
    this.lines.push(line);
    return line;
  }

  /** Cut a line (its hook can be thrown again after the cooldown). */
  cut(line: Line, t: Tuning, time: number, by: 'hacked' | 'broke' | 'sank' = 'hacked'): LineEvent {
    const i = this.lines.indexOf(line);
    if (i >= 0) this.lines.splice(i, 1);
    line.ref.rail.out = false;
    line.ref.rail.readyAt = time + Math.max(0, t.lines.hookCooldown);
    return { type: 'lineCut', line, by };
  }

  /** A shove from push poles: the pair separates for a moment (lines, if any, strain against it). */
  shove(a: Boat, b: Boat, t: Tuning, time: number): void {
    this.pushes.push({ a, b, until: time + Math.max(0, t.lines.poleTime) });
  }

  /** Whether a shove is under way between these two. */
  shoving(a: Boat, b: Boat): boolean {
    return this.pushes.some((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a));
  }

  /** Where a line is fixed, world. */
  attachWorld(line: Line): Vec {
    return toWorld(line.attach, line.target.motion, line.target.motion.heading);
  }

  /** The line's end on its owner's rail, world. */
  anchorWorld(line: Line): Vec {
    return railPoint(line.owner, line.ref.tile, line.ref.rail);
  }

  /** Drop lines whose boats are gone, let hooks land, then reel and push. Run after motion. */
  step(ctx: LineContext, dt: number): LineEvent[] {
    const out: LineEvent[] = [];
    const t = ctx.tuning;
    for (let i = this.lines.length - 1; i >= 0; i--) {
      const l = this.lines[i];
      if (ctx.gone(l.owner) || ctx.gone(l.target) || l.ref.tile.blown || l.ref.rail.destroyed) out.push(this.cut(l, t, ctx.time, 'sank'));
    }
    for (let i = this.flights.length - 1; i >= 0; i--) {
      const f = this.flights[i];
      if (ctx.gone(f.owner) || ctx.gone(f.target) || f.ref.rail.destroyed) {
        f.ref.rail.out = false;
        this.flights.splice(i, 1);
        continue;
      }
      f.elapsed += dt;
      if (f.elapsed < f.flight) continue;
      this.flights.splice(i, 1);
      if (distanceToHull(f.target, f.to) <= Math.max(0, t.lines.hookCatch)) {
        const mult = Math.max(0.1, itemParam(t, f.ref.rail.item, 'hp') || 1);
        const hp = Math.max(0.1, t.lines.lineHp) * mult;
        const line: Line = { id: this.nextId++, owner: f.owner, target: f.target, ref: f.ref, attach: toLocal(nearestHullPoint(f.target, f.to), f.target.motion, f.target.motion.heading), hp, maxHp: hp, since: ctx.time, limit: 0 };
        line.limit = Math.max(t.lines.closeGap, hullGap(f.owner, f.target).gap);
        this.lines.push(line);
        out.push({ type: 'hookLanded', line });
      } else {
        f.ref.rail.out = false;
        f.ref.rail.readyAt = Math.max(f.ref.rail.readyAt, ctx.time + Math.max(0, t.lines.hookCooldown) * 0.25);
        out.push({ type: 'hookMissed', flight: f });
      }
    }
    this.stepPushes(ctx, dt, out);
    this.stepPull(ctx, dt);
    // The hook slides to the hull point nearest its rail, so a line runs straight across the gap (a lashing, not a diagonal).
    for (const l of this.lines) l.attach = toLocal(nearestHullPoint(l.target, this.anchorWorld(l)), l.target.motion, l.target.motion.heading);
    return out;
  }

  private stepPushes(ctx: LineContext, dt: number, out: LineEvent[]): void {
    const t = ctx.tuning;
    for (let i = this.pushes.length - 1; i >= 0; i--) {
      const p = this.pushes[i];
      if (ctx.time >= p.until || ctx.gone(p.a) || ctx.gone(p.b)) {
        this.pushes.splice(i, 1);
        continue;
      }
      const { pa, pb } = hullGap(p.a, p.b);
      const n = unit({ x: pb.x - pa.x, y: pb.y - pa.y });
      const [ma, mb] = [mass(p.a, t), mass(p.b, t)];
      const move = Math.max(0, t.lines.poleSpeed) * dt;
      p.a.motion.x -= n.x * move * (mb / (ma + mb)) * 2;
      p.a.motion.y -= n.y * move * (mb / (ma + mb)) * 2;
      p.b.motion.x += n.x * move * (ma / (ma + mb)) * 2;
      p.b.motion.y += n.y * move * (ma / (ma + mb)) * 2;
    }
    void out;
  }

  /**
   * Lines reel the hulls together. A boat sailing away eats the pull and drags the
   * other along; it can't get past the lines. Taut lines also swing the pair round
   * to lie side by side and, once the hulls touch, slide them level with each other
   * (as if lashed), so the rails end up facing.
   */
  private stepPull(ctx: LineContext, dt: number): void {
    const t = ctx.tuning;
    const pairs = new Map<string, { lines: Line[]; pull: number }>();
    for (const l of this.lines) {
      const k = pairKey(l.owner, l.target);
      const e = pairs.get(k) ?? { lines: [], pull: 0 };
      e.lines.push(l);
      e.pull += Math.max(0, t.lines.pull) * Math.max(0.1, itemParam(t, l.ref.rail.item, 'pull') || 1);
      pairs.set(k, e);
    }
    for (const { lines, pull } of pairs.values()) {
      const [A, B] = [lines[0].owner, lines[0].target];
      const mA = mass(A, t);
      const mB = mass(B, t);
      const wA = mB / (mA + mB);
      const wB = mA / (mA + mB);
      const { gap, pa, pb } = hullGap(A, B);
      const n = unit(sub(pb, pa));
      // How fast they're separating along the line of the hulls.
      const sep = (B.motion.vx - A.motion.vx) * n.x + (B.motion.vy - A.motion.vy) * n.y;
      const reel = Math.max(0, pull / Math.max(mA, mB) - Math.max(0, sep) * Math.max(0, t.lines.dragEffect));
      let limit = Infinity;
      for (const l of lines) {
        l.limit = Math.max(t.lines.closeGap, l.limit - reel * dt);
        limit = Math.min(limit, l.limit);
      }
      if (gap > limit) {
        const excess = gap - limit;
        A.motion.x += n.x * excess * wA;
        A.motion.y += n.y * excess * wA;
        B.motion.x -= n.x * excess * wB;
        B.motion.y -= n.y * excess * wB;
        if (sep > 0) {
          // Taut: the pair shares the separating speed (the faster boat drags the other).
          A.motion.vx += n.x * sep * wA;
          A.motion.vy += n.y * sep * wA;
          B.motion.vx -= n.x * sep * wB;
          B.motion.vy -= n.y * sep * wB;
        }
      }
      // Swing round to lie side by side (parallel, or bow to stern, whichever is nearer).
      const rate = Math.max(0, t.lines.align) * dt;
      const diff = wrapAngle(B.motion.heading - A.motion.heading);
      const err = wrapAngle(diff - (Math.abs(diff) < Math.PI / 2 ? 0 : Math.PI));
      const turn = clamp(err, -rate, rate);
      A.motion.heading = wrapAngle(A.motion.heading + turn * wA);
      B.motion.heading = wrapAngle(B.motion.heading - turn * wB);
      // Touching: slide level with each other, mid-hull to mid-hull.
      if (gap <= Math.max(t.lines.closeGap, limit) + 2 && Math.abs(err) < 0.5) {
        const ux = Math.cos(A.motion.heading);
        const uy = Math.sin(A.motion.heading);
        const off = (B.motion.x - A.motion.x) * ux + (B.motion.y - A.motion.y) * uy;
        const step = clamp(off, -Math.max(0, t.lines.slide) * dt, Math.max(0, t.lines.slide) * dt);
        A.motion.x += ux * step * wA;
        A.motion.y += uy * step * wA;
        B.motion.x -= ux * step * wB;
        B.motion.y -= uy * step * wB;
      }
    }
  }
}

/** Mass of a boat for pulling: its ship's `mass` stat. */
export function mass(b: Boat, t: Tuning): number {
  return Math.max(0.1, shipStats(b, t).mass ?? 1);
}

function unit(v: Vec): Vec {
  const l = Math.hypot(v.x, v.y);
  return l > 1e-9 ? { x: v.x / l, y: v.y / l } : { x: 1, y: 0 };
}

/** The point on the boat's hull nearest a world point (on its keel capsule's surface). */
export function nearestHullPoint(boat: Boat, world: Vec): Vec {
  const c = boat.motion;
  const l = toLocal(world, c, c.heading);
  // Clamp the point toward the keel, then step out by the half beam toward where it came from.
  const half = Math.max(0, boat.layout.length / 2 - boat.layout.beam / 2);
  const q = { x: clamp(l.x, -half, half), y: 0 };
  const d = { x: l.x - q.x, y: l.y - q.y };
  const n = Math.hypot(d.x, d.y);
  const r = boat.layout.beam / 2;
  const p = n > 1e-9 ? { x: q.x + (d.x / n) * r, y: q.y + (d.y / n) * r } : { x: q.x, y: q.y + r };
  return toWorld(p, c, c.heading);
}
