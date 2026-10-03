// Crews are data: which Lee type sails, and where each one's home tile is.
// Homes are listed in priority order; a crew of N takes the first N.
// Tile coordinates are [col, row] on the boat's grid (col 0 = stern, row 0 = port).

import type { Side } from './tuning';

export interface CrewDef {
  /** Lee type (key into LEE_DEFS). */
  lee: string;
  homes: [col: number, row: number][];
}

export const CREWS: Record<Side, CrewDef> = {
  /** Your crew's Auto-arrange order (and the arrangement on first launch). */
  player: {
    lee: 'basic',
    homes: [
      [3, 0], // port cannon 2
      [3, 2], // starboard cannon 2
      [0, 0], // port oars
      [2, 1], // sails
      [1, 1], // damage control, midship
      [1, 0], // port cannon 1
      [1, 2], // starboard cannon 1
      [0, 2], // starboard oars
      [4, 1], // lookout
      [2, 0],
      [2, 2],
      [3, 1],
      [0, 1],
      [4, 0],
      [4, 2],
    ],
  },
  /** Every enemy ship's crew: the first `enemy.crew.size` homes. */
  enemy: {
    lee: 'basic',
    homes: [
      [3, 0], // port cannon 2
      [3, 2], // starboard cannon 2
      [0, 0], // port oars
      [1, 1], // damage control
      [2, 1], // sails
      [1, 0], // port cannon 1
      [1, 2],
      [0, 2],
    ],
  },
};
