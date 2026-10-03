// Close combat between Lees: swords on a shared tile (never miss, lowest-HP
// target first) and pistols at range (the one dice roll: same disk-scatter
// model as cannon spread). Neither sinks a boat; pistols barely scratch one.
// Weapons read their numbers from tuning.melee / tuning.pistol and each Lee's
// stats, so a new weapon is new data.

import type { Tuning } from '../config/tuning';
import { applyDamage, partAt, type Boat, type PartState } from './boat';
import { hurtLee, leeStat, standingTile, type Lee } from './crew';
import { dist, lerp, toWorld, type Rng, type Vec } from './math';

export interface CombatContext {
  tuning: Tuning;
  time: number;
  rng: Rng;
  /** Every Lee in the world. */
  lees: Lee[];
  boats: Boat[];
}

export type CombatEvent =
  | { type: 'melee'; attacker: Lee; target: Lee; damage: number; killed: boolean; pos: Vec }
  | { type: 'pistol'; shooter: Lee; target: Lee; from: Vec; to: Vec; hit: boolean; damage: number; killed: boolean; boat: Boat | null; part: PartState | null; boatDamage: number };

/** World position of a Lee (mid-swing: along an arc between the two decks). */
export function leeWorldPos(lee: Lee): Vec {
  const s = lee.swing;
  if (!s) return toWorld(lee.pos, lee.deck.motion, lee.deck.motion.heading);
  const a = toWorld(s.fromLocal, s.from.motion, s.from.motion.heading);
  const b = toWorld(s.to.grid.tiles[s.toTile].center, s.to.motion, s.to.motion.heading);
  const k = Math.min(1, s.t / Math.max(1e-6, s.dur));
  return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k) };
}

/** Mark every Lee that shares a tile with an opposing Lee as engaged (and pick its target). */
export function updateEngagement(lees: Lee[]): void {
  const byTile = new Map<string, Lee[]>();
  for (const l of lees) {
    l.engaged = false;
    l.meleeTarget = null;
    if (!l.alive || l.swing) continue;
    const k = `${l.deck.id}:${standingTile(l)}`;
    if (!byTile.has(k)) byTile.set(k, []);
    byTile.get(k)!.push(l);
  }
  for (const group of byTile.values()) {
    for (const l of group) {
      const target = meleeTarget(l, group);
      if (!target) continue;
      l.engaged = true;
      l.meleeTarget = target.id;
    }
  }
}

/** Deterministic: the opposing Lee on the tile with the lowest HP, ties by lowest id. */
function meleeTarget(lee: Lee, tile: Lee[]): Lee | null {
  let best: Lee | null = null;
  for (const o of tile) {
    if (o.side === lee.side || !o.alive) continue;
    if (!best || o.hp < best.hp - 1e-9 || (Math.abs(o.hp - best.hp) <= 1e-9 && o.id < best.id)) best = o;
  }
  return best;
}

/**
 * Sword hits. Every engaged Lee's swing timer runs at melee rate × its stat;
 * hits that land in the same step are resolved together, so nobody gets a
 * free first strike from update order.
 */
export function stepMelee(ctx: CombatContext, dt: number): CombatEvent[] {
  const t = ctx.tuning;
  const hits: { attacker: Lee; target: Lee; damage: number }[] = [];
  for (const l of ctx.lees) {
    if (!l.alive) continue;
    if (!l.engaged) {
      // Ready to strike half a beat after a fight starts.
      l.meleeCd = Math.min(l.meleeCd, 0.5);
      continue;
    }
    l.meleeCd -= dt * Math.max(0, t.melee.rate) * leeStat(l, 'meleeRate', l.boat, t);
    if (l.meleeCd > 0) continue;
    l.meleeCd += 1;
    const target = ctx.lees.find((o) => o.id === l.meleeTarget);
    if (!target) continue;
    hits.push({ attacker: l, target, damage: Math.max(0, t.melee.damage) * leeStat(l, 'meleeDamage', l.boat, t) });
  }
  const out: CombatEvent[] = [];
  for (const h of hits) {
    if (!h.target.alive) continue; // already killed by a hit resolved this step
    const killed = hurtLee(h.target, h.damage, ctx.time, 'melee');
    h.attacker.stats.meleeDealt += h.damage;
    h.target.stats.meleeTaken += h.damage;
    if (killed) h.attacker.stats.meleeKills++;
    out.push({ type: 'melee', attacker: h.attacker, target: h.target, damage: h.damage, killed, pos: leeWorldPos(h.target) });
  }
  return out;
}

/**
 * Pistols. Any living Lee that isn't swinging or in a sword fight fires at the
 * nearest opposing Lee in range (ties by id), whatever its task: shooting
 * doesn't pull a Lee off its post. The shot scatters in a disk (÷ accuracy)
 * that grows with distance; it hits the target if it lands close enough,
 * otherwise it may nick a hull.
 */
export function stepPistols(ctx: CombatContext, dt: number): CombatEvent[] {
  const t = ctx.tuning;
  const p = t.pistol;
  const out: CombatEvent[] = [];
  const range = Math.max(0, p.range);
  const hittable = t.boarding.swingHittable > 0;
  const where = new Map<number, Vec>();
  for (const l of ctx.lees) if (l.alive && (!l.swing || hittable)) where.set(l.id, leeWorldPos(l));
  for (const l of ctx.lees) {
    if (!l.alive || l.swing || l.engaged) continue;
    if (l.pistolCd > 0) l.pistolCd -= dt * Math.max(0, p.rate) * leeStat(l, 'pistolRate', l.boat, t);
    if (l.pistolCd > 0) continue;
    const from = where.get(l.id)!;
    let target: Lee | null = null;
    let bestD = Infinity;
    for (const o of ctx.lees) {
      if (o.side === l.side || !o.alive) continue;
      const at = where.get(o.id);
      if (!at) continue;
      const d = dist(from, at);
      if (d > range) continue;
      if (d < bestD - 1e-9 || (Math.abs(d - bestD) <= 1e-9 && target && o.id < target.id)) {
        bestD = d;
        target = o;
      }
    }
    if (!target) {
      l.pistolCd = 0; // ready the moment someone comes in range
      continue;
    }
    l.pistolCd = 1;
    l.firedAt = ctx.time;
    l.stats.pistolShots++;
    const aim = where.get(target.id)!;
    const accuracy = Math.max(0.05, leeStat(l, 'pistolAccuracy', l.boat, t));
    const off = ctx.rng.inDisk((Math.max(0, p.spread) + Math.max(0, p.spreadPerMeter) * bestD) / accuracy);
    const to = { x: aim.x + off.x, y: aim.y + off.y };
    const hit = dist(to, aim) <= Math.max(0, p.hitRadius);
    let killed = false;
    let damage = 0;
    let boat: Boat | null = null;
    let part: PartState | null = null;
    let boatDamage = 0;
    if (hit) {
      damage = Math.max(0, p.damage);
      killed = hurtLee(target, damage, ctx.time, 'pistol');
      l.stats.pistolHits++;
      l.stats.pistolDealt += damage;
    } else if (p.boatDamage > 0) {
      // A miss that lands on an opposing hull scratches it.
      for (const b of ctx.boats) {
        if (b.side === l.side || b.sinkingSince !== null) continue;
        const pt = partAt(b, to, 0);
        if (!pt) continue;
        boat = b;
        part = pt;
        boatDamage = applyDamage(pt, p.boatDamage).dealt;
        break;
      }
    }
    out.push({ type: 'pistol', shooter: l, target, from, to, hit, damage, killed, boat, part, boatDamage });
  }
  return out;
}
