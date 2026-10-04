import { describe, expect, test } from 'vitest';
import { defaultTuning, type Tuning } from '../src/config/tuning';
import { totalCapacity } from '../src/sim/boat';
import { dist, toWorld } from '../src/sim/math';
import { FIXED_DT } from '../src/sim/steering';
import { TelegraphSystem } from '../src/sim/telegraph';
import { enemiesForFight, World } from '../src/sim/world';

function quiet(t: Tuning): Tuning {
  // No leaks or bilge noise unless a test wants them.
  for (const b of [t.player, ...Object.values(t.ships)]) b.flooding.bilgeRate = 0;
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
    t.ships.standard.cannons.spread = 0;
    // Steering as in Phase 1 regardless of who mans the oars and sails.
    t.crew.oarBaseline = 1;
    t.crew.sailBaseline = 1;
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
      w.step(FIXED_DT);
      for (const e of w.drainEvents()) {
        if (e.type !== 'fire') continue;
        const shooter = w.boats.find((b) => b.id === e.boatId)!;
        const shell = w.shells.find((s) => s.to === e.to)!;
        if (shooter.side === 'enemy') {
          sawEnemy++;
          const tg = w.telegraphs.list.find((x) => x.pos.x === e.to.x && x.pos.y === e.to.y && x.elapsed <= FIXED_DT)!;
          expect(tg).toBeDefined();
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
    t.ships.standard.flooding.leakRate = 0;
    run(w, 1);
    expect(w.enemies[0].sinkingSince).toBeNull();
    // Flood it.
    const mid = w.enemies[0].parts.find((p) => p.def.id === 'midship')!;
    mid.water = Math.min(mid.capacity, t.ships.standard.flooding.sinkThreshold * totalCapacity(w.enemies[0]));
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
    w.shells.push({ id: 99, ownerId: w.player.id, ownerSide: 'player', from: { x: 0, y: 0 }, to: { x: p.x, y: p.y }, elapsed: 0, flightTime: 0.01, damage: 50, impactRadius: 1, leeId: null });
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
    // This weave keeps closing inside the Sloop's minimum range, so it gets fewer shots off.
    expect(w.stats.enemy.shellsFired).toBeGreaterThan(2);
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
    // Fights 1-3 introduce one ship type each; fight 5 is the third "pack" fight.
    t.campaign.enemiesAddedPerFight = 1;
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
    w.shells.push({ id: 1, ownerId: w.enemies[0].id, ownerSide: 'enemy', from: { x: 0, y: -80 }, to: { x: p.x, y: p.y }, elapsed: 0, flightTime: 1, damage: 99, impactRadius: 1, leeId: null });
    for (const part of w.enemies[0].parts) part.water = part.capacity;
    run(w, 1.5);
    expect(w.result?.winner).toBe('player');
    expect(w.stats.player.damageTaken).toBe(0);
  });
});

describe('hits, holes and aim', () => {
  test('a hit lets a little water in; a hit on a wrecked part punches a hole', () => {
    const t = quiet(defaultTuning());
    const w = new World(t, 1);
    w.start();
    const ct = t.player.cannons;
    const shoot = (partId: string) => {
      const e = w.enemies[0];
      const part = e.parts.find((p) => p.def.id === partId)!;
      const at = toWorld(part.center, e.motion, e.motion.heading);
      w.shells.push({ id: 500, ownerId: w.player.id, ownerSide: 'player', from: at, to: at, elapsed: 0, flightTime: FIXED_DT / 2, damage: 1, impactRadius: 0.5, leeId: null });
      w.step(FIXED_DT);
      return part;
    };
    const total = () => w.enemies[0].parts.reduce((a, p) => a + p.water, 0);
    t.ships.standard.flooding.leakRate = 0;
    let before = total();
    shoot('midship');
    expect(total() - before).toBeCloseTo(ct.hitWater, 3);
    const mid = w.enemies[0].parts.find((p) => p.def.id === 'midship')!;
    mid.layers[0].hp = 0;
    before = total();
    shoot('midship');
    expect(total() - before).toBeCloseTo(ct.holeWater, 3);
    // A full wrecked part spills the hole's water into its neighbors.
    const bow = w.enemies[0].parts.find((p) => p.def.id === 'bow')!;
    bow.layers[0].hp = 0;
    bow.water = bow.capacity;
    before = total();
    shoot('bow');
    expect(total() - before).toBeCloseTo(ct.holeWater, 3);
  });

  test('gunners spread their shots over different parts and aim points, with an imperfect lead', () => {
    const w = new World(defaultTuning(), 4);
    const target = w.enemies[0];
    const plans = Array.from({ length: 200 }, () => w.planAim(w.player, target));
    expect(new Set(plans.map((p) => p.part)).size).toBe(target.parts.length);
    const ct = w.tuning.player.cannons;
    for (const p of plans) {
      expect(Math.hypot(p.offset.x, p.offset.y)).toBeLessThanOrEqual(ct.aimRadius + 1e-9);
      expect(p.lead).toBeGreaterThanOrEqual(1 - ct.leadError);
      expect(p.lead).toBeLessThanOrEqual(1 + ct.leadError);
    }
    expect(new Set(plans.map((p) => p.lead.toFixed(3))).size).toBeGreaterThan(50);
  });

  test('lead error grows with target speed and distance', () => {
    const w = new World(defaultTuning(), 1);
    const target = w.enemies[0];
    const part = target.parts[0];
    const miss = (speed: number, range: number) => {
      target.motion.vx = speed;
      target.motion.vy = 0;
      const from = { x: target.motion.x, y: target.motion.y + range };
      const plan = { boatId: target.id, part: 0, offset: { x: 0, y: 0 }, lead: 1.1, turn: 0 };
      const good = w.leadAim(w.player, from, target, part).aim;
      const off = w.leadAim(w.player, from, target, part, plan).aim;
      return dist(good, off);
    };
    expect(miss(0, 80)).toBeCloseTo(0);
    expect(miss(12, 80)).toBeGreaterThan(miss(6, 80));
    expect(miss(12, 120)).toBeGreaterThan(miss(12, 60));
  });

  test('each gun targets the closest boat it can actually reach', () => {
    const t = quiet(defaultTuning());
    const w = new World(t, 1, { enemies: 2 });
    const [near, far] = w.enemies;
    // Player at the origin heading north: port guns face west.
    near.motion.x = -60;
    near.motion.y = 0;
    far.motion.x = -110;
    far.motion.y = 0;
    const port = w.player.cannons.find((c) => c.broadside === -1)!;
    const star = w.player.cannons.find((c) => c.broadside === 1)!;
    expect(w.pickTarget(w.player, port, w.muzzle(w.player, port))).toBe(near);
    expect(w.pickTarget(w.player, star, w.muzzle(w.player, star))).toBeNull();
    near.motion.x = 60; // now off the starboard beam: port guns take the far one
    expect(w.pickTarget(w.player, port, w.muzzle(w.player, port))).toBe(far);
    expect(w.pickTarget(w.player, star, w.muzzle(w.player, star))).toBe(near);
  });
});

describe('turn-aware aim', () => {
  test('a gunner that follows your turn aims along the curve, so turning steadily stops dodging', () => {
    const w = new World(defaultTuning(), 3);
    const target = w.player;
    Object.assign(target.motion, { x: 0, y: 0, heading: 0, vx: 12, vy: 0, omega: 0.35 });
    const part = target.parts.find((x) => x.def.id === 'midship')!;
    const from = { x: 0, y: 90 };
    const base = { boatId: target.id, part: part.index, offset: { x: 0, y: 0 }, lead: 1 };
    const straight = w.leadAim(w.enemies[0], from, target, part, { ...base, turn: 0 });
    const follow = w.leadAim(w.enemies[0], from, target, part, { ...base, turn: 1 });
    // Simulate the target actually holding that turn for the shell's flight.
    const t = follow.time;
    const a = 0.35 * t;
    const c = part.center; // the part sits off the boat's center and turns with it
    const truth = { x: (Math.sin(a) / 0.35) * 12 + c.x * Math.cos(a) - c.y * Math.sin(a), y: ((1 - Math.cos(a)) / 0.35) * 12 + c.x * Math.sin(a) + c.y * Math.cos(a) };
    expect(dist(follow.aim, truth)).toBeLessThan(1);
    expect(dist(straight.aim, truth)).toBeGreaterThan(3);
  });
});
