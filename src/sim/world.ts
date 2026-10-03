// The one game world both views read from. Fixed-step, deterministic for a
// given seed and input sequence.

import { SLOOP, type BoatLayout } from '../config/boats';
import { CREWS, type CrewDef } from '../config/crews';
import { LEE_DEFS } from '../config/lees';
import { INTRO_FIGHTS, SHIP_TYPES } from '../config/ships';
import type { Side, Tuning } from '../config/tuning';
import { AttachSystem, sideFacing, type AttachEvent } from './attach';
import {
  advantageOf,
  applyDamage,
  boatTuning,
  cannonOnline,
  cannonRange,
  createBoat,
  distanceToHull,
  floodPart,
  isDerelict,
  isWrecked,
  motionParams,
  shipTuning,
  partAt,
  sinkProgress,
  stepFlooding,
  structureFraction,
  type Boat,
  type AimPlan,
  type CannonState,
  type PartState,
} from './boat';
import { updateEngagement, stepMelee, stepPistols, type CombatEvent } from './combat';
import { createLee, damageCrewAt, leeStat, loseLee, stepCrew, updateMobility, wetFactor, workerAt, type CrewContext, type Lee, type LossCause } from './crew';
import { buildGrid, tileAtCell } from './grid';
import { DEG, dist, NORTH, Rng, toLocal, toWorld, wrapAngle, type Vec } from './math';
import { alongsideCommand, stepMotion, type AlongsideSpec } from './steering';
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
  | { type: 'leeLost'; boatId: number; leeId: number; pos: Vec; cause: LossCause }
  | { type: 'melee'; attacker: number; target: number; pos: Vec; killed: boolean }
  | { type: 'pistol'; shooter: number; from: Vec; to: Vec; hit: boolean; side: Side }
  | { type: 'rammed'; rammer: number; target: number; pos: Vec; damage: number; selfDamage: number; part: number; selfPart: number | null }
  | { type: 'docked'; a: number; b: number }
  | { type: 'bump'; pos: Vec; speed: number }
  | { type: 'linkBroken'; a: number; b: number; reason: string }
  | { type: 'swing'; leeId: number; back: boolean };

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
  /** Lees lost by cause. */
  lostBy: Record<LossCause, number>;
  /** Swings across to an enemy deck, and Lee-seconds spent on enemy decks. */
  boardings: number;
  enemyDeckTime: number;
  meleeKills: number;
  meleeDealt: number;
  meleeTaken: number;
  pistolShots: number;
  pistolHits: number;
  pistolDealt: number;
  ramsDone: number;
  ramsTaken: number;
  /** Ram damage dealt to the struck boat (by this side's rams) and taken (by this side's boats, both ways). */
  ramDealt: number;
  ramTaken: number;
  /** Seconds this side had at least one link. */
  dockTime: number;
  disengages: number;
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
  lostBy: { cannon: 0, melee: 0, pistol: 0, sank: 0 },
  boardings: 0,
  enemyDeckTime: 0,
  meleeKills: 0,
  meleeDealt: 0,
  meleeTaken: 0,
  pistolShots: 0,
  pistolHits: 0,
  pistolDealt: 0,
  ramsDone: 0,
  ramsTaken: 0,
  ramDealt: 0,
  ramTaken: 0,
  dockTime: 0,
  disengages: 0,
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
  /** What it's doing: holding range, coming alongside to dock, ramming, attached, adrift. */
  mode: 'orbit' | 'alongside' | 'ram' | 'attached' | 'derelict';
  /** Which of your sides it's coming alongside (+1 starboard, -1 port). */
  side: number;
}

/** Steering alongside an enemy (the player held a finger on its hull). */
export interface Alongside {
  boatId: number;
  side: number;
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
  /** Enemy ship types to spawn (overrides the fight's encounter; the tuning panel's encounter picker). */
  encounter?: string[];
}

/** Home tile per Lee slot (null = in the tray). */
export type CrewPlacement = (number | null)[];

/** The Auto-arrange placement for a crew of `size` on a layout (yours, or a ship type's crew data). */
export function autoArrange(layout: BoatLayout, side: Side | CrewDef, size: number): CrewPlacement {
  const grid = buildGrid(layout);
  const out: CrewPlacement = [];
  const used = new Set<number>();
  const crew = typeof side === 'string' ? (side === 'player' ? CREWS.player : SHIP_TYPES.standard.crew) : side;
  for (const [col, row] of crew.homes) {
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

/**
 * Enemy ship types for fight N. With campaign.introFights on, fights 1-3 are a
 * lone Sloop, a lone Friend Ship and a lone Hard Ship (extra ships, if a count
 * is forced, are Sloops); later fights draw each ship from campaign.mix,
 * seeded so a fight is reproducible.
 */
export function encounterFor(t: Tuning, fight: number, seed: number, count?: number): string[] {
  const intro = t.campaign.introFights > 0;
  if (intro && fight <= INTRO_FIGHTS.length) {
    const n = Math.max(1, count ?? 1);
    return [INTRO_FIGHTS[fight - 1], ...Array(n - 1).fill('standard')];
  }
  const n = count ?? enemiesForFight(t, intro ? fight - INTRO_FIGHTS.length + 1 : fight);
  const types = Object.keys(SHIP_TYPES).filter((k) => (t.campaign.mix[k] ?? 0) > 0 && t.ships[k]);
  if (!types.length) return Array(n).fill('standard');
  const total = types.reduce((a, k) => a + t.campaign.mix[k], 0);
  const rng = new Rng((seed ^ 0x5bd1e995) + fight * 7919);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    let r = rng.next() * total;
    let pick = types[types.length - 1];
    for (const k of types) {
      r -= t.campaign.mix[k];
      if (r < 0) {
        pick = k;
        break;
      }
    }
    out.push(pick);
  }
  return out;
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
  /** Docks and rams: links between boats, contact warnings, collisions. */
  readonly links = new AttachSystem();
  /** You're steering alongside this enemy (finger held on its hull), or null. */
  alongside: Alongside | null = null;
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
    const types = opts.encounter?.length ? opts.encounter : encounterFor(tuning, this.fight, seed, opts.enemies);
    const count = types.length;
    const range = Math.hypot(g.enemyStartNorth, g.enemyStartEast);
    const bearing = Math.atan2(-g.enemyStartNorth, g.enemyStartEast);
    const spread = tuning.campaign.spawnSpread * DEG;
    this.enemies = [];
    for (let i = 0; i < count; i++) {
      const k = i === 0 ? 0 : Math.ceil(i / 2) * (i % 2 ? 1 : -1);
      const a = bearing + k * spread;
      const type = SHIP_TYPES[types[i]] ? types[i] : 'standard';
      const def = SHIP_TYPES[type];
      const e = createBoat(2 + i, 'enemy', def.layout, tuning, { x: Math.cos(a) * range, y: Math.sin(a) * range }, NORTH, type);
      // Bigger packs field lighter hulls, so total enemy HP grows slower than ship count.
      const hpScale = Math.pow(count, -Math.max(0, tuning.campaign.packHullScaling));
      for (const part of e.parts) {
        for (const layer of part.layers) {
          layer.maxHp = Math.max(1, layer.maxHp * hpScale);
          layer.hp = layer.maxHp;
        }
      }
      this.enemies.push(e);
      const st = shipTuning(e, tuning);
      this.boardCrew(e, autoArrange(def.layout, def.crew, Math.round(st.crew.size)), def.crew.lee);
      const jitter = tuning.enemyAI.rangeJitter;
      this.brains.set(e.id, { orbitDir: 0, range: st.ai.preferredRange + this.rng.range(-jitter, jitter), seek: null, mode: 'orbit', side: 0 });
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

  // ------------------------------------------------------------ links

  /** Boats linked to this one. */
  attachedTo(b: Boat): Boat[] {
    return this.links.attachedTo(b);
  }

  isAttached(b: Boat): boolean {
    return this.links.linksOf(b).length > 0;
  }

  /**
   * Disengage from an attached boat: your boarders there (and theirs on you)
   * swing home during the recall window, then the link breaks and the boats
   * are pushed apart. Returns false if there's no such link.
   */
  disengage(other: Boat, from: Boat = this.player): boolean {
    const l = this.links.linkBetween(from, other);
    if (!l || l.breakAt !== null || this.result) return false;
    this.links.breakLink(l, 'disengage', this.time, this.tuning.attach.recallWindow);
    this.stats[from.side].disengages++;
    if (this.alongside?.boatId === other.id) this.alongside = null;
    // Boarders hear the recall now, not at the next think.
    for (const b of [l.a, l.b]) b.crew.thinkIn = 0;
    return true;
  }

  /**
   * Steer alongside an enemy (finger held on or near its hull), or null to stop.
   * Picks the side of it you're already on, or its free side.
   */
  setAlongside(target: Boat | null): void {
    if (!target || target.side === this.player.side || this.isSinking(target)) {
      this.alongside = null;
      return;
    }
    if (this.alongside?.boatId === target.id) return;
    this.alongside = { boatId: target.id, side: this.freeSide(this.player, target) };
  }

  /** Which side (+1 starboard, -1 port) of `target` `self` should come alongside: the near one, unless it's taken. */
  private freeSide(self: Boat, target: Boat): number {
    const l = toLocal(self.motion, target.motion, target.motion.heading);
    const near = l.y >= 0 ? 1 : -1;
    const ok = (s: number) => this.links.canLink(target, s > 0 ? 'starboard' : 'port', this.tuning);
    return ok(near) || !ok(-near) ? near : -near;
  }

  /** The enemy hull within `grab` m of a world point (closest first), for steering alongside. */
  enemyNear(world: Vec, grab: number): Boat | null {
    let best: Boat | null = null;
    let bestD = Infinity;
    for (const e of this.enemies) {
      if (this.isSinking(e)) continue;
      const d = distanceToHull(e, world);
      if (d <= grab && d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  /** Opposing boats this boat's guns may fire on: not attached to it, nor to any boat on its side (§4.6). */
  gunTargets(shooter: Boat): Boat[] {
    return this.boats.filter(
      (b) =>
        b.side !== shooter.side &&
        !this.isSinking(b) &&
        !this.links.attachedTo(b).some((o) => o.side === shooter.side),
    );
  }

  private crewContext(b: Boat): CrewContext {
    return { tuning: this.tuning, time: this.time, foes: this.gunTargets(b), lees: this.allLees(), links: this.links };
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
        const r = stepCrew(b, this.crewContext(b), dt);
        this.stats[b.side].hpRepaired += r.repaired;
        this.stats[b.side].waterBailed += r.bailed;
        this.stats[b.side].boardings += r.boarded.length;
        for (const l of [...r.boarded, ...r.returned]) this.events.push({ type: 'swing', leeId: l.id, back: r.returned.includes(l) });
      }
      this.stepCombat(dt);
    }
    for (const e of this.enemies) this.thinkEnemy(e);
    this.steerPlayer();
    const grouped = this.links.grouped();
    for (const b of this.boats) {
      if (grouped.has(b) && !this.isSinking(b)) continue; // attached: the group drifts as one
      const target = this.isSinking(b) ? null : b.target;
      const params = motionParams(b, this.tuning);
      // Enemy brains (and coming alongside) place their seek point themselves, so they seek it directly.
      if (b.side === 'enemy' || (b === this.player && this.alongside)) params.orbitCapture = 0;
      stepMotion(b.motion, target, params, dt);
    }
    this.links.moveGroups(this.tuning, dt);
    for (const ev of this.links.step({ tuning: this.tuning, time: this.time, boats: this.boats, playerAlongside: this.alongside?.boatId ?? null }, dt)) {
      this.handleLinkEvent(ev);
    }
    if (!decided) {
      for (const side of ['player', 'enemy'] as const) {
        if (this.boats.some((b) => b.side === side && this.isAttached(b))) this.stats[side].dockTime += dt;
      }
      for (const b of this.boats) this.stepCannons(b, dt);
    }
    this.stepShells(dt);
    this.telegraphs.step(dt);
    for (const b of this.boats) {
      if (this.isSinking(b) || decided) continue;
      this.stats[b.side].waterTaken += stepFlooding(b, this.tuning, dt);
    }
    this.checkSinking();
  }

  // ------------------------------------------------------------ close combat

  private stepCombat(dt: number): void {
    const lees = this.allLees();
    for (const l of lees) if (l.alive && !l.swing && l.deck !== l.boat) this.stats[l.side].enemyDeckTime += dt;
    updateEngagement(lees);
    const ctx = { tuning: this.tuning, time: this.time, rng: this.rng, lees, boats: this.boats };
    const events: CombatEvent[] = [...stepMelee(ctx, dt), ...stepPistols(ctx, dt)];
    for (const e of events) {
      if (e.type === 'melee') {
        const a = this.stats[e.attacker.side];
        a.meleeDealt += e.damage;
        this.stats[e.target.side].meleeTaken += e.damage;
        if (e.killed) a.meleeKills++;
        this.events.push({ type: 'melee', attacker: e.attacker.id, target: e.target.id, pos: e.pos, killed: e.killed });
      } else {
        const a = this.stats[e.shooter.side];
        a.pistolShots++;
        if (e.hit) {
          a.pistolHits++;
          a.pistolDealt += e.damage;
        }
        if (e.boat && e.part && e.boatDamage > 0) {
          a.damageDealt += e.boatDamage;
          this.stats[e.boat.side].damageTaken += e.boatDamage;
        }
        this.events.push({ type: 'pistol', shooter: e.shooter.id, from: e.from, to: e.to, hit: e.hit, side: e.shooter.side });
      }
      const victim = e.type === 'melee' ? e.target : e.hit ? e.target : null;
      if (victim) {
        this.events.push({ type: 'leeHurt', boatId: victim.deck.id, leeId: victim.id, damage: e.damage });
        if (e.killed) this.noteLost(victim);
      }
    }
    // Deaths change who's engaged.
    if (events.some((e) => e.killed)) {
      updateEngagement(lees);
      for (const b of this.boats) updateMobility(b, this.tuning);
    }
  }

  /** Count a lost Lee and tell the renderer. */
  private noteLost(lee: Lee): void {
    const s = this.stats[lee.side];
    s.leesLost++;
    if (lee.lostCause) s.lostBy[lee.lostCause]++;
    this.events.push({ type: 'leeLost', boatId: lee.deck.id, leeId: lee.id, pos: toWorld(lee.pos, lee.deck.motion, lee.deck.motion.heading), cause: lee.lostCause ?? 'cannon' });
  }

  private handleLinkEvent(ev: AttachEvent): void {
    switch (ev.type) {
      case 'docked':
        this.events.push({ type: 'docked', a: ev.a.id, b: ev.b.id });
        for (const b of [ev.a, ev.b]) b.crew.thinkIn = 0;
        break;
      case 'rammed': {
        const r = this.stats[ev.rammer.side];
        const tg = this.stats[ev.target.side];
        r.ramsDone++;
        tg.ramsTaken++;
        r.ramDealt += ev.damage;
        tg.ramTaken += ev.damage;
        r.ramTaken += ev.selfDamage;
        this.events.push({
          type: 'rammed',
          rammer: ev.rammer.id,
          target: ev.target.id,
          pos: ev.pos,
          damage: ev.damage,
          selfDamage: ev.selfDamage,
          part: ev.part.index,
          selfPart: ev.selfPart?.index ?? null,
        });
        for (const b of [ev.rammer, ev.target]) b.crew.thinkIn = 0;
        if (ev.rammer === this.player || ev.target === this.player) this.alongside = null;
        break;
      }
      case 'bump':
        this.events.push({ type: 'bump', pos: ev.pos, speed: ev.speed });
        break;
      case 'linkBroken': {
        this.events.push({ type: 'linkBroken', a: ev.a.id, b: ev.b.id, reason: ev.reason });
        // Anyone left on a deck that's going under goes with it.
        for (const deck of [ev.a, ev.b]) {
          if (!this.isSinking(deck)) continue;
          for (const l of this.allLees()) {
            if (!l.alive || l.deck !== deck || l.side === deck.side) continue;
            if (this.result?.winner === l.side) {
              l.swing = null;
              // The fight is won and the crews have stood down: winners make it home.
              l.deck = l.boat;
              l.tile = l.home;
              l.dest = l.home;
              l.path = [];
              l.pos = { ...l.boat.grid.tiles[l.home].center };
              l.reason = 'climbed home after the win';
              continue;
            }
            if (l.swing) continue; // in the air on the way out: it lands
            loseLee(l, this.time, 'sank');
            this.noteLost(l);
          }
        }
        for (const b of [ev.a, ev.b]) b.crew.thinkIn = 0;
        break;
      }
    }
  }

  /** Coming alongside: the helm seeks the slot beside the target and throttles to match it. */
  private steerPlayer(): void {
    const p = this.player;
    p.throttle = 1;
    const a = this.alongside;
    if (!a) return;
    const target = this.enemies.find((e) => e.id === a.boatId);
    if (!target || this.isSinking(target) || this.isSinking(p) || this.links.linkBetween(p, target)) {
      if (!target || this.isSinking(target)) this.alongside = null;
      return;
    }
    const cmd = alongsideCommand(p.motion, this.alongsideSpec(p, target, a.side), motionParams(p, this.tuning));
    p.target = cmd.target;
    p.throttle = cmd.throttle;
  }

  /** The slot beside `target` that `self` steers into. */
  alongsideSpec(self: Boat, target: Boat, side: number): AlongsideSpec {
    return { other: target.motion, offset: target.layout.beam / 2 + self.layout.beam / 2 + this.tuning.attach.dockGap, side };
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
    e.throttle = 1;
    if (this.isSinking(e)) {
      e.target = null;
      brain.seek = null;
      return;
    }
    if (this.isAttached(e)) {
      // Propulsion is overridden; enemy boats never disengage on their own.
      brain.mode = 'attached';
      e.target = null;
      brain.seek = null;
      return;
    }
    if (isDerelict(e)) {
      brain.mode = 'derelict';
      e.target = null;
      e.throttle = 0;
      brain.seek = null;
      return;
    }
    const st = shipTuning(e, this.tuning);
    if (st.ai.seekAttach > 0 && !this.isSinking(p) && this.links.canLink(e, 'bow', this.tuning) && this.links.linksOf(p).length < Math.round(this.tuning.attach.cap)) {
      if (this.thinkBoarder(e, brain, st.ai)) return;
    }
    brain.mode = 'orbit';
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

  /**
   * A boarder closes in: ram when it has a clean line onto your hull (heading
   * already close to the intercept, hitting you square-ish, close enough),
   * otherwise come alongside to dock. Same steering as everyone else.
   * Returns false if neither is possible (it then holds range like a gunboat).
   */
  private thinkBoarder(e: Boat, brain: EnemyBrain, ai: { ramLine: number; ramRange: number }): boolean {
    const p = this.player;
    const d = dist(e.motion, p.motion);
    const speed = Math.max(1, Math.hypot(e.motion.vx, e.motion.vy));
    const tti = d / speed;
    const aim = { x: p.motion.x + p.motion.vx * tti, y: p.motion.y + p.motion.vy * tti };
    const off = Math.abs(wrapAngle(Math.atan2(aim.y - e.motion.y, aim.x - e.motion.x) - e.motion.heading));
    const across = Math.abs(Math.sin(e.motion.heading - p.motion.heading));
    const side = sideFacing(p, e.motion);
    const line = (brain.mode === 'ram' ? 2 : 1) * ai.ramLine * DEG;
    const range = ai.ramRange * (brain.mode === 'ram' ? 1.3 : 1);
    if (off <= line && d <= range && across >= 0.6 && this.links.canLink(p, side, this.tuning) && speed >= this.tuning.attach.ramSpeed) {
      brain.mode = 'ram';
      brain.seek = aim;
      e.target = aim;
      return true;
    }
    // Come alongside on the near side (or the free one).
    if (brain.mode !== 'alongside' || !this.links.canLink(p, brain.side > 0 ? 'starboard' : 'port', this.tuning)) {
      brain.side = this.freeSide(e, p);
    }
    if (!this.links.canLink(p, brain.side > 0 ? 'starboard' : 'port', this.tuning)) return false;
    brain.mode = 'alongside';
    const cmd = alongsideCommand(e.motion, this.alongsideSpec(e, p, brain.side), motionParams(e, this.tuning));
    brain.seek = cmd.target;
    e.target = cmd.target;
    e.throttle = cmd.throttle;
    return true;
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
    const c = boatTuning(shooter, this.tuning).cannons;
    let t = Math.max(0.05, c.flightTimeBase + c.flightTimePerMeter * distance);
    if (shooter.side === 'enemy') t = Math.max(t, this.tuning.telegraph.minWarningTime);
    return t;
  }

  /**
   * Where `shooter` would aim from `from` at `part` of `target`, leading its current
   * velocity. With a plan, aims at the plan's spot on the part and leads by its (imperfect) factor.
   */
  leadAim(shooter: Boat, from: Vec, target: Boat, part: PartState, plan?: AimPlan): { aim: Vec; time: number } {
    const off = plan?.offset ?? { x: 0, y: 0 };
    const p = toWorld({ x: part.center.x + off.x, y: part.center.y + off.y }, target.motion, target.motion.heading);
    const lead = plan?.lead ?? 1;
    let aim = p;
    let time = this.flightTime(shooter, dist(from, p));
    for (let i = 0; i < 3; i++) {
      aim = { x: p.x + target.motion.vx * time * lead, y: p.y + target.motion.vy * time * lead };
      time = this.flightTime(shooter, dist(from, aim));
    }
    return { aim, time };
  }

  /** The closest valid target inside this cannon's arc and between its minimum and maximum range, or null. */
  pickTarget(shooter: Boat, c: CannonState, from: Vec): Boat | null {
    let best: Boat | null = null;
    let bestD = Infinity;
    for (const b of this.gunTargets(shooter)) {
      const d = dist(from, b.motion);
      if (d < bestD && this.canHit(shooter, c, from, b.motion)) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }

  /** Roll a gunner's aim at a boat: a random part, a random spot near it, an imperfect lead. */
  planAim(shooter: Boat, target: Boat): AimPlan {
    const ct = boatTuning(shooter, this.tuning).cannons;
    const err = Math.max(0, ct.leadError);
    return {
      boatId: target.id,
      part: Math.min(target.parts.length - 1, Math.floor(this.rng.next() * target.parts.length)),
      offset: this.rng.inDisk(Math.max(0, ct.aimRadius)),
      lead: 1 + this.rng.range(-err, err),
    };
  }

  /** The gunner working a cannon right now, or null (an unmanned gun neither loads nor fires). */
  gunnerOf(b: Boat, c: CannonState): Lee | null {
    return workerAt(b, c.station);
  }

  /** Is `aim` inside this cannon's arc, and between its minimum and maximum range? */
  canHit(b: Boat, c: CannonState, from: Vec, aim: Vec): boolean {
    const ct = boatTuning(b, this.tuning).cannons;
    const d = dist(from, aim);
    if (d > cannonRange(b, this.tuning) || d < ct.minRange) return false;
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
    const ct = boatTuning(b, this.tuning).cannons;
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
      // 1) closest boat this gun can reach, 2-4) a rolled aim at it (kept until the shot goes).
      const target = this.pickTarget(b, c, from);
      if (!target) {
        c.aim = null;
        return;
      }
      if (!c.aim || c.aim.boatId !== target.id) c.aim = this.planAim(b, target);
      const { aim, time } = this.leadAim(b, from, target, target.parts[c.aim.part], c.aim);
      if (!this.canHit(b, c, from, aim)) return;
      const accuracy = Math.max(0.05, leeStat(gunner, 'accuracy', b, this.tuning));
      const off = this.rng.inDisk(Math.max(0, ct.spread) / accuracy);
      const to = { x: aim.x + off.x, y: aim.y + off.y };
      c.load = 0;
      c.lastFired = this.time;
      c.aim = null;
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

    const wasOnline = structureFraction(hitPart) > boatTuning(hitBoat, this.tuning).function.cannonOfflineAt;
    const wasWrecked = isWrecked(hitPart);
    const dmg = applyDamage(hitPart, s.damage);
    // Every hit lets water in; a hit on a part that's already wrecked punches straight through.
    const owner = this.boats.find((b) => b.id === s.ownerId);
    const ht = boatTuning(owner ?? { side: s.ownerSide, type: 'standard' }, this.tuning).cannons;
    this.stats[hitBoat.side].waterTaken += floodPart(hitBoat, hitPart, wasWrecked ? ht.holeWater : ht.hitWater);
    this.stats[s.ownerSide].shellsHit++;
    this.stats[s.ownerSide].damageDealt += dmg.dealt;
    const shooter = s.leeId !== null ? this.findLee(s.leeId) : null;
    if (shooter) {
      shooter.lee.stats.shellsHit++;
      shooter.lee.stats.damageDealt += dmg.dealt;
    }
    for (const h of damageCrewAt(hitBoat, toLocal(s.to, hitBoat.motion, hitBoat.motion.heading), this.tuning, this.time, this.allLees())) {
      this.events.push({ type: 'leeHurt', boatId: hitBoat.id, leeId: h.lee.id, damage: h.damage });
      if (h.lost) this.noteLost(h.lee);
    }
    this.stats[hitBoat.side].damageTaken += dmg.dealt;
    this.events.push({ type: 'hit', boatId: hitBoat.id, part: hitPart.index, pos: s.to, damage: dmg.dealt });
    if (hitPart.def.role === 'cannon' && wasOnline && structureFraction(hitPart) <= boatTuning(hitBoat, this.tuning).function.cannonOfflineAt) {
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
      // Its links break after the evacuation window; boarders on it swing home meanwhile.
      for (const l of this.links.linksOf(b)) this.links.breakLink(l, `${b.side === 'player' ? 'your boat' : 'enemy'} sinking`, this.time, this.tuning.attach.recallWindow);
      // Its own boarders elsewhere are lost with it.
      for (const l of b.crew.lees) {
        if (!l.alive || (l.deck === b && !l.swing)) continue;
        loseLee(l, this.time, 'sank');
        this.noteLost(l);
      }
      if (this.alongside?.boatId === b.id) this.alongside = null;
      for (const o of this.links.attachedTo(b)) o.crew.thinkIn = 0;
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
