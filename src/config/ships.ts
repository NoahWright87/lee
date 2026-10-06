// Ships are content, not code. A ship is a hull layout (src/config/boats.ts),
// typed slots at defined positions, a default loadout, a style blurb and tags.
// Its numbers (speed, turning, hull HP, leaks, crew limits, treasure slots)
// live in tuning.ships.<id> so they're live-tunable. Ships define no gun arcs
// and no AI: arcs come from guns, AI from the encounter, because the player and
// enemies can sail any ship.

import { FRIEND_SHIP, HARD_SHIP, SKIFF, SLOOP, type BoatLayout } from './boats';
import type { Facing, ShipSlot } from './slots';
import type { Tag } from './tags';

export interface ShipDef {
  id: string;
  /** Placeholder puns. */
  name: string;
  /** One-line style blurb. */
  style: string;
  blurb: string;
  layout: BoatLayout;
  /** Every slot except floors and gun attachments (those are implicit: one per tile / per gun). */
  slots: ShipSlot[];
  /** Slot id → item id. */
  defaults: Record<string, string>;
  tags: Tag[];
}

const edge = (col: number, row: number, facing: Facing): ShipSlot => ({ id: `fix:${col},${row}`, type: 'edge', tile: [col, row], facing });
const inner = (col: number, row: number, facing: Facing = 'bow'): ShipSlot => ({ id: `fix:${col},${row}`, type: 'interior', tile: [col, row], facing });
const rail = (col: number, row: number, facing: Facing): ShipSlot => ({ id: `rail:${col},${row}:${facing}`, type: 'rail', tile: [col, row], facing });
const hull = (part: string): ShipSlot => ({ id: `hull:${part}`, type: 'hull', part });
const fix = (col: number, row: number) => `fix:${col},${row}`;

export const SHIPS: Record<string, ShipDef> = {
  sloop: {
    id: 'sloop',
    name: 'Sloop',
    style: 'All-rounder',
    blurb: 'A bit of everything: the ship from the earlier phases, and the on-ramp.',
    layout: SLOOP,
    slots: [
      edge(0, 0, 'port'),
      edge(1, 0, 'port'),
      edge(3, 0, 'port'),
      edge(0, 2, 'starboard'),
      edge(1, 2, 'starboard'),
      edge(3, 2, 'starboard'),
      edge(4, 1, 'bow'),
      edge(0, 1, 'stern'),
      inner(1, 1),
      inner(2, 1),
      inner(3, 1),
      rail(4, 1, 'bow'),
      rail(2, 0, 'port'),
      rail(2, 2, 'starboard'),
      hull('bow'),
      hull('midship'),
    ],
    defaults: {
      [fix(0, 0)]: 'oars',
      [fix(0, 2)]: 'oars',
      [fix(1, 0)]: 'cannon',
      [fix(3, 0)]: 'cannon',
      [fix(1, 2)]: 'cannon',
      [fix(3, 2)]: 'cannon',
      [fix(2, 1)]: 'sail',
      [fix(3, 1)]: 'lookout',
    },
    tags: [],
  },
  skiff: {
    id: 'skiff',
    name: 'Skiff',
    style: 'Skirmisher',
    blurb: 'Small and fast, built to outrange. Shoot backward while you run. Weak if caught.',
    layout: SKIFF,
    slots: [
      edge(1, 0, 'port'),
      edge(2, 0, 'port'),
      edge(1, 2, 'starboard'),
      edge(2, 2, 'starboard'),
      edge(3, 1, 'bow'),
      edge(0, 0, 'stern'),
      edge(0, 2, 'stern'),
      inner(1, 1),
      inner(2, 1),
      rail(3, 0, 'port'),
      rail(3, 2, 'starboard'),
      hull('midship'),
      hull('stern'),
    ],
    defaults: {
      [fix(1, 0)]: 'oars',
      [fix(1, 2)]: 'oars',
      [fix(2, 0)]: 'longGun',
      [fix(2, 2)]: 'longGun',
      [fix(1, 1)]: 'sail',
    },
    tags: ['skirmish'],
  },
  friendship: {
    id: 'friendship',
    name: 'Friend Ship',
    style: 'Boarder',
    blurb: 'Long, narrow and fast with a big open deck and few guns: close in, soften them up, then flood their deck with Lees. Weak at range.',
    layout: FRIEND_SHIP,
    slots: [
      edge(0, 0, 'stern'),
      edge(1, 0, 'port'),
      edge(2, 0, 'port'),
      edge(3, 0, 'port'),
      edge(4, 0, 'port'),
      edge(5, 0, 'port'),
      edge(6, 0, 'port'),
      edge(0, 1, 'starboard'),
      edge(1, 1, 'starboard'),
      edge(2, 1, 'starboard'),
      edge(3, 1, 'starboard'),
      edge(4, 1, 'starboard'),
      edge(5, 1, 'starboard'),
      edge(6, 1, 'bow'),
      rail(6, 0, 'bow'),
      rail(6, 1, 'bow'),
      rail(3, 0, 'port'),
      rail(3, 1, 'starboard'),
      hull('bow'),
      hull('stern'),
    ],
    defaults: {
      [fix(6, 1)]: 'gatling',
      [fix(2, 0)]: 'oars',
      [fix(2, 1)]: 'oars',
      'rail:6,0:bow': 'spikes',
    },
    tags: ['board'],
  },
  hardship: {
    id: 'hardship',
    name: 'Hard Ship',
    style: 'Gunnery',
    blurb: 'Slow, tough and covered in guns: hard to catch, hard to sink, slow to react.',
    layout: HARD_SHIP,
    slots: [
      edge(1, 0, 'port'),
      edge(2, 0, 'port'),
      edge(3, 0, 'port'),
      edge(4, 0, 'port'),
      edge(1, 3, 'starboard'),
      edge(2, 3, 'starboard'),
      edge(3, 3, 'starboard'),
      edge(4, 3, 'starboard'),
      edge(5, 1, 'bow'),
      edge(5, 2, 'bow'),
      edge(0, 1, 'stern'),
      edge(0, 2, 'stern'),
      inner(1, 1),
      inner(3, 1),
      inner(2, 2),
      inner(4, 2),
      rail(5, 1, 'bow'),
      rail(2, 0, 'port'),
      rail(2, 3, 'starboard'),
      hull('bow'),
      hull('midship'),
      hull('stern'),
    ],
    defaults: {
      [fix(1, 0)]: 'cannon',
      [fix(3, 0)]: 'cannon',
      [fix(1, 3)]: 'cannon',
      [fix(3, 3)]: 'cannon',
      [fix(2, 0)]: 'carronade',
      [fix(2, 3)]: 'carronade',
      [fix(4, 0)]: 'oars',
      [fix(4, 3)]: 'oars',
      [fix(3, 1)]: 'sail',
      [fix(2, 2)]: 'powder',
    },
    tags: ['barrage'],
  },
};

export type ShipId = keyof typeof SHIPS;

export const SHIP_ORDER = ['sloop', 'skiff', 'friendship', 'hardship'];

export function shipName(id: string): string {
  return SHIPS[id]?.name ?? id;
}

/** Per-ship numbers (tuning.ships). Multipliers on the tuning.boat baseline. */
export function defaultShipStats() {
  const s = (o: { speed: number; turn: number; hullHp: number; leak: number; capacity: number; accel: number; crewMin: number; crewMax: number; treasures: number }) => o;
  return {
    sloop: s({ speed: 1, turn: 1, hullHp: 1, leak: 1, capacity: 1, accel: 1, crewMin: 4, crewMax: 8, treasures: 2 }),
    skiff: s({ speed: 1.35, turn: 1.3, hullHp: 0.7, leak: 1.2, capacity: 0.7, accel: 1.2, crewMin: 3, crewMax: 5, treasures: 1 }),
    // No interior slots means no sail: its turning comes from the hull (×1.5 of the no-sail baseline ≈ 0.9 of a crewed Sloop).
    friendship: s({ speed: 1.2, turn: 1.5, hullHp: 0.8, leak: 1, capacity: 0.75, accel: 1.15, crewMin: 6, crewMax: 12, treasures: 2 }),
    hardship: s({ speed: 0.65, turn: 0.6, hullHp: 1.6, leak: 1, capacity: 1.5, accel: 0.6, crewMin: 5, crewMax: 10, treasures: 3 }),
  };
}

export type ShipStats = ReturnType<typeof defaultShipStats>['sloop'];
