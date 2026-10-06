// Phase 5 steering: tap to set a heading (it stays set), orbit a boat, stop
// (the pit stop), the ⚔️ button's BOARD/RAM label and its hysteresis.

import { describe, expect, test } from 'vitest';
import { defaultTuning } from '../src/config/tuning';
import { isStopped } from '../src/sim/crew';
import { boardOrRam, hullAngle } from '../src/sim/helm';
import { defaultBuild } from '../src/sim/loadout';
import { DEG, dist } from '../src/sim/math';
import { FIXED_DT } from '../src/sim/steering';
import { World } from '../src/sim/world';

const run = (w: World, seconds: number, each?: () => void) => {
  for (let i = 0; i < seconds / FIXED_DT; i++) {
    each?.();
    w.step(FIXED_DT);
  }
};

/** You at the origin heading north, one crewless enemy far to the north. */
function world() {
  const t = defaultTuning();
  t.boat.flooding.leakRate = 0;
  const w = new World(t, 1, { enemies: [{ build: defaultBuild('basic'), crew: [] }], crew: [] });
  w.start();
  Object.assign(w.enemies[0].motion, { x: 0, y: -2000 });
  const freezeEnemy = () => {
    Object.assign(w.enemies[0].motion, { vx: 0, vy: 0, omega: 0 });
    w.enemies[0].target = null;
  };
  return { t, w, freezeEnemy };
}

describe('tap to set a heading', () => {
  test('the boat sails to the point, then holds the heading it arrived on (no finger needed)', () => {
    const { w, freezeEnemy } = world();
    w.setHelm({ kind: 'point', p: { x: 150, y: -40 } });
    run(w, 30, freezeEnemy);
    expect(w.helm.kind).toBe('heading');
    // It kept going: well past the point, in a straight line.
    const h = w.player.motion.heading;
    run(w, 5, freezeEnemy);
    expect(Math.abs(w.player.motion.heading - h)).toBeLessThan(0.05);
    expect(dist(w.player.motion, { x: 150, y: -40 })).toBeGreaterThan(60);
  });

  test('tapping near a boat circles it, and the circle follows the boat; if it sinks, you hold your heading', () => {
    const { w } = world();
    const e = w.enemies[0];
    Object.assign(e.motion, { x: 0, y: -150, heading: 0, vx: 0, vy: 0 });
    w.setHelm({ kind: 'orbit', boatId: e.id, offset: { x: 0, y: 0 } });
    let near = Infinity;
    run(w, 60, () => {
      // The enemy drifts east; the orbit comes along.
      e.motion.x += 4 * FIXED_DT;
      e.target = null;
      Object.assign(e.motion, { vx: 0, vy: 0 });
      if (w.time > 40) near = Math.min(near, dist(w.player.motion, e.motion));
    });
    expect(dist(w.player.motion, e.motion)).toBeLessThan(200);
    expect(near).toBeLessThan(150);
    e.sinkingSince = w.time;
    run(w, 0.1);
    expect(w.helm.kind).toBe('heading');
  });

  test('tapping your own boat stops it: sails down, a stopped boat fixes and aims better', () => {
    const { t, w, freezeEnemy } = world();
    run(w, 4, freezeEnemy);
    w.setHelm({ kind: 'stop' });
    run(w, 25, freezeEnemy);
    expect(Math.hypot(w.player.motion.vx, w.player.motion.vy)).toBeLessThan(t.jobs.stoppedSpeed);
    expect(isStopped(w.player, t)).toBe(true);
    expect(w.player.fx.fix).toBeCloseTo(t.jobs.stoppedFix);
    expect(w.player.fx.aim).toBeCloseTo(t.jobs.stoppedAim);
    w.setHelm({ kind: 'heading', h: -Math.PI / 2 });
    run(w, 3, freezeEnemy);
    expect(w.player.fx.fix).toBe(1);
    expect(Math.hypot(w.player.motion.vx, w.player.motion.vy)).toBeGreaterThan(3);
  });
});

describe('the ⚔️ button', () => {
  test('greyed out without a target; BOARD or RAM by the angle to the target\'s hull, with hysteresis', () => {
    const { t, w } = world();
    const e = w.enemies[0];
    expect(w.meleeMode()).toBeNull();
    expect(w.order('board')).toBeNull();
    const p = w.player;
    const at = (deg: number) => {
      p.motion.heading = e.motion.heading + deg * DEG;
      return hullAngle(p, e);
    };
    expect(at(30)).toBeCloseTo(30);
    expect(boardOrRam(p, e, null, t)).toBe('board');
    at(60);
    expect(boardOrRam(p, e, null, t)).toBe('ram');
    // BOARD only turns into RAM nearly perpendicular; RAM back into BOARD only under 45°.
    expect(boardOrRam(p, e, 'board', t)).toBe('board');
    at(85);
    expect(boardOrRam(p, e, 'board', t)).toBe('ram');
    at(50);
    expect(boardOrRam(p, e, 'ram', t)).toBe('ram');
    at(40);
    expect(boardOrRam(p, e, 'ram', t)).toBe('board');
  });

  test('tapping an enemy targets it and heads for it; ⚔️ sends one Lee per tap; tapping the ocean cancels the maneuver but keeps the party', () => {
    const t = defaultTuning();
    const w = new World(t, 1, { enemies: [{ build: defaultBuild('basic'), crew: [] }] });
    w.start();
    const e = w.enemies[0];
    w.targetEnemy(e);
    expect(['board', 'ram']).toContain(w.helm.kind);
    expect(w.boardTargetId).toBe(e.id);
    const a = w.order('board');
    const b = w.order('board');
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.id).not.toBe(b!.id);
    expect(w.player.crew.lees.filter((l) => l.job === 'board')).toHaveLength(2);
    w.setHelm({ kind: 'point', p: { x: 100, y: 100 } });
    expect(w.helm.kind).toBe('point');
    expect(w.player.crew.lees.filter((l) => l.job === 'board')).toHaveLength(2);
    expect(w.meleeMode()).not.toBeNull();
  });
});
