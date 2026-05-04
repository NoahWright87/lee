/**
 * Build a lookup map from sorted pair key → result Lee id.
 * Call once at startup with all Lee definitions.
 *
 * @param {object[]} allLees
 * @returns {Record<string,string>}
 */
export function buildCombineMap(allLees) {
  const map = {};
  allLees
    .filter(l => l.acquisition?.method === 'combine' || l.acquisition?.method === 'both')
    .forEach(lee => {
      const [a, b] = lee.acquisition.combineFrom;
      const key = [a, b].sort().join('+');
      map[key] = lee.id;
    });
  return map;
}

/**
 * @param {{id:string}} unitA
 * @param {{id:string}} unitB
 * @param {Record<string,string>} combineMap
 * @returns {string|null}  Result Lee id, or null if no recipe.
 */
export function getCombineResult(unitA, unitB, combineMap) {
  const key = [unitA.id, unitB.id].sort().join('+');
  return combineMap[key] ?? null;
}

/**
 * Find all possible merges among a set of player units.
 * Each unit can only participate in one merge (greedy first-match).
 *
 * @param {object[]} playerUnits  Combined field + bench units
 * @param {Record<string,string>} combineMap
 * @returns {{ a: object, b: object, resultId: string }[]}
 */
export function findMerges(playerUnits, combineMap) {
  const merges = [];
  const used = new Set();

  for (let i = 0; i < playerUnits.length; i++) {
    if (used.has(playerUnits[i].uid)) continue;
    for (let j = i + 1; j < playerUnits.length; j++) {
      if (used.has(playerUnits[j].uid)) continue;
      const resultId = getCombineResult(playerUnits[i], playerUnits[j], combineMap);
      if (resultId) {
        merges.push({ a: playerUnits[i], b: playerUnits[j], resultId });
        used.add(playerUnits[i].uid);
        used.add(playerUnits[j].uid);
        break;
      }
    }
  }

  return merges;
}
