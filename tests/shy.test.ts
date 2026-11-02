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

  test('it circles out of reach, rises at 70-90% of its range, spits a few times and sinks again', () => {
    const t = quiet(defaultTuning());
    const k = nessKind(t, 'shy');
    const { w, n } = setup(t);
    n.circleFor = 4;
    const ranges: number[] = [];
    let spits = 0;
    let maxDepthWhileSpitting = 0;
    let circledFar = Infinity;
    const modes = new Set<string>();
    run(w, 60, () => {
      pin(w.player);
      modes.add(n.mode);
      if (n.mode === 'circle' && n.modeT > 4) circledFar = Math.min(circledFar, Math.hypot(n.motion.x, n.motion.y));
      if (n.mode === 'spit') {
        ranges.push(Math.hypot(n.motion.x, n.motion.y));
        maxDepthWhileSpitting = Math.max(maxDepthWhileSpitting, n.depth);
      }
      for (const e of w.drainEvents()) if (e.type === 'fire' && e.gun === 'spit') spits++;
    });
    expect(modes.has('approach')).toBe(true);
    expect(modes.has('spit')).toBe(true);
    // Safe while circling: beyond its own spitting range.
    expect(circledFar).toBeGreaterThan(k.spitRange);
    // Up while it spits, at its chosen range.
    expect(maxDepthWhileSpitting).toBeLessThanOrEqual(k.surfacedMax + 1e-6);
    const settled = ranges.slice(Math.floor(ranges.length / 2));
    expect(Math.min(...settled)).toBeGreaterThan(k.spitRange * (k.spitNear - 0.08));
    expect(Math.max(...settled)).toBeLessThan(k.spitRange * (k.spitFar + 0.08));
    // A few spits a pass, then it goes under (and comes round again).
    expect(spits).toBeGreaterThanOrEqual(k.spitsPerPass);
    expect(modes.has('withdraw')).toBe(true);
  });

  test('its spit has a red X like a cannon ball, and lands later the further it flies', () => {
    const t = quiet(defaultTuning());
    const k = nessKind(t, 'shy');
    const { w, n } = setup(t);
    Object.assign(n.motion, { x: 80, y: 0, heading: Math.PI });
    n.mode = 'spit';
    n.depth = 0;
    n.depthTarget = 0;
    n.spit.cool = 0.1;
    run(w, 1.2, () => pin(w.player));
    const x = w.telegraphs.list.find((tg) => tg.kind === 'shell');
    expect(x).toBeDefined();
    const shell = w.shells.find((s) => s.gun === 'spit');
    expect(shell).toBeDefined();
    expect(shell!.flightTime).toBeGreaterThan(1.2);
    expect(shell!.flightTime).toBeLessThan(80 / k.spitSpeed + 1.5);
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
