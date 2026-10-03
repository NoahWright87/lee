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

import type { StationKind } from '../config/boats';
import { LEE_STAT_KEYS, WORK_STAT, type ActivityKind, type LeeDef, type LeeStatKey, type LeeStats, type WorkKind } from '../config/lees';
import type { LadderTier, Side, Tuning } from '../config/tuning';
import { boatTuning, cannonOnline, isWrecked, sinkProgress, structure, structureFraction, type Boat, type CannonState } from './boat';
import { pathTo, tileAt, type Tile } from './grid';
import { DEG, dist, toWorld, wrapAngle, type Vec } from './math';

export type TaskType = 'station' | 'repair' | 'bail' | 'idle';

export interface Task {
  type: TaskType;
  /** Station: tile index. Repair/bail: part index. Idle: -1. */
  target: number;
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
  /** Home tile: where it was placed. Sets its preferred role. */
  home: number;
  /** Last tile it reached. */
  tile: number;
  /** Position in the boat's local frame, m. */
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
  hurtAt: number;
  /** One-line "why am I doing this". */
  reason: string;
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
  /** Boats this crew's guns can shoot at (other side, afloat). */
  foes: Boat[];
}

const TYPE_ORDER: Record<TaskType, number> = { station: 0, repair: 1, bail: 2, idle: 3 };
const STATION_WORK: Record<StationKind, WorkKind> = { cannon: 'gun', oars: 'row', sails: 'sail', lookout: 'lookout' };
export const ROLE_NAMES: Record<WorkKind | 'damage', string> = {
  gun: 'Gunner',
  row: 'Rower',
  sail: 'Sail hand',
  lookout: 'Lookout',
  repair: 'Damage control',
  bail: 'Damage control',
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
  time: { gun: 0, row: 0, sail: 0, lookout: 0, repair: 0, bail: 0, walk: 0, idle: 0 },
  awayFromHome: 0,
  switches: 0,
});

/** Base stat for a Lee type from tuning (live), falling back to its content stats. */
function typeStat(def: LeeDef, key: LeeStatKey, t: Tuning): number {
  return t.lees[def.id]?.[key] ?? def.stats[key];
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
    hurtAt: -99,
    reason: `home: ${roleName(boat, home)}`,
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
    default:
      return null;
  }
}

/** What a Lee is doing right now, for icons and stats. */
export function activity(lee: Lee, boat: Boat): ActivityKind {
  if (!lee.working) return lee.path.length || dist(lee.pos, boat.grid.tiles[lee.dest].center) > 0.05 ? 'walk' : 'idle';
  return workKind(boat, lee.task) ?? 'idle';
}

// ------------------------------------------------------------ stats

/** A Lee's effective stat: type stat × player crew bonus × passive abilities (own and neighbors'). */
export function leeStat(lee: Lee, key: LeeStatKey, boat: Boat, t: Tuning): number {
  let v = typeStat(lee.def, key, t) * (lee.side === 'player' ? t.global.playerCrewStats : 1);
  for (const a of lee.def.abilities) {
    if (a.trigger === 'passive' && a.target === 'self' && a.stat === key) v *= a.multiply;
  }
  const here = boat.grid.tiles[lee.tile];
  for (const other of boat.crew.lees) {
    if (other === lee || !other.alive || !here.neighbors.includes(other.tile)) continue;
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

export function isWet(lee: Lee, boat: Boat, t: Tuning): boolean {
  const tile = tileAt(boat.grid, lee.pos, 1) ?? boat.grid.tiles[lee.tile];
  const part = boat.parts[tile.part];
  return part.capacity > 0 && part.water / part.capacity >= t.crew.wetThreshold;
}

// ------------------------------------------------------------ queries

export function liveLees(boat: Boat): Lee[] {
  return boat.crew.lees.filter((l) => l.alive);
}

/** The Lee working a station right now, if any. */
export function workerAt(boat: Boat, tile: number): Lee | null {
  for (const l of boat.crew.lees) {
    if (l.alive && l.working && l.task.type === 'station' && l.task.target === tile) return l;
  }
  return null;
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
  const ct = boatTuning(boat.side, ctx.tuning).cannons;
  const h = m.heading + m.omega * at;
  const muzzle = toWorld({ x: c.local.x, y: c.local.y + c.broadside * 0.8 }, { x: m.x + m.vx * at, y: m.y + m.vy * at }, h);
  const face = h + (c.broadside * Math.PI) / 2;
  for (const f of ctx.foes) {
    const p = { x: f.motion.x + f.motion.vx * at, y: f.motion.y + f.motion.vy * at };
    if (dist(muzzle, p) > ct.range) continue;
    if (Math.abs(wrapAngle(Math.atan2(p.y - muzzle.y, p.x - muzzle.x) - face)) <= ct.arc * DEG) return true;
  }
  return false;
}

// ------------------------------------------------------------ needs

const pct = (f: number) => `${Math.round(f * 100)}%`;

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
  const offlineAt = boatTuning(boat.side, t).function.cannonOfflineAt;

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
      out.push({ key, task, tier: 'idleCannon', base: L.idleCannon, label: tile.label, why: 'no target', cannon });
    } else if (tile.station === 'lookout') {
      out.push({ key, task, tier: 'lookout', base: L.lookout + span * 0.5, label: tile.label, why: 'lookout empty' });
    } else {
      // Oars slightly ahead of sails: speed is the bigger loss.
      const sev = tile.station === 'oars' ? 0.6 : 0.4;
      out.push({ key, task, tier: 'mobility', base: L.mobility + span * sev, label: tile.label, why: `${tile.station} empty` });
    }
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
function destFor(lee: Lee, task: Task, boat: Boat, t: Tuning): number {
  if (task.type === 'station') return task.target;
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

function evaluate(lee: Lee, need: Need | null, othersOnIt: number, boat: Boat, ctx: CrewContext): Option | null {
  const t = ctx.tuning;
  const ai = t.crewAI;
  const L = t.ladder;
  const task = need ? need.task : IDLE;
  const dest = destFor(lee, task, boat, t);
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
  // Walking costs the time an urgent task goes undone. Standing by, or a gun
  // with nothing to shoot, loses nothing on the way.
  const urgent = tier !== null && tier !== 'idleCannon';
  let score = base - (urgent ? ai.walkPenalty * walk : 0);
  if (atHome) score += ai.homeBonus;
  // Damage control's home job is standing by, ready.
  if (!need && atHome && !boat.grid.tiles[lee.home].station) score += ai.standbyBonus;
  const kind = workKind(boat, task);
  if (kind) {
    if (homeRole(lee, boat).includes(kind)) score += ai.roleBonus;
    score += lee.def.affinities[kind] ?? 0;
    score += ai.statAffinity * (leeStat(lee, WORK_STAT[kind], boat, t) - 1);
  }
  score -= ai.helpPenalty * othersOnIt;
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
    why: atHome && !need ? 'home' : why,
    needed: urgent || atHome,
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
    default:
      return 'stand by';
  }
}

/** One crew decision: every living Lee re-checks whether its current task is still its best use. */
export function thinkCrew(boat: Boat, ctx: CrewContext): void {
  const t = ctx.tuning;
  const ai = t.crewAI;
  const lees = liveLees(boat);
  const needs = computeNeeds(boat, ctx);
  boat.crew.needs = needs;

  // Who holds what right now (a Lee walking to a task holds its claim).
  const holders = new Map<string, Set<number>>();
  for (const l of lees) {
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
      const o = evaluate(lee, need, others, boat, ctx);
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
    const score = o.score - (o.task.type === 'idle' ? 0 : ai.helpPenalty * (joined.get(o.key) ?? 0));
    if (!isCurrent && score <= k.value) continue;
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
            ? ''
            : `left ${from} (${Math.round(prev.score)} < ${Math.round(o.score)}) → `;
    holders.get(taskKey(lee.task))?.delete(lee.id);
    if (!holders.has(o.key)) holders.set(o.key, new Set());
    holders.get(o.key)!.add(lee.id);
    lee.task = o.task;
    lee.taskSince = ctx.time;
    lee.score = score;
    lee.stats.switches++;
    const helping = (holders.get(o.key)?.size ?? 1) > 1 ? ' (helping)' : '';
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
}

/** Decide (on the think interval), walk, and work. Gun loading happens in the world (it owns cannons). */
export function stepCrew(boat: Boat, ctx: CrewContext, dt: number): CrewStepResult {
  const t = ctx.tuning;
  const out = { repaired: 0, bailed: 0 };
  if (boat.sinkingSince !== null) {
    for (const l of boat.crew.lees) l.working = false;
    updateMobility(boat, t);
    return out;
  }
  boat.crew.thinkIn -= dt;
  if (boat.crew.thinkIn <= 0) {
    thinkCrew(boat, ctx);
    boat.crew.thinkIn += Math.max(0.02, t.crewAI.thinkInterval);
    if (boat.crew.thinkIn <= 0) boat.crew.thinkIn = Math.max(0.02, t.crewAI.thinkInterval);
  }

  for (const lee of boat.crew.lees) {
    if (!lee.alive) continue;
    walk(lee, boat, t, dt);
    const act = activity(lee, boat);
    lee.stats.time[act] += dt;
    if (dist(lee.pos, boat.grid.tiles[lee.home].center) > 0.3) lee.stats.awayFromHome += dt;
    if (!lee.working) {
      lee.progress = 0;
      continue;
    }
    const wet = wetFactor(lee, boat, t);
    const task = lee.task;
    if (task.type === 'repair') {
      const part = boat.parts[task.target];
      const s = structure(part);
      const cap = s.maxHp * Math.min(1, Math.max(0, t.crew.repairCeiling));
      const rate = t.crew.repairRate * leeStat(lee, 'repairRate', boat, t) * wet;
      const add = Math.max(0, Math.min(rate * dt, cap - s.hp));
      if (s.hp > 0 || t.crew.wreckedRepairable > 0) {
        s.hp += add;
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

/** Oars set speed, sails set turning, the lookout sharpens the guns. Empty stations fall back to the baseline. */
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
      if (!l.alive || !l.working || l.task.type !== 'station') continue;
      const s = boat.grid.tiles[l.task.target].station;
      const wet = wetFactor(l, boat, t);
      if (s === 'oars') rowing += leeStat(l, 'rowStrength', boat, t) * wet;
      else if (s === 'sails') sailing += leeStat(l, 'sailHandling', boat, t) * wet;
      else if (s === 'lookout') spotting += leeStat(l, 'spotting', boat, t) * wet;
    }
  }
  const c = t.crew;
  const cap = Math.max(1, c.mobilityCap);
  const factor = (base: number, have: number, n: number) => {
    if (n === 0) return 1;
    const b = Math.min(1, Math.max(0, base));
    return b + (1 - b) * Math.min(cap, have / n);
  };
  boat.mobility.speed = factor(c.oarBaseline, rowing, oars);
  boat.mobility.turn = factor(c.sailBaseline, sailing, sails);
  boat.spotting = 1 + Math.max(0, c.lookoutBonus) * spotting;
}

// ------------------------------------------------------------ damage

export interface CrewHit {
  lee: Lee;
  damage: number;
  lost: boolean;
}

/** A shell lands at a local point: Lees on that tile take the hit, neighbors take splash. */
export function damageCrewAt(boat: Boat, local: Vec, t: Tuning, time: number): CrewHit[] {
  const struck: Tile | null = tileAt(boat.grid, local, 1.5);
  if (!struck) return [];
  const out: CrewHit[] = [];
  for (const lee of boat.crew.lees) {
    if (!lee.alive) continue;
    const on = tileAt(boat.grid, lee.pos, 1) ?? boat.grid.tiles[lee.tile];
    let dmg = 0;
    if (on.index === struck.index) dmg = t.crew.hitDamage;
    else if (struck.neighbors.includes(on.index)) dmg = t.crew.hitDamage * Math.max(0, t.crew.splashFraction);
    if (dmg <= 0) continue;
    lee.hp -= dmg;
    lee.hurtAt = time;
    const lost = lee.hp <= 0;
    if (lost) loseLee(lee, time);
    out.push({ lee, damage: dmg, lost });
  }
  if (out.some((h) => h.lost)) updateMobility(boat, t);
  return out;
}

function loseLee(lee: Lee, time: number): void {
  lee.hp = 0;
  lee.alive = false;
  lee.lostAt = time;
  lee.working = false;
  lee.path = [];
  lee.task = IDLE;
  lee.reason = 'lost overboard';
}
