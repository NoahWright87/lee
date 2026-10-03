// The one game world both views read from. Fixed-step, deterministic for a
// given seed and input sequence.

import { SLOOP, type BoatLayout } from '../config/boats';
import { CREWS } from '../config/crews';
import { LEE_DEFS } from '../config/lees';
import type { Side, Tuning } from '../config/tuning';
import {
  advantageOf,
  applyDamage,
  boatTuning,
  cannonOnline,
  cannonRange,
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
import { createLee, damageCrewAt, leeStat, stepCrew, updateMobility, wetFactor, workerAt, type Lee } from './crew';
import { buildGrid, tileAtCell } from './grid';
import { DEG, dist, NORTH, Rng, toLocal, toWorld, wrapAngle, type Vec } from './math';
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
  /** The Lee who fired it (for per-Lee stats). */
  leeId: number | null;
}

export type WorldEvent =
  | { type: 'fire'; boatId: number; cannon: number; from: Vec; to: Vec }
  | { type: 'hit'; boatId: number; part: number; pos: Vec; damage: number }
  | { type: 'splash'; pos: Vec; ownerSide: Side }
  | { type: 'offline'; boatId: number; part: number }
  | { type: 'wrecked'; boatId: number; part: number }
  | { type: 'sinking'; boatId: number }
  | { type: 'leeHurt'; boatId: number; leeId: number; damage: number }
  | { type: 'leeLost'; boatId: number; leeId: number; pos: Vec };

export interface SideStats {
  shellsFired: number;
  shellsHit: number;
  damageDealt: number;
  damageTaken: number;
  shellsDodged: number;
  waterTaken: number;
  leesLost: number;
  hpRepaired: number;
  waterBailed: number;
}

const emptyStats = (): SideStats => ({
  shellsFired: 0,
  shellsHit: 0,
  damageDealt: 0,
  damageTaken: 0,
  shellsDodged: 0,
  waterTaken: 0,
  leesLost: 0,
  hpRepaired: 0,
  waterBailed: 0,
});

export interface Result {
  winner: Side;
  loser: Side;
  /** Fight time when the fight was decided (last enemy or the player crossed its sink line). */
  time: number;
}

export interface EnemyBrain {
  /** +1 / -1 orbit direction around the player, chosen on the first think. */
  orbitDir: number;
  /** This ship's own preferred range (base ± jitter, so a pack spreads out). */
  range: number;
  /** The point it is currently seeking (debug overlay). */
  seek: Vec | null;
}

/** Player damage carried into the next fight (structure fraction and water per part). */
export interface PlayerCarry {
  hp: number[];
  water: number[];
}

export interface WorldOptions {
  /** 1-based fight number in the current run. */
  fight?: number;
  /** Override the number of enemy ships (otherwise derived from the fight number). */
  enemies?: number;
  /** Player damage from the previous fight; repaired by campaign.repairBetweenFights. */
  carry?: PlayerCarry;
  layout?: BoatLayout;
  /**
   * Your crew: each Lee's home tile index, or null for a Lee left in the tray
   * (stays ashore). Omitted = the Auto-arrange layout.
   */
  crew?: CrewPlacement;
}

/** Home tile per Lee slot (null = in the tray). */
export type CrewPlacement = (number | null)[];

/** The Auto-arrange placement for a crew of `size` on a layout. */
export function autoArrange(layout: BoatLayout, side: Side, size: number): CrewPlacement {
  const grid = buildGrid(layout);
  const out: CrewPlacement = [];
  const used = new Set<number>();
  for (const [col, row] of CREWS[side].homes) {
    if (out.length >= size) break;
    const t = tileAtCell(grid, col, row);
    if (!t || used.has(t.index)) continue;
    used.add(t.index);
    out.push(t.index);
  }
  while (out.length < size) out.push(null);
  return out;
}

/** How many enemy ships fight N has. */
export function enemiesForFight(t: Tuning, fight: number): number {
  const c = t.campaign;
  const n = Math.round(c.firstFightEnemies) + Math.floor(Math.max(0, fight - 1) * c.enemiesAddedPerFight);
  return Math.max(1, Math.min(Math.max(1, Math.round(c.maxEnemies)), n));
}

export class World {
  readonly tuning: Tuning;
  readonly rng: Rng;
  readonly seed: number;
  readonly fight: number;
  readonly boats: Boat[];
  readonly player: Boat;
  readonly enemies: Boat[];
  readonly shells: Shell[] = [];
  readonly telegraphs = new TelegraphSystem();
  readonly stats: Record<Side, SideStats> = { player: emptyStats(), enemy: emptyStats() };
  /** Per-enemy AI state, by boat id. */
  readonly brains = new Map<number, EnemyBrain>();
  /** Events since the renderer last drained them. */
  events: WorldEvent[] = [];
  phase: Phase = 'ready';
  /** Seconds since START. */
  time = 0;
  result: Result | null = null;
  /** Fight time at which the result screen should appear. */
  resultAt: number | null = null;
  private nextShellId = 1;
  private nextLeeId = 1;

  constructor(tuning: Tuning, seed = (Math.random() * 2 ** 31) | 0, opts: WorldOptions = {}) {
    this.tuning = tuning;
    this.seed = seed;
    this.rng = new Rng(seed);
    this.fight = Math.max(1, opts.fight ?? 1);
    const layout = opts.layout ?? SLOOP;
    this.player = createBoat(1, 'player', layout, tuning, { x: 0, y: 0 }, NORTH);
    if (opts.carry) this.applyCarry(opts.carry);
    this.placePlayerCrew(opts.crew ?? autoArrange(layout, 'player', Math.round(tuning.player.crew.size)));

    // Enemies fan out around the first spawn point, alternating sides of it.
    const g = tuning.global;
    const count = opts.enemies ?? enemiesForFight(tuning, this.fight);
    const range = Math.hypot(g.enemyStartNorth, g.enemyStartEast);
    const bearing = Math.atan2(-g.enemyStartNorth, g.enemyStartEast);
    const spread = tuning.campaign.spawnSpread * DEG;
    this.enemies = [];
    for (let i = 0; i < count; i++) {
      const k = i === 0 ? 0 : Math.ceil(i / 2) * (i % 2 ? 1 : -1);
      const a = bearing + k * spread;
      const e = createBoat(2 + i, 'enemy', layout, tuning, { x: Math.cos(a) * range, y: Math.sin(a) * range }, NORTH);
      // Bigger packs field lighter hulls, so total enemy HP grows slower than ship count.
      const hpScale = Math.pow(count, -Math.max(0, tuning.campaign.packHullScaling));
      for (const part of e.parts) {
        for (const layer of part.layers) {
          layer.maxHp = Math.max(1, layer.maxHp * hpScale);
          layer.hp = layer.maxHp;
        }
      }
      this.enemies.push(e);
      this.boardCrew(e, autoArrange(layout, 'enemy', Math.round(tuning.enemy.crew.size)), CREWS.enemy.lee);
      const jitter = tuning.enemyAI.rangeJitter;
      this.brains.set(e.id, { orbitDir: 0, range: tuning.enemyAI.preferredRange + this.rng.range(-jitter, jitter), seek: null });
    }
    this.boats = [this.player, ...this.enemies];
  }

  /** Put a crew aboard: one Lee per placed slot, standing on its home tile. */
  private boardCrew(boat: Boat, placement: CrewPlacement, leeType: string): void {
    const def = LEE_DEFS[leeType] ?? Object.values(LEE_DEFS)[0];
    boat.crew.lees = [];
    boat.crew.thinkIn = 0;
    const used = new Set<number>();
    placement.forEach((home, slot) => {
      if (home === null || home < 0 || home >= boat.grid.tiles.length || used.has(home)) return;
      used.add(home);
      boat.crew.lees.push(createLee(this.nextLeeId++, slot + 1, def, boat.side, boat, home, this.tuning));
    });
    updateMobility(boat, this.tuning);
  }

  /** Replace your crew (setup mode only). */
  placePlayerCrew(placement: CrewPlacement): void {
    if (this.phase !== 'ready') return;
    this.boardCrew(this.player, placement, CREWS.player.lee);
  }

  /** Every Lee in the world. */
  allLees(): Lee[] {
    return this.boats.flatMap((b) => b.crew.lees);
  }

  findLee(id: number): { lee: Lee; boat: Boat } | null {
    for (const boat of this.boats) {
      const lee = boat.crew.lees.find((l) => l.id === id);
      if (lee) return { lee, boat };
    }
    return null;
  }

  /** Restore the player's damage from the last fight, minus the between-fight repair. */
  private applyCarry(carry: PlayerCarry): void {
    const repair = Math.min(1, Math.max(0, this.tuning.campaign.repairBetweenFights));
    this.player.parts.forEach((part, i) => {
      const s = part.layers[part.layers.length - 1];
      const frac = carry.hp[i] ?? 1;
      s.hp = s.maxHp * (frac + (1 - frac) * repair);
      part.water = Math.min(part.capacity, (carry.water[i] ?? 0) * (1 - repair));
    });
  }

  /** Snapshot of the player's damage, to carry into the next fight. */
  playerCarry(): PlayerCarry {
    return {
      hp: this.player.parts.map((p) => structureFraction(p)),
      water: this.player.parts.map((p) => p.water),
    };
  }

  /** Enemy ships still afloat (not sinking). */
  liveEnemies(): Boat[] {
    return this.enemies.filter((e) => !this.isSinking(e));
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
    // Once the fight is decided, guns go quiet, nobody else floods, and the crews stand down.
    const decided = this.result !== null;

    if (!decided) {
      for (const b of this.boats) {
        const foes = this.boats.filter((o) => o.side !== b.side && !this.isSinking(o));
        const r = stepCrew(b, { tuning: this.tuning, time: this.time, foes }, dt);
        this.stats[b.side].hpRepaired += r.repaired;
        this.stats[b.side].waterBailed += r.bailed;
      }
    }
    for (const e of this.enemies) this.thinkEnemy(e);
    for (const b of this.boats) {
      const target = this.isSinking(b) ? null : b.target;
      const params = motionParams(b, this.tuning);
      // Enemy brains already place their seek point to hold range, so they seek it directly.
      if (b.side === 'enemy') params.orbitCapture = 0;
      stepMotion(b.motion, target, params, dt);
    }
    if (!decided) for (const b of this.boats) this.stepCannons(b, dt);
    this.stepShells(dt);
    this.telegraphs.step(dt);
    for (const b of this.boats) {
      if (this.isSinking(b) || decided) continue;
      this.stats[b.side].waterTaken += stepFlooding(b, this.tuning, dt);
    }
    this.checkSinking();
  }

  // ------------------------------------------------------------ enemy brain

  /**
   * Seek a spot that keeps the player on our beam at our preferred range: aim
   * 90° off the bearing to the player, bent inward when too far and outward
   * when too close, and nudged away from other ships in the pack. Same
   * steering as the player; only the target differs.
   */
  private thinkEnemy(e: Boat): void {
    const brain = this.brains.get(e.id)!;
    const p = this.player;
    if (this.isSinking(e)) {
      e.target = null;
      brain.seek = null;
      return;
    }
    const ai = this.tuning.enemyAI;
    const bearing = Math.atan2(p.motion.y - e.motion.y, p.motion.x - e.motion.x);
    const d = dist(e.motion, p.motion);
    if (ai.orbitDirection !== 0) brain.orbitDir = Math.sign(ai.orbitDirection);
    else if (brain.orbitDir === 0) {
      // Pick the side that needs the smaller turn from where we're heading now.
      const cw = Math.abs(wrapAngle(bearing - Math.PI / 2 - e.motion.heading));
      const ccw = Math.abs(wrapAngle(bearing + Math.PI / 2 - e.motion.heading));
      brain.orbitDir = cw <= ccw ? 1 : -1;
    }
    // Offset from the bearing: 90° = pure broadside circle; less = close in; more = open out.
    const offset = Math.min(120, Math.max(30, 90 - (d - brain.range) * ai.rangeCorrection)) * DEG;
    const h = bearing - brain.orbitDir * offset;
    const look = Math.max(20, ai.lookAhead);
    const seek = { x: e.motion.x + Math.cos(h) * look, y: e.motion.y + Math.sin(h) * look };
    // Keep spacing from the rest of the pack.
    for (const o of this.enemies) {
      if (o === e || this.isSinking(o)) continue;
      const od = dist(e.motion, o.motion);
      if (od >= ai.spacing || od < 1e-3) continue;
      const push = ((ai.spacing - od) / ai.spacing) * look;
      seek.x += ((e.motion.x - o.motion.x) / od) * push;
      seek.y += ((e.motion.y - o.motion.y) / od) * push;
    }
    brain.seek = seek;
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

  /** The gunner working a cannon right now, or null (an unmanned gun neither loads nor fires). */
  gunnerOf(b: Boat, c: CannonState): Lee | null {
    return workerAt(b, c.station);
  }

  /** Is `aim` inside this cannon's arc and range? */
  canHit(b: Boat, c: CannonState, from: Vec, aim: Vec): boolean {
    const ct = boatTuning(b.side, this.tuning).cannons;
    if (dist(from, aim) > cannonRange(b, this.tuning)) return false;
    const a = Math.atan2(aim.y - from.y, aim.x - from.x);
    return Math.abs(wrapAngle(a - this.cannonFacing(b, c))) <= ct.arc * DEG;
  }

  /** Enemy shells currently in the air. */
  incomingShells(): number {
    let n = 0;
    for (const s of this.shells) if (s.ownerSide !== 'player') n++;
    return n;
  }

  private stepCannons(b: Boat, dt: number): void {
    const ct = boatTuning(b.side, this.tuning).cannons;
    let reload = Math.max(0.1, ct.reloadTime / advantageOf(b.side, this.tuning));
    // Bigger packs reload slower per ship, so total incoming fire grows slower than ship count.
    if (b.side !== 'player') reload *= Math.pow(this.enemies.length, Math.max(0, this.tuning.campaign.packReloadScaling));
    const cap = Math.round(this.tuning.campaign.maxIncomingShells);
    b.cannons.forEach((c, i) => {
      if (!cannonOnline(b, c, this.tuning)) return;
      const gunner = this.gunnerOf(b, c);
      if (!gunner) return;
      const speed = leeStat(gunner, 'loadSpeed', b, this.tuning) * wetFactor(gunner, b, this.tuning);
      c.load = Math.min(1, c.load + (dt * speed) / reload);
      if (c.load < 1) return;
      // Threat budget: a loaded enemy gun holds fire while enough red X's are already up.
      if (b.side !== 'player' && cap > 0 && this.incomingShells() >= cap) return;
      const from = this.muzzle(b, c);
      const tgt = this.pickTarget(b, from);
      if (!tgt) return;
      const { aim, time } = this.leadAim(b, from, tgt.boat, tgt.part);
      if (!this.canHit(b, c, from, aim)) return;
      const accuracy = Math.max(0.05, leeStat(gunner, 'accuracy', b, this.tuning));
      const off = this.rng.inDisk(Math.max(0, ct.spread) / accuracy);
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
        leeId: gunner.id,
      });
      this.stats[b.side].shellsFired++;
      gunner.stats.shellsFired++;
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
    const friendlyFire = this.tuning.campaign.friendlyFire > 0;
    for (const b of this.boats) {
      if (b.id === s.ownerId || this.isSinking(b)) continue; // shells pass through sinking boats
      if (!friendlyFire && b.side === s.ownerSide) continue;
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
    const shooter = s.leeId !== null ? this.findLee(s.leeId) : null;
    if (shooter) {
      shooter.lee.stats.shellsHit++;
      shooter.lee.stats.damageDealt += dmg.dealt;
    }
    for (const h of damageCrewAt(hitBoat, toLocal(s.to, hitBoat.motion, hitBoat.motion.heading), this.tuning, this.time)) {
      this.events.push({ type: 'leeHurt', boatId: hitBoat.id, leeId: h.lee.id, damage: h.damage });
      if (h.lost) {
        this.stats[hitBoat.side].leesLost++;
        this.events.push({ type: 'leeLost', boatId: hitBoat.id, leeId: h.lee.id, pos: toWorld(h.lee.pos, hitBoat.motion, hitBoat.motion.heading) });
      }
    }
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
      if (this.result) continue;
      // You lose when you sink; you win when the last enemy does. First decisive sinking wins.
      const decided = b.side === 'player' ? 'enemy' : this.liveEnemies().length === 0 ? 'player' : null;
      if (decided) {
        this.result = { winner: decided, loser: decided === 'player' ? 'enemy' : 'player', time: this.time };
        const g = this.tuning.global;
        this.resultAt = this.time + g.sinkDuration + g.resultDelay;
        if (decided === 'player') {
          // You won: shells still in the air at you fall harmlessly short.
          for (let i = this.shells.length - 1; i >= 0; i--) if (this.shells[i].ownerSide !== 'player') this.shells.splice(i, 1);
          this.telegraphs.list.length = 0;
        }
      }
    }
    if (this.result && this.resultAt !== null && this.time >= this.resultAt) this.phase = 'over';
  }
}
