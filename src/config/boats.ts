// Boat layouts are content, not code. A layout lists hull parts (shape in the
// boat's local frame, role, which stat block in tuning they read), which parts
// touch (for water spreading), and the deck grid. Local frame: +x toward the
// bow, +y to starboard, meters. What sits on the deck (guns, stations, rails,
// floors) comes from the ship's slots and loadout (src/config/ships.ts).

import type { Vec } from '../sim/math';
import type { PartStatKey } from './tuning';

/** 'side' = a hull section along one side (the old gun decks). */
export type PartRole = 'bow' | 'hull' | 'engine' | 'side';

/** Art slot a part draws from (see src/config/art.ts). */
export type PartArtKey = 'bow' | 'midship' | 'stern' | 'cannon';

export interface PartDef {
  id: string;
  label: string;
  role: PartRole;
  /** Which per-part stat block in tuning this part reads (hp, water capacity, leak). */
  stats: PartStatKey;
  art: PartArtKey;
  /** Draw the art mirrored top-to-bottom (starboard copies of port art). */
  flipArt?: boolean;
  polygon: Vec[];
  /** Side sections: which side of the boat. -1 = port, +1 = starboard. */
  broadside?: -1 | 1;
}

/**
 * The deck grid Lees stand on. Rows run port (top) to starboard (bottom),
 * columns stern (left) to bow (right), matching the close-up strip.
 * `parts` names the part each tile belongs to ('-' = no tile there).
 */
export interface GridDef {
  cols: number;
  rows: number;
  /** Tile size, m (x along the boat, y across it). */
  tileW: number;
  tileH: number;
  /** Local-frame corner of tile (0, 0): its stern-port corner. */
  origin: Vec;
  parts: string[];
}

export interface BoatLayout {
  id: string;
  length: number;
  beam: number;
  parts: PartDef[];
  /** Pairs of part ids that share a bulkhead; water spreads between them. */
  adjacency: [string, string][];
  grid: GridDef;
}

const rect = (x0: number, y0: number, x1: number, y1: number): Vec[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

const FIVE_PART_ADJACENCY: [string, string][] = [
  ['bow', 'midship'],
  ['bow', 'port'],
  ['bow', 'starboard'],
  ['midship', 'port'],
  ['midship', 'starboard'],
  ['midship', 'stern'],
  ['port', 'stern'],
  ['starboard', 'stern'],
];

const BEAM_THIRD = 5 / 3;

/** Basic Ship (the old Sloop): the all-rounder from the earlier phases. Five parts and a 5 × 3 deck. */
export const SLOOP: BoatLayout = {
  id: 'basic',
  length: 28,
  beam: 10,
  parts: [
    {
      id: 'bow',
      label: 'Bow',
      role: 'bow',
      stats: 'bow',
      art: 'bow',
      polygon: [
        { x: 7, y: -5 },
        { x: 10.5, y: -4.2 },
        { x: 14, y: 0 },
        { x: 10.5, y: 4.2 },
        { x: 7, y: 5 },
      ],
    },
    { id: 'port', label: 'Port side', role: 'side', stats: 'side', art: 'cannon', polygon: rect(-5, -5, 7, -BEAM_THIRD), broadside: -1 },
    { id: 'midship', label: 'Midship', role: 'hull', stats: 'midship', art: 'midship', polygon: rect(-5, -BEAM_THIRD, 7, BEAM_THIRD) },
    { id: 'starboard', label: 'Starboard side', role: 'side', stats: 'side', art: 'cannon', flipArt: true, polygon: rect(-5, BEAM_THIRD, 7, 5), broadside: 1 },
    {
      id: 'stern',
      label: 'Engine',
      role: 'engine',
      stats: 'stern',
      art: 'stern',
      polygon: [
        { x: -5, y: -5 },
        { x: -5, y: 5 },
        { x: -12.5, y: 4.6 },
        { x: -14, y: 3.4 },
        { x: -14, y: -3.4 },
        { x: -12.5, y: -4.6 },
      ],
    },
  ],
  adjacency: FIVE_PART_ADJACENCY,
  grid: {
    cols: 5,
    rows: 3,
    tileW: 4,
    tileH: 10 / 3,
    origin: { x: -9, y: -5 },
    parts: [
      'stern port      port      port      bow',
      'stern midship   midship   midship   bow',
      'stern starboard starboard starboard bow',
    ],
  },
};

const SK_THIRD = 8 / 3;

/** Long Distance Relation Ship (the old Skiff): small, quick, lightly built. A 4 × 3 deck. */
export const SKIFF: BoatLayout = {
  id: 'longdistance',
  length: 22,
  beam: 8,
  parts: [
    {
      id: 'bow',
      label: 'Bow',
      role: 'bow',
      stats: 'bow',
      art: 'bow',
      polygon: [
        { x: 4, y: -4 },
        { x: 7.5, y: -3.4 },
        { x: 11, y: 0 },
        { x: 7.5, y: 3.4 },
        { x: 4, y: 4 },
      ],
    },
    { id: 'port', label: 'Port side', role: 'side', stats: 'side', art: 'cannon', polygon: rect(-4, -4, 4, -SK_THIRD / 2), broadside: -1 },
    { id: 'midship', label: 'Midship', role: 'hull', stats: 'midship', art: 'midship', polygon: rect(-4, -SK_THIRD / 2, 4, SK_THIRD / 2) },
    { id: 'starboard', label: 'Starboard side', role: 'side', stats: 'side', art: 'cannon', flipArt: true, polygon: rect(-4, SK_THIRD / 2, 4, 4), broadside: 1 },
    {
      id: 'stern',
      label: 'Engine',
      role: 'engine',
      stats: 'stern',
      art: 'stern',
      polygon: [
        { x: -4, y: -4 },
        { x: -4, y: 4 },
        { x: -9.8, y: 3.7 },
        { x: -11, y: 2.7 },
        { x: -11, y: -2.7 },
        { x: -9.8, y: -3.7 },
      ],
    },
  ],
  adjacency: FIVE_PART_ADJACENCY,
  grid: {
    cols: 4,
    rows: 3,
    tileW: 4,
    tileH: SK_THIRD,
    origin: { x: -8, y: -4 },
    parts: [
      'stern port      port      bow',
      'stern midship   midship   bow',
      'stern starboard starboard bow',
    ],
  },
};

/**
 * Friend Ship (the boarder's longship): long, narrow and fast, a big open deck
 * of 7 × 2. No midship row: the two long sides are the main hull.
 */
export const FRIEND_SHIP: BoatLayout = {
  id: 'friend',
  length: 33,
  beam: 7,
  parts: [
    {
      id: 'bow',
      label: 'Bow',
      role: 'bow',
      stats: 'bow',
      art: 'bow',
      polygon: [
        { x: 9, y: -3.5 },
        { x: 12.5, y: -3 },
        { x: 16.5, y: 0 },
        { x: 12.5, y: 3 },
        { x: 9, y: 3.5 },
      ],
    },
    { id: 'port', label: 'Port side', role: 'side', stats: 'midship', art: 'midship', polygon: rect(-11, -3.5, 9, 0), broadside: -1 },
    { id: 'starboard', label: 'Starboard side', role: 'side', stats: 'midship', art: 'midship', flipArt: true, polygon: rect(-11, 0, 9, 3.5), broadside: 1 },
    {
      id: 'stern',
      label: 'Engine',
      role: 'engine',
      stats: 'stern',
      art: 'stern',
      polygon: [
        { x: -11, y: -3.5 },
        { x: -11, y: 3.5 },
        { x: -15, y: 3.2 },
        { x: -16.5, y: 2 },
        { x: -16.5, y: -2 },
        { x: -15, y: -3.2 },
      ],
    },
  ],
  adjacency: [
    ['bow', 'port'],
    ['bow', 'starboard'],
    ['port', 'starboard'],
    ['port', 'stern'],
    ['starboard', 'stern'],
  ],
  grid: {
    cols: 7,
    rows: 2,
    tileW: 4,
    tileH: 3.5,
    origin: { x: -15, y: -3.5 },
    parts: [
      'stern port      port      port      port      port      bow',
      'stern starboard starboard starboard starboard starboard bow',
    ],
  },
};

/** Hard Ship (the gunnery galleon): big, slow and heavily built. A 6 × 4 deck. */
export const HARD_SHIP: BoatLayout = {
  id: 'hard',
  length: 37,
  beam: 14,
  parts: [
    {
      id: 'bow',
      label: 'Bow',
      role: 'bow',
      stats: 'bow',
      art: 'bow',
      polygon: [
        { x: 10, y: -7 },
        { x: 14, y: -6 },
        { x: 18.5, y: 0 },
        { x: 14, y: 6 },
        { x: 10, y: 7 },
      ],
    },
    { id: 'port', label: 'Port side', role: 'side', stats: 'side', art: 'cannon', polygon: rect(-10, -7, 10, -3.5), broadside: -1 },
    { id: 'midship', label: 'Midship', role: 'hull', stats: 'midship', art: 'midship', polygon: rect(-10, -3.5, 10, 3.5) },
    { id: 'starboard', label: 'Starboard side', role: 'side', stats: 'side', art: 'cannon', flipArt: true, polygon: rect(-10, 3.5, 10, 7), broadside: 1 },
    {
      id: 'stern',
      label: 'Engine',
      role: 'engine',
      stats: 'stern',
      art: 'stern',
      polygon: [
        { x: -10, y: -7 },
        { x: -10, y: 7 },
        { x: -15.5, y: 6.4 },
        { x: -18.5, y: 4.8 },
        { x: -18.5, y: -4.8 },
        { x: -15.5, y: -6.4 },
      ],
    },
  ],
  adjacency: FIVE_PART_ADJACENCY,
  grid: {
    cols: 6,
    rows: 4,
    tileW: 5,
    tileH: 3.5,
    origin: { x: -15, y: -7 },
    parts: [
      'stern port      port      port      port      bow',
      'stern midship   midship   midship   midship   bow',
      'stern midship   midship   midship   midship   bow',
      'stern starboard starboard starboard starboard bow',
    ],
  },
};

/** Every layout the game can build (textures are generated for each). */
export const LAYOUTS: BoatLayout[] = [SLOOP, SKIFF, FRIEND_SHIP, HARD_SHIP];
