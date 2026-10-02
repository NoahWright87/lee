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

export interface BoatLayout {
  id: string;
  length: number;
  beam: number;
  parts: PartDef[];
  /** Pairs of part ids that share a bulkhead; water spreads between them. */
  adjacency: [string, string][];
}

const rect = (x0: number, y0: number, x1: number, y1: number): Vec[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

/** A small warship: five parts. Used for both boats in the prototype. */
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
      polygon: rect(-5, -5, 7, -2.5),
      broadside: -1,
    },
    {
      id: 'midship',
      label: 'Midship',
      role: 'hull',
      stats: 'midship',
      art: 'midship',
      polygon: rect(-5, -2.5, 7, 2.5),
    },
    {
      id: 'starboard',
      label: 'Starboard guns',
      role: 'cannon',
      stats: 'cannon',
      art: 'cannon',
      flipArt: true,
      polygon: rect(-5, 2.5, 7, 5),
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
};
