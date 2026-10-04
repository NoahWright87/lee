// Loadouts: which item sits in which slot of a ship, and what that does to a
// boat. Everything here reads content (ships, items) and tuning; nothing knows
// whether the boat is the player's or an enemy's.
//
// Effects are generic (config/items.ts): each names a scope (boat, a part, a
// tile, whoever stands on the tile, the gun an attachment is on, the whole
// crew, the wearer) and a stat. This file folds them into BoatMods once, when
// a boat is built.

import { ITEMS, type EffectDef, type ItemDef } from '../config/items';
import type { LeeStatKey } from '../config/lees';
import { SHIPS, type ShipDef } from '../config/ships';
import { attachmentSlotId, FACING_ANGLE, floorSlotId, type Facing, type ShipSlot, type SlotType } from '../config/slots';
import type { Tuning } from '../config/tuning';
import { labelTiles, tileAtCell, type Grid } from './grid';
import { pointInPolygon, type Vec } from './math';

/** What a boat is built from: a ship and what's in its slots. */
export interface BoatBuild {
  ship: string;
  /** Slot id → item id. */
  loadout: Record<string, string>;
  /** Interior guns: which way they face (defaults to the slot's facing). */
  facings?: Record<string, Facing>;
  /** Treasure item ids (up to the ship's treasure slots). */
  treasures?: string[];
}

/** Lee stat multipliers. */
export type StatMods = Partial<Record<LeeStatKey, number>>;

/** Everything a loadout and its treasures do to a boat, folded once at build time. */
export interface BoatMods {
  /** Boat-wide multipliers. */
  speed: number;
  turn: number;
  leak: number;
  gunRange: number;
  gunSpread: number;
  gunMinRange: number;
  /** Per part index: HP multiplier and armor layer. */
  partHp: number[];
  partArmor: number[];
  /** Flat HP added to every part. */
  hpFlat: number;
  /** Per tile index: durability multiplier, and stat multipliers for whoever stands there. */
  tileDurability: number[];
  occupant: StatMods[];
  /** Every Lee of the crew. */
  crew: StatMods;
}

export function itemParam(t: Tuning, item: string, name: string): number {
  const v = t.items[item]?.[name];
  if (typeof v === 'number') return v;
  return ITEMS[item]?.params[name] ?? 0;
}

function effectValue(t: Tuning, item: string, e: EffectDef): number {
  const v = t.items[item]?.[e.param] ?? ITEMS[item]?.params[e.param];
  return typeof v === 'number' ? v : e.op === 'mul' ? 1 : 0;
}

function fold(target: Record<string, number>, stat: string, e: EffectDef, v: number): void {
  if (e.op === 'mul') target[stat] = (target[stat] ?? 1) * v;
  else target[stat] = (target[stat] ?? 0) + v;
}

// ------------------------------------------------------------ slots

/** Every slot of a ship: its own list, a floor slot per tile, and an attachment slot per gun in the loadout. */
export function allSlots(ship: ShipDef, grid: Grid, loadout: Record<string, string> = {}): ShipSlot[] {
  const out = [...ship.slots];
  for (const tile of grid.tiles) out.push({ id: floorSlotId(tile.col, tile.row), type: 'floor', tile: [tile.col, tile.row] });
  for (const s of ship.slots) {
    if (ITEMS[loadout[s.id]]?.category === 'gun') out.push({ id: attachmentSlotId(s.id), type: 'attachment', gun: s.id });
  }
  return out;
}

/** A slot by id (floor and attachment slots included). */
export function slotById(ship: ShipDef, id: string): ShipSlot | undefined {
  const own = ship.slots.find((s) => s.id === id);
  if (own) return own;
  const floor = /^floor:(\d+),(\d+)$/.exec(id);
  if (floor) return { id, type: 'floor', tile: [Number(floor[1]), Number(floor[2])] };
  const att = /^att:(.+)$/.exec(id);
  if (att) return { id, type: 'attachment', gun: att[1] };
  return undefined;
}

export function fits(item: ItemDef | undefined, type: SlotType): boolean {
  return !!item && item.fits.includes(type);
}

/** A ship's default build (its default loadout, no treasures). */
export function defaultBuild(ship: string): BoatBuild {
  return { ship, loadout: { ...(SHIPS[ship]?.defaults ?? {}) }, facings: {}, treasures: [] };
}

/** Drop anything that doesn't belong: unknown items or slots, wrong slot types, attachments without a gun, extra treasures. */
export function cleanBuild(b: BoatBuild, t?: Tuning): BoatBuild {
  const ship = SHIPS[b.ship] ?? SHIPS.sloop;
  const loadout: Record<string, string> = {};
  for (const [slotId, item] of Object.entries(b.loadout)) {
    const slot = slotById(ship, slotId);
    if (!slot || !fits(ITEMS[item], slot.type)) continue;
    if (slot.type === 'floor' && !ship.layout.grid.parts[slot.tile![1]]?.trim().split(/\s+/)[slot.tile![0]]) continue;
    loadout[slotId] = item;
  }
  for (const slotId of Object.keys(loadout)) {
    const slot = slotById(ship, slotId)!;
    if (slot.type === 'attachment' && ITEMS[loadout[slot.gun!]]?.category !== 'gun') delete loadout[slotId];
  }
  const cap = t ? Math.max(0, Math.round(t.ships[ship.id]?.treasures ?? 0)) : Infinity;
  const treasures = (b.treasures ?? []).filter((i) => ITEMS[i]?.category === 'treasure').slice(0, cap);
  return { ship: ship.id, loadout, facings: { ...(b.facings ?? {}) }, treasures };
}

// ------------------------------------------------------------ building

/** Effects of every equipped item and treasure, with the slot each came from. */
function equipped(b: BoatBuild, ship: ShipDef): { item: string; slot: ShipSlot | null }[] {
  const out: { item: string; slot: ShipSlot | null }[] = [];
  for (const [slotId, item] of Object.entries(b.loadout)) {
    const slot = slotById(ship, slotId);
    if (slot && ITEMS[item]) out.push({ item, slot });
  }
  for (const item of b.treasures ?? []) if (ITEMS[item]) out.push({ item, slot: null });
  return out;
}

function tileOf(grid: Grid, slot: ShipSlot | null | undefined): number {
  if (!slot?.tile) return -1;
  return tileAtCell(grid, slot.tile[0], slot.tile[1])?.index ?? -1;
}

/** Fold every effect of a build into boat mods. */
export function computeMods(b: BoatBuild, grid: Grid, partIds: string[], partRoles: string[], t: Tuning): BoatMods {
  const ship = SHIPS[b.ship] ?? SHIPS.sloop;
  const n = partIds.length;
  const mods: BoatMods = {
    speed: 1,
    turn: 1,
    leak: 1,
    gunRange: 1,
    gunSpread: 1,
    gunMinRange: 1,
    partHp: Array(n).fill(1),
    partArmor: Array(n).fill(0),
    hpFlat: 0,
    tileDurability: grid.tiles.map(() => 1),
    occupant: grid.tiles.map(() => ({})),
    crew: {},
  };
  const boatStats = mods as unknown as Record<string, number>;
  for (const { item, slot } of equipped(b, ship)) {
    for (const e of ITEMS[item].effects) {
      const v = effectValue(t, item, e);
      switch (e.scope) {
        case 'boat':
          if (e.stat in mods && typeof boatStats[e.stat] === 'number') fold(boatStats, e.stat, e, v);
          break;
        case 'allParts':
          if (e.stat === 'hpFlat') mods.hpFlat += v;
          else if (e.stat === 'hp') for (let i = 0; i < n; i++) mods.partHp[i] *= e.op === 'mul' ? v : 1;
          break;
        case 'engine':
          for (let i = 0; i < n; i++) if (partRoles[i] === 'engine' && e.stat === 'hp') mods.partHp[i] *= v;
          break;
        case 'part': {
          const i = slot?.part ? partIds.indexOf(slot.part) : -1;
          if (i < 0) break;
          if (e.stat === 'armor') mods.partArmor[i] += v;
          else if (e.stat === 'hp') mods.partHp[i] *= v;
          break;
        }
        case 'tile': {
          const ti = tileOf(grid, slot);
          if (ti >= 0 && e.stat === 'durability') mods.tileDurability[ti] *= v;
          break;
        }
        case 'occupant': {
          const ti = tileOf(grid, slot);
          if (ti >= 0) fold(mods.occupant[ti] as Record<string, number>, e.stat, e, v);
          break;
        }
        case 'crew':
          fold(mods.crew as Record<string, number>, e.stat, e, v);
          break;
        default:
          // 'gun' (attachments) is read per gun; 'wearer' (trinkets) per Lee.
          break;
      }
    }
  }
  return mods;
}

/** Gun modifiers from the attachment on a gun slot. */
export function attachmentMods(b: BoatBuild, gunSlot: string, t: Tuning): { arc: number; reload: number; spread: number; gunnerImpact: number } {
  const out = { arc: 1, reload: 1, spread: 1, gunnerImpact: 1 };
  const item = b.loadout[attachmentSlotId(gunSlot)];
  if (!item || !ITEMS[item]) return out;
  for (const e of ITEMS[item].effects) {
    if (e.scope !== 'gun' || !(e.stat in out)) continue;
    fold(out as Record<string, number>, e.stat, e, effectValue(t, item, e));
  }
  return out;
}

/** Lee stat multipliers from a set of worn trinkets. */
export function trinketMods(trinkets: readonly string[], t: Tuning): StatMods {
  const out: Record<string, number> = {};
  for (const item of trinkets) {
    if (!ITEMS[item]) continue;
    for (const e of ITEMS[item].effects) if (e.scope === 'wearer') fold(out, e.stat, e, effectValue(t, item, e));
  }
  return out as StatMods;
}

/** Place a build's fixtures, rails and floors on a grid, set tile durability, and relabel. */
export function furnishGrid(b: BoatBuild, grid: Grid, layoutLabel: Parameters<typeof labelTiles>[0], mods: BoatMods, t: Tuning): void {
  const ship = SHIPS[b.ship] ?? SHIPS.sloop;
  for (const tile of grid.tiles) {
    tile.station = null;
    tile.fixture = null;
    tile.rails = [];
    tile.floor = null;
    tile.blown = false;
    tile.maxHp = Math.max(1, t.tiles.durability * mods.tileDurability[tile.index]);
    tile.hp = tile.maxHp;
  }
  for (const [slotId, item] of Object.entries(b.loadout)) {
    const def = ITEMS[item];
    const slot = slotById(ship, slotId);
    if (!def || !slot) continue;
    const ti = tileOf(grid, slot);
    if (ti < 0) continue;
    const tile = grid.tiles[ti];
    if (slot.type === 'edge' || slot.type === 'interior') {
      tile.fixture = { slot: slotId, item, destroyed: false };
      tile.station = def.category === 'gun' ? 'gun' : def.station ?? null;
    } else if (slot.type === 'rail' && def.rail) {
      const hp = def.rail === 'fence' ? Math.max(1, itemParam(t, item, 'hp')) : 1;
      tile.rails.push({ slot: slotId, item, kind: def.rail, facing: slot.facing ?? tile.edges[0] ?? 'port', hp, maxHp: hp, destroyed: false });
    } else if (slot.type === 'floor') {
      tile.floor = item;
    }
  }
  labelTiles(layoutLabel, grid.tiles, (i) => ITEMS[i]?.name ?? i);
}

/** Where a gun's muzzle sits (local frame): an edge gun at the hull edge it faces, an interior gun on its tile. */
export function muzzleLocal(polys: readonly (readonly Vec[])[], center: Vec, angle: number, edgeMount: boolean): Vec {
  if (!edgeMount) return { ...center };
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let d = 0;
  for (; d < 30; d += 0.1) {
    const p = { x: center.x + dx * d, y: center.y + dy * d };
    if (!polys.some((poly) => pointInPolygon(p, poly))) break;
  }
  return { x: center.x + dx * (d + 0.3), y: center.y + dy * (d + 0.3) };
}

/** Local angle a gun in this slot points. */
export function gunFacing(b: BoatBuild, slot: ShipSlot): number {
  const f = slot.type === 'interior' ? b.facings?.[slot.id] ?? slot.facing ?? 'bow' : slot.facing ?? 'port';
  return FACING_ANGLE[f];
}

/** Tags on a build (ship, every equipped item, treasures). */
export function buildTags(b: BoatBuild): string[][] {
  const ship = SHIPS[b.ship];
  const out: string[][] = [ship?.tags ?? []];
  for (const item of Object.values(b.loadout)) out.push(ITEMS[item]?.tags ?? []);
  for (const item of b.treasures ?? []) out.push(ITEMS[item]?.tags ?? []);
  return out;
}
