// Encounters are content: each enemy boat is a ship, a loadout, a crew (Lee
// types and levels, optionally trinkets) and an AI profile, all from the same
// pool the player uses. No enemy-only ships, parts or Lees, and no hidden stat
// multipliers: everything an enemy has is explainable from this data.
//
// THE TEMPORARY LIST below stands in for the sea map and endless mode. It will
// be thrown away; nothing should assume it's final or that a run ends. After
// its last entry, the run repeats the last encounter with higher levels (and
// eventually more crew): tuning.escalation.

export interface CrewEntry {
  type: string;
  level?: number;
  /** How many of these (default 1). */
  count?: number;
  trinkets?: string[];
}

export interface EnemySpec {
  ship: string;
  /** Slot id → item id (or null to empty a slot) on top of the ship's standard fit. */
  loadout?: Record<string, string | null>;
  /** Or: exactly this loadout instead of the standard fit. */
  fullLoadout?: Record<string, string>;
  treasures?: string[];
  crew: CrewEntry[];
  /** AI profile id (tuning.ai.<id>). Belongs to the encounter, not the ship. */
  ai: string;
}

export interface EncounterDef {
  id: string;
  name: string;
  enemies: EnemySpec[];
}

/** AI profiles (tuning.ai is built from these). */
export function defaultAiProfiles() {
  // boardShare: share of the crew it moves to ⚔️ once you're within boardAt meters (the same action buttons you have).
  const p = (preferredRange: number, seekAttach: number, ramLine = 20, ramRange = 70, boardShare = 0, boardAt = 90) => ({ preferredRange, seekAttach, ramLine, ramRange, boardShare, boardAt });
  return {
    /** Closes in to come alongside or ram, moving most of its crew to ⚔️ on the way. */
    boarder: p(30, 1, 20, 70, 0.7),
    /** Closes to cannon range and orbits. */
    standard: p(85, 0),
    /** Holds range with its broadside. */
    heavy: p(105, 0),
    /** Keeps far out: long guns. */
    skirmisher: p(150, 0),
  };
}

export type AiProfile = ReturnType<typeof defaultAiProfiles>['standard'];

/** One boat of each archetype (the Phase 3 enemy types, now built from shared content). */
export const ARCHETYPES: Record<string, EnemySpec> = {
  standard: { ship: 'basic', ai: 'standard', crew: [{ type: 'quick' }, { type: 'handy' }, { type: 'basic', count: 2 }] },
  boarder: { ship: 'friend', ai: 'boarder', crew: [{ type: 'hard', count: 2 }, { type: 'deft' }, { type: 'basic', count: 3 }] },
  heavy: { ship: 'hard', ai: 'heavy', crew: [{ type: 'quick', count: 2 }, { type: 'handy' }, { type: 'basic', count: 2 }] },
};

export const ARCHETYPE_NAMES: Record<string, string> = { standard: 'Standard (Basic Ship)', boarder: 'Boarder (Friend Ship)', heavy: 'Heavy (Hard Ship)' };

export const ENCOUNTERS: EncounterDef[] = [
  // Fight 1 is pathetically easy: it's there to teach steering and the buttons.
  {
    id: 'first',
    name: 'A leaky Basic Ship',
    enemies: [{ ship: 'basic', ai: 'standard', fullLoadout: { 'fix:1,0': 'cannon', 'fix:1,2': 'cannon' }, crew: [{ type: 'basic', count: 1 }] }],
  },
  // Then it escalates gently: short-handed Basic crews first, specialists and levels later.
  { id: 'lone-basic', name: 'A lone Basic Ship', enemies: [{ ship: 'basic', ai: 'standard', crew: [{ type: 'basic', count: 3 }] }] },
  { id: 'friend-ship', name: 'A Friend Ship', enemies: [{ ship: 'friend', ai: 'boarder', crew: [{ type: 'basic', count: 4 }] }] },
  { id: 'hard-ship', name: 'A Hard Ship', enemies: [{ ship: 'hard', ai: 'heavy', crew: [{ type: 'quick' }, { type: 'basic', count: 3 }] }] },
  {
    id: 'basic-pair',
    name: 'A pair of Basic Ships',
    enemies: [
      { ship: 'basic', ai: 'standard', crew: [{ type: 'basic', count: 3 }] },
      { ship: 'basic', ai: 'skirmisher', loadout: { 'fix:1,0': 'longGun', 'fix:1,2': 'longGun' }, crew: [{ type: 'deft' }, { type: 'basic', count: 2 }] },
    ],
  },
  {
    id: 'boarding-party',
    name: 'A boarding party',
    enemies: [
      { ship: 'friend', ai: 'boarder', crew: [{ type: 'hard', count: 2, level: 2 }, { type: 'deft', level: 2 }, { type: 'basic', count: 3, level: 2 }] },
      { ship: 'basic', ai: 'standard', crew: [{ type: 'quick', level: 2 }, { type: 'handy', level: 2 }, { type: 'basic', level: 2 }] },
    ],
  },
];

/** Total enemy Lees in a spec (for summaries). */
export function crewCount(spec: EnemySpec): number {
  return spec.crew.reduce((n, c) => n + Math.max(0, c.count ?? 1), 0);
}
