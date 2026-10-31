// Tap targets on the deck view (Phase 7). Data, not behavior: each target is
// a place on a deck, what it is, and what a tap on it asks the world to do. The
// world answers by placing an order (orders.ts) and the best-fit Lee goes.
// Phase 8 adds "flee this danger zone" and "stab the stunned head" as entries here.

import { isWrecked, type Boat } from './boat';
import { leeWorldPos } from './combat';
import { repairable } from './crew';
import { railPoint, railsOf, tileWorld } from './lines';
import { dist, type Vec } from './math';
import { headOf } from './ness';
import { zoneCenter, zoneRadius } from './zones';
import type { World } from './world';

export type TargetKind = 'zone' | 'head' | 'enemyRope' | 'line' | 'enemyPlank' | 'hook' | 'rope' | 'planks' | 'pole' | 'charge' | 'station' | 'bail' | 'repair' | 'foeTile';

export interface DeckTarget {
  /** Stable while the thing exists (for markers). */
  id: string;
  kind: TargetKind;
  /** Where it is (world); a line also has its far end. */
  a: Vec;
  b?: Vec;
  /** Tap radius around it, m (the scene adds a finger's width). */
  radius: number;
  /** Lower wins where targets overlap. */
  priority: number;
  /** One line for the debug overlay and the tooltip. */
  label: string;
  /** The role that answers it (debug). */
  role: string;
  /** Do it: null when taken, else why not. */
  tap: () => string | null;
  /** The boat whose crew answers. */
  boat: Boat;
}

const PRIORITY: Record<TargetKind, number> = { zone: -1, head: 0.5, enemyRope: 0, line: 1, enemyPlank: 2, hook: 3, rope: 3, planks: 3, pole: 3, charge: 3, station: 3.5, bail: 4, repair: 5, foeTile: 6 };

/** Everything on your deck (and the enemy decks in view) that a tap can do something with, right now. */
export function deckTargets(w: World, decks: Boat[]): DeckTarget[] {
  const out: DeckTarget[] = [];
  const me = w.player;
  const t = w.tuning;
  if (w.result || w.isSinking(me)) return out;
  const add = (d: Omit<DeckTarget, 'priority' | 'boat'> & { boat?: Boat }) => out.push({ boat: me, ...d, priority: PRIORITY[d.kind] });

  // A flashing danger zone on your deck: tap it to get the Lees in it out of the way.
  for (const z of w.zones.pending(me)) {
    if (z.kind === 'rain') continue; // nothing to step away from: the water just comes in
    const what = { slap: 'tail slap', smash: 'head smash', bite: 'bite', drag: 'drag', ink: 'ink', rain: 'rain' }[z.kind];
    add({ id: `zone:${z.id}`, kind: 'zone', a: zoneCenter(z), radius: zoneRadius(z), label: `${what}: step out`, role: 'anyone in it', tap: () => w.tapZone(z, me) });
  }
  // A Ness head resting on your deck, stunned: tap it to stab it.
  for (const n of w.nesses.list) {
    if (n.state !== 'surfaced' || n.stunUntil === null) continue;
    const head = headOf(n);
    add({ id: `head:${n.id}`, kind: 'head', a: head.pos, radius: head.radius + 1.5, label: `${n.def.name}: stab the head`, role: 'board or fix', tap: () => w.tapHead(n, me) });
  }

  // Your rail items.
  for (const kind of ['hook', 'rope', 'planks', 'pole', 'charge'] as const) {
    for (const ref of railsOf(me, kind)) {
      const k = kind === 'planks' ? 'planks' : kind;
      add({
        id: `rail:${ref.rail.slot}`,
        kind: k,
        a: railPoint(me, ref.tile, ref.rail),
        radius: 2.2,
        label: `${ref.tile.label}: ${kind === 'hook' ? 'throw hook' : kind === 'rope' ? 'send a Lee' : kind === 'planks' ? (ref.rail.lowered ? 'raise plank' : 'lower plank') : kind === 'charge' ? 'drop a depth charge' : 'shove off'}`,
        role: kind === 'rope' ? 'board' : 'nearest',
        tap: () => w.tapRail(ref),
      });
    }
  }
  // Lines holding you (theirs or yours).
  for (const line of w.lines.linesOf(me)) {
    add({ id: `line:${line.id}`, kind: 'line', a: w.lines.anchorWorld(line), b: w.lines.attachWorld(line), radius: 1.6, label: 'cut the line', role: 'board or fix', tap: () => w.tapLine(line, me) });
  }
  // Enemy planks lowered onto your rail, and enemy ropes with a Lee on them.
  for (const e of w.enemies) {
    if (w.isSinking(e)) continue;
    for (const ref of railsOf(e, 'planks')) {
      if (!ref.rail.lowered) continue;
      add({ id: `plank:${e.id}:${ref.rail.slot}`, kind: 'enemyPlank', a: railPoint(e, ref.tile, ref.rail), radius: 2.2, label: 'destroy the plank', role: 'board or fix', tap: () => w.tapPlank(ref, me) });
    }
  }
  for (const l of w.allLees()) {
    if (!l.alive || !l.swing || l.swing.cut || l.swing.to !== me || l.side === me.side || l.swing.via?.rail.kind !== 'rope') continue;
    const lee = l;
    const c = leeWorldPos(lee);
    add({ id: `rope:${lee.id}`, kind: 'enemyRope', a: c, radius: 2.4, label: 'cut the rope', role: 'board or fix', tap: () => w.tapRope(lee, me) });
  }
  // A station on your deck (a gun, oars, sails...): man THIS one. Fine control; the job buttons do the rest.
  for (const tile of me.grid.tiles) {
    if (!tile.station || !tile.fixture || tile.fixture.destroyed || isWrecked(me.parts[tile.part])) continue;
    add({ id: `station:${tile.index}`, kind: 'station', a: tileWorld(me, tile), radius: Math.min(me.grid.tileW, me.grid.tileH) * 0.5, label: `${tile.label}: man it`, role: 'nearest', tap: () => w.tapStation(me, tile.index) });
  }
  // Flooded or damaged tiles of your own deck.
  const ai = t.crewAI;
  me.grid.tiles.forEach((tile) => {
    const part = me.parts[tile.part];
    const fill = part.capacity > 0 ? part.water / part.capacity : 0;
    const flooded = fill > Math.max(ai.moderateWaterAt * 0.5, ai.bailStopAt);
    const damaged = repairable(part, t);
    if (!flooded && !damaged) return;
    add({
      id: `tile:${tile.index}`,
      kind: flooded ? 'bail' : 'repair',
      a: tileWorld(me, tile),
      radius: Math.min(me.grid.tileW, me.grid.tileH) * 0.5,
      label: `${tile.label}: ${flooded ? 'bail here first' : 'repair first'}`,
      role: 'fix',
      tap: () => w.tapTile(me, tile.index),
    });
  });
  // Enemy deck tiles where your boarders are: send them there.
  for (const deck of decks) {
    if (deck.side === me.side || w.isSinking(deck)) continue;
    if (!me.crew.lees.some((l) => l.alive && l.deck === deck)) continue;
    for (const tile of deck.grid.tiles) {
      add({ id: `foe:${deck.id}:${tile.index}`, kind: 'foeTile', a: tileWorld(deck, tile), radius: Math.min(deck.grid.tileW, deck.grid.tileH) * 0.5, label: `${tile.label}: boarders head here`, role: 'boarders', tap: () => w.focusDeck(me, deck, tile.index) });
    }
  }
  return out;
}

/** Distance from a point to a target (to the segment, for a line). */
export function targetDistance(tg: DeckTarget, p: Vec): number {
  if (!tg.b) return dist(p, tg.a);
  const dx = tg.b.x - tg.a.x;
  const dy = tg.b.y - tg.a.y;
  const len2 = dx * dx + dy * dy;
  const k = len2 > 1e-9 ? Math.max(0, Math.min(1, ((p.x - tg.a.x) * dx + (p.y - tg.a.y) * dy) / len2)) : 0;
  return dist(p, { x: tg.a.x + dx * k, y: tg.a.y + dy * k });
}

/** The target a tap at `p` means: within its radius plus the finger's `grab`, most urgent first, then nearest. */
export function pickTarget(targets: DeckTarget[], p: Vec, grab: number): DeckTarget | null {
  let best: DeckTarget | null = null;
  let bestD = Infinity;
  for (const tg of targets) {
    const d = targetDistance(tg, p);
    if (d > tg.radius + grab) continue;
    if (!best || tg.priority < best.priority || (tg.priority === best.priority && d < bestD)) {
      best = tg;
      bestD = d;
    }
  }
  return best;
}
