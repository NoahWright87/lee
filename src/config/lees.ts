// Lees are content, not code. A Lee type is a name, a flavor line, art, core
// stats, role affinities, a trait (abilities) and tags. The crew AI only ever
// reads these fields, so a new type is a new entry here (later: produced by the
// Lee Creator), not new AI code. Core stats are mirrored into tuning.lees.<id>
// and trait strengths into tuning.traits.<id> so both are live-tunable.

import type { Tag } from './tags';

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
  'meleeDamage',
  'meleeRate',
  'pistolAccuracy',
  'pistolRate',
  'pistolDamage',
  'swingSpeed',
  'impactTaken',
  'pistolTaken',
] as const;

export type LeeStatKey = (typeof LEE_STAT_KEYS)[number];
/** Multipliers on the crew baselines in tuning (1 = baseline). */
export type LeeStats = Record<LeeStatKey, number>;

/** Stats where lower is better (damage taken). Shown inverted, never offered as level-ups. */
export const LOWER_IS_BETTER: ReadonlySet<LeeStatKey> = new Set(['impactTaken', 'pistolTaken']);

/** Kinds of work a Lee can do. Each maps to one stat (see WORK_STAT). */
export type WorkKind = 'gun' | 'row' | 'sail' | 'lookout' | 'pump' | 'hooks' | 'powder' | 'repair' | 'bail' | 'board' | 'repel';
/**
 * What a Lee is spending its time on, for icons and the result screen.
 * 'board' = on an enemy deck hunting for a fight, 'melee' = sword fighting on a
 * shared tile, 'swing' = in the air between decks.
 */
export type ActivityKind = WorkKind | 'melee' | 'swing' | 'walk' | 'idle';

export const ACTIVITY_KINDS: ActivityKind[] = ['gun', 'row', 'sail', 'lookout', 'pump', 'hooks', 'powder', 'repair', 'bail', 'board', 'repel', 'melee', 'swing', 'walk', 'idle'];

/** The stat that drives each kind of work. The AI weighs it when choosing tasks. */
export const WORK_STAT: Record<WorkKind, LeeStatKey> = {
  gun: 'loadSpeed',
  row: 'rowStrength',
  sail: 'sailHandling',
  lookout: 'spotting',
  pump: 'bailRate',
  hooks: 'swingSpeed',
  powder: 'loadSpeed',
  repair: 'repairRate',
  bail: 'bailRate',
  // A Lee that's good with a sword is drawn toward fighting (statAffinity).
  board: 'meleeDamage',
  repel: 'meleeDamage',
};

/**
 * A generic ability: "while <trigger>, multiply <stat(s)> of <target> by <multiply>".
 * Only 'passive' is evaluated today; event triggers are reserved so abilities
 * like "on hit, ..." are additions, not rewrites. An ability with an `id` reads
 * its strength from tuning.traits.<leeType>.<id> (live-tunable).
 */
export interface AbilityDef {
  id?: string;
  trigger: 'passive' | `event:${string}`;
  target: 'self' | 'orthogonalNeighbors';
  stat?: LeeStatKey;
  stats?: LeeStatKey[];
  multiply: number;
}

export interface LeeDef {
  id: string;
  name: string;
  /** Short role name (draft cards, crew list). */
  role: string;
  /** For memorial lines: "Quick Lee quickly met his end." */
  adverb: string;
  flavor: string;
  /** Trait name and one-line description, or null. */
  trait: { name: string; text: string } | null;
  /** Art file under /public (null = drawn in code). */
  art: string | null;
  /** Shirt color of the code-drawn figure: tells types apart at a glance. */
  color: string;
  stats: LeeStats;
  /** Extra need points for kinds of work this Lee is drawn to. */
  affinities: Partial<Record<WorkKind, number>>;
  abilities: AbilityDef[];
  tags: Tag[];
  /** Relative chance of appearing in a draft or as a recruit (0 = never). */
  draftWeight: number;
  /** Level-up bonus weights by stat: strengths come up most, anything can. */
  levelWeights: Partial<Record<LeeStatKey | 'hpBonus', number>>;
}

const base = (): LeeStats => Object.fromEntries(LEE_STAT_KEYS.map((k) => [k, 1])) as LeeStats;
const stats = (s: Partial<LeeStats>): LeeStats => ({ ...base(), ...s });

/** Every stat a level-up can touch, with a small weight so anything can come up. */
const ANY: Partial<Record<LeeStatKey | 'hpBonus', number>> = {
  loadSpeed: 1,
  accuracy: 1,
  repairRate: 1,
  bailRate: 1,
  rowStrength: 1,
  sailHandling: 1,
  spotting: 1,
  walkSpeed: 1,
  hpBonus: 1.5,
  meleeDamage: 1,
  meleeRate: 1,
  pistolAccuracy: 1,
  pistolRate: 1,
  swingSpeed: 1,
};

export const BASIC_LEE: LeeDef = {
  id: 'basic',
  name: 'Basic Lee',
  role: 'Anything',
  adverb: 'basically',
  flavor: 'He basically knew what he was doing.',
  trait: null,
  art: null,
  color: '#c0392b',
  stats: base(),
  affinities: {},
  abilities: [],
  tags: [],
  draftWeight: 0,
  levelWeights: { ...ANY },
};

export const LEE_DEFS: Record<string, LeeDef> = {
  basic: BASIC_LEE,
  hard: {
    id: 'hard',
    name: 'Hard Lee',
    role: 'Melee',
    adverb: 'hardly',
    flavor: 'He hardly noticed the cannonball.',
    trait: { name: 'Bodyguard', text: 'Lees next to him take 40% less impact and pistol damage.' },
    art: null,
    color: '#7a4a2a',
    stats: stats({ hp: 1.8, meleeDamage: 1.4, meleeRate: 1.2, walkSpeed: 0.9, loadSpeed: 0.7, accuracy: 0.7 }),
    affinities: {},
    abilities: [{ id: 'bodyguard', trigger: 'passive', target: 'orthogonalNeighbors', stats: ['impactTaken', 'pistolTaken'], multiply: 0.6 }],
    tags: ['board'],
    draftWeight: 1,
    levelWeights: { ...ANY, hpBonus: 6, meleeDamage: 6, meleeRate: 5, swingSpeed: 2 },
  },
  quick: {
    id: 'quick',
    name: 'Quick Lee',
    role: 'Ranged',
    adverb: 'quickly',
    flavor: 'He quickly loaded the cannon and forgot to aim.',
    trait: null,
    art: null,
    color: '#d68a1c',
    stats: stats({ loadSpeed: 1.5, pistolRate: 1.3, accuracy: 0.7, hp: 0.8, meleeDamage: 0.7 }),
    affinities: {},
    abilities: [],
    tags: ['barrage'],
    draftWeight: 1,
    levelWeights: { ...ANY, loadSpeed: 7, pistolRate: 4, accuracy: 3, pistolAccuracy: 2 },
  },
  deft: {
    id: 'deft',
    name: 'Deft Lee',
    role: 'Maneuvering',
    adverb: 'deftly',
    flavor: 'He deftly steered around the rock, and into another.',
    trait: null,
    art: null,
    color: '#2e8b57',
    stats: stats({ sailHandling: 2, rowStrength: 1.5, walkSpeed: 1.3, swingSpeed: 1.2, hp: 0.8, loadSpeed: 0.7 }),
    affinities: {},
    abilities: [],
    tags: ['skirmish'],
    draftWeight: 1,
    levelWeights: { ...ANY, sailHandling: 6, rowStrength: 6, walkSpeed: 4, swingSpeed: 3 },
  },
  handy: {
    id: 'handy',
    name: 'Handy Lee',
    role: 'Repair',
    adverb: 'handily',
    flavor: 'He handily patched the hole with his hat.',
    trait: null,
    art: null,
    color: '#3b6fb6',
    stats: stats({ repairRate: 1.8, bailRate: 1.5, walkSpeed: 1.1, hp: 0.9, loadSpeed: 0.6, meleeDamage: 0.6 }),
    affinities: {},
    abilities: [],
    tags: ['bulwark'],
    draftWeight: 1,
    levelWeights: { ...ANY, repairRate: 7, bailRate: 6, walkSpeed: 3 },
  },
  loud: {
    id: 'loud',
    name: 'Loud Lee',
    role: 'Support',
    adverb: 'loudly',
    flavor: 'He loudly reminded everyone which cannon to fire.',
    trait: { name: 'Shouting', text: 'Gunners next to him load 25% faster.' },
    art: null,
    color: '#8e44ad',
    stats: stats({ spotting: 1.3, walkSpeed: 0.9, hp: 0.9 }),
    affinities: {},
    abilities: [{ id: 'shouting', trigger: 'passive', target: 'orthogonalNeighbors', stats: ['loadSpeed'], multiply: 1.25 }],
    tags: ['barrage'],
    draftWeight: 1,
    levelWeights: { ...ANY, spotting: 6, hpBonus: 3, accuracy: 3, pistolAccuracy: 2 },
  },
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
  meleeDamage: 'Sword damage',
  meleeRate: 'Sword speed',
  pistolAccuracy: 'Pistol aim',
  pistolRate: 'Pistol speed',
  pistolDamage: 'Pistol damage',
  swingSpeed: 'Swing speed',
  impactTaken: 'Impact damage taken',
  pistolTaken: 'Pistol damage taken',
};

/** Ability ids per type and their default strengths (tuning.traits is built from this). */
export function defaultTraits(): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const d of Object.values(LEE_DEFS)) {
    for (const a of d.abilities) {
      if (!a.id) continue;
      (out[d.id] ??= {})[a.id] = a.multiply;
    }
  }
  return out;
}
