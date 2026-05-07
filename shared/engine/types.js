// TODO: Type matchup chart is not yet finalized.
// The six types (rage, chill, whimsy, cringe, smug, unknown) and their
// relationships (opposite pairs 1.5x, clockwise ring 0.5x) are designed
// but the exact multiplier table needs designer sign-off.
// Tracking in: https://github.com/noahwright87/lee/issues (type-system)
// For now all multipliers return 1.0 — types are cosmetic only.

export const TYPE_META = {
  rage:    { emoji: '🔥', color: '#ff4444' },
  chill:   { emoji: '❄️',  color: '#4dd9ff' },
  whimsy:  { emoji: '✨', color: '#ffcc00' },
  cringe:  { emoji: '😬', color: '#c084fc' },
  smug:    { emoji: '😎', color: '#fbbf24' },
  unknown: { emoji: '❓', color: '#aaaaaa' },
  none:    { emoji: '⬜', color: '#555555' },
};

/** @param {string} attackerType @param {string} defenderType @returns {number} */
export function getDamageMultiplier(_attackerType, _defenderType) {
  return 1.0;
}

/** @param {string} type @returns {string} hex color */
export function getTypeColor(type) {
  return TYPE_META[type]?.color ?? '#555555';
}

/** @param {string} type @returns {string} emoji */
export function getTypeEmoji(type) {
  return TYPE_META[type]?.emoji ?? '⬜';
}
