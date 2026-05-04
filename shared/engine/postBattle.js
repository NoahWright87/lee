/**
 * Process the end-of-round sequence after a player victory:
 *   1. Remove dead field units.
 *   2. Level up any unit (field or bench) with >= 100 XP.
 *      Leveling up fully restores HP.
 *   3. Heal survivors: +10% maxHp for field, +20% maxHp for bench.
 *
 * Mutates copies — call with spread arrays if you need to preserve originals.
 *
 * @param {object[]} fieldUnits   Units that fought (may include dead ones)
 * @param {object[]} benchUnits   Units that sat out
 * @returns {{ fieldUnits: object[], benchUnits: object[] }}
 */
export function processPostBattle(fieldUnits, benchUnits) {
  const aliveField = fieldUnits.filter(u => u.alive).map(u => ({ ...u, abilities: u.abilities.map(a => ({ ...a })), baseStats: { ...u.baseStats } }));
  const aliveBench = benchUnits.map(u => ({ ...u, abilities: u.abilities.map(a => ({ ...a })), baseStats: { ...u.baseStats } }));

  [...aliveField, ...aliveBench].forEach(u => {
    while ((u.xp || 0) >= 100) {
      u.level = (u.level || 1) + 1;
      u.xp -= 100;
      u.maxHp = Math.round(u.maxHp * 1.08);
      u.hp = u.maxHp; // full heal on level-up
      u.baseStats.def = Math.round(u.baseStats.def * 1.05);
      u.abilities = u.abilities.map(a => ({
        ...a,
        damage:     a.damage     ? Math.round(a.damage     * 1.06) : 0,
        healAmount: a.healAmount ? Math.round(a.healAmount * 1.06) : 0,
      }));
    }
  });

  // End-of-round healing (only for units that didn't just level up to full)
  aliveField.forEach(u => {
    u.hp = Math.min(u.maxHp, u.hp + Math.round(u.maxHp * 0.10));
  });
  aliveBench.forEach(u => {
    u.hp = Math.min(u.maxHp, u.hp + Math.round(u.maxHp * 0.20));
  });

  return { fieldUnits: aliveField, benchUnits: aliveBench };
}
