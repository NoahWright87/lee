// Boat state: parts with layered damage, flooding, the deck grid and its crew,
// guns, and the derived movement stats that damage, water, equipment and crew
// feed into. A boat is a ship (layout, slots, numbers) plus a loadout: the
// same for the player and every enemy.

import type { BoatLayout, PartDef } from '../config/boats';
import type { AiProfile } from '../config/encounters';
import { ITEMS, type GunMode } from '../config/items';
import { SHIPS, type ShipDef, type ShipStats } from '../config/ships';
import type { Side, Tuning } from '../config/tuning';
import type { CrewState } from './crew';
import { buildGrid, type Grid } from './grid';
import { attachmentMods, cleanBuild, computeMods, furnishGrid, gunFacing, muzzleLocal, slotById, type BoatBuild, type BoatMods } from './loadout';
import { clamp, DEG, distToPolygon, polygonCentroid, toLocal, type Vec } from './math';
import type { MotionParams, MotionState } from './steering';

/**
 * One layer of a part's damage stack. Damage hits layers top-first; overflow
 * carries down. The last layer is the part's own structure. Armor (Iron
 * Plating) is an extra layer in front of it.
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

/** A gun on a boat: from its item and the slot it's mounted in. */
export interface GunState {
  /** Gun item id (key into ITEMS / tuning.items). */
  item: string;
  /** Slot it's mounted in. */
  slot: string;
  mode: GunMode;
  /** 'crew' guns (the gatling) aim at enemy Lees; 'hull' guns at boat parts. */
  targets: 'hull' | 'crew';
  partIndex: number;
  /** The tile a gunner works it from. */
  station: number;
  /** Muzzle, local frame. */
  local: Vec;
  /** Direction it points, local frame (radians; 0 = bow, +π/2 = starboard). */
  face: number;
  /** From its attachment (gun shield, wide mount). */
  mods: { arc: number; reload: number; spread: number; gunnerImpact: number };
  attachment: string | null;
  /** Load progress 0..1; fires at 1 (a stream gun: the next bullet). */
  load: number;
  /** World time it last fired (for recoil/smoke). */
  lastFired: number;
  /** What the gunner is aiming at for the next shot (rolled when loaded, cleared on firing). */
  aim: AimPlan | null;
}

/** A gunner's aim for one shot: which boat, which part, where on it, and how well it leads. */
export interface AimPlan {
  boatId: number;
  part: number;
  /** Offset from the part's center in the target's local frame, m. */
  offset: Vec;
  /** Lead multiplier (1 = perfect lead). */
  lead: number;
  /** Fraction of the target's current turn rate the gunner assumes it keeps up (0 = straight line). */
  turn: number;
}

/** What manned stations do right now (updated by the crew each step). */
export interface CrewEffects {
  /** Gun spread divisor from manned lookouts (1 = none). */
  accuracy: number;
  /** Reload time multiplier from manned powder stores (1 = none). */
  reload: number;
  /** Pit-stop bonuses while stopped: fixing (repair, bailing, pumping) and gunner aim (1 = none). */
  fix: number;
  aim: number;
}

export interface Boat {
  id: number;
  side: Side;
  /** Ship id (key into SHIPS / tuning.ships). */
  type: string;
  ship: ShipDef;
  build: BoatBuild;
  layout: BoatLayout;
  motion: MotionState;
  throttle: number;
  parts: PartState[];
  guns: GunState[];
  mods: BoatMods;
  /** Sandbox assist (playerAdvantage); 1 for enemies and in a run. */
  advantage: number;
  /** Enemy AI profile (null = steered by the player). */
  ai: AiProfile | null;
  /** Point the helm is seeking, or null to hold course. */
  target: Vec | null;
  /** The helm bends into an orbit around a close target (otherwise it seeks the point straight on). */
  orbit: boolean;
  /** Told to stop (sails down, coasting to a halt): the pit stop. */
  stopped: boolean;
  /** World time the boat crossed its sink line, or null. */
  sinkingSince: number | null;
  /** Total water that has leaked in (stat). */
  waterTaken: number;
  grid: Grid;
  crew: CrewState;
  /** Speed and turn multipliers from oars and sails, updated by the crew each step. */
  mobility: { speed: number; turn: number };
  fx: CrewEffects;
}

/** A ship's numbers (tuning.ships.<id>). */
export function shipStats(b: { type: string }, t: Tuning): ShipStats {
  return t.ships[b.type] ?? t.ships.basic ?? Object.values(t.ships)[0];
}

export interface BoatOptions {
  /** Sandbox assist: playerAdvantage (1 = none). */
  advantage?: number;
  ai?: AiProfile | null;
}

export function createBoat(id: number, side: Side, build: BoatBuild, t: Tuning, pos: Vec, heading: number, opts: BoatOptions = {}): Boat {
  const clean = cleanBuild(build, t);
  const ship = SHIPS[clean.ship];
  const layout = ship.layout;
  const ss = shipStats({ type: ship.id }, t);
  const adv = Math.max(0.1, opts.advantage ?? 1);
  const grid = buildGrid(layout);
  const mods = computeMods(clean, grid, layout.parts.map((p) => p.id), layout.parts.map((p) => p.role), t);
  const parts: PartState[] = layout.parts.map((def, index) => {
    const s = t.boat.parts[def.stats];
    const hp = Math.max(1, (s.hp * ss.hullHp * mods.partHp[index] + mods.hpFlat) * adv);
    const layers: DamageLayer[] = [];
    if (mods.partArmor[index] > 0) layers.push({ kind: 'armor', hp: mods.partArmor[index] * adv, maxHp: mods.partArmor[index] * adv });
    layers.push({ kind: 'structure', hp, maxHp: hp });
    return {
      def,
      index,
      layers,
      water: 0,
      capacity: Math.max(0.1, s.waterCapacity * ss.capacity),
      leakMultiplier: (s.leakMultiplier * ss.leak * mods.leak) / adv,
      center: polygonCentroid(def.polygon),
    };
  });

  furnishGrid(clean, grid, layout, mods, t);

  // One gun per gun fixture, its muzzle at the hull edge it faces (or on its tile, inside).
  const polys = layout.parts.map((p) => p.polygon);
  const guns: GunState[] = [];
  for (const tile of grid.tiles) {
    const fx = tile.fixture;
    const def = fx ? ITEMS[fx.item] : undefined;
    if (!fx || !def?.gun) continue;
    const slot = slotById(ship, fx.slot)!;
    const face = gunFacing(clean, slot);
    const attachment = clean.loadout[`att:${fx.slot}`] ?? null;
    guns.push({
      item: fx.item,
      slot: fx.slot,
      mode: def.gun.mode,
      targets: def.gun.targets,
      partIndex: tile.part,
      station: tile.index,
      local: muzzleLocal(polys, tile.center, face, slot.type === 'edge'),
      face,
      mods: attachmentMods(clean, fx.slot, t),
      attachment,
      // Stagger initial loads so a broadside ripples instead of firing in lockstep.
      load: 0.15 + 0.25 * (guns.length % 4),
      lastFired: -99,
      aim: null,
    });
  }

  const idle = t.boat.movement.idleSpeed;
  return {
    id,
    side,
    type: ship.id,
    ship,
    build: clean,
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
    guns,
    mods,
    advantage: adv,
    ai: opts.ai ?? null,
    target: null,
    orbit: true,
    stopped: false,
    sinkingSince: null,
    waterTaken: 0,
    grid,
    crew: { lees: [], needs: [], thinkIn: 0 },
    mobility: { speed: 1, turn: 1 },
    fx: { accuracy: 1, reload: 1, fix: 1, aim: 1 },
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

// ---------------------------------------------------------------- guns

/** A gun's live numbers: its item's multipliers on the standard cannon, the boat's mods, its attachment. */
export interface GunSpec {
  /** Half-width of the arc, radians (π = all the way around). */
  arcHalf: number;
  range: number;
  minRange: number;
  /** Seconds to load one shot (one bullet for a stream gun) at load speed 1. */
  reload: number;
  damage: number;
  crewDamage: number;
  spread: number;
  spreadPerMeter: number;
  shellSpeed: number;
  pellets: number;
  splash: number;
}

export function gunSpec(b: Boat, g: GunState, t: Tuning): GunSpec {
  const G = t.guns;
  const p = t.items[g.item] ?? ITEMS[g.item]?.params ?? {};
  const n = (k: string, d: number) => (typeof p[k] === 'number' ? p[k] : d);
  const arc = Math.min(360, Math.max(1, n('arc', 70) * g.mods.arc));
  return {
    arcHalf: (arc / 2) * DEG,
    range: G.range * n('range', 1) * b.mods.gunRange,
    minRange: G.minRange * n('minRange', 1) * b.mods.gunMinRange,
    reload: Math.max(0.05, (G.reloadTime * n('reload', 1) * g.mods.reload * b.fx.reload) / b.advantage),
    damage: G.damage * n('damage', 1),
    crewDamage: G.crewDamage * n('crewDamage', 1),
    spread: (G.spread * n('spread', 1) * b.mods.gunSpread * g.mods.spread) / Math.max(0.1, b.fx.accuracy * b.fx.aim),
    spreadPerMeter: (n('spreadPerMeter', 0) * b.mods.gunSpread * g.mods.spread) / Math.max(0.1, b.fx.accuracy * b.fx.aim),
    shellSpeed: Math.max(0.05, n('shellSpeed', 1)),
    pellets: Math.max(1, Math.round(n('pellets', 1))),
    splash: Math.max(1, n('splash', 1)),
  };
}

/** The longest reach of any of this boat's guns (setup ring, AI), m. */
export function maxGunRange(b: Boat, t: Tuning): number {
  let r = 0;
  for (const g of b.guns) r = Math.max(r, gunSpec(b, g, t).range);
  return r;
}

/** A gun works if its tile isn't blown out, its part is above the offline line, and the boat is afloat. */
export function gunOnline(boat: Boat, g: GunState, t: Tuning): boolean {
  if (boat.sinkingSince !== null) return false;
  const tile = boat.grid.tiles[g.station];
  if (tile?.fixture?.destroyed) return false;
  return structureFraction(boat.parts[g.partIndex]) > t.boat.function.gunOfflineAt;
}

/** Does any working gun sit on this part (so its HP gates them)? */
export function partHasGuns(boat: Boat, part: number): boolean {
  return boat.guns.some((g) => g.partIndex === part);
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
  const line = t.boat.flooding.sinkThreshold * totalCapacity(boat);
  return line > 0 ? totalWater(boat) / line : 1;
}

/** Leak, spread, and bail. Returns water that leaked in this step. */
export function stepFlooding(boat: Boat, t: Tuning, dt: number): number {
  const f = t.boat.flooding;
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

/**
 * Water let in by a hit. Anything the part can't hold spills into the parts it
 * shares a bulkhead with. Returns the water added.
 */
export function floodPart(boat: Boat, part: PartState, amount: number): number {
  let left = Math.max(0, amount);
  const take = (p: PartState, want: number) => {
    const add = Math.min(want, Math.max(0, p.capacity - p.water));
    p.water += add;
    return add;
  };
  let added = take(part, left);
  left -= added;
  if (left > 1e-9) {
    const next = boat.layout.adjacency
      .filter(([a, b]) => a === part.def.id || b === part.def.id)
      .map(([a, b]) => boat.parts.find((p) => p.def.id === (a === part.def.id ? b : a))!)
      .filter(Boolean);
    for (const p of next) added += take(p, left / next.length);
  }
  boat.waterTaken += added;
  return added;
}

// ---------------------------------------------------------------- movement

/** Engine output multiplier from the engine part's HP. */
export function engineFactor(boat: Boat, t: Tuning): number {
  const min = t.boat.function.engineMinFactor;
  let factor = 1;
  for (const p of boat.parts) {
    if (p.def.role === 'engine') factor = Math.min(factor, min + (1 - min) * structureFraction(p));
  }
  return factor;
}

/** Speed and turn multipliers from water aboard. */
export function waterFactors(boat: Boat, t: Tuning): { speed: number; turn: number } {
  const f = t.boat.flooding;
  const x = Math.pow(clamp(sinkProgress(boat, t), 0, 1), Math.max(0.1, f.waterCurveExponent));
  return { speed: 1 - clamp(f.waterSpeedPenalty, 0, 1) * x, turn: 1 - clamp(f.waterTurnPenalty, 0, 1) * x };
}

/** Current movement stats: ship × equipment × engine damage × flooding × crew (oars, sails). */
export function motionParams(boat: Boat, t: Tuning): MotionParams {
  const m = t.boat.movement;
  const ss = shipStats(boat, t);
  const engine = engineFactor(boat, t);
  const water = waterFactors(boat, t);
  const sinking = boat.sinkingSince !== null;
  return {
    cruiseSpeed: m.cruiseSpeed * ss.speed * boat.mods.speed * engine * water.speed * boat.mobility.speed,
    acceleration: m.acceleration * ss.accel,
    drag: sinking ? Math.max(m.drag, 1.5) : m.drag,
    turnRate: m.turnRate * ss.turn * boat.mods.turn * DEG * Math.sqrt(boat.advantage) * engine * water.turn * boat.mobility.turn,
    turnAcceleration: m.turnAcceleration * DEG,
    lateralDrag: m.lateralDrag,
    turnSpeedLoss: m.turnSpeedLoss,
    throttle: sinking || boat.stopped ? 0 : boat.throttle,
    orbitRadiusScale: m.orbitRadiusScale,
    orbitCapture: boat.orbit ? m.orbitCapture : 0,
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

/**
 * The hull as a capsule in the boat's local frame: a segment along the keel and
 * a radius of half the beam. Collisions, docking gaps and ram contact use it.
 */
export function hullCapsule(boat: Boat): { half: number; r: number } {
  const r = boat.layout.beam / 2;
  return { half: Math.max(0, boat.layout.length / 2 - r), r };
}

/** World endpoints of the keel segment. */
export function keelSegment(boat: Boat): [Vec, Vec] {
  const { half } = hullCapsule(boat);
  const m = boat.motion;
  const c = Math.cos(m.heading);
  const s = Math.sin(m.heading);
  return [
    { x: m.x - c * half, y: m.y - s * half },
    { x: m.x + c * half, y: m.y + s * half },
  ];
}

/** The bow tip in the local frame (the forward-most point of the bow part, or of the hull). */
export function bowTipLocal(boat: Boat): Vec {
  let x = -Infinity;
  for (const p of boat.parts) {
    if (p.def.role !== 'bow') continue;
    for (const v of p.def.polygon) x = Math.max(x, v.x);
  }
  return { x: Number.isFinite(x) ? x : boat.layout.length / 2, y: 0 };
}

/** A boat whose crew is all dead: it can't fire, row or bail, but it floats (and floods). */
export function isDerelict(boat: Boat): boolean {
  return boat.crew.lees.length > 0 && !boat.crew.lees.some((l) => l.alive);
}
