// Attachments: physical links between two opposing boats (docked side by side,
// or rammed nose into hull). A link lets crew swing across, overrides both
// boats' propulsion (the attached group drifts together), and silences the
// guns between them. Also: boat-to-boat collisions (bumps), ram prediction
// (the X telegraph) and the grapple timer (the dock ring).
//
// Written against Boat today, but nothing here assumes both ends are ships:
// anything with a motion state, a hull capsule, parts and a deck can link
// (a latching Ness later).

import type { Side, Tuning } from '../config/tuning';
import { applyDamage, bowTipLocal, hullCapsule, keelSegment, partAt, type Boat, type PartState } from './boat';
import { clamp, closestOnSegment, closestSegments, DEG, dist, lerp, rotate, toLocal, toWorld, wrapAngle, type Vec } from './math';

export type AttachSide = 'port' | 'starboard' | 'bow' | 'stern';
export type AttachKind = 'dock' | 'ram';

/** A boat's pose (position and heading). */
export interface Pose {
  x: number;
  y: number;
  h: number;
}

export interface Attachment {
  id: number;
  a: Boat;
  b: Boat;
  sideA: AttachSide;
  sideB: AttachSide;
  kind: AttachKind;
  /** World time it formed. */
  since: number;
  /** b's pose in a's frame (fixed once eased in). */
  rel: Pose;
  /** Docking eases b from `from` to `rel` over `dur` seconds. */
  ease: { from: Pose; t: number; dur: number } | null;
  /** World time the link breaks (recall window running), or null. */
  breakAt: number | null;
  breakReason: string | null;
  /**
   * One side is casting off (Disengage): its boarders come home, and the link
   * breaks once none are left over there. The other side's boarders stay and fight.
   */
  castOff: { side: Side; since: number } | null;
}

/** "This boat is about to touch that one": a ram X or a dock ring. Recomputed every step. */
export interface ContactWarning {
  kind: 'ram' | 'dock';
  key: string;
  /** The rammer, or for a dock the lower-id boat of the pair. */
  actorId: number;
  targetId: number;
  /** World point to draw at (predicted impact point, or the gap between the hulls). */
  pos: Vec;
  /** 0 → 1 as impact (or the dock) approaches. */
  progress: number;
  /** Seconds this warning has been up continuously. */
  shownFor: number;
  /** True when the player is the one doing it (neutral color instead of red). */
  byPlayer: boolean;
}

export type AttachEvent =
  | { type: 'docked'; a: Boat; b: Boat }
  | { type: 'rammed'; rammer: Boat; target: Boat; part: PartState; damage: number; selfPart: PartState | null; selfDamage: number; pos: Vec; speed: number }
  | { type: 'bump'; pos: Vec; speed: number }
  | { type: 'linkBroken'; a: Boat; b: Boat; reason: string };

export interface AttachContext {
  tuning: Tuning;
  time: number;
  boats: Boat[];
  /** Boat id the player is steering alongside, if any (colors the dock ring). */
  playerAlongside: number | null;
}

// ---------------------------------------------------------------- poses

export const poseOf = (b: Boat): Pose => ({ x: b.motion.x, y: b.motion.y, h: b.motion.heading });

/** child's pose in parent's frame. */
export function relPose(parent: Pose, child: Pose): Pose {
  const l = toLocal(child, parent, parent.h);
  return { x: l.x, y: l.y, h: wrapAngle(child.h - parent.h) };
}

export function compose(parent: Pose, rel: Pose): Pose {
  const w = toWorld(rel, parent, parent.h);
  return { x: w.x, y: w.y, h: wrapAngle(parent.h + rel.h) };
}

export function inversePose(rel: Pose): Pose {
  const p = rotate({ x: -rel.x, y: -rel.y }, -rel.h);
  return { x: p.x, y: p.y, h: wrapAngle(-rel.h) };
}

/** Which side of `boat` faces a world point. */
export function sideFacing(boat: Boat, world: Vec): AttachSide {
  const l = toLocal(world, boat.motion, boat.motion.heading);
  const { half } = hullCapsule(boat);
  if (l.x > half && Math.abs(l.y) < boat.layout.beam * 0.35) return 'bow';
  if (l.x < -half && Math.abs(l.y) < boat.layout.beam * 0.35) return 'stern';
  return l.y >= 0 ? 'starboard' : 'port';
}

const pairKey = (a: Boat, b: Boat) => (a.id < b.id ? `${a.id}-${b.id}` : `${b.id}-${a.id}`);

/** Gap between two hulls (negative = overlapping) and the closest points. */
export function hullGap(a: Boat, b: Boat): { gap: number; pa: Vec; pb: Vec } {
  const [a0, a1] = keelSegment(a);
  const [b0, b1] = keelSegment(b);
  const c = closestSegments(a0, a1, b0, b1);
  return { gap: c.d - hullCapsule(a).r - hullCapsule(b).r, pa: c.a, pb: c.b };
}

// ---------------------------------------------------------------- system

export class AttachSystem {
  readonly links: Attachment[] = [];
  warnings: ContactWarning[] = [];
  /** Grapple timers by pair key. */
  readonly grapple = new Map<string, number>();
  /** Pair key → world time before which the two can't dock again. */
  private cooldown = new Map<string, number>();
  private nextId = 1;

  linksOf(boat: Boat): Attachment[] {
    return this.links.filter((l) => l.a === boat || l.b === boat);
  }

  linkBetween(a: Boat, b: Boat): Attachment | null {
    return this.links.find((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a)) ?? null;
  }

  /** Boats directly linked to this one. */
  attachedTo(boat: Boat): Boat[] {
    return this.linksOf(boat).map((l) => (l.a === boat ? l.b : l.a));
  }

  other(l: Attachment, boat: Boat): Boat {
    return l.a === boat ? l.b : l.a;
  }

  sideOf(l: Attachment, boat: Boat): AttachSide {
    return l.a === boat ? l.sideA : l.sideB;
  }

  /** Can `boat` take another link on `side`? */
  canLink(boat: Boat, side: AttachSide, t: Tuning): boolean {
    if (boat.sinkingSince !== null) return false;
    const mine = this.linksOf(boat);
    if (mine.length >= Math.max(0, Math.round(t.attach.cap))) return false;
    const onSide = mine.filter((l) => this.sideOf(l, boat) === side).length;
    return onSide < Math.max(1, Math.round(t.attach.perSide));
  }

  /** Every boat rigidly connected to this one (including itself). */
  groupOf(boat: Boat): Boat[] {
    const seen = new Set<Boat>([boat]);
    const queue = [boat];
    while (queue.length) {
      const b = queue.shift()!;
      for (const o of this.attachedTo(b)) {
        if (!seen.has(o)) {
          seen.add(o);
          queue.push(o);
        }
      }
    }
    return [...seen].sort((x, y) => x.id - y.id);
  }

  /** Is this link on its way to breaking (timed, or a side casting off)? No new boarding across it. */
  castingOff(l: Attachment): boolean {
    return l.breakAt !== null || l.castOff !== null;
  }

  /** `side` casts off: its boarders come home first (see World), then the link breaks. */
  startCastOff(l: Attachment, side: Side, time: number): void {
    if (l.breakAt !== null || l.castOff) return;
    l.castOff = { side, since: time };
    l.breakReason = 'disengage';
  }

  /** Start the recall window on a link (no-op if it's already breaking). */
  breakLink(l: Attachment, reason: string, time: number, window: number): void {
    if (l.breakAt !== null) return;
    l.breakAt = time + Math.max(0, window);
    l.breakReason = reason;
  }

  // ------------------------------------------------------------ per step

  /**
   * One step: break links whose recall window ran out, update ram/dock
   * warnings, resolve contacts (ram, bump), and form docks. Call after motion.
   */
  step(ctx: AttachContext, dt: number): AttachEvent[] {
    const out: AttachEvent[] = [];
    const t = ctx.tuning.attach;

    // 1) Links whose recall window has run out (or whose boats are gone) break and push apart.
    for (let i = this.links.length - 1; i >= 0; i--) {
      const l = this.links[i];
      if (l.breakAt === null || ctx.time < l.breakAt) continue;
      this.links.splice(i, 1);
      this.cooldown.set(pairKey(l.a, l.b), ctx.time + Math.max(0, t.redockDelay));
      this.grapple.delete(pairKey(l.a, l.b));
      const n = unit({ x: l.b.motion.x - l.a.motion.x, y: l.b.motion.y - l.a.motion.y });
      const push = Math.max(0, t.pushSpeed);
      for (const [b, s] of [[l.a, -1], [l.b, 1]] as const) {
        if (b.sinkingSince !== null) continue;
        b.motion.vx += n.x * push * s;
        b.motion.vy += n.y * push * s;
      }
      out.push({ type: 'linkBroken', a: l.a, b: l.b, reason: l.breakReason ?? 'released' });
    }

    // Docking eases advance.
    for (const l of this.links) {
      if (!l.ease) continue;
      l.ease.t += dt;
      if (l.ease.t >= l.ease.dur) l.ease = null;
    }

    const afloat = ctx.boats.filter((b) => b.sinkingSince === null);
    this.updateWarnings(ctx, afloat, dt);

    // 2) Contacts between hulls that aren't held together.
    for (let i = 0; i < afloat.length; i++) {
      for (let j = i + 1; j < afloat.length; j++) {
        const a = afloat[i];
        const b = afloat[j];
        if (this.groupOf(a).includes(b)) continue;
        const { gap, pa, pb } = hullGap(a, b);
        if (gap >= 0) continue;
        const ram = a.side !== b.side ? this.tryRam(ctx, a, b) : null;
        if (ram) {
          out.push(ram);
          continue;
        }
        const bump = this.bump(a, b, pa, pb, -gap, t.bounce);
        if (bump) out.push(bump);
      }
    }

    // 3) Docking: close, slow and lingering for the grapple time.
    for (let i = 0; i < afloat.length; i++) {
      for (let j = i + 1; j < afloat.length; j++) {
        const a = afloat[i];
        const b = afloat[j];
        const key = pairKey(a, b);
        const ok = this.dockable(ctx, a, b);
        const prev = this.grapple.get(key) ?? 0;
        if (!ok) {
          if (prev > 0) this.grapple.set(key, Math.max(0, prev - dt * 2));
          if ((this.grapple.get(key) ?? 0) <= 0) this.grapple.delete(key);
          continue;
        }
        const now = prev + dt;
        this.grapple.set(key, now);
        if (now >= Math.max(0, t.grappleTime)) {
          this.grapple.delete(key);
          this.dock(ctx, a, b);
          out.push({ type: 'docked', a, b });
        }
      }
    }
    // Dock rings come from the grapple timers.
    for (const [key, timer] of this.grapple) {
      const [ia, ib] = key.split('-').map(Number);
      const a = ctx.boats.find((x) => x.id === ia);
      const b = ctx.boats.find((x) => x.id === ib);
      if (!a || !b) continue;
      const { pa, pb } = hullGap(a, b);
      const player = a.side === 'player' ? a : b.side === 'player' ? b : null;
      const other = player === a ? b : a;
      this.warnings.push({
        kind: 'dock',
        key: `dock:${key}`,
        actorId: a.id,
        targetId: b.id,
        pos: { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 },
        progress: clamp(timer / Math.max(0.01, t.grappleTime), 0, 1),
        shownFor: timer,
        byPlayer: player !== null && ctx.playerAlongside === other.id,
      });
    }
    return out;
  }

  /** Two opposing boats that could start (or keep) grappling right now. */
  private dockable(ctx: AttachContext, a: Boat, b: Boat): boolean {
    const t = ctx.tuning.attach;
    if (a.side === b.side) return false;
    if (this.linkBetween(a, b)) return false;
    if ((this.cooldown.get(pairKey(a, b)) ?? -Infinity) > ctx.time) return false;
    const { gap } = hullGap(a, b);
    if (gap > t.dockDistance) return false;
    const rel = Math.hypot(a.motion.vx - b.motion.vx, a.motion.vy - b.motion.vy);
    if (rel > t.dockRelSpeed) return false;
    return this.canLink(a, sideFacing(a, b.motion), ctx.tuning) && this.canLink(b, sideFacing(b, a.motion), ctx.tuning);
  }

  /** Dock two boats right now (what the grapple timer does; tests and tools use it directly). */
  dockNow(ctx: AttachContext, a: Boat, b: Boat): void {
    this.dock(ctx, a.id < b.id ? a : b, a.id < b.id ? b : a);
  }

  private dock(ctx: AttachContext, a: Boat, b: Boat): void {
    const t = ctx.tuning.attach;
    const from = relPose(poseOf(a), poseOf(b));
    const sa = from.y >= 0 ? 1 : -1;
    // Parallel, nose to nose or nose to tail, whichever is closer to how they lie.
    const h = Math.abs(from.h) <= Math.PI / 2 ? 0 : Math.PI;
    const lim = (a.layout.length + b.layout.length) * 0.18;
    const to: Pose = {
      x: clamp(from.x, -lim, lim),
      y: sa * (a.layout.beam / 2 + b.layout.beam / 2 + Math.max(0, t.dockGap)),
      h,
    };
    const aInB = inversePose(to);
    this.links.push({
      id: this.nextId++,
      a,
      b,
      sideA: sa > 0 ? 'starboard' : 'port',
      sideB: aInB.y >= 0 ? 'starboard' : 'port',
      kind: 'dock',
      since: ctx.time,
      rel: to,
      ease: t.dockEaseTime > 0 ? { from, t: 0, dur: t.dockEaseTime } : null,
      breakAt: null,
      breakReason: null,
      castOff: null,
    });
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

  private tryRam(ctx: AttachContext, a: Boat, b: Boat): AttachEvent | null {
    const t = ctx.tuning;
    const options = [
      { r: a, target: b },
      { r: b, target: a },
    ].sort((x, y) => this.closing(y.r, y.target) - this.closing(x.r, x.target) || x.r.id - y.r.id);
    for (const { r, target } of options) {
      const speed = this.closing(r, target);
      if (speed < t.attach.ramSpeed) continue;
      const tip = toWorld(bowTipLocal(r), r.motion, r.motion.heading);
      const [s0, s1] = keelSegment(target);
      const q = closestOnSegment(tip, s0, s1);
      if (dist(tip, q) > hullCapsule(target).r + 0.6) continue;
      if (!this.squareOn(r, target, tip, t)) continue;
      const side = sideFacing(target, tip);
      if (!this.canLink(r, 'bow', t) || !this.canLink(target, side, t)) continue;
      // Telegraphed long enough? Otherwise it's a bump: nothing attaches by surprise.
      const w = this.warnings.find((x) => x.kind === 'ram' && x.key === `ram:${r.id}>${target.id}`);
      if (!w || w.shownFor < t.attach.ramMinWarning) continue;
      return this.ram(ctx, r, target, tip, q, side, speed);
    }
    return null;
  }

  private ram(ctx: AttachContext, r: Boat, target: Boat, tip: Vec, q: Vec, side: AttachSide, speed: number): AttachEvent {
    const t = ctx.tuning.attach;
    const part = partAt(target, tip, 4) ?? nearestPart(target, tip);
    const dmg = applyDamage(part, speed * Math.max(0, t.ramDamage)).dealt;
    const bow = r.parts.find((p) => p.def.role === 'bow') ?? null;
    const selfDmg = bow ? applyDamage(bow, speed * Math.max(0, t.ramDamage) * Math.max(0, t.ramSelfDamage)).dealt : 0;
    // Back the rammer out until its tip just touches the hull, and stop the closing motion.
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
    this.links.push({
      id: this.nextId++,
      a: r,
      b: target,
      sideA: 'bow',
      sideB: side,
      kind: 'ram',
      since: ctx.time,
      rel: relPose(poseOf(r), poseOf(target)),
      ease: null,
      breakAt: null,
      breakReason: null,
      castOff: null,
    });
    return { type: 'rammed', rammer: r, target, part, damage: dmg, selfPart: bow, selfDamage: selfDmg, pos: tip, speed };
  }

  /** Push overlapping hulls apart and bounce them off each other. */
  private bump(a: Boat, b: Boat, pa: Vec, pb: Vec, pen: number, bounce: number): AttachEvent | null {
    let n = { x: pb.x - pa.x, y: pb.y - pa.y };
    if (Math.hypot(n.x, n.y) < 1e-6) n = { x: b.motion.x - a.motion.x, y: b.motion.y - a.motion.y };
    if (Math.hypot(n.x, n.y) < 1e-6) n = { x: 1, y: 0 };
    n = unit(n);
    const ra = this.groupOf(a)[0];
    const rb = this.groupOf(b)[0];
    ra.motion.x -= (n.x * pen) / 2;
    ra.motion.y -= (n.y * pen) / 2;
    rb.motion.x += (n.x * pen) / 2;
    rb.motion.y += (n.y * pen) / 2;
    const vn = (rb.motion.vx - ra.motion.vx) * n.x + (rb.motion.vy - ra.motion.vy) * n.y;
    if (vn >= 0) return null;
    const k = (-(1 + clamp(bounce, 0, 1)) * vn) / 2;
    ra.motion.vx -= n.x * k;
    ra.motion.vy -= n.y * k;
    rb.motion.vx += n.x * k;
    rb.motion.vy += n.y * k;
    return -vn > 1 ? { type: 'bump', pos: { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 }, speed: -vn } : null;
  }

  /** Predict rams over the next ramWarnTime seconds (straight-line motion) and keep their X's up to date. */
  private updateWarnings(ctx: AttachContext, afloat: Boat[], dt: number): void {
    const t = ctx.tuning;
    const prev = new Map(this.warnings.filter((w) => w.kind === 'ram').map((w) => [w.key, w]));
    const next: ContactWarning[] = [];
    const horizon = Math.max(0, t.attach.ramWarnTime);
    for (const r of afloat) {
      for (const target of afloat) {
        if (r === target || r.side === target.side || this.linkBetween(r, target)) continue;
        if (this.closing(r, target) < t.attach.ramSpeed) continue;
        if (!this.canLink(r, 'bow', t)) continue;
        const hit = predictRam(r, target, horizon);
        if (!hit) continue;
        // Would it count? Square enough onto the hull, and a free side there.
        if (-(Math.cos(r.motion.heading) * hit.n.x + Math.sin(r.motion.heading) * hit.n.y) < Math.cos(clamp(t.attach.ramMaxAngle, 0, 89) * DEG)) continue;
        const local = toLocal(hit.tip, hit.center, target.motion.heading);
        const pos = toWorld(local, target.motion, target.motion.heading);
        if (!this.canLink(target, sideFacing(target, pos), t)) continue;
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

  // ------------------------------------------------------------ motion

  /** b's pose in a's frame right now (eased while docking). */
  currentRel(l: Attachment): Pose {
    if (!l.ease) return l.rel;
    const k = clamp(l.ease.t / Math.max(1e-6, l.ease.dur), 0, 1);
    const s = k * k * (3 - 2 * k);
    const f = l.ease.from;
    return { x: lerp(f.x, l.rel.x, s), y: lerp(f.y, l.rel.y, s), h: wrapAngle(f.h + wrapAngle(l.rel.h - f.h) * s) };
  }

  /** Boats that are part of an attached group (their own propulsion is overridden). */
  grouped(): Set<Boat> {
    const out = new Set<Boat>();
    for (const l of this.links) {
      out.add(l.a);
      out.add(l.b);
    }
    return out;
  }

  /**
   * Move every attached group as one rigid body: the lowest-id boat (the root)
   * slows to the drift speed and stops turning; the rest are placed by their links.
   */
  moveGroups(t: Tuning, dt: number): void {
    const done = new Set<Boat>();
    for (const boat of [...this.grouped()].sort((x, y) => x.id - y.id)) {
      if (done.has(boat)) continue;
      const group = this.groupOf(boat);
      const root = group[0];
      const m = root.motion;
      const speed = Math.hypot(m.vx, m.vy);
      const drift = Math.max(0, t.attach.driftSpeed);
      if (speed > drift) {
        const s = drift + (speed - drift) * Math.exp(-Math.max(0, t.attach.driftDecay) * dt);
        m.vx *= s / speed;
        m.vy *= s / speed;
      }
      m.omega = 0;
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      // Place the others outward from the root.
      const placed = new Set<Boat>([root]);
      const queue = [root];
      while (queue.length) {
        const parent = queue.shift()!;
        for (const l of this.linksOf(parent)) {
          const child = this.other(l, parent);
          if (placed.has(child)) continue;
          const rel = l.a === parent ? this.currentRel(l) : inversePose(this.currentRel(l));
          const p = compose(poseOf(parent), rel);
          child.motion.x = p.x;
          child.motion.y = p.y;
          child.motion.heading = p.h;
          child.motion.vx = m.vx;
          child.motion.vy = m.vy;
          child.motion.omega = 0;
          placed.add(child);
          queue.push(child);
        }
      }
      for (const b of group) done.add(b);
    }
  }
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
