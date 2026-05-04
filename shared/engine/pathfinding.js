/**
 * Chebyshev distance — used for ability range checks.
 * @param {{row:number,col:number}} a
 * @param {{row:number,col:number}} b
 */
export function chebyshev(a, b) {
  return Math.max(Math.abs(a.row - b.row), Math.abs(a.col - b.col));
}

/**
 * Manhattan distance — used for pathfinding target selection.
 * @param {{row:number,col:number}} a
 * @param {{row:number,col:number}} b
 */
export function manhattan(a, b) {
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col);
}

/**
 * Find what a unit wants to move toward, based on its moveBehavior.
 * Returns a unit object (the target) or null if no valid target exists.
 *
 * @param {object} unit
 * @param {object[]} allUnits
 * @returns {object|null}
 */
export function findMovementTarget(unit, allUnits) {
  const moveBehavior = unit.moveBehavior || 'nearest-enemy';
  const enemies = allUnits.filter(u => u.alive && u.side !== unit.side);
  const allies  = allUnits.filter(u => u.alive && u.side === unit.side && u.uid !== unit.uid);

  switch (moveBehavior) {
    case 'weakest-enemy': {
      if (!enemies.length) return null;
      return enemies.reduce((a, b) => a.hp <= b.hp ? a : b);
    }
    case 'weakest-ally': {
      if (!allies.length) {
        // No allies to tend — advance toward nearest enemy instead
        if (!enemies.length) return null;
        return enemies.reduce((a, b) => manhattan(unit, a) <= manhattan(unit, b) ? a : b);
      }
      // Target ally with lowest HP percentage
      return allies.reduce((a, b) =>
        (a.hp / (a.maxHp || 1)) <= (b.hp / (b.maxHp || 1)) ? a : b
      );
    }
    case 'nearest-enemy':
    default: {
      if (!enemies.length) return null;
      return enemies.reduce((a, b) =>
        manhattan(unit, a) <= manhattan(unit, b) ? a : b
      );
    }
  }
}

/**
 * Return the next [row, col] step toward `target`, avoiding occupied tiles.
 * Prefers moving along the axis with greater distance (Manhattan greedy).
 *
 * @param {object} unit
 * @param {object[]} allUnits
 * @param {object} target
 * @param {{rows:number,cols:number}} fieldConfig
 * @returns {[number,number]|null}
 */
export function stepToward(unit, allUnits, target, fieldConfig) {
  const { rows, cols } = fieldConfig;
  const occupied = new Set(
    allUnits
      .filter(u => u.alive && u.uid !== unit.uid)
      .map(u => `${u.row},${u.col}`)
  );

  const dr = target.row - unit.row;
  const dc = target.col - unit.col;
  const candidates = [];

  // Prefer the axis with greater distance first
  if (Math.abs(dr) >= Math.abs(dc)) {
    if (dr !== 0) candidates.push([unit.row + Math.sign(dr), unit.col]);
    if (dc !== 0) candidates.push([unit.row, unit.col + Math.sign(dc)]);
  } else {
    if (dc !== 0) candidates.push([unit.row, unit.col + Math.sign(dc)]);
    if (dr !== 0) candidates.push([unit.row + Math.sign(dr), unit.col]);
  }

  const valid = candidates.filter(([r, c]) =>
    r >= 0 && r < rows && c >= 0 && c < cols && !occupied.has(`${r},${c}`)
  );

  return valid.length ? valid[0] : null;
}
