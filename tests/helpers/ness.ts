import type { World } from '../../src/sim/world';

/** Tap the first pending zone on the player's deck. */
export function tapZoneFor(w: World): string | null {
  const z = w.zones.pending(w.player)[0];
  return z ? w.tapZone(z) : 'no zone';
}
