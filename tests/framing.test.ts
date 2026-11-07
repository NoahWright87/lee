// The "Fit" cameras: which boats the top view frames and which decks the bottom view frames.

import { describe, expect, test } from 'vitest';
import { defaultTuning, type Tuning } from '../src/config/tuning';
import { maxGunRange, type Boat } from '../src/sim/boat';
import { deckFitBoats, oceanFitBoats } from '../src/sim/framing';
import type { Vec } from '../src/sim/math';
import { archetypeSetup, autoArrange, type BoatSetup, type CrewSpec } from '../src/sim/setup';
import { World } from '../src/sim/world';

function quiet(t: Tuning): Tuning {
  t.boat.flooding.bilgeRate = 0;
  t.boat.flooding.leakRate = 0;
  t.spoils.midSurrender = 0;
  return t;
}

function pin(b: Boat, at: Vec, heading = -Math.PI / 2): void {
  Object.assign(b.motion, { x: at.x, y: at.y, heading, vx: 0, vy: 0, omega: 0 });
  b.target = null;
}

function enemy(t: Tuning, type: string, crew: number, seed = 1): BoatSetup {
  const s = archetypeSetup(type, t, seed);
  const specs: CrewSpec[] = Array.from({ length: crew }, () => ({ type: 'basic', home: null as number | null }));
  autoArrange(s.build, specs, t).forEach((h, i) => (specs[i].home = h));
  return { ...s, crew: specs };
}

const ids = (boats: Boat[]) => boats.map((b) => b.id).sort((a, b) => a - b);

describe('Fit: the ocean view', () => {
  test('with nothing in cannon range it frames every enemy afloat, however far', () => {
    const t = quiet(defaultTuning());
    const w = new World(t, 1, { enemies: [enemy(t, 'standard', 0), enemy(t, 'standard', 0)], crew: [] });
    w.start();
    pin(w.player, { x: 0, y: 0 });
    pin(w.enemies[0], { x: -900, y: 0 });
    pin(w.enemies[1], { x: 0, y: 1200 });
    const reach = Math.max(maxGunRange(w.player, t), maxGunRange(w.enemies[0], t), maxGunRange(w.enemies[1], t));
    expect(reach).toBeLessThan(800);
    const fit = oceanFitBoats(w, new Set());
    expect(fit[0]).toBe(w.player);
    expect(ids(fit)).toEqual(ids([w.player, ...w.enemies]));
  });

  test('once one enemy is in cannon range, the far ones drop out; they return when it is gone', () => {
    const t = quiet(defaultTuning());
    const w = new World(t, 1, { enemies: [enemy(t, 'standard', 0), enemy(t, 'standard', 0)], crew: [] });
    w.start();
    pin(w.player, { x: 0, y: 0 });
    const reach = Math.max(maxGunRange(w.player, t), maxGunRange(w.enemies[0], t));
    pin(w.enemies[0], { x: -(reach * 0.5), y: 0 });
    pin(w.enemies[1], { x: 0, y: reach * 4 });
    const prev = new Set<number>();
    expect(ids(oceanFitBoats(w, prev))).toEqual(ids([w.player, w.enemies[0]]));
    // Slip the near one far away: nothing in range, so both are framed again.
    pin(w.enemies[0], { x: -(reach * 6), y: 0 });
    expect(ids(oceanFitBoats(w, prev))).toEqual(ids([w.player, ...w.enemies]));
  });

  test('an enemy just past the line stays framed until it is clearly out (no pumping)', () => {
    const t = quiet(defaultTuning());
    const w = new World(t, 1, { enemies: [enemy(t, 'standard', 0), enemy(t, 'standard', 0)], crew: [] });
    w.start();
    pin(w.player, { x: 0, y: 0 });
    const reach = Math.max(maxGunRange(w.player, t), maxGunRange(w.enemies[0], t));
    // The other one stays in range, so "nothing in range → show everyone" doesn't apply.
    pin(w.enemies[1], { x: 0, y: reach * 0.4 });
    const e = w.enemies[0];
    const gapAt = (g: number) => {
      pin(e, { x: -(w.player.layout.beam / 2 + e.layout.beam / 2 + g), y: 0 });
    };
    const prev = new Set<number>();
    gapAt(reach - 2);
    expect(oceanFitBoats(w, prev)).toContain(e);
    gapAt(reach + 3);
    expect(oceanFitBoats(w, prev)).toContain(e);
    gapAt(reach * (1 + t.camera.rangeHysteresis) + 20);
    expect(oceanFitBoats(w, prev)).not.toContain(e);
  });

  test('a boat we are in melee with is framed even with no cannon reach', () => {
    const t = quiet(defaultTuning());
    const w = new World(t, 1, { enemies: [enemy(t, 'standard', 2), enemy(t, 'standard', 0)], crew: [] });
    w.start();
    pin(w.player, { x: 0, y: 0 });
    pin(w.enemies[0], { x: -(w.player.layout.beam / 2 + w.enemies[0].layout.beam / 2 + 2), y: 0 });
    pin(w.enemies[1], { x: 0, y: 5000 });
    for (const g of [...w.player.guns, ...w.enemies[0].guns]) g.partIndex = -1;
    const fit = oceanFitBoats(w, new Set());
    expect(fit).toContain(w.enemies[0]);
    expect(fit).not.toContain(w.enemies[1]);
  });
});

describe('Fit: the deck view', () => {
  test('alone at long range it is just your deck', () => {
    const t = quiet(defaultTuning());
    const w = new World(t, 1, { enemies: [enemy(t, 'standard', 2)], crew: [] });
    w.start();
    pin(w.player, { x: 0, y: 0 });
    pin(w.enemies[0], { x: -400, y: 0 });
    expect(deckFitBoats(w)).toEqual([w.player]);
  });

  test('it adds the enemy whose crew bars show, and the deck your boarders are on', () => {
    const t = quiet(defaultTuning());
    const w = new World(t, 1, { enemies: [enemy(t, 'standard', 3), enemy(t, 'standard', 3)], crew: [] });
    w.start();
    pin(w.player, { x: 0, y: 0 });
    const e = w.enemies[0];
    pin(e, { x: -(w.player.layout.beam / 2 + e.layout.beam / 2 + 3), y: 0 });
    pin(w.enemies[1], { x: 0, y: 500 });
    const decks = deckFitBoats(w);
    expect(decks[0]).toBe(w.player);
    expect(decks).toContain(e);
    expect(decks).not.toContain(w.enemies[1]);
    // A Lee of yours standing on the far one pulls that deck in too.
    const far = w.enemies[1];
    const lee = w.player.crew.lees.find((l) => l.alive);
    if (lee) {
      lee.deck = far;
      expect(deckFitBoats(w)).toContain(far);
    }
  });
});
