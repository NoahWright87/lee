// The Shyness: a Ness that keeps its distance, rises on your weakest side, spits a few times and sinks again.
import { describe, expect, test } from 'vitest';
import { defaultTuning, type Tuning } from '../src/config/tuning';
import { NESS } from '../src/config/ness';
import { gunSpec, totalWater } from '../src/sim/boat';
import { workerAt } from '../src/sim/crew';
import { wrapAngle } from '../src/sim/math';
import { isHeadOpen, nessKind, type Ness } from '../src/sim/ness';
import { FIXED_DT } from '../src/sim/steering';
import { World } from '../src/sim/world';
import type { Boat } from '../src/sim/boat';
import type { Vec } from '../src/sim/math';

function quiet(t: Tuning): Tuning {
  t.boat.flooding.bilgeRate = 0;
  t.boat.flooding.leakRate = 0;
  return t;
}

function pin(b: Boat, at: Vec = { x: 0, y: 0 }, heading = -Math.PI / 2): void {
  Object.assign(b.motion, { x: at.x, y: at.y, heading, vx: 0, vy: 0, omega: 0 });
  b.target = null;
}

const run = (w: World, seconds: number, each?: () => void) => {
  for (let i = 0; i < seconds / FIXED_DT; i++) {
    each?.();
    w.step(FIXED_DT);
  }
};

function setup(t: Tuning, crew: number[] = []): { w: World; n: Ness } {
  const w = new World(t, 1, { enemies: [], nesses: [{ kind: 'shy' }], crew });
  w.start();
  pin(w.player);
  return { w, n: w.nesses.list[0] };
}

describe('the Shyness', () => {
  test('it is a spitter with no hands, smaller and frailer than the plain Ness', () => {
    const t = defaultTuning();
    const { n } = setup(t);
    expect(n.def.style).toBe('spitter');
    expect(NESS.shy.name).toBe('Shyness');
    expect(n.hands).toHaveLength(0);
    expect(n.maxHp).toBeLessThan(nessKind(t, 'ness').hp / 4);
    expect(n.length).toBeLessThan(nessKind(t, 'ness').length);
  });

  test('it circles at a safe distance, rises at 70-90% of its range, and fires whenever you are in range', () => {
    const t = quiet(defaultTuning());
    const k = nessKind(t, 'shy');
    const { w, n } = setup(t);
    n.circleFor = 3;
    const ranges: number[] = [];
    const times: number[] = [];
    let maxDepthWhileSpitting = 0;
    let circledFar = Infinity;
    const modes = new Set<string>();
    run(w, 60, () => {
      pin(w.player);
      n.hurtAt = w.time; // (restlessness has its own tests: here it is cautious throughout)
      modes.add(n.mode);
      if (n.mode === 'circle' && n.modeT > 2) circledFar = Math.min(circledFar, Math.hypot(n.motion.x, n.motion.y));
      if (n.mode === 'spit') {
        ranges.push(Math.hypot(n.motion.x, n.motion.y));
        maxDepthWhileSpitting = Math.max(maxDepthWhileSpitting, n.depth);
      }
      for (const e of w.drainEvents()) if (e.type === 'fire' && e.gun === 'spit') times.push(w.time);
    });
    expect(modes.has('approach')).toBe(true);
    expect(modes.has('spit')).toBe(true);
    // Safe while circling: about its own range or further.
    expect(circledFar).toBeGreaterThan(k.spitRange * 0.95);
    expect(maxDepthWhileSpitting).toBeLessThanOrEqual(k.surfacedMax + 1e-6);
    const settled = ranges.slice(Math.floor(ranges.length / 2));
    expect(Math.min(...settled)).toBeGreaterThan(k.spitRange * (k.spitNear - 0.08));
    expect(Math.max(...settled)).toBeLessThan(k.spitRange * (k.spitFar + 0.08));
    // It keeps firing while it is up: at least a handful in the minute, never faster than a cannon would.
    expect(times.length).toBeGreaterThanOrEqual(5);
    const cannon = t.guns.reloadTime;
    for (let i = 1; i < times.length; i++) if (times[i] - times[i - 1] < 20) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(cannon - 0.05);
  });

  test('it stays up and fires on a loop while nothing threatens it, a little slower than a cannon', () => {
    const t = quiet(defaultTuning());
    const k = nessKind(t, 'shy');
    const { w, n } = setup(t);
    Object.assign(n.motion, { x: 80, y: 0, heading: Math.PI });
    n.mode = 'spit';
    n.depth = 0;
    n.depthTarget = 0;
    n.spit.cool = 0.1;
    n.spit.bearing = Math.PI / 2;
    let shots = 0;
    let first = 0;
    let last = 0;
    run(w, 25, () => {
      pin(w.player);
      n.hurtAt = w.time;
      for (const e of w.drainEvents()) {
        if (e.type === 'fire' && e.gun === 'spit') {
          shots++;
          first = first || w.time;
          last = w.time;
        }
      }
    });
    expect(n.mode).toBe('spit');
    expect(shots).toBeGreaterThanOrEqual(5);
    const gap = (last - first) / (shots - 1);
    expect(gap).toBeGreaterThanOrEqual(t.guns.reloadTime * 1.2 - 0.05);
    expect(gap).toBeLessThan(t.guns.reloadTime * k.spitReload + 0.4);
  });

  test('a glob takes as long as a cannon ball to land, and its red X is up for that long', () => {
    const t = quiet(defaultTuning());
    const k = nessKind(t, 'shy');
    const { w, n } = setup(t);
    w.fireSpit(n, { x: 70, y: 0 }, { x: 0, y: 0 }, k);
    const G = t.guns;
    const expected = Math.max(t.telegraph.minWarningTime, G.flightTimeBase + G.flightTimePerMeter * 70);
    const shell = w.shells[w.shells.length - 1];
    expect(shell.flightTime).toBeCloseTo(expected, 5);
    const x = w.telegraphs.list.find((tg) => tg.kind === 'shell');
    expect(x).toBeDefined();
  });

  test('threatened it dives, but only after taking a shot: your hull close, or its HP low', () => {
    const t = quiet(defaultTuning());
    const k = nessKind(t, 'shy');
    // No shot yet: it takes one first even with you on top of it.
    {
      const { w, n } = setup(t);
      Object.assign(n.motion, { x: 20, y: 0, heading: -Math.PI / 2 });
      n.mode = 'spit';
      n.depth = 0;
      n.depthTarget = 0;
      n.spit.cool = 0.1;
      n.spit.bearing = Math.PI / 2;
      let shots = 0;
      let dived = false;
      run(w, 8, () => {
        pin(w.player);
        for (const e of w.drainEvents()) if (e.type === 'fire' && e.gun === 'spit') shots++;
        if (n.mode === 'withdraw') dived = true;
      });
      expect(shots).toBeGreaterThanOrEqual(1);
      expect(dived).toBe(true);
    }
    // Hurt: below the threshold it fires once and sinks.
    {
      const { w, n } = setup(t);
      Object.assign(n.motion, { x: 80, y: 0, heading: Math.PI });
      n.mode = 'spit';
      n.depth = 0;
      n.depthTarget = 0;
      n.spit.cool = 0.1;
      n.spit.bearing = Math.PI / 2;
      n.hp = n.maxHp * (k.spitDiveHp - 0.05);
      let shots = 0;
      run(w, 8, () => {
        pin(w.player);
        for (const e of w.drainEvents()) if (e.type === 'fire' && e.gun === 'spit') shots++;
      });
      expect(shots).toBe(1);
      expect(['withdraw', 'circle', 'approach']).toContain(n.mode);
    }
  });

  test('it fires as soon as it is up and in range, even before it reaches its spot', () => {
    const t = quiet(defaultTuning());
    const { w, n } = setup(t);
    // Surfaced 60 m off the bow, still "approaching" a spot 80 m off the beam.
    Object.assign(n.motion, { x: 0, y: -60, heading: -Math.PI / 2 });
    n.mode = 'approach';
    n.depth = 0;
    n.depthTarget = 0;
    n.spit.bearing = Math.PI / 2;
    n.modeT = 5;
    let shots = 0;
    run(w, 4, () => {
      pin(w.player);
      for (const e of w.drainEvents()) if (e.type === 'fire' && e.gun === 'spit') shots++;
    });
    expect(shots).toBeGreaterThanOrEqual(1);
  });

  test('a spit hit does little damage but dumps a lot of water, which slows the boat', () => {
    const t = quiet(defaultTuning());
    const k = nessKind(t, 'shy');
    const { w, n } = setup(t);
    const part = w.player.parts[0];
    const centerWorld = { x: 0, y: 0 };
    const before = totalWater(w.player);
    const hp = part.layers.map((l) => l.hp);
    w.fireSpit(n, { x: 40, y: 0 }, centerWorld, k);
    // Land it right on the hull's middle.
    const shell = w.shells[w.shells.length - 1];
    shell.to = { x: w.player.motion.x, y: w.player.motion.y };
    run(w, shell.flightTime + 0.2, () => pin(w.player));
    const water = totalWater(w.player) - before;
    expect(water).toBeGreaterThan(k.spitWater * 0.5);
    // Less damage than a cannon ball would do.
    const lost = hp.reduce((a, h, i) => a + (h - part.layers[i].hp), 0);
    expect(lost).toBeLessThan(t.guns.damage);
  });

  test('it comes in where the fewest manned guns reach, even if it has to swim round to get there', () => {
    const t = quiet(defaultTuning());
    const { w, n } = setup(t, [0, 1, 2, 3, 4, 5, 6, 7]);
    // The Basic Ship's gunners man the port cannons first (the starboard ones stay empty).
    run(w, 3, () => pin(w.player));
    const manned = w.player.guns.filter((g) => workerAt(w.player, g.station));
    expect(manned.length).toBeGreaterThan(0);
    // It starts off the port side, right in front of the manned guns.
    Object.assign(n.motion, { x: -100, y: 0 });
    const bearing = (w.nesses as unknown as { weakBearing(w: World, n: Ness, k: unknown): number }).weakBearing(w, n, nessKind(t, 'shy'));
    for (const g of manned) expect(Math.abs(wrapAngle(bearing - g.face))).toBeGreaterThan(gunSpec(w.player, g, t).arcHalf);
  });

  test('its head is never a melee target: nobody can stab a spitter', () => {
    const t = quiet(defaultTuning());
    const { n } = setup(t);
    n.neck.state = 'hold';
    expect(isHeadOpen(n)).toBe(false);
  });

  test('it is fragile: a few cannon hits finish it while it is up', () => {
    const t = quiet(defaultTuning());
    const { w, n } = setup(t);
    w.nesses.hurt(w, n, n.maxHp + 1, 'body');
    expect(n.mode).toBe('dead');
  });
});

describe('pot shots and restlessness', () => {
  const place = (n: Ness, x: number, y: number, depth: number) => {
    Object.assign(n.motion, { x, y, vx: 0, vy: 0, heading: Math.PI });
    n.mode = 'circle';
    n.circleFor = 1e9;
    n.depth = depth;
    n.depthTarget = depth;
    n.neck.cool = 1e9;
  };

  test('your crew takes pistol pot shots at a big sea monster from well beyond a pistol duel, but not from a long way off', () => {
    const t = quiet(defaultTuning());
    const near = setup(t, [0, 1, 2, 3, 4, 5, 6, 7]);
    run(near.w, 6, () => {
      pin(near.w.player);
      place(near.n, -40, 0, 0);
    });
    expect(near.w.stats.player.pistolShots).toBeGreaterThan(3);
    expect(near.w.stats.player.pistolHits).toBeGreaterThan(0);
    const far = setup(t, [0, 1, 2, 3, 4, 5, 6, 7]);
    run(far.w, 6, () => {
      pin(far.w.player);
      place(far.n, -90, 0, 0);
    });
    expect(far.w.stats.player.pistolShots).toBe(0);
  });

  test('they shoot at one that is just under the surface too (a smaller target)', () => {
    const t = quiet(defaultTuning());
    const { w, n } = setup(t, [0, 1, 2, 3, 4, 5, 6, 7]);
    run(w, 6, () => {
      pin(w.player);
      place(n, -30, 0, 0.4);
    });
    expect(w.stats.player.pistolShots).toBeGreaterThan(0);
  });

  test('restlessness grows with every second it goes without being hurt, and is wiped out by a hit', () => {
    const t = quiet(defaultTuning());
    const { w, n } = setup(t);
    expect(w.nesses.restless(w, n)).toBe(0);
    n.hurtAt = w.time - t.ness.common.restlessTime / 2;
    expect(w.nesses.restless(w, n)).toBeCloseTo(0.5, 2);
    n.hurtAt = w.time - 1000;
    expect(w.nesses.restless(w, n)).toBe(1);
    w.nesses.hurt(w, n, 1, 'body');
    expect(w.nesses.restless(w, n)).toBe(0);
  });

  test('a restless Shyness creeps in from its safe range, so pistols and cannons can finally reach it', () => {
    const t = quiet(defaultTuning());
    const k = nessKind(t, 'shy');
    const settle = (restless: boolean): number => {
      const { w, n } = setup(t);
      Object.assign(n.motion, { x: 80, y: 0, heading: -Math.PI / 2, vx: 0, vy: 0 });
      n.mode = 'spit';
      n.depth = 0;
      n.depthTarget = 0;
      n.spit.bearing = Math.PI / 2;
      n.spit.cool = 1e9;
      let r = 0;
      run(w, 25, () => {
        pin(w.player);
        n.hurtAt = restless ? w.time - 1000 : w.time;
        n.spit.cool = 1e9;
        r = Math.hypot(n.motion.x, n.motion.y);
      });
      return r;
    };
    const cautious = settle(false);
    const bold = settle(true);
    expect(cautious).toBeGreaterThan(k.spitRange * 0.7);
    expect(bold).toBeLessThan(k.spitRange * 0.65);
  });

  test('a restless Ness stops circling sooner and comes in', () => {
    const t = quiet(defaultTuning());
    const wait = (restless: boolean): number => {
      const { w, n } = setup(t);
      n.circleFor = 30;
      let at = -1;
      run(w, 40, () => {
        pin(w.player);
        n.hurtAt = restless ? w.time - 1000 : w.time;
        if (at < 0 && n.mode === 'approach') at = w.time;
      });
      return at < 0 ? 40 : at;
    };
    // (Same kind either way: the plain Ness is the default `setup` kind in tests/ness.test.ts; here the Shyness shows it too.)
    expect(wait(true)).toBeLessThan(wait(false) - 5);
  });
});
