// The one game world both views read from. Fixed-step, deterministic for a
// given seed and input sequence.

import { SLOOP, type BoatLayout } from '../config/boats';
import type { Side, Tuning } from '../config/tuning';
import {
  advantageOf,
  applyDamage,
  boatTuning,
  cannonOnline,
  createBoat,
  distanceToHull,
  isWrecked,
  motionParams,
  partAt,
  sinkProgress,
  stepFlooding,
  structureFraction,
  type Boat,
  type CannonState,
  type PartState,
} from './boat';
import { DEG, dist, NORTH, Rng, toWorld, wrapAngle, type Vec } from './math';
import { stepMotion } from './steering';
import { TelegraphSystem } from './telegraph';

export type Phase = 'ready' | 'running' | 'over';

export interface Shell {
  id: number;
  ownerId: number;
  ownerSide: Side;
  from: Vec;
  to: Vec;
  elapsed: number;
  flightTime: number;
  damage: number;
  impactRadius: number;
}

export type WorldEvent =
  | { type: 'fire'; boatId: number; cannon: number; from: Vec; to: Vec }
  | { type: 'hit'; boatId: number; part: number; pos: Vec; damage: number }
  | { type: 'splash'; pos: Vec; ownerSide: Side }
  | { type: 'offline'; boatId: number; part: number }
  | { type: 'wrecked'; boatId: number; part: number }
  | { type: 'sinking'; boatId: number };

export interface SideStats {
  shellsFired: number;
  shellsHit: number;
  damageDealt: number;
  damageTaken: number;
  shellsDodged: number;
  waterTaken: number;
}

const emptyStats = (): SideStats => ({
  shellsFired: 0,
  shellsHit: 0,
  damageDealt: 0,
  damageTaken: 0,
  shellsDodged: 0,
  waterTaken: 0,
});

export interface Result {
  winner: Side;
  loser: Side;
  /** Fight time when the loser crossed its sink line. */
  time: number;
}

export interface EnemyBrain {
  /** +1 / -1 orbit direction around the player, chosen on the first think. */
  orbitDir: number;
  /** The point it is currently seeking (debug overlay). */
  seek: Vec | null;
}

export class World {
  readonly tuning: Tuning;
  readonly rng: Rng;
  readonly seed: number;
  readonly boats: Boat[];
  readonly player: Boat;
  readonly enemy: Boat;
  readonly shells: Shell[] = [];
  readonly telegraphs = new TelegraphSystem();
  readonly stats: Record<Side, SideStats> = { player: emptyStats(), enemy: emptyStats() };
  readonly brain: EnemyBrain = { orbitDir: 0, seek: null };
  /** Events since the renderer last drained them. */
  events: WorldEvent[] = [];
  phase: Phase = 'ready';
  /** Seconds since START. */
  time = 0;
  result: Result | null = null;
  /** Fight time at which the result screen should appear. */
  resultAt: number | null = null;
  private nextShellId = 1;

  constructor(tuning: Tuning, seed = (Math.random() * 2 ** 31) | 0, layout: BoatLayout = SLOOP) {
    this.tuning = tuning;
    this.seed = seed;
    this.rng = new Rng(seed);
    const g = tuning.global;
    this.player = createBoat(1, 'player', layout, tuning, { x: 0, y: 0 }, NORTH);
    this.enemy = createBoat(2, 'enemy', layout, tuning, { x: g.enemyStartEast, y: -g.enemyStartNorth }, NORTH);
    this.boats = [this.player, this.enemy];
  }

  start(): void {
    if (this.phase === 'ready') this.phase = 'running';
  }

  drainEvents(): WorldEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  isSinking(b: Boat): boolean {
    return b.sinkingSince !== null;
  }

  /** 0..1 progress of the sinking animation. */
  sinkAnim(b: Boat): number {
    if (b.sinkingSince === null) return 0;
    const d = Math.max(0.01, this.tuning.global.sinkDuration);
    return Math.min(1, (this.time - b.sinkingSince) / d);
  }

  step(dt: number): void {
    if (this.phase === 'ready') return;
    this.time += dt;

    this.thinkEnemy();
    for (const b of this.boats) {
      const target = this.isSinking(b) ? null : b.target;
      const params = motionParams(b, this.tuning);
      // The enemy brain already places its seek point to hold range, so it seeks it directly.
      if (b === this.enemy) params.orbitCapture = 0;
      stepMotion(b.motion, target, params, dt);
    }
    for (const b of this.boats) this.stepCannons(b, dt);
    this.stepShells(dt);
    this.telegraphs.step(dt);
    for (const b of this.boats) {
      if (this.isSinking(b)) continue;
      this.stats[b.side].waterTaken += stepFlooding(b, this.tuning, dt);
    }
    this.checkSinking();
  }

  // ------------------------------------------------------------ enemy brain

  /**
   * Seek a spot that keeps the player on our beam at the preferred range: aim
   * 90° off the bearing to the player, bent inward when too far and outward
   * when too close. Same steering as the player; only the target differs.
   */
  private thinkEnemy(): void {
    const e = this.enemy;
    const p = this.player;
    if (this.isSinking(e)) {
      e.target = null;
      return;
    }
    const ai = this.tuning.enemyAI;
    const bearing = Math.atan2(p.motion.y - e.motion.y, p.motion.x - e.motion.x);
    const d = dist(e.motion, p.motion);
    if (ai.orbitDirection !== 0) this.brain.orbitDir = Math.sign(ai.orbitDirection);
    else if (this.brain.orbitDir === 0) {
      // Pick the side that needs the smaller turn from where we're heading now.
      const cw = Math.abs(wrapAngle(bearing - Math.PI / 2 - e.motion.heading));
      const ccw = Math.abs(wrapAngle(bearing + Math.PI / 2 - e.motion.heading));
      this.brain.orbitDir = cw <= ccw ? 1 : -1;
    }
    // Offset from the bearing: 90° = pure broadside circle; less = close in; more = open out.
    const offset = Math.min(120, Math.max(30, 90 - (d - ai.preferredRange) * ai.rangeCorrection)) * DEG;
    const h = bearing - this.brain.orbitDir * offset;
    const look = Math.max(20, ai.lookAhead);
    const seek = { x: e.motion.x + Math.cos(h) * look, y: e.motion.y + Math.sin(h) * look };
    this.brain.seek = seek;
    e.target = seek;
  }

  // ------------------------------------------------------------ cannons

  muzzle(b: Boat, c: CannonState): Vec {
    return toWorld({ x: c.local.x, y: c.local.y + c.broadside * 0.8 }, b.motion, b.motion.heading);
  }

  /** World angle a cannon points. */
  cannonFacing(b: Boat, c: CannonState): number {
    return b.motion.heading + (c.broadside * Math.PI) / 2;
  }

  flightTime(shooter: Boat, distance: number): number {
    const c = boatTuning(shooter.side, this.tuning).cannons;
    let t = Math.max(0.05, c.flightTimeBase + c.flightTimePerMeter * distance);
    if (shooter.side === 'enemy') t = Math.max(t, this.tuning.telegraph.minWarningTime);
    return t;
  }

  /** Where `shooter` would aim from `from` at `part` of `target`, leading its current velocity. */
  leadAim(shooter: Boat, from: Vec, target: Boat, part: PartState): { aim: Vec; time: number } {
    const p = toWorld(part.center, target.motion, target.motion.heading);
    let aim = p;
    let time = this.flightTime(shooter, dist(from, p));
    for (let i = 0; i < 3; i++) {
      aim = { x: p.x + target.motion.vx * time, y: p.y + target.motion.vy * time };
      time = this.flightTime(shooter, dist(from, aim));
    }
    return { aim, time };
  }

  /** Nearest part of the nearest enemy boat, from a world point. */
  pickTarget(shooter: Boat, from: Vec): { boat: Boat; part: PartState } | null {
    let best: { boat: Boat; part: PartState } | null = null;
    let bestBoatD = Infinity;
    for (const b of this.boats) {
      if (b.side === shooter.side || this.isSinking(b)) continue;
      const d = dist(from, b.motion);
      if (d >= bestBoatD) continue;
      bestBoatD = d;
      let bestPartD = Infinity;
      for (const part of b.parts) {
        const pd = dist(from, toWorld(part.center, b.motion, b.motion.heading));
        if (pd < bestPartD) {
          bestPartD = pd;
          best = { boat: b, part };
        }
      }
    }
    return best;
  }

  /** Is `aim` inside this cannon's arc and range? */
  canHit(b: Boat, c: CannonState, from: Vec, aim: Vec): boolean {
    const ct = boatTuning(b.side, this.tuning).cannons;
    if (dist(from, aim) > ct.range) return false;
    const a = Math.atan2(aim.y - from.y, aim.x - from.x);
    return Math.abs(wrapAngle(a - this.cannonFacing(b, c))) <= ct.arc * DEG;
  }

  private stepCannons(b: Boat, dt: number): void {
    const ct = boatTuning(b.side, this.tuning).cannons;
    const reload = Math.max(0.1, ct.reloadTime / advantageOf(b.side, this.tuning));
    b.cannons.forEach((c, i) => {
      if (!cannonOnline(b, c, this.tuning)) return;
      c.load = Math.min(1, c.load + dt / reload);
      if (c.load < 1) return;
      const from = this.muzzle(b, c);
      const tgt = this.pickTarget(b, from);
      if (!tgt) return;
      const { aim, time } = this.leadAim(b, from, tgt.boat, tgt.part);
      if (!this.canHit(b, c, from, aim)) return;
      const off = this.rng.inDisk(Math.max(0, ct.spread));
      const to = { x: aim.x + off.x, y: aim.y + off.y };
      c.load = 0;
      c.lastFired = this.time;
      this.shells.push({
        id: this.nextShellId++,
        ownerId: b.id,
        ownerSide: b.side,
        from,
        to,
        elapsed: 0,
        flightTime: time,
        damage: ct.damage,
        impactRadius: ct.impactRadius,
      });
      this.stats[b.side].shellsFired++;
      // Only threats to the player get the red X.
      if (b.side !== 'player') {
        this.telegraphs.add('shell', to, time, this.tuning.telegraph.lingerTime);
      }
      this.events.push({ type: 'fire', boatId: b.id, cannon: i, from, to });
    });
  }

  // ------------------------------------------------------------ shells

  private stepShells(dt: number): void {
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i];
      s.elapsed += dt;
      if (s.elapsed < s.flightTime) continue;
      this.shells.splice(i, 1);
      this.resolveShell(s);
    }
  }

  /** A shell lands: it hits whatever part is at that spot right now, or splashes. */
  private resolveShell(s: Shell): void {
    let hitBoat: Boat | null = null;
    let hitPart: PartState | null = null;
    for (const b of this.boats) {
      if (b.id === s.ownerId || this.isSinking(b)) continue; // shells pass through sinking boats
      const part = partAt(b, s.to, s.impactRadius);
      if (part) {
        hitBoat = b;
        hitPart = part;
        break;
      }
    }

    if (!hitBoat || !hitPart) {
      this.events.push({ type: 'splash', pos: s.to, ownerSide: s.ownerSide });
      if (s.ownerSide !== 'player' && !this.isSinking(this.player)) {
        const near = this.tuning.global.dodgeRadiusHulls * this.player.layout.length;
        if (distanceToHull(this.player, s.to) <= near) this.stats.player.shellsDodged++;
      }
      return;
    }

    const wasOnline = structureFraction(hitPart) > boatTuning(hitBoat.side, this.tuning).function.cannonOfflineAt;
    const wasWrecked = isWrecked(hitPart);
    const dmg = applyDamage(hitPart, s.damage);
    this.stats[s.ownerSide].shellsHit++;
    this.stats[s.ownerSide].damageDealt += dmg.dealt;
    this.stats[hitBoat.side].damageTaken += dmg.dealt;
    this.events.push({ type: 'hit', boatId: hitBoat.id, part: hitPart.index, pos: s.to, damage: dmg.dealt });
    if (hitPart.def.role === 'cannon' && wasOnline && structureFraction(hitPart) <= boatTuning(hitBoat.side, this.tuning).function.cannonOfflineAt) {
      this.events.push({ type: 'offline', boatId: hitBoat.id, part: hitPart.index });
    }
    if (!wasWrecked && isWrecked(hitPart)) this.events.push({ type: 'wrecked', boatId: hitBoat.id, part: hitPart.index });
  }

  // ------------------------------------------------------------ end of fight

  private checkSinking(): void {
    const crossing = this.boats
      .filter((b) => !this.isSinking(b) && sinkProgress(b, this.tuning) >= 1)
      // Same-step tie: whoever is further past the line went first.
      .sort((a, b) => sinkProgress(b, this.tuning) - sinkProgress(a, this.tuning));
    for (const b of crossing) {
      b.sinkingSince = this.time;
      b.target = null;
      this.events.push({ type: 'sinking', boatId: b.id });
      if (!this.result) {
        this.result = { loser: b.side, winner: b.side === 'player' ? 'enemy' : 'player', time: this.time };
        const g = this.tuning.global;
        this.resultAt = this.time + g.sinkDuration + g.resultDelay;
      }
    }
    if (this.result && this.resultAt !== null && this.time >= this.resultAt) this.phase = 'over';
  }
}
