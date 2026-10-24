// Phase 7, Close Quarters: the speed blend, the accuracy pass, holding fire
// near allies, then lines and crossings, deck taps, breaking away.

import { describe, expect, test } from 'vitest';
import { defaultTuning, type Tuning } from '../src/config/tuning';
import { defaultBuild } from '../src/sim/loadout';
import type { Vec } from '../src/sim/math';
import { archetypeSetup, autoArrange, type BoatSetup, type CrewSpec } from '../src/sim/setup';
import { FIXED_DT } from '../src/sim/steering';
import { World } from '../src/sim/world';
import type { Boat } from '../src/sim/boat';
import { hullGap } from '../src/sim/contact';

function quiet(t: Tuning): Tuning {
  t.boat.flooding.bilgeRate = 0;
  t.boat.flooding.leakRate = 0;
  return t;
}

function pin(b: Boat, at: Vec, heading = -Math.PI / 2): void {
  Object.assign(b.motion, { x: at.x, y: at.y, heading, vx: 0, vy: 0, omega: 0 });
  b.target = null;
}

const run = (w: World, seconds: number, each?: () => void) => {
  for (let i = 0; i < seconds / FIXED_DT; i++) {
    each?.();
    w.step(FIXED_DT);
  }
};

/** An enemy setup of one archetype with this many Basic Lees. */
function enemy(t: Tuning, type: string, crew: number, seed = 1): BoatSetup {
  const s = archetypeSetup(type, t, seed);
  const specs: CrewSpec[] = Array.from({ length: crew }, () => ({ type: 'basic', home: null as number | null }));
  autoArrange(s.build, specs, t).forEach((h, i) => (specs[i].home = h));
  return { ...s, crew: specs };
}

describe('speed blend (§3)', () => {
  test('the blend slides from 0 to 1 between 1.5× and 1× pistol range, with no snap', () => {
    const t = quiet(defaultTuning());
    const w = new World(t, 1, { enemies: [enemy(t, 'standard', 0)], crew: [] });
    w.start();
    const e = w.enemies[0];
    const blendAt = (gap: number) => {
      pin(w.player, { x: 0, y: 0 });
      pin(e, { x: -(w.player.layout.beam / 2 + e.layout.beam / 2 + gap), y: 0 });
      return w.speedBlend();
    };
    const far = t.pistol.range * t.speed.blendStart;
    expect(blendAt(far + 5)).toBe(0);
    expect(blendAt(t.pistol.range - 1)).toBe(1);
    let last = 0;
    for (let gap = far; gap >= t.pistol.range; gap -= 0.5) {
      const b = blendAt(gap);
      expect(b).toBeGreaterThanOrEqual(last);
      expect(b - last).toBeLessThan(0.15);
      last = b;
    }
    expect(blendAt((far + t.pistol.range) / 2)).toBeGreaterThan(0.3);
    expect(blendAt((far + t.pistol.range) / 2)).toBeLessThan(0.7);
  });
});

describe('accuracy and holding fire (§5)', () => {
  /** Shells fired by the first of two enemies while both sit still near a pinned player. */
  function firedBy(chance: number, allyAt: Vec): number {
    const t = quiet(defaultTuning());
    t.fights.holdFireChance = chance;
    t.fights.holdFireRadius = 50;
    const w = new World(t, 3, { enemies: [enemy(t, 'standard', 4), enemy(t, 'standard', 0, 2)], crew: [] });
    w.start();
    let shells = 0;
    const seen = new Set<number>();
    run(w, 20, () => {
      pin(w.player, { x: 0, y: 0 });
      pin(w.enemies[0], { x: -90, y: 0 });
      pin(w.enemies[1], allyAt);
      for (const s of w.shells) if (s.ownerId === w.enemies[0].id && !seen.has(s.id)) (seen.add(s.id), shells++);
    });
    return shells;
  }

  test('a gun whose shot would land near an ally of its own holds fire; without the ally it shoots', () => {
    const near = firedBy(1, { x: 0, y: -40 });
    const open = firedBy(1, { x: 0, y: -400 });
    const free = firedBy(0, { x: 0, y: -40 });
    expect(open).toBeGreaterThan(2);
    expect(free).toBeGreaterThan(2);
    expect(near).toBe(0);
  });

  test('scatter grows with distance and with how hard the shooter is turning', () => {
    const t = quiet(defaultTuning());
    const spread = (dist: number, omega: number) => {
      const w = new World(t, 1, { enemies: [enemy(t, 'standard', 0)], crew: [] });
      const b = w.player;
      b.motion.omega = omega;
      const g = b.guns[0];
      return gunScatter(w, b, g, dist);
    };
    expect(spread(120, 0)).toBeGreaterThan(spread(40, 0));
    expect(spread(80, 0.35)).toBeGreaterThan(spread(80, 0) * 1.5);
  });
});

import { gunSpec, type GunState } from '../src/sim/boat';
/** The scatter radius the world would use for a baseline gunner, for a shot of this length. */
function gunScatter(w: World, b: Boat, g: GunState, dist: number): number {
  const G = w.tuning.guns;
  const spec = gunSpec(b, g, w.tuning);
  return spec.spread + (spec.spreadPerMeter + G.spreadPerMeter) * dist + Math.abs(b.motion.omega) * G.turnScatter;
}

void hullGap;
void defaultBuild;
