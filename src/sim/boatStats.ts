// Simplified boat stats for a crew placement, as if every Lee were at its home
// post. The setup screen shows these and previews how a move would change
// them, so each station's effect is visible before the fight. Uses the same
// formulas the fight does (reload, mobility, lookout range, repair rates).

import type { LeeDef } from '../config/lees';
import type { Tuning } from '../config/tuning';
import { advantageOf, boatTuning, type Boat } from './boat';
import { baseStat, mobilityFactor } from './crew';

export interface BoatStats {
  /** Damage per minute from the manned guns, if they all had a target. */
  firepower: number;
  /** Firepower with every gun manned (bar scale). */
  firepowerMax: number;
  guns: number;
  gunsTotal: number;
  /** Fraction of full speed / turn rate (1 = fully crewed). */
  speed: number;
  turning: number;
  /** Gun range, m, and the most it could be with every lookout manned. */
  range: number;
  rangeMax: number;
  /** Damage-control Lees and the HP/s they repair together. */
  repairers: number;
  repairRate: number;
  aboard: number;
}

/** Stats for `placement` (home tile per Lee, null = ashore) on `boat`'s grid. */
export function placementStats(boat: Boat, t: Tuning, placement: (number | null)[], def: LeeDef): BoatStats {
  const tiles = boat.grid.tiles;
  const ct = boatTuning(boat, t).cannons;
  const stat = (k: Parameters<typeof baseStat>[1]) => baseStat(def, k, boat.side, t);
  const reload = Math.max(0.1, ct.reloadTime / advantageOf(boat.side, t));
  const perGun = (60 / reload) * ct.damage;
  const count = (kind: string) => tiles.filter((x) => x.station === kind).length;
  const placed = placement.filter((p): p is number => p !== null && p >= 0 && p < tiles.length);
  const on = (kind: string | null) => placed.filter((p) => tiles[p].station === kind).length;

  const guns = on('cannon');
  const lookouts = count('lookout');
  return {
    firepower: guns * perGun * stat('loadSpeed'),
    firepowerMax: count('cannon') * perGun * stat('loadSpeed'),
    guns,
    gunsTotal: count('cannon'),
    speed: mobilityFactor(t.crew.oarBaseline, on('oars') * stat('rowStrength'), count('oars'), t),
    turning: mobilityFactor(t.crew.sailBaseline, on('sails') * stat('sailHandling'), count('sails'), t),
    range: ct.range * (1 + Math.max(0, t.crew.lookoutRange) * on('lookout') * stat('spotting')),
    rangeMax: ct.range * (1 + Math.max(0, t.crew.lookoutRange) * lookouts * stat('spotting')),
    repairers: on(null),
    repairRate: on(null) * t.crew.repairRate * stat('repairRate'),
    aboard: placed.length,
  };
}
