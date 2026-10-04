/**
 * XP required to advance from `level` to `level + 1`.
 * Starts cheap to guarantee early level-ups, ramps up at higher levels.
 *
 *   Lv 1 → 2 :  50
 *   Lv 2 → 3 :  63
 *   Lv 3 → 4 :  78
 *   Lv 4 → 5 :  98
 *   Lv 5 → 6 : 122
 *   Lv 6 → 7 : 153
 *   Lv 7 → 8 : 191
 *   …
 */
export function xpToNextLevel(level) {
  return Math.floor(50 * Math.pow(1.25, level - 1));
}
