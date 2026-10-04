// Crew: Lees on a deck grid, the tasks they can do, and the one crew AI that
// runs every boat's crew (yours and the enemy's) with the same rules.
//
// How a Lee chooses (no randomness anywhere):
//  1. Every task on the boat has a need: a ladder tier (tuning.ladder) plus a
//     severity bonus. Cannons are judged per Lee: "will the enemy be in this
//     gun's arc when I get there, or within arcLookahead after?"
//  2. Each Lee scores each open task: need − walking time × walkPenalty (urgent
//     tasks only), + homeBonus for work done from its home tile, + roleBonus for
//     the kind of work its home tile sets, + standbyBonus for a damage-control
//     Lee waiting at home, + stat affinity, − helpPenalty per Lee already on a
//     repair/bail job. Stations are exclusive: one Lee each.
//  3. A Lee keeps its task unless something beats it by `stickiness`, and
//     holds a new task for `commitTime`, unless the task itself ends.
//  4. Options are assigned greedily, best first (later joiners of the same
//     job pay the help penalty). Ties break by: score, then ladder tier, then
//     walking time, then Lee id, then task order (stations before repair
//     before bail before idle, then target index).
//  5. Close combat (Phase 3): a Lee sharing a tile with an opposing Lee is
//     engaged and fights until the tile is clear (forced, no decision). Enemy
//     Lees on your deck create "repel" needs. While attached to an enemy boat
//     with crew aboard, Lees whose station does nothing right now (a gun with
//     no valid target, oars and sails, an idle lookout, standing by) are
//     surplus: they lose their home/role bonuses and a "board" need draws them
//     to swing across. Once across, a Lee follows the boarder rules
//     (boarding.ts) until the deck is clear, it's sinking, or the link breaks.

import type { StationKind } from '../config/items';
import { LEE_STAT_KEYS, STAT_LABELS, WORK_STAT, type ActivityKind, type LeeDef, type LeeStatKey, type LeeStats, type WorkKind } from '../config/lees';
import { shipName } from '../config/ships';
import { FACING_ANGLE } from '../config/slots';
import type { LadderTier, Side, Tuning } from '../config/tuning';
import type { AttachSystem } from './attach';
import { gunOnline, gunSpec, isWrecked, keelSegment, partHasGuns, sinkProgress, structure, structureFraction, type Boat, type GunState } from './boat';
import { pathTo, tileAt, type RailState, type Tile } from './grid';
import { itemParam, type StatMods } from './loadout';
import { closestOnSegment, dist, toLocal, toWorld, wrapAngle, type Vec } from './math';

export type TaskType = 'station' | 'repair' | 'bail' | 'idle' | 'board' | 'repel';

export interface Task {
  type: TaskType;
  /** Station: tile index. Repair/bail: part index. Board: boat id. Repel: the boarder's Lee id. Idle: -1. */
  target: number;
}

/** How a Lee was lost (result screen). */
export type LossCause = 'cannon' | 'gatling' | 'melee' | 'pistol' | 'sank' | 'spikes' | 'explosion';

/** A Lee in the air between two attached decks. */
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
  /** Its own boat (home tile, tasks, crew list). */
  boat: Boat;
  /** The deck it stands on right now (its own boat, or one it boarded). */
  deck: Boat;
  /** Home tile: where it was placed. Sets its preferred role. */
  home: number;
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
  /** 0..1 progress bar over its head (gun load, or a work cycle). */
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
  /** Gun stations: the gun (engagement is judged per Lee). */
  cannon?: GunState;
  /** This station does nothing right now (attached: oars, sails, lookout with nothing to spot). */
  surplus?: boolean;
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
  /** Boats this crew's guns may shoot at: other side, afloat, not attached to us or our allies. */
  foes: Boat[];
  /** Every Lee in the world (boarders on our deck, enemies on attached decks). Defaults to this boat's crew. */
  lees?: Lee[];
  /** Links between boats (boarding needs them). */
  links?: AttachSystem;
}

const TYPE_ORDER: Record<TaskType, number> = { station: 0, repair: 1, bail: 2, repel: 3, board: 4, idle: 5 };
export const STATION_WORK: Record<StationKind, WorkKind> = { gun: 'gun', oars: 'row', sails: 'sail', lookout: 'lookout', pump: 'pump', hooks: 'hooks', powder: 'powder' };
export const ROLE_NAMES: Record<WorkKind | 'damage', string> = {
  gun: 'Gunner',
  row: 'Rower',
  sail: 'Sail hand',
  lookout: 'Lookout',
  pump: 'Pump hand',
  hooks: 'Hook hand',
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
  time: { gun: 0, row: 0, sail: 0, lookout: 0, pump: 0, hooks: 0, powder: 0, repair: 0, bail: 0, board: 0, repel: 0, melee: 0, swing: 0, walk: 0, idle: 0 },
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

/** Who a Lee is beyond its type: run identity, level and static modifiers. */
export interface LeeExtra {
  uid?: number;
  label?: string;
  level?: number;
  mods?: StatMods;
}

export function createLee(id: number, number: number, def: LeeDef, side: Side, boat: Boat, home: number, t: Tuning, extra: LeeExtra = {}): Lee {
  const tile = boat.grid.tiles[home];
  const mods = extra.mods ?? {};
  const maxHp = Math.max(1, t.crew.hp * baseStat(def, 'hp', t, mods));
  const task = homeTask(boat, home);
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
    reason: `home: ${roleName(boat, home)}`,
    whyBoarded: '',
    score: 0,
    options: [],
    stats: emptyRunStats(),
  };
}

/** The task a Lee does at home: work its station, or stand by for damage control. */
function homeTask(boat: Boat, home: number): Task {
  return boat.grid.tiles[home].station ? { type: 'station', target: home } : IDLE;
}

/** Role a tile gives the Lee placed on it. */
export function roleName(boat: Boat, tile: number): string {
  const s = boat.grid.tiles[tile]?.station;
  return s ? ROLE_NAMES[STATION_WORK[s]] : ROLE_NAMES.damage;
}

/** Kinds of work a Lee's home tile makes it prefer. */
function homeRole(lee: Lee, boat: Boat): WorkKind[] {
  const s = boat.grid.tiles[lee.home].station;
  return s ? [STATION_WORK[s]] : ['repair', 'bail'];
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

/** Opposing boats linked to this one (link not breaking) that have enemy crew standing on them: somewhere to board. */
export function boardableFrom(boat: Boat, ctx: CrewContext): Boat[] {
  if (!ctx.links) return [];
  const lees = ctx.lees ?? boat.crew.lees;
  const evac = ctx.tuning.boarding.evacuateAt;
  const out: Boat[] = [];
  for (const l of ctx.links.linksOf(boat)) {
    if (ctx.links.castingOff(l)) continue;
    const o = ctx.links.other(l, boat);
    if (o.side === boat.side || o.sinkingSince !== null || sinkProgress(o, ctx.tuning) >= evac) continue;
    if (foesOn(o, boat.side, lees).length) out.push(o);
  }
  return out.sort((a, b) => a.id - b.id);
}

/** Is this boat attached to anything right now (propulsion overridden)? */
export function isAttached(boat: Boat, ctx: CrewContext): boolean {
  return !!ctx.links && ctx.links.linksOf(boat).length > 0;
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
    // A crew gun (gatling) has work whenever an enemy Lee on an enemy deck is in its arc and range (attached decks too).
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

/** Every task with need on this boat right now. Cannons get their tier per Lee. */
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

  const attached = isAttached(boat, ctx);
  const attachedNames = attached && ctx.links ? ctx.links.attachedTo(boat).map((b) => boatLabel(b)).join(', ') : '';
  // While attached the lookout has nothing to spot unless some gun target is still out there.
  const spotting = !attached || ctx.foes.length > 0;

  // Stations, in tile order.
  for (const tile of boat.grid.tiles) {
    if (!tile.station || tile.fixture?.destroyed) continue;
    const part = boat.parts[tile.part];
    if (isWrecked(part)) continue;
    const task: Task = { type: 'station', target: tile.index };
    const key = taskKey(task);
    if (tile.station === 'gun') {
      const gun = boat.guns.find((c) => c.station === tile.index);
      if (!gun || !gunOnline(boat, gun, t)) continue;
      out.push({ key, task, tier: 'idleCannon', base: L.idleCannon, label: tile.label, why: attached ? `no valid target (attached to ${attachedNames})` : 'no target', cannon: gun });
    } else if (tile.station === 'lookout') {
      if (spotting) out.push({ key, task, tier: 'lookout', base: L.lookout + span * 0.5, label: tile.label, why: 'lookout empty' });
      else out.push({ key, task, tier: 'idleCannon', base: L.idleCannon, label: tile.label, why: 'nothing to spot', surplus: true });
    } else if (tile.station === 'powder') {
      const firing = boat.guns.some((g) => g.targets === 'hull');
      if (firing && !attached) out.push({ key, task, tier: 'lookout', base: L.lookout + span * 0.4, label: tile.label, why: 'powder store empty' });
      else out.push({ key, task, tier: 'idleCannon', base: L.idleCannon, label: tile.label, why: attached ? 'guns quiet while attached' : 'no guns to feed', surplus: true });
    } else if (tile.station === 'pump') {
      if (sink >= ai.floodSinkAt || maxFill >= ai.floodPartAt) out.push({ key, task, tier: 'flooding', base: L.flooding + span * Math.min(1, maxFill), label: tile.label, why: `pump: water ${pct(maxFill)}` });
      else if (maxFill >= ai.moderateWaterAt || (maxFill > ai.bailStopAt && claimed(boat, key))) out.push({ key, task, tier: 'otherDamage', base: L.otherDamage + span * maxFill, label: tile.label, why: `pump: water ${pct(maxFill)}` });
      else out.push({ key, task, tier: 'idleCannon', base: L.idleCannon, label: tile.label, why: 'dry: nothing to pump', surplus: true });
    } else if (tile.station === 'hooks') {
      out.push({ key, task, tier: 'mobility', base: L.mobility + span * 0.3, label: tile.label, why: attached ? 'hooks: faster swings' : 'hooks empty' });
    } else if (attached) {
      // Propulsion and steering are overridden while attached: nothing to do here.
      out.push({ key, task, tier: 'idleCannon', base: L.idleCannon, label: tile.label, why: `attached to ${attachedNames}: ${tile.station} do nothing`, surplus: true });
    } else {
      // Oars slightly ahead of sails: speed is the bigger loss.
      const sev = tile.station === 'oars' ? 0.6 : 0.4;
      out.push({ key, task, tier: 'mobility', base: L.mobility + span * sev, label: tile.label, why: `${tile.station} empty` });
    }
  }

  // Enemy Lees on our deck: go fight them (the weakest first, by severity).
  const lees = ctx.lees ?? boat.crew.lees;
  for (const e of foesOn(boat, boat.side, lees).sort((a, b) => a.id - b.id)) {
    const task: Task = { type: 'repel', target: e.id };
    const hurt = 1 - e.hp / Math.max(1, e.maxHp);
    out.push({ key: taskKey(task), task, tier: 'repelBoarders', base: L.repelBoarders + span * (0.5 + 0.5 * hurt), label: `Repel ${leeLabel(e)}`, why: `boarder on deck at ${boat.grid.tiles[standingTile(e)].label}` });
  }

  // An attached enemy boat with crew aboard: surplus Lees board it.
  for (const o of boardableFrom(boat, ctx)) {
    const task: Task = { type: 'board', target: o.id };
    out.push({ key: taskKey(task), task, tier: 'board', base: L.board, label: `Board ${boatLabel(o)}`, why: 'surplus crew → swing across' });
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
      out.push({ key: taskKey(task), task, tier, base: L[tier] + span * (1 - f / Math.max(ceil, 1e-6)), label: `Repair ${part.def.label}`, why });
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
    if (tier) out.push({ key, task, tier, base: L[tier] + span * Math.min(1, fill), label: `Bail ${part.def.label}`, why });
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
  /** Counts as "still needed" for stickiness (an engaged gun, a real job, or the Lee's own post). */
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
function destFor(lee: Lee, task: Task, boat: Boat, t: Tuning, ctx?: CrewContext): number {
  if (task.type === 'station') return task.target;
  const lees = ctx?.lees ?? boat.crew.lees;
  if (task.type === 'board') {
    // The rail tile nearest the other boat that has room (queue up along the rail).
    const target = ctx?.links?.attachedTo(boat).find((b) => b.id === task.target);
    if (!target) return -1;
    const first = departureTile(boat, target);
    // Among the tiles about as close to the other boat, boarding planks win.
    const planked = boardingRail(boat, target, lees, t, lee);
    if (planked >= 0) return planked;
    return hasRoom(boat, first, lees, t, lee) ? first : nearestRoom(boat, first, lees, t, lee);
  }
  if (task.type === 'repel') {
    const e = lees.find((l) => l.id === task.target);
    if (!e || !e.alive || e.deck !== boat || e.swing) return -1;
    const at = standingTile(e);
    // Its tile if there's room to fight there, else the nearest tile with room (shoot from there).
    return hasRoom(boat, at, lees, t, lee) ? at : nearestRoom(boat, at, lees, t, lee);
  }
  if (task.type === 'idle') {
    // Home, unless someone else is working its home station right now (or it's full).
    const other = workerAt(boat, lee.home);
    if (other && other !== lee) return lee.tile;
    return hasRoom(boat, lee.home, lees, t, lee) ? lee.home : lee.tile;
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

/** Points lost per other Lee already on this kind of job. Boarding has none; fighting boarders little (ganging up works). */
function helpCost(type: TaskType, t: Tuning): number {
  if (type === 'board' || type === 'idle' || type === 'station') return 0;
  if (type === 'repel') return Math.max(0, t.boarding.repelHelpPenalty);
  return t.crewAI.helpPenalty;
}

function evaluate(lee: Lee, need: Need | null, othersOnIt: number, boat: Boat, ctx: CrewContext, boardingOpen = false): Option | null {
  const t = ctx.tuning;
  const ai = t.crewAI;
  const L = t.ladder;
  const task = need ? need.task : IDLE;
  if ((task.type === 'board' || task.type === 'repel') && isWounded(lee, t)) return null;
  const dest = destFor(lee, task, boat, t, ctx);
  if (dest < 0) return null;
  const walk = walkTime(lee, dest, boat, t);
  let tier: LadderTier | null = need ? need.tier : null;
  let base = need ? need.base : 0;
  let why = need ? need.why : 'nothing urgent';
  if (need?.cannon) {
    // Will this gun have something to shoot by the time I'm there (or shortly after)?
    const look = Math.max(0, ai.arcLookahead);
    const engage = gunEngages(boat, need.cannon, ctx, walk) || gunEngages(boat, need.cannon, ctx, walk + look);
    tier = engage ? 'engageCannon' : 'idleCannon';
    base = L[tier] + (engage ? L.severitySpan * 0.5 : 0);
    why = engage ? (claimantOf(boat, need.task.target) === lee ? 'enemy in arc' : 'enemy in arc, unmanned') : 'no target';
  }
  const atHome = dest === lee.home;
  // Surplus: while there's an enemy deck to board, a station that does nothing
  // right now (or standing by) holds no pull: no home/role bonus, no stickiness.
  const surplus = boardingOpen && (!need || tier === 'idleCannon' || !!need.surplus);
  if (surplus && need?.cannon) why = `${need.why}`;
  // Walking costs the time an urgent task goes undone. Standing by, or a gun
  // with nothing to shoot, loses nothing on the way.
  const urgent = tier !== null && tier !== 'idleCannon';
  let score = base - (urgent ? ai.walkPenalty * walk : 0);
  if (atHome && !surplus) score += ai.homeBonus;
  // Damage control's home job is standing by, ready.
  if (!need && atHome && !surplus && !boat.grid.tiles[lee.home].station) score += ai.standbyBonus;
  const kind = workKind(boat, task);
  let statNote = '';
  if (kind) {
    if (homeRole(lee, boat).includes(kind) && !surplus) score += ai.roleBonus;
    score += lee.def.affinities[kind] ?? 0;
    const sv = leeStat(lee, WORK_STAT[kind], boat, t);
    const cap = Math.max(0, ai.statAffinityCap);
    const pts = ai.statAffinity * Math.max(-cap, Math.min(cap, sv - 1));
    score += pts;
    // Say so when a Lee's stats tipped the choice (debug reason strings).
    if (Math.abs(pts) >= 3) statNote = ` [${pts > 0 ? '+' : '−'}${Math.round(Math.abs(pts))} for ${STAT_LABELS[WORK_STAT[kind]]} ×${sv.toFixed(2)}]`;
  }
  score -= helpCost(task.type, t) * othersOnIt;
  const label = need ? need.label : atHome ? 'Home' : 'Stand by';
  return {
    lee,
    need,
    task,
    key: taskKey(task),
    dest,
    walk,
    score,
    tierWeight: tier ? L[tier] : -Infinity,
    label,
    why: (atHome && !need ? (surplus ? 'standing by with nothing to do while attached (surplus)' : 'home') : why) + statNote,
    needed: urgent || (atHome && !surplus),
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
    return 'no target';
  }
  if (task.type === 'repair') {
    const part = boat.parts[task.target];
    return isWrecked(part) ? 'wrecked' : 'patched';
  }
  if (task.type === 'bail') return 'dry';
  if (task.type === 'board') return 'nobody left to fight there';
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
    case 'repel':
      return 'Repel boarder';
    default:
      return 'stand by';
  }
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
  const boardingOpen = needs.some((n) => n.task.type === 'board');
  // Minimum home crew: boarding stops once only this many would be left aboard.
  const minHome = Math.max(0, Math.round(t.boarding.minHomeCrew));
  let aboard = all.filter((l) => l.deck === boat && !l.swing && l.task.type !== 'board').length;

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

  const options: Option[] = [];
  const keep = new Map<number, { option: Option | null; value: number }>();
  for (const lee of lees) {
    const mine: Option[] = [];
    let current: Option | null = null;
    const curKey = taskKey(lee.task);
    for (const need of [...needs, null]) {
      const k = need ? need.key : taskKey(IDLE);
      const others = need && need.task.type !== 'idle' ? othersOn(k, lee) : 0;
      if (need?.task.type === 'station' && others > 0) continue; // one Lee per station
      const o = evaluate(lee, need, others, boat, ctx, boardingOpen);
      if (!o) continue;
      mine.push(o);
      if (k === curKey) current = o;
    }
    mine.sort(compareOptions);
    lee.options = mine.slice(0, 4).map((o) => ({ label: o.label, score: Math.round(o.score) }));
    options.push(...mine);
    const committed = ctx.time - lee.taskSince < ai.commitTime;
    let value = -Infinity;
    if (current) {
      if (committed) value = Infinity;
      else value = current.score + (current.needed ? ai.stickiness : 0);
    }
    keep.set(lee.id, { option: current, value });
  }

  options.sort(compareOptions);
  const decided = new Set<number>();
  const takenStations = new Set<string>();
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
    const score = o.score - helpCost(o.task.type, t) * (joined.get(o.key) ?? 0);
    if (!isCurrent && score <= k.value) continue;
    if (o.task.type === 'board' && !isCurrent && aboard - 1 < minHome) continue;
    if (o.task.type === 'board' && !isCurrent) aboard--;
    else if (lee.task.type === 'board' && !isCurrent) aboard++;
    decided.add(lee.id);
    if (o.task.type === 'station') takenStations.add(o.key);
    if (isCurrent) {
      lee.score = o.score;
      if (lee.dest !== o.dest) setDestination(lee, o.dest, boat);
      continue;
    }
    if (o.task.type !== 'idle') joined.set(o.key, (joined.get(o.key) ?? 0) + 1);
    // Switch.
    const from = describeTask(lee.task, boat);
    const prev = k.option;
    const leaving =
      lee.task.type === 'idle' && !prev
        ? ''
        : !prev
          ? `abandoned ${from}: ${endedWhy(lee, boat, t)} → `
          : lee.task.type === 'idle'
            ? prev.why.includes('surplus')
              ? `${prev.why.replace(' (surplus)', '')} → `
              : ''
            : !prev.needed && o.task.type === 'board'
              ? `${from}: ${prev.why} → `
              : `left ${from} (${Math.round(prev.score)} < ${Math.round(o.score)}) → `;
    holders.get(taskKey(lee.task))?.delete(lee.id);
    if (!holders.has(o.key)) holders.set(o.key, new Set());
    holders.get(o.key)!.add(lee.id);
    lee.task = o.task;
    lee.taskSince = ctx.time;
    lee.score = score;
    lee.stats.switches++;
    const helping = (holders.get(o.key)?.size ?? 1) > 1 && o.task.type !== 'board' ? ' (helping)' : '';
    lee.reason = `${leaving}${o.label}: ${o.why}${helping}`;
    setDestination(lee, o.dest, boat);
  }

  // Anyone left without an option (its task ended and nothing else is open) stands by.
  for (const lee of lees) {
    if (decided.has(lee.id)) continue;
    if (keep.get(lee.id)!.option) continue;
    const from = describeTask(lee.task, boat);
    const why = endedWhy(lee, boat, t);
    lee.task = IDLE;
    lee.taskSince = ctx.time;
    lee.stats.switches++;
    lee.reason = `abandoned ${from}: ${why} → stand by`;
    setDestination(lee, lee.tile, boat);
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
      const target = ctx.links?.attachedTo(boat).find((b) => b.id === lee.task.target);
      const link = target ? ctx.links!.linkBetween(boat, target) : null;
      // One at a time over the rail, and only when there's room to land.
      const ready = ctx.time >= (boat.crew.nextSwingAt ?? -Infinity);
      if (target && link && !ctx.links!.castingOff(link) && ready) {
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
    const task = lee.task;
    if (task.type === 'repair') {
      const part = boat.parts[task.target];
      const st = structure(part);
      const cap = st.maxHp * Math.min(1, Math.max(0, t.crew.repairCeiling));
      const rate = t.crew.repairRate * leeStat(lee, 'repairRate', boat, t) * wet;
      const add = Math.max(0, Math.min(rate * dt, cap - st.hp));
      if (st.hp > 0 || t.crew.wreckedRepairable > 0) {
        st.hp += add;
        lee.stats.hpRepaired += add;
        out.repaired += add;
      }
      lee.progress = (lee.progress + dt * 0.9 * wet) % 1;
    } else if (task.type === 'bail') {
      const part = boat.parts[task.target];
      const rate = t.crew.bailRate * leeStat(lee, 'bailRate', boat, t) * wet;
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
        const rate = itemParam(t, tile.fixture.item, 'rate') * leeStat(lee, 'bailRate', boat, t) * wet;
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
  // Boarding hooks manned on the boat it leaves; boarding planks on the tile it leaves from.
  speed /= Math.max(0.05, from.side === lee.side ? from.fx.swing : 1);
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
  const link = ctx.links?.linkBetween(deck, lee.boat) ?? null;
  if (link && link.breakAt !== null) return `link breaking (${link.breakReason ?? 'released'})`;
  if (link?.castOff && link.castOff.side === lee.side) return 'casting off';
  if (isWounded(lee, ctx.tuning)) return `wounded (${Math.round((100 * lee.hp) / lee.maxHp)}% HP)`;
  if (deck.sinkingSince !== null) return `${boatLabel(deck)} is sinking`;
  if (sinkProgress(deck, ctx.tuning) >= ctx.tuning.boarding.evacuateAt) return `${boatLabel(deck)} about to sink`;
  if (!foesOn(deck, lee.side, lees).length) return `${boatLabel(deck)} deck clear`;
  return null;
}

/**
 * The boarder rules, for this crew's Lees standing on an enemy deck: swing home
 * when the deck is clear, sinking, or the link is breaking; otherwise walk to
 * the nearest enemy Lee (walking distance, then id) to fight it. Deterministic.
 */
export function thinkBoarders(boat: Boat, ctx: CrewContext): void {
  const lees = ctx.lees ?? boat.crew.lees;
  for (const lee of boat.crew.lees) {
    if (!lee.alive || lee.swing || lee.deck === boat) continue;
    const deck = lee.deck;
    const why = recallWhy(lee, ctx);
    if (why) {
      const link = ctx.links?.linkBetween(deck, boat) ?? null;
      if (link) {
        lee.retreating = isWounded(lee, ctx.tuning);
        if (startSwing(lee, boat, true, why, ctx.tuning, lees)) {
          lee.reason = `recall: ${why} → swinging home`;
          continue;
        }
        lee.reason = `recall: ${why} → waiting for room aboard`;
        if (!lee.engaged) continue;
      }
      if (!lee.engaged) lee.reason = `stranded on ${boatLabel(deck)}: ${why}`;
    }
    if (lee.engaged) {
      lee.reason = `boarding ${boatLabel(deck)}: engaged in melee`;
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
    lee.reason = `boarding ${boatLabel(deck)}: going for ${leeLabel(best)} at ${deck.grid.tiles[at].label}${dest === at ? '' : ' (crowded: closing in)'}`;
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
 * lookout tightens every gun's spread, a powder store speeds reloads, hooks
 * speed grapples and swings. Each counts only while a Lee is working it.
 */
export function updateMobility(boat: Boat, t: Tuning): void {
  let rowing = 0;
  let sailing = 0;
  let accuracy = 0;
  let reload = 1;
  let swing = 1;
  let grapple = 1;
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
        case 'hooks':
          grapple = Math.min(grapple, Math.max(0.05, itemParam(t, item, 'grapple')));
          swing = Math.min(swing, Math.max(0.05, itemParam(t, item, 'swing')));
          break;
        default:
          break;
      }
    }
  }
  const c = t.crew;
  boat.mobility.speed = mobilityFactor(c.oarBaseline, rowing, t);
  boat.mobility.turn = mobilityFactor(c.sailBaseline, sailing, t);
  boat.fx = { accuracy: 1 + accuracy, reload, swing, grapple };
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
