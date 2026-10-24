// Difficulty levels are data: each moves levers the run already has (free
// repair and healing, repair and healing prices, how fast enemy budgets grow,
// the surrender chance, starting gold). A new difficulty is a new entry.

export interface DifficultyDef {
  id: string;
  name: string;
  blurb: string;
  /** × the free repair and heal after fights (tuning.run.autoRepair / autoHeal). */
  freeFix: number;
  /** × repair and healing prices. */
  fixPrice: number;
  /** × how much faster than 1 enemy budgets grow per journey (tuning.budget.growth). */
  growth: number;
  /** × the surrender chance (tuning.spoils.surrender). */
  surrender: number;
  /** × starting gold (tuning.economy.startGold / customGold). */
  gold: number;
}

export const DIFFICULTIES: Record<string, DifficultyDef> = {
  easy: { id: 'easy', name: 'Easy', blurb: 'More free fixing, cheaper ports, slower seas.', freeFix: 1.6, fixPrice: 0.7, growth: 0.75, surrender: 1.5, gold: 1.5 },
  normal: { id: 'normal', name: 'Normal', blurb: 'The intended voyage.', freeFix: 1, fixPrice: 1, growth: 1, surrender: 1, gold: 1 },
  hard: { id: 'hard', name: 'Hard', blurb: 'Less free fixing, dearer ports, fiercer seas.', freeFix: 0.5, fixPrice: 1.4, growth: 1.3, surrender: 0.5, gold: 0.6 },
};

export const DIFFICULTY_ORDER = ['easy', 'normal', 'hard'];

export function difficulty(id: string | undefined): DifficultyDef {
  return DIFFICULTIES[id ?? 'normal'] ?? DIFFICULTIES.normal;
}
