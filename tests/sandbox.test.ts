// The sandbox's random ship: a ship, parts and crew built from points, the way the sea builds enemies.

import { describe, expect, test } from 'vitest';
import { defaultTuning } from '../src/config/tuning';
import { SHIPS, SHIP_ORDER } from '../src/config/ships';
import { slotById } from '../src/sim/loadout';
import { crewMax, newRun, randomizeRun, setupFor } from '../src/sim/run';
import { FIXED_DT } from '../src/sim/steering';
import { World } from '../src/sim/world';

describe('random ship', () => {
  test('builds a legal ship and crew within the points, and it can fight', () => {
    const t = defaultTuning();
    for (const budget of [150, 400, 900]) {
      for (let seed = 1; seed <= 6; seed++) {
        const run = newRun('basic', 99, t);
        const spent = randomizeRun(run, budget, seed, t);
        expect(SHIPS[run.ship]).toBeDefined();
        expect(spent).toBeLessThanOrEqual(budget + 1e-6);
        expect(run.crew.length).toBeGreaterThan(0);
        expect(run.crew.length).toBeLessThanOrEqual(crewMax(run, t));
        for (const slot of Object.keys(run.loadout)) if (!slot.startsWith('treasure:')) expect(slotById(SHIPS[run.ship], slot.replace(/^att:/, '')) ?? slot.startsWith('att:'), slot).toBeTruthy();
        expect(run.crew.some((m) => m.home !== null)).toBe(true);
        expect(run.hull).toHaveLength(SHIPS[run.ship].layout.parts.length);
        // It builds a world and sails.
        const w = new World(t, 1, { player: setupFor(run, t), enemies: [], nesses: [{ kind: 'weak' }], assists: false });
        w.start();
        for (let i = 0; i < 120; i++) w.step(FIXED_DT);
        expect(w.player.crew.lees.length).toBeGreaterThan(0);
      }
    }
  });

  test('a bigger budget buys more ship', () => {
    const t = defaultTuning();
    const value = (budget: number): number => {
      let total = 0;
      for (let seed = 1; seed <= 8; seed++) {
        const run = newRun('basic', 1, t);
        total += randomizeRun(run, budget, seed, t);
      }
      return total;
    };
    expect(value(900)).toBeGreaterThan(value(200));
  });

  test('a chosen chassis is used when asked, and the same seed gives the same ship', () => {
    const t = defaultTuning();
    for (const id of SHIP_ORDER) {
      const a = newRun('basic', 1, t);
      randomizeRun(a, 700, 5, t, id);
      expect(a.ship).toBe(id);
      const b = newRun('basic', 1, t);
      randomizeRun(b, 700, 5, t, id);
      expect(b.crew.map((m) => m.type)).toEqual(a.crew.map((m) => m.type));
      expect(Object.keys(b.loadout).sort()).toEqual(Object.keys(a.loadout).sort());
    }
  });
});
