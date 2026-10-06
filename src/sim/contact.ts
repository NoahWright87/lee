// Close contact between boats. Boats never lock together: two opposing hulls
// are in close combat while they're within boarding range of each other, and
// stop being so when either sails off. Also: boat-to-boat collisions (a ram, or
// a bump) and ram prediction (the red X).
//
// A ram doesn't bounce: the two boats end up moving together, nose to hull,
// and stay in close combat until somebody sails away.
//
// Written against Boat today, but nothing here assumes both ends are ships:
// anything with a motion state, a hull capsule, parts and a deck can be in
// contact (a latching Ness later).

import type { Side, Tuning } from '../config/tuning';
import { applyDamage, bowTipLocal, hullCapsule, keelSegment, partAt, type Boat, type PartState } from './boat';
import type { RailState } from './grid';
import { itemParam } from './loadout';
import { clamp, closestOnSegment, closestSegments, DEG, dist, toLocal, toWorld, type Vec } from './math';

export type ContactSide = 'port' | 'starboard' | 'bow' | 'stern';

/** Two opposing boats close enough to fight hand to hand (`a` has the lower id). */
export interface Contact {
  a: Boat;
  b: Boat;
  /** World time it started. */
  since: number;
  /** Gap between the hulls right now, m. */
  gap: number;
}

/** "This boat is about to ram that one": a red X (or a neutral one when it's you). Recomputed every step. */
export interface ContactWarning {
  kind: 'ram';
  key: string;
  actorId: number;
  targetId: number;
  /** Predicted impact point, world. */
  pos: Vec;
  /** 0 → 1 as impact approaches. */
  progress: number;
  /** Seconds this warning has been up continuously. */
  shownFor: number;
  /** True when the player is the one doing it (neutral color instead of red). */
  byPlayer: boolean;
}

export type ContactEvent =
  | { type: 'rammed'; rammer: Boat; target: Boat; part: PartState; damage: number; selfPart: PartState | null; selfDamage: number; pos: Vec; speed: number }
  | { type: 'bump'; pos: Vec; speed: number }
  | { type: 'contact'; a: Boat; b: Boat }
  | { type: 'contactEnded'; a: Boat; b: Boat };

export interface ContactContext {
  tuning: Tuning;
  time: number;
  boats: Boat[];
}

/** Which side of `boat` faces a world point. */
export function sideFacing(boat: Boat, world: Vec): ContactSide {
  const l = toLocal(world, boat.motion, boat.motion.heading);
  const { half } = hullCapsule(boat);
  if (l.x > half && Math.abs(l.y) < boat.layout.beam * 0.35) return 'bow';
  if (l.x < -half && Math.abs(l.y) < boat.layout.beam * 0.35) return 'stern';
  return l.y >= 0 ? 'starboard' : 'port';
}

/** Intact spikes on a side of a boat (rail items facing that way). */
export function spikesOn(boat: Boat, side: ContactSide): RailState[] {
  const out: RailState[] = [];
  for (const tile of boat.grid.tiles) for (const r of tile.rails) if (r.kind === 'spikes' && !r.destroyed && r.facing === side) out.push(r);
  return out;
}



/** Gap between two hulls (negative = overlapping) and the closest points. */
export function hullGap(a: Boat, b: Boat): { gap: number; pa: Vec; pb: Vec } {
  const [a0, a1] = keelSegment(a);
  const [b0, b1] = keelSegment(b);
  const c = closestSegments(a0, a1, b0, b1);
  return { gap: c.d - hullCapsule(a).r - hullCapsule(b).r, pa: c.a, pb: c.b };
}

/** How close (hull gap, m) this boat's Lees can swing across from: boarding range × Swinging Ropes. */
export function boardRange(b: Boat, t: Tuning): number {
  return Math.max(0, t.boarding.range) * b.mods.boardRange;
}

/** Can a Lee of `from`'s crew swing between `from` and `to` right now? */
export function inReach(from: Boat, to: Boat, t: Tuning): boolean {
  return hullGap(from, to).gap <= boardRange(from, t);
}

export class ContactSystem {
  readonly contacts: Contact[] = [];
  warnings: ContactWarning[] = [];
  /** Pair key (rammer>target) → world time before which it can't ram again. */
  private ramCooldown = new Map<string, number>();

  contactsOf(boat: Boat): Contact[] {
    return this.contacts.filter((c) => c.a === boat || c.b === boat);
  }

  between(a: Boat, b: Boat): Contact | null {
    return this.contacts.find((c) => (c.a === a && c.b === b) || (c.a === b && c.b === a)) ?? null;
  }

  other(c: Contact, boat: Boat): Boat {
    return c.a === boat ? c.b : c.a;
  }

  /** Opposing boats in close combat with this one, nearest first. */
  touching(boat: Boat): Boat[] {
    return this.contactsOf(boat)
      .sort((x, y) => x.gap - y.gap || this.other(x, boat).id - this.other(y, boat).id)
      .map((c) => this.other(c, boat));
  }

  /**
   * One step (after motion): ram warnings, collisions (ram or bump), then who
   * is in close combat with whom.
   */
  step(ctx: ContactContext, dt: number): ContactEvent[] {
    const out: ContactEvent[] = [];
    const t = ctx.tuning;
    const afloat = ctx.boats.filter((b) => b.sinkingSince === null);
    this.updateWarnings(ctx, afloat, dt);

    // Collisions.
    for (let i = 0; i < afloat.length; i++) {
      for (let j = i + 1; j < afloat.length; j++) {
        const a = afloat[i];
        const b = afloat[j];
        const { gap, pa, pb } = hullGap(a, b);
        if (gap >= 0) continue;
        const ram = a.side !== b.side ? this.tryRam(ctx, a, b) : null;
        if (ram) {
          out.push(ram);
          continue;
        }
        const bump = bumpApart(a, b, pa, pb, -gap, t.attach.bounce);
        if (bump) out.push(bump);
      }
    }

    // Close combat: starts within boarding range, ends past range + slack (no flicker).
    const slack = Math.max(0, t.boarding.rangeSlack);
    for (let i = this.contacts.length - 1; i >= 0; i--) {
      const c = this.contacts[i];
      c.gap = hullGap(c.a, c.b).gap;
      const range = Math.max(boardRange(c.a, t), boardRange(c.b, t));
      if (c.a.sinkingSince === null && c.b.sinkingSince === null && c.gap <= range + slack) continue;
      this.contacts.splice(i, 1);
      out.push({ type: 'contactEnded', a: c.a, b: c.b });
    }
    for (let i = 0; i < afloat.length; i++) {
      for (let j = i + 1; j < afloat.length; j++) {
        const a = afloat[i].id < afloat[j].id ? afloat[i] : afloat[j];
        const b = a === afloat[i] ? afloat[j] : afloat[i];
        if (a.side === b.side || this.between(a, b)) continue;
        const gap = hullGap(a, b).gap;
        if (gap > Math.max(boardRange(a, t), boardRange(b, t))) continue;
        this.contacts.push({ a, b, since: ctx.time, gap });
        out.push({ type: 'contact', a, b });
      }
    }
    this.contacts.sort((x, y) => x.a.id - y.a.id || x.b.id - y.b.id);
    return out;
  }

  /** Closing speed of `r`'s bow into `target` (along r's heading), m/s. */
  private closing(r: Boat, target: Boat): number {
    const fx = Math.cos(r.motion.heading);
    const fy = Math.sin(r.motion.heading);
    return (r.motion.vx - target.motion.vx) * fx + (r.motion.vy - target.motion.vy) * fy;
  }

  /** Is r's bow square enough onto target's hull at `tip` (world)? */
  private squareOn(r: Boat, target: Boat, tip: Vec, t: Tuning): boolean {
    const [s0, s1] = keelSegment(target);
    const q = closestOnSegment(tip, s0, s1);
    let n = { x: tip.x - q.x, y: tip.y - q.y };
    if (Math.hypot(n.x, n.y) < 1e-6) n = { x: r.motion.x - target.motion.x, y: r.motion.y - target.motion.y };
    n = unit(n);
    const fx = Math.cos(r.motion.heading);
    const fy = Math.sin(r.motion.heading);
    return -(fx * n.x + fy * n.y) >= Math.cos(clamp(t.attach.ramMaxAngle, 0, 89) * DEG);
  }

  private tryRam(ctx: ContactContext, a: Boat, b: Boat): ContactEvent | null {
    const t = ctx.tuning;
    const options = [
      { r: a, target: b },
      { r: b, target: a },
    ].sort((x, y) => this.closing(y.r, y.target) - this.closing(x.r, x.target) || x.r.id - y.r.id);
    for (const { r, target } of options) {
      const speed = this.closing(r, target);
      if (speed < t.attach.ramSpeed) continue;
      if ((this.ramCooldown.get(`${r.id}>${target.id}`) ?? -Infinity) > ctx.time) continue;
      const tip = toWorld(bowTipLocal(r), r.motion, r.motion.heading);
      const [s0, s1] = keelSegment(target);
      const q = closestOnSegment(tip, s0, s1);
      if (dist(tip, q) > hullCapsule(target).r + 0.6) continue;
      if (!this.squareOn(r, target, tip, t)) continue;
      // Telegraphed long enough? Otherwise it's a bump: nobody gets rammed by surprise.
      const w = this.warnings.find((x) => x.key === `ram:${r.id}>${target.id}`);
      if (!w || w.shownFor < t.attach.ramMinWarning) continue;
      this.ramCooldown.set(`${r.id}>${target.id}`, ctx.time + Math.max(0, t.attach.ramCooldown));
      return ram(ctx, r, target, tip, q, sideFacing(target, tip), speed);
    }
    return null;
  }

  /** Predict rams over the next ramWarnTime seconds (straight-line motion) and keep their X's up to date. */
  private updateWarnings(ctx: ContactContext, afloat: Boat[], dt: number): void {
    const t = ctx.tuning;
    const prev = new Map(this.warnings.map((w) => [w.key, w]));
    const next: ContactWarning[] = [];
    const horizon = Math.max(0, t.attach.ramWarnTime);
    for (const r of afloat) {
      for (const target of afloat) {
        if (r === target || r.side === target.side) continue;
        if (this.closing(r, target) < t.attach.ramSpeed) continue;
        if ((this.ramCooldown.get(`${r.id}>${target.id}`) ?? -Infinity) > ctx.time) continue;
        const hit = predictRam(r, target, horizon);
        if (!hit) continue;
        // Would it count? Square enough onto the hull.
        if (-(Math.cos(r.motion.heading) * hit.n.x + Math.sin(r.motion.heading) * hit.n.y) < Math.cos(clamp(t.attach.ramMaxAngle, 0, 89) * DEG)) continue;
        const local = toLocal(hit.tip, hit.center, target.motion.heading);
        const pos = toWorld(local, target.motion, target.motion.heading);
        const key = `ram:${r.id}>${target.id}`;
        const old = prev.get(key);
        next.push({
          kind: 'ram',
          key,
          actorId: r.id,
          targetId: target.id,
          pos,
          progress: horizon > 0 ? clamp(1 - hit.time / horizon, 0, 1) : 1,
          shownFor: (old?.shownFor ?? 0) + dt,
          byPlayer: r.side === 'player',
        });
      }
    }
    this.warnings = next;
  }
}

/** A ram lands: damage both ways, and the two end up moving together (no bounce). */
function ram(ctx: ContactContext, r: Boat, target: Boat, tip: Vec, q: Vec, side: ContactSide, speed: number): ContactEvent {
  const t = ctx.tuning.attach;
  const part = partAt(target, tip, 4) ?? nearestPart(target, tip);
  // Spikes on either contacting edge make the other boat's struck part hurt more.
  const bonus = (rails: RailState[]) => 1 + rails.reduce((m, x) => Math.max(m, itemParam(ctx.tuning, x.item, 'ramBonus')), 0);
  const dmg = applyDamage(part, speed * Math.max(0, t.ramDamage) * bonus(spikesOn(r, 'bow'))).dealt;
  const bow = r.parts.find((p) => p.def.role === 'bow') ?? null;
  const selfDmg = bow ? applyDamage(bow, speed * Math.max(0, t.ramDamage) * Math.max(0, t.ramSelfDamage) * bonus(spikesOn(target, side))).dealt : 0;
  // Back the rammer out until its tip just touches the hull, and share one velocity.
  const n = unit({ x: tip.x - q.x, y: tip.y - q.y });
  const pen = hullCapsule(target).r - dist(tip, q);
  if (pen > 0 && Number.isFinite(n.x)) {
    r.motion.x += n.x * pen;
    r.motion.y += n.y * pen;
  }
  const vx = (r.motion.vx + target.motion.vx) / 2;
  const vy = (r.motion.vy + target.motion.vy) / 2;
  for (const b of [r, target]) {
    b.motion.vx = vx;
    b.motion.vy = vy;
    b.motion.omega = 0;
  }
  return { type: 'rammed', rammer: r, target, part, damage: dmg, selfPart: bow, selfDamage: selfDmg, pos: tip, speed };
}

/** Push overlapping hulls apart and bounce them off each other. */
function bumpApart(a: Boat, b: Boat, pa: Vec, pb: Vec, pen: number, bounce: number): ContactEvent | null {
  let n = { x: pb.x - pa.x, y: pb.y - pa.y };
  if (Math.hypot(n.x, n.y) < 1e-6) n = { x: b.motion.x - a.motion.x, y: b.motion.y - a.motion.y };
  if (Math.hypot(n.x, n.y) < 1e-6) n = { x: 1, y: 0 };
  n = unit(n);
  a.motion.x -= (n.x * pen) / 2;
  a.motion.y -= (n.y * pen) / 2;
  b.motion.x += (n.x * pen) / 2;
  b.motion.y += (n.y * pen) / 2;
  const vn = (b.motion.vx - a.motion.vx) * n.x + (b.motion.vy - a.motion.vy) * n.y;
  if (vn >= 0) return null;
  const k = (-(1 + clamp(bounce, 0, 1)) * vn) / 2;
  a.motion.vx -= n.x * k;
  a.motion.vy -= n.y * k;
  b.motion.vx += n.x * k;
  b.motion.vy += n.y * k;
  return -vn > 1 ? { type: 'bump', pos: { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 }, speed: -vn } : null;
}

/** First moment within `horizon` s that r's bow tip enters target's hull, both holding velocity. */
export function predictRam(r: Boat, target: Boat, horizon: number): { time: number; tip: Vec; center: Vec; n: Vec } | null {
  const tip0 = toWorld(bowTipLocal(r), r.motion, r.motion.heading);
  const [s0, s1] = keelSegment(target);
  const rad = hullCapsule(target).r;
  const step = 0.05;
  for (let time = 0; time <= horizon + 1e-9; time += step) {
    const tip = { x: tip0.x + r.motion.vx * time, y: tip0.y + r.motion.vy * time };
    const ox = target.motion.vx * time;
    const oy = target.motion.vy * time;
    const q = closestOnSegment(tip, { x: s0.x + ox, y: s0.y + oy }, { x: s1.x + ox, y: s1.y + oy });
    const d = dist(tip, q);
    if (d <= rad) {
      const n = d > 1e-6 ? { x: (tip.x - q.x) / d, y: (tip.y - q.y) / d } : unit({ x: r.motion.x - target.motion.x, y: r.motion.y - target.motion.y });
      return { time, tip, center: { x: target.motion.x + ox, y: target.motion.y + oy }, n };
    }
  }
  return null;
}

/** Does `side` have Lees standing on (or swinging to) `deck`? */
export function sideAboard(deck: Boat, side: Side, lees: { alive: boolean; side: Side; deck: Boat; swing: { to: Boat } | null }[]): boolean {
  return lees.some((l) => l.alive && l.side === side && (l.swing ? l.swing.to === deck : l.deck === deck));
}

function unit(v: Vec): Vec {
  const l = Math.hypot(v.x, v.y);
  return l > 1e-9 ? { x: v.x / l, y: v.y / l } : { x: 1, y: 0 };
}

function nearestPart(boat: Boat, world: Vec): PartState {
  let best = boat.parts[0];
  let bestD = Infinity;
  for (const p of boat.parts) {
    const c = toWorld(p.center, boat.motion, boat.motion.heading);
    const d = dist(c, world);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

