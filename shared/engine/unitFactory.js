let _uidSeq = 0;
function nextUid(prefix) {
  return `${prefix}-${++_uidSeq}`;
}

/**
 * Create a runtime unit from a Lee definition.
 *
 * @param {object} leeDef   Lee JSON definition
 * @param {'player'|'enemy'} side
 * @param {number} row
 * @param {number} col
 * @returns {object}  Runtime unit
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
    xp:    0,
    level: 1,
  };
}

/**
 * Reset a surviving unit back to its home position between rounds.
 * Clears all transient battle state.
 *
 * @param {object} unit  Runtime unit (mutated in place)
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
 * Generate a set of enemy units for the given round.
 * Stats are scaled up each round.
 *
 * @param {object[]} allLees
 * @param {number} round        1-based round number
 * @param {{rows:number,cols:number,deployRows:number}} fieldConfig
 * @returns {object[]}
 */
export function generateEnemies(allLees, round, fieldConfig) {
  const scale    = 0.65 + round * 0.10;
  const maxCount = fieldConfig.cols * fieldConfig.deployRows;
  const count    = Math.min(2 + Math.floor(round * 0.6), maxCount);

  const pool     = [...allLees].sort(() => Math.random() - 0.5);
  const selected = pool.slice(0, Math.min(count, pool.length));

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
      baseStats: {
        ...lee.baseStats,
        hp: Math.round(lee.baseStats.hp * scale),
      },
    };

    return createRuntimeUnit(scaledLee, 'enemy', row, col);
  });
}

/**
 * Return `count` distinct Tier-1 Lees for the initial draft.
 * @param {object[]} allLees
 * @param {number} [count=5]
 * @returns {object[]}
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
 *
 * @param {object[]} allLees
 * @param {number} [count=4]
 * @returns {object[]}
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
    let pool =
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
