import { describe, expect, test } from 'vitest';
import { defaultTuning, type Tuning } from '../src/config/tuning';
import { totalCapacity } from '../src/sim/boat';
import { dist, toWorld } from '../src/sim/math';
import { FIXED_DT } from '../src/sim/steering';
import { TelegraphSystem } from '../src/sim/telegraph';
import { enemiesForFight, World } from '../src/sim/world';

function quiet(t: Tuning): Tuning {
  // No leaks or bilge noise unless a test wants them.
  for (const b of [t.player, t.enemy]) b.flooding.bilgeRate = 0;
  return t;
}

const run = (w: World, seconds: number, each?: () => void) => {
  for (let i = 0; i < seconds / FIXED_DT; i++) {
    each?.();
    w.step(FIXED_DT);
  }
};

describe('world', () => {
  test('nothing moves before START', () => {
    const w = new World(defaultTuning(), 1);
    const before = { ...w.player.motion };
    run(w, 2);
    expect(w.player.motion).toEqual(before);
    expect(w.time).toBe(0);
  });

  test('lead targeting hits a boat holding course and misses one that turns', () => {
    const t = quiet(defaultTuning());
    t.enemy.cannons.spread = 0;
    const w = new World(t, 3);
    w.start();
    run(w, 6, () => (w.enemies[0].target = null)); // up to cruise speed first
    const p = w.player;
    // Steady course: aim from the side and let the shell land.
    const from = { x: p.motion.x + 90, y: p.motion.y };
    const part = p.parts.find((x) => x.def.id === 'midship')!;
    const shot = w.leadAim(w.enemies[0], from, p, part);
    const landAfter = shot.time;
    run(w, landAfter, () => (w.enemies[0].target = null));
    const where = toWorld(part.center, p.motion, p.motion.heading);
    expect(dist(where, shot.aim)).toBeLessThan(1.5);

    // Same shot, but the boat turns hard after it is fired.
    const w2 = new World(t, 3);
    w2.start();
    run(w2, 6, () => (w2.enemies[0].target = null)); // match speed state
    const p2 = w2.player;
    const from2 = { x: p2.motion.x + 90, y: p2.motion.y };
    const part2 = p2.parts.find((x) => x.def.id === 'midship')!;
    const shot2 = w2.leadAim(w2.enemies[0], from2, p2, part2);
    run(w2, shot2.time, () => {
      w2.enemies[0].target = null;
      p2.target = { x: p2.motion.x - 100, y: p2.motion.y };
    });
    const where2 = toWorld(part2.center, p2.motion, p2.motion.heading);
    expect(dist(where2, shot2.aim)).toBeGreaterThan(6);
  });

  test('enemy shells get a red X, player shells do not; the X lasts the flight time', () => {
    const t = quiet(defaultTuning());
    const w = new World(t, 5);
    w.start();
    let sawEnemy = 0;
    let sawPlayer = 0;
    for (let i = 0; i < 120 / FIXED_DT && (sawEnemy < 3 || sawPlayer < 3); i++) {
      w.player.target = { x: w.enemies[0].motion.x + 60, y: w.enemies[0].motion.y };
      const before = w.telegraphs.list.length;
      w.step(FIXED_DT);
      for (const e of w.drainEvents()) {
        if (e.type !== 'fire') continue;
        const shooter = w.boats.find((b) => b.id === e.boatId)!;
        const shell = w.shells.find((s) => s.to === e.to)!;
        if (shooter.side === 'enemy') {
          sawEnemy++;
          const tg = w.telegraphs.list[w.telegraphs.list.length - 1];
          expect(w.telegraphs.list.length).toBeGreaterThan(before);
          expect(tg.pos).toEqual(e.to);
          expect(tg.warnTime).toBeCloseTo(shell.flightTime);
          expect(shell.flightTime).toBeGreaterThanOrEqual(t.telegraph.minWarningTime);
        } else {
          sawPlayer++;
          expect(w.telegraphs.list.some((x) => x.pos === e.to)).toBe(false);
        }
      }
    }
    expect(sawEnemy).toBeGreaterThan(0);
    expect(sawPlayer).toBeGreaterThan(0);
  });

  test('telegraphs are a general system with their own warning time', () => {
    const tel = new TelegraphSystem();
    const x = tel.add('shell', { x: 1, y: 2 }, 0.5, 0.2);
    tel.step(0.25);
    expect(TelegraphSystem.progress(x)).toBeCloseTo(0.5);
    tel.step(0.3);
    expect(x.impacted).toBe(true);
    tel.step(0.3);
    expect(tel.list).toHaveLength(0);
  });

  test('only flooding sinks: the loser is the first to cross the line', () => {
    const t = quiet(defaultTuning());
    const w = new World(t, 9);
    w.start();
    // Guns and engine wrecked: still afloat.
    for (const p of w.enemies[0].parts) if (p.def.id !== 'midship') p.layers[0].hp = 0;
    for (const p of w.enemies[0].parts) p.water = 0;
    t.enemy.flooding.leakRate = 0;
    run(w, 1);
    expect(w.enemies[0].sinkingSince).toBeNull();
    // Flood it.
    const mid = w.enemies[0].parts.find((p) => p.def.id === 'midship')!;
    mid.water = Math.min(mid.capacity, t.enemy.flooding.sinkThreshold * totalCapacity(w.enemies[0]));
    for (const p of w.enemies[0].parts) if (p !== mid) p.water = p.capacity;
    run(w, FIXED_DT * 2);
    expect(w.enemies[0].sinkingSince).not.toBeNull();
    expect(w.result?.winner).toBe('player');
    // Player sinking later doesn't change the result.
    for (const p of w.player.parts) p.water = p.capacity;
    run(w, FIXED_DT * 2);
    expect(w.player.sinkingSince).not.toBeNull();
    expect(w.result?.winner).toBe('player');
    run(w, t.global.sinkDuration + t.global.resultDelay + 0.1);
    expect(w.phase).toBe('over');
  });

  test('shells pass through a sinking boat', () => {
    const t = quiet(defaultTuning());
    const w = new World(t, 2);
    w.start();
    w.enemies[0].sinkingSince = 0;
    const p = w.enemies[0].motion;
    w.shells.push({ id: 99, ownerId: w.player.id, ownerSide: 'player', from: { x: 0, y: 0 }, to: { x: p.x, y: p.y }, elapsed: 0, flightTime: 0.01, damage: 50, impactRadius: 1 });
    w.step(FIXED_DT);
    expect(w.drainEvents().some((e) => e.type === 'splash')).toBe(true);
    expect(w.stats.player.shellsHit).toBe(0);
  });

  test('same seed and inputs give the same fight', () => {
    const fight = (seed: number) => {
      const w = new World(defaultTuning(), seed);
      w.start();
      run(w, 40, () => (w.player.target = { x: w.enemies[0].motion.x + 50, y: w.enemies[0].motion.y }));
      return JSON.stringify([w.player.motion, w.enemies[0].motion, w.stats]);
    };
    expect(fight(11)).toBe(fight(11));
  });

  test('a fight with a weaving player ends in reasonable time', () => {
    const w = new World(defaultTuning(), 1);
    w.start();
    let side = 1;
    while (w.phase !== 'over' && w.time < 300) {
      if (Math.floor(w.time / 3) % 2 === (side > 0 ? 0 : 1)) side = -side;
      const h = Math.atan2(w.enemies[0].motion.y - w.player.motion.y, w.enemies[0].motion.x - w.player.motion.x) + side * 1.2;
      w.player.target = { x: w.player.motion.x + Math.cos(h) * 60, y: w.player.motion.y + Math.sin(h) * 60 };
      w.step(FIXED_DT);
    }
    expect(w.phase).toBe('over');
    expect(w.stats.player.shellsFired).toBeGreaterThan(5);
    expect(w.stats.enemy.shellsFired).toBeGreaterThan(5);
  });
});

describe('several attackers and fight progression', () => {
  test('fight N fields more ships, up to the cap', () => {
    const t = defaultTuning();
    t.campaign.firstFightEnemies = 1;
    t.campaign.enemiesAddedPerFight = 1;
    t.campaign.maxEnemies = 3;
    expect([1, 2, 3, 4, 5].map((f) => enemiesForFight(t, f))).toEqual([1, 2, 3, 3, 3]);
    t.campaign.enemiesAddedPerFight = 0.5;
    expect([1, 2, 3, 4].map((f) => enemiesForFight(t, f))).toEqual([1, 1, 2, 2]);
    const w = new World(t, 1, { fight: 5 });
    expect(w.enemies).toHaveLength(3);
    expect(new Set(w.enemies.map((e) => e.id)).size).toBe(3);
    // Spawned apart from each other.
    for (const a of w.enemies) for (const b of w.enemies) if (a !== b) expect(dist(a.motion, b.motion)).toBeGreaterThan(50);
  });

  test('you only win when every enemy has sunk', () => {
    const t = quiet(defaultTuning());
    const w = new World(t, 4, { enemies: 3 });
    w.start();
    const flood = (i: number) => {
      for (const p of w.enemies[i].parts) p.water = p.capacity;
    };
    flood(0);
    flood(1);
    run(w, 0.1);
    expect(w.result).toBeNull();
    expect(w.liveEnemies()).toHaveLength(1);
    flood(2);
    run(w, 0.1);
    expect(w.result?.winner).toBe('player');
  });

  test('sinking first loses even with enemies sinking later', () => {
    const t = quiet(defaultTuning());
    const w = new World(t, 4, { enemies: 2 });
    w.start();
    for (const p of w.player.parts) p.water = p.capacity;
    run(w, 0.1);
    expect(w.result?.winner).toBe('enemy');
  });

  test('every enemy brain steers its own ship', () => {
    const w = new World(defaultTuning(), 8, { enemies: 3 });
    w.start();
    run(w, 5);
    const seeks = w.enemies.map((e) => w.brains.get(e.id)!.seek!);
    expect(seeks.every(Boolean)).toBe(true);
    expect(new Set(seeks.map((s) => `${s.x.toFixed(1)},${s.y.toFixed(1)}`)).size).toBe(3);
  });

  test('the threat budget caps enemy shells in the air', () => {
    const t = quiet(defaultTuning());
    t.campaign.maxIncomingShells = 2;
    t.campaign.packReloadScaling = 0;
    const w = new World(t, 6, { enemies: 5 });
    w.start();
    let most = 0;
    let fired = 0;
    run(w, 60, () => {
      w.player.target = { x: w.player.motion.x, y: w.player.motion.y - 100 };
      most = Math.max(most, w.incomingShells());
      fired = w.stats.enemy.shellsFired;
    });
    expect(fired).toBeGreaterThan(4);
    expect(most).toBeLessThanOrEqual(2);
    expect(w.telegraphs.list.filter((x) => !x.impacted).length).toBeLessThanOrEqual(2);
  });

  test('pack scaling: bigger packs have lighter hulls', () => {
    const t = defaultTuning();
    t.campaign.packHullScaling = 1;
    const one = new World(t, 1, { enemies: 1 }).enemies[0].parts[0].layers[0].maxHp;
    const four = new World(t, 1, { enemies: 4 }).enemies[0].parts[0].layers[0].maxHp;
    expect(four).toBeCloseTo(one / 4);
  });

  test('damage carries into the next fight, minus repairs', () => {
    const t = quiet(defaultTuning());
    t.campaign.repairBetweenFights = 0.5;
    const w = new World(t, 1);
    const mid = w.player.parts.find((p) => p.def.id === 'midship')!;
    mid.layers[0].hp = mid.layers[0].maxHp * 0.2;
    mid.water = 20;
    const next = new World(t, 2, { fight: 2, carry: w.playerCarry() });
    const mid2 = next.player.parts.find((p) => p.def.id === 'midship')!;
    expect(mid2.layers[0].hp / mid2.layers[0].maxHp).toBeCloseTo(0.6);
    expect(mid2.water).toBeCloseTo(10);
    expect(next.fight).toBe(2);
  });

  test('after you win, shells still in the air cannot sink you', () => {
    const t = quiet(defaultTuning());
    const w = new World(t, 3);
    w.start();
    const p = w.player.motion;
    w.shells.push({ id: 1, ownerId: w.enemies[0].id, ownerSide: 'enemy', from: { x: 0, y: -80 }, to: { x: p.x, y: p.y }, elapsed: 0, flightTime: 1, damage: 99, impactRadius: 1 });
    for (const part of w.enemies[0].parts) part.water = part.capacity;
    run(w, 1.5);
    expect(w.result?.winner).toBe('player');
    expect(w.stats.player.damageTaken).toBe(0);
  });
});
