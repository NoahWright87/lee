function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function weightedTypeForFloor(floor) {
  if (floor === 0) {
    return Math.random() < 0.75 ? 'battle' : 'rest';
  }
  // Every 3rd floor is "shop-weighted"
  const shopWindow = floor % 3 === 2;
  const roll = Math.random();
  if (shopWindow) {
    if (roll < 0.30) return 'shop';
    if (roll < 0.55) return 'elite';
    if (roll < 0.80) return 'rest';
    return 'battle';
  }
  if (roll < 0.45) return 'battle';
  if (roll < 0.65) return 'elite';
  if (roll < 0.80) return 'rest';
  return 'shop';
}

function pickEnemyRosterIds(allLees, floor, nodeType) {
  const round = floor + 1;
  const effectiveRound =
    nodeType === 'elite' ? round + 1 :
    nodeType === 'boss'  ? round + 3 : round;
  const maxTier = effectiveRound <= 2 ? 1 : effectiveRound <= 4 ? 2 : 3;
  const count = Math.min(2 + Math.floor(round * 0.6), 8);
  const pool = allLees.filter(l => l.tier <= maxTier);
  return shuffle(pool).slice(0, Math.min(count, pool.length)).map(l => l.id);
}

/**
 * Generate a Slay-the-Spire-style map.
 *
 * @param {object[]} allLees  All Lee definitions (used to pre-select enemy rosters)
 * @param {number}   totalFloors  Total number of floors including the boss floor
 * @returns {{ floors: object[][], nodes: object, startNodeIds: string[], totalFloors: number }}
 */
export function generateSpireMap(allLees, totalFloors = 10) {
  const floors = [];

  for (let f = 0; f < totalFloors; f++) {
    if (f === totalFloors - 1) {
      floors.push([{
        id: `n-${f}-1`,
        floor: f,
        position: 1,
        type: 'boss',
        connections: [],
        enemyRosterIds: pickEnemyRosterIds(allLees, f, 'boss'),
      }]);
      continue;
    }

    // Floor 0: 2-3 nodes so the player has an immediate choice
    const minNodes = f === 0 ? 2 : 1;
    const count = minNodes + Math.floor(Math.random() * (3 - minNodes + 1));
    const positions = shuffle([0, 1, 2]).slice(0, count).sort((a, b) => a - b);

    floors.push(positions.map(pos => {
      const type = weightedTypeForFloor(f);
      return {
        id: `n-${f}-${pos}`,
        floor: f,
        position: pos,
        type,
        connections: [],
        enemyRosterIds: (type === 'battle' || type === 'elite')
          ? pickEnemyRosterIds(allLees, f, type)
          : null,
      };
    }));
  }

  // Connect floors: each node connects to the nearest in the next floor,
  // with a 35% chance of an extra connection.  Every node in every floor
  // must be reachable.
  for (let f = 0; f < totalFloors - 1; f++) {
    const cur = floors[f];
    const nxt = floors[f + 1];

    cur.forEach(node => {
      const sorted = [...nxt].sort(
        (a, b) => Math.abs(a.position - node.position) - Math.abs(b.position - node.position)
      );
      node.connections.push(sorted[0].id);
      if (sorted.length > 1 && Math.random() < 0.35) {
        node.connections.push(sorted[1].id);
      }
    });

    // Ensure every node in next floor has at least one incoming connection
    nxt.forEach(nextNode => {
      const reachable = cur.some(n => n.connections.includes(nextNode.id));
      if (!reachable) {
        const nearest = cur.reduce((best, n) =>
          Math.abs(n.position - nextNode.position) < Math.abs(best.position - nextNode.position)
            ? n : best
        );
        if (!nearest.connections.includes(nextNode.id)) {
          nearest.connections.push(nextNode.id);
        }
      }
    });
  }

  const nodes = {};
  floors.flat().forEach(n => { nodes[n.id] = n; });

  return {
    floors,
    nodes,
    startNodeIds: floors[0].map(n => n.id),
    totalFloors,
  };
}
