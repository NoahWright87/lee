// Enemy ship types are content, not code. A type names its layout, its crew
// (Lee type and home tiles in priority order) and which tuning block it reads
// (tuning.ships.<id>: movement, parts, cannons, crew size and AI preferences).
// A new type is a new entry here plus a tuning block; no code changes.

import { FRIEND_SHIP, HARD_SHIP, SLOOP, type BoatLayout } from './boats';
import type { CrewDef } from './crews';

export interface ShipTypeDef {
  id: string;
  /** Shown above the boat and in debug. Placeholder puns. */
  name: string;
  layout: BoatLayout;
  crew: CrewDef;
}

export const SHIP_TYPES: Record<string, ShipTypeDef> = {
  standard: {
    id: 'standard',
    name: 'Sloop',
    layout: SLOOP,
    crew: {
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
  },
  boarder: {
    id: 'boarder',
    name: 'Friend Ship',
    layout: FRIEND_SHIP,
    crew: {
      lee: 'basic',
      homes: [
        [1, 0], // port gun
        [1, 2], // starboard gun
        [0, 0], // port oars
        [0, 2], // starboard oars
        [2, 1], // sails
        [1, 1], // damage control
        [2, 0],
        [2, 2],
        [3, 1],
        [3, 0],
        [3, 2],
        [0, 1],
      ],
    },
  },
  heavy: {
    id: 'heavy',
    name: 'Hard Ship',
    layout: HARD_SHIP,
    crew: {
      lee: 'basic',
      homes: [
        [3, 0], // port cannon 2
        [3, 3], // starboard cannon 2
        [1, 0], // port cannon 1
        [1, 3], // starboard cannon 1
        [5, 0], // port cannon 3
        [5, 3], // starboard cannon 3
        [0, 0], // port oars
        [3, 1], // sails
        [2, 1], // damage control
        [6, 1], // lookout
        [0, 3],
        [2, 2],
        [4, 1],
        [4, 2],
      ],
    },
  },
};

export type ShipTypeId = keyof typeof SHIP_TYPES;

/**
 * Fights that introduce a type: fight 1 is a lone Sloop, fight 2 a lone Friend
 * Ship, fight 3 a lone Hard Ship (when campaign.introFights is on). Later
 * fights draw a mix by campaign.mix weights.
 */
export const INTRO_FIGHTS: string[] = ['standard', 'boarder', 'heavy'];

export function shipName(type: string): string {
  return SHIP_TYPES[type]?.name ?? type;
}
