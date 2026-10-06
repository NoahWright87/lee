// The one game world both views read from. Fixed-step, deterministic for a
// given seed and input sequence.

import { ITEMS } from '../config/items';
import { LEE_DEFS } from '../config/lees';
import type { Side, Tuning } from '../config/tuning';
import { ContactSystem, hullGap, inReach, sideAboard, sideFacing, spikesOn, type ContactEvent } from './contact';
import {
  applyDamage,
  createBoat,
  distanceToHull,
  floodPart,
  gunOnline,
  gunSpec,
  isDerelict,
  isWrecked,
  motionParams,
  partAt,
  sinkProgress,
  stepFlooding,
  structureFraction,
  type AimPlan,
  type Boat,
  type GunState,
  type PartState,
} from './boat';
import { updateEngagement, stepMelee, stepPistols, type CombatEvent } from './combat';
import { createLee, damageCrewAt, hurtLee, inArc, jobCounts, leeStat, loseLee, orderJob, stepCrew, tilesWithin, updateMobility, wetFactor, workerAt, type CrewContext, type Lee, type LossCause } from './crew';
import type { Job } from '../config/lees';
import { boardOrRam, nearSide, steer, type Helm, type HelmWorld, type ManeuverKind } from './helm';
import { tileAt } from './grid';
import { defaultBuild, itemParam } from './loadout';
import { combineMods } from './levels';
import { DEG, dist, NORTH, Rng, rotate, toLocal, toWorld, wrapAngle, type Vec } from './math';
import { archetypeSetup, autoArrange, basicCrew, type BoatSetup, type CrewSpec } from './setup';
import { stepMotion } from './steering';
import { TelegraphSystem } from './telegraph';

export type Phase = 'ready' | 'running' | 'over';

export interface Shell {
  id: number;
  /** Pellets of one burst share a group (the threat budget counts a burst once). */
  group: number;
  ownerId: number;
  ownerSide: Side;
  /** Gun item that fired it (visuals). */
  gun: string;
  mode: 'shell' | 'lob' | 'burst';
  from: Vec;
  to: Vec;
  elapsed: number;
  flightTime: number;
  damage: number;
  crewDamage: number;
  /** Splash reach in tiles for crew and deck damage (0 = only the tile it lands on). */
  splash: number;
  impactRadius: number;
  /** The Lee who fired it (for per-Lee stats). */
  leeId: number | null;
}

export type WorldEvent =
  | { type: 'fire'; boatId: number; cannon: number; from: Vec; to: Vec; gun: string }
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
  | { type: 'contact'; a: number; b: number }
  | { type: 'bump'; pos: Vec; speed: number }
  | { type: 'contactEnded'; a: number; b: number }
  | { type: 'order'; boatId: number; leeId: number; job: Job }
  | { type: 'orderFull'; boatId: number; job: Job }
  | { type: 'swing'; leeId: number; back: boolean }
  | { type: 'crewLost'; boatId: number }
  | { type: 'gatling'; boatId: number; cannon: number; from: Vec; to: Vec; hit: boolean; side: Side }
  | { type: 'blowout'; boatId: number; tile: number; pos: Vec }
  | { type: 'explosion'; boatId: number; tile: number; pos: Vec };

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
  gatlingShots: number;
  gatlingHits: number;
  gatlingDealt: number;
  ramsDone: number;
  ramsTaken: number;
  /** Ram damage dealt to the struck boat (by this side's rams) and taken (by this side's boats, both ways). */
  ramDealt: number;
  ramTaken: number;
  /** Seconds this side spent in close combat (any of its boats). */
  closeTime: number;
  retreats: number;
  /** This side's tiles blown out, and volatile parts that went up. */
  tilesBlown: number;
  explosions: number;
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
  lostBy: { cannon: 0, gatling: 0, melee: 0, pistol: 0, sank: 0, spikes: 0, explosion: 0 },
  tilesBlown: 0,
  explosions: 0,
  gatlingShots: 0,
  gatlingHits: 0,
  gatlingDealt: 0,
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
  closeTime: 0,
  retreats: 0,
});

export interface Result {
  winner: Side;
  loser: Side;
  /** Fight time when the fight was decided (the last enemy, or you, went down or lost its crew). */
  time: number;
  /** How the loser went out: its boat sank, or its whole crew was killed. */
  how: 'sunk' | 'crew';
}

export interface EnemyBrain {
  /** +1 / -1 orbit direction around the player, chosen on the first think. */
  orbitDir: number;
  /** This ship's own preferred range (base ± jitter, so a pack spreads out). */
  range: number;
  /** The point it is currently seeking (debug overlay). */
  seek: Vec | null;
  /** What it's doing: holding range, coming alongside, ramming, holding its nose in after a ram, adrift. */
  mode: 'orbit' | 'alongside' | 'ram' | 'hold' | 'derelict';
  /** Which of your sides it's coming alongside (+1 starboard, -1 port). */
  side: number;
  /** World time of its next ⚔️ order (boarders move Lees to the boarding party as they close). */
  nextOrder: number;
}

/** Player damage carried into the next fight (structure fraction and water per part). */
export interface PlayerCarry {
  hp: number[];
  water: number[];
}

export interface WorldOptions {
  /** 1-based fight number in the current run (display only). */
  fight?: number;
  /** Your boat and crew. Default: the Basic Ship's standard fit with `crew` Basic Lees. */
  player?: BoatSetup;
  /** Enemy boats (encounter data, already built). */
  enemies?: BoatSetup[];
  /** Shorthand: enemy archetype ids ('standard', 'boarder', 'heavy') at level 1. */
  encounter?: string[];
  /** Shorthand: this many Basic Ships (standard archetype). */
  enemyCount?: number;
  /** Shorthand for the player: Basic Lees on these home tiles of the standard Basic Ship. */
  crew?: CrewPlacement;
  /** Player damage from the previous fight; repaired by run.repairBetweenFights. */
  carry?: PlayerCarry;
  /**
   * Sandbox assists (playerAdvantage, playerCrewStats, pack scaling) apply. Off
   * in a run: there, everything is explained by ships, loadouts and crews.
   */
  assists?: boolean;
}

/** Home tile per Lee slot (null = in the tray). */
export type CrewPlacement = (number | null)[];

/** The default player setup: the Basic Ship's standard fit and Basic Lees auto-arranged. */
export function defaultPlayerSetup(t: Tuning, size = 6, ship = 'basic'): BoatSetup {
  const build = defaultBuild(ship);
  const crew: CrewSpec[] = Array.from({ length: size }, () => ({ type: 'basic', home: null }));
  const homes = autoArrange(build, crew, t);
  crew.forEach((c, i) => (c.home = homes[i]));
  return { build, crew };
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
  /** Boats already marked as having lost their whole crew. */
  private crewless = new Set<Boat>();
  /** Close combat between boats, ram warnings, collisions. */
  readonly contacts = new ContactSystem();
  /** Your helm: what the steering is set to (it stays set after your finger lifts). */
  helm: Helm = { kind: 'drift' };
  /** The enemy you tapped: the ⚔️ target (null = none). */
  boardTargetId: number | null = null;
  /** BOARD or RAM for the ⚔️ button (kept between frames for the hysteresis). */
  private maneuverLabel: ManeuverKind | null = null;
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
  private nextGroup = 1;
  private nextLeeId = 1;

  /** Sandbox assists on (see WorldOptions.assists). */
  readonly assists: boolean;

  constructor(tuning: Tuning, seed = (Math.random() * 2 ** 31) | 0, opts: WorldOptions = {}) {
    this.tuning = tuning;
    this.seed = seed;
    this.rng = new Rng(seed);
    this.fight = Math.max(1, opts.fight ?? 1);
    this.assists = opts.assists ?? true;
    const assist = (v: number, off: number) => (this.assists ? v : off);
    const playerSetup: BoatSetup = opts.player ?? (opts.crew ? { build: defaultBuild('basic'), crew: basicCrew(opts.crew) } : defaultPlayerSetup(tuning));
    this.player = createBoat(1, 'player', playerSetup.build, tuning, { x: 0, y: 0 }, NORTH, { advantage: assist(tuning.global.playerAdvantage, 1) });
    if (opts.carry) this.applyCarry(opts.carry);
    this.playerCrew = playerSetup.crew;
    this.placePlayerCrew(playerSetup.crew);

    // Enemies fan out around the first spawn point, alternating sides of it.
    const g = tuning.global;
    const setups =
      opts.enemies ??
      (opts.encounter?.length ? opts.encounter : Array(Math.max(1, opts.enemyCount ?? 1)).fill('standard')).map((id, i) => archetypeSetup(id, tuning, seed + i));
    const count = setups.length;
    const range = Math.hypot(g.enemyStartNorth, g.enemyStartEast);
    const bearing = Math.atan2(-g.enemyStartNorth, g.enemyStartEast);
    const spread = tuning.fights.spawnSpread * DEG;
    this.enemies = [];
    setups.forEach((setup, i) => {
      const k = i === 0 ? 0 : Math.ceil(i / 2) * (i % 2 ? 1 : -1);
      const a = bearing + k * spread;
      const ai = setup.ai ?? { ...tuning.ai.standard };
      const e = createBoat(2 + i, 'enemy', setup.build, tuning, { x: Math.cos(a) * range, y: Math.sin(a) * range }, NORTH, { ai });
      // Sandbox assist: bigger packs field lighter hulls.
      const hpScale = Math.pow(count, -Math.max(0, assist(tuning.fights.packHullScaling, 0)));
      if (hpScale !== 1) {
        for (const part of e.parts) {
          for (const layer of part.layers) {
            layer.maxHp = Math.max(1, layer.maxHp * hpScale);
            layer.hp = layer.maxHp;
          }
        }
      }
      this.enemies.push(e);
      this.boardCrew(e, setup.crew);
      const jitter = tuning.enemyAI.rangeJitter;
      this.brains.set(e.id, { orbitDir: 0, range: ai.preferredRange + this.rng.range(-jitter, jitter), seek: null, mode: 'orbit', side: 0, nextOrder: 0 });
    });
    this.boats = [this.player, ...this.enemies];
  }

  /** The crew you set out with (setup mode replaces it). */
  playerCrew: CrewSpec[];

  /** Put a crew aboard: one Lee per Lee with a home, standing on it. */
  private boardCrew(boat: Boat, crew: CrewSpec[]): void {
    boat.crew.lees = [];
    boat.crew.thinkIn = 0;
    const used = new Set<number>();
    const assistMods = boat.side === 'player' && this.assists && this.tuning.global.playerCrewStats !== 1 ? allStats(this.tuning.global.playerCrewStats) : undefined;
    crew.forEach((c, slot) => {
      const home = c.home;
      if (home === null || home < 0 || home >= boat.grid.tiles.length || used.has(home)) return;
      used.add(home);
      const def = LEE_DEFS[c.type] ?? LEE_DEFS.basic;
      const mods = combineMods(c.mods, boat.mods.crew, assistMods);
      boat.crew.lees.push(createLee(this.nextLeeId++, slot + 1, def, boat.side, boat, home, this.tuning, { uid: c.uid, label: c.label, level: c.level, mods, job: c.job }));
    });
    updateMobility(boat, this.tuning);
  }

  /** Replace your crew (setup mode only). */
  placePlayerCrew(crew: CrewSpec[]): void {
    if (this.phase !== 'ready') return;
    this.playerCrew = crew;
    this.boardCrew(this.player, crew);
  }

  /** Every Lee in the world. */
  allLees(): Lee[] {
    return this.boats.flatMap((b) => b.crew.lees);
  }

  // ------------------------------------------------------------ close combat and orders

  /** Opposing boats in close combat with this one, nearest first. */
  touching(b: Boat): Boat[] {
    return this.contacts.touching(b);
  }

  inContact(b: Boat): boolean {
    return this.contacts.contactsOf(b).length > 0;
  }

  /** 0 → 1 as the nearest enemy closes from closeViewStart to boarding range (the close-up view and the melee speed follow it). */
  closeness(b: Boat = this.player): number {
    const t = this.tuning;
    let gap = Infinity;
    for (const e of this.boats) {
      if (e.side === b.side || this.isOut(e)) continue;
      gap = Math.min(gap, hullGap(b, e).gap);
    }
    const near = Math.max(0, t.boarding.range);
    const far = Math.max(near + 1, t.layout.closeViewStart);
    return clamp01((far - gap) / (far - near));
  }

  /** Enemies close enough to show in the close-up, nearest first. */
  closeBoats(b: Boat = this.player): Boat[] {
    const far = this.tuning.layout.closeViewStart;
    return this.boats
      .filter((e) => e.side !== b.side && this.sinkAnim(e) < 1 && hullGap(b, e).gap <= far)
      .sort((x, y) => hullGap(b, x).gap - hullGap(b, y).gap || x.id - y.id);
  }

  /** Your ⚔️ target if it's still in the fight, else whoever you're in close combat with. */
  playerBoardTarget(): Boat | null {
    const id = this.boardTargetId;
    const tgt = id !== null ? this.enemies.find((e) => e.id === id && !this.isOut(e)) ?? null : null;
    if (tgt) return tgt;
    return this.touching(this.player).find((e) => !this.isOut(e)) ?? null;
  }

  /** Where a boat's ⚔️ Lees head: yours from your target; enemies always go for you. */
  boardTargetOf(b: Boat): Boat | null {
    if (b === this.player) return this.playerBoardTarget();
    return this.isSinking(this.player) ? null : this.player;
  }

  /** The ⚔️ button's mode: null (greyed: no target), BOARD, RAM, or CHARGE (in close combat). */
  meleeMode(): 'board' | 'ram' | 'charge' | null {
    const target = this.playerBoardTarget();
    if (!target) {
      this.maneuverLabel = null;
      return null;
    }
    if (this.contacts.between(this.player, target)) return 'charge';
    const h = this.helm;
    if ((h.kind === 'board' || h.kind === 'ram') && h.boatId === target.id) return (this.maneuverLabel = h.kind);
    this.maneuverLabel = boardOrRam(this.player, target, this.maneuverLabel, this.tuning);
    return this.maneuverLabel;
  }

  /** In melee contact: ⏩ shows RETREAT instead of SAIL. */
  canRetreat(): boolean {
    const p = this.player;
    return this.inContact(p) || sideAboard(p, 'enemy', this.allLees()) || p.crew.lees.some((l) => l.alive && l.deck !== p);
  }

  /** Is the player pulling out (RETREAT)? */
  get retreating(): boolean {
    return this.helm.kind === 'retreat';
  }

  /** Set your helm (a tap). Anything but a maneuver cancels the maneuver; the boarding party stays gathered. */
  setHelm(h: Helm): void {
    if (this.player.sinkingSince !== null) return;
    this.helm = h;
  }

  /** Tap an enemy: it's your ⚔️ target, and you head for it to BOARD or RAM (whichever the angle says). */
  targetEnemy(e: Boat): void {
    if (e.side === this.player.side || this.isOut(e)) return;
    if (this.boardTargetId !== e.id) this.maneuverLabel = null;
    this.boardTargetId = e.id;
    this.startManeuver();
  }

  /** Head for the ⚔️ target with the current BOARD/RAM choice (no-op without a target). */
  private startManeuver(): void {
    const target = this.playerBoardTarget();
    if (!target) return;
    const mode = this.meleeMode();
    if (mode === 'charge') return;
    const h = this.helm;
    if ((h.kind === 'board' || h.kind === 'ram') && h.boatId === target.id) return;
    this.helm = mode === 'ram' ? { kind: 'ram', boatId: target.id, hold: false } : { kind: 'board', boatId: target.id, side: nearSide(this.player, target) };
  }

  /**
   * An action button: move the best-fit Lee into a job. ⚔️ also starts the
   * BOARD/RAM maneuver toward the target. ⏩ in melee contact is RETREAT.
   * Returns the Lee moved (null: the job is full, or nobody can move).
   */
  order(job: Job, boat: Boat = this.player): Lee | null {
    if (boat === this.player && job === 'board') {
      if (!this.playerBoardTarget()) return null;
      this.startManeuver();
    }
    const lee = orderJob(boat, job, this.time, this.tuning);
    if (lee) this.events.push({ type: 'order', boatId: boat.id, leeId: lee.id, job });
    else this.events.push({ type: 'orderFull', boatId: boat.id, job });
    return lee;
  }

  /**
   * RETREAT: your boarders come home (the boat waits beside them), then you
   * sail away from the nearest enemy until you set a heading.
   */
  retreat(): void {
    if (this.retreating || this.result) return;
    this.helm = { kind: 'retreat' };
    this.stats.player.retreats++;
    this.player.crew.thinkIn = 0;
  }

  /** The enemy hull within `grab` m of a world point (closest first). */
  enemyNear(world: Vec, grab: number): Boat | null {
    let best: Boat | null = null;
    let bestD = Infinity;
    for (const e of this.enemies) {
      if (this.isOut(e)) continue;
      const d = distanceToHull(e, world);
      if (d <= grab && d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  /** Helm queries for the shared steering code. */
  private helmWorld(): HelmWorld {
    return {
      tuning: this.tuning,
      live: (id) => this.boats.find((b) => b.id === id && !this.isOut(b)) ?? null,
      nearestFoe: (self) => {
        let best: Boat | null = null;
        let bestD = Infinity;
        for (const b of this.boats) {
          if (b.side === self.side || this.isOut(b)) continue;
          const d = dist(b.motion, self.motion);
          if (d < bestD) {
            bestD = d;
            best = b;
          }
        }
        return best;
      },
      waitFor: (self) => {
        for (const l of self.crew.lees) {
          if (!l.alive || l.deck === self || l.deck.sinkingSince !== null) continue;
          if (l.swing && !l.swing.back) return l.swing.to;
          if (!l.swing && inReach(self, l.deck, this.tuning)) return l.deck;
        }
        return null;
      },
    };
  }

  /** Opposing boats this boat's guns may fire on: in the fight, and with none of the shooter's own boarders aboard. */
  gunTargets(shooter: Boat): Boat[] {
    const lees = this.allLees();
    return this.boats.filter((b) => b.side !== shooter.side && !this.isOut(b) && !sideAboard(b, shooter.side, lees));
  }

  private crewContext(b: Boat): CrewContext {
    return {
      tuning: this.tuning,
      time: this.time,
      foes: this.gunTargets(b),
      lees: this.allLees(),
      boardTarget: this.boardTargetOf(b),
      retreating: b === this.player && this.retreating,
    };
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
    const repair = Math.min(1, Math.max(0, this.tuning.run.repairBetweenFights));
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

  /** Enemy ships still in the fight: afloat and with crew. */
  liveEnemies(): Boat[] {
    return this.enemies.filter((e) => !this.isOut(e));
  }

  /** Out of the fight for all intents and purposes: sinking, or its whole crew is dead. */
  isOut(b: Boat): boolean {
    return this.isSinking(b) || isDerelict(b);
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
        for (const h of r.hurt) {
          this.events.push({ type: 'leeHurt', boatId: h.lee.deck.id, leeId: h.lee.id, damage: h.damage });
          if (h.killed) this.noteLost(h.lee);
        }
      }
      this.stepCombat(dt);
    }
    for (const e of this.enemies) this.thinkEnemy(e);
    this.steerPlayer();
    for (const b of this.boats) {
      const target = this.isSinking(b) ? null : b.target;
      stepMotion(b.motion, target, motionParams(b, this.tuning), dt);
    }
    for (const ev of this.contacts.step({ tuning: this.tuning, time: this.time, boats: this.boats }, dt)) this.handleContactEvent(ev);
    if (!decided) {
      for (const side of ['player', 'enemy'] as const) {
        if (this.boats.some((b) => b.side === side && this.inContact(b))) this.stats[side].closeTime += dt;
      }
      for (const b of this.boats) this.stepGuns(b, dt);
      this.stepSpikes(dt);
    }
    this.stepSunkDecks();
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

  private handleContactEvent(ev: ContactEvent): void {
    switch (ev.type) {
      case 'contact':
        this.events.push({ type: 'contact', a: ev.a.id, b: ev.b.id });
        for (const b of [ev.a, ev.b]) b.crew.thinkIn = 0;
        break;
      case 'contactEnded':
        this.events.push({ type: 'contactEnded', a: ev.a.id, b: ev.b.id });
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
        // No bounce: the rammer keeps its nose in until somebody sails off.
        if (ev.rammer === this.player) {
          this.boardTargetId = ev.target.id;
          this.helm = { kind: 'ram', boatId: ev.target.id, hold: true };
        } else {
          const brain = this.brains.get(ev.rammer.id);
          if (brain && brain.mode === 'ram') brain.mode = 'hold';
        }
        break;
      }
      case 'bump':
        this.events.push({ type: 'bump', pos: ev.pos, speed: ev.speed });
        break;
    }
  }

  /** The helm steers: seek point, throttle, orbit or not, stopped or not. */
  private steerPlayer(): void {
    const p = this.player;
    if (this.isSinking(p)) {
      p.target = null;
      return;
    }
    // RAM turns into holding once we're nose-in, however gently we arrived.
    const h = this.helm;
    if (h.kind === 'ram' && !h.hold) {
      const tgt = this.boats.find((b) => b.id === h.boatId);
      if (tgt && this.contacts.between(p, tgt)) this.helm = { ...h, hold: true };
    }
    // Not steered yet: whatever set the seek point directly (tests, tools) keeps it.
    if (this.phase === 'ready' || this.helm.kind === 'drift') {
      p.stopped = false;
      return;
    }
    const { cmd, helm } = steer(p, this.helm, this.helmWorld());
    this.helm = helm;
    p.target = cmd.target;
    p.throttle = cmd.throttle;
    p.orbit = cmd.orbit;
    p.stopped = cmd.stopped;
  }

  // ------------------------------------------------------------ enemy brain

  /**
   * Seek a spot that keeps the player on our beam at our preferred range: aim
   * 90° off the bearing to the player, bent inward when too far and outward
   * when too close, and nudged away from other ships in the pack. Same
   * steering as the player; only the target differs. Boarders close in
   * instead, and move Lees to ⚔️ on the way (the same orders you give).
   */
  private thinkEnemy(e: Boat): void {
    const brain = this.brains.get(e.id)!;
    const p = this.player;
    e.throttle = 1;
    e.orbit = false;
    if (this.isSinking(e)) {
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
    const prof = e.ai ?? this.tuning.ai.standard;
    this.orderEnemyCrew(e, brain, prof);
    if (prof.seekAttach > 0 && !this.isSinking(p)) {
      this.thinkBoarder(e, brain, prof);
      return;
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

  /** A boarder AI moves Lees into its boarding party (one order at a time) once you're within boardAt. */
  private orderEnemyCrew(e: Boat, brain: EnemyBrain, prof: { boardShare: number; boardAt: number }): void {
    if (prof.boardShare <= 0 || this.time < brain.nextOrder || this.isSinking(this.player)) return;
    if (dist(e.motion, this.player.motion) > prof.boardAt) return;
    const alive = e.crew.lees.filter((l) => l.alive).length;
    if (jobCounts(e).board >= Math.round(alive * Math.min(1, prof.boardShare))) return;
    brain.nextOrder = this.time + Math.max(0.05, this.tuning.jobs.aiOrderInterval);
    this.order('board', e);
  }

  /**
   * A boarder closes in: ram when it has a clean line onto your hull (heading
   * already close to the intercept, hitting you square-ish, close enough),
   * otherwise come alongside. After a ram it holds its nose in. Same steering
   * (and the same autopilot) as yours.
   */
  private thinkBoarder(e: Boat, brain: EnemyBrain, ai: { ramLine: number; ramRange: number }): void {
    const p = this.player;
    const hw = this.helmWorld();
    const drive = (helm: Helm) => {
      const { cmd } = steer(e, helm, hw);
      brain.seek = cmd.target;
      e.target = cmd.target;
      e.throttle = cmd.throttle;
    };
    if (brain.mode === 'hold') {
      if (hullGap(e, p).gap <= this.tuning.boarding.range + this.tuning.boarding.rangeSlack) {
        drive({ kind: 'ram', boatId: p.id, hold: true });
        return;
      }
      brain.mode = 'alongside';
    }
    const d = dist(e.motion, p.motion);
    const speed = Math.max(1, Math.hypot(e.motion.vx, e.motion.vy));
    const tti = d / speed;
    const aim = { x: p.motion.x + p.motion.vx * tti, y: p.motion.y + p.motion.vy * tti };
    const off = Math.abs(wrapAngle(Math.atan2(aim.y - e.motion.y, aim.x - e.motion.x) - e.motion.heading));
    const across = Math.abs(Math.sin(e.motion.heading - p.motion.heading));
    const line = (brain.mode === 'ram' ? 2 : 1) * ai.ramLine * DEG;
    const range = ai.ramRange * (brain.mode === 'ram' ? 1.3 : 1);
    if (!this.inContact(e) && off <= line && d <= range && across >= 0.6 && speed >= this.tuning.attach.ramSpeed) {
      brain.mode = 'ram';
      drive({ kind: 'ram', boatId: p.id, hold: false });
      return;
    }
    // Come alongside on the near side.
    if (brain.mode !== 'alongside') brain.side = nearSide(e, p);
    brain.mode = 'alongside';
    drive({ kind: 'board', boatId: p.id, side: brain.side });
  }

  // ------------------------------------------------------------ guns

  muzzle(b: Boat, g: GunState): Vec {
    return toWorld(g.local, b.motion, b.motion.heading);
  }

  /** World angle a gun points. */
  gunFacing(b: Boat, g: GunState): number {
    return b.motion.heading + g.face;
  }

  flightTime(shooter: Boat, distance: number, shellSpeed = 1): number {
    const G = this.tuning.guns;
    let t = Math.max(0.05, (G.flightTimeBase + G.flightTimePerMeter * distance) / Math.max(0.05, shellSpeed));
    if (shooter.side === 'enemy') t = Math.max(t, this.tuning.telegraph.minWarningTime);
    return t;
  }

  /**
   * Where `shooter` would aim from `from` at `part` of `target`, leading its current
   * velocity. With a plan, aims at the plan's spot on the part and leads by its (imperfect) factor.
   */
  leadAim(shooter: Boat, from: Vec, target: Boat, part: PartState, plan?: AimPlan, shellSpeed = 1): { aim: Vec; time: number } {
    const off = plan?.offset ?? { x: 0, y: 0 };
    const m = target.motion;
    const p = toWorld({ x: part.center.x + off.x, y: part.center.y + off.y }, m, m.heading);
    const lead = plan?.lead ?? 1;
    // Assume the target keeps turning at this fraction of its current rate (0 = holds course).
    const w = m.omega * (plan?.turn ?? 0);
    const predict = (time: number): Vec => {
      const tl = time * lead;
      const a = w * tl;
      if (Math.abs(a) < 1e-4) return { x: p.x + m.vx * tl, y: p.y + m.vy * tl };
      // Center moves along an arc; the aim point turns with the hull around it.
      const s = Math.sin(a) / w;
      const c = (1 - Math.cos(a)) / w;
      const cx = m.x + s * m.vx - c * m.vy;
      const cy = m.y + c * m.vx + s * m.vy;
      const r = rotate({ x: p.x - m.x, y: p.y - m.y }, a);
      return { x: cx + r.x, y: cy + r.y };
    };
    let aim = p;
    let time = this.flightTime(shooter, dist(from, p), shellSpeed);
    for (let i = 0; i < 3; i++) {
      aim = predict(time);
      time = this.flightTime(shooter, dist(from, aim), shellSpeed);
    }
    return { aim, time };
  }

  /** The closest valid target inside this gun's arc and between its minimum and maximum range, or null. */
  pickTarget(shooter: Boat, g: GunState, from: Vec): Boat | null {
    let best: Boat | null = null;
    let bestD = Infinity;
    for (const b of this.gunTargets(shooter)) {
      const d = dist(from, b.motion);
      if (d < bestD && this.canHit(shooter, g, from, b.motion)) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }

  /** Roll a gunner's aim at a boat: a random part, a random spot near it, an imperfect lead. */
  planAim(_shooter: Boat, target: Boat): AimPlan {
    const G = this.tuning.guns;
    const err = Math.max(0, G.leadError);
    return {
      boatId: target.id,
      part: Math.min(target.parts.length - 1, Math.floor(this.rng.next() * target.parts.length)),
      offset: this.rng.inDisk(Math.max(0, G.aimRadius)),
      lead: 1 + this.rng.range(-err, err),
      turn: this.rng.range(0, Math.max(0, G.turnLead)),
    };
  }

  /** The gunner working a gun right now, or null (an unmanned gun neither loads nor fires). */
  gunnerOf(b: Boat, g: GunState): Lee | null {
    return workerAt(b, g.station);
  }

  /** Is `aim` inside this gun's arc, and between its minimum and maximum range? */
  canHit(b: Boat, g: GunState, from: Vec, aim: Vec): boolean {
    const spec = gunSpec(b, g, this.tuning);
    return inArc(from, this.gunFacing(b, g), aim, spec.arcHalf, spec.minRange, spec.range);
  }

  /**
   * A stream gun (gatling) sprays bullets at the nearest enemy Lee on an enemy
   * deck in its arc and range (attached decks too). Each bullet scatters in a
   * disk that grows with distance; a miss that lands on an enemy hull barely scratches it.
   */
  private stepStream(b: Boat, g: GunState, gunner: Lee, speed: number, reload: number, dt: number): void {
    const spec = gunSpec(b, g, this.tuning);
    g.load = Math.min(1, g.load + (dt * speed) / reload);
    if (g.load < 1) return;
    const from = this.muzzle(b, g);
    const face = this.gunFacing(b, g);
    let target: Lee | null = null;
    let at: Vec | null = null;
    let bestD = Infinity;
    for (const l of this.allLees()) {
      if (!l.alive || l.swing || l.side === b.side || l.deck.side === b.side || this.isSinking(l.deck)) continue;
      const p = toWorld(l.pos, l.deck.motion, l.deck.motion.heading);
      if (!inArc(from, face, p, spec.arcHalf, spec.minRange, spec.range)) continue;
      const d = dist(from, p);
      if (d < bestD - 1e-9 || (Math.abs(d - bestD) <= 1e-9 && target && l.id < target.id)) {
        bestD = d;
        target = l;
        at = p;
      }
    }
    if (!target || !at) return; // stays spun up, ready
    g.load = 0;
    g.lastFired = this.time;
    const accuracy = Math.max(0.05, leeStat(gunner, 'accuracy', b, this.tuning));
    const off = this.rng.inDisk((spec.spread + spec.spreadPerMeter * bestD) / accuracy);
    const to = { x: at.x + off.x, y: at.y + off.y };
    const hit = dist(to, at) <= Math.max(0, this.tuning.guns.hitRadius);
    const st = this.stats[b.side];
    st.gatlingShots++;
    gunner.stats.gatlingShots++;
    if (hit) {
      const dmg = spec.crewDamage * Math.max(0, leeStat(target, 'impactTaken', target.boat, this.tuning));
      st.gatlingHits++;
      st.gatlingDealt += dmg;
      gunner.stats.gatlingHits++;
      gunner.stats.leeDamage += dmg;
      const killed = hurtLee(target, dmg, this.time, 'gatling');
      this.events.push({ type: 'leeHurt', boatId: target.deck.id, leeId: target.id, damage: dmg });
      if (killed) {
        this.noteLost(target);
        updateMobility(target.boat, this.tuning);
      }
    } else if (spec.damage > 0) {
      const part = partAt(target.deck, to, 0);
      if (part) {
        const dealt = applyDamage(part, spec.damage).dealt;
        st.damageDealt += dealt;
        this.stats[target.deck.side].damageTaken += dealt;
      }
    }
    this.events.push({ type: 'gatling', boatId: b.id, cannon: b.guns.indexOf(g), from, to, hit, side: b.side });
  }

  /** Enemy shots currently in the air (a burst of pellets counts once). */
  incomingShells(): number {
    const groups = new Set<number>();
    for (const s of this.shells) if (s.ownerSide !== 'player') groups.add(s.group);
    return groups.size;
  }

  private stepGuns(b: Boat, dt: number): void {
    const cap = Math.round(this.tuning.fights.maxIncomingShells);
    // Sandbox assist: bigger packs reload slower per ship.
    const pack = b.side !== 'player' && this.assists ? Math.pow(this.enemies.length, Math.max(0, this.tuning.fights.packReloadScaling)) : 1;
    b.guns.forEach((g, i) => {
      if (!gunOnline(b, g, this.tuning)) return;
      const gunner = this.gunnerOf(b, g);
      if (!gunner) return;
      const spec = gunSpec(b, g, this.tuning);
      const reload = spec.reload * pack;
      const speed = leeStat(gunner, 'loadSpeed', b, this.tuning) * wetFactor(gunner, b, this.tuning);
      if (g.mode === 'stream') {
        this.stepStream(b, g, gunner, speed, reload, dt);
        return;
      }
      g.load = Math.min(1, g.load + (dt * speed) / reload);
      if (g.load < 1) return;
      // Threat budget: a loaded enemy gun holds fire while enough red X's are already up.
      if (b.side !== 'player' && cap > 0 && this.incomingShells() >= cap) return;
      const from = this.muzzle(b, g);
      // 1) closest boat this gun can reach, 2-4) a rolled aim at it (kept until the shot goes).
      const target = this.pickTarget(b, g, from);
      if (!target) {
        g.aim = null;
        return;
      }
      if (!g.aim || g.aim.boatId !== target.id) g.aim = this.planAim(b, target);
      const { aim, time } = this.leadAim(b, from, target, target.parts[g.aim.part], g.aim, spec.shellSpeed);
      if (!this.canHit(b, g, from, aim)) return;
      const accuracy = Math.max(0.05, leeStat(gunner, 'accuracy', b, this.tuning));
      const scatter = (spec.spread + spec.spreadPerMeter * dist(from, aim)) / accuracy;
      g.load = 0;
      g.lastFired = this.time;
      g.aim = null;
      const group = this.nextGroup++;
      const burst = g.mode === 'burst';
      const n = burst ? spec.pellets : 1;
      const G = this.tuning.guns;
      let first: Vec = aim;
      for (let k = 0; k < n; k++) {
        const off = this.rng.inDisk(Math.max(0, scatter));
        const to = { x: aim.x + off.x, y: aim.y + off.y };
        if (k === 0) first = to;
        this.shells.push({
          id: this.nextShellId++,
          group,
          ownerId: b.id,
          ownerSide: b.side,
          gun: g.item,
          mode: g.mode === 'lob' ? 'lob' : burst ? 'burst' : 'shell',
          from,
          to,
          elapsed: 0,
          flightTime: time,
          damage: spec.damage,
          crewDamage: spec.crewDamage,
          splash: burst ? 0 : Math.round(spec.splash),
          impactRadius: burst ? G.impactRadius * 0.4 : G.impactRadius,
          leeId: gunner.id,
        });
        this.stats[b.side].shellsFired++;
        gunner.stats.shellsFired++;
      }
      // Only threats to the player get a telegraph: a red X per shell (bigger for a big splash), one shaded area per burst.
      if (b.side !== 'player') {
        if (burst) this.telegraphs.add('area', aim, time, this.tuning.telegraph.lingerTime, Math.max(1.5, scatter));
        else this.telegraphs.add('shell', first, time, this.tuning.telegraph.lingerTime, spec.splash);
      }
      this.events.push({ type: 'fire', boatId: b.id, cannon: i, from, to: burst ? aim : first, gun: g.item });
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
    const friendlyFire = this.tuning.fights.friendlyFire > 0;
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
      if (s.ownerSide !== 'player' && !this.isSinking(this.player) && s.mode !== 'burst') {
        const near = this.tuning.global.dodgeRadiusHulls * this.player.layout.length;
        if (distanceToHull(this.player, s.to) <= near) this.stats.player.shellsDodged++;
      }
      return;
    }

    const G = this.tuning.guns;
    const offlineAt = this.tuning.boat.function.gunOfflineAt;
    const wasOnline = structureFraction(hitPart) > offlineAt;
    const wasWrecked = isWrecked(hitPart);
    const dmg = applyDamage(hitPart, s.damage);
    // Every hit lets water in; a hit on a part that's already wrecked punches straight through. Pellets let in less.
    const waterScale = Math.min(1, s.damage / Math.max(1e-6, G.damage));
    this.stats[hitBoat.side].waterTaken += floodPart(hitBoat, hitPart, (wasWrecked ? G.holeWater : G.hitWater) * waterScale);
    this.stats[s.ownerSide].shellsHit++;
    this.stats[s.ownerSide].damageDealt += dmg.dealt;
    const shooter = s.leeId !== null ? this.findLee(s.leeId) : null;
    if (shooter) {
      shooter.lee.stats.shellsHit++;
      shooter.lee.stats.damageDealt += dmg.dealt;
    }
    const local = toLocal(s.to, hitBoat.motion, hitBoat.motion.heading);
    const blast = { damage: s.crewDamage, splash: G.crewSplash, reach: s.splash, cause: 'cannon' as LossCause };
    for (const h of damageCrewAt(hitBoat, local, this.tuning, this.time, this.allLees(), blast)) {
      this.events.push({ type: 'leeHurt', boatId: hitBoat.id, leeId: h.lee.id, damage: h.damage });
      if (shooter && h.lee.side !== shooter.lee.side) shooter.lee.stats.leeDamage += h.damage;
      if (h.lost) this.noteLost(h.lee);
    }
    // The deck takes it too: the struck tile, and splash to the tiles around it.
    const tile = tileAt(hitBoat.grid, local, 0);
    if (tile) {
      const amount = s.damage * Math.max(0, this.tuning.tiles.hitScale);
      for (const [ti, steps] of tilesWithin(hitBoat, tile, Math.max(s.mode === 'burst' ? 0 : 1, s.splash))) {
        this.damageTile(hitBoat, ti, steps === 0 ? amount : amount * Math.max(0, this.tuning.tiles.splash));
      }
    }
    this.stats[hitBoat.side].damageTaken += dmg.dealt;
    this.events.push({ type: 'hit', boatId: hitBoat.id, part: hitPart.index, pos: s.to, damage: dmg.dealt });
    if (wasOnline && structureFraction(hitPart) <= offlineAt && hitBoat.guns.some((g) => g.partIndex === hitPart!.index)) {
      this.events.push({ type: 'offline', boatId: hitBoat.id, part: hitPart.index });
    }
    if (!wasWrecked && isWrecked(hitPart)) this.events.push({ type: 'wrecked', boatId: hitBoat.id, part: hitPart.index });
  }

  // ------------------------------------------------------------ tiles

  /**
   * Damage a tile. At zero it blows out: its fixture (and rail item) is
   * destroyed for the rest of the fight, whoever stands there takes a heavy
   * hit, and a volatile fixture explodes, damaging the tiles, parts and Lees
   * around it. Explosions can chain.
   */
  damageTile(boat: Boat, index: number, amount: number): void {
    const queue: number[] = [];
    const hit = (i: number, a: number) => {
      const tile = boat.grid.tiles[i];
      if (!tile || tile.blown || a <= 0) return;
      tile.hp = Math.max(0, tile.hp - a);
      if (tile.hp > 0) return;
      tile.blown = true;
      const pos = toWorld(tile.center, boat.motion, boat.motion.heading);
      this.stats[boat.side].tilesBlown++;
      this.events.push({ type: 'blowout', boatId: boat.id, tile: i, pos });
      const volatile = tile.fixture && !tile.fixture.destroyed && ITEMS[tile.fixture.item]?.volatile ? tile.fixture.item : null;
      if (tile.fixture) tile.fixture.destroyed = true;
      for (const r of tile.rails) r.destroyed = true;
      tile.station = tile.fixture ? tile.station : null;
      const lee = this.tuning.tiles.blowoutLeeDamage;
      this.hurtOnTiles(boat, new Map([[i, 0]]), lee, 'cannon');
      if (volatile) queue.push(i);
      updateMobility(boat, this.tuning);
      boat.crew.thinkIn = 0;
    };
    hit(index, amount);
    // Volatile parts go up one after another (breadth first), so chains are deterministic.
    const E = this.tuning.explosion;
    for (let q = 0; q < queue.length && q < 64; q++) {
      const at = boat.grid.tiles[queue[q]];
      const blast = Math.max(0, itemParam(this.tuning, at.fixture!.item, 'blast') || 1);
      const pos = toWorld(at.center, boat.motion, boat.motion.heading);
      this.stats[boat.side].explosions++;
      this.events.push({ type: 'explosion', boatId: boat.id, tile: at.index, pos });
      const reach = tilesWithin(boat, at, Math.max(0, Math.round(E.radius)));
      const parts = new Set<number>();
      for (const ti of reach.keys()) parts.add(boat.grid.tiles[ti].part);
      for (const pi of parts) {
        const part = boat.parts[pi];
        const dealt = applyDamage(part, E.partDamage * blast).dealt;
        this.stats[boat.side].damageTaken += dealt;
        this.stats[boat.side].waterTaken += floodPart(boat, part, E.water * blast);
        this.events.push({ type: 'hit', boatId: boat.id, part: pi, pos, damage: dealt });
      }
      this.hurtOnTiles(boat, reach, E.leeDamage * blast, 'explosion');
      for (const ti of reach.keys()) if (ti !== at.index) hit(ti, E.tileDamage * blast);
    }
  }

  /** Hurt every Lee standing on these tiles (× their impact damage taken). */
  private hurtOnTiles(boat: Boat, tiles: Map<number, number>, damage: number, cause: LossCause): void {
    if (damage <= 0) return;
    for (const l of this.allLees()) {
      if (!l.alive || l.swing || l.deck !== boat) continue;
      const on = tileAt(boat.grid, l.pos, 1) ?? boat.grid.tiles[l.tile];
      if (!tiles.has(on.index)) continue;
      const dmg = damage * Math.max(0, leeStat(l, 'impactTaken', l.boat, this.tuning));
      const killed = hurtLee(l, dmg, this.time, cause);
      this.events.push({ type: 'leeHurt', boatId: boat.id, leeId: l.id, damage: dmg });
      if (killed) this.noteLost(l);
    }
  }

  // ------------------------------------------------------------ spikes

  /** Boats touching along a spiked edge: the other boat's part beside the spikes takes slow damage. */
  private stepSpikes(dt: number): void {
    const touch = Math.max(0, this.tuning.attach.touchGap);
    for (const c of this.contacts.contacts) {
      if (c.gap > touch) continue;
      for (const [boat, other] of [[c.a, c.b], [c.b, c.a]] as const) {
        if (this.isSinking(other)) continue;
        for (const r of spikesOn(boat, sideFacing(boat, other.motion))) {
          const tile = boat.grid.tiles.find((x) => x.rails.includes(r));
          if (!tile) continue;
          const w = toWorld(tile.center, boat.motion, boat.motion.heading);
          let best: PartState | null = null;
          let bestD = Infinity;
          for (const p of other.parts) {
            const d = dist(w, toWorld(p.center, other.motion, other.motion.heading));
            if (d < bestD) {
              bestD = d;
              best = p;
            }
          }
          if (!best) continue;
          const dealt = applyDamage(best, Math.max(0, itemParam(this.tuning, r.item, 'attachedDps')) * dt).dealt;
          this.stats[boat.side].damageDealt += dealt;
          this.stats[other.side].damageTaken += dealt;
        }
      }
    }
  }

  /** Once a sinking boat is under, anyone from the other side still standing on it goes down with it. */
  private stepSunkDecks(): void {
    for (const deck of this.boats) {
      if (deck.sinkingSince === null || this.sinkAnim(deck) < 1) continue;
      for (const l of this.allLees()) {
        if (!l.alive || l.swing || l.deck !== deck || l.side === deck.side) continue;
        if (this.result?.winner === l.side) continue; // the winners climbed home already
        loseLee(l, this.time, 'sank');
        this.noteLost(l);
      }
    }
  }

  // ------------------------------------------------------------ end of fight

  private checkSinking(): void {
    const crossing = this.boats
      .filter((b) => !this.isSinking(b) && sinkProgress(b, this.tuning) >= 1)
      // Same-step tie: whoever is further past the line went first.
      .sort((a, b) => sinkProgress(b, this.tuning) - sinkProgress(a, this.tuning));
    let decided: { winner: Side; how: Result['how'] } | null = null;
    for (const b of crossing) {
      b.sinkingSince = this.time;
      b.target = null;
      this.events.push({ type: 'sinking', boatId: b.id });
      // Boarders on it swing home while it goes down (if home is in reach).
      for (const o of this.boats) o.crew.thinkIn = 0;
      // Its own boarders elsewhere are lost with it.
      for (const l of b.crew.lees) {
        if (!l.alive || (l.deck === b && !l.swing)) continue;
        loseLee(l, this.time, 'sank');
        this.noteLost(l);
      }
      if (this.result || decided) continue;
      // You lose when you sink; you win when the last enemy is out. First decisive sinking wins.
      if (b.side === 'player') decided = { winner: 'enemy', how: 'sunk' };
      else if (this.liveEnemies().length === 0) decided = { winner: 'player', how: 'sunk' };
    }
    this.checkCrews();
    if (!this.result && !decided) {
      // A boat whose whole crew is dead is out too: lose yours and you lose; clear theirs and you win.
      if (isDerelict(this.player)) decided = { winner: 'enemy', how: 'crew' };
      else if (this.liveEnemies().length === 0) decided = { winner: 'player', how: 'crew' };
    }
    if (decided && !this.result) this.decide(decided.winner, decided.how);
    if (this.result && this.resultAt !== null && this.time >= this.resultAt) this.phase = 'over';
  }

  /** Boats that just lost their last Lee: out of the fight, adrift. */
  private checkCrews(): void {
    for (const b of this.boats) {
      if (this.crewless.has(b) || !isDerelict(b)) continue;
      this.crewless.add(b);
      b.target = null;
      this.events.push({ type: 'crewLost', boatId: b.id });
      for (const o of this.boats) o.crew.thinkIn = 0;
    }
  }

  private decide(winner: Side, how: Result['how']): void {
    this.result = { winner, loser: winner === 'player' ? 'enemy' : 'player', time: this.time, how };
    const g = this.tuning.global;
    this.resultAt = this.time + (how === 'sunk' ? g.sinkDuration : 1) + g.resultDelay;
    if (winner === 'player') {
      // You won: shells still in the air at you fall harmlessly short.
      for (let i = this.shells.length - 1; i >= 0; i--) if (this.shells[i].ownerSide !== 'player') this.shells.splice(i, 1);
      this.telegraphs.list.length = 0;
    }
    // The crews stand down; the winners' boarders climb back aboard their own boat.
    for (const l of this.allLees()) {
      if (!l.alive || l.side !== winner || (l.deck === l.boat && !l.swing)) continue;
      l.swing = null;
      l.engaged = false;
      l.deck = l.boat;
      l.tile = l.home;
      l.dest = l.home;
      l.path = [];
      l.pos = { ...l.boat.grid.tiles[l.home].center };
      l.reason = 'climbed home after the win';
    }
  }
}

/** Every Lee stat × v (the playerCrewStats assist). */
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function allStats(v: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of Object.keys(LEE_DEFS.basic.stats)) if (k !== 'impactTaken' && k !== 'pistolTaken') out[k] = v;
  return out;
}
