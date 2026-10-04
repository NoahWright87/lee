import { describe, expect, test } from 'vitest';
import { defaultTuning } from '../src/config/tuning';
import { motionParams } from '../src/sim/boat';
import { dist, NORTH } from '../src/sim/math';
import { cloneMotion, FIXED_DT, predictPath, stepMotion, type MotionParams, type MotionState } from '../src/sim/steering';
import { World } from '../src/sim/world';

const params = (): MotionParams => ({
  cruiseSpeed: 12,
  acceleration: 3,
  drag: 0.8,
  turnRate: 0.4,
  turnAcceleration: 1.2,
  lateralDrag: 2.5,
  turnSpeedLoss: 0.15,
  throttle: 1,
  orbitRadiusScale: 1.15,
  orbitCapture: 2,
});

const start = (): MotionState => ({ x: 0, y: 0, heading: NORTH, vx: 0, vy: -12, omega: 0, orbitSide: 0 });

describe('steering', () => {
  test('path preview matches the real boat exactly', () => {
    const p = params();
    const target = { x: 60, y: -40 };
    const m = start();
    const preview = predictPath(m, target, p, 5, 1);
    const real = cloneMotion(m);
    const actual = [{ x: real.x, y: real.y }];
    for (let i = 0; i < Math.round(5 / FIXED_DT); i++) {
      stepMotion(real, target, p, FIXED_DT);
      actual.push({ x: real.x, y: real.y });
    }
    expect(preview.length).toBe(actual.length);
    preview.forEach((pt, i) => {
      expect(pt.x).toBeCloseTo(actual[i].x, 9);
      expect(pt.y).toBeCloseTo(actual[i].y, 9);
    });
  });

  test('preview from the world uses the same params as the world', () => {
    const t = defaultTuning();
    const w = new World(t, 7);
    w.start();
    const target = { x: 80, y: 20 };
    w.player.target = target;
    const preview = predictPath(w.player.motion, target, motionParams(w.player, t), 3, 1);
    for (let i = 0; i < Math.round(3 / FIXED_DT); i++) {
      w.enemies[0].target = null; // keep this about steering, not combat
      w.step(FIXED_DT);
    }
    const end = preview[preview.length - 1];
    expect(dist(end, w.player.motion)).toBeLessThan(1e-6);
  });

  test.each([
    { x: 10, y: -5 },
    { x: 40, y: 10 },
    { x: 0, y: 80 },
    { x: -150, y: -200 },
  ])('settles into a broadside orbit around %o at ≈ speed / turn rate', (target) => {
    const p = params();
    const m = start();
    for (let i = 0; i < 60 / FIXED_DT; i++) stepMotion(m, target, p, FIXED_DT);
    let lo = Infinity;
    let hi = -Infinity;
    let worstBeam = 0;
    for (let i = 0; i < 20 / FIXED_DT; i++) {
      stepMotion(m, target, p, FIXED_DT);
      const d = dist(m, target);
      lo = Math.min(lo, d);
      hi = Math.max(hi, d);
      const rel = Math.abs(Math.atan2(target.y - m.y, target.x - m.x) - m.heading);
      const off = Math.abs(Math.abs(Math.atan2(Math.sin(rel), Math.cos(rel))) - Math.PI / 2);
      worstBeam = Math.max(worstBeam, off);
    }
    const expected = (Math.hypot(m.vx, m.vy) / p.turnRate) * p.orbitRadiusScale;
    expect(hi - lo).toBeLessThan(expected * 0.1);
    expect((hi + lo) / 2).toBeGreaterThan(expected * 0.9);
    expect((hi + lo) / 2).toBeLessThan(expected * 1.35);
    // The target stays near the beam, inside a broadside arc.
    expect(worstBeam).toBeLessThan(25 * (Math.PI / 180));
  });

  test('with orbiting off, seeking loops through the point (plain pursuit)', () => {
    const p = { ...params(), orbitCapture: 0 };
    const m = start();
    const target = { x: 10, y: -5 };
    let lo = Infinity;
    for (let i = 0; i < 60 / FIXED_DT; i++) {
      stepMotion(m, target, p, FIXED_DT);
      lo = Math.min(lo, dist(m, target));
    }
    expect(lo).toBeLessThan(12);
  });

  test('a slower boat orbits tighter', () => {
    const radius = (speed: number) => {
      const p = { ...params(), cruiseSpeed: speed };
      const m = { ...start(), vy: -speed };
      const target = { x: 5, y: -5 };
      for (let i = 0; i < 80 / FIXED_DT; i++) stepMotion(m, target, p, FIXED_DT);
      return dist(m, target);
    };
    expect(radius(6)).toBeLessThan(radius(12) * 0.7);
  });

  test('releasing (no target) holds the current heading', () => {
    const p = params();
    const m = start();
    for (let i = 0; i < 60; i++) stepMotion(m, { x: 100, y: 0 }, p, FIXED_DT);
    for (let i = 0; i < 60; i++) stepMotion(m, null, p, FIXED_DT);
    const h = m.heading;
    for (let i = 0; i < 300; i++) stepMotion(m, null, p, FIXED_DT);
    expect(m.omega).toBeCloseTo(0, 6);
    expect(m.heading).toBeCloseTo(h, 6);
  });

  test('eases from idle up to cruise speed', () => {
    const p = params();
    const m = { ...start(), vy: -3 };
    stepMotion(m, null, p, FIXED_DT);
    expect(Math.hypot(m.vx, m.vy)).toBeLessThan(4);
    for (let i = 0; i < 10 / FIXED_DT; i++) stepMotion(m, null, p, FIXED_DT);
    expect(Math.hypot(m.vx, m.vy)).toBeCloseTo(12, 3);
  });

  test('turning drifts sideways a little', () => {
    const p = params();
    const m = start();
    let maxSlip = 0;
    for (let i = 0; i < 3 / FIXED_DT; i++) {
      stepMotion(m, { x: 200, y: 0 }, p, FIXED_DT);
      const travel = Math.atan2(m.vy, m.vx);
      maxSlip = Math.max(maxSlip, Math.abs(Math.atan2(Math.sin(travel - m.heading), Math.cos(travel - m.heading))));
    }
    expect(maxSlip).toBeGreaterThan(0.02);
    expect(maxSlip).toBeLessThan(0.5);
  });
});
