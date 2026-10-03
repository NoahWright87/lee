// Boat layouts are content, not code. A layout lists parts (shape in the boat's
// local frame, role, which stat block in tuning they read) and which parts touch
// (for water spreading). Local frame: +x toward the bow, +y to starboard, meters.

import type { Vec } from '../sim/math';
import type { PartStatKey } from './tuning';

export type PartRole = 'bow' | 'hull' | 'engine' | 'cannon';

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
  /** Cannon sections: which broadside their guns face. -1 = port, +1 = starboard. */
  broadside?: -1 | 1;
}

/** What standing on (and working) a tile does. Plain tiles have none. */
export type StationKind = 'cannon' | 'oars' | 'sails' | 'lookout';

/**
 * The deck grid Lees stand on. Rows run port (top) to starboard (bottom),
 * columns stern (left) to bow (right), matching the close-up strip.
 * `parts` names the part each tile belongs to ('-' = no tile there).
 * `stations` marks stations: C cannon, O oars, S sails, L lookout, . plain deck.
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
  stations: string[];
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

const BEAM_THIRD = 5 / 3;

/** A small warship: five parts and a 5 × 3 deck. Used for both boats in the prototype. */
export const SLOOP: BoatLayout = {
  id: 'sloop',
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
    {
      id: 'port',
      label: 'Port guns',
      role: 'cannon',
      stats: 'cannon',
      art: 'cannon',
      polygon: rect(-5, -5, 7, -BEAM_THIRD),
      broadside: -1,
    },
    {
      id: 'midship',
      label: 'Midship',
      role: 'hull',
      stats: 'midship',
      art: 'midship',
      polygon: rect(-5, -BEAM_THIRD, 7, BEAM_THIRD),
    },
    {
      id: 'starboard',
      label: 'Starboard guns',
      role: 'cannon',
      stats: 'cannon',
      art: 'cannon',
      flipArt: true,
      polygon: rect(-5, BEAM_THIRD, 7, 5),
      broadside: 1,
    },
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
  adjacency: [
    ['bow', 'midship'],
    ['bow', 'port'],
    ['bow', 'starboard'],
    ['midship', 'port'],
    ['midship', 'starboard'],
    ['midship', 'stern'],
    ['port', 'stern'],
    ['starboard', 'stern'],
  ],
  // Cannons sit on the cannon stations: two per broadside.
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
    stations: [
      'O C . C .',
      '. . S . L',
      'O C . C .',
    ],
  },
};

const FS_THIRD = 8 / 3;

/** Friend Ship (boarder): small, quick and lightly built, one gun a side and a lot of deck for a big crew. */
export const FRIEND_SHIP: BoatLayout = {
  id: 'friendship',
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
    { id: 'port', label: 'Port gun', role: 'cannon', stats: 'cannon', art: 'cannon', polygon: rect(-4, -4, 4, -FS_THIRD / 2), broadside: -1 },
    { id: 'midship', label: 'Midship', role: 'hull', stats: 'midship', art: 'midship', polygon: rect(-4, -FS_THIRD / 2, 4, FS_THIRD / 2) },
    {
      id: 'starboard',
      label: 'Starboard gun',
      role: 'cannon',
      stats: 'cannon',
      art: 'cannon',
      flipArt: true,
      polygon: rect(-4, FS_THIRD / 2, 4, 4),
      broadside: 1,
    },
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
  adjacency: [
    ['bow', 'midship'],
    ['bow', 'port'],
    ['bow', 'starboard'],
    ['midship', 'port'],
    ['midship', 'starboard'],
    ['midship', 'stern'],
    ['port', 'stern'],
    ['starboard', 'stern'],
  ],
  grid: {
    cols: 4,
    rows: 3,
    tileW: 4,
    tileH: FS_THIRD,
    origin: { x: -8, y: -4 },
    parts: [
      'stern port      port      bow',
      'stern midship   midship   bow',
      'stern starboard starboard bow',
    ],
    stations: [
      'O C . .',
      '. . S .',
      'O C . .',
    ],
  },
};

/** Hard Ship (heavy): long, slow and heavily built, three guns a side and two lookouts. */
export const HARD_SHIP: BoatLayout = {
  id: 'hardship',
  length: 40,
  beam: 14,
  parts: [
    {
      id: 'bow',
      label: 'Bow',
      role: 'bow',
      stats: 'bow',
      art: 'bow',
      polygon: [
        { x: 12.5, y: -7 },
        { x: 16.5, y: -6 },
        { x: 20, y: 0 },
        { x: 16.5, y: 6 },
        { x: 12.5, y: 7 },
      ],
    },
    { id: 'port', label: 'Port guns', role: 'cannon', stats: 'cannon', art: 'cannon', polygon: rect(-12.5, -7, 12.5, -3.5), broadside: -1 },
    { id: 'midship', label: 'Midship', role: 'hull', stats: 'midship', art: 'midship', polygon: rect(-12.5, -3.5, 12.5, 3.5) },
    {
      id: 'starboard',
      label: 'Starboard guns',
      role: 'cannon',
      stats: 'cannon',
      art: 'cannon',
      flipArt: true,
      polygon: rect(-12.5, 3.5, 12.5, 7),
      broadside: 1,
    },
    {
      id: 'stern',
      label: 'Engine',
      role: 'engine',
      stats: 'stern',
      art: 'stern',
      polygon: [
        { x: -12.5, y: -7 },
        { x: -12.5, y: 7 },
        { x: -18, y: 6.4 },
        { x: -20, y: 4.8 },
        { x: -20, y: -4.8 },
        { x: -18, y: -6.4 },
      ],
    },
  ],
  adjacency: [
    ['bow', 'midship'],
    ['bow', 'port'],
    ['bow', 'starboard'],
    ['midship', 'port'],
    ['midship', 'starboard'],
    ['midship', 'stern'],
    ['port', 'stern'],
    ['starboard', 'stern'],
  ],
  grid: {
    cols: 7,
    rows: 4,
    tileW: 5,
    tileH: 3.5,
    origin: { x: -17.5, y: -7 },
    parts: [
      'stern port      port      port      port      port      bow',
      'stern midship   midship   midship   midship   midship   bow',
      'stern midship   midship   midship   midship   midship   bow',
      'stern starboard starboard starboard starboard starboard bow',
    ],
    stations: [
      'O C . C . C .',
      '. . . S . . L',
      '. . . S . . L',
      'O C . C . C .',
    ],
  },
};

/** Every layout the game can build (textures are generated for each). */
export const LAYOUTS: BoatLayout[] = [SLOOP, FRIEND_SHIP, HARD_SHIP];
