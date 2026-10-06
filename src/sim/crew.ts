// Crew: Lees on a deck grid, the tasks they can do, and the one crew AI that
// runs every boat's crew (yours and the enemy's) with the same rules.
//
// Every Lee has a JOB, one of the four action buttons: ⏩ sail (oars, sails),
// 🔫 fire (hull guns, the lookout, the powder store; anti-crew guns when no ⚔️
// Lee is on them), ⚔️ board (fight boarders on our deck, cross to the target,
// gather on the side facing it, man anti-crew guns on that side) and 🛠️ fix
// (repairs, bailing, the pump). The player (or the enemy AI) only moves Lees
// between jobs; each Lee picks which tile to work, live.
//
// How a Lee chooses (no randomness anywhere):
//  1. Every task on the boat has a need: a ladder tier (tuning.ladder) plus a
//     severity bonus, and the job it belongs to. Guns are judged per Lee: "will
//     the enemy be in this gun's arc when I get there, or within arcLookahead after?"
//  2. Pass 1: each Lee scores the useful work of its own job: need − walking
//     time × walkPenalty (urgent tasks), + stat affinity, − helpPenalty per Lee
//     already on a repair/bail job. Stations are exclusive: one Lee each.
//  3. Pass 2: anyone left (its station can't be used, or every seat of its job
//     is taken) falls back: fix something, bail, go after boarders (melee-
//     focused Lees charge; the others shoot from where they stand), then stand
//     ready at a station of its own job. Lees never just stand there while
//     there's something to do. Pistols fire on their own, whatever the task.
//  4. Stickiness: a Lee keeps its task unless something beats it by
//     `stickiness`, and holds a new one for `commitTime`. A gunner stays on a
//     gun that can't bear for `jobs.gunStick` seconds before it looks elsewhere,
//     so turning the boat doesn't send the gun crew running back and forth.
//  5. Options are assigned greedily, best first. Ties break by: score, then
//     ladder tier, then walking time, then Lee id, then task order.
//  6. Close combat: a Lee sharing a tile with an opposing Lee is engaged and
//     fights until the tile is clear (forced, no decision). Wounded Lees fall
//     back. Only ⚔️ Lees cross to an enemy deck, and only while it's within
//     boarding range; once across they follow the boarder rules.

import type { StationKind } from '../config/items';
import {
  jobSkill,
  LEE_STAT_KEYS,
  meleeFocused,
  STAT_LABELS,
  WORK_STAT,
  type ActivityKind,
  type Job,
  type LeeDef,
  type LeeStatKey,
  type LeeStats,
  type WorkKind,
} from '../config/lees';
import { shipName } from '../config/ships';
import { FACING_ANGLE } from '../config/slots';
import type { LadderTier, Side, Tuning } from '../config/tuning';
import { gunOnline, gunSpec, isWrecked, keelSegment, partHasGuns, sinkProgress, structure, structureFraction, type Boat, type GunState } from './boat';
import { inReach, sideFacing } from './contact';
import { pathTo, tileAt, type RailState, type Tile } from './grid';
import { itemParam, type StatMods } from './loadout';
import { closestOnSegment, dist, toLocal, toWorld, wrapAngle, type Vec } from './math';

export type TaskType = 'station' | 'repair' | 'bail' | 'idle' | 'board' | 'repel' | 'stage';

export interface Task {
  type: TaskType;
  /** Station: tile index. Repair/bail: part index. Board: boat id. Repel: the boarder's Lee id. Stage: boat id. Idle: -1. */
  target: number;
}

/** How a Lee was lost (result screen). */
export type LossCause = 'cannon' | 'gatling' | 'melee' | 'pistol' | 'sank' | 'spikes' | 'explosion';

/** A Lee in the air between two decks. */
export interface Swing {
  from: Boat;
  to: Boat;
  /** Where it left from, in `from`'s frame. */
  fromLocal: Vec;
  /** Tile it lands on, on `to`. */
  toTile: number;
  t: number;
  dur: number;
  /** Swinging home (recall) rather than boarding. */
  back: boolean;
  why: string;
}

export interface LeeRunStats {
  shellsFired: number;
  shellsHit: number;
  damageDealt: number;
  hpRepaired: number;
  waterBailed: number;
  time: Record<ActivityKind, number>;
  awayFromHome: number;
  switches: number;
  /** Swings across to an enemy deck. */
  boardings: number;
  /** Seconds standing on an enemy deck. */
  onEnemyDeck: number;
  meleeKills: number;
  meleeDealt: number;
  meleeTaken: number;
  pistolShots: number;
  pistolHits: number;
  pistolDealt: number;
  gatlingShots: number;
  gatlingHits: number;
  /** Damage dealt to enemy Lees by any means (for XP). */
  leeDamage: number;
}

/** A scored option, kept for the debug overlay. */
export interface OptionInfo {
  label: string;
  score: number;
}

export interface Lee {
  /** Unique in the world. Also the final tie-breaker. */
  id: number;
  /** 1-based number within its crew (for display). */
  number: number;
  /** Persistent identity across a run (crew member uid), or 0. */
  uid: number;
  /** Display name ("Quick Lee #2"). */
  label: string;
  level: number;
  def: LeeDef;
  /** Static stat multipliers: level bonuses, trinkets, crew-wide treasures, assists. */
  mods: StatMods;
  /** Boarding planks: bonuses while aboard an enemy deck, and whether it can be shot mid-swing. */
  boardBuff: { pistolDamage: number; exposed: boolean } | null;
  /** Allegiance (not necessarily the boat it stands on). */
  side: Side;
  /** Its own boat (tasks, crew list). */
  boat: Boat;
  /** The deck it stands on right now (its own boat, or one it boarded). */
  deck: Boat;
  /** Starting tile (where it was placed in refit). */
  home: number;
  /** Its job: which action button it's under. */
  job: Job;
  /** The job before the last change, when it changed, and roughly how long the walk takes (pips slide over it). */
  jobFrom: Job;
  jobSince: number;
  jobEta: number;
  /** World time its current station stopped being useful (gun stickiness), or null. */
  stuckSince: number | null;
  /** Last tile it reached (on `deck`). */
  tile: number;
  /** Position in the deck's local frame, m. */
  pos: Vec;
  /** Tiles still to walk through. */
  path: number[];
  task: Task;
  /** Tile the task is worked from. */
  dest: number;
  /** World time the current task started. */
  taskSince: number;
  /** At its destination and doing the task. */
  working: boolean;
  /** 0..1 progress of the current action (gun load, or a work cycle). */
  progress: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  lostAt: number | null;
  lostCause: LossCause | null;
  hurtAt: number;
  /** In the air between decks, or null. */
  swing: Swing | null;
  /** Sharing a tile with an opposing Lee: fighting, nothing else. */
  engaged: boolean;
  /** Wounded (below boarding.retreatAt) with enemies around: falling back, shooting instead of fighting. */
  retreating: boolean;
  /** Opposing Lee it is hitting (debug). */
  meleeTarget: number | null;
  /** Seconds until the next sword hit / pistol shot is ready (scaled by rate). */
  meleeCd: number;
  pistolCd: number;
  /** World time it last fired its pistol (icon and tracer). */
  firedAt: number;
  /** One-line "why am I doing this". */
  reason: string;
  /** Why it last swung across to board (kept while it's over there, for "why did that Lee go?"). */
  whyBoarded: string;
  /** Score of its current task at the last decision. */
  score: number;
  /** Best few options at the last decision (debug). */
  options: OptionInfo[];
  stats: LeeRunStats;
}

/** A task with need on this boat right now. */
export interface Need {
  key: string;
  task: Task;
  tier: LadderTier;
  /** Need points before per-Lee adjustments. */
  base: number;
  label: string;
  why: string;
  /** The job whose own work this is. */
  job: Job;
  /** Doing it achieves something right now (guns are judged per Lee). */
  useful: boolean;
  /** Gun stations: the gun (engagement is judged per Lee). */
  cannon?: GunState;
}

export interface CrewState {
  lees: Lee[];
  /** World time the next Lee may swing across (one at a time over the rail). */
  nextSwingAt?: number;
  /** Needs at the last decision (debug). */
  needs: Need[];
  /** Seconds until the next decision. */
  thinkIn: number;
}

export interface CrewContext {
  tuning: Tuning;
  time: number;
  /** Boats this crew's guns may shoot at. */
  foes: Boat[];
  /** Every Lee in the world (boarders on our deck, enemies on other decks). Defaults to this boat's crew. */
  lees?: Lee[];
  /** Where this crew's ⚔️ Lees are headed: the boat they gather toward and board (null = none). */
  boardTarget?: Boat | null;
  /** This boat is pulling out (RETREAT): its boarders come home and nobody new crosses. */
  retreating?: boolean;
}

const TYPE_ORDER: Record<TaskType, number> = { station: 0, repair: 1, bail: 2, repel: 3, board: 4, stage: 5, idle: 6 };
export const STATION_WORK: Record<StationKind, WorkKind> = { gun: 'gun', oars: 'row', sails: 'sail', lookout: 'lookout', pump: 'pump', powder: 'powder' };
/** The job whose own work a station is. */
export const STATION_JOB: Record<StationKind, Job> = { gun: 'fire', oars: 'sail', sails: 'sail', lookout: 'fire', pump: 'fix', powder: 'fire' };
export const ROLE_NAMES: Record<WorkKind | 'damage', string> = {
  gun: 'Gunner',
  row: 'Rower',
  sail: 'Sail hand',
  lookout: 'Lookout',
  pump: 'Pump hand',
  powder: 'Powder monkey',
  repair: 'Damage control',
  bail: 'Damage control',
  board: 'Boarder',
  repel: 'Defender',
  damage: 'Damage control',
};

export const taskKey = (t: Task): string => `${t.type}:${t.target}`;
const IDLE: Task = { type: 'idle', target: -1 };

// ------------------------------------------------------------ creation

const emptyRunStats = (): LeeRunStats => ({
  shellsFired: 0,
  shellsHit: 0,
  damageDealt: 0,
  hpRepaired: 0,
  waterBailed: 0,
  time: { gun: 0, row: 0, sail: 0, lookout: 0, pump: 0, powder: 0, repair: 0, bail: 0, board: 0, repel: 0, melee: 0, swing: 0, walk: 0, idle: 0 },
  awayFromHome: 0,
  switches: 0,
  boardings: 0,
  onEnemyDeck: 0,
  meleeKills: 0,
  meleeDealt: 0,
  meleeTaken: 0,
  pistolShots: 0,
  pistolHits: 0,
  pistolDealt: 0,
  gatlingShots: 0,
  gatlingHits: 0,
  leeDamage: 0,
});

/** Base stat for a Lee type from tuning (live), falling back to its content stats. */
export function typeStat(def: LeeDef, key: LeeStatKey, t: Tuning): number {
  return t.lees[def.id]?.[key] ?? def.stats[key] ?? 1;
}

/** A Lee's stat before where it stands and who's next to it: type × its own mods (what cards show). */
export function baseStat(def: LeeDef, key: LeeStatKey, t: Tuning, mods: StatMods = {}): number {
  return typeStat(def, key, t) * (mods[key] ?? 1);
}

/** Speed or turn multiplier from manned stations: the baseline plus each manned station's boost, capped. */
export function mobilityFactor(baseline: number, boost: number, t: Tuning): number {
  const b = Math.min(1, Math.max(0, baseline));
  return Math.min(Math.max(1, t.crew.mobilityCap), b + Math.max(0, boost));
}

/** The job a tile starts a Lee in: its station's job, or fix on plain deck. */
export function startingJob(boat: Boat, tile: number): Job {
  const s = boat.grid.tiles[tile]?.station;
  return s ? STATION_JOB[s] : 'fix';
}

/** Who a Lee is beyond its type: run identity, level, static modifiers and (optionally) a starting job. */
export interface LeeExtra {
  uid?: number;
  label?: string;
  level?: number;
  mods?: StatMods;
  job?: Job;
}

export function createLee(id: number, number: number, def: LeeDef, side: Side, boat: Boat, home: number, t: Tuning, extra: LeeExtra = {}): Lee {
  const tile = boat.grid.tiles[home];
  const mods = extra.mods ?? {};
  const maxHp = Math.max(1, t.crew.hp * baseStat(def, 'hp', t, mods));
  const task: Task = tile.station ? { type: 'station', target: home } : IDLE;
  const job = extra.job ?? startingJob(boat, home);
  return {
    id,
    number,
    uid: extra.uid ?? 0,
    label: extra.label ?? `${def.name} #${number}`,
    level: Math.max(1, extra.level ?? 1),
    def,
    mods,
    boardBuff: null,
    side,
    boat,
    deck: boat,
    home,
    job,
    jobFrom: job,
    jobSince: -Infinity,
    jobEta: 0,
    stuckSince: null,
    tile: home,
    pos: { ...tile.center },
    path: [],
    task,
    dest: home,
    taskSince: -Infinity,
    working: true,
    progress: 0,
    hp: maxHp,
    maxHp,
    alive: true,
    lostAt: null,
    lostCause: null,
    hurtAt: -99,
    swing: null,
    engaged: false,
    retreating: false,
    meleeTarget: null,
    meleeCd: 0.5,
    pistolCd: 0.5 + (id % 7) * 0.13,
    firedAt: -99,
    reason: `starting job: ${job}`,
    whyBoarded: '',
    score: 0,
    options: [],
    stats: emptyRunStats(),
  };
}

/** Role a tile gives the Lee placed on it. */
export function roleName(boat: Boat, tile: number): string {
  const s = boat.grid.tiles[tile]?.station;
  return s ? ROLE_NAMES[STATION_WORK[s]] : ROLE_NAMES.damage;
}

export function workKind(boat: Boat, task: Task): WorkKind | null {
  switch (task.type) {
    case 'station': {
      const s = boat.grid.tiles[task.target]?.station;
      return s ? STATION_WORK[s] : null;
    }
    case 'repair':
      return 'repair';
    case 'bail':
      return 'bail';
    case 'board':
    case 'stage':
      return 'board';
    case 'repel':
      return 'repel';
    default:
      return null;
  }
}

/** What a Lee is doing right now, for icons and stats. */
export function activity(lee: Lee, _boat?: Boat): ActivityKind {
  if (lee.swing) return 'swing';
  if (lee.engaged) return 'melee';
  if (lee.deck !== lee.boat) return 'board';
  const deck = lee.deck;
  if (!lee.working) return lee.path.length || dist(lee.pos, deck.grid.tiles[lee.dest]?.center ?? lee.pos) > 0.05 ? 'walk' : 'idle';
  return workKind(deck, lee.task) ?? 'idle';
}

/** Is this Lee standing on an enemy deck (boarding)? */
export const isAboardEnemy = (lee: Lee): boolean => lee.deck !== lee.boat;

// ------------------------------------------------------------ stats

/** Does a passive ability touch this stat? Returns its (tuned) multiplier, or 1. */
function abilityMul(def: LeeDef, a: LeeDef['abilities'][number], key: LeeStatKey, t: Tuning): number {
  if (a.trigger !== 'passive') return 1;
  if (a.stat !== key && !a.stats?.includes(key)) return 1;
  return a.id ? t.traits[def.id]?.[a.id] ?? a.multiply : a.multiply;
}

/**
 * A Lee's effective stat: type × its own mods (levels, trinkets, treasures) ×
 * its passive abilities × its neighbors' × whatever its tile does to whoever
 * stands there (floor upgrades) × a gun shield it's working behind × boarding
 * plank bonuses while aboard an enemy.
 */
export function leeStat(lee: Lee, key: LeeStatKey, _boat: Boat, t: Tuning): number {
  let v = baseStat(lee.def, key, t, lee.mods);
  for (const a of lee.def.abilities) if (a.target === 'self') v *= abilityMul(lee.def, a, key, t);
  if (lee.swing) return v;
  const here = lee.deck.grid.tiles[lee.tile];
  if (!here) return v;
  for (const other of lee.boat.crew.lees) {
    if (other === lee || !other.alive || other.deck !== lee.deck || other.swing || !here.neighbors.includes(other.tile)) continue;
    for (const a of other.def.abilities) if (a.target === 'orthogonalNeighbors') v *= abilityMul(other.def, a, key, t);
  }
  v *= lee.deck.mods.occupant[here.index]?.[key] ?? 1;
  if (key === 'impactTaken' && lee.working && lee.deck === lee.boat && lee.task.type === 'station') {
    const g = lee.boat.guns.find((x) => x.station === lee.task.target);
    if (g) v *= g.mods.gunnerImpact;
  }
  if (key === 'pistolDamage' && lee.boardBuff && lee.deck !== lee.boat) v *= lee.boardBuff.pistolDamage;
  return v;
}

export function leeStats(lee: Lee, boat: Boat, t: Tuning): LeeStats {
  return Object.fromEntries(LEE_STAT_KEYS.map((k) => [k, leeStat(lee, k, boat, t)])) as LeeStats;
}

/** How good this Lee is at a job (type × its own mods: levels, trinkets). */
export function leeJobSkill(lee: Lee, job: Job, t: Tuning): number {
  return jobSkill(job, (k) => baseStat(lee.def, k, t, lee.mods));
}

/** Charges boarders (true) or shoots them from a tile away (false)? */
export function isMeleeFocused(lee: Lee, t: Tuning): boolean {
  return meleeFocused((k) => baseStat(lee.def, k, t, lee.mods));
}

/** Work/walk multiplier from standing in water. */
export function wetFactor(lee: Lee, boat: Boat, t: Tuning): number {
  return isWet(lee, boat, t) ? 1 - Math.min(1, Math.max(0, t.crew.wetSlowdown)) : 1;
}

export function isWet(lee: Lee, _boat: Boat, t: Tuning): boolean {
  if (lee.swing) return false;
  const deck = lee.deck;
  const tile = tileAt(deck.grid, lee.pos, 1) ?? deck.grid.tiles[lee.tile];
  const part = deck.parts[tile.part];
  return part.capacity > 0 && part.water / part.capacity >= t.crew.wetThreshold;
}

// ------------------------------------------------------------ queries

export function liveLees(boat: Boat): Lee[] {
  return boat.crew.lees.filter((l) => l.alive);
}

/** The Lee working a station right now, if any. */
export function workerAt(boat: Boat, tile: number): Lee | null {
  for (const l of boat.crew.lees) {
    if (l.alive && l.working && !l.engaged && l.deck === boat && l.task.type === 'station' && l.task.target === tile) return l;
  }
  return null;
}

/** Living Lees standing (not swinging) on a deck, either side. */
export function leesOn(deck: Boat, lees: Lee[]): Lee[] {
  return lees.filter((l) => l.alive && !l.swing && l.deck === deck);
}

/** Living Lees of `side`'s opponents standing on a deck. */
export function foesOn(deck: Boat, side: Side, lees: Lee[]): Lee[] {
  return lees.filter((l) => l.alive && !l.swing && l.deck === deck && l.side !== side);
}

/** The tile a Lee is standing on (by position, falling back to its last tile). */
export function standingTile(lee: Lee): number {
  return (tileAt(lee.deck.grid, lee.pos, 1) ?? lee.deck.grid.tiles[lee.tile]).index;
}

/** The tile of `from` closest to `target`'s hull: where a Lee swings across from. Ties by tile index. */
export function departureTile(from: Boat, target: Boat): number {
  const [s0, s1] = keelSegment(target);
  let best = 0;
  let bestD = Infinity;
  for (const tile of from.grid.tiles) {
    const w = toWorld(tile.center, from.motion, from.motion.heading);
    const d = dist(w, closestOnSegment(w, s0, s1));
    if (d < bestD - 1e-9) {
      bestD = d;
      best = tile.index;
    }
  }
  return best;
}

/** A tile with intact boarding planks about as close to `target` as the nearest tile, with room, or -1. */
function boardingRail(from: Boat, target: Boat, lees: Lee[], t: Tuning, lee: Lee): number {
  const [s0, s1] = keelSegment(target);
  const d = (tile: Tile) => {
    const w = toWorld(tile.center, from.motion, from.motion.heading);
    return dist(w, closestOnSegment(w, s0, s1));
  };
  let min = Infinity;
  for (const tile of from.grid.tiles) min = Math.min(min, d(tile));
  let best = -1;
  let bestD = Infinity;
  for (const tile of from.grid.tiles) {
    if (!tile.rails.some((r) => r.kind === 'planks' && !r.destroyed)) continue;
    const dt = d(tile);
    if (dt > min + 0.5 || !hasRoom(from, tile.index, lees, t, lee)) continue;
    if (dt < bestD - 1e-9) {
      bestD = dt;
      best = tile.index;
    }
  }
  return best;
}

/** Tiles of `from` about as close to `target`'s hull as the nearest one: the rail to swing across from. */
function railTiles(from: Boat, target: Boat): number[] {
  const [s0, s1] = keelSegment(target);
  const d = from.grid.tiles.map((tile) => {
    const w = toWorld(tile.center, from.motion, from.motion.heading);
    return dist(w, closestOnSegment(w, s0, s1));
  });
  const min = Math.min(...d);
  const slack = Math.min(from.grid.tileW, from.grid.tileH) * 0.5;
  return from.grid.tiles.filter((x) => d[x.index] <= min + slack).map((x) => x.index);
}

/** The tile of `deck` nearest a world point (where a swinging Lee lands). Ties by tile index. */
export function landingTile(deck: Boat, world: Vec): number {
  const l = toLocal(world, deck.motion, deck.motion.heading);
  let best = 0;
  let bestD = Infinity;
  for (const tile of deck.grid.tiles) {
    const d = dist(l, tile.center);
    if (d < bestD - 1e-9) {
      bestD = d;
      best = tile.index;
    }
  }
  return best;
}

/** Is this Lee hurt badly enough to fall back? */
export function isWounded(lee: Lee, t: Tuning): boolean {
  return lee.hp < lee.maxHp * Math.max(0, t.boarding.retreatAt);
}

/** Lees standing on, or headed for, a tile (either side). */
export function tileLoad(deck: Boat, tile: number, lees: Lee[], except?: Lee): number {
  let n = 0;
  for (const l of lees) {
    if (l === except || !l.alive) continue;
    // A Lee in mid-swing has its landing tile reserved.
    if (l.swing) {
      if (l.swing.to === deck && l.swing.toTile === tile) n++;
      continue;
    }
    if (l.deck !== deck) continue;
    const settled = !l.path.length && l.tile === tile;
    if (settled || l.dest === tile) n++;
  }
  return n;
}

export function hasRoom(deck: Boat, tile: number, lees: Lee[], t: Tuning, except?: Lee): boolean {
  return tileLoad(deck, tile, lees, except) < Math.max(1, Math.round(t.boarding.tileCap));
}

/** The tile nearest `from` (walking distance, then index) with room for one more, or -1. */
export function nearestRoom(deck: Boat, from: number, lees: Lee[], t: Tuning, except?: Lee): number {
  let best = -1;
  let bestD = Infinity;
  for (const tile of deck.grid.tiles) {
    if (!hasRoom(deck, tile.index, lees, t, except)) continue;
    const d = deck.grid.dist[from][tile.index];
    if (d < bestD - 1e-9) {
      bestD = d;
      best = tile.index;
    }
  }
  return best;
}

/** Tiles of `deck` by distance from a world point (then index): where a swinging Lee could land. */
function tilesNear(deck: Boat, world: Vec): number[] {
  const l = toLocal(world, deck.motion, deck.motion.heading);
  return deck.grid.tiles
    .map((tile) => ({ i: tile.index, d: dist(l, tile.center) }))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .map((x) => x.i);
}

/** An intact fence on this tile between it and a point beyond its edge (local frame): it stops enemies landing there. */
export function fenceBetween(tile: Tile, local: Vec): RailState | null {
  for (const r of tile.rails) {
    if (r.kind !== 'fence' || r.destroyed) continue;
    const a = FACING_ANGLE[r.facing];
    if ((local.x - tile.center.x) * Math.cos(a) + (local.y - tile.center.y) * Math.sin(a) > 0) return r;
  }
  return null;
}

/** Tiles a Lee swinging from `world` could reach on `deck`, nearest first. */
function reachable(deck: Boat, world: Vec): number[] {
  const reach = Math.hypot(deck.grid.tileW, deck.grid.tileH) * 1.6;
  const l = toLocal(world, deck.motion, deck.motion.heading);
  const near = tilesNear(deck, world);
  const first = dist(l, deck.grid.tiles[near[0]].center);
  return near.filter((i) => dist(l, deck.grid.tiles[i].center) <= reach + first);
}

/**
 * Where a Lee swinging from `world` would land on `deck`: the nearest tile with
 * room within reach that isn't fenced off against it, or -1 (wait, or hack the fence).
 */
export function landingWithRoom(deck: Boat, world: Vec, lees: Lee[], t: Tuning, side?: Side): number {
  const l = toLocal(world, deck.motion, deck.motion.heading);
  for (const i of reachable(deck, world)) {
    if (side && side !== deck.side && fenceBetween(deck.grid.tiles[i], l)) continue;
    if (hasRoom(deck, i, lees, t)) return i;
  }
  return -1;
}

/** If every reachable tile is fenced off against a boarder swinging from `world`, the nearest such fence (to hack at). */
export function blockingFence(deck: Boat, world: Vec, _t: Tuning): RailState | null {
  const l = toLocal(world, deck.motion, deck.motion.heading);
  let first: RailState | null = null;
  for (const i of reachable(deck, world)) {
    const f = fenceBetween(deck.grid.tiles[i], l);
    if (!f) return null;
    first ??= f;
  }
  return first;
}

/** The tile on `deck` farthest (walking) from every enemy on it, with room: where a wounded Lee falls back to. */
export function safestTile(lee: Lee, foes: Lee[], lees: Lee[], t: Tuning): number {
  const deck = lee.deck;
  let best = lee.tile;
  let bestScore = -Infinity;
  for (const tile of deck.grid.tiles) {
    if (tile.index !== lee.tile && !hasRoom(deck, tile.index, lees, t, lee)) continue;
    let near = Infinity;
    for (const f of foes) near = Math.min(near, deck.grid.dist[tile.index][standingTile(f)]);
    // Far from enemies first, then not too far to walk.
    const score = near * 10 - deck.grid.dist[lee.tile][tile.index] * 0.1;
    if (score > bestScore + 1e-9) {
      bestScore = score;
      best = tile.index;
    }
  }
  return best;
}

/**
 * The boat this crew's ⚔️ Lees can cross to right now: the board target, if
 * it's within boarding range, afloat, not about to sink, has enemy crew
 * standing on it, and we aren't pulling out. Otherwise null.
 */
export function crossTarget(boat: Boat, ctx: CrewContext): Boat | null {
  const o = ctx.boardTarget;
  if (!o || ctx.retreating || o.side === boat.side || o.sinkingSince !== null) return null;
  const t = ctx.tuning;
  if (sinkProgress(o, t) >= t.boarding.evacuateAt) return null;
  if (!inReach(boat, o, t)) return null;
  return foesOn(o, boat.side, ctx.lees ?? boat.crew.lees).length ? o : null;
}

/** The Lee holding a claim on a station (working it or walking to it). */
export function claimantOf(boat: Boat, tile: number): Lee | null {
  for (const l of boat.crew.lees) {
    if (l.alive && l.task.type === 'station' && l.task.target === tile) return l;
  }
  return null;
}

/** Is a world point inside this gun's arc, between its minimum and maximum range, seen from `muzzle` facing `face`? */
export function inArc(muzzle: Vec, face: number, p: Vec, arcHalf: number, minRange: number, range: number): boolean {
  const d = dist(muzzle, p);
  if (d > range || d < minRange) return false;
  if (arcHalf >= Math.PI - 1e-6) return true;
  return Math.abs(wrapAngle(Math.atan2(p.y - muzzle.y, p.x - muzzle.x) - face)) <= arcHalf;
}

/** Does this gun have something to shoot `at` seconds from now (straight-line prediction)? */
export function gunEngages(boat: Boat, g: GunState, ctx: CrewContext, at: number): boolean {
  const m = boat.motion;
  const spec = gunSpec(boat, g, ctx.tuning);
  const h = m.heading + m.omega * at;
  const muzzle = toWorld(g.local, { x: m.x + m.vx * at, y: m.y + m.vy * at }, h);
  const face = h + g.face;
  if (g.targets === 'crew') {
    // A crew gun (gatling) has work whenever an enemy Lee on an enemy deck is in its arc and range.
    for (const l of ctx.lees ?? []) {
      if (!l.alive || l.swing || l.side === boat.side || l.deck.side === boat.side) continue;
      const d = l.deck.motion;
      const p = toWorld(l.pos, { x: d.x + d.vx * at, y: d.y + d.vy * at }, d.heading);
      if (inArc(muzzle, face, p, spec.arcHalf, spec.minRange, spec.range)) return true;
    }
    return false;
  }
  for (const f of ctx.foes) {
    const p = { x: f.motion.x + f.motion.vx * at, y: f.motion.y + f.motion.vy * at };
    if (inArc(muzzle, face, p, spec.arcHalf, spec.minRange, spec.range)) return true;
  }
  return false;
}

/** Does this gun point toward the side of `boat` that faces `target`? */
function facesToward(boat: Boat, g: GunState, target: Boat): boolean {
  const l = toLocal(target.motion, boat.motion, boat.motion.heading);
  return Math.cos(Math.atan2(l.y - g.local.y, l.x - g.local.x) - g.face) > 0;
}

// ------------------------------------------------------------ jobs

/** Seats a job has right now (working oars and sails; guns, lookout and powder for fire). Board and fix have no limit. */
export function jobSeats(boat: Boat, job: Job, t: Tuning): number {
  if (job === 'board' || job === 'fix') return Infinity;
  let n = 0;
  for (const tile of boat.grid.tiles) {
    if (!tile.station || !tile.fixture || tile.fixture.destroyed) continue;
    if (STATION_JOB[tile.station] !== job) continue;
    if (tile.station === 'gun') {
      const g = boat.guns.find((x) => x.station === tile.index);
      if (!g || !gunOnline(boat, g, t)) continue;
    }
    n++;
  }
  return n;
}

/** Living Lees of this crew in a job. */
export function jobCrew(boat: Boat, job: Job): Lee[] {
  return boat.crew.lees.filter((l) => l.alive && l.job === job);
}

/** Can one more Lee move into this job (a free seat, for sail and fire)? */
export function jobHasSeat(boat: Boat, job: Job, t: Tuning): boolean {
  return jobCrew(boat, job).length < jobSeats(boat, job, t);
}

/** Change a Lee's job (the pip slides over about as long as the walk takes). */
export function setJob(lee: Lee, job: Job, time: number, t: Tuning): void {
  if (lee.job === job) return;
  lee.jobFrom = lee.job;
  lee.job = job;
  lee.jobSince = time;
  lee.stuckSince = null;
  // Free to switch at once: the order overrides its commitment.
  lee.taskSince = -Infinity;
  lee.jobEta = jobWalk(lee, job, t);
  lee.boat.crew.thinkIn = 0;
}

/** Roughly how long a Lee walks to reach work of a job (nearest seat; a second for fix and board). */
function jobWalk(lee: Lee, job: Job, t: Tuning): number {
  const boat = lee.boat;
  if (lee.deck !== boat || lee.swing) return 1.5;
  let best = Infinity;
  for (const tile of boat.grid.tiles) {
    if (!tile.station || STATION_JOB[tile.station] !== job || tile.fixture?.destroyed) continue;
    best = Math.min(best, walkTime(lee, tile.index, boat, t));
  }
  return Number.isFinite(best) ? Math.min(best, 4) : 0.8;
}

/**
 * Best fit for an order: the Lee not already in `job` with the largest
 * (skill at the new job − skill at its current job). Ties: the shortest walk,
 * then the biggest group, then the lowest id. Returns null when the job has
 * no free seat (sail and fire) or nobody can move.
 */
export function bestFit(boat: Boat, job: Job, t: Tuning): Lee | null {
  if (!jobHasSeat(boat, job, t)) return null;
  const counts: Record<Job, number> = { sail: 0, fire: 0, board: 0, fix: 0 };
  for (const l of boat.crew.lees) if (l.alive) counts[l.job]++;
  let best: Lee | null = null;
  let bestKey: number[] = [];
  for (const l of boat.crew.lees) {
    if (!l.alive || l.job === job) continue;
    const key = [-(leeJobSkill(l, job, t) - leeJobSkill(l, l.job, t)), jobWalk(l, job, t), -counts[l.job], l.id];
    if (!best || lexLess(key, bestKey)) {
      best = l;
      bestKey = key;
    }
  }
  return best;
}

function lexLess(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i] - b[i]) > 1e-9) return a[i] < b[i];
  }
  return false;
}

/** One order: move the best-fit Lee into `job`. Returns the Lee moved, or null (full, or nobody to move). */
export function orderJob(boat: Boat, job: Job, time: number, t: Tuning): Lee | null {
  const lee = bestFit(boat, job, t);
  if (!lee) return null;
  setJob(lee, job, time, t);
  lee.reason = `ordered to ${job}`;
  return lee;
}

/** Lees per job (living), in button order. */
export function jobCounts(boat: Boat): Record<Job, number> {
  const out: Record<Job, number> = { sail: 0, fire: 0, board: 0, fix: 0 };
  for (const l of boat.crew.lees) if (l.alive) out[l.job]++;
  return out;
}


// ------------------------------------------------------------ needs

const pct = (f: number) => `${Math.round(f * 100)}%`;

/** Short name for a boat in reasons (its ship type name, or "your boat"). */
export function boatLabel(b: Boat): string {
  return b.side === 'player' ? 'your boat' : `${shipName(b.type)} #${b.id - 1}`;
}

/** Short name for a Lee in reasons. */
export function leeLabel(l: Lee): string {
  return `${l.side === 'player' ? '' : 'enemy '}#${l.number}`;
}

function claimed(boat: Boat, key: string): boolean {
  return boat.crew.lees.some((l) => l.alive && taskKey(l.task) === key);
}

/** Every task with need on this boat right now, tagged with its job. Guns get their tier per Lee. */
export function computeNeeds(boat: Boat, ctx: CrewContext): Need[] {
  const t = ctx.tuning;
  const ai = t.crewAI;
  const L = t.ladder;
  const span = L.severitySpan;
  const out: Need[] = [];
  const sink = sinkProgress(boat, t);
  const offlineAt = t.boat.function.gunOfflineAt;
  let maxFill = 0;
  for (const p of boat.parts) maxFill = Math.max(maxFill, p.capacity > 0 ? p.water / p.capacity : 0);
  const spotting = ctx.foes.length > 0;
  const stopped = boat.stopped;

  // Stations, in tile order.
  for (const tile of boat.grid.tiles) {
    if (!tile.station || tile.fixture?.destroyed) continue;
    const part = boat.parts[tile.part];
    if (isWrecked(part)) continue;
    const task: Task = { type: 'station', target: tile.index };
    const key = taskKey(task);
    const job = STATION_JOB[tile.station];
    const need = (tier: LadderTier, base: number, why: string, useful: boolean, extra: Partial<Need> = {}): void => {
      out.push({ key, task, tier, base, label: tile.label, why, job, useful, ...extra });
    };
    if (tile.station === 'gun') {
      const gun = boat.guns.find((c) => c.station === tile.index);
      if (!gun || !gunOnline(boat, gun, t)) continue;
      need('idleCannon', L.idleCannon, 'no target', false, { cannon: gun });
    } else if (tile.station === 'lookout') {
      if (spotting) need('lookout', L.lookout + span * 0.5, 'lookout empty', true);
      else need('idleCannon', L.idleCannon, 'nothing to spot', false);
    } else if (tile.station === 'powder') {
      if (spotting && boat.guns.some((g) => g.targets === 'hull')) need('lookout', L.lookout + span * 0.4, 'powder store empty', true);
      else need('idleCannon', L.idleCannon, 'no guns to feed', false);
    } else if (tile.station === 'pump') {
      if (sink >= ai.floodSinkAt || maxFill >= ai.floodPartAt) need('flooding', L.flooding + span * Math.min(1, maxFill), `pump: water ${pct(maxFill)}`, true);
      else if (maxFill >= ai.moderateWaterAt || (maxFill > ai.bailStopAt && claimed(boat, key))) need('otherDamage', L.otherDamage + span * maxFill, `pump: water ${pct(maxFill)}`, true);
      else need('idleCannon', L.idleCannon, 'dry: nothing to pump', false);
    } else if (stopped) {
      need('idleCannon', L.idleCannon, `stopped: ${tile.station} do nothing`, false);
    } else {
      // Oars slightly ahead of sails: speed is the bigger loss.
      const sev = tile.station === 'oars' ? 0.6 : 0.4;
      need('mobility', L.mobility + span * sev, `${tile.station} empty`, true);
    }
  }

  // Enemy Lees on our deck: ⚔️ Lees (and idle melee Lees) go fight them, the weakest first.
  const lees = ctx.lees ?? boat.crew.lees;
  for (const e of foesOn(boat, boat.side, lees).sort((a, b) => a.id - b.id)) {
    const task: Task = { type: 'repel', target: e.id };
    const hurt = 1 - e.hp / Math.max(1, e.maxHp);
    out.push({ key: taskKey(task), task, tier: 'repelBoarders', base: L.repelBoarders + span * (0.5 + 0.5 * hurt), label: `Repel ${leeLabel(e)}`, why: `boarder on deck at ${boat.grid.tiles[standingTile(e)].label}`, job: 'board', useful: true });
  }

  // The board target: cross if it's in reach, otherwise gather on the side facing it.
  const target = ctx.boardTarget;
  if (target && target.sinkingSince === null && !ctx.retreating) {
    const cross = crossTarget(boat, ctx);
    if (cross) {
      const task: Task = { type: 'board', target: cross.id };
      out.push({ key: taskKey(task), task, tier: 'board', base: L.board, label: `Board ${boatLabel(cross)}`, why: 'in reach → swing across', job: 'board', useful: true });
    } else {
      const task: Task = { type: 'stage', target: target.id };
      out.push({ key: taskKey(task), task, tier: 'board', base: L.board - span * 0.5, label: `Gather facing ${boatLabel(target)}`, why: 'boarding party: wait at the rail', job: 'board', useful: true });
    }
  }

  boat.parts.forEach((part, i) => {
    // Repair: anything below the patch ceiling that isn't (unrepairably) wrecked.
    const f = structureFraction(part);
    const ceil = Math.min(1, Math.max(0, t.crew.repairCeiling));
    if (f < ceil - 1e-6 && (f > 0 || t.crew.wreckedRepairable > 0)) {
      const offline = partHasGuns(boat, i) && f <= offlineAt;
      const gating = offline || part.def.role === 'engine';
      const tier: LadderTier = gating ? 'functionDamage' : 'otherDamage';
      const why = offline ? `guns offline, HP ${pct(f)}` : part.def.role === 'engine' ? `engine HP ${pct(f)}` : `HP ${pct(f)}`;
      const task: Task = { type: 'repair', target: i };
      out.push({ key: taskKey(task), task, tier, base: L[tier] + span * (1 - f / Math.max(ceil, 1e-6)), label: `Repair ${part.def.label}`, why, job: 'fix', useful: true });
    }
    // Bail: emergencies first; moderate water otherwise (keep going once started).
    const fill = part.capacity > 0 ? part.water / part.capacity : 0;
    const task: Task = { type: 'bail', target: i };
    const key = taskKey(task);
    let tier: LadderTier | null = null;
    let why = `water ${pct(fill)}`;
    if (fill >= ai.floodPartAt) tier = 'flooding';
    else if (sink >= ai.floodSinkAt && fill > ai.bailStopAt) {
      tier = 'flooding';
      why = `boat ${pct(sink)} to sinking`;
    } else if (fill >= ai.moderateWaterAt || (fill > ai.bailStopAt && claimed(boat, key))) tier = 'otherDamage';
    if (tier) out.push({ key, task, tier, base: L[tier] + span * Math.min(1, fill), label: `Bail ${part.def.label}`, why, job: 'fix', useful: true });
  });
  return out;
}

// ------------------------------------------------------------ decisions

interface Option {
  lee: Lee;
  need: Need | null;
  task: Task;
  key: string;
  dest: number;
  walk: number;
  score: number;
  tierWeight: number;
  label: string;
  why: string;
  /** Counts as "still needed" for stickiness. */
  needed: boolean;
}

/** Seconds to walk from where the Lee is to a tile. */
function walkTime(lee: Lee, dest: number, boat: Boat, t: Tuning): number {
  const g = boat.grid;
  const speed = Math.max(0.1, t.crew.walkSpeed * leeStat(lee, 'walkSpeed', boat, t) * wetFactor(lee, boat, t));
  if (lee.path.length) {
    // Mid-step: either finish the step or turn back, whichever is shorter.
    const ahead = lee.path[0];
    const viaAhead = dist(lee.pos, g.tiles[ahead].center) + g.dist[ahead][dest];
    const viaBack = dist(lee.pos, g.tiles[lee.tile].center) + g.dist[lee.tile][dest];
    return Math.min(viaAhead, viaBack) / speed;
  }
  return (dist(lee.pos, g.tiles[lee.tile].center) + g.dist[lee.tile][dest]) / speed;
}

/** Where a Lee would work a task from. Repairs/bails pick the closest free tile of the part. */
function destFor(lee: Lee, task: Task, boat: Boat, t: Tuning, ctx: CrewContext): number {
  if (task.type === 'station') return task.target;
  const lees = ctx.lees ?? boat.crew.lees;
  if (task.type === 'board') {
    // A tile along the rail nearest the other boat, with room: where it already
    // headed if that's still on the rail, else the shortest walk (queue up along the rail).
    const target = ctx.boardTarget;
    if (!target || target.id !== task.target) return -1;
    // Among the tiles about as close to the other boat, boarding planks win.
    const planked = boardingRail(boat, target, lees, t, lee);
    if (planked >= 0) return planked;
    const rail = railTiles(boat, target);
    if (lee.task.type === 'board' && rail.includes(lee.dest) && hasRoom(boat, lee.dest, lees, t, lee)) return lee.dest;
    let best = -1;
    let bestW = Infinity;
    for (const i of rail) {
      if (!hasRoom(boat, i, lees, t, lee)) continue;
      const wt = walkTime(lee, i, boat, t) + (boat.grid.tiles[i].station ? 0.3 : 0);
      if (wt < bestW - 1e-9) {
        bestW = wt;
        best = i;
      }
    }
    if (best >= 0) return best;
    const first = departureTile(boat, target);
    return nearestRoom(boat, first, lees, t, lee);
  }
  if (task.type === 'stage') {
    const target = ctx.boardTarget;
    if (!target) return -1;
    return stagingTile(lee, boat, target, lees, t);
  }
  if (task.type === 'repel') {
    const e = lees.find((l) => l.id === task.target);
    if (!e || !e.alive || e.deck !== boat || e.swing) return -1;
    const at = standingTile(e);
    if (lee.job !== 'board' && !isMeleeFocused(lee, t)) {
      // A shooter keeps a tile between them: stay put if the boarder is in pistol range, else close in.
      const here = lee.path.length ? lee.path[0] : lee.tile;
      if (here !== at && dist(boat.grid.tiles[here].center, e.pos) <= t.pistol.range * 0.8) return here;
      let best = -1;
      let bestD = Infinity;
      for (const tile of boat.grid.tiles) {
        if (tile.index === at || !hasRoom(boat, tile.index, lees, t, lee)) continue;
        if (dist(tile.center, e.pos) > t.pistol.range * 0.8) continue;
        const d = boat.grid.dist[here][tile.index];
        if (d < bestD - 1e-9) {
          bestD = d;
          best = tile.index;
        }
      }
      return best >= 0 ? best : here;
    }
    // Its tile if there's room to fight there, else the nearest tile with room (shoot from there).
    return hasRoom(boat, at, lees, t, lee) ? at : nearestRoom(boat, at, lees, t, lee);
  }
  if (task.type === 'idle') {
    // Fixers with nothing to fix wait on their own plain tile; everyone else stands where they are.
    const here = lee.path.length ? lee.path[0] : lee.tile;
    if (lee.job === 'fix' && !boat.grid.tiles[lee.home].station && hasRoom(boat, lee.home, lees, t, lee)) return lee.home;
    return here;
  }
  let best = -1;
  let bestCost = Infinity;
  for (const tile of boat.grid.tiles) {
    if (tile.part !== task.target) continue;
    if (!hasRoom(boat, tile.index, lees, t, lee)) continue;
    let cost = walkTime(lee, tile.index, boat, t);
    if (tile.station) cost += 0.5; // keep stations clear
    if (boat.crew.lees.some((o) => o !== lee && o.alive && o.dest === tile.index)) cost += 0.8;
    if (cost < bestCost - 1e-9) {
      bestCost = cost;
      best = tile.index;
    }
  }
  return best;
}

/** The boarding party's spot: a tile on the edge facing the target (plain deck first, nearest the target), with room. */
function stagingTile(lee: Lee, boat: Boat, target: Boat, lees: Lee[], t: Tuning): number {
  const side = sideFacing(boat, target.motion);
  const tw = target.motion;
  let best = -1;
  let bestCost = Infinity;
  for (const tile of boat.grid.tiles) {
    if (!hasRoom(boat, tile.index, lees, t, lee)) continue;
    const onSide = tile.edges.includes(side);
    const w = toWorld(tile.center, boat.motion, boat.motion.heading);
    let cost = dist(w, tw) * 0.05 + walkTime(lee, tile.index, boat, t) * 0.5;
    if (!onSide) cost += 20;
    if (tile.station) cost += 3;
    if (cost < bestCost - 1e-9) {
      bestCost = cost;
      best = tile.index;
    }
  }
  return best;
}

/** Points lost per other Lee already on this kind of job. Boarding has none; fighting boarders little (ganging up works). */
function helpCost(type: TaskType, t: Tuning): number {
  if (type === 'board' || type === 'stage' || type === 'idle' || type === 'station') return 0;
  if (type === 'repel') return Math.max(0, t.boarding.repelHelpPenalty);
  return t.crewAI.helpPenalty;
}

/**
 * Score one option for one Lee, or null if it isn't one in this pass.
 * Pass 1: useful work of the Lee's own job. Pass 2: the fallback (fix, bail,
 * the pump, boarders, then standing ready at a station of its own job).
 */
function evaluate(lee: Lee, need: Need | null, othersOnIt: number, boat: Boat, ctx: CrewContext, pass: 1 | 2): Option | null {
  const t = ctx.tuning;
  const ai = t.crewAI;
  const L = t.ladder;
  const task = need ? need.task : IDLE;
  if ((task.type === 'board' || task.type === 'repel' || task.type === 'stage') && isWounded(lee, t)) return null;
  const isCurrent = taskKey(task) === taskKey(lee.task);
  let tier: LadderTier | null = need ? need.tier : null;
  let base = need ? need.base : 0;
  let why = need ? need.why : 'nothing to do';
  let useful = need?.useful ?? false;
  let walk = 0;
  let dest = -1;

  if (!need) {
    if (pass !== 2) return null;
  } else {
    // Whose work is it?
    let own = need.job === lee.job;
    const crewGun = need.cannon?.targets === 'crew';
    // ⚔️ Lees man anti-crew guns on the side facing their target.
    if (crewGun && lee.job === 'board' && ctx.boardTarget && facesToward(boat, need.cannon!, ctx.boardTarget)) own = true;
    if (task.type === 'repel' && lee.job === 'board') own = true;
    dest = destFor(lee, task, boat, t, ctx);
    if (dest < 0) return null;
    walk = walkTime(lee, dest, boat, t);
    if (need.cannon) {
      // Will this gun have something to shoot by the time I'm there (or shortly after)?
      const look = Math.max(0, ai.arcLookahead);
      const engage = gunEngages(boat, need.cannon, ctx, walk) || gunEngages(boat, need.cannon, ctx, walk + look);
      const grace = isCurrent && lee.stuckSince !== null && ctx.time - lee.stuckSince < Math.max(0, t.jobs.gunStick);
      useful = engage || grace;
      tier = useful ? 'engageCannon' : 'idleCannon';
      base = L[tier] + (useful ? L.severitySpan * 0.5 : 0);
      // Crew guns: the boarding party has first call on them; the gun crew takes them when nobody else does.
      if (useful && crewGun) base += lee.job === 'board' ? L.severitySpan : -L.severitySpan;
      why = engage ? (claimantOf(boat, need.task.target) === lee ? 'enemy in arc' : 'enemy in arc, unmanned') : grace ? `holding: no target for ${(ctx.time - lee.stuckSince!).toFixed(1)}s` : 'no target';
    }
    if (pass === 1) {
      if (!own || !useful) return null;
    } else {
      const fallback = (task.type === 'repair' || task.type === 'bail' || (task.type === 'station' && need.job === 'fix')) && useful;
      const repel = task.type === 'repel' && isMeleeFocused(lee, t);
      const ready = own && task.type === 'station' && !useful;
      if (!fallback && !repel && !ready) return null;
      if (ready) {
        tier = 'idleCannon';
        base = L.idleCannon;
        why = `standing ready: ${why}`;
      } else if (lee.job !== 'fix') why = `nothing to do as ${lee.job} → ${why}`;
    }
  }
  if (!need) {
    dest = destFor(lee, task, boat, t, ctx);
    if (dest < 0) return null;
    walk = walkTime(lee, dest, boat, t);
  }
  // Walking costs the time an urgent task goes undone. Standing ready loses nothing on the way.
  const urgent = tier !== null && tier !== 'idleCannon';
  let score = base - (urgent ? ai.walkPenalty * walk : 0);
  const kind = workKind(boat, task);
  let statNote = '';
  if (kind) {
    score += lee.def.affinities[kind] ?? 0;
    const sv = leeStat(lee, WORK_STAT[kind], boat, t);
    const cap = Math.max(0, ai.statAffinityCap);
    const pts = ai.statAffinity * Math.max(-cap, Math.min(cap, sv - 1));
    score += pts;
    // Say so when a Lee's stats tipped the choice (debug reason strings).
    if (Math.abs(pts) >= 3) statNote = ` [${pts > 0 ? '+' : '−'}${Math.round(Math.abs(pts))} for ${STAT_LABELS[WORK_STAT[kind]]} ×${sv.toFixed(2)}]`;
  }
  score -= helpCost(task.type, t) * othersOnIt;
  // Extra hands only join a job when it's big enough to be worth it (a flood).
  if (othersOnIt > 0 && helpCost(task.type, t) > 0 && score <= ai.helpThreshold) return null;
  return {
    lee,
    need,
    task,
    key: taskKey(task),
    dest,
    walk,
    score,
    tierWeight: tier ? L[tier] : -Infinity,
    label: need ? need.label : 'Stand by',
    why: why + statNote,
    needed: urgent || (isCurrent && task.type === 'station'),
  };
}

function compareOptions(a: Option, b: Option): number {
  return (
    b.score - a.score ||
    b.tierWeight - a.tierWeight ||
    a.walk - b.walk ||
    a.lee.id - b.lee.id ||
    TYPE_ORDER[a.task.type] - TYPE_ORDER[b.task.type] ||
    a.task.target - b.task.target
  );
}

/** Why a Lee's current task no longer needs it. */
function endedWhy(lee: Lee, boat: Boat, t: Tuning): string {
  const task = lee.task;
  if (task.type === 'station') {
    const tile = boat.grid.tiles[task.target];
    const part = boat.parts[tile.part];
    if (isWrecked(part)) return 'wrecked';
    if (tile.fixture?.destroyed) return 'blown out';
    const c = boat.guns.find((x) => x.station === tile.index);
    if (c && !gunOnline(boat, c, t)) return 'offline';
    if (STATION_JOB[tile.station!] !== lee.job) return `now ${lee.job}`;
    return 'no target';
  }
  if (task.type === 'repair') {
    const part = boat.parts[task.target];
    return isWrecked(part) ? 'wrecked' : 'patched';
  }
  if (task.type === 'bail') return 'dry';
  if (task.type === 'board') return 'nobody to board';
  if (task.type === 'stage') return 'no target';
  if (task.type === 'repel') return 'boarder gone';
  return 'done';
}

function describeTask(task: Task, boat: Boat): string {
  switch (task.type) {
    case 'station':
      return boat.grid.tiles[task.target].label;
    case 'repair':
      return `Repair ${boat.parts[task.target].def.label}`;
    case 'bail':
      return `Bail ${boat.parts[task.target].def.label}`;
    case 'board':
      return 'Board';
    case 'stage':
      return 'Boarding party';
    case 'repel':
      return 'Repel boarder';
    default:
      return 'stand by';
  }
}

/** Is a station useful right now for whoever is on it (guns judged from where it stands, no walking)? */
function stationUseful(boat: Boat, tile: number, needs: Need[], ctx: CrewContext): boolean {
  const need = needs.find((n) => n.task.type === 'station' && n.task.target === tile);
  if (!need) return false;
  if (need.cannon) return gunEngages(boat, need.cannon, ctx, 0) || gunEngages(boat, need.cannon, ctx, Math.max(0, ctx.tuning.crewAI.arcLookahead));
  return need.useful;
}

/** One crew decision: every living Lee re-checks whether its current task is still its best use. */
export function thinkCrew(boat: Boat, ctx: CrewContext): void {
  const t = ctx.tuning;
  const ai = t.crewAI;
  const all = liveLees(boat);
  const everyone = ctx.lees ?? boat.crew.lees;
  // Wounded Lees with enemies aboard fall back to the safest tile and shoot instead.
  const boarders = foesOn(boat, boat.side, everyone);
  for (const l of all) {
    if (l.deck !== boat || l.swing) continue;
    l.retreating = boarders.length > 0 && isWounded(l, t);
    if (!l.retreating) continue;
    const to = safestTile(l, boarders, everyone, t);
    l.reason = `wounded (${Math.round((100 * l.hp) / l.maxHp)}% HP): falling back to ${boat.grid.tiles[to].label}, pistol only`;
    if (l.dest !== to || (!l.path.length && l.tile !== to)) {
      l.task = IDLE;
      l.taskSince = ctx.time;
      setDestination(l, to, boat);
    }
  }
  // Engaged Lees are forced to fight; boarders and swingers follow the boarder rules.
  const lees = all.filter((l) => l.deck === boat && !l.swing && !l.engaged && !l.retreating);
  for (const l of all) {
    if (l.engaged && l.deck === boat) l.reason = `engaged: fighting on ${boat.grid.tiles[standingTile(l)].label}`;
  }
  const needs = computeNeeds(boat, ctx);
  boat.crew.needs = needs;

  // Gun stickiness: when did each Lee's station stop being useful?
  for (const l of lees) {
    if (l.task.type !== 'station' || !stationUseful(boat, l.task.target, needs, ctx)) l.stuckSince ??= ctx.time;
    else l.stuckSince = null;
  }

  // Who holds what right now (a Lee walking to a task holds its claim).
  const holders = new Map<string, Set<number>>();
  for (const l of all) {
    const k = taskKey(l.task);
    if (!holders.has(k)) holders.set(k, new Set());
    holders.get(k)!.add(l.id);
  }
  const othersOn = (k: string, lee: Lee) => {
    const h = holders.get(k);
    return h ? h.size - (h.has(lee.id) ? 1 : 0) : 0;
  };

  const decided = new Set<number>();
  const takenStations = new Set<string>();
  for (const pass of [1, 2] as const) {
    const options: Option[] = [];
    const keep = new Map<number, { option: Option | null; value: number }>();
    for (const lee of lees) {
      if (decided.has(lee.id)) continue;
      const mine: Option[] = [];
      let current: Option | null = null;
      const curKey = taskKey(lee.task);
      for (const need of [...needs, null]) {
        const k = need ? need.key : taskKey(IDLE);
        const others = need && need.task.type !== 'idle' ? othersOn(k, lee) : 0;
        if (need?.task.type === 'station' && others > 0) continue; // one Lee per station
        const o = evaluate(lee, need, others, boat, ctx, pass);
        if (!o) continue;
        mine.push(o);
        if (k === curKey) current = o;
      }
      mine.sort(compareOptions);
      if (pass === 1 || !lee.options.length) lee.options = mine.slice(0, 4).map((o) => ({ label: o.label, score: Math.round(o.score) }));
      if (pass === 2 && mine.length) lee.options = [...lee.options, ...mine.slice(0, 2).map((o) => ({ label: `(fallback) ${o.label}`, score: Math.round(o.score) }))].slice(0, 5);
      options.push(...mine);
      const committed = ctx.time - lee.taskSince < ai.commitTime;
      let value = -Infinity;
      if (current) value = committed ? Infinity : current.score + (current.needed ? ai.stickiness : 0);
      keep.set(lee.id, { option: current, value });
    }

    options.sort(compareOptions);
    /** Lees that joined a repair/bail job during this pass (they weren't counted when it was scored). */
    const joined = new Map<string, number>();
    for (const o of options) {
      const lee = o.lee;
      if (decided.has(lee.id)) continue;
      const isCurrent = o.key === taskKey(lee.task);
      if (o.task.type === 'station') {
        if (takenStations.has(o.key)) continue;
        // Still held by another Lee that hasn't moved off it.
        const h = holders.get(o.key);
        if (!isCurrent && h && [...h].some((id) => id !== lee.id)) continue;
      }
      const k = keep.get(lee.id)!;
      const helpers = joined.get(o.key) ?? 0;
      const score = o.score - helpCost(o.task.type, t) * helpers;
      if (!isCurrent && score <= k.value) continue;
      if (!isCurrent && helpers > 0 && helpCost(o.task.type, t) > 0 && score <= ai.helpThreshold) continue;
      decided.add(lee.id);
      if (o.task.type === 'station') takenStations.add(o.key);
      if (isCurrent) {
        lee.score = o.score;
        // Keep the "why" of the last switch; otherwise say what it's doing now.
        if (!lee.reason.includes('→') || o.why.startsWith('holding')) lee.reason = `${o.label}: ${o.why}`;
        if (lee.dest !== o.dest) setDestination(lee, o.dest, boat);
        continue;
      }
      if (o.task.type !== 'idle') joined.set(o.key, (joined.get(o.key) ?? 0) + 1);
      // Switch.
      const from = describeTask(lee.task, boat);
      const prev = k.option;
      const leaving = lee.task.type === 'idle' ? '' : !prev ? `abandoned ${from}: ${endedWhy(lee, boat, t)} → ` : `left ${from} (${Math.round(prev.score)} < ${Math.round(o.score)}) → `;
      holders.get(taskKey(lee.task))?.delete(lee.id);
      if (!holders.has(o.key)) holders.set(o.key, new Set());
      holders.get(o.key)!.add(lee.id);
      lee.task = o.task;
      lee.taskSince = ctx.time;
      lee.score = score;
      lee.stats.switches++;
      const helping = (holders.get(o.key)?.size ?? 1) > 1 && o.task.type !== 'board' && o.task.type !== 'stage' ? ' (helping)' : '';
      lee.reason = `${leaving}${o.label}: ${o.why}${helping}`;
      setDestination(lee, o.dest, boat);
    }
  }

  // Anyone left without an option (its task ended and nothing else is open) stands by.
  for (const lee of lees) {
    if (decided.has(lee.id)) continue;
    const from = describeTask(lee.task, boat);
    const why = endedWhy(lee, boat, t);
    lee.task = IDLE;
    lee.taskSince = ctx.time;
    lee.stats.switches++;
    lee.reason = `abandoned ${from}: ${why} → stand by`;
    setDestination(lee, destFor(lee, IDLE, boat, t, ctx), boat);
  }
}

/** Point a Lee at a new tile, finishing (or reversing) the step it's on. */
function setDestination(lee: Lee, dest: number, boat: Boat): void {
  const g = boat.grid;
  lee.dest = dest;
  lee.working = false;
  if (lee.path.length) {
    const ahead = lee.path[0];
    const viaAhead = dist(lee.pos, g.tiles[ahead].center) + g.dist[ahead][dest];
    const viaBack = dist(lee.pos, g.tiles[lee.tile].center) + g.dist[lee.tile][dest];
    if (viaBack < viaAhead) {
      // Turn around: step back onto the tile it came from.
      lee.path = [lee.tile, ...pathTo(g, lee.tile, dest)];
      lee.tile = ahead;
    } else {
      lee.path = [ahead, ...pathTo(g, ahead, dest)];
    }
    return;
  }
  lee.path = pathTo(g, lee.tile, dest);
}

// ------------------------------------------------------------ stepping

export interface CrewStepResult {
  /** HP repaired this step per part index. */
  repaired: number;
  bailed: number;
  /** Lees that swung across to board this step. */
  boarded: Lee[];
  /** Lees that landed back home this step. */
  returned: Lee[];
  /** Lees hurt by the crew step itself (landing on spikes). */
  hurt: { lee: Lee; damage: number; killed: boolean }[];
}

/**
 * Decide (on the think interval), walk, swing and work. Gun loading happens in
 * the world (it owns cannons); melee and pistols in combat.ts.
 */
export function stepCrew(boat: Boat, ctx: CrewContext, dt: number): CrewStepResult {
  const t = ctx.tuning;
  const out: CrewStepResult = { repaired: 0, bailed: 0, boarded: [], returned: [], hurt: [] };
  if (boat.sinkingSince !== null) {
    for (const l of boat.crew.lees) if (l.deck === boat) l.working = false;
    updateMobility(boat, t);
    return out;
  }
  boat.crew.thinkIn -= dt;
  if (boat.crew.thinkIn <= 0) {
    thinkCrew(boat, ctx);
    thinkBoarders(boat, ctx);
    boat.crew.thinkIn += Math.max(0.02, t.crewAI.thinkInterval);
    if (boat.crew.thinkIn <= 0) boat.crew.thinkIn = Math.max(0.02, t.crewAI.thinkInterval);
  }

  for (const lee of boat.crew.lees) {
    if (!lee.alive) continue;
    if (lee.swing) {
      const landed = stepSwing(lee, ctx, dt, out);
      lee.stats.time.swing += dt;
      lee.stats.awayFromHome += dt;
      if (landed) (lee.deck === boat ? out.returned : out.boarded).push(lee);
      lee.progress = 0;
      continue;
    }
    // Fighters hold their tile; the wounded break away.
    if (!lee.engaged || lee.retreating) walk(lee, lee.deck, t, dt, ctx.lees ?? boat.crew.lees);
    else lee.working = false;
    const act = activity(lee, boat);
    lee.stats.time[act] += dt;
    const away = lee.deck !== boat;
    if (away) lee.stats.onEnemyDeck += dt;
    if (away || dist(lee.pos, boat.grid.tiles[lee.home].center) > 0.3) lee.stats.awayFromHome += dt;
    if (away || !lee.working || lee.engaged) {
      lee.progress = 0;
      continue;
    }
    // At the departure tile: swing across.
    if (lee.task.type === 'board') {
      const target = crossTarget(boat, ctx);
      // One at a time over the rail, and only when there's room to land.
      const ready = ctx.time >= (boat.crew.nextSwingAt ?? -Infinity);
      if (target && target.id === lee.task.target && ready) {
        const why = lee.reason.split(' | ')[0];
        const lees = ctx.lees ?? boat.crew.lees;
        if (startSwing(lee, target, false, `swinging across to ${boatLabel(target)}`, t, lees)) {
          lee.whyBoarded = why;
          lee.reason = `${why} | swinging across`;
          boat.crew.nextSwingAt = ctx.time + Math.max(0, t.boarding.swingInterval);
        } else {
          // Fenced off: hack at the fence (a sword reaches across the gap) until it breaks.
          const fence = blockingFence(target, toWorld(lee.pos, boat.motion, boat.motion.heading), t);
          if (fence) {
            fence.hp -= dt * Math.max(0, t.melee.damage) * Math.max(0, t.melee.rate) * leeStat(lee, 'meleeDamage', boat, t) * leeStat(lee, 'meleeRate', boat, t);
            lee.stats.time.melee += dt;
            lee.reason = `${why} | hacking at a fence (${Math.max(0, Math.round(fence.hp))} HP)`;
            if (fence.hp <= 0) {
              fence.hp = 0;
              fence.destroyed = true;
            }
          }
        }
      }
      lee.progress = 0;
      continue;
    }
    const wet = wetFactor(lee, boat, t);
    // Stopped: fixing goes faster (the pit-stop bonus).
    const fix = wet * boat.fx.fix;
    const task = lee.task;
    if (task.type === 'repair') {
      const part = boat.parts[task.target];
      const st = structure(part);
      const cap = st.maxHp * Math.min(1, Math.max(0, t.crew.repairCeiling));
      const rate = t.crew.repairRate * leeStat(lee, 'repairRate', boat, t) * fix;
      const add = Math.max(0, Math.min(rate * dt, cap - st.hp));
      if (st.hp > 0 || t.crew.wreckedRepairable > 0) {
        st.hp += add;
        lee.stats.hpRepaired += add;
        out.repaired += add;
      }
      lee.progress = (lee.progress + dt * 0.9 * wet) % 1;
    } else if (task.type === 'bail') {
      const part = boat.parts[task.target];
      const rate = t.crew.bailRate * leeStat(lee, 'bailRate', boat, t) * fix;
      const take = Math.min(part.water, rate * dt);
      part.water -= take;
      lee.stats.waterBailed += take;
      out.bailed += take;
      lee.progress = (lee.progress + dt * 1.2 * wet) % 1;
    } else if (task.type === 'station') {
      const tile = boat.grid.tiles[task.target];
      const c = boat.guns.find((x) => x.station === task.target);
      if (c) lee.progress = c.load;
      else if (tile.station === 'pump' && tile.fixture) {
        // Pump the fullest part.
        let part = boat.parts[0];
        for (const p of boat.parts) if (p.water / Math.max(1e-6, p.capacity) > part.water / Math.max(1e-6, part.capacity)) part = p;
        const rate = itemParam(t, tile.fixture.item, 'rate') * leeStat(lee, 'bailRate', boat, t) * fix;
        const take = Math.min(part.water, rate * dt);
        part.water -= take;
        lee.stats.waterBailed += take;
        out.bailed += take;
        lee.progress = take > 0 ? (lee.progress + dt * 1.5 * wet) % 1 : 0;
      } else lee.progress = (lee.progress + dt * 0.7 * wet) % 1;
    } else {
      lee.progress = 0;
    }
  }
  updateMobility(boat, t);
  return out;
}

// ------------------------------------------------------------ boarding

/** Leap from the Lee's deck to `to`, landing on the tile nearest where it left. */
export function startSwing(lee: Lee, to: Boat, back: boolean, why: string, t: Tuning, lees?: Lee[]): boolean {
  const from = lee.deck;
  const world = toWorld(lee.pos, from.motion, from.motion.heading);
  const toTile = lees ? landingWithRoom(to, world, lees, t, lee.side) : landingTile(to, world);
  if (toTile < 0) return false;
  let speed = Math.max(0.05, leeStat(lee, 'swingSpeed', lee.boat, t));
  // Swinging Ropes on its own boat; boarding planks on the tile it leaves from.
  speed /= Math.max(0.05, lee.boat.mods.swing);
  const planks = !back && from === lee.boat ? from.grid.tiles[standingTile(lee)]?.rails.find((r) => r.kind === 'planks' && !r.destroyed) : undefined;
  lee.boardBuff = null;
  if (planks) {
    speed *= Math.max(0.05, itemParam(t, planks.item, 'swing'));
    lee.boardBuff = { pistolDamage: itemParam(t, planks.item, 'pistolDamage'), exposed: true };
  }
  lee.swing = {
    from,
    to,
    fromLocal: { ...lee.pos },
    toTile,
    t: 0,
    dur: Math.max(0.05, t.boarding.swingTime / speed),
    back,
    why,
  };
  lee.engaged = false;
  lee.working = false;
  lee.path = [];
  lee.progress = 0;
  return true;
}

/** Advance a swing. Returns true when the Lee lands. */
function stepSwing(lee: Lee, ctx: CrewContext, dt: number, out: CrewStepResult): boolean {
  const s = lee.swing!;
  s.t += dt;
  if (s.t < s.dur) return false;
  // Land (somewhere close with room, if the spot filled up meanwhile).
  lee.swing = null;
  const lees = ctx.lees ?? lee.boat.crew.lees;
  let at = s.toTile;
  if (settledOn(s.to, at, lees, lee) >= Math.max(1, Math.round(ctx.tuning.boarding.tileCap))) {
    const alt = nearestRoom(s.to, at, lees, ctx.tuning, lee);
    if (alt >= 0) at = alt;
  }
  lee.deck = s.to;
  lee.tile = at;
  lee.pos = { ...s.to.grid.tiles[at].center };
  lee.path = [];
  lee.dest = at;
  lee.working = false;
  if (s.back) {
    lee.task = IDLE;
    lee.taskSince = ctx.time;
    lee.reason = `swung home: ${s.why}`;
  } else {
    lee.stats.boardings++;
    lee.task = { type: 'board', target: s.to.id };
    lee.taskSince = ctx.time;
    lee.reason = `landed on ${boatLabel(s.to)}: hunting`;
    // Landing on a spiked tile hurts.
    const spikes = s.to.grid.tiles[at].rails.find((r) => r.kind === 'spikes' && !r.destroyed);
    if (spikes && s.to.side !== lee.side) {
      const dmg = Math.max(0, itemParam(ctx.tuning, spikes.item, 'landDamage'));
      if (dmg > 0) out.hurt.push({ lee, damage: dmg, killed: hurtLee(lee, dmg, ctx.time, 'spikes') });
    }
  }
  if (s.back) lee.boardBuff = null;
  return true;
}

/** Why a boarder should leave the deck it's on, or null to stay and fight. */
export function recallWhy(lee: Lee, ctx: CrewContext): string | null {
  const deck = lee.deck;
  const lees = ctx.lees ?? lee.boat.crew.lees;
  if (lee.job !== 'board') return `called back to ${lee.job}`;
  if (ctx.retreating) return 'retreat';
  if (isWounded(lee, ctx.tuning)) return `wounded (${Math.round((100 * lee.hp) / lee.maxHp)}% HP)`;
  if (deck.sinkingSince !== null) return `${boatLabel(deck)} is sinking`;
  if (sinkProgress(deck, ctx.tuning) >= ctx.tuning.boarding.evacuateAt) return `${boatLabel(deck)} about to sink`;
  if (!foesOn(deck, lee.side, lees).length) return `${boatLabel(deck)} deck clear`;
  return null;
}

/**
 * The boarder rules, for this crew's Lees standing on an enemy deck: swing home
 * when there's a reason to (called back, retreat, wounded, sinking, deck clear)
 * and home is within reach; otherwise (or if stranded) walk to the nearest
 * enemy Lee (walking distance, then id) to fight it. Deterministic.
 */
export function thinkBoarders(boat: Boat, ctx: CrewContext): void {
  const lees = ctx.lees ?? boat.crew.lees;
  for (const lee of boat.crew.lees) {
    if (!lee.alive || lee.swing || lee.deck === boat) continue;
    const deck = lee.deck;
    const why = recallWhy(lee, ctx);
    if (why) {
      if (inReach(boat, deck, ctx.tuning)) {
        lee.retreating = isWounded(lee, ctx.tuning);
        if (startSwing(lee, boat, true, why, ctx.tuning, lees)) {
          lee.reason = `recall: ${why} → swinging home`;
          continue;
        }
        lee.reason = `recall: ${why} → waiting for room aboard`;
      } else lee.reason = `stranded on ${boatLabel(deck)} (${why}): home is out of reach`;
    }
    if (lee.engaged) {
      lee.reason = why ? `stranded on ${boatLabel(deck)} (${why}): engaged in melee` : `boarding ${boatLabel(deck)}: engaged in melee`;
      continue;
    }
    const foes = foesOn(deck, lee.side, lees);
    if (!foes.length) {
      if (lee.path.length === 0) lee.working = true;
      continue;
    }
    const here = lee.path.length ? lee.path[0] : lee.tile;
    let best: Lee | null = null;
    let bestD = Infinity;
    for (const f of foes) {
      // Go for those still fighting before chasing the ones falling back.
      const d = deck.grid.dist[here][standingTile(f)] + (f.retreating ? 100 : 0);
      if (d < bestD - 1e-9 || (Math.abs(d - bestD) <= 1e-9 && best && f.id < best.id)) {
        bestD = d;
        best = f;
      }
    }
    if (!best) continue;
    const at = standingTile(best);
    const dest = hasRoom(deck, at, lees, ctx.tuning, lee) ? at : nearestRoom(deck, at, lees, ctx.tuning, lee);
    if (dest < 0) continue;
    const prefix = why ? `stranded (${why}): ` : `boarding ${boatLabel(deck)}: `;
    lee.reason = `${prefix}going for ${leeLabel(best)} at ${deck.grid.tiles[at].label}${dest === at ? '' : ' (crowded: closing in)'}`;
    if (lee.dest !== dest || (!lee.path.length && lee.tile !== dest)) setDestination(lee, dest, deck);
  }
}

/** Lees standing still on a tile (either side): what the tile cap counts on arrival. */
function settledOn(deck: Boat, tile: number, lees: Lee[], except: Lee): number {
  let n = 0;
  for (const l of lees) if (l !== except && l.alive && !l.swing && l.deck === deck && !l.path.length && l.tile === tile) n++;
  return n;
}

function walk(lee: Lee, boat: Boat, t: Tuning, dt: number, lees: Lee[] = boat.crew.lees): void {
  const g = boat.grid;
  // Don't step onto a full tile to stop there: wait where you are until there's room.
  const cap = Math.max(1, Math.round(t.boarding.tileCap));
  if (lee.path.length === 1 && settledOn(boat, lee.path[0], lees, lee) >= cap) {
    const c = g.tiles[lee.tile].center;
    if (dist(lee.pos, c) < 1e-6) {
      lee.working = false;
      return;
    }
    // Step back onto the tile it came from.
    lee.path = [lee.tile];
  }
  let budget = Math.max(0.1, t.crew.walkSpeed * leeStat(lee, 'walkSpeed', boat, t) * wetFactor(lee, boat, t)) * dt;
  // Finish settling onto the current tile if no path is left.
  if (!lee.path.length) {
    const c = g.tiles[lee.tile].center;
    const d = dist(lee.pos, c);
    if (d > 1e-6) {
      const k = Math.min(1, budget / d);
      lee.pos.x += (c.x - lee.pos.x) * k;
      lee.pos.y += (c.y - lee.pos.y) * k;
    }
  }
  while (lee.path.length && budget > 0) {
    const c = g.tiles[lee.path[0]].center;
    const d = dist(lee.pos, c);
    if (d <= budget) {
      lee.pos = { ...c };
      budget -= d;
      lee.tile = lee.path.shift()!;
    } else {
      lee.pos.x += ((c.x - lee.pos.x) / d) * budget;
      lee.pos.y += ((c.y - lee.pos.y) / d) * budget;
      budget = 0;
    }
  }
  lee.working = !lee.path.length && lee.tile === lee.dest && dist(lee.pos, g.tiles[lee.dest].center) < 0.05;
}

/**
 * What manned stations do right now: oars add speed, sails add turning, a
 * lookout tightens every gun's spread, a powder store speeds reloads. Each
 * counts only while a Lee is working it. Stopped (and slow), fixing and aim
 * get their pit-stop bonus.
 */
export function updateMobility(boat: Boat, t: Tuning): void {
  let rowing = 0;
  let sailing = 0;
  let accuracy = 0;
  let reload = 1;
  if (boat.sinkingSince === null) {
    for (const l of boat.crew.lees) {
      if (!l.alive || !l.working || l.engaged || l.deck !== boat || l.task.type !== 'station') continue;
      const tile = boat.grid.tiles[l.task.target];
      const item = tile.fixture?.item;
      if (!item || tile.fixture!.destroyed) continue;
      const wet = wetFactor(l, boat, t);
      switch (tile.station) {
        case 'oars':
          rowing += itemParam(t, item, 'boost') * leeStat(l, 'rowStrength', boat, t) * wet;
          break;
        case 'sails':
          sailing += itemParam(t, item, 'boost') * leeStat(l, 'sailHandling', boat, t) * wet;
          break;
        case 'lookout':
          accuracy += itemParam(t, item, 'accuracy') * leeStat(l, 'spotting', boat, t) * wet;
          break;
        case 'powder':
          reload *= Math.max(0.05, itemParam(t, item, 'reload'));
          break;
        default:
          break;
      }
    }
  }
  const c = t.crew;
  boat.mobility.speed = mobilityFactor(c.oarBaseline, rowing, t);
  boat.mobility.turn = mobilityFactor(c.sailBaseline, sailing, t);
  const pit = isStopped(boat, t);
  boat.fx = { accuracy: 1 + accuracy, reload, fix: pit ? Math.max(0, t.jobs.stoppedFix) : 1, aim: pit ? Math.max(0.05, t.jobs.stoppedAim) : 1 };
}

/** Stopped for a pit stop: told to stop (tap your own boat) and down to a crawl. */
export function isStopped(boat: Boat, t: Tuning): boolean {
  return boat.stopped && Math.hypot(boat.motion.vx, boat.motion.vy) <= Math.max(0, t.jobs.stoppedSpeed);
}

// ------------------------------------------------------------ damage

export interface CrewHit {
  lee: Lee;
  damage: number;
  lost: boolean;
}

/** How a shell (or blast) hurts the Lees around where it lands. */
export interface CrewBlast {
  /** Damage to each Lee on the struck tile (× their impact damage taken). */
  damage: number;
  /** Fraction dealt to Lees on nearby tiles. */
  splash: number;
  /** How far the splash reaches, in tiles (Manhattan distance; 1 = orthogonal neighbors). */
  reach: number;
  cause: LossCause;
}

/** Tiles within `reach` steps of a tile (Manhattan, on the grid), with their distance. */
export function tilesWithin(deck: Boat, from: Tile, reach: number): Map<number, number> {
  const out = new Map<number, number>([[from.index, 0]]);
  let frontier = [from.index];
  for (let step = 1; step <= reach; step++) {
    const next: number[] = [];
    for (const i of frontier) {
      for (const n of deck.grid.tiles[i].neighbors) {
        if (out.has(n)) continue;
        out.set(n, step);
        next.push(n);
      }
    }
    frontier = next;
  }
  return out;
}

/**
 * A shell lands at a local point on `deck`: every Lee standing there (either
 * side; boarders too) takes the hit, nearby tiles take splash. `lees` defaults
 * to the deck's own crew.
 */
export function damageCrewAt(deck: Boat, local: Vec, t: Tuning, time: number, lees: Lee[] = deck.crew.lees, blast?: CrewBlast): CrewHit[] {
  const struck: Tile | null = tileAt(deck.grid, local, 1.5);
  if (!struck) return [];
  const b: CrewBlast = blast ?? { damage: t.guns.crewDamage, splash: t.guns.crewSplash, reach: 1, cause: 'cannon' };
  const near = tilesWithin(deck, struck, Math.max(0, Math.round(b.reach)));
  const out: CrewHit[] = [];
  for (const lee of lees) {
    if (!lee.alive || lee.swing || lee.deck !== deck) continue;
    const on = tileAt(deck.grid, lee.pos, 1) ?? deck.grid.tiles[lee.tile];
    const steps = near.get(on.index);
    if (steps === undefined) continue;
    let dmg = steps === 0 ? b.damage : b.damage * Math.max(0, b.splash);
    dmg *= Math.max(0, leeStat(lee, 'impactTaken', lee.boat, t));
    if (dmg <= 0) continue;
    const lost = hurtLee(lee, dmg, time, b.cause);
    out.push({ lee, damage: dmg, lost });
  }
  if (out.some((h) => h.lost)) for (const bt of new Set(out.map((h) => h.lee.boat))) updateMobility(bt, t);
  return out;
}

/** Take damage. Returns true if this killed it. */
export function hurtLee(lee: Lee, dmg: number, time: number, cause: LossCause): boolean {
  if (!lee.alive) return false;
  lee.hp -= dmg;
  lee.hurtAt = time;
  if (lee.hp > 0) return false;
  loseLee(lee, time, cause);
  return true;
}

export function loseLee(lee: Lee, time: number, cause: LossCause): void {
  lee.hp = 0;
  lee.alive = false;
  lee.lostAt = time;
  lee.lostCause = cause;
  lee.working = false;
  lee.engaged = false;
  lee.retreating = false;
  lee.swing = null;
  lee.path = [];
  lee.task = IDLE;
  lee.reason = cause === 'sank' ? 'went down with the ship' : `lost overboard (${cause})`;
}
