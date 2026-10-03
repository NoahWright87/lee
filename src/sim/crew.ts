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

import type { StationKind } from '../config/boats';
import { shipName } from '../config/ships';
import { LEE_STAT_KEYS, WORK_STAT, type ActivityKind, type LeeDef, type LeeStatKey, type LeeStats, type WorkKind } from '../config/lees';
import type { LadderTier, Side, Tuning } from '../config/tuning';
import type { AttachSystem } from './attach';
import { boatTuning, cannonOnline, cannonRange, isWrecked, keelSegment, sinkProgress, structure, structureFraction, type Boat, type CannonState } from './boat';
import { pathTo, tileAt, type Tile } from './grid';
import { closestOnSegment, DEG, dist, toLocal, toWorld, wrapAngle, type Vec } from './math';

export type TaskType = 'station' | 'repair' | 'bail' | 'idle' | 'board' | 'repel';

export interface Task {
  type: TaskType;
  /** Station: tile index. Repair/bail: part index. Board: boat id. Repel: the boarder's Lee id. Idle: -1. */
  target: number;
}

/** How a Lee was lost (result screen). */
export type LossCause = 'cannon' | 'melee' | 'pistol' | 'sank';

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
  def: LeeDef;
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
  /** Cannon stations: the gun (engagement is judged per Lee). */
  cannon?: CannonState;
  /** This station does nothing right now (attached: oars, sails, lookout with nothing to spot). */
  surplus?: boolean;
}

export interface CrewState {
  lees: Lee[];
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
const STATION_WORK: Record<StationKind, WorkKind> = { cannon: 'gun', oars: 'row', sails: 'sail', lookout: 'lookout' };
export const ROLE_NAMES: Record<WorkKind | 'damage', string> = {
  gun: 'Gunner',
  row: 'Rower',
  sail: 'Sail hand',
  lookout: 'Lookout',
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
  time: { gun: 0, row: 0, sail: 0, lookout: 0, repair: 0, bail: 0, board: 0, repel: 0, melee: 0, swing: 0, walk: 0, idle: 0 },
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
});

/** Base stat for a Lee type from tuning (live), falling back to its content stats. */
function typeStat(def: LeeDef, key: LeeStatKey, t: Tuning): number {
  return t.lees[def.id]?.[key] ?? def.stats[key];
}

/** A Lee type's stat for one side before abilities (what the setup screen previews). */
export function baseStat(def: LeeDef, key: LeeStatKey, side: Side, t: Tuning): number {
  return typeStat(def, key, t) * (side === 'player' ? t.global.playerCrewStats : 1);
}

/** Speed or turn multiplier from the crew on n stations: baseline when empty, 1 fully crewed at stat 1. */
export function mobilityFactor(baseline: number, have: number, n: number, t: Tuning): number {
  if (n === 0) return 1;
  const b = Math.min(1, Math.max(0, baseline));
  return b + (1 - b) * Math.min(Math.max(1, t.crew.mobilityCap), have / n);
}

export function createLee(id: number, number: number, def: LeeDef, side: Side, boat: Boat, home: number, t: Tuning): Lee {
  const tile = boat.grid.tiles[home];
  const maxHp = Math.max(1, t.crew.hp * typeStat(def, 'hp', t) * (side === 'player' ? t.global.playerCrewStats : 1));
  const task = homeTask(boat, home);
  return {
    id,
    number,
    def,
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

/** A Lee's effective stat: type stat × player crew bonus × passive abilities (own and neighbors'). */
export function leeStat(lee: Lee, key: LeeStatKey, _boat: Boat, t: Tuning): number {
  let v = typeStat(lee.def, key, t) * (lee.side === 'player' ? t.global.playerCrewStats : 1);
  for (const a of lee.def.abilities) {
    if (a.trigger === 'passive' && a.target === 'self' && a.stat === key) v *= a.multiply;
  }
  const here = lee.deck.grid.tiles[lee.tile];
  if (!here) return v;
  for (const other of lee.boat.crew.lees) {
    if (other === lee || !other.alive || other.deck !== lee.deck || other.swing || !here.neighbors.includes(other.tile)) continue;
    for (const a of other.def.abilities) {
      if (a.trigger === 'passive' && a.target === 'orthogonalNeighbors' && a.stat === key) v *= a.multiply;
    }
  }
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

/** Opposing boats linked to this one (link not breaking) that have enemy crew standing on them: somewhere to board. */
export function boardableFrom(boat: Boat, ctx: CrewContext): Boat[] {
  if (!ctx.links) return [];
  const lees = ctx.lees ?? boat.crew.lees;
  const evac = ctx.tuning.boarding.evacuateAt;
  const out: Boat[] = [];
  for (const l of ctx.links.linksOf(boat)) {
    if (l.breakAt !== null) continue;
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

/** Is the enemy in this gun's arc and range `at` seconds from now (straight-line prediction)? */
export function cannonEngages(boat: Boat, c: CannonState, ctx: CrewContext, at: number): boolean {
  const m = boat.motion;
  const ct = boatTuning(boat, ctx.tuning).cannons;
  const h = m.heading + m.omega * at;
  const muzzle = toWorld({ x: c.local.x, y: c.local.y + c.broadside * 0.8 }, { x: m.x + m.vx * at, y: m.y + m.vy * at }, h);
  const face = h + (c.broadside * Math.PI) / 2;
  for (const f of ctx.foes) {
    const p = { x: f.motion.x + f.motion.vx * at, y: f.motion.y + f.motion.vy * at };
    const d = dist(muzzle, p);
    if (d > cannonRange(boat, ctx.tuning) || d < ct.minRange) continue;
    if (Math.abs(wrapAngle(Math.atan2(p.y - muzzle.y, p.x - muzzle.x) - face)) <= ct.arc * DEG) return true;
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
  const offlineAt = boatTuning(boat, t).function.cannonOfflineAt;

  const attached = isAttached(boat, ctx);
  const attachedNames = attached && ctx.links ? ctx.links.attachedTo(boat).map((b) => boatLabel(b)).join(', ') : '';
  // While attached the lookout has nothing to spot unless some gun target is still out there.
  const spotting = !attached || ctx.foes.length > 0;

  // Stations, in tile order.
  for (const tile of boat.grid.tiles) {
    if (!tile.station) continue;
    const part = boat.parts[tile.part];
    if (isWrecked(part)) continue;
    const task: Task = { type: 'station', target: tile.index };
    const key = taskKey(task);
    if (tile.station === 'cannon') {
      const cannon = boat.cannons.find((c) => c.station === tile.index);
      if (!cannon || !cannonOnline(boat, cannon, t)) continue;
      out.push({ key, task, tier: 'idleCannon', base: L.idleCannon, label: tile.label, why: attached ? `no valid target (attached to ${attachedNames})` : 'no target', cannon });
    } else if (tile.station === 'lookout') {
      if (spotting) out.push({ key, task, tier: 'lookout', base: L.lookout + span * 0.5, label: tile.label, why: 'lookout empty' });
      else out.push({ key, task, tier: 'idleCannon', base: L.idleCannon, label: tile.label, why: 'nothing to spot', surplus: true });
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
      const offline = part.def.role === 'cannon' && f <= offlineAt;
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
  if (task.type === 'board') {
    const target = ctx?.links?.attachedTo(boat).find((b) => b.id === task.target);
    return target ? departureTile(boat, target) : -1;
  }
  if (task.type === 'repel') {
    const e = (ctx?.lees ?? []).find((l) => l.id === task.target);
    return e && e.alive && e.deck === boat && !e.swing ? standingTile(e) : -1;
  }
  if (task.type === 'idle') {
    // Home, unless someone else is working its home station right now.
    const other = workerAt(boat, lee.home);
    return other && other !== lee ? lee.tile : lee.home;
  }
  let best = -1;
  let bestCost = Infinity;
  for (const tile of boat.grid.tiles) {
    if (tile.part !== task.target) continue;
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
  const dest = destFor(lee, task, boat, t, ctx);
  if (dest < 0) return null;
  const walk = walkTime(lee, dest, boat, t);
  let tier: LadderTier | null = need ? need.tier : null;
  let base = need ? need.base : 0;
  let why = need ? need.why : 'nothing urgent';
  if (need?.cannon) {
    // Will this gun have something to shoot by the time I'm there (or shortly after)?
    const look = Math.max(0, ai.arcLookahead);
    const engage = cannonEngages(boat, need.cannon, ctx, walk) || cannonEngages(boat, need.cannon, ctx, walk + look);
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
  if (kind) {
    if (homeRole(lee, boat).includes(kind) && !surplus) score += ai.roleBonus;
    score += lee.def.affinities[kind] ?? 0;
    score += ai.statAffinity * (leeStat(lee, WORK_STAT[kind], boat, t) - 1);
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
    why: atHome && !need ? (surplus ? 'standing by with nothing to do while attached (surplus)' : 'home') : why,
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
    const c = boat.cannons.find((x) => x.station === tile.index);
    if (c && !cannonOnline(boat, c, t)) return 'offline';
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
  // Engaged Lees are forced to fight; boarders and swingers follow the boarder rules.
  const lees = all.filter((l) => l.deck === boat && !l.swing && !l.engaged);
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
}

/**
 * Decide (on the think interval), walk, swing and work. Gun loading happens in
 * the world (it owns cannons); melee and pistols in combat.ts.
 */
export function stepCrew(boat: Boat, ctx: CrewContext, dt: number): CrewStepResult {
  const t = ctx.tuning;
  const out: CrewStepResult = { repaired: 0, bailed: 0, boarded: [], returned: [] };
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
      const landed = stepSwing(lee, ctx, dt);
      lee.stats.time.swing += dt;
      lee.stats.awayFromHome += dt;
      if (landed) (lee.deck === boat ? out.returned : out.boarded).push(lee);
      lee.progress = 0;
      continue;
    }
    if (!lee.engaged) walk(lee, lee.deck, t, dt);
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
      if (target && link && link.breakAt === null) {
        lee.whyBoarded = lee.reason.split(' | ')[0];
        startSwing(lee, target, false, `swinging across to ${boatLabel(target)}`, t);
        lee.reason = `${lee.whyBoarded} | swinging across`;
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
      const c = boat.cannons.find((x) => x.station === task.target);
      if (c) lee.progress = c.load;
      else lee.progress = (lee.progress + dt * 0.7 * wet) % 1;
    } else {
      lee.progress = 0;
    }
  }
  updateMobility(boat, t);
  return out;
}

// ------------------------------------------------------------ boarding

/** Leap from the Lee's deck to `to`, landing on the tile nearest where it left. */
export function startSwing(lee: Lee, to: Boat, back: boolean, why: string, t: Tuning): void {
  const from = lee.deck;
  const world = toWorld(lee.pos, from.motion, from.motion.heading);
  const speed = Math.max(0.05, leeStat(lee, 'swingSpeed', lee.boat, t));
  lee.swing = {
    from,
    to,
    fromLocal: { ...lee.pos },
    toTile: landingTile(to, world),
    t: 0,
    dur: Math.max(0.05, t.boarding.swingTime / speed),
    back,
    why,
  };
  lee.engaged = false;
  lee.working = false;
  lee.path = [];
  lee.progress = 0;
}

/** Advance a swing. Returns true when the Lee lands. */
function stepSwing(lee: Lee, ctx: CrewContext, dt: number): boolean {
  const s = lee.swing!;
  s.t += dt;
  if (s.t < s.dur) return false;
  // Land.
  lee.swing = null;
  lee.deck = s.to;
  lee.tile = s.toTile;
  lee.pos = { ...s.to.grid.tiles[s.toTile].center };
  lee.path = [];
  lee.dest = s.toTile;
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
  }
  return true;
}

/** Why a boarder should leave the deck it's on, or null to stay and fight. */
export function recallWhy(lee: Lee, ctx: CrewContext): string | null {
  const deck = lee.deck;
  const lees = ctx.lees ?? lee.boat.crew.lees;
  const link = ctx.links?.linkBetween(deck, lee.boat) ?? null;
  if (link && link.breakAt !== null) return `link breaking (${link.breakReason ?? 'released'})`;
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
        startSwing(lee, boat, true, why, ctx.tuning);
        lee.reason = `recall: ${why} → swinging home`;
        continue;
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
      const d = deck.grid.dist[here][standingTile(f)];
      if (d < bestD - 1e-9 || (Math.abs(d - bestD) <= 1e-9 && best && f.id < best.id)) {
        bestD = d;
        best = f;
      }
    }
    if (!best) continue;
    const dest = standingTile(best);
    lee.reason = `boarding ${boatLabel(deck)}: going for ${leeLabel(best)} at ${deck.grid.tiles[dest].label}`;
    if (lee.dest !== dest || (!lee.path.length && lee.tile !== dest)) setDestination(lee, dest, deck);
  }
}

function walk(lee: Lee, boat: Boat, t: Tuning, dt: number): void {
  const g = boat.grid;
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

/** Oars set speed, sails set turning, the lookout extends gun range. Empty stations fall back to the baseline. */
export function updateMobility(boat: Boat, t: Tuning): void {
  let oars = 0;
  let sails = 0;
  let rowing = 0;
  let sailing = 0;
  let spotting = 0;
  for (const tile of boat.grid.tiles) {
    if (tile.station === 'oars') oars++;
    if (tile.station === 'sails') sails++;
  }
  if (boat.sinkingSince === null) {
    for (const l of boat.crew.lees) {
      if (!l.alive || !l.working || l.engaged || l.deck !== boat || l.task.type !== 'station') continue;
      const s = boat.grid.tiles[l.task.target].station;
      const wet = wetFactor(l, boat, t);
      if (s === 'oars') rowing += leeStat(l, 'rowStrength', boat, t) * wet;
      else if (s === 'sails') sailing += leeStat(l, 'sailHandling', boat, t) * wet;
      else if (s === 'lookout') spotting += leeStat(l, 'spotting', boat, t) * wet;
    }
  }
  const c = t.crew;
  boat.mobility.speed = mobilityFactor(c.oarBaseline, rowing, oars, t);
  boat.mobility.turn = mobilityFactor(c.sailBaseline, sailing, sails, t);
  boat.rangeBonus = 1 + Math.max(0, c.lookoutRange) * spotting;
}

// ------------------------------------------------------------ damage

export interface CrewHit {
  lee: Lee;
  damage: number;
  lost: boolean;
}

/**
 * A shell lands at a local point on `deck`: every Lee standing there (either
 * side; boarders too) takes the hit, neighbors take splash. `lees` defaults to
 * the deck's own crew.
 */
export function damageCrewAt(deck: Boat, local: Vec, t: Tuning, time: number, lees: Lee[] = deck.crew.lees): CrewHit[] {
  const struck: Tile | null = tileAt(deck.grid, local, 1.5);
  if (!struck) return [];
  const out: CrewHit[] = [];
  for (const lee of lees) {
    if (!lee.alive || lee.swing || lee.deck !== deck) continue;
    const on = tileAt(deck.grid, lee.pos, 1) ?? deck.grid.tiles[lee.tile];
    let dmg = 0;
    if (on.index === struck.index) dmg = t.crew.hitDamage;
    else if (struck.neighbors.includes(on.index)) dmg = t.crew.hitDamage * Math.max(0, t.crew.splashFraction);
    if (dmg <= 0) continue;
    const lost = hurtLee(lee, dmg, time, 'cannon');
    out.push({ lee, damage: dmg, lost });
  }
  if (out.some((h) => h.lost)) for (const b of new Set(out.map((h) => h.lee.boat))) updateMobility(b, t);
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
  lee.swing = null;
  lee.path = [];
  lee.task = IDLE;
  lee.reason = cause === 'sank' ? 'went down with the ship' : `lost overboard (${cause})`;
}
