// The sea map between two ports: stops scattered on a sea 100 units wide,
// your boat at one of them, and a travel radius. Any stop within the radius is
// one hop away. Cleared stops stay; you can sail back through them.
//
// Generation (seeded by the run and the journey, so it's reproducible):
//  1. The guaranteed route: from the start port, hop ~90% of the radius toward
//     the destination (bending a little) until the destination is in reach.
//  2. Fill in: scatter more stops, each within reach of another, so the map
//     branches. No stop is ever out of reach of every other.
//  3. Each stop gets a type (weighted by the map's styles), maybe Fog, and
//     fights get a budget and their enemies (built now, so intel can show them).
//
// Time on the map is hops taken (`hops`): something chasing you later (the
// PUNishers) can move by it.

import type { EnemySpec } from '../config/encounters';
import { difficulty } from '../config/difficulty';
import { INTEL, MAP_STYLES, MODIFIERS, STOP_TYPES, type IntelDef, type MapStyleDef } from '../config/sea';
import { SHIPS } from '../config/ships';
import type { Tuning } from '../config/tuning';
import { budgetFor, dangerSkulls, generateEncounter } from './budget';
import type { NessSpec } from './ness';
import { chassisCost, itemCost, leeCost } from '../config/economy';
import { hashString, pickWeighted, rngFor as seededRng } from './math';
import { bankInterest, enterPort, type PortPlan } from './port';
import { buildGrid, tileAtCell } from './grid';
import { applyFreeFix, buildFor, cargoOver, earn, emptyPost, wreckReward, type RunState } from './run';

export interface Stop {
  id: number;
  x: number;
  y: number;
  /** Stop type id (src/config/sea.ts). */
  type: string;
  /** Modifier ids (Fog...). */
  mods: string[];
  /** Points (fights size their enemies with it; other stops their gold). */
  budget: number;
  /** Fights: the enemy ships, built at generation. */
  enemies: EnemySpec[];
  /** Fights: the sea monsters (alone in a lair, else alongside the ships). */
  nesses: NessSpec[];
  cleared: boolean;
  /** Depth here: journeys completed + progress across this map. */
  depth: number;
}

export interface SeaMap {
  /** Journeys completed when it was made. */
  journey: number;
  styles: string[];
  width: number;
  height: number;
  /** Travel radius on this map. */
  radius: number;
  /** Stop 0 is the port you left; `dest` is the one you're sailing to. */
  stops: Stop[];
  dest: number;
  /** The stop your boat is at. */
  at: number;
  /** Hops taken (the map's clock). */
  hops: number;
  /** The guaranteed route, start to destination (stop ids). */
  route: number[];
  /** The port waiting at the destination. */
  destPort: PortPlan;
}

const MARGIN = 6;

/** Map styles' numbers multiplied together. */
export function combinedStyle(ids: string[]): Omit<MapStyleDef, 'id' | 'name' | 'icon' | 'text' | 'chance'> {
  const out = { stops: 1, radius: 1, budget: 1, ness: 1, gold: 1, weights: {} as Record<string, number>, modifiers: {} as Record<string, number> };
  for (const id of ids) {
    const s = MAP_STYLES[id];
    if (!s) continue;
    out.stops *= s.stops;
    out.radius *= s.radius;
    out.budget *= s.budget;
    out.ness *= s.ness;
    out.gold *= s.gold;
    for (const [k, v] of Object.entries(s.weights)) out.weights[k] = (out.weights[k] ?? 1) * (v ?? 1);
    for (const [k, v] of Object.entries(s.modifiers)) out.modifiers[k] = (out.modifiers[k] ?? 1) * (v ?? 1);
  }
  return out;
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

/** Build the sea between the port you're leaving and the one you chose. */
export function generateMap(run: RunState, plan: PortPlan, t: Tuning): SeaMap {
  const M = t.map;
  const journey = run.journey;
  const rng = seededRng(run.seed, `map:${journey}:${hashString(plan.name)}`);
  const style = combinedStyle(plan.styles);
  const radius = Math.max(5, M.radius * style.radius);
  const width = 100;
  const length = Math.max(radius * 1.5, M.length * (1 + Math.max(0, M.lengthGrowth) * journey));
  const height = length + MARGIN * 2;
  const spacing = Math.max(2, M.spacing * Math.sqrt(style.radius));
  const stops: Stop[] = [];
  const add = (x: number, y: number, type: string): Stop => {
    const s: Stop = { id: stops.length, x, y, type, mods: [], budget: 0, enemies: [], nesses: [], cleared: false, depth: journey };
    stops.push(s);
    return s;
  };
  const start = add(width / 2, height - MARGIN, 'port');
  start.cleared = true;
  const dest = add(MARGIN * 2 + rng.next() * (width - MARGIN * 4), MARGIN, 'port');

  // 1. The guaranteed route.
  const route = [start.id];
  let cur = start;
  for (let guard = 0; guard < 200 && dist(cur, dest) > radius; guard++) {
    const base = Math.atan2(dest.y - cur.y, dest.x - cur.x);
    const wiggle = (rng.range(-1, 1) * Math.max(0, M.routeWiggle) * Math.PI) / 180;
    const hop = Math.min(radius * Math.min(1, Math.max(0.3, M.routeHop)), dist(cur, dest));
    let x = cur.x + Math.cos(base + wiggle) * hop;
    let y = cur.y + Math.sin(base + wiggle) * hop;
    x = Math.min(width - MARGIN, Math.max(MARGIN, x));
    y = Math.min(height - MARGIN, Math.max(MARGIN, y));
    // Always closer to the destination than the last hop (else straight at it).
    if (dist({ x, y }, dest) >= dist(cur, dest) - hop * 0.3) {
      x = cur.x + Math.cos(base) * hop;
      y = cur.y + Math.sin(base) * hop;
    }
    cur = add(x, y, 'fight');
    route.push(cur.id);
  }
  route.push(dest.id);

  // 2. Fill in: each new stop within reach of one already placed, none too close.
  const total = Math.max(route.length - 2, Math.round(M.stops * Math.pow(1 + Math.max(0, M.stopGrowth), journey) * style.stops));
  for (let tries = 0; tries < 4000 && stops.length - 2 < total; tries++) {
    const p = { x: MARGIN + rng.next() * (width - MARGIN * 2), y: MARGIN + rng.next() * (height - MARGIN * 2) };
    if (stops.some((s) => dist(s, p) < spacing)) continue;
    if (!stops.some((s) => dist(s, p) <= radius * 0.95)) continue;
    add(p.x, p.y, 'fight');
  }

  // 3. Types, modifiers, depth, budgets and enemies.
  const types = Object.values(STOP_TYPES)
    .filter((d) => d.effect !== 'port')
    .map((d) => [d.id, Math.max(0, t.stops[d.id]?.weight ?? d.weight) * (style.weights[d.id] ?? 1)] as [string, number]);
  const span = Math.max(1, start.y - dest.y);
  const diff = difficulty(run.difficulty);
  for (const s of stops) {
    s.depth = journey + Math.min(1, Math.max(0, (start.y - s.y) / span));
    if (s.type === 'port') continue;
    s.type = pickWeighted(rng, types) ?? 'fight';
    for (const m of Object.values(MODIFIERS)) if (rng.next() < m.chance * (style.modifiers[m.id] ?? 1)) s.mods.push(m.id);
    const def = STOP_TYPES[s.type];
    const mult = Math.max(0, t.stops[s.type]?.budget ?? def.budget) * (def.effect === 'fight' ? style.budget : 1);
    s.budget = budgetFor(s.depth, mult, rng, t, diff.growth);
    if (def.effect === 'fight') {
      // Sea monsters: all of it in a lair, else sometimes a share of the budget (more in Ness waters, fewer in crowded lanes).
      const chance = Math.min(0.95, Math.max(0, M.nessChance) * style.ness);
      const share = def.nessOnly ? 1 : rng.next() < chance ? rng.range(0.3, 0.7) : 0;
      const gen = generateEncounter(s.budget, (run.seed ^ hashString(`enemies:${journey}:${s.id}`)) >>> 0, t, { nessShare: share });
      s.enemies = gen.enemies;
      s.nesses = gen.nesses;
    }
  }
  return { journey, styles: [...plan.styles], width, height, radius, stops, dest: dest.id, at: start.id, hops: 0, route, destPort: plan };
}

/** Stops one hop from where you are (not counting where you are). */
export function inReach(map: SeaMap): number[] {
  const here = map.stops[map.at];
  return map.stops.filter((s) => s.id !== here.id && dist(s, here) <= map.radius + 1e-6).map((s) => s.id);
}

/** Can every stop be reached from the start? (generation test) */
export function connected(map: SeaMap): boolean {
  const seen = new Set([0]);
  const queue = [0];
  while (queue.length) {
    const a = map.stops[queue.shift()!];
    for (const b of map.stops) if (!seen.has(b.id) && dist(a, b) <= map.radius + 1e-6) (seen.add(b.id), queue.push(b.id));
  }
  return seen.size === map.stops.length;
}

// ------------------------------------------------------------ what you can see

/** Your ship's worth in points: the chassis, the crew at their levels, what's equipped and worn. */
export function playerValue(run: RunState): number {
  if (run.noHull) return 1;
  let v = chassisCost(run.ship);
  for (const m of run.crew) v += leeCost(m.type, m.level);
  const b = buildFor(run);
  for (const i of [...Object.values(b.loadout), ...(b.treasures ?? [])]) v += itemCost(i);
  for (const m of run.crew) for (const u of m.trinkets) if (u !== null) v += itemCost(run.items.find((x) => x.uid === u)?.item ?? '');
  return v;
}

/** Does the run own (and use) what grants an intel level? */
function grants(run: RunState, d: IntelDef): boolean {
  const src = d.source;
  if (src.kind === 'always') return true;
  if (src.kind === 'trinket') return run.crew.some((m) => m.trinkets.some((u) => u !== null && run.items.find((x) => x.uid === u)?.item === src.item));
  // A manned station: the item equipped on a fixture whose tile has a Lee placed on it.
  const grid = buildGrid(SHIPS[run.ship].layout);
  for (const [slot, uid] of Object.entries(run.loadout)) {
    if (run.items.find((x) => x.uid === uid)?.item !== src.item) continue;
    const m = /^fix:(\d+),(\d+)$/.exec(slot);
    const tile = m ? tileAtCell(grid, Number(m[1]), Number(m[2])) : null;
    if (tile && run.crew.some((x) => x.home === tile.index)) return true;
  }
  return false;
}

/** Intel levels you have right now ('chassis', 'crew', 'parts'). */
export function intel(run: RunState): Set<IntelDef['id']> {
  return new Set(INTEL.filter((d) => grants(run, d)).map((d) => d.id));
}

/** Is a stop hidden (Fog) until you arrive? */
export function hidden(stop: Stop): boolean {
  return !stop.cleared && stop.mods.some((m) => MODIFIERS[m]?.hides);
}

/** 1–5 skulls for a fight, relative to your ship. Null for stops that aren't fights. */
export function danger(run: RunState, stop: Stop, t: Tuning): number | null {
  if (STOP_TYPES[stop.type]?.effect !== 'fight') return null;
  return dangerSkulls(stop.budget, playerValue(run), t);
}

// ------------------------------------------------------------ sailing

/** Why you can't sail to that stop (null = you can). */
export function cantSail(run: RunState, stopId: number, t: Tuning): string | null {
  const map = run.map;
  if (!map || run.stage !== 'map') return 'Not at sea.';
  if (stopId === map.at) return 'You’re here.';
  if (!inReach(map).includes(stopId)) return 'Too far: sail closer first.';
  const over = cargoOver(run, t);
  if (over) return `The hold is ${over} over: throw something overboard first.`;
  if (!run.crew.some((m) => m.home !== null)) return 'Nobody is aboard.';
  return null;
}

/**
 * Sail to a stop in reach. Arriving does what the stop does: a fight sets up
 * (stage 'refit'), an event resolves (stage 'post'), the destination opens
 * its port (stage 'port'). A cleared stop does nothing.
 */
export function sailTo(run: RunState, stopId: number, t: Tuning): boolean {
  if (cantSail(run, stopId, t)) return false;
  const map = run.map!;
  map.at = stopId;
  map.hops++;
  const stop = map.stops[stopId];
  if (stopId === map.dest) {
    arrive(run, t);
    return true;
  }
  if (stop.cleared) return true;
  const def = STOP_TYPES[stop.type] ?? STOP_TYPES.fight;
  const style = combinedStyle(map.styles);
  if (def.effect === 'fight') {
    run.encounter = { stop: stop.id, type: stop.type, budget: stop.budget, enemies: structuredClone(stop.enemies), nesses: structuredClone(stop.nesses ?? []), gold: style.gold, special: !!def.special };
    run.stage = 'refit';
    return true;
  }
  // Events: resolved now, shown on the post screen.
  stop.cleared = true;
  const post = emptyPost(run, true);
  post.fight = run.fight;
  if (def.effect === 'salvage') {
    post.gold = earn(run, stop.budget * Math.max(0, t.spoils.salvage) * style.gold);
    post.event = { type: def.id, text: `You salvage ${post.gold} gold from the abandoned ship.` };
  } else if (def.effect === 'wreck') {
    post.reward = wreckReward(run, t, `${map.journey}:${stop.id}`);
    post.event = { type: def.id, text: 'Parts float in the wreckage. Take one.' };
  } else if (def.effect === 'cove') {
    const share = Math.min(1, Math.max(0, t.run.coveHeal));
    run.hull = run.hull.map((f) => f + (1 - f) * share);
    for (const m of run.crew) m.hp += (1 - m.hp) * share;
    post.repaired = share;
    post.healed = share;
    post.event = { type: def.id, text: 'Calm water. The crew patch the hull and rest.' };
  } else if (def.effect === 'castaway') {
    const types = ['basic', 'quick', 'deft', 'handy', 'loud', 'hard'];
    const rng = seededRng(run.seed, `castaway:${map.journey}:${stop.id}`);
    const type = types[Math.floor(rng.next() * types.length)];
    const level = Math.max(1, Math.round(stop.depth));
    post.reward = [{ kind: 'recruit', type, level }];
    post.event = { type: def.id, text: 'A lone Lee waves from a rock.' };
  }
  if (def.effect !== 'cove') applyFreeFix(run, post, t);
  run.pending = post;
  run.stage = 'post';
  return true;
}

/** Reach the destination: the journey is done; bank interest is paid; the port opens. */
export function arrive(run: RunState, t: Tuning): void {
  const map = run.map;
  if (!map) return;
  run.journey++;
  if (run.bankOwed > 0) {
    run.gold += run.bankOwed;
    run.totals.goldEarned += run.bankOwed;
  }
  run.bankOwed = 0;
  run.map = null;
  enterPort(run, map.destPort, t);
  run.stage = 'port';
}

/** Leave port for one of its offered destinations: the bank credits interest; the sea map is built. */
export function leavePort(run: RunState, offer: number, t: Tuning): boolean {
  const port = run.port;
  const plan = port?.offers[offer];
  if (!port || !plan) return false;
  run.bankOwed = bankInterest(run, t);
  run.map = generateMap(run, plan, t);
  run.port = null;
  run.stage = 'map';
  return true;
}

/** How deep the run is: journeys done plus progress across the current map. */
export function depthNow(run: RunState): number {
  const map = run.map;
  if (!map) return run.journey;
  return map.stops[map.at]?.depth ?? run.journey;
}
