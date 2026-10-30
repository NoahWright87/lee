// Which boats the "Fit" cameras frame. Data, not drawing: the scene turns these
// into a zoom and a center. Kept here so it can be tested without Phaser.
//  - Ocean (top): you and every enemy that could be fighting you: one of us has cannons
//    that reach the other, or it's close enough to board, or it's in close combat. With
//    none of those, everything still afloat, so you see what's coming.
//  - Deck (bottom): your deck, plus every enemy deck whose crew you can see or that has
//    your Lees on it: the engaged enemy (its bars show), anything touching, anything
//    close enough to show a deck.

import { hullGap } from './contact';
import { distanceToHull, maxGunRange, type Boat } from './boat';
import type { Ness } from './ness';
import type { World } from './world';

/** Most enemy decks the deck view will try to fit at once. */
const MAX_DECKS = 3;

/**
 * What the top camera frames: you, every enemy that could be fighting you, and every Ness that is
 * rising or up (or a shadow within reach). `prev` holds the ones that were in play last frame: they stay
 * until they're a bit past the line, so the zoom doesn't pump at the edge. With none in play, all of them.
 */
export function oceanFit(w: World, prev: Set<number>): { boats: Boat[]; nesses: Ness[] } {
  const me = w.player;
  const live = w.enemies.filter((e) => w.sinkAnim(e) < 1);
  const monsters = w.liveNesses();
  const mine = maxGunRange(me, w.tuning);
  const slack = 1 + Math.max(0, w.tuning.camera.rangeHysteresis);
  const inPlay = new Set<number>();
  for (const e of live) {
    const reach = Math.max(mine, maxGunRange(e, w.tuning));
    if (hullGap(me, e).gap <= reach * (prev.has(e.id) ? slack : 1)) inPlay.add(e.id);
  }
  for (const e of w.closeBoats()) inPlay.add(e.id);
  for (const e of w.touching(me)) inPlay.add(e.id);
  for (const line of w.lines.linesOf(me)) inPlay.add((line.owner === me ? line.target : line.owner).id);
  // A Ness is in play while it is rising or up, or its shadow is within your guns' reach.
  for (const n of monsters) {
    const reach = Math.max(mine, 60) * (prev.has(n.id) ? slack : 1);
    if (n.state !== 'submerged' || distanceToHull(me, { x: n.x, y: n.y }) <= reach) inPlay.add(n.id);
  }
  const any = inPlay.size > 0;
  prev.clear();
  for (const e of inPlay) prev.add(e);
  return { boats: [me, ...(any ? live.filter((e) => inPlay.has(e.id)) : live)], nesses: any ? monsters.filter((n) => inPlay.has(n.id)) : monsters };
}

/** The boats the top camera frames (you first). */
export function oceanFitBoats(w: World, prev: Set<number>): Boat[] {
  return oceanFit(w, prev).boats;
}

/** Boats the bottom camera frames (you first). */
export function deckFitBoats(w: World): Boat[] {
  const me = w.player;
  const out: Boat[] = [me];
  const add = (e: Boat | null | undefined) => {
    if (e && e !== me && e.side !== me.side && !out.includes(e) && w.sinkAnim(e) < 1 && out.length <= MAX_DECKS) out.push(e);
  };
  add(w.engagedEnemy());
  for (const e of w.touching(me)) add(e);
  // Wherever your Lees are standing or swinging to, so no one is off the screen.
  for (const l of me.crew.lees) if (l.alive) add(l.swing ? l.swing.to : l.deck);
  for (const e of w.closeBoats()) add(e);
  return out;
}
