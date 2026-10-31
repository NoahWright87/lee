// Nesses (Phase 8), built to be fought like boats.
//
// A Ness is an oval BODY that moves with the same motion code as every boat (a
// little faster than yours), a NECK and HEAD growing from the middle of one flank,
// and a HAND on each flank that can grab a hull. It swims at a DEPTH: 0 is on the
// surface, 1 is deep. The shadow under the water is the body at depth: bigger and
// lighter when deep, smaller and darker as it rises. What can hit it depends on the
// depth: cannons and pistols need it up (cannons also reach shallow), a mortar
// reaches any depth (badly, when deep), a depth charge only what is under the water.
//
// Its life: it CIRCLES you at range (never in a straight line), then runs in
// (APPROACH): shallow, then surfacing beside your hull. ALONGSIDE it bites with its
// neck (a red rectangle and a ⚠️ bubble warn first; the head stays on your boat for a
// moment afterwards: the window to hit it) and throws its hands (a hand that holds
// reels it in and stops you leaving; it can't dive while one holds). After a few
// bites it WITHDRAWS and circles again. Hurt enough, it lets go and FLEES, diving as
// it swims away. Killed, it floats with X'd eyes.
//
// A kind is data (config/ness.ts); slots on its flanks (hands now; feet, claws,
// spikes, special tails later) are data too.

import { NESS, NESS_SLOTS, type NessDef, type NessKindTuning, type NessSlotDef } from '../config/ness';
import type { Tuning } from '../config/tuning';
import { distanceToHull, hullCapsule, keelSegment, motionParams, type Boat } from './boat';
import { mass, nearestHullPoint } from './lines';
import { clamp, closestSegments, DEG, dist, lerp, toLocal, toWorld, type Rng, type Vec } from './math';
import { alongsideCommand, stepMotion, type MotionParams, type MotionState } from './steering';
import { leeStat, standingTile } from './crew';
import type { DangerZone } from './zones';
import type { World } from './world';

export type NessMode = 'circle' | 'approach' | 'alongside' | 'withdraw' | 'flee' | 'dead' | 'gone';
export type NeckState = 'rest' | 'windup' | 'strike' | 'hold' | 'retract';
export type HandState = 'stowed' | 'reaching' | 'holding' | 'retracting';
export type NessPartKind = 'body' | 'head' | 'hand';

export interface NessSpec {
  kind: string;
  level?: number;
  /** Points spent on it (generated ones): what it pays when slain. */
  budget?: number;
}

/** One hand: a slot on a flank, its own HP, and (while it holds) a line to a hull. */
export interface NessHand {
  slot: NessSlotDef;
  state: HandState;
  /** Seconds in this state. */
  t: number;
  hp: number;
  maxHp: number;
  /** Where it is (world), and for a throw where it left and lands. */
  pos: Vec;
  from: Vec;
  to: Vec;
  flight: number;
  /** Holding: the boat, the point it holds on that boat (the boat's frame), how close the line lets the hulls be (m), and the world time it must let go (a retreat), or null. */
  boat: Boat | null;
  attach: Vec | null;
  limit: number;
  letGoAt: number | null;
  /** World time it can throw again. */
  readyAt: number;
}

export interface Neck {
  /** The flank it grows from: -1 port, +1 starboard (the body's frame). */
  side: -1 | 1;
  state: NeckState;
  t: number;
  /** The bite: where the head is going (the body's frame, so it stays put while the boats keep station), and the warning on your deck. */
  target: Vec | null;
  zone: DangerZone | null;
  /** The head now (world), and the neck's joints from the flank to it. */
  head: Vec;
  pts: Vec[];
  /** Seconds until the next bite. */
  cool: number;
}

export interface Ness {
  id: number;
  kind: string;
  def: NessDef;
  level: number;
  side: 'enemy';
  /** The body's motion: the same state every boat has. */
  motion: MotionState;
  length: number;
  beam: number;
  mass: number;
  hp: number;
  maxHp: number;
  /** 0 on the surface .. 1 deep; it moves toward `depthTarget`. */
  depth: number;
  depthTarget: number;
  mode: NessMode;
  modeT: number;
  /** World time it entered this mode. */
  since: number;
  /** Circling: which way, where on the circle, the wobble's phase, and how long until it attacks. */
  dir: 1 | -1;
  angle: number;
  phase: number;
  circleFor: number;
  /** Which side of the player's hull it comes to (+1 starboard, -1 port): the one its neck faces. */
  boatSide: 1 | -1;
  /** Bites this pass, and seconds alongside. */
  bites: number;
  alongT: number;
  /** Where it will break the surface (for the ⚠️), or null. */
  emergeAt: Vec | null;
  neck: Neck;
  hands: NessHand[];
  /** World time it died or got away, or null. */
  diedAt: number | null;
  /** Lees striking its head: seconds until each one's next swing. */
  swing: Map<number, number>;
}

export const nessKind = (t: Tuning, id: string): NessKindTuning => t.ness.kinds[id] ?? t.ness.kinds.ness;
export const nessDef = (id: string): NessDef => NESS[id] ?? NESS.ness;

export const isAlive = (n: Ness): boolean => n.mode !== 'dead' && n.mode !== 'gone';
export const isGone = (n: Ness): boolean => n.mode === 'gone';

export function createNess(id: number, spec: NessSpec, t: Tuning, pos: Vec, heading: number, rng: Rng, time = 0): Ness {
  const def = nessDef(spec.kind);
  const k = nessKind(t, def.id);
  const level = Math.max(1, Math.round(spec.level ?? 1));
  const hp = k.hp * (1 + Math.max(0, t.ness.common.levelScale) * (level - 1));
  const side: -1 | 1 = rng.next() < 0.5 ? -1 : 1;
  const n: Ness = {
    id,
    kind: def.id,
    def,
    level,
    side: 'enemy',
    motion: { x: pos.x, y: pos.y, heading, vx: 0, vy: 0, omega: 0, orbitSide: 0 },
    length: k.length,
    beam: k.beam,
    mass: k.mass,
    hp,
    maxHp: hp,
    depth: k.circleDepth,
    depthTarget: k.circleDepth,
    mode: 'circle',
    modeT: 0,
    since: time,
    dir: rng.next() < 0.5 ? -1 : 1,
    angle: Math.atan2(pos.y, pos.x),
    phase: rng.range(0, Math.PI * 2),
    circleFor: rng.range(k.circleMin, k.circleMax) + 3,
    boatSide: side === 1 ? -1 : 1,
    bites: 0,
    alongT: 0,
    emergeAt: null,
    neck: { side, state: 'rest', t: 0, target: null, zone: null, head: { ...pos }, pts: [], cool: k.biteFirst },
    hands: NESS_SLOTS.filter((s) => s.type === 'hand').map((slot) => ({
      slot,
      state: 'stowed' as HandState,
      t: 0,
      hp: k.handHp,
      maxHp: k.handHp,
      pos: { ...pos },
      from: { ...pos },
      to: { ...pos },
      flight: 0,
      boat: null,
      attach: null,
      limit: 0,
      letGoAt: null,
      readyAt: time + k.handFirst,
    })),
    diedAt: null,
    swing: new Map(),
  };
  layoutNeck(n, k, time);
  return n;
}

// ------------------------------------------------------------ geometry

/** The body in world terms. */
export const bodyWorld = (n: Ness, local: Vec): Vec => toWorld(local, n.motion, n.motion.heading);
export const bodyLocal = (n: Ness, world: Vec): Vec => toLocal(world, n.motion, n.motion.heading);

/** The oval's keel segment and radius, as a boat's hull capsule (for bumps and pulls). */
export function nessKeel(n: Ness): { a: Vec; b: Vec; r: number } {
  const r = n.beam / 2;
  const half = Math.max(0, n.length / 2 - r);
  const c = Math.cos(n.motion.heading);
  const s = Math.sin(n.motion.heading);
  return { a: { x: n.motion.x - c * half, y: n.motion.y - s * half }, b: { x: n.motion.x + c * half, y: n.motion.y + s * half }, r };
}

/** Gap between the body and a hull, m (negative = overlapping), with the nearest points on each. */
export function bodyGap(n: Ness, boat: Boat): { gap: number; pn: Vec; pb: Vec } {
  const k = nessKeel(n);
  const [b0, b1] = keelSegment(boat);
  const c = closestSegments(k.a, k.b, b0, b1);
  return { gap: c.d - k.r - hullCapsule(boat).r, pn: c.a, pb: c.b };
}

/** Distance from a point to the oval's edge (negative inside). */
export function ovalGap(n: Ness, p: Vec): number {
  const l = bodyLocal(n, p);
  const a = n.length / 2;
  const b = n.beam / 2;
  return (Math.hypot(l.x / a, l.y / b) - 1) * Math.min(a, b);
}

/** Where the neck grows from (the middle of its flank), in the body's frame and the world. */
export const neckAnchorLocal = (n: Ness): Vec => ({ x: 0, y: n.neck.side * (n.beam / 2) });
export const neckAnchor = (n: Ness): Vec => bodyWorld(n, neckAnchorLocal(n));

/** The neck's longest reach from its flank, m. */
export const neckReach = (k: NessKindTuning): number => k.neckSegments * k.neckLength;

export type NessBand = 'surface' | 'shallow' | 'deep';

/** How deep it is, in the bands weapons care about. */
export function bandOf(n: Ness, k: NessKindTuning): NessBand {
  return n.depth <= k.surfacedMax ? 'surface' : n.depth <= k.shallowMax ? 'shallow' : 'deep';
}

/**
 * Can a gun of this mode hit a Ness at this depth? Cannons (and scrap) reach it on the surface and just under it; a mortar's steep shell
 * reaches any depth (badly, when deep); a depth gun only what is under the water. A harpoon and a stream gun only hit ships and crews.
 */
export function gunReaches(mode: string, band: NessBand): boolean {
  switch (mode) {
    case 'shell':
    case 'burst':
      return band !== 'deep';
    case 'lob':
      return true;
    case 'depth':
      return band !== 'surface';
    default:
      return false;
  }
}

/** Is the head on a boat now (striking or held there), so Lees can hit it? */
export function isHeadOpen(n: Ness): boolean {
  return isAlive(n) && (n.neck.state === 'hold' || n.neck.state === 'strike');
}

/** The hand's place on its flank (world). */
export function handSlotWorld(n: Ness, h: NessHand): Vec {
  return bodyWorld(n, { x: h.slot.along * n.length, y: h.slot.side * (n.beam / 2) });
}

/** Where a point lands on a Ness: its head, a hand that is out, or the body. */
export function hitAt(n: Ness, k: NessKindTuning, p: Vec, radius = 0): { part: NessPartKind; hand?: NessHand } | null {
  if (!isAlive(n)) return null;
  if (dist(p, n.neck.head) <= k.headRadius + radius) return { part: 'head' };
  for (const h of n.hands) if (h.state !== 'stowed' && h.state !== 'retracting' && dist(p, h.pos) <= k.handRadius + radius) return { part: 'hand', hand: h };
  if (ovalGap(n, p) <= radius) return { part: 'body' };
  return null;
}

/** Everything a pistol or gun can pick as a mark. */
export function marks(n: Ness, k: NessKindTuning): { part: NessPartKind; hand?: NessHand; pos: Vec; radius: number }[] {
  if (!isAlive(n)) return [];
  const out: { part: NessPartKind; hand?: NessHand; pos: Vec; radius: number }[] = [{ part: 'body', pos: { x: n.motion.x, y: n.motion.y }, radius: n.beam / 2 }];
  out.push({ part: 'head', pos: n.neck.head, radius: k.headRadius });
  for (const h of n.hands) if (h.state === 'reaching' || h.state === 'holding') out.push({ part: 'hand', hand: h, pos: h.pos, radius: k.handRadius });
  return out;
}

/** Points that bound it, for the camera. */
export function extentPoints(n: Ness): Vec[] {
  const out: Vec[] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) out.push(bodyWorld(n, { x: (sx * n.length) / 2, y: (sy * n.beam) / 2 }));
  out.push(n.neck.head);
  return out;
}

// ------------------------------------------------------------ neck

/** The head where it rests, tucked against its flank (the body's frame). */
function restLocal(n: Ness, k: NessKindTuning): Vec {
  return { x: 0, y: n.neck.side * (n.beam / 2 + k.headRadius * 0.9) };
}

/** Rearing back: the head pulled in from rest, away from the target. */
function rearLocal(n: Ness, k: NessKindTuning): Vec {
  const r = restLocal(n, k);
  const t = n.neck.target ?? r;
  const a = neckAnchorLocal(n);
  const d = Math.hypot(t.x - a.x, t.y - a.y) || 1;
  const pull = 1.8;
  return { x: r.x - ((t.x - a.x) / d) * pull, y: r.y - ((t.y - a.y) / d) * pull * 0.6 };
}

const ease = (f: number): number => f * f * (3 - 2 * f);

/** Put the head and neck where the current state says (and the neck's joints along a curve between). */
export function layoutNeck(n: Ness, k: NessKindTuning, _time: number): void {
  const neck = n.neck;
  const rest = restLocal(n, k);
  const target = neck.target ?? rest;
  const rear = rearLocal(n, k);
  let head: Vec;
  switch (neck.state) {
    case 'windup': {
      const f = ease(clamp(neck.t / Math.max(0.05, k.biteWarn), 0, 1));
      head = { x: lerp(rest.x, rear.x, f), y: lerp(rest.y, rear.y, f) };
      break;
    }
    case 'strike': {
      const f = 1 - Math.pow(1 - clamp(neck.t / Math.max(0.05, k.biteStrike), 0, 1), 3);
      head = { x: lerp(rear.x, target.x, f), y: lerp(rear.y, target.y, f) };
      break;
    }
    case 'hold':
      head = { ...target };
      break;
    case 'retract': {
      const f = ease(clamp(neck.t / Math.max(0.05, k.biteRetract), 0, 1));
      head = { x: lerp(target.x, rest.x, f), y: lerp(target.y, rest.y, f) };
      break;
    }
    default:
      head = rest;
  }
  neck.head = bodyWorld(n, head);
  // Joints: along the line from the flank to the head, bowed more the more the neck is curled up.
  const a = neckAnchorLocal(n);
  const len = Math.hypot(head.x - a.x, head.y - a.y);
  const ext = clamp(len / Math.max(1, neckReach(k)), 0, 1);
  const bow = (1 - ext) * 2.6 * (n.neck.side === 1 ? 1 : -1);
  const dx = (head.x - a.x) / (len || 1);
  const dy = (head.y - a.y) / (len || 1);
  neck.pts = [];
  for (let i = 0; i <= k.neckSegments; i++) {
    const f = i / k.neckSegments;
    const sag = Math.sin(Math.PI * f) * bow;
    neck.pts.push(bodyWorld(n, { x: lerp(a.x, head.x, f) - dy * sag, y: lerp(a.y, head.y, f) + dx * sag }));
  }
}

// ------------------------------------------------------------ the system

export class NessSystem {
  readonly list: Ness[] = [];

  add(n: Ness): void {
    this.list.push(n);
  }

  /** Not dead, not gone. */
  alive(): Ness[] {
    return this.list.filter(isAlive);
  }

  /** The motion parameters of this Ness: boat movement numbers, its own top speed (a bit more than yours) and turn rate. */
  params(w: World, n: Ness, throttle = 1): MotionParams {
    const t = w.tuning;
    const k = nessKind(t, n.kind);
    const mv = t.boat.movement;
    const mine = motionParams(w.player, t).cruiseSpeed;
    return {
      cruiseSpeed: Math.max(k.minSpeed, mine * k.speedMul),
      acceleration: mv.acceleration,
      drag: mv.drag,
      turnRate: k.turnRate * DEG,
      turnAcceleration: mv.turnAcceleration * DEG,
      lateralDrag: mv.lateralDrag,
      turnSpeedLoss: mv.turnSpeedLoss,
      throttle,
      orbitRadiusScale: mv.orbitRadiusScale,
      orbitCapture: 0,
    };
  }

  /** Hurt it: head shots count double. Past `fleeAt` it breaks off; at zero it dies. */
  hurt(w: World, n: Ness, amount: number, part: NessPartKind = 'body', at?: Vec): { dealt: number; killed: boolean } {
    if (!isAlive(n) || amount <= 0) return { dealt: 0, killed: false };
    const k = nessKind(w.tuning, n.kind);
    const dmg = Math.min(n.hp, amount * Math.max(0, w.tuning.ness.common.damageTaken) * (part === 'head' ? Math.max(1, k.headMul) : 1));
    n.hp -= dmg;
    w.events.push({ type: 'nessHit', nessId: n.id, part, pos: at ?? { x: n.motion.x, y: n.motion.y }, damage: dmg });
    if (n.hp <= 1e-9) {
      n.hp = 0;
      this.die(w, n);
      return { dealt: dmg, killed: true };
    }
    if (n.hp <= n.maxHp * Math.max(0, k.fleeAt) && n.mode !== 'flee') this.setMode(w, n, 'flee');
    return { dealt: dmg, killed: false };
  }

  /** Hurt a hand. At zero it lets go. */
  hurtHand(w: World, n: Ness, h: NessHand, amount: number): number {
    if (h.state === 'stowed' || amount <= 0) return 0;
    const dmg = Math.min(h.hp, amount);
    h.hp -= dmg;
    w.events.push({ type: 'nessHit', nessId: n.id, part: 'hand', pos: { ...h.pos }, damage: dmg });
    if (h.hp <= 1e-9) this.letGo(w, n, h, true);
    return dmg;
  }

  private setMode(w: World, n: Ness, mode: NessMode): void {
    n.mode = mode;
    n.modeT = 0;
    n.since = w.time;
    if (mode === 'flee') {
      const k = nessKind(w.tuning, n.kind);
      this.cancelBite(w, n);
      for (const h of n.hands) if (h.state === 'holding') h.letGoAt = w.time + Math.max(0, k.releaseTime);
      w.events.push({ type: 'nessFlee', nessId: n.id });
    }
  }

  private cancelBite(w: World, n: Ness): void {
    if (n.neck.zone) w.zones.cancel(n.id);
    n.neck.zone = null;
    if (n.neck.state === 'windup' || n.neck.state === 'strike') {
      n.neck.state = 'retract';
      n.neck.t = 0;
    }
  }

  private die(w: World, n: Ness): void {
    n.mode = 'dead';
    n.modeT = 0;
    n.since = w.time;
    n.diedAt = w.time;
    n.depthTarget = 0;
    n.emergeAt = null;
    n.neck.state = 'rest';
    n.neck.zone = null;
    w.zones.cancel(n.id);
    for (const h of n.hands) if (h.state !== 'stowed') this.letGo(w, n, h, false);
    w.events.push({ type: 'nessDown', nessId: n.id, pos: { x: n.motion.x, y: n.motion.y } });
  }

  /** A hand lets go (cut, shot off, or it chose to): it pulls back and cools down. */
  letGo(w: World, n: Ness, h: NessHand, freed: boolean): void {
    const k = nessKind(w.tuning, n.kind);
    const was = h.state === 'holding';
    h.state = 'retracting';
    h.t = 0;
    h.boat = null;
    h.attach = null;
    h.letGoAt = null;
    h.readyAt = w.time + Math.max(0, k.handCooldown) * (freed ? 1.5 : 1);
    h.hp = h.maxHp;
    if (was) w.events.push({ type: 'handFree', nessId: n.id, freed });
  }

  /** Is a hand holding a hull? (It can't dive then.) */
  holding(n: Ness): boolean {
    return n.hands.some((h) => h.state === 'holding');
  }

  step(w: World, dt: number): void {
    for (const n of this.list) {
      if (n.mode === 'gone') continue;
      n.modeT += dt;
      const k = nessKind(w.tuning, n.kind);
      const wasDepth = n.depth;
      switch (n.mode) {
        case 'circle':
          this.circle(w, n, k, dt);
          break;
        case 'approach':
          this.approach(w, n, k, dt);
          break;
        case 'alongside':
          this.alongside(w, n, k, dt);
          break;
        case 'withdraw':
          this.withdraw(w, n, k, dt);
          break;
        case 'flee':
          this.flee(w, n, k, dt);
          break;
        case 'dead':
          this.dead(w, n, dt);
          break;
      }
      this.stepDepth(n, k, dt);
      // Breaking the surface, and going under, are moments the sea notices.
      if (wasDepth > k.surfacedMax && n.depth <= k.surfacedMax) w.events.push({ type: 'nessSurface', nessId: n.id, pos: { x: n.motion.x, y: n.motion.y }, radius: n.beam });
      if (wasDepth <= k.surfacedMax && n.depth > k.surfacedMax && n.mode !== 'dead') w.events.push({ type: 'nessDive', nessId: n.id, pos: { x: n.motion.x, y: n.motion.y } });
      this.bump(w, n, k);
      this.stepNeck(w, n, k, dt);
      this.stepHands(w, n, k, dt);
      this.strikeHead(w, n, k, dt);
    }
  }

  // ------------------------------------------------------------ depth

  private stepDepth(n: Ness, k: NessKindTuning, dt: number): void {
    const want = n.mode === 'dead' ? 0 : n.depthTarget;
    if (n.depth > want) {
      const rate = n.depth > k.shallowDepth ? 0.35 : Math.max(0.05, k.shallowDepth) / Math.max(0.2, k.emergeTime);
      n.depth = Math.max(want, n.depth - rate * dt);
    } else if (n.depth < want) {
      n.depth = Math.min(want, n.depth + dt / Math.max(0.5, k.diveTime));
    }
  }

  // ------------------------------------------------------------ circling and approaching

  /** Swim a loose circle around you, never a straight line, until it is time to attack. */
  private circle(w: World, n: Ness, k: NessKindTuning, dt: number): void {
    const me = w.player.motion;
    const params = this.params(w, n, 0.85);
    const R = k.circleRange + k.circleWobble * Math.sin(n.modeT * 0.55 + n.phase);
    const toMe = Math.atan2(n.motion.y - me.y, n.motion.x - me.x);
    const d = dist(n.motion, me);
    // On the circle (or near it) the angle advances at the swimming pace; far off it just heads for the circle.
    if (d < R + 25) {
      const v = Math.max(2, Math.hypot(n.motion.vx, n.motion.vy));
      n.angle = toMe + n.dir * Math.min(0.9, (v * 1.4) / Math.max(20, R));
    } else n.angle = toMe;
    const goal = { x: me.x + Math.cos(n.angle) * R, y: me.y + Math.sin(n.angle) * R };
    stepMotion(n.motion, goal, params, dt);
    n.depthTarget = k.circleDepth;
    n.emergeAt = null;
    if (!w.isSinking(w.player) && n.modeT >= n.circleFor && d < R + 40) this.setMode(w, n, 'approach');
  }

  /** The slot beside your hull this Ness runs for (its neck side faces the boat). */
  private slot(w: World, n: Ness, k: NessKindTuning): { spec: { other: MotionState; offset: number; side: number }; point: Vec } {
    const me = w.player;
    const offset = me.layout.beam / 2 + n.beam / 2 + Math.max(0, k.standoff);
    const o = me.motion;
    const perp = { x: -Math.sin(o.heading), y: Math.cos(o.heading) };
    return { spec: { other: o, offset, side: n.boatSide }, point: { x: o.x + perp.x * offset * n.boatSide, y: o.y + perp.y * offset * n.boatSide } };
  }

  /** Run in: shallow first (the shadow shrinks and darkens), then break the surface beside your hull. */
  private approach(w: World, n: Ness, k: NessKindTuning, dt: number): void {
    const { spec, point } = this.slot(w, n, k);
    const base = this.params(w, n, 1);
    // The run in is quick: faster than its ordinary swimming, so it can catch a boat that is sailing.
    const params = { ...base, cruiseSpeed: base.cruiseSpeed * Math.max(1, k.chargeMul) };
    const cmd = alongsideCommand(n.motion, spec, params);
    stepMotion(n.motion, cmd.target, { ...params, throttle: Math.max(0.25, cmd.throttle) }, dt);
    const d = dist(n.motion, point);
    const speed = Math.max(2, Math.hypot(n.motion.vx, n.motion.vy));
    // How long it will take to arrive decides when it must start surfacing, so it is up as it gets there.
    const eta = d / speed;
    const surfaceIn = Math.max(0.5, k.emergeTime) + 0.4;
    if (d > k.approachFrom) n.depthTarget = k.circleDepth - 0.15;
    else if (eta > surfaceIn) n.depthTarget = k.shallowDepth;
    else n.depthTarget = 0;
    // The ⚠️ where it will break the surface: on the shadow if it is still, just ahead of it if it is moving.
    if (n.depthTarget < n.depth && n.depth > k.surfacedMax && n.depth <= k.shallowMax + 0.25) {
      const rate = Math.max(0.05, k.shallowDepth) / Math.max(0.2, k.emergeTime);
      const tt = Math.max(0, n.depth - k.surfacedMax) / rate;
      n.emergeAt = { x: n.motion.x + n.motion.vx * tt, y: n.motion.y + n.motion.vy * tt };
    } else n.emergeAt = null;
    if (d <= 12 && n.depth <= k.surfacedMax) {
      this.setMode(w, n, 'alongside');
      n.alongT = 0;
      n.bites = 0;
      n.neck.cool = k.biteFirst;
      n.emergeAt = null;
    } else if (n.modeT > 30 || w.isSinking(w.player)) this.setMode(w, n, 'withdraw');
  }

  // ------------------------------------------------------------ alongside

  private alongside(w: World, n: Ness, k: NessKindTuning, dt: number): void {
    const { spec } = this.slot(w, n, k);
    const params = this.params(w, n, 1);
    const cmd = alongsideCommand(n.motion, spec, params);
    stepMotion(n.motion, cmd.target, { ...params, throttle: Math.max(0.2, cmd.throttle) }, dt);
    n.depthTarget = 0;
    n.alongT += dt;
    n.emergeAt = null;
    const idle = n.neck.state === 'rest' && !this.holding(n);
    if (idle && (n.bites >= Math.max(1, Math.round(k.bitesPerPass)) || w.isSinking(w.player))) this.setMode(w, n, 'withdraw');
  }

  /** Sink away and swim off a way before circling again. */
  private withdraw(w: World, n: Ness, k: NessKindTuning, dt: number): void {
    const me = w.player.motion;
    const params = this.params(w, n, 1);
    const away = Math.atan2(n.motion.y - me.y, n.motion.x - me.x);
    stepMotion(n.motion, { x: n.motion.x + Math.cos(away) * 80, y: n.motion.y + Math.sin(away) * 80 }, params, dt);
    n.depthTarget = k.circleDepth;
    n.emergeAt = null;
    if (!this.holding(n) && n.depth >= k.circleDepth - 0.05) {
      this.setMode(w, n, 'circle');
      n.circleFor = w.rng.range(k.circleMin, k.circleMax);
      n.dir = w.rng.next() < 0.5 ? -1 : 1;
    }
  }

  /** Hurt enough: let go, dive, and swim away. It can't dive while a hand holds, so the hands go first. */
  private flee(w: World, n: Ness, k: NessKindTuning, dt: number): void {
    const me = w.player.motion;
    const params = this.params(w, n, 1);
    const away = Math.atan2(n.motion.y - me.y, n.motion.x - me.x);
    stepMotion(n.motion, { x: n.motion.x + Math.cos(away) * 80, y: n.motion.y + Math.sin(away) * 80 }, params, dt);
    n.emergeAt = null;
    for (const h of n.hands) if (h.state === 'holding' && h.letGoAt !== null && w.time >= h.letGoAt) this.letGo(w, n, h, false);
    n.depthTarget = this.holding(n) ? 0 : 1;
    if (n.depth >= 0.95 && dist(n.motion, me) > k.fleeGone) {
      n.mode = 'gone';
      n.diedAt = w.time;
      w.events.push({ type: 'nessGone', nessId: n.id });
    }
  }

  /** Floating on the surface, drifting to a stop. */
  private dead(w: World, n: Ness, dt: number): void {
    stepMotion(n.motion, null, { ...this.params(w, n, 0), drag: 1.2 }, dt);
    n.depthTarget = 0;
  }

  // ------------------------------------------------------------ bumping

  /** On the surface it is solid: it shoves off any hull it overlaps (with a thump), and a hull shoves it. */
  private bump(w: World, n: Ness, k: NessKindTuning): void {
    if (n.depth > k.surfacedMax || n.mode === 'gone') return;
    for (const b of w.boats) {
      if (w.isSinking(b)) continue;
      const g = bodyGap(n, b);
      if (g.gap >= 0) continue;
      const dx = g.pb.x - g.pn.x;
      const dy = g.pb.y - g.pn.y;
      const d = Math.hypot(dx, dy) || 1;
      const nx = dx / d;
      const ny = dy / d;
      const mN = Math.max(0.1, n.mass);
      const mB = mass(b, w.tuning);
      const wN = mB / (mN + mB);
      const wB = mN / (mN + mB);
      n.motion.x += nx * g.gap * wN;
      n.motion.y += ny * g.gap * wN;
      b.motion.x -= nx * g.gap * wB;
      b.motion.y -= ny * g.gap * wB;
      const rv = (b.motion.vx - n.motion.vx) * nx + (b.motion.vy - n.motion.vy) * ny;
      if (rv < 0) {
        n.motion.vx += nx * rv * wN * 0.8;
        n.motion.vy += ny * rv * wN * 0.8;
        b.motion.vx -= nx * rv * wB * 0.8;
        b.motion.vy -= ny * rv * wB * 0.8;
        if (-rv > 1.5) w.events.push({ type: 'bump', pos: { x: (g.pn.x + g.pb.x) / 2, y: (g.pn.y + g.pb.y) / 2 }, speed: -rv });
      }
    }
  }

  // ------------------------------------------------------------ the neck

  /** The tile of your deck the head will bite: a target in reach and in the cone, preferring the one with the most Lees. Null if nothing is in reach. */
  private biteTarget(w: World, n: Ness, k: NessKindTuning): Vec | null {
    const me = w.player;
    const a = neckAnchorLocal(n);
    const cone = (Math.max(10, k.neckCone) / 2) * DEG;
    const reach = neckReach(k);
    let best: Vec | null = null;
    let bestScore = -Infinity;
    for (const tile of me.grid.tiles) {
      const l = bodyLocal(n, toWorld(tile.center, me.motion, me.motion.heading));
      const vx = l.x - a.x;
      const vy = l.y - a.y;
      const d = Math.hypot(vx, vy);
      if (d > reach || d < 1) continue;
      // Within the cone ahead of the neck (straight out from its flank).
      if ((vy * n.neck.side) / d < Math.cos(cone)) continue;
      const lees = w.allLees().filter((x) => x.alive && !x.swing && x.deck === me && standingTile(x) === tile.index).length;
      const score = lees * 10 - d;
      if (score > bestScore) {
        bestScore = score;
        best = l;
      }
    }
    return best;
  }

  private stepNeck(w: World, n: Ness, k: NessKindTuning, dt: number): void {
    const neck = n.neck;
    neck.t += dt;
    if (!isAlive(n)) {
      neck.state = 'rest';
      layoutNeck(n, k, w.time);
      return;
    }
    switch (neck.state) {
      case 'rest':
        neck.cool -= dt;
        if (n.mode === 'alongside' && neck.cool <= 0 && !w.result) {
          const target = this.biteTarget(w, n, k);
          if (target) {
            neck.target = target;
            neck.state = 'windup';
            neck.t = 0;
            layoutNeck(n, k, w.time);
            neck.zone = w.zones.add({
              boat: w.player,
              warn: Math.max(0.1, k.biteWarn) + Math.max(0.05, k.biteStrike),
              source: n.id,
              shape: () => ({ a: bodyWorld(n, rearLocal(n, k)), b: bodyWorld(n, neck.target ?? restLocal(n, k)), width: k.biteWidth, tip: k.biteTipRadius, neckShare: k.biteNeckShare }),
            });
            w.events.push({ type: 'nessBite', nessId: n.id, stage: 'windup' });
          } else neck.cool = 0.4;
        }
        break;
      case 'windup':
        if (neck.t >= k.biteWarn) {
          neck.state = 'strike';
          neck.t = 0;
          w.events.push({ type: 'nessBite', nessId: n.id, stage: 'strike' });
        }
        break;
      case 'strike':
        if (neck.t >= k.biteStrike) {
          neck.state = 'hold';
          neck.t = 0;
          n.bites++;
          w.events.push({ type: 'nessBite', nessId: n.id, stage: 'hold' });
        }
        break;
      case 'hold':
        if (neck.t >= k.biteHold) {
          neck.state = 'retract';
          neck.t = 0;
        }
        break;
      case 'retract':
        if (neck.t >= k.biteRetract) {
          neck.state = 'rest';
          neck.t = 0;
          neck.target = null;
          neck.zone = null;
          neck.cool = k.biteCooldown;
        }
        break;
    }
    layoutNeck(n, k, w.time);
  }

  // ------------------------------------------------------------ hands

  private stepHands(w: World, n: Ness, k: NessKindTuning, dt: number): void {
    const me = w.player;
    for (const h of n.hands) {
      h.t += dt;
      const slot = handSlotWorld(n, h);
      switch (h.state) {
        case 'stowed': {
          h.pos = slot;
          if (n.mode !== 'alongside' || n.alongT < k.handFirst || w.time < h.readyAt || n.depth > k.surfacedMax || w.isSinking(me)) break;
          // Only the flank that faces your hull, in reach.
          const hull = nearestHullPoint(me, slot);
          const out = { x: Math.cos(n.motion.heading + h.slot.side * (Math.PI / 2)), y: Math.sin(n.motion.heading + h.slot.side * (Math.PI / 2)) };
          const facing = (hull.x - slot.x) * out.x + (hull.y - slot.y) * out.y > 0;
          if (!facing || dist(slot, hull) > k.handReach) break;
          const flight = Math.max(0.1, k.handFlight);
          const to = nearestHullPoint(me, { x: slot.x + me.motion.vx * flight, y: slot.y + me.motion.vy * flight });
          h.from = slot;
          h.to = { x: to.x + me.motion.vx * flight, y: to.y + me.motion.vy * flight };
          h.flight = flight;
          h.state = 'reaching';
          h.t = 0;
          // Where it will land is marked (a hook's throw is too): steer off it, or take the grab.
          w.telegraphs.add('area', h.to, flight, w.tuning.telegraph.lingerTime, Math.max(1.5, k.handCatch));
          w.events.push({ type: 'handThrown', nessId: n.id, from: h.from, to: h.to, flight });
          break;
        }
        case 'reaching': {
          const f = clamp(h.t / h.flight, 0, 1);
          h.pos = { x: lerp(h.from.x, h.to.x, f), y: lerp(h.from.y, h.to.y, f) };
          if (f < 1) break;
          // Landed: it holds if the hull is where the throw came down.
          if (!w.isSinking(me) && distanceToHull(me, h.to) <= k.handCatch) {
            h.state = 'holding';
            h.t = 0;
            h.boat = me;
            h.attach = toLocal(nearestHullPoint(me, h.to), me.motion, me.motion.heading);
            h.limit = Math.max(k.handClose, bodyGap(n, me).gap);
            h.letGoAt = null;
            w.events.push({ type: 'handGrab', nessId: n.id, boatId: me.id });
          } else {
            h.state = 'retracting';
            h.t = 0;
            h.readyAt = w.time + Math.max(0, k.handCooldown) * 0.5;
          }
          break;
        }
        case 'holding': {
          const b = h.boat;
          if (!b || w.isSinking(b) || !isAlive(n)) {
            this.letGo(w, n, h, false);
            break;
          }
          const hold = toWorld(h.attach!, b.motion, b.motion.heading);
          h.pos = hold;
          h.limit = Math.max(k.handClose, h.limit - Math.max(0, k.handReel) * dt);
          break;
        }
        case 'retracting': {
          // Pulls back to its flank.
          const f = clamp(h.t / 0.5, 0, 1);
          h.pos = { x: lerp(h.pos.x, slot.x, f), y: lerp(h.pos.y, slot.y, f) };
          if (f >= 1) {
            h.state = 'stowed';
            h.t = 0;
            h.pos = slot;
          }
          break;
        }
      }
    }
    this.pull(w, n, k, dt);
  }

  /** Holding hands reel the Ness and the boat together (by mass): neither can get further apart than the shortest line lets. */
  private pull(w: World, n: Ness, k: NessKindTuning, dt: number): void {
    void dt;
    const held = n.hands.filter((h) => h.state === 'holding' && h.boat);
    if (!held.length) return;
    const b = held[0].boat!;
    const limit = Math.min(...held.map((h) => h.limit));
    const g = bodyGap(n, b);
    if (g.gap <= limit) return;
    const excess = g.gap - limit;
    const dx = g.pb.x - g.pn.x;
    const dy = g.pb.y - g.pn.y;
    const d = Math.hypot(dx, dy) || 1;
    const nx = dx / d;
    const ny = dy / d;
    const mN = Math.max(0.1, n.mass);
    const mB = mass(b, w.tuning);
    const wN = mB / (mN + mB);
    const wB = mN / (mN + mB);
    n.motion.x += nx * excess * wN;
    n.motion.y += ny * excess * wN;
    b.motion.x -= nx * excess * wB;
    b.motion.y -= ny * excess * wB;
    // Pulling apart (the faster one drags the other): they share the separating speed.
    const sep = (n.motion.vx - b.motion.vx) * -nx + (n.motion.vy - b.motion.vy) * -ny;
    if (sep > 0) {
      n.motion.vx += nx * sep * wN;
      n.motion.vy += ny * sep * wN;
      b.motion.vx -= nx * sep * wB;
      b.motion.vy -= ny * sep * wB;
    }
    void k;
  }

  // ------------------------------------------------------------ hitting the head

  /** The head is on your boat: Lees standing by it swing at it (a sword hit is a head shot). */
  private strikeHead(w: World, n: Ness, k: NessKindTuning, dt: number): void {
    const t = w.tuning;
    const open = (n.neck.state === 'hold' || n.neck.state === 'strike') && isAlive(n) && n.depth <= k.surfacedMax;
    if (!open) {
      n.swing.clear();
      return;
    }
    const reach = k.headRadius + 1.6;
    for (const l of w.allLees()) {
      if (!l.alive || l.swing || l.side !== 'player' || l.engaged) continue;
      const at = toWorld(l.pos, l.deck.motion, l.deck.motion.heading);
      if (dist(at, n.neck.head) > reach) {
        n.swing.delete(l.id);
        continue;
      }
      const cd = (n.swing.get(l.id) ?? 0.4) - dt * Math.max(0, t.melee.rate) * leeStat(l, 'meleeRate', l.boat, t);
      if (cd > 0) {
        n.swing.set(l.id, cd);
        continue;
      }
      n.swing.set(l.id, cd + 1);
      const dealt = this.hurt(w, n, Math.max(0, t.melee.damage) * leeStat(l, 'meleeDamage', l.boat, t), 'head', n.neck.head).dealt;
      l.stats.meleeDealt += dealt;
      w.stats.player.meleeDealt += dealt;
    }
  }
}

