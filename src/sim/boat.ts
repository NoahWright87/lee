// Boat state: parts with layered damage, flooding, the deck grid and its crew,
// cannons, and the derived movement stats that damage, water and crew feed into.

import type { BoatLayout, PartDef } from '../config/boats';
import type { BoatTuning, Side, Tuning } from '../config/tuning';
import type { CrewState } from './crew';
import { buildGrid, type Grid } from './grid';
import { clamp, DEG, distToPolygon, polygonCentroid, toLocal, type Vec } from './math';
import type { MotionParams, MotionState } from './steering';

/**
 * One layer of a part's damage stack. Damage hits layers top-first; overflow
 * carries down. The last layer is the part's own structure. Armor/plating
 * later = extra layers in front of it.
 */
export interface DamageLayer {
  kind: string;
  hp: number;
  maxHp: number;
}

export interface PartState {
  def: PartDef;
  index: number;
  /** Top layer first. The last entry is the structure. */
  layers: DamageLayer[];
  water: number;
  capacity: number;
  leakMultiplier: number;
  /** Local-frame centroid (cached). */
  center: Vec;
}

export interface CannonState {
  partIndex: number;
  /** The cannon station (tile index) a gunner works it from. */
  station: number;
  /** Mount point on the hull edge, local frame. */
  local: Vec;
  broadside: -1 | 1;
  /** Load progress 0..1; fires at 1. */
  load: number;
  /** World time it last fired (for recoil/smoke). */
  lastFired: number;
}

export interface Boat {
  id: number;
  side: Side;
  layout: BoatLayout;
  motion: MotionState;
  throttle: number;
  parts: PartState[];
  cannons: CannonState[];
  /** Point the helm is seeking, or null to hold course. */
  target: Vec | null;
  /** World time the boat crossed its sink line, or null. */
  sinkingSince: number | null;
  /** Total water that has leaked in (stat). */
  waterTaken: number;
  grid: Grid;
  crew: CrewState;
  /** Speed and turn multipliers from oars and sails, updated by the crew each step. */
  mobility: { speed: number; turn: number };
  /** Cannon range multiplier from manned lookouts (the lookout spots targets farther out). */
  rangeBonus: number;
}

export function advantageOf(side: Side, t: Tuning): number {
  return side === 'player' ? Math.max(0.1, t.global.playerAdvantage) : 1;
}

export function boatTuning(side: Side, t: Tuning): BoatTuning {
  return side === 'player' ? t.player : t.enemy;
}

export function createBoat(
  id: number,
  side: Side,
  layout: BoatLayout,
  t: Tuning,
  pos: Vec,
  heading: number,
): Boat {
  const bt = boatTuning(side, t);
  const adv = advantageOf(side, t);
  const parts: PartState[] = layout.parts.map((def, index) => {
    const s = bt.parts[def.stats];
    const hp = Math.max(1, s.hp * adv);
    return {
      def,
      index,
      layers: [{ kind: 'structure', hp, maxHp: hp }],
      water: 0,
      capacity: Math.max(0.1, s.waterCapacity),
      leakMultiplier: s.leakMultiplier / adv,
      center: polygonCentroid(def.polygon),
    };
  });

  // One cannon per cannon station, mounted on its part's outboard edge.
  const grid = buildGrid(layout);
  const cannons: CannonState[] = [];
  const perSide = { [-1]: 0, [1]: 0 } as Record<number, number>;
  for (const tile of grid.tiles) {
    const part = parts[tile.part];
    const side = part.def.broadside;
    if (tile.station !== 'cannon' || !side) continue;
    let edgeY = 0;
    for (const p of part.def.polygon) edgeY = side > 0 ? Math.max(edgeY, p.y) : Math.min(edgeY, p.y);
    const i = perSide[side]++;
    // Stagger initial loads so a broadside ripples instead of firing in lockstep.
    cannons.push({
      partIndex: part.index,
      station: tile.index,
      local: { x: tile.center.x, y: edgeY },
      broadside: side,
      load: 0.15 + 0.25 * i,
      lastFired: -99,
    });
  }

  const idle = bt.movement.idleSpeed;
  return {
    id,
    side,
    layout,
    motion: {
      x: pos.x,
      y: pos.y,
      heading,
      vx: Math.cos(heading) * idle,
      vy: Math.sin(heading) * idle,
      omega: 0,
      orbitSide: 0,
    },
    throttle: 1,
    parts,
    cannons,
    target: null,
    sinkingSince: null,
    waterTaken: 0,
    grid,
    crew: { lees: [], needs: [], thinkIn: 0 },
    mobility: { speed: 1, turn: 1 },
    rangeBonus: 1,
  };
}

// ---------------------------------------------------------------- damage

export function structure(part: PartState): DamageLayer {
  return part.layers[part.layers.length - 1];
}

export function structureFraction(part: PartState): number {
  const s = structure(part);
  return s.maxHp > 0 ? s.hp / s.maxHp : 0;
}

export function isWrecked(part: PartState): boolean {
  return structure(part).hp <= 0;
}

export interface DamageResult {
  /** Total HP removed across all layers. */
  dealt: number;
  /** HP removed from the structure layer only. */
  structureDamage: number;
}

/** Apply damage top layer first; overflow carries to the next layer down. */
export function applyDamage(part: PartState, amount: number): DamageResult {
  let left = Math.max(0, amount);
  let dealt = 0;
  let structureDamage = 0;
  for (let i = 0; i < part.layers.length && left > 0; i++) {
    const layer = part.layers[i];
    const take = Math.min(layer.hp, left);
    layer.hp -= take;
    left -= take;
    dealt += take;
    if (i === part.layers.length - 1) structureDamage += take;
  }
  return { dealt, structureDamage };
}

/** How far this boat's guns reach right now, m (base range × lookout). */
export function cannonRange(boat: Boat, t: Tuning): number {
  return boatTuning(boat.side, t).cannons.range * boat.rangeBonus;
}

export function cannonOnline(boat: Boat, cannon: CannonState, t: Tuning): boolean {
  if (boat.sinkingSince !== null) return false;
  const part = boat.parts[cannon.partIndex];
  return structureFraction(part) > boatTuning(boat.side, t).function.cannonOfflineAt;
}

// ---------------------------------------------------------------- water

export function totalWater(boat: Boat): number {
  let w = 0;
  for (const p of boat.parts) w += p.water;
  return w;
}

export function totalCapacity(boat: Boat): number {
  let c = 0;
  for (const p of boat.parts) c += p.capacity;
  return c;
}

/** Water as a fraction of the sink line: 0 = dry, 1 = sinking. */
export function sinkProgress(boat: Boat, t: Tuning): number {
  const line = boatTuning(boat.side, t).flooding.sinkThreshold * totalCapacity(boat);
  return line > 0 ? totalWater(boat) / line : 1;
}

/** Leak, spread, and bail. Returns water that leaked in this step. */
export function stepFlooding(boat: Boat, t: Tuning, dt: number): number {
  const f = boatTuning(boat.side, t).flooding;
  let leaked = 0;

  for (const part of boat.parts) {
    const damage = 1 - structureFraction(part);
    if (damage <= 0) continue;
    const want = f.leakRate * part.leakMultiplier * damage * dt;
    const room = part.capacity - part.water;
    const add = clamp(want, 0, Math.max(0, room));
    part.water += add;
    leaked += add;
  }

  // Spread: each bulkhead pair moves toward an even fill fraction.
  const k = 1 - Math.exp(-Math.max(0, f.spreadRate) * dt);
  if (k > 0) {
    for (const [aId, bId] of boat.layout.adjacency) {
      const a = boat.parts.find((p) => p.def.id === aId);
      const b = boat.parts.find((p) => p.def.id === bId);
      if (!a || !b) continue;
      const even = (a.water + b.water) / (a.capacity + b.capacity);
      const flow = (a.water - even * a.capacity) * k;
      a.water -= flow;
      b.water += flow;
    }
  }

  // Passive bilge: drain proportionally from every part.
  const total = totalWater(boat);
  if (total > 0 && f.bilgeRate > 0) {
    const drain = Math.min(total, f.bilgeRate * dt);
    for (const part of boat.parts) part.water = Math.max(0, part.water - (drain * part.water) / total);
  }

  boat.waterTaken += leaked;
  return leaked;
}

// ---------------------------------------------------------------- movement

/** Engine output multiplier from the engine part's HP. */
export function engineFactor(boat: Boat, t: Tuning): number {
  const min = boatTuning(boat.side, t).function.engineMinFactor;
  let factor = 1;
  for (const p of boat.parts) {
    if (p.def.role === 'engine') factor = Math.min(factor, min + (1 - min) * structureFraction(p));
  }
  return factor;
}

/** Speed and turn multipliers from water aboard. */
export function waterFactors(boat: Boat, t: Tuning): { speed: number; turn: number } {
  const f = boatTuning(boat.side, t).flooding;
  const x = Math.pow(clamp(sinkProgress(boat, t), 0, 1), Math.max(0.1, f.waterCurveExponent));
  return { speed: 1 - clamp(f.waterSpeedPenalty, 0, 1) * x, turn: 1 - clamp(f.waterTurnPenalty, 0, 1) * x };
}

/** Current movement stats after advantage, engine damage, flooding and crew (oars, sails). */
export function motionParams(boat: Boat, t: Tuning): MotionParams {
  const m = boatTuning(boat.side, t).movement;
  const adv = advantageOf(boat.side, t);
  const engine = engineFactor(boat, t);
  const water = waterFactors(boat, t);
  const sinking = boat.sinkingSince !== null;
  return {
    cruiseSpeed: m.cruiseSpeed * engine * water.speed * boat.mobility.speed,
    acceleration: m.acceleration,
    drag: sinking ? Math.max(m.drag, 1.5) : m.drag,
    turnRate: m.turnRate * DEG * Math.sqrt(adv) * engine * water.turn * boat.mobility.turn,
    turnAcceleration: m.turnAcceleration * DEG,
    lateralDrag: m.lateralDrag,
    turnSpeedLoss: m.turnSpeedLoss,
    throttle: sinking ? 0 : boat.throttle,
    orbitRadiusScale: m.orbitRadiusScale,
    orbitCapture: m.orbitCapture,
  };
}

// ---------------------------------------------------------------- geometry

/** The part at (or within `radius` of) a world point, nearest first. */
export function partAt(boat: Boat, world: Vec, radius: number): PartState | null {
  const local = toLocal(world, boat.motion, boat.motion.heading);
  let best: PartState | null = null;
  let bestD = Infinity;
  for (const p of boat.parts) {
    const d = distToPolygon(local, p.def.polygon);
    if (d <= radius && d < bestD) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

/** Distance from a world point to the nearest bit of hull. */
export function distanceToHull(boat: Boat, world: Vec): number {
  const local = toLocal(world, boat.motion, boat.motion.heading);
  let best = Infinity;
  for (const p of boat.parts) best = Math.min(best, distToPolygon(local, p.def.polygon));
  return best;
}
