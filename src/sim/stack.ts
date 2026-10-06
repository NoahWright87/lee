// The refit stack: what sits on each tile, top to bottom, and how things move.
// One gesture everywhere: pick a thing, see where it can go, put it there.
//
//   inner tile (on the boat):        Lee → station (a gun or station, with its gun attachment) → floor
//   outer tile (just outside hull):  rail item → hull module
//   treasure slots (ship-wide)
//
// Moving a lower layer carries everything above it (a manned cannon brings its
// Lee). Whatever is at the destination swaps back to the source if it fits
// there; otherwise it goes to cargo. Pure functions on the run state, so the
// refit can preview a move on a copy before committing it.

import type { ItemDef } from '../config/items';
import { SHIPS } from '../config/ships';
import { attachmentSlotId, type Facing } from '../config/slots';
import { buildGrid, tileAtCell, type Grid } from './grid';
import { slotById } from './loadout';
import { canEquip, itemOf, settleMustPlace, treasureSlots, unequip, wearTrinket, type CrewMember, type RunState } from './run';
import type { Tuning } from '../config/tuning';

export type TileLayer = 'lee' | 'station' | 'floor';
export type EdgeLayer = 'rail' | 'hull';
export type Layer = TileLayer | EdgeLayer | 'treasure';

/** A place on the boat: an inner tile, an outer tile (an edge of an inner tile), or a treasure slot. */
export type Spot = { kind: 'tile'; col: number; row: number } | { kind: 'edge'; col: number; row: number; facing: Facing } | { kind: 'treasure'; i: number };

/** What's picked up: a layer of a spot on the boat, an item or a Lee from cargo, or a trinket a Lee wears. */
export type Pick =
  | { from: 'boat'; spot: Spot; layer: Layer }
  | { from: 'cargo'; uid: number }
  | { from: 'ashore'; member: number }
  | { from: 'worn'; member: number; index: number };

/** Where it can go: a spot on the boat, or (trinkets) a Lee by uid. */
export type Dest = { spot: Spot } | { member: number };

export const TILE_LAYERS: TileLayer[] = ['lee', 'station', 'floor'];
export const EDGE_LAYERS: EdgeLayer[] = ['rail', 'hull'];

const grids = new Map<string, Grid>();
function gridOf(run: RunState): Grid {
  let g = grids.get(run.ship);
  if (!g) {
    g = buildGrid(SHIPS[run.ship].layout);
    grids.set(run.ship, g);
  }
  return g;
}

export const spotKey = (s: Spot): string => (s.kind === 'tile' ? `t:${s.col},${s.row}` : s.kind === 'edge' ? `e:${s.col},${s.row}:${s.facing}` : `x:${s.i}`);
export const sameSpot = (a: Spot, b: Spot): boolean => spotKey(a) === spotKey(b);

/** Tile index of an inner tile (crew homes are tile indices). */
export function tileIndex(run: RunState, col: number, row: number): number {
  return tileAtCell(gridOf(run), col, row)?.index ?? -1;
}

/** The slot id holding a layer of a spot (Lees aren't in slots). */
export function slotOf(spot: Spot, layer: Layer): string | null {
  if (spot.kind === 'tile') return layer === 'station' ? `fix:${spot.col},${spot.row}` : layer === 'floor' ? `floor:${spot.col},${spot.row}` : null;
  if (spot.kind === 'edge') return layer === 'rail' ? `rail:${spot.col},${spot.row}:${spot.facing}` : layer === 'hull' ? `hull:${spot.col},${spot.row}:${spot.facing}` : null;
  return `treasure:${spot.i}`;
}

/** The crew member standing on an inner tile, or null. */
export function leeAt(run: RunState, spot: Spot): CrewMember | null {
  if (spot.kind !== 'tile') return null;
  const i = tileIndex(run, spot.col, spot.row);
  return run.crew.find((m) => m.home === i) ?? null;
}

/** Item uid in a layer of a spot, or null. */
export function itemAt(run: RunState, spot: Spot, layer: Layer): number | null {
  const slot = slotOf(spot, layer);
  return slot ? run.loadout[slot] ?? null : null;
}

/** The layers present at a spot, top first. */
export function stackAt(run: RunState, spot: Spot): Layer[] {
  if (spot.kind === 'tile') return TILE_LAYERS.filter((l) => (l === 'lee' ? !!leeAt(run, spot) : itemAt(run, spot, l) !== null));
  if (spot.kind === 'edge') return EDGE_LAYERS.filter((l) => itemAt(run, spot, l) !== null);
  return itemAt(run, spot, 'treasure') !== null ? ['treasure'] : [];
}

/** Every spot of the run's ship: inner tiles, outer tiles (every edge), treasure slots. */
export function allSpots(run: RunState, t: Tuning): Spot[] {
  const out: Spot[] = [];
  for (const tile of gridOf(run).tiles) {
    out.push({ kind: 'tile', col: tile.col, row: tile.row });
    for (const f of tile.edges) out.push({ kind: 'edge', col: tile.col, row: tile.row, facing: f });
  }
  for (let i = 0; i < treasureSlots(run, t); i++) out.push({ kind: 'treasure', i });
  return out;
}

/** The item a pick carries (null for a Lee). */
export function pickedItem(run: RunState, p: Pick): ItemDef | null {
  if (p.from === 'cargo') return itemOf(run, p.uid) ?? null;
  if (p.from === 'worn') return itemOf(run, run.crew.find((m) => m.uid === p.member)?.trinkets[p.index]) ?? null;
  if (p.from === 'boat' && p.layer !== 'lee') return itemOf(run, itemAt(run, p.spot, p.layer)) ?? null;
  return null;
}

/** The Lee a pick carries, or null. */
export function pickedLee(run: RunState, p: Pick): CrewMember | null {
  if (p.from === 'ashore') return run.crew.find((m) => m.uid === p.member) ?? null;
  if (p.from === 'boat' && p.layer === 'lee') return leeAt(run, p.spot);
  return null;
}

/** The layer an item goes into. */
export function layerFor(def: ItemDef): Layer | 'attachment' | 'trinket' {
  switch (def.category) {
    case 'gun':
    case 'station':
      return 'station';
    case 'floor':
      return 'floor';
    case 'rail':
      return 'rail';
    case 'hull':
      return 'hull';
    case 'treasure':
      return 'treasure';
    case 'attachment':
      return 'attachment';
    case 'trinket':
      return 'trinket';
  }
}

/** Can a station item sit at this tile (edge or interior slot)? */
function stationFits(run: RunState, uid: number | null, spot: Spot): boolean {
  if (uid === null) return true;
  const slot = slotOf(spot, 'station');
  return !!slot && canEquip(run, uid, slot);
}

/** Every place a pick can go (lit up green). */
export function destinations(run: RunState, p: Pick, t: Tuning): Dest[] {
  const spots = allSpots(run, t);
  const from = p.from === 'boat' ? p.spot : null;
  const notHere = (s: Spot) => !from || !sameSpot(s, from);
  const lee = pickedLee(run, p);
  if (lee) return spots.filter((s) => s.kind === 'tile' && notHere(s)).map((spot) => ({ spot }));
  const def = pickedItem(run, p);
  if (!def) return [];
  const layer = layerFor(def);
  if (layer === 'trinket') {
    const wearer = p.from === 'worn' ? p.member : null;
    return run.crew.filter((m) => m.uid !== wearer && m.trinkets.length > 0).map((m) => ({ member: m.uid }));
  }
  if (layer === 'attachment') {
    return spots.filter((s) => s.kind === 'tile' && itemOf(run, itemAt(run, s, 'station'))?.category === 'gun').map((spot) => ({ spot }));
  }
  const uid = p.from === 'cargo' ? p.uid : p.from === 'boat' ? itemAt(run, p.spot, p.layer) : null;
  return spots
    .filter((s) => notHere(s))
    .filter((s) => {
      if (layer === 'treasure') return s.kind === 'treasure';
      if (layer === 'rail' || layer === 'hull') return s.kind === 'edge';
      if (s.kind !== 'tile') return false;
      if (layer === 'floor') return true;
      return stationFits(run, uid, s);
    })
    .map((spot) => ({ spot }));
}

export function sameDest(a: Dest, b: Dest): boolean {
  if ('member' in a || 'member' in b) return 'member' in a && 'member' in b && a.member === b.member;
  return sameSpot(a.spot, b.spot);
}

/** One thing a move changed besides the thing moved: for labels ("Plating → cargo"). */
export interface Displaced {
  name: string;
  to: 'cargo' | 'ashore' | 'swap';
}

const nameOf = (run: RunState, uid: number | null | undefined) => itemOf(run, uid)?.name ?? '?';

/** Move an item between slots, with its gun attachment and facing; a gun leaving for cargo takes its attachment along. */
function moveItem(run: RunState, uid: number, from: string | null, to: string | null): void {
  if (from) delete run.loadout[from];
  if (to) run.loadout[to] = uid;
  const isGun = itemOf(run, uid)?.category === 'gun';
  if (!from || !isGun) return;
  const att = run.loadout[attachmentSlotId(from)];
  delete run.loadout[attachmentSlotId(from)];
  const f = run.facings[from];
  delete run.facings[from];
  if (!to) return;
  if (att !== undefined) run.loadout[attachmentSlotId(to)] = att;
  const slot = slotById(SHIPS[run.ship], to);
  if (f && (slot?.type === 'interior' || slot?.facings?.includes(f))) run.facings[to] = f;
}

/**
 * Swap one layer between two spots on the boat. An item that can't go back to
 * the other spot goes to cargo instead. Lees always swap.
 */
function swapLayer(run: RunState, a: Spot, b: Spot, layer: Layer, out: Displaced[], primary: boolean): void {
  if (layer === 'lee') {
    const la = leeAt(run, a);
    const lb = leeAt(run, b);
    const ia = a.kind === 'tile' ? tileIndex(run, a.col, a.row) : -1;
    const ib = b.kind === 'tile' ? tileIndex(run, b.col, b.row) : -1;
    if (la) {
      la.home = ib;
      la.job = null;
    }
    if (lb) {
      lb.home = ia;
      lb.job = null;
      if (primary) out.push({ name: lb.label, to: 'swap' });
    }
    return;
  }
  const sa = slotOf(a, layer)!;
  const sb = slotOf(b, layer)!;
  const ua = run.loadout[sa] ?? null;
  const ub = run.loadout[sb] ?? null;
  // Lift both out first, so attachments and facings travel cleanly.
  if (ua !== null) moveItem(run, ua, sa, null);
  if (ub !== null) moveItem(run, ub, sb, null);
  if (ua !== null) {
    if (layer === 'station' && !canEquip(run, ua, sb)) out.push({ name: nameOf(run, ua), to: 'cargo' });
    else moveItemKeep(run, ua, sa, sb);
  }
  if (ub !== null) {
    const fits = layer !== 'station' || canEquip(run, ub, sa);
    if (fits) {
      moveItemKeep(run, ub, sb, sa);
      if (primary) out.push({ name: nameOf(run, ub), to: 'swap' });
    } else out.push({ name: nameOf(run, ub), to: 'cargo' });
  }
}

/** Saved attachment/facing per slot while two stacks are lifted (see swapLayer). */
const lifted = new Map<string, { att?: number; facing?: Facing }>();
function moveItemKeep(run: RunState, uid: number, fromSlot: string, toSlot: string): void {
  run.loadout[toSlot] = uid;
  const keep = lifted.get(fromSlot);
  if (!keep) return;
  if (keep.att !== undefined) run.loadout[attachmentSlotId(toSlot)] = keep.att;
  const slot = slotById(SHIPS[run.ship], toSlot);
  if (keep.facing && (slot?.type === 'interior' || slot?.facings?.includes(keep.facing))) run.facings[toSlot] = keep.facing;
}

/** Remember the attachments and facings of the station slots of two spots, so swapLayer can re-seat them. */
function liftStations(run: RunState, spots: Spot[]): void {
  lifted.clear();
  for (const s of spots) {
    const slot = slotOf(s, 'station');
    if (!slot || s.kind !== 'tile') continue;
    lifted.set(slot, { att: run.loadout[attachmentSlotId(slot)], facing: run.facings[slot] });
  }
}

/**
 * Put a pick at a destination (commit). Returns what else moved, for labels.
 * Callers preview by applying to a copy (structuredClone) of the run.
 */
export function applyMove(run: RunState, p: Pick, d: Dest, _t?: Tuning): Displaced[] {
  const out: Displaced[] = [];
  const def = pickedItem(run, p);
  // Trinkets go onto Lees.
  if ('member' in d) {
    if (!def || def.category !== 'trinket') return out;
    const target = run.crew.find((m) => m.uid === d.member);
    if (!target) return out;
    const uid = p.from === 'cargo' ? p.uid : p.from === 'worn' ? run.crew.find((m) => m.uid === p.member)!.trinkets[p.index]! : null;
    if (uid === null) return out;
    let slot = target.trinkets.indexOf(null);
    if (slot < 0) {
      slot = 0;
      const old = target.trinkets[0]!;
      out.push({ name: nameOf(run, old), to: p.from === 'worn' ? 'swap' : 'cargo' });
      if (p.from === 'worn') {
        const src = run.crew.find((m) => m.uid === p.member)!;
        wearTrinket(run, uid, target.uid, 0);
        wearTrinket(run, old, src.uid, p.index);
        return out;
      }
    }
    wearTrinket(run, uid, target.uid, slot);
    return out;
  }
  const to = d.spot;
  // Boat → boat: swap the picked layer and everything above it.
  if (p.from === 'boat') {
    const layers: Layer[] = p.spot.kind === 'tile' ? TILE_LAYERS.slice(0, TILE_LAYERS.indexOf(p.layer as TileLayer) + 1) : p.spot.kind === 'edge' ? EDGE_LAYERS.slice(0, EDGE_LAYERS.indexOf(p.layer as EdgeLayer) + 1) : ['treasure'];
    liftStations(run, [p.spot, to]);
    for (const l of layers) swapLayer(run, p.spot, to, l, out, l === p.layer);
    lifted.clear();
    settleMustPlace(run);
    return out;
  }
  // A Lee from ashore: whoever stands there goes ashore.
  if (p.from === 'ashore') {
    const m = run.crew.find((x) => x.uid === p.member);
    if (!m || to.kind !== 'tile') return out;
    const there = leeAt(run, to);
    if (there) {
      there.home = null;
      there.job = null;
      out.push({ name: there.label, to: 'ashore' });
    }
    m.home = tileIndex(run, to.col, to.row);
    m.job = null;
    settleMustPlace(run);
    return out;
  }
  // An item from cargo (or a trinket off a Lee onto the boat: not allowed).
  if (p.from !== 'cargo' || !def) return out;
  const layer = layerFor(def);
  if (layer === 'attachment') {
    const gun = slotOf(to, 'station');
    if (!gun) return out;
    const slot = attachmentSlotId(gun);
    const old = run.loadout[slot];
    if (old !== undefined) out.push({ name: nameOf(run, old), to: 'cargo' });
    run.loadout[slot] = p.uid;
  } else {
    const slot = slotOf(to, layer as Layer);
    if (!slot) return out;
    const old = run.loadout[slot];
    if (old !== undefined) {
      out.push({ name: nameOf(run, old), to: 'cargo' });
      moveItem(run, old, slot, null);
    }
    run.loadout[slot] = p.uid;
  }
  settleMustPlace(run);
  return out;
}

/** Stow a pick: a Lee goes ashore, an item to cargo (a gun takes its attachment). */
export function stow(run: RunState, p: Pick): void {
  if (p.from === 'boat') {
    if (p.layer === 'lee') {
      const m = leeAt(run, p.spot);
      if (m) {
        m.home = null;
        m.job = null;
      }
      return;
    }
    const slot = slotOf(p.spot, p.layer);
    const uid = slot ? run.loadout[slot] : undefined;
    if (slot && uid !== undefined) {
      if (itemOf(run, uid)?.category === 'gun') {
        const att = run.loadout[attachmentSlotId(slot)];
        if (att !== undefined) unequip(run, att);
        delete run.facings[slot];
      }
      unequip(run, uid);
    }
    return;
  }
  if (p.from === 'worn') {
    const uid = run.crew.find((m) => m.uid === p.member)?.trinkets[p.index];
    if (uid !== null && uid !== undefined) unequip(run, uid);
  }
}
