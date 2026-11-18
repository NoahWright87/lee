// Nesses in the run: costs, mixed and Ness-only fights, the sea map's Ness waters and lair,
// what a slain Ness pays, and saves from before Nesses.

import { describe, expect, test } from 'vitest';
import { MAP_STYLES, STOP_TYPES } from '../src/config/sea';
import { defaultTuning } from '../src/config/tuning';
import { generateEncounter, generateNesses, nessCost } from '../src/sim/budget';
import { Rng, rngFor } from '../src/sim/math';
import { enterPort, makePlan } from '../src/sim/port';
import { applyFight, emptyPost, encounterSummary, loadRun, newRun, saveRun } from '../src/sim/run';
import { combinedStyle, generateMap } from '../src/sim/seaMap';
import { FIXED_DT } from '../src/sim/steering';
import { World } from '../src/sim/world';

describe('Ness budgets', () => {
  test('a Ness costs its kind\'s points, plus a share for each level', () => {
    const t = defaultTuning();
    expect(nessCost('ness', 1, t)).toBe(t.ness.kinds.ness.cost);
    expect(nessCost('ness', 3, t)).toBeCloseTo(t.ness.kinds.ness.cost * (1 + 2 * t.ness.common.levelCost), 5);
  });

  test('a generated pack stays within its budget, deterministically', () => {
    const t = defaultTuning();
    for (const budget of [130, 300, 600, 1200]) {
      const a = generateNesses(budget, new Rng(7), t);
      expect(generateNesses(budget, new Rng(7), t)).toEqual(a);
      expect(a.length).toBeGreaterThan(0);
      expect(a.length).toBeLessThanOrEqual(t.ness.common.maxPerFight);
      expect(a.reduce((x, n) => x + nessCost(n.kind, n.level ?? 1, t), 0)).toBeLessThanOrEqual(budget + 1e-6);
    }
  });

  test('a bigger budget buys more or bigger Nesses', () => {
    const t = defaultTuning();
    const value = (b: number) => generateNesses(b, new Rng(3), t).reduce((x, n) => x + nessCost(n.kind, n.level ?? 1, t), 0);
    expect(value(900)).toBeGreaterThan(value(150));
  });

  test('a fight can be ships, Nesses, or both; no share is exactly the old ships', () => {
    const t = defaultTuning();
    const none = generateEncounter(300, 5, t, { nessShare: 0 });
    expect(none.nesses).toHaveLength(0);
    expect(none.enemies.length).toBeGreaterThan(0);
    const lair = generateEncounter(400, 5, t, { nessShare: 1 });
    expect(lair.enemies).toHaveLength(0);
    expect(lair.nesses.length).toBeGreaterThan(0);
    const mixed = generateEncounter(800, 5, t, { nessShare: 0.4 });
    expect(mixed.enemies.length).toBeGreaterThan(0);
    expect(mixed.nesses.length).toBeGreaterThan(0);
  });
});

describe('maps', () => {
  test('Ness waters and the lair exist; Ness waters have many Nesses, crowded lanes few', () => {
    expect(MAP_STYLES.ness).toBeDefined();
    expect(STOP_TYPES.lair?.nessOnly).toBe(true);
    expect(combinedStyle(['ness']).ness).toBeGreaterThan(combinedStyle(['open']).ness);
    expect(combinedStyle(['crowded']).ness).toBeLessThan(combinedStyle(['open']).ness);
  });

  function stats(styles: string[]): { fights: number; withNess: number; lairs: number } {
    const t = defaultTuning();
    let fights = 0;
    let withNess = 0;
    let lairs = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const run = newRun('basic', seed, t);
      enterPort(run, makePlan(rngFor(seed, 'p'), run, t, new Set()), t);
      const map = generateMap(run, { ...run.port!.offers[0], styles }, t);
      for (const s of map.stops) {
        if (STOP_TYPES[s.type]?.effect !== 'fight') continue;
        fights++;
        if (s.nesses.length) withNess++;
        if (s.type === 'lair') {
          lairs++;
          expect(s.enemies).toHaveLength(0);
          expect(s.nesses.length).toBeGreaterThan(0);
        }
      }
    }
    return { fights, withNess, lairs };
  }

  test('a Ness waters map has a lot more Nesses than a crowded one', () => {
    const waters = stats(['ness']);
    const crowded = stats(['crowded']);
    expect(waters.withNess / waters.fights).toBeGreaterThan(crowded.withNess / crowded.fights);
    expect(waters.lairs).toBeGreaterThan(0);
  });
});

describe('after a fight with Nesses', () => {
  test('a slain Ness pays gold; the summary names it', () => {
    const t = defaultTuning();
    const run = newRun('basic', 4, t);
    run.encounter = { stop: null, type: 'fight', budget: 200, enemies: [], nesses: [{ kind: 'ness', level: 1, budget: 130 }], gold: 1, special: false };
    expect(encounterSummary(run)).toBe('Ness');
    const gold0 = run.gold;
    const post = applyFight(run, { won: true, lees: [], enemies: [], nesses: [{ kind: 'ness', level: 1, budget: 130 }], lastEnemy: null, hull: [] }, t);
    expect(post.slain).toHaveLength(1);
    expect(run.gold).toBeGreaterThan(gold0);
    expect(post.outcomes).toHaveLength(0);
  });

  test('a run saved before Nesses still loads', () => {
    const t = defaultTuning();
    const run = newRun('basic', 4, t);
    run.encounter = { stop: null, type: 'fight', budget: 200, enemies: [], nesses: [], gold: 1, special: false };
    const json = JSON.parse(saveRun(run));
    delete json.encounter.nesses;
    const post = emptyPost(run, true);
    delete (post as unknown as Record<string, unknown>).slain;
    json.pending = post;
    const loaded = loadRun(JSON.stringify(json));
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.run.encounter?.nesses).toEqual([]);
      expect(loaded.run.pending?.slain).toEqual([]);
    }
  });
});

describe('a whole fight against Nesses', () => {
  test('the world builds from a run encounter and ends when the last one is slain', () => {
    const t = defaultTuning();
    t.boat.flooding.bilgeRate = 0;
    t.boat.flooding.leakRate = 0;
    const w = new World(t, 1, { enemies: [], nesses: [{ kind: 'ness', level: 1, budget: 130 }, { kind: 'ness', level: 2, budget: 200 }], crew: [0, 1, 2, 3] });
    w.start();
    expect(w.foesLeft()).toBe(2);
    for (const n of w.nesses.list) w.nesses.hurt(w, n, n.maxHp + 1, 'head');
    for (let i = 0; i < 1.5 / FIXED_DT; i++) w.step(FIXED_DT);
    expect(w.result?.winner).toBe('player');
    expect(w.nessOutcomes().reduce((a, o) => a + o.budget, 0)).toBe(330);
  });
});
