/**
 * Build a lookup map from sorted pair key → result Lee id.
 * `combineFrom` may be a single pair ["a","b"] (legacy) or an array of pairs [["a","b"],["c","d"]].
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
      const routes = lee.acquisition.combineFrom;
      if (!routes?.length) return;
      // Normalise: flat [a,b] → [[a,b]], already [[a,b],...] passes through
      const pairs = Array.isArray(routes[0]) ? routes : [routes];
      pairs.forEach(pair => {
        const [a, b] = pair;
        if (!a || !b) return;
        const key = [a, b].sort().join('+');
        map[key] = lee.id;
      });
    });
  return map;
}

/**
 * @param {{id:string}} unitA
 * @param {{id:string}} unitB
 * @param {Record<string,string>} combineMap
 * @returns {string|null}
 */
export function getCombineResult(unitA, unitB, combineMap) {
  const key = [unitA.id, unitB.id].sort().join('+');
  return combineMap[key] ?? null;
}

/**
 * Find all possible merges among a set of player units.
 * Each unit can only participate in one merge (greedy first-match).
 *
 * @param {object[]} playerUnits
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
