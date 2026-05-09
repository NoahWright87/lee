import { xpToNextLevel } from './xp.js';

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
 *
 * Dead player field units are revived as injured bench units (sit out one
 * round while recovering) instead of being permanently removed.
 *
 * Returns leveled-up units plus a per-field-unit summary used by the
 * victory screen (XP animation, stat deltas, perk queue).
 *
 * @param {object[]} fieldUnits  All field units at battle end (may include dead ones)
 * @param {object[]} benchUnits  Bench units
 * @param {Object}   xpSnapshot  uid → { xp, level } captured at battle start
 * @returns {{ fieldUnits, benchUnits, levelUpResults }}
 */
export function calculateLevelUps(fieldUnits, benchUnits, xpSnapshot = {}) {
  const aliveField   = fieldUnits.filter(u => u.side === 'player' && u.alive).map(deepCloneUnit);
  const aliveBench   = benchUnits.map(deepCloneUnit);
  const fieldUids    = new Set(aliveField.map(u => u.uid));

  // Dead player field units come back as injured bench units
  const injuredFromBattle = fieldUnits
    .filter(u => u.side === 'player' && !u.alive)
    .map(u => ({
      ...deepCloneUnit(u),
      alive:        true,
      hp:           1,
      row:          -1, col:     -1,
      homeRow:      -1, homeCol: -1,
      flash:        0,  moveBar: 0,
      pendingAttacks: [],
      aims:         {},
      injured:      true,
      injuredRounds: 1,  // cleared after one healing cycle (one round on bench)
    }));

  const levelUpResults = [];

  [...aliveField, ...aliveBench].forEach(u => {
    const snap = xpSnapshot[u.uid] || { xp: 0, level: u.level || 1 };
    const xpAtBattleStart   = snap.xp;
    const levelAtBattleStart = snap.level;
    const xpAtBattleEnd      = u.xp || 0;

    let levelsGained = 0;
    const levelStatDeltas = [];

    while ((u.xp || 0) >= xpToNextLevel(u.level || 1)) {
      const threshold  = xpToNextLevel(u.level || 1);
      const prevMaxHp  = u.maxHp;
      const prevDef    = u.baseStats.def;
      const prevDmg    = u.abilities.reduce((s, a) => s + (a.damage || 0), 0);
      const prevHeal   = u.abilities.reduce((s, a) => s + (a.healAmount || 0), 0);

      u.level  = (u.level || 1) + 1;
      u.xp    -= threshold;
      u.maxHp  = Math.round(u.maxHp * 1.08);
      u.hp     = u.maxHp;
      u.baseStats.def = Math.round(u.baseStats.def * 1.05);
      u.abilities = u.abilities.map(a => ({
        ...a,
        damage:     a.damage     ? Math.round(a.damage     * 1.06) : 0,
        healAmount: a.healAmount ? Math.round(a.healAmount * 1.06) : 0,
      }));

      const newDmg  = u.abilities.reduce((s, a) => s + (a.damage || 0), 0);
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
        uid:              u.uid,
        name:             u.name,
        emoji:            u.emoji,
        level:            u.level,
        levelAtBattleStart,
        xpAtBattleStart,
        xpAtBattleEnd,
        xpFinal:          u.xp,
        levelsGained,
        levelStatDeltas,
        hp:    u.hp,
        maxHp: u.maxHp,
      });
    }
  });

  return {
    fieldUnits:    aliveField,
    benchUnits:    [...aliveBench, ...injuredFromBattle],
    levelUpResults,
  };
}

/**
 * Apply end-of-round healing to surviving units.
 * Also advances the injury countdown for recovering bench units.
 *
 * Injured countdown: injuredRounds starts at 1.
 *   - First call (same post-battle): decremented to 0, still injured
 *   - Second call (next post-battle): cleared, unit returns at 50% HP
 *
 * Mutates arrays in place.
 */
export function applyPostBattleHealing(fieldUnits, benchUnits) {
  fieldUnits.forEach(u => {
    u.hp = Math.min(u.maxHp, u.hp + Math.round(u.maxHp * 0.10));
  });

  benchUnits.forEach(u => {
    if (u.injured) {
      if ((u.injuredRounds || 0) <= 0) {
        // Recovery complete — come back at 50% HP
        u.injured      = false;
        u.injuredRounds = undefined;
        u.hp = Math.round(u.maxHp * 0.50);
      } else {
        u.injuredRounds--;
        // Small healing even while injured
        u.hp = Math.min(u.maxHp, u.hp + Math.round(u.maxHp * 0.08));
      }
    } else {
      u.hp = Math.min(u.maxHp, u.hp + Math.round(u.maxHp * 0.20));
    }
  });
}

/**
 * Legacy combined wrapper — prefer calling calculateLevelUps +
 * applyPostBattleHealing separately for the new victory screen flow.
 */
export function processPostBattle(fieldUnits, benchUnits) {
  const { fieldUnits: leveled, benchUnits: leveledBench } =
    calculateLevelUps(fieldUnits, benchUnits, {});
  applyPostBattleHealing(leveled, leveledBench);
  return { fieldUnits: leveled, benchUnits: leveledBench };
}
