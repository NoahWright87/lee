// Encounters are content: each enemy boat is a ship, a loadout, a crew (Lee
// types and levels, optionally trinkets) and an AI profile, all from the same
// pool the player uses. No enemy-only ships, parts or Lees, and no hidden stat
// multipliers: everything an enemy has is explainable from this data.
//
// In a run, enemies are built from a budget (src/sim/budget.ts). The
// archetypes below are hand-made ones for tests and the sandbox.

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
  /** Points spent on it (generated ships): what it pays when beaten. */
  budget?: number;
}

/** AI profiles (tuning.ai is built from these). */
export function defaultAiProfiles() {
  // boardShare: share of the crew it moves to ⚔️ once you're within boardAt meters (the same action buttons you have).
  // Close quarters (Phase 7), all of it data:
  //  hooks      0..1: how readily it throws hooks (1 = whenever one is ready; 0.5 = only while it's winning; 0 = never)
  //  hookLines  most lines it wants out on you at once
  //  cutDelay   × the hesitation before it cuts your lines, destroys your planks and cuts your ropes (0 = never; small = quick)
  //  shove      1 = it uses push poles to get clear of you
  //  breakOff   1 = it cuts the first line the moment it lands
  //  winBoard   1 = it only sends boarders while it has the bigger crew
  const p = (
    preferredRange: number,
    seekAttach: number,
    ramLine = 20,
    ramRange = 70,
    boardShare = 0,
    boardAt = 90,
    close: { hooks?: number; hookLines?: number; cutDelay?: number; shove?: number; breakOff?: number; winBoard?: number } = {},
  ) => ({
    preferredRange,
    seekAttach,
    ramLine,
    ramRange,
    boardShare,
    boardAt,
    hooks: close.hooks ?? 0,
    hookLines: close.hookLines ?? 1,
    cutDelay: close.cutDelay ?? 1,
    shove: close.shove ?? 0,
    breakOff: close.breakOff ?? 0,
    winBoard: close.winBoard ?? 0,
  });
  return {
    /** Rushes in, hooks early, lowers planks, sends most of its crew across; slow to cut your lines. */
    boarder: p(30, 1, 20, 70, 0.7, 90, { hooks: 1, hookLines: 2, cutDelay: 3 }),
    /** Closes to cannon range and orbits. Fights where it is; hooks and boards only while it's winning. */
    standard: p(85, 0, 20, 70, 0.4, 90, { hooks: 0.5, hookLines: 1, cutDelay: 1, winBoard: 1 }),
    /** Holds range with its broadside; cuts your lines quickly and resists boarding. */
    heavy: p(105, 0, 20, 70, 0, 90, { cutDelay: 0.3 }),
    /** Keeps far out: long guns. Breaks off at the first hook. */
    skirmisher: p(150, 0, 20, 70, 0, 90, { cutDelay: 0.15, shove: 1, breakOff: 1 }),
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

/** Total enemy Lees in a spec (for summaries). */
export function crewCount(spec: EnemySpec): number {
  return spec.crew.reduce((n, c) => n + Math.max(0, c.count ?? 1), 0);
}
