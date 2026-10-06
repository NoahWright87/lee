// Ships are content, not code. A ship is a hull layout (src/config/boats.ts),
// its slots, a standard fit (enemies and the sandbox sail it), a hand-made
// PRESET (a new run starts with it: loadout, crew and where they stand), a
// style blurb and tags. Ships are always "{Something} Ship".
//
// Slots are generated from the layout: every deck tile takes a gun or station
// (an edge slot facing out on the edge, an interior slot inside; corners can
// face either of their two sides) and a floor; every edge of the hull has an
// outer tile just outside it with a rail slot (spikes, fence, planks) and a
// hull slot (plating, keel, rudder...). Outside corners have no slot.
//
// Its numbers (speed, turning, hull HP, leaks, crew limits, treasure slots)
// live in tuning.ships.<id> so they're live-tunable. Ships define no gun arcs
// and no AI: arcs come from guns, AI from the encounter.

import { FRIEND_SHIP, HARD_SHIP, SKIFF, SLOOP, type BoatLayout } from './boats';
import type { Job } from './lees';
import type { Facing, ShipSlot } from './slots';
import type { Tag } from './tags';

/** A Lee in a ship's preset: its type, where it starts, and (optionally) a starting job other than its tile's. */
export interface PresetLee {
  type: string;
  tile: [number, number];
  job?: Job;
}

export interface ShipPreset {
  /** Slot id → item id. */
  loadout: Record<string, string>;
  /** Guns that face another way than their slot's default. */
  facings?: Record<string, Facing>;
  treasures?: string[];
  crew: PresetLee[];
}

export interface ShipDef {
  id: string;
  /** "{Something} Ship". */
  name: string;
  /** One-line style blurb. */
  style: string;
  blurb: string;
  layout: BoatLayout;
  /** Every slot except gun attachments (one per gun, implicit). Generated from the layout. */
  slots: ShipSlot[];
  /** The standard fit: slot id → item id (enemies, the sandbox). */
  defaults: Record<string, string>;
  defaultTreasures?: string[];
  /** A new run starts with this. */
  preset: ShipPreset;
  tags: Tag[];
}

const DIRS: [number, number, Facing][] = [
  [0, -1, 'port'],
  [1, 0, 'bow'],
  [0, 1, 'starboard'],
  [-1, 0, 'stern'],
];

/** Every slot of a layout: a fixture and a floor on each tile, a rail and a hull module on each edge. */
export function layoutSlots(layout: BoatLayout): ShipSlot[] {
  const g = layout.grid;
  const has = (c: number, r: number) => c >= 0 && r >= 0 && c < g.cols && r < g.rows && ((g.parts[r] ?? '').trim().split(/\s+/)[c] ?? '-') !== '-';
  const out: ShipSlot[] = [];
  for (let row = 0; row < g.rows; row++) {
    for (let col = 0; col < g.cols; col++) {
      if (!has(col, row)) continue;
      const edges = DIRS.filter(([dc, dr]) => !has(col + dc, row + dr)).map(([, , f]) => f);
      const tile: [number, number] = [col, row];
      if (edges.length) {
        // A corner faces its side (a broadside) unless it's turned.
        const facing = edges.find((f) => f === 'port' || f === 'starboard') ?? edges[0];
        out.push({ id: `fix:${col},${row}`, type: 'edge', tile, facing, facings: edges });
      } else out.push({ id: `fix:${col},${row}`, type: 'interior', tile, facing: 'bow' });
      out.push({ id: `floor:${col},${row}`, type: 'floor', tile });
      for (const f of edges) {
        out.push({ id: `rail:${col},${row}:${f}`, type: 'rail', tile, facing: f });
        out.push({ id: `hull:${col},${row}:${f}`, type: 'hull', tile, facing: f });
      }
    }
  }
  return out;
}

const fix = (col: number, row: number) => `fix:${col},${row}`;
const rail = (col: number, row: number, f: Facing) => `rail:${col},${row}:${f}`;
const hull = (col: number, row: number, f: Facing) => `hull:${col},${row}:${f}`;
const lee = (type: string, col: number, row: number, job?: Job): PresetLee => ({ type, tile: [col, row], ...(job ? { job } : {}) });

export const SHIPS: Record<string, ShipDef> = {
  basic: {
    id: 'basic',
    name: 'Basic Ship',
    style: 'All-rounder',
    blurb: 'A bit of everything: a starboard broadside, oars and a sail. The on-ramp.',
    layout: SLOOP,
    slots: layoutSlots(SLOOP),
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
    preset: {
      // A real broadside to starboard (three cannons), one gun to port, oars and a sail.
      loadout: {
        [fix(1, 2)]: 'cannon',
        [fix(2, 2)]: 'cannon',
        [fix(3, 2)]: 'cannon',
        [fix(2, 0)]: 'cannon',
        [fix(0, 0)]: 'oars',
        [fix(2, 1)]: 'sail',
      },
      crew: [lee('quick', 2, 2), lee('basic', 3, 2), lee('basic', 0, 0), lee('handy', 1, 1)],
    },
    tags: [],
  },
  longdistance: {
    id: 'longdistance',
    name: 'Long Distance Relation Ship',
    style: 'Skirmisher',
    blurb: 'Small and fast, with long guns: keep your distance. Weak if caught.',
    layout: SKIFF,
    slots: layoutSlots(SKIFF),
    defaults: {
      [fix(1, 0)]: 'oars',
      [fix(1, 2)]: 'oars',
      [fix(2, 0)]: 'longGun',
      [fix(2, 2)]: 'longGun',
      [fix(1, 1)]: 'sail',
    },
    preset: {
      // Long guns to starboard and a bow chaser, oars to port.
      loadout: {
        [fix(1, 2)]: 'longGun',
        [fix(2, 2)]: 'longGun',
        [fix(3, 1)]: 'longGun',
        [fix(1, 0)]: 'oars',
        [fix(2, 0)]: 'oars',
        [fix(1, 1)]: 'sail',
      },
      crew: [lee('quick', 2, 2), lee('deft', 1, 0), lee('basic', 1, 2)],
    },
    tags: ['skirmish'],
  },
  friend: {
    id: 'friend',
    name: 'Friend Ship',
    style: 'Boarder',
    blurb: 'Long, narrow and fast with a big open deck and lots of Lees: close in, soften them up, then flood their deck. Weak at range.',
    layout: FRIEND_SHIP,
    slots: layoutSlots(FRIEND_SHIP),
    defaults: {
      [fix(6, 1)]: 'gatling',
      [fix(2, 0)]: 'oars',
      [fix(2, 1)]: 'oars',
      [rail(6, 0, 'bow')]: 'spikes',
    },
    defaultTreasures: ['ropes'],
    preset: {
      // Spikes on the bow, a Gatling facing forward, planks to starboard, and Swinging Ropes.
      loadout: {
        [fix(6, 1)]: 'gatling',
        [fix(4, 1)]: 'carronade',
        [fix(2, 0)]: 'oars',
        [fix(2, 1)]: 'oars',
        [rail(6, 0, 'bow')]: 'spikes',
        [rail(6, 1, 'bow')]: 'spikes',
        [rail(3, 1, 'starboard')]: 'planks',
      },
      facings: { [fix(6, 1)]: 'bow' },
      treasures: ['ropes'],
      crew: [lee('deft', 2, 0), lee('basic', 2, 1), lee('basic', 6, 1), lee('basic', 4, 1), lee('hard', 3, 1), lee('hard', 5, 0)],
    },
    tags: ['board'],
  },
  hard: {
    id: 'hard',
    name: 'Hard Ship',
    style: 'Gunnery',
    blurb: 'Slow, tough and covered in guns: plating and a heavy starboard broadside. Hard to catch, hard to sink, slow to react.',
    layout: HARD_SHIP,
    slots: layoutSlots(HARD_SHIP),
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
    preset: {
      loadout: {
        [fix(1, 3)]: 'cannon',
        [fix(2, 3)]: 'cannon',
        [fix(3, 3)]: 'cannon',
        [fix(4, 3)]: 'carronade',
        [fix(2, 0)]: 'cannon',
        [fix(4, 0)]: 'oars',
        [fix(3, 1)]: 'sail',
        [fix(2, 2)]: 'powder',
        [hull(2, 3, 'starboard')]: 'ironPlating',
        [hull(3, 3, 'starboard')]: 'ironPlating',
      },
      crew: [lee('quick', 2, 3), lee('quick', 3, 3), lee('basic', 1, 3), lee('basic', 4, 0), lee('handy', 2, 1)],
    },
    tags: ['barrage'],
  },
};

export type ShipId = keyof typeof SHIPS;

export const SHIP_ORDER = ['basic', 'longdistance', 'friend', 'hard'];

export function shipName(id: string): string {
  return SHIPS[id]?.name ?? id;
}

/** Per-ship numbers (tuning.ships). Multipliers on the tuning.boat baseline. */
export function defaultShipStats() {
  const s = (o: { speed: number; turn: number; hullHp: number; leak: number; capacity: number; accel: number; crewMin: number; crewMax: number; treasures: number }) => o;
  return {
    basic: s({ speed: 1, turn: 1, hullHp: 1, leak: 1, capacity: 1, accel: 1, crewMin: 4, crewMax: 8, treasures: 2 }),
    longdistance: s({ speed: 1.35, turn: 1.3, hullHp: 0.7, leak: 1.2, capacity: 0.7, accel: 1.2, crewMin: 3, crewMax: 5, treasures: 1 }),
    // No sail by default: its turning comes from the hull (×1.5 of the no-sail baseline ≈ 0.9 of a crewed Basic Ship).
    friend: s({ speed: 1.2, turn: 1.5, hullHp: 0.8, leak: 1, capacity: 0.75, accel: 1.15, crewMin: 6, crewMax: 12, treasures: 2 }),
    hard: s({ speed: 0.65, turn: 0.6, hullHp: 1.6, leak: 1, capacity: 1.5, accel: 0.6, crewMin: 5, crewMax: 10, treasures: 3 }),
  };
}

export type ShipStats = ReturnType<typeof defaultShipStats>['basic'];
