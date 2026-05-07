let _uidSeq = 0;
function nextUid(prefix) {
  return `${prefix}-${++_uidSeq}`;
}

/**
 * Difficulty presets — affect enemy stat debuff and point budget.
 *
 * statBase: enemy stat multiplier at round 1
 * statRate: how much the multiplier increases per round (reaches 1.0 at ~round 20 on Normal)
 * budgetMult: scales the enemy point budget up or down
 */
export const DIFFICULTY_CONFIG = {
  easy: {
    label:       'Easy',
    description: 'Enemies stay weak for a long time. Great for learning the game.',
    statBase:    0.45,   // R1 = 45% stats
    statRate:    0.018,  // hits 100% ~round 32
    budgetMult:  0.70,
    color:       '#44cc77',
  },
  normal: {
    label:       'Normal',
    description: 'A fair challenge. Enemies scale up over about 20 rounds.',
    statBase:    0.60,   // R1 = 60% stats
    statRate:    0.021,  // hits 100% ~round 20
    budgetMult:  1.00,
    color:       '#4488ff',
  },
  hard: {
    label:       'Hard',
    description: 'Enemies are strong from the start and grow quickly.',
    statBase:    0.72,   // R1 = 72% stats
    statRate:    0.040,  // hits 100% ~round 8
    budgetMult:  1.40,
    color:       '#ff5544',
  },
};

/**
 * Create a runtime unit from a Lee definition.
 */
export function createRuntimeUnit(leeDef, side, row, col) {
  return {
    ...leeDef,
    abilities:  leeDef.abilities.map(a => ({ ...a })),
    baseStats:  { ...leeDef.baseStats },
    uid:        nextUid(`${leeDef.id}-${side}`),
    side,
    row,
    col,
    homeRow:    row,
    homeCol:    col,
    hp:         leeDef.baseStats.hp,
    maxHp:      leeDef.baseStats.hp,
    alive:      true,
    flash:      0,
    moving:     false,
    moveBar:    0,
    castBars:   Object.fromEntries(
      leeDef.abilities
        .filter(a => a.type !== 'thorns')
        .map(a => [a.id, 0])
    ),
    pendingAttacks: [],
    aims:  {},
    xp:    0,
    level: 1,
    perks: [],
  };
}

/**
 * Reset a surviving unit back to its home position between rounds.
 */
export function resetToHome(unit) {
  unit.row     = unit.homeRow;
  unit.col     = unit.homeCol;
  unit.moveBar = 0;
  unit.moving  = false;
  unit.pendingAttacks = [];
  unit.flash   = 0;
  Object.keys(unit.castBars).forEach(k => { unit.castBars[k] = 0; });
  return unit;
}

/**
 * Enemy point budget for a given round.
 * Slow start, steeper ramp: R1=3, R2=4, R3=6, R4=9, R5=14, R6=20, …
 */
function enemyBudget(round) {
  return 3 + Math.floor(Math.pow(Math.max(0, round - 1), 1.8));
}

/**
 * Generate enemy units for the given round, respecting difficulty settings.
 *
 * @param {object[]} allLees
 * @param {number}   round         1-based round number
 * @param {{rows:number,cols:number,deployRows:number}} fieldConfig
 * @param {'easy'|'normal'|'hard'} [difficulty='normal']
 * @returns {object[]}
 */
export function generateEnemies(allLees, round, fieldConfig, difficulty = 'normal') {
  const cfg     = DIFFICULTY_CONFIG[difficulty] || DIFFICULTY_CONFIG.normal;
  const scale   = Math.min(1.0, cfg.statBase + (round - 1) * cfg.statRate);
  const budget  = Math.max(1, Math.round(enemyBudget(round) * cfg.budgetMult));
  const maxCount = fieldConfig.cols * fieldConfig.deployRows;
  const maxTier  = round <= 2 ? 1 : round <= 4 ? 2 : 3;

  const pool = allLees.filter(l => l.tier <= maxTier && (l.cost || 1) <= budget);

  const selected = [];
  let remaining  = budget;
  let attempts   = 0;

  while (remaining > 0 && selected.length < maxCount && attempts < 200) {
    attempts++;
    const affordable = pool.filter(l => (l.cost || 1) <= remaining);
    if (!affordable.length) break;
    const pick = affordable[Math.floor(Math.random() * affordable.length)];
    selected.push(pick);
    remaining -= pick.cost || 1;
  }

  return selected.map((lee, i) => {
    const row = Math.floor(i / fieldConfig.cols);
    const col = i % fieldConfig.cols;
    const scaledLee = {
      ...lee,
      abilities: lee.abilities.map(a => ({
        ...a,
        damage:     a.damage     ? Math.round(a.damage     * scale) : 0,
        healAmount: a.healAmount ? Math.round(a.healAmount * scale) : 0,
      })),
      baseStats: { ...lee.baseStats, hp: Math.round(lee.baseStats.hp * scale) },
    };
    return createRuntimeUnit(scaledLee, 'enemy', row, col);
  });
}

/**
 * Return `count` distinct Tier-1 Lees for the initial draft.
 */
export function getInitialDraftOptions(allLees, count = 5) {
  const pool = allLees.filter(
    l => l.tier === 1 && (l.acquisition?.method === 'draft' || l.acquisition?.method === 'both')
  );
  return shuffle(pool).slice(0, Math.min(count, pool.length));
}

/**
 * Return `count` distinct Lee options for the between-round draft.
 * Weighted: ~70% Tier 1, ~25% Tier 2, ~5% Tier 3.
 */
export function getBetweenRoundDraftOptions(allLees, count = 4) {
  const draftable = l =>
    l.acquisition?.method === 'draft' || l.acquisition?.method === 'both';

  const tier1 = allLees.filter(l => l.tier === 1 && draftable(l));
  const tier2 = allLees.filter(l => l.tier === 2 && draftable(l));
  const tier3 = allLees.filter(l => l.tier === 3 && draftable(l));

  const options = [];
  const usedIds = new Set();

  let attempts = 0;
  while (options.length < count && attempts < 200) {
    attempts++;
    const roll = Math.random();
    const pool =
      roll < 0.70 ? tier1 :
      roll < 0.95 ? (tier2.length ? tier2 : tier1) :
                    (tier3.length ? tier3 : tier1);

    const available = pool.filter(l => !usedIds.has(l.id));
    if (!available.length) continue;

    const pick = available[Math.floor(Math.random() * available.length)];
    options.push(pick);
    usedIds.add(pick.id);
  }

  return options;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
