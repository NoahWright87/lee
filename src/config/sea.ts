// The sea map's content: stop types, stop modifiers, map styles and intel
// levels. All data: a new stop type, modifier, style or reveal is an entry
// here (plus, for a stop that does something new, its effect in sim/run.ts).

/** What a stop does when you arrive. */
export type StopEffect = 'fight' | 'salvage' | 'wreck' | 'cove' | 'castaway' | 'port';

export interface StopTypeDef {
  id: string;
  name: string;
  icon: string;
  text: string;
  effect: StopEffect;
  /** Budget × this (1 = a normal fight; tuning.stops.<id>.budget). Non-fights use it to size their gold. */
  budget: number;
  /** Fights: also offers a special reward (a rare pick) when won. */
  special?: boolean;
  /** Fights: only sea monsters, no ships. */
  nessOnly?: boolean;
  /** Base weight when scattering stops (each map style multiplies it). */
  weight: number;
}

export const STOP_TYPES: Record<string, StopTypeDef> = {
  fight: { id: 'fight', name: 'Fight', icon: '⚔️', text: 'Enemy ships. Pays gold and spoils.', effect: 'fight', budget: 1, weight: 6 },
  hard: { id: 'hard', name: 'Hard fight', icon: '💀', text: 'A bigger fight. Pays more, plus a rare pick.', effect: 'fight', budget: 1.5, special: true, weight: 1.2 },
  lair: { id: 'lair', name: 'Ness lair', icon: '🐍', text: 'Sea monsters only. Pays gold, and they may leave a trophy.', effect: 'fight', budget: 1.15, nessOnly: true, weight: 0.5 },
  abandoned: { id: 'abandoned', name: 'Abandoned ship', icon: '🛶', text: 'Nobody aboard. Salvage it for gold.', effect: 'salvage', budget: 1, weight: 1 },
  wreck: { id: 'wreck', name: 'Wreck', icon: '🪵', text: 'Pick one of the parts floating in the wreckage.', effect: 'wreck', budget: 1, weight: 1 },
  cove: { id: 'cove', name: 'Cove', icon: '🏝️', text: 'Calm water: a free partial heal and repair.', effect: 'cove', budget: 1, weight: 0.8 },
  castaway: { id: 'castaway', name: 'Castaway', icon: '🙋', text: 'A lone Lee on a rock joins your crew.', effect: 'castaway', budget: 1, weight: 0.6 },
  port: { id: 'port', name: 'Port', icon: '⚓', text: 'Your destination.', effect: 'port', budget: 1, weight: 0 },
};

/** Default stop numbers (tuning.stops is built from this). */
export function defaultStopTuning(): Record<string, { budget: number; weight: number }> {
  return Object.fromEntries(Object.values(STOP_TYPES).map((d) => [d.id, { budget: d.budget, weight: d.weight }]));
}

/** Stop modifiers stack on a stop. Fog is the first (and only, for now). */
export interface ModifierDef {
  id: string;
  name: string;
  icon: string;
  text: string;
  /** Hides the stop's type, danger and preview until you arrive. */
  hides?: boolean;
  /** Base chance a stop gets it (× map style). */
  chance: number;
}

export const MODIFIERS: Record<string, ModifierDef> = {
  fog: { id: 'fog', name: 'Fog', icon: '🌫️', text: 'You can’t see what’s here until you arrive.', hides: true, chance: 0.1 },
};

/** A kind of sea between two ports. Styles combine (their numbers multiply). */
export interface MapStyleDef {
  id: string;
  name: string;
  icon: string;
  text: string;
  /** × the number of stops. */
  stops: number;
  /** × the travel radius on this map (longer hops; the map is built against it). */
  radius: number;
  /** × fight budgets. */
  budget: number;
  /** × the chance a fight has Nesses in it. */
  ness: number;
  /** × gold from fights. */
  gold: number;
  /** × each stop type's weight. */
  weights: Partial<Record<string, number>>;
  /** × each modifier's chance. */
  modifiers: Partial<Record<string, number>>;
  /** Relative chance a destination gets this style. */
  chance: number;
}

const style = (s: Partial<MapStyleDef> & Pick<MapStyleDef, 'id' | 'name' | 'icon' | 'text' | 'chance'>): MapStyleDef => ({
  stops: 1,
  radius: 1,
  budget: 1,
  ness: 1,
  gold: 1,
  weights: {},
  modifiers: {},
  ...s,
});

export const MAP_STYLES: Record<string, MapStyleDef> = {
  open: style({ id: 'open', name: 'Open water', icon: '🌊', text: 'A bit of everything.', chance: 3 }),
  crowded: style({ id: 'crowded', name: 'Crowded lanes', icon: '⛵', text: 'Packed stops: more fights, each a bit weaker. Few sea monsters.', stops: 1.6, radius: 0.8, budget: 0.8, ness: 0.3, weights: { fight: 1.6, lair: 0.2 }, chance: 1 }),
  ness: style({ id: 'ness', name: 'Ness waters', icon: '🐍', text: 'Sea monsters everywhere, alone or alongside ships.', ness: 3.5, weights: { lair: 5, fight: 0.9 }, chance: 1 }),
  wide: style({ id: 'wide', name: 'Wide sea', icon: '🧭', text: 'Few stops, far apart.', stops: 0.6, radius: 1.3, chance: 1 }),
  foggy: style({ id: 'foggy', name: 'Foggy', icon: '🌫️', text: 'Many stops are hidden in fog.', modifiers: { fog: 5 }, chance: 1 }),
  dangerous: style({ id: 'dangerous', name: 'Dangerous', icon: '☠️', text: 'More hard fights; better pay.', budget: 1.1, gold: 1.3, weights: { hard: 3 }, chance: 1 }),
  salvage: style({ id: 'salvage', name: 'Salvage grounds', icon: '⚓', text: 'More abandoned ships and wrecks.', weights: { abandoned: 3, wreck: 3, fight: 0.8 }, chance: 1 }),
};

/**
 * What you can see of a stop, level by level. Each level is granted by
 * something you own; later items or services add levels (or grant these).
 */
export interface IntelDef {
  id: 'chassis' | 'crew' | 'parts';
  name: string;
  /** Who grants it: always, a worn trinket, or a manned station (an item id on a tile with a Lee on it). */
  source: { kind: 'always' } | { kind: 'trinket'; item: string } | { kind: 'manned'; item: string };
}

export const INTEL: IntelDef[] = [
  { id: 'chassis', name: 'Ship type', source: { kind: 'always' } },
  { id: 'crew', name: 'Crew size and levels', source: { kind: 'trinket', item: 'spyglassTrinket' } },
  { id: 'parts', name: 'Parts', source: { kind: 'manned', item: 'crowsNest' } },
];
