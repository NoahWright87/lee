// Slot types are content: where equipment can go. Each item declares which
// slot types it fits. A new slot type is a new entry here (plus whatever reads
// its items), not a change to every ship.

export type Facing = 'port' | 'starboard' | 'bow' | 'stern';

/** Angle of a facing in the boat's local frame (+x toward the bow, +y to starboard), radians. */
export const FACING_ANGLE: Record<Facing, number> = {
  bow: 0,
  starboard: Math.PI / 2,
  stern: Math.PI,
  port: -Math.PI / 2,
};

export const FACING_ARROW: Record<Facing, string> = { bow: '→', starboard: '↓', stern: '←', port: '↑' };
export const FACING_NAME: Record<Facing, string> = { bow: 'Bow', starboard: 'Starboard', stern: 'Stern', port: 'Port' };
export const FACINGS: Facing[] = ['port', 'bow', 'starboard', 'stern'];

export interface SlotTypeDef {
  name: string;
  /** Short glyph for slot markers on the refit screen. */
  glyph: string;
  help: string;
}

export const SLOT_TYPES = {
  edge: { name: 'Edge', glyph: '▮', help: 'A deck tile on the edge of the boat. Guns mounted here point out over that edge (a corner can be turned to either side); oars go here too.' },
  interior: { name: 'Interior', glyph: '◆', help: 'A deck tile inside the boat: sails, lookout, powder, and turret-style guns.' },
  rail: { name: 'Rail', glyph: '╫', help: 'Just outside the hull, along one edge tile: spikes, fences and planks.' },
  hull: { name: 'Hull', glyph: '⬢', help: 'Just outside the hull, under the rail: plating, keel, rudder and other modules.' },
  floor: { name: 'Floor', glyph: '▦', help: 'Under everything else on a tile.' },
  attachment: { name: 'Gun attachment', glyph: '✚', help: 'Fixed to one gun.' },
  treasure: { name: 'Treasure', glyph: '✦', help: 'Held by the ship; applies to the whole ship.' },
  trinket: { name: 'Trinket', glyph: '✧', help: 'Worn by a Lee; changes that Lee.' },
} as const satisfies Record<string, SlotTypeDef>;

export type SlotType = keyof typeof SLOT_TYPES;

/** A slot on a ship: typed, at a tile (with a facing for edge and rail slots) or on a hull part. */
export interface ShipSlot {
  id: string;
  type: SlotType;
  /** Tile [col, row] for edge, interior, rail and floor slots. */
  tile?: [number, number];
  /** Edge, rail and hull slots: which edge. Interior slots: the default facing of a directional gun mounted there. */
  facing?: Facing;
  /** Edge slots: every way a gun here can be turned (a corner has two). */
  facings?: Facing[];
  /** Hull part id (not used by generated slots: their part is their tile's). */
  part?: string;
  /** Gun attachment slots: the gun's slot id. */
  gun?: string;
}

export const attachmentSlotId = (gunSlot: string): string => `att:${gunSlot}`;
export const floorSlotId = (col: number, row: number): string => `floor:${col},${row}`;
