// Lees are content, not code. A Lee type is a name, a flavor line, art, core
// stats, role affinities and abilities. The crew AI only ever reads these
// fields, so a new type is a new entry here (later: produced by the Lee
// Creator), not new AI code.

export const LEE_STAT_KEYS = [
  'loadSpeed',
  'accuracy',
  'repairRate',
  'bailRate',
  'rowStrength',
  'sailHandling',
  'spotting',
  'walkSpeed',
  'hp',
] as const;

export type LeeStatKey = (typeof LEE_STAT_KEYS)[number];
/** Multipliers on the crew baselines in tuning (1 = baseline). */
export type LeeStats = Record<LeeStatKey, number>;

/** Kinds of work a Lee can do. Each maps to one stat (see WORK_STAT). */
export type WorkKind = 'gun' | 'row' | 'sail' | 'lookout' | 'repair' | 'bail';
/** What a Lee is spending its time on, for icons and the result screen. */
export type ActivityKind = WorkKind | 'walk' | 'idle';

export const ACTIVITY_KINDS: ActivityKind[] = ['gun', 'row', 'sail', 'lookout', 'repair', 'bail', 'walk', 'idle'];

/** The stat that drives each kind of work. The AI weighs it when choosing tasks. */
export const WORK_STAT: Record<WorkKind, LeeStatKey> = {
  gun: 'loadSpeed',
  row: 'rowStrength',
  sail: 'sailHandling',
  lookout: 'spotting',
  repair: 'repairRate',
  bail: 'bailRate',
};

/**
 * A generic ability: "while <trigger>, multiply <stat> of <target> by <multiply>".
 * Only 'passive' is evaluated today; event triggers are reserved so abilities
 * like "on hit, ..." are additions, not rewrites.
 */
export interface AbilityDef {
  trigger: 'passive' | `event:${string}`;
  target: 'self' | 'orthogonalNeighbors';
  stat: LeeStatKey;
  multiply: number;
}

export interface LeeDef {
  id: string;
  name: string;
  flavor: string;
  /** Art file under /public (null = drawn in code). */
  art: string | null;
  stats: LeeStats;
  /** Extra need points for kinds of work this Lee is drawn to. */
  affinities: Partial<Record<WorkKind, number>>;
  abilities: AbilityDef[];
}

export const BASIC_LEE: LeeDef = {
  id: 'basic',
  name: 'Basic Lee',
  flavor: 'He basically knew what he was doing.',
  art: null,
  stats: {
    loadSpeed: 1,
    accuracy: 1,
    repairRate: 1,
    bailRate: 1,
    rowStrength: 1,
    sailHandling: 1,
    spotting: 1,
    walkSpeed: 1,
    hp: 1,
  },
  affinities: {},
  abilities: [],
};

export const LEE_DEFS: Record<string, LeeDef> = {
  basic: BASIC_LEE,
};

export const STAT_LABELS: Record<LeeStatKey, string> = {
  loadSpeed: 'Load speed',
  accuracy: 'Accuracy',
  repairRate: 'Repair',
  bailRate: 'Bailing',
  rowStrength: 'Rowing',
  sailHandling: 'Sails',
  spotting: 'Spotting',
  walkSpeed: 'Walk speed',
  hp: 'Toughness',
};
