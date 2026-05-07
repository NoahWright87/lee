function deepCloneUnit(u) {
  return {
    ...u,
    abilities: u.abilities.map(a => ({ ...a })),
    baseStats: { ...u.baseStats },
    pendingAttacks: [],
    castBars: { ...u.castBars },
    aims: {},
  };
}

/**
 * Process level-ups for all surviving units after a player victory.
 * Returns the leveled-up units plus a per-field-unit summary used by
 * the victory screen (XP animation, stat deltas, perk queue).
 *
 * @param {object[]} fieldUnits  Surviving player field units (already reset to home)
 * @param {object[]} benchUnits  Bench units
 * @param {Object}   xpSnapshot  uid → { xp, level } captured at battle start
 * @returns {{ fieldUnits, benchUnits, levelUpResults }}
 */
export function calculateLevelUps(fieldUnits, benchUnits, xpSnapshot = {}) {
  const aliveField = fieldUnits.filter(u => u.alive).map(deepCloneUnit);
  const aliveBench = benchUnits.map(deepCloneUnit);
  const fieldUids = new Set(aliveField.map(u => u.uid));

  const levelUpResults = [];

  [...aliveField, ...aliveBench].forEach(u => {
    const snap = xpSnapshot[u.uid] || { xp: 0, level: u.level || 1 };
    const xpAtBattleStart = snap.xp;
    const xpAtBattleEnd = u.xp || 0;

    let levelsGained = 0;
    const levelStatDeltas = [];

    while ((u.xp || 0) >= 100) {
      const prevMaxHp = u.maxHp;
      const prevDef = u.baseStats.def;
      const prevDmg = u.abilities.reduce((s, a) => s + (a.damage || 0), 0);
      const prevHeal = u.abilities.reduce((s, a) => s + (a.healAmount || 0), 0);

      u.level = (u.level || 1) + 1;
      u.xp -= 100;
      u.maxHp = Math.round(u.maxHp * 1.08);
      u.hp = u.maxHp;
      u.baseStats.def = Math.round(u.baseStats.def * 1.05);
      u.abilities = u.abilities.map(a => ({
        ...a,
        damage:     a.damage     ? Math.round(a.damage     * 1.06) : 0,
        healAmount: a.healAmount ? Math.round(a.healAmount * 1.06) : 0,
      }));

      const newDmg = u.abilities.reduce((s, a) => s + (a.damage || 0), 0);
      const newHeal = u.abilities.reduce((s, a) => s + (a.healAmount || 0), 0);

      levelsGained++;
      levelStatDeltas.push({
        hp:   u.maxHp - prevMaxHp,
        def:  u.baseStats.def - prevDef,
        dmg:  newDmg - prevDmg,
        heal: newHeal - prevHeal,
      });
    }

    if (fieldUids.has(u.uid)) {
      levelUpResults.push({
        uid:             u.uid,
        name:            u.name,
        emoji:           u.emoji,
        level:           u.level,
        xpAtBattleStart,
        xpAtBattleEnd,
        xpFinal:         u.xp,
        levelsGained,
        levelStatDeltas,
        hp:    u.hp,
        maxHp: u.maxHp,
      });
    }
  });

  return { fieldUnits: aliveField, benchUnits: aliveBench, levelUpResults };
}

/**
 * Apply end-of-round healing to surviving units.
 * Mutates the provided arrays in place.
 *
 * @param {object[]} fieldUnits
 * @param {object[]} benchUnits
 */
export function applyPostBattleHealing(fieldUnits, benchUnits) {
  fieldUnits.forEach(u => {
    u.hp = Math.min(u.maxHp, u.hp + Math.round(u.maxHp * 0.10));
  });
  benchUnits.forEach(u => {
    u.hp = Math.min(u.maxHp, u.hp + Math.round(u.maxHp * 0.20));
  });
}

/**
 * Legacy combined wrapper kept for compatibility.
 * Prefer calling calculateLevelUps + applyPostBattleHealing separately.
 */
export function processPostBattle(fieldUnits, benchUnits) {
  const { fieldUnits: leveled, benchUnits: leveledBench } =
    calculateLevelUps(fieldUnits, benchUnits, {});
  applyPostBattleHealing(leveled, leveledBench);
  return { fieldUnits: leveled, benchUnits: leveledBench };
}
