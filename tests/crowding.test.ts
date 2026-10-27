// Lees block each other (Phase 7 playtest): three to a tile, both sides count; allies never get
// shoved aside; a mutual swap is the only way to slide past; an outnumbered Lee is locked in
// place and can't retreat, even by a swap; stepping onto an opposing Lee's tile stops you there.

import { describe, expect, test } from 'vitest';
import { FRIEND_SHIP, SLOOP } from '../src/config/boats';
import { defaultTuning } from '../src/config/tuning';
import type { Boat } from '../src/sim/boat';
import { setDestination, type Lee } from '../src/sim/crew';
import { buildGrid } from '../src/sim/grid';
import { defaultBuild } from '../src/sim/loadout';
import { archetypeSetup, type CrewSpec } from '../src/sim/setup';
import { FIXED_DT } from '../src/sim/steering';
import { toWorld } from '../src/sim/math';
import { World } from '../src/sim/world';

const grid = buildGrid(SLOOP);
const at = (col: number, row: number) => grid.tiles.find((t) => t.col === col && t.row === row)!.index;

/** Your Basic Ship with `mine` Lees and an enemy ship's `theirs` Lees, all standing on YOUR deck where you say. */
function crowd(mine: number, theirs: number) {
  const t = defaultTuning();
  t.boat.flooding.bilgeRate = 0;
  t.boat.flooding.leakRate = 0;
  t.spoils.midSurrender = 0;
  const crew = (n: number): CrewSpec[] => Array.from({ length: n }, (_, i) => ({ type: 'basic', home: grid.tiles[i % grid.tiles.length].index, job: 'board' as const }));
  const es = archetypeSetup('standard', t, 1);
  const w = new World(t, 1, { player: { build: defaultBuild('basic'), crew: crew(mine) }, enemies: [{ ...es, crew: crew(theirs) }], assists: false });
  w.start();
  const me = w.player;
  const foe = w.enemies[0];
  const put = (l: Lee, tile: number, deck: Boat = me) => {
    l.deck = deck;
    l.tile = tile;
    l.pos = { ...deck.grid.tiles[tile].center };
    l.path = [];
    l.dest = tile;
    l.working = true;
    l.retreating = false;
  };
  // The crew AI would reassign everyone each think; these tests drive the Lees by hand.
  const step = (seconds: number, each?: () => void) => {
    for (let i = 0; i < seconds / FIXED_DT; i++) {
      me.crew.thinkIn = 1e9;
      foe.crew.thinkIn = 1e9;
      Object.assign(foe.motion, { x: 900, y: -900, vx: 0, vy: 0 });
      each?.();
      w.step(FIXED_DT);
    }
  };
  const go = (l: Lee, tile: number) => setDestination(l, tile, l.deck);
  return { t, w, me, foe, mine: me.crew.lees, theirs: foe.crew.lees, put, step, go };
}

const occupancy = (lees: Lee[], tile: number) => lees.filter((l) => l.alive && !l.swing && (l.path.length && Math.hypot(l.pos.x - l.deck.grid.tiles[l.tile].center.x, l.pos.y - l.deck.grid.tiles[l.tile].center.y) > 1e-6 ? l.path[0] : l.tile) === tile).length;

describe('crowding', () => {
  test('three Lees to a tile, whoever they are: the fourth waits', () => {
    const c = crowd(5, 0);
    expect(c.t.boarding.tileCap).toBe(3);
    const target = at(2, 1);
    c.mine.forEach((l, i) => c.put(l, at(i % 5, 0)));
    for (const l of c.mine) c.go(l, target);
    let worst = 0;
    c.step(8, () => (worst = Math.max(worst, occupancy(c.mine, target))));
    expect(worst).toBeLessThanOrEqual(3);
    expect(occupancy(c.mine, target)).toBe(3);
    // The other two stand next to it, not on top of it.
    expect(c.mine.filter((l) => l.path.length === 0 && l.tile !== target)).toHaveLength(2);
  });

  test('Lees on the way somewhere else do not pass through a full tile: they go round, or wait', () => {
    const c = crowd(4, 0);
    const full = at(2, 1);
    c.put(c.mine[0], full);
    c.put(c.mine[1], full);
    c.put(c.mine[2], full);
    c.put(c.mine[3], at(0, 1));
    c.go(c.mine[3], at(4, 1));
    let through = false;
    c.step(10, () => {
      if (c.mine[3].tile === full) through = true;
    });
    expect(through).toBe(false);
    expect(c.mine[3].tile).toBe(at(4, 1)); // round the other rows
    // ...and the three standing there never got shoved off it.
    for (const l of c.mine.slice(0, 3)) expect(l.tile).toBe(full);
  });

  test('two Lees on full tiles can swap places when each is leaving for the other\'s tile', () => {
    const c = crowd(6, 0);
    const a = at(1, 1);
    const b = at(2, 1);
    c.put(c.mine[0], a);
    c.put(c.mine[1], a);
    c.put(c.mine[2], a);
    c.put(c.mine[3], b);
    c.put(c.mine[4], b);
    c.put(c.mine[5], b);
    c.go(c.mine[0], b);
    c.go(c.mine[3], a);
    let worst = 0;
    c.step(4, () => (worst = Math.max(worst, occupancy(c.mine, a), occupancy(c.mine, b))));
    expect(c.mine[0].tile).toBe(b);
    expect(c.mine[3].tile).toBe(a);
    expect(worst).toBeLessThanOrEqual(4); // a swap is momentary
    expect(occupancy(c.mine, a)).toBe(3);
    expect(occupancy(c.mine, b)).toBe(3);
  });

  test('a one-way move into a full tile is not a swap: it waits', () => {
    const c = crowd(4, 0);
    const a = at(1, 1);
    const b = at(2, 1);
    c.put(c.mine[0], a);
    c.put(c.mine[1], b);
    c.put(c.mine[2], b);
    c.put(c.mine[3], b);
    c.go(c.mine[0], b);
    c.step(1.5);
    expect(c.mine[0].tile).toBe(a);
    expect(c.mine[0].path.length).toBeGreaterThan(0); // still waiting
    c.step(2);
    expect(occupancy(c.mine, b)).toBe(3); // and it never got in
  });

  test('outnumbered, you are locked in place: no leaving, no retreat, no swap; the wounded fight on', () => {
    const c = crowd(2, 2);
    const here = at(2, 1);
    const next = at(3, 1);
    c.put(c.mine[0], here);
    c.put(c.theirs[0], here);
    c.put(c.theirs[1], here);
    c.put(c.mine[1], next);
    c.step(0.1); // the fight is on before anyone tries to leave
    c.mine[0].retreating = true;
    c.go(c.mine[0], next);
    c.go(c.mine[1], here); // would be a swap
    c.step(3);
    expect(c.mine[0].locked).toBe(true);
    expect(c.mine[0].tile).toBe(here);
    expect(c.mine[0].engaged).toBe(true); // a locked retreater fights
    expect(c.mine[1].tile).toBe(next); // and its would-be swap partner can't get in either (the tile is full)
  });

  test('not outnumbered, you can leave: an even fight lets a retreating Lee walk away', () => {
    const c = crowd(1, 1);
    const here = at(2, 1);
    c.put(c.mine[0], here);
    c.put(c.theirs[0], here);
    c.step(0.1);
    c.mine[0].retreating = true;
    c.go(c.mine[0], at(0, 1));
    c.step(5);
    expect(c.mine[0].locked).toBe(false);
    expect(c.mine[0].tile).toBe(at(0, 1));
  });

  test('a retreat blocked by your own friends is a fight: the Lee stays and swings at what is on its tile', () => {
    const c = crowd(4, 1);
    const here = at(1, 1);
    const wall = at(0, 1);
    c.put(c.mine[0], here);
    c.put(c.theirs[0], here);
    for (const l of c.mine.slice(1, 4)) c.put(l, wall);
    c.step(0.1);
    c.mine[0].retreating = true;
    c.go(c.mine[0], wall); // the tile behind it is full of friends
    c.step(1.5);
    expect(c.mine[0].tile).toBe(here);
    expect(c.mine[0].engaged).toBe(true);
    for (const l of c.mine.slice(1, 4)) expect(l.tile).toBe(wall); // nobody got shoved
  });

  test('stepping onto a tile with an opposing Lee ends the walk there: you stop and fight', () => {
    const c = crowd(1, 1);
    c.put(c.mine[0], at(0, 1));
    c.put(c.theirs[0], at(2, 1));
    c.go(c.mine[0], at(4, 1));
    c.step(6);
    expect(c.mine[0].tile).toBe(at(2, 1));
    expect(c.mine[0].engaged).toBe(true);
  });

  test('eight Lees against two on one deck: they spread over tiles and win without losses, never more than three to a tile', () => {
    const c = crowd(8, 2);
    c.mine.forEach((l, i) => c.put(l, at(i % 5, 0)));
    c.theirs.forEach((l, i) => c.put(l, at(2 + i, 2)));
    let worst = 0;
    let t = 0;
    // The crew AI runs here: boarders hunt, repel and fight on their own.
    for (let i = 0; i < 60 / FIXED_DT && c.theirs.some((l) => l.alive); i++) {
      Object.assign(c.foe.motion, { x: 900, y: -900, vx: 0, vy: 0 });
      c.w.step(FIXED_DT);
      t = c.w.time;
      for (const tile of grid.tiles) worst = Math.max(worst, occupancy(c.w.allLees(), tile.index));
    }
    expect(c.theirs.every((l) => !l.alive)).toBe(true);
    expect(c.mine.filter((l) => l.alive).length).toBeGreaterThanOrEqual(7);
    expect(worst).toBeLessThanOrEqual(3);
    expect(t).toBeLessThan(45);
  });
});

describe('🔫 Lees in close combat', () => {
  const fgrid = buildGrid(FRIEND_SHIP);
  const fat = (col: number, row: number) => fgrid.tiles.find((t) => t.col === col && t.row === row)!.index;

  /** Your Friend Ship's gunners are at its stern; a Basic Ship lies beside it with its Lees up near your bow, out of pistol range of them. */
  function across() {
    const t = defaultTuning();
    t.boat.flooding.bilgeRate = 0;
    t.boat.flooding.leakRate = 0;
    t.spoils.midSurrender = 0;
    const mine: CrewSpec[] = [fat(0, 0), fat(0, 1), fat(1, 0)].map((home) => ({ type: 'basic', home, job: 'fire' as const }));
    const es = archetypeSetup('standard', t, 1);
    const theirs: CrewSpec[] = [at(3, 2), at(4, 2)].map((home) => ({ type: 'basic', home, job: 'fix' as const }));
    // A Friend Ship with only a pair of oars: no gun for them to man.
    const w = new World(t, 1, { player: { build: { ship: 'friend', loadout: { 'fix:2,0': 'oars' } }, crew: mine }, enemies: [{ ...es, crew: theirs, ai: { ...t.ai.standard, boardShare: 0 } }], assists: false });
    w.start();
    const e = w.enemies[0];
    const off = w.player.layout.beam / 2 + e.layout.beam / 2 + 1.2;
    let startNear = Infinity;
    for (let i = 0; i < 14 / FIXED_DT; i++) {
      // The Friend Ship heads north, the enemy lies to its east with its middle level with your bow half.
      Object.assign(w.player.motion, { x: 0, y: 0, heading: -Math.PI / 2, vx: 0, vy: 0, omega: 0 });
      Object.assign(e.motion, { x: off, y: -12, heading: -Math.PI / 2, vx: 0, vy: 0, omega: 0 });
      w.step(FIXED_DT);
      if (i === 0) startNear = nearestFoe(w);
    }
    return { w, startNear };
  }
  const nearestFoe = (w: World) => {
    let best = Infinity;
    for (const l of w.player.crew.lees) {
      const p = toWorld(l.pos, l.deck.motion, l.deck.motion.heading);
      for (const o of w.enemies[0].crew.lees) best = Math.min(best, Math.hypot(p.x - toWorld(o.pos, o.deck.motion, o.deck.motion.heading).x, p.y - toWorld(o.pos, o.deck.motion, o.deck.motion.heading).y));
    }
    return best;
  };

  test('with nothing their guns can hit, gunners move up to a firing spot on the rail and shoot their pistols across', () => {
    const { w, startNear } = across();
    expect(startNear).toBeGreaterThan(w.tuning.pistol.range); // from the stern nobody could hit anybody
    expect(w.player.crew.lees.some((l) => l.task.type === 'cover' && l.working)).toBe(true);
    expect(w.stats.player.pistolShots).toBeGreaterThan(3);
    // They stood on a tile within pistol range of an enemy Lee, not back at their guns.
    expect(nearestFoe(w)).toBeLessThanOrEqual(w.tuning.pistol.range);
    // Nobody was told to do this: only the crew AI, because their job is 🔫 and nothing could fire.
  });
});
