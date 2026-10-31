// Nesses (Phase 8): sea monsters. Not boats: a body of parts (a head, coils, a
// tail) each with HP, no deck, no crew. A Ness swims as a shadow nobody can hurt,
// warns with a ring where it is about to rise (rising under a hull wrecks the
// part above it), then stays surfaced for a while where cannons and pistols
// reach it, and dives again. Killing the head kills it.
//
// A kind is data (config/ness.ts and the tuning numbers); the behavior here is
// written against "a Ness with a state" so later kinds add attacks, not code paths.

import { NESS, type NessAttack, type NessDef, type NessKindTuning } from '../config/ness';
import type { Tuning } from '../config/tuning';
import { distanceToHull, keelSegment, type Boat } from './boat';
import { sideFacing, type ContactSide } from './contact';
import type { RailRef } from './lines';
import type { Telegraph } from './telegraph';
import { clamp, closestOnSegment, dist, toWorld, wrapAngle, type Rng, type Vec } from './math';
import { blockTiles, circleTiles, loneTile, pushAway, ZoneSystem, type DangerZone } from './zones';
import type { World } from './world';

export type NessState = 'submerged' | 'emerging' | 'surfaced' | 'dead';
export type NessPartRole = 'head' | 'coil' | 'tail';

export interface NessPart {
  index: number;
  role: NessPartRole;
  hp: number;
  maxHp: number;
  /** A shell within this distance of the part's center hits it, m. */
  radius: number;
  /** Distance behind the head along the body, m. */
  at: number;
  pos: Vec;
}

export interface NessSpec {
  kind: string;
  level?: number;
}

export interface Ness {
  id: number;
  kind: string;
  def: NessDef;
  level: number;
  side: 'enemy';
  state: NessState;
  /** Seconds in this state. */
  stateT: number;
  /** World time it entered this state (drawing fades off it). */
  since: number;
  /** The head: position, heading and velocity. */
  x: number;
  y: number;
  heading: number;
  vx: number;
  vy: number;
  /** The spine: the head, then points it passed through (newest first), about a meter apart. */
  path: Vec[];
  parts: NessPart[];
  /** How long it means to stay in this state (submerged, surfaced), s. */
  hold: number;
  /** Whether the warning ring is up yet (a Quiet Ness holds it back), and the ring itself. */
  ringShown: boolean;
  ring: Telegraph | null;
  /** Where it is rising and from where it came (emerging). */
  emergeAt: Vec | null;
  emergeFrom: Vec | null;
  /** Head HP lost since it last surfaced (hurt enough and it dives early). */
  hurtSince: number;
  /** +1 / -1: which way it circles you. */
  circle: number;
  /** World time it died, or null. */
  diedAt: number | null;
  /** Seconds until its next deck attack. */
  cool: number;
  /** The attack it is making (the zone it put on your deck), or null; how far along its rear-back is (0..1, drawn). */
  act: { kind: NessAttack; zone: DangerZone } | null;
  rear: number;
  /** Which of its attacks is next. */
  attackIdx: number;
  /** After a smash: its head rests on your deck until this world time (stunned), or null. */
  stunUntil: number | null;
  /** A harpoon line holding it to a boat (it can't dive while it holds), or null. */
  tether: Tether | null;
  /** Seconds of warning this rise gives (longer with a Hydrophone). */
  riseTime: number;
}

/** A harpoon line from a gun tile to a Ness. */
export interface Tether {
  boat: Boat;
  /** The tile of the harpoon gun the line is fixed to. */
  tile: number;
  hp: number;
  maxHp: number;
  /** The widest the Ness may be from the line's end now, m: it shrinks as the line reels in. */
  limit: number;
  /** The gun's line, so its harpoon is free again when this is cut. */
  ref: RailRef;
}

const TRAIL = 1;

export const nessKind = (t: Tuning, id: string): NessKindTuning => t.ness.kinds[id] ?? t.ness.kinds.weak;

export const headOf = (n: Ness): NessPart => n.parts[0];

export function createNess(id: number, spec: NessSpec, t: Tuning, pos: Vec, heading: number, rng: Rng, time = 0): Ness {
  const def = NESS[spec.kind] ?? NESS.weak;
  const k = nessKind(t, def.id);
  const level = Math.max(1, Math.round(spec.level ?? 1));
  const hpScale = 1 + Math.max(0, t.ness.common.levelScale) * (level - 1);
  const parts: NessPart[] = [];
  const total = def.coils + 2;
  for (let i = 0; i < total; i++) {
    const role: NessPartRole = i === 0 ? 'head' : i === total - 1 ? 'tail' : 'coil';
    const hp = (role === 'head' ? k.headHp : role === 'tail' ? k.tailHp : k.coilHp) * hpScale;
    const radius = role === 'head' ? k.headRadius : role === 'tail' ? k.tailRadius : k.coilRadius;
    parts.push({ index: i, role, hp, maxHp: hp, radius, at: i * k.segment, pos: { ...pos } });
  }
  const n: Ness = {
    id,
    kind: def.id,
    def,
    level,
    side: 'enemy',
    state: 'submerged',
    stateT: 0,
    since: time,
    x: pos.x,
    y: pos.y,
    heading,
    vx: 0,
    vy: 0,
    path: [],
    parts,
    hold: rng.range(k.submergedMin, k.submergedMax),
    ringShown: false,
    ring: null,
    emergeAt: null,
    emergeFrom: null,
    hurtSince: 0,
    circle: rng.next() < 0.5 ? -1 : 1,
    diedAt: null,
    cool: k.firstAttack,
    act: null,
    rear: 0,
    attackIdx: 0,
    stunUntil: null,
    tether: null,
    riseTime: k.warn,
  };
  // The body starts stretched straight out behind the head.
  const length = bodyLength(n);
  for (let d = 0; d <= length + TRAIL; d += TRAIL) n.path.push({ x: pos.x - Math.cos(heading) * d, y: pos.y - Math.sin(heading) * d });
  layOut(n);
  return n;
}

export function bodyLength(n: Ness): number {
  return n.parts[n.parts.length - 1].at;
}

/** Put each part on the spine at its distance behind the head. */
export function layOut(n: Ness): void {
  n.path[0] = { x: n.x, y: n.y };
  let j = 1;
  let walked = 0;
  let segLen = n.path.length > 1 ? dist(n.path[0], n.path[1]) : 0;
  for (const p of n.parts) {
    while (j < n.path.length && walked + segLen < p.at) {
      walked += segLen;
      j++;
      segLen = j < n.path.length ? dist(n.path[j - 1], n.path[j]) : 0;
    }
    if (j >= n.path.length) {
      p.pos = { ...n.path[n.path.length - 1] };
      continue;
    }
    const a = n.path[j - 1];
    const b = n.path[j];
    const f = segLen > 1e-9 ? clamp((p.at - walked) / segLen, 0, 1) : 0;
    p.pos = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
  }
}

export const isAlive = (n: Ness): boolean => n.state !== 'dead';

/** Can cannons and pistols hurt it? Only while it is up. */
export const isSurfaced = (n: Ness): boolean => n.state === 'surfaced';

/** The part at (or within `radius` of) a point, nearest first, while the Ness is surfaced. */
export function partAt(n: Ness, p: Vec, radius = 0): NessPart | null {
  if (!isSurfaced(n)) return null;
  let best: NessPart | null = null;
  let bestD = Infinity;
  for (const part of n.parts) {
    const d = dist(p, part.pos) - part.radius;
    if (d <= radius && d < bestD) {
      best = part;
      bestD = d;
    }
  }
  return best;
}

/** Where a part will be in `time` seconds if the Ness keeps swimming as it is. */
export function predict(n: Ness, part: NessPart, time: number): Vec {
  return { x: part.pos.x + n.vx * time, y: part.pos.y + n.vy * time };
}

export class NessSystem {
  readonly list: Ness[] = [];

  add(n: Ness): void {
    this.list.push(n);
  }

  alive(): Ness[] {
    return this.list.filter(isAlive);
  }

  /** Surfaced Nesses, whose parts a gun or pistol may target. */
  targets(): Ness[] {
    return this.list.filter(isSurfaced);
  }

  /** Damage a part. The head at zero kills the Ness. Returns what was dealt. */
  hurt(w: World, n: Ness, part: NessPart, amount: number): { dealt: number; killed: boolean } {
    const dealt = Math.min(part.hp, Math.max(0, amount) * Math.max(0, w.tuning.ness.common.damageTaken));
    if (dealt <= 0) return { dealt: 0, killed: false };
    part.hp -= dealt;
    let killed = false;
    if (part.role === 'head') {
      n.hurtSince += dealt;
      if (part.hp <= 1e-9) {
        part.hp = 0;
        killed = true;
        n.state = 'dead';
        n.stateT = 0;
        n.since = w.time;
        n.diedAt = w.time;
        n.vx = 0;
        n.vy = 0;
        n.act = null;
        n.stunUntil = null;
        w.zones.cancel(n.id);
        w.events.push({ type: 'nessDown', nessId: n.id, pos: { ...part.pos } });
      }
    }
    w.events.push({ type: 'nessHit', nessId: n.id, part: part.index, pos: { ...part.pos }, damage: dealt });
    return { dealt, killed };
  }

  step(w: World, dt: number): void {
    for (const n of this.list) {
      n.stateT += dt;
      if (n.state === 'dead') continue;
      const k = nessKind(w.tuning, n.kind);
      switch (n.state) {
        case 'submerged':
          this.lurk(w, n, k, dt);
          break;
        case 'emerging':
          this.rise(w, n, k, dt);
          break;
        case 'surfaced':
          this.surfaced(w, n, k, dt);
          break;
      }
      this.holdOn(w, n, k, dt);
      layOut(n);
    }
  }

  /** A harpoon holds a Ness: the line reels it toward the boat (it can't get further away than the line allows), and it strains against it. */
  private holdOn(w: World, n: Ness, k: NessKindTuning, dt: number): void {
    const t = n.tether;
    if (!t) return;
    const anchor = tetherAnchor(t);
    if (t.boat.sinkingSince !== null || t.ref.tile.blown || n.state === 'dead' || t.hp <= 0) {
      this.release(w, n, 'broke');
      return;
    }
    const reach = Math.max(0, k.tetherClose);
    t.limit = Math.max(reach, t.limit - Math.max(0, k.tetherReel) * dt);
    const d = dist({ x: n.x, y: n.y }, anchor);
    if (d > t.limit) {
      // The line is taut: the head is drawn back along it.
      const f = (d - t.limit) / d;
      n.x += (anchor.x - n.x) * f;
      n.y += (anchor.y - n.y) * f;
      trail(n);
    }
    // It wants to dive (its time is up) or to get away: the line takes the strain.
    if (n.state === 'surfaced' && (n.stateT >= n.hold || n.hurtSince >= headOf(n).maxHp * Math.max(0, k.diveHurt))) t.hp -= Math.max(0, k.tetherStrain) * dt;
  }

  /** The line is gone (cut or broken): the harpoon gun is free to fire again. */
  release(w: World, n: Ness, by: 'cut' | 'broke'): void {
    const t = n.tether;
    if (!t) return;
    n.tether = null;
    t.ref.rail.out = false;
    t.ref.rail.readyAt = w.time + Math.max(0, w.tuning.lines.hookCooldown);
    w.events.push({ type: 'tetherLost', nessId: n.id, by });
  }

  // ------------------------------------------------------------ states

  /** Underwater: swim a circle around you at lurk range; once its time is up and it is near enough, warn and rise. */
  private lurk(w: World, n: Ness, k: NessKindTuning, dt: number): void {
    const me = w.player;
    const head = { x: n.x, y: n.y };
    const hunting = !w.isSinking(me) && !w.result;
    if (hunting) {
      const goal = lurkPoint(me, head, k.lurkRange, n.circle);
      swim(n, goal, k, dt);
      const reach = distanceToHull(me, head);
      if (n.stateT >= n.hold && reach <= k.emergeTrigger) this.beginEmerge(w, n, k);
    } else {
      swim(n, { x: n.x + Math.cos(n.heading) * 20, y: n.y + Math.sin(n.heading) * 20 }, k, dt);
    }
  }

  /** Pick where to rise (where your hull will be when it does, with a little miss) and put up the ring. */
  private beginEmerge(w: World, n: Ness, k: NessKindTuning): void {
    const m = w.player.motion;
    const jitter = w.rng.inDisk(k.ringRadius * 0.35);
    const lead = k.warn + (w.hydrophoneManned() ? Math.max(0, k.hydroExtra) : 0);
    const at = { x: m.x + m.vx * lead + jitter.x, y: m.y + m.vy * lead + jitter.y };
    n.state = 'emerging';
    n.stateT = 0;
    n.since = w.time;
    n.emergeAt = at;
    n.emergeFrom = { x: n.x, y: n.y };
    n.ringShown = false;
    // A manned Hydrophone hears it coming: more warning.
    n.riseTime = k.warn + (w.hydrophoneManned() ? Math.max(0, k.hydroExtra) : 0);
    this.showRing(w, n, k);
  }

  /**
   * Put up the ring. A Quiet Ness (stealth) gives only its last `quietWarn` seconds of warning, unless a
   * Lookout is manned, which sees it coming the whole way.
   */
  private showRing(w: World, n: Ness, k: NessKindTuning): void {
    if (n.ringShown || !n.emergeAt) return;
    const left = Math.max(0.05, n.riseTime - n.stateT);
    if (k.stealth > 0 && left > k.quietWarn && !w.lookoutManned()) return;
    n.ringShown = true;
    n.ring = w.telegraphs.add('emerge', n.emergeAt, left, w.tuning.ness.common.ringLinger, k.ringRadius);
    w.events.push({ type: 'nessWarn', nessId: n.id, pos: { ...n.emergeAt }, radius: k.ringRadius, warn: left });
  }

  /** The shadow glides onto the ring and, when the warning is over, breaks the surface there. */
  private rise(w: World, n: Ness, k: NessKindTuning, dt: number): void {
    const at = n.emergeAt!;
    const from = n.emergeFrom!;
    const f = clamp(n.stateT / Math.max(0.05, n.riseTime), 0, 1);
    const ease = f * f * (3 - 2 * f);
    const nx = from.x + (at.x - from.x) * ease;
    const ny = from.y + (at.y - from.y) * ease;
    const mx = nx - n.x;
    const my = ny - n.y;
    n.vx = mx / Math.max(1e-6, dt);
    n.vy = my / Math.max(1e-6, dt);
    if (Math.hypot(mx, my) > 1e-4) n.heading = Math.atan2(my, mx);
    n.x = nx;
    n.y = ny;
    trail(n);
    this.showRing(w, n, k);
    if (n.stateT < n.riseTime) return;
    n.vx = 0;
    n.vy = 0;
    n.state = 'surfaced';
    n.stateT = 0;
    n.since = w.time;
    n.hold = w.rng.range(k.surfacedMin, k.surfacedMax);
    n.hurtSince = 0;
    n.emergeAt = null;
    n.emergeFrom = null;
    // Face you as it comes up.
    n.heading = Math.atan2(w.player.motion.y - n.y, w.player.motion.x - n.x);
    layOut(n);
    w.nessSurfaced(n, at, k);
  }

  /**
   * Up: a Ness with deck attacks comes alongside your hull and uses them in turn (a warning zone on your deck,
   * then the blow). One without keeps its distance. It dives when its time is up or it is hurt enough, never mid-blow.
   */
  private surfaced(w: World, n: Ness, k: NessKindTuning, dt: number): void {
    const me = w.player;
    const head = { x: n.x, y: n.y };
    const hurtEnough = n.hurtSince >= headOf(n).maxHp * Math.max(0, k.diveHurt);
    // A smash leaves its head resting on your deck, stunned. It can't move or attack until it lifts.
    if (n.stunUntil !== null) {
      n.vx = 0;
      n.vy = 0;
      n.rear = 0;
      if (w.time < n.stunUntil && !w.isSinking(me)) return;
      n.stunUntil = null;
      n.cool = Math.max(n.cool, 0.8);
      w.events.push({ type: 'nessLift', nessId: n.id });
    }
    const attacks = n.def.attacks;
    const gap = distanceToHull(me, head);
    const goal = attacks.length ? alongsidePoint(me, head, k.standoff, n.circle) : standoffPoint(me, head, Math.max(k.standoff, 12), n.circle);
    swim(n, goal, k, dt);
    if (n.act) {
      n.rear = ZoneSystem.progress(n.act.zone);
      if (n.act.zone.impacted) {
        n.cool = k[`${n.act.kind}Cooldown` as const] * w.rng.range(0.85, 1.15);
        n.act = null;
        n.rear = 0;
      }
    } else {
      // Between blows: dive if its time is up or it is hurt enough (never mid-blow), else wait out the cooldown and strike.
      n.rear = 0;
      if (n.stateT >= n.hold || hurtEnough || w.isSinking(me)) {
        this.dive(w, n, k);
        return;
      }
      n.cool -= dt;
      if (attacks.length && n.cool <= 0 && gap <= k.attackRange && !w.result) this.beginAttack(w, n, k, attacks[n.attackIdx++ % attacks.length]);
    }
  }

  /** Rear back: put the warning on your deck where the blow will land. */
  private beginAttack(w: World, n: Ness, k: NessKindTuning, kind: NessAttack): void {
    const me = w.player;
    const head = { x: n.x, y: n.y };
    let area: { tiles: number[]; side: ContactSide };
    let warn: number;
    let lasting = 0;
    switch (kind) {
      case 'bite':
        area = circleTiles(me, head, k.biteRadius);
        warn = k.biteWarn;
        break;
      case 'smash':
        area = blockTiles(me, head, k.smashDepth, k.smashWidth);
        warn = k.smashWarn;
        break;
      case 'slap':
        area = blockTiles(me, head, k.slapDepth, k.slapWidth);
        warn = k.slapWarn;
        break;
      case 'drag': {
        // The loneliest Lee: the one standing furthest from everyone else.
        const tile = loneTile(me, w.allLees());
        if (tile < 0) {
          n.cool = 1;
          return;
        }
        area = { tiles: [tile], side: sideFacing(me, head) };
        warn = k.dragWarn;
        break;
      }
      case 'rain':
        area = blockTiles(me, head, k.rainDepth, k.rainWidth);
        warn = k.rainWarn;
        lasting = k.rainTime;
        break;
      case 'ink':
        area = blockTiles(me, head, k.inkDepth, k.inkWidth);
        warn = k.inkWarn;
        lasting = k.inkTime;
        break;
    }
    const zone = w.zones.add({ boat: me, kind, tiles: area.tiles, warn, source: n.id, push: pushAway(area.side), side: area.side, lasting });
    n.act = { kind, zone };
    w.events.push({ type: 'zoneWarn', boatId: me.id, zoneId: zone.id, kind, nessId: n.id, warn });
  }

  /** A smash lands: the head comes down and rests on the deck there, body trailing out over the rail. */
  rest(w: World, n: Ness, at: Vec, outward: Vec, seconds: number): void {
    n.x = at.x;
    n.y = at.y;
    n.heading = Math.atan2(outward.y, outward.x);
    n.vx = 0;
    n.vy = 0;
    n.path = [{ x: at.x, y: at.y }];
    const length = bodyLength(n);
    for (let d = TRAIL; d <= length + TRAIL; d += TRAIL) n.path.push({ x: at.x + outward.x * d, y: at.y + outward.y * d });
    n.stunUntil = w.time + seconds;
    n.act = null;
    n.rear = 0;
    layOut(n);
  }

  private dive(w: World, n: Ness, k: NessKindTuning): void {
    // A harpoon holds it up until the line gives.
    if (n.tether && n.tether.hp > 0) return;
    n.state = 'submerged';
    n.stateT = 0;
    n.since = w.time;
    n.hold = w.rng.range(k.submergedMin, k.submergedMax);
    n.circle = w.rng.next() < 0.5 ? -1 : 1;
    n.act = null;
    n.rear = 0;
    n.stunUntil = null;
    w.zones.cancel(n.id);
    w.events.push({ type: 'nessDive', nessId: n.id, pos: { x: n.x, y: n.y } });
  }
}

// ------------------------------------------------------------ movement

/** Swim toward a point: turn at most `turnRate`, then move forward (slower on arrival). */
function swim(n: Ness, goal: Vec, k: NessKindTuning, dt: number): void {
  const want = Math.atan2(goal.y - n.y, goal.x - n.x);
  const turn = clamp(wrapAngle(want - n.heading), -k.turnRate * dt, k.turnRate * dt);
  n.heading = wrapAngle(n.heading + turn);
  const d = Math.hypot(goal.x - n.x, goal.y - n.y);
  const speed = k.speed * clamp(d / 12, 0.35, 1);
  n.vx = Math.cos(n.heading) * speed;
  n.vy = Math.sin(n.heading) * speed;
  n.x += n.vx * dt;
  n.y += n.vy * dt;
  trail(n);
}

/** Record the head's track so the body follows it. */
function trail(n: Ness): void {
  n.path[0] = { x: n.x, y: n.y };
  if (n.path.length < 2 || dist(n.path[0], n.path[1]) >= TRAIL) n.path.unshift({ x: n.x, y: n.y });
  const keep = bodyLength(n) + 2 * TRAIL;
  let len = 0;
  for (let i = 1; i < n.path.length; i++) {
    len += dist(n.path[i - 1], n.path[i]);
    if (len > keep) {
      n.path.length = i + 1;
      break;
    }
  }
}

/** A point `range` m from your hull's center, a little further around the circle from where the Ness is. */
function lurkPoint(me: Boat, from: Vec, range: number, circle: number): Vec {
  const c = me.motion;
  const a = Math.atan2(from.y - c.y, from.x - c.x);
  const r = range + Math.max(me.layout.length, me.layout.beam) / 2;
  return { x: c.x + Math.cos(a + circle * 0.5) * r, y: c.y + Math.sin(a + circle * 0.5) * r };
}

/** Alongside: `standoff` m off the hull's edge, on the side the head is already on. */
function alongsidePoint(me: Boat, from: Vec, standoff: number, circle: number): Vec {
  const [a, b] = keelSegment(me);
  const c = closestOnSegment(from, a, b);
  let dx = from.x - c.x;
  let dy = from.y - c.y;
  let d = Math.hypot(dx, dy);
  if (d < 1e-6) {
    const h = me.motion.heading + (circle > 0 ? Math.PI / 2 : -Math.PI / 2);
    dx = Math.cos(h);
    dy = Math.sin(h);
    d = 1;
  }
  const out = me.layout.beam / 2 + standoff;
  return { x: c.x + (dx / d) * out, y: c.y + (dy / d) * out };
}

/** Surfaced: head for the ring `standoff` m off your hull, then slide around it. */
function standoffPoint(me: Boat, from: Vec, standoff: number, circle: number): Vec {
  const c = me.motion;
  const d = distanceToHull(me, from);
  const a = Math.atan2(from.y - c.y, from.x - c.x);
  const r = Math.hypot(from.x - c.x, from.y - c.y);
  if (d > standoff + 3) return { x: c.x, y: c.y };
  const out = r + (standoff - d);
  return { x: c.x + Math.cos(a + circle * 0.25) * out, y: c.y + Math.sin(a + circle * 0.25) * out };
}

/** Where a harpoon line is fixed on its boat, world. */
export function tetherAnchor(t: Tether): { x: number; y: number } {
  const tile = t.boat.grid.tiles[t.tile];
  return toWorld(tile.center, t.boat.motion, t.boat.motion.heading);
}

/** An emerging Ness is driven back down (a depth charge went off under its head): its ring goes, and it lurks a while. */
export function abortRise(w: World, n: Ness, hold: number): void {
  if (n.state !== 'emerging') return;
  n.state = 'submerged';
  n.stateT = 0;
  n.since = w.time;
  n.hold = hold;
  n.emergeAt = null;
  n.emergeFrom = null;
  n.ringShown = false;
  const at = n.ring ? w.telegraphs.list.indexOf(n.ring) : -1;
  if (at >= 0) w.telegraphs.list.splice(at, 1);
  n.ring = null;
  w.events.push({ type: 'nessDive', nessId: n.id, pos: { x: n.x, y: n.y } });
}
