// The boat's stat card (refit screen): computed from a real Boat with its crew
// aboard, through the same functions the fight uses (motionParams, gunSpec,
// the crew's station effects), so it can't drift from how the boat behaves.

import type { Tuning } from '../config/tuning';
import { gunOnline, gunSpec, motionParams, type Boat } from './boat';
import { leeStat, workerAt } from './crew';
import { DEG } from './math';

export interface BoatCard {
  /** Top speed (m/s) and turn rate (deg/s) with this crew at their posts. */
  speed: number;
  turn: number;
  /** Total hull HP, armor included. */
  hullHp: number;
  /** Seconds from fully wrecked to the sink line (higher = more forgiving). */
  floodResist: number;
  /** Longest gun reach, m. */
  range: number;
  /** Degrees of the circle at least one gun can fire into. */
  arcCoverage: number;
  /** Damage per minute against hulls and against crew from manned guns (if every one had a target). */
  hullDpm: number;
  crewDpm: number;
  guns: number;
  gunsManned: number;
  /** Lees aboard, and the ship's limit. */
  crew: number;
  crewMax: number;
  /** HP/s from damage-control Lees at home. */
  repair: number;
}

export function boatCard(b: Boat, t: Tuning): BoatCard {
  const mp = motionParams(b, t);
  let hullHp = 0;
  let cap = 0;
  let leak = 0;
  for (const p of b.parts) {
    for (const l of p.layers) hullHp += l.maxHp;
    cap += p.capacity;
    leak += t.boat.flooding.leakRate * p.leakMultiplier;
  }
  let range = 0;
  let hullDpm = 0;
  let crewDpm = 0;
  let manned = 0;
  const bins = new Uint8Array(360);
  for (const g of b.guns) {
    if (!gunOnline(b, g, t)) continue;
    const spec = gunSpec(b, g, t);
    range = Math.max(range, spec.range);
    const face = g.face / DEG;
    const half = spec.arcHalf / DEG;
    for (let a = Math.floor(face - half); a <= Math.ceil(face + half); a++) {
      if (Math.abs(a - face) <= half + 1e-6) bins[((a % 360) + 360) % 360] = 1;
    }
    const gunner = workerAt(b, g.station);
    if (!gunner) continue;
    manned++;
    const perMin = (60 / spec.reload) * leeStat(gunner, 'loadSpeed', b, t);
    const shots = g.mode === 'burst' ? spec.pellets : 1;
    if (g.targets === 'hull') hullDpm += perMin * spec.damage * shots;
    crewDpm += perMin * spec.crewDamage * shots;
  }
  let repair = 0;
  for (const l of b.crew.lees) if (l.alive && !b.grid.tiles[l.home].station) repair += t.crew.repairRate * leeStat(l, 'repairRate', b, t);
  return {
    speed: mp.cruiseSpeed,
    turn: mp.turnRate / DEG,
    hullHp,
    floodResist: leak > 0 ? (cap * t.boat.flooding.sinkThreshold) / leak : Infinity,
    range,
    arcCoverage: bins.reduce((a, x) => a + x, 0),
    hullDpm,
    crewDpm,
    guns: b.guns.length,
    gunsManned: manned,
    crew: b.crew.lees.length,
    crewMax: Math.round(t.ships[b.type]?.crewMax ?? 0),
    repair,
  };
}

/** The refit's five stat bars, raw (the refit divides by tuning.refit's "full bar" values). */
export interface BoatBars {
  /** Damage per minute from manned guns (crew damage counts half). */
  firepower: number;
  /** Total hull HP, armor included. */
  toughness: number;
  /** Speed and turning with this crew, as a share of the baseline hull (60/40). */
  speed: number;
  /** The crew's sword power (damage × rate × HP, summed) × boarding range, plus anti-crew guns, spikes and planks. */
  boarding: number;
  /** Repair and bailing per second from Lees starting on plain deck (fixers), plus manned pumps. */
  repair: number;
}

export const BAR_KEYS: (keyof BoatBars)[] = ['firepower', 'toughness', 'speed', 'boarding', 'repair'];
export const BAR_NAMES: Record<keyof BoatBars, string> = { firepower: 'Firepower', toughness: 'Toughness', speed: 'Speed', boarding: 'Boarding', repair: 'Repair' };

export function boatBars(b: Boat, t: Tuning): BoatBars {
  const c = boatCard(b, t);
  const mv = t.boat.movement;
  let melee = 0;
  let repair = 0;
  for (const l of b.crew.lees) {
    if (!l.alive) continue;
    melee += leeStat(l, 'meleeDamage', b, t) * leeStat(l, 'meleeRate', b, t) * leeStat(l, 'hp', b, t);
    const tile = b.grid.tiles[l.home];
    if (l.job === 'fix') {
      repair += (t.crew.repairRate * leeStat(l, 'repairRate', b, t) + t.crew.bailRate * leeStat(l, 'bailRate', b, t)) / 2;
      if (tile.station === 'pump' && tile.fixture) repair += t.items[tile.fixture.item]?.rate ?? 0;
    }
  }
  let rails = 0;
  for (const tile of b.grid.tiles) for (const r of tile.rails) rails += r.kind === 'spikes' ? 0.6 : r.kind === 'planks' ? 0.4 : 0;
  return {
    firepower: c.hullDpm + c.crewDpm * 0.5,
    toughness: c.hullHp,
    speed: 0.6 * (c.speed / Math.max(1e-6, mv.cruiseSpeed)) + 0.4 * (c.turn / Math.max(1e-6, mv.turnRate)),
    boarding: melee * b.mods.boardRange + c.crewDpm / 150 + rails,
    repair,
  };
}
