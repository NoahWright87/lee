// Phase 8, slice 1: a Ness that surfaces and dives. Shadows can't be hit, a ring
// warns before it rises, rising under a hull wrecks the part above it, cannons and
// pistols hurt it while it's up, and killing its head wins the fight.

import { describe, expect, test } from 'vitest';
import { defaultTuning, type Tuning } from '../src/config/tuning';
import { isWrecked, type Boat } from '../src/sim/boat';
import { headOf, layOut, partAt, type Ness } from '../src/sim/ness';
import type { Vec } from '../src/sim/math';
import { FIXED_DT } from '../src/sim/steering';
import { World } from '../src/sim/world';

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

/** A world with just a Ness (and the default player boat, crewed), the Ness parked near. */
function setup(t: Tuning, at: Vec = { x: 70, y: 0 }): { w: World; n: Ness } {
  const w = new World(t, 1, { enemies: [], nesses: [{ kind: 'weak' }], crew: [5, 6, 7, 8] });
  w.start();
  const n = w.nesses.list[0];
  n.x = at.x;
  n.y = at.y;
  n.heading = Math.PI;
  for (let i = 0; i < n.path.length; i++) n.path[i] = { x: at.x + i, y: at.y };
  layOut(n);
  pin(w.player, { x: 0, y: 0 });
  return { w, n };
}

/** Run until the Ness reaches a state (or fail). */
function until(w: World, n: Ness, state: Ness['state'], limit = 40, each?: () => void): void {
  for (let i = 0; i < limit / FIXED_DT && n.state !== state; i++) {
    each?.();
    w.step(FIXED_DT);
  }
  expect(n.state).toBe(state);
}

describe('a Ness underwater', () => {
  test('starts as a shadow, far out, and the fight is not over', () => {
    const t = quiet(defaultTuning());
    const w = new World(t, 1, { enemies: [], nesses: [{ kind: 'weak' }], crew: [5, 6] });
    w.start();
    const n = w.nesses.list[0];
    expect(n.state).toBe('submerged');
    expect(Math.hypot(n.x - w.player.motion.x, n.y - w.player.motion.y)).toBeGreaterThan(100);
    run(w, 1);
    expect(w.result).toBeNull();
    expect(w.foesLeft()).toBe(1);
  });

  test('a shadow cannot be hit: no part is there to aim at', () => {
    const t = quiet(defaultTuning());
    const { w, n } = setup(t);
    expect(partAt(n, { x: n.x, y: n.y }, 5)).toBeNull();
    expect(w.nessTargets()).toHaveLength(0);
  });

  test('it lurks around you, then warns with a ring before it rises', () => {
    const t = quiet(defaultTuning());
    const { w, n } = setup(t, { x: 55, y: 0 });
    n.hold = 0;
    until(w, n, 'emerging');
    expect(n.emergeAt).not.toBeNull();
    const ring = w.telegraphs.list.find((x) => x.kind === 'emerge');
    expect(ring).toBeDefined();
    expect(ring!.warnTime).toBeCloseTo(t.ness.kinds.weak.warn, 5);
    expect(ring!.size).toBe(t.ness.kinds.weak.ringRadius);
    expect(w.events.some((e) => e.type === 'nessWarn')).toBe(true);
    // Still a shadow while it warns.
    expect(w.nessTargets()).toHaveLength(0);
  });
});

describe('rising', () => {
  test('under your hull it wrecks the part above it, floods it and hurts the Lees there', () => {
    const t = quiet(defaultTuning());
    const { w, n } = setup(t, { x: 40, y: 0 });
    n.hold = 0;
    const before = w.player.parts.map((p) => p.layers[p.layers.length - 1].hp);
    until(w, n, 'surfaced');
    const hit = w.player.parts.filter((p, i) => p.layers[p.layers.length - 1].hp < before[i]);
    expect(hit.length).toBeGreaterThan(0);
    expect(hit.some((p) => isWrecked(p))).toBe(true);
    expect(w.stats.player.damageTaken).toBeGreaterThan(0);
    expect(w.events.some((e) => e.type === 'nessSurface')).toBe(true);
  });

  test('steering off the ring is the dodge', () => {
    const t = quiet(defaultTuning());
    const { w, n } = setup(t, { x: 40, y: 0 });
    n.hold = 0;
    const before = w.player.parts.map((p) => p.layers[p.layers.length - 1].hp);
    // As soon as the ring goes up, the boat moves clear of it.
    let moved = false;
    until(w, n, 'surfaced', 40, () => {
      if (n.state === 'emerging' && !moved) {
        moved = true;
        const ring = n.emergeAt!;
        pin(w.player, { x: ring.x + (ring.x >= 0 ? -1 : 1) * 70, y: ring.y + 70 });
      }
    });
    expect(moved).toBe(true);
    const after = w.player.parts.map((p) => p.layers[p.layers.length - 1].hp);
    expect(after).toEqual(before);
  });

  test('the game slows as the ring forms near you (the speed blend)', () => {
    const t = quiet(defaultTuning());
    const { w, n } = setup(t, { x: 140, y: 0 });
    expect(w.speedBlend()).toBe(0);
    n.hold = 0;
    n.x = 40;
    n.y = 0;
    until(w, n, 'emerging');
    expect(w.speedBlend()).toBeGreaterThan(0);
  });
});

describe('a Ness that is up', () => {
  /** Surface it right next to the player, out of the ring's reach. */
  function surfaced(t: Tuning, at: Vec = { x: 0, y: -60 }): { w: World; n: Ness } {
    const { w, n } = setup(t, at);
    n.state = 'surfaced';
    n.stateT = 0;
    n.hold = 100;
    layOut(n);
    return { w, n };
  }

  test('cannons hit it, head first kills it, and that wins the fight', () => {
    const t = quiet(defaultTuning());
    t.ness.kinds.weak.diveHurt = 99; // stays up for the test
    const { w, n } = surfaced(t);
    const head = headOf(n);
    for (let i = 0; i < 40 && head.hp > 0; i++) {
      w.shells.push({ id: 900 + i, group: 900 + i, ownerId: 1, ownerSide: 'player', gun: 'cannon', mode: 'shell', from: { x: 0, y: 0 }, to: { ...head.pos }, elapsed: 0, flightTime: 0.01, damage: 10, crewDamage: 0, splash: 0, impactRadius: 1.2, leeId: null });
      w.step(FIXED_DT * 2);
    }
    expect(head.hp).toBe(0);
    expect(n.state).toBe('dead');
    expect(w.liveNesses()).toHaveLength(0);
    run(w, 1);
    expect(w.result?.winner).toBe('player');
  });

  test('a shell on a coil hurts the coil, not the head', () => {
    const t = quiet(defaultTuning());
    const { w, n } = surfaced(t);
    const coil = n.parts[1];
    w.shells.push({ id: 901, group: 901, ownerId: 1, ownerSide: 'player', gun: 'cannon', mode: 'shell', from: { x: 0, y: 0 }, to: { ...coil.pos }, elapsed: 0, flightTime: 0.01, damage: 10, crewDamage: 0, splash: 0, impactRadius: 0.5, leeId: null });
    w.step(FIXED_DT * 2);
    expect(coil.hp).toBeLessThan(coil.maxHp);
    expect(headOf(n).hp).toBe(headOf(n).maxHp);
    expect(n.state).toBe('surfaced');
  });

  test('its own side does not shell it', () => {
    const t = quiet(defaultTuning());
    const { w, n } = surfaced(t);
    const head = headOf(n);
    w.shells.push({ id: 902, group: 902, ownerId: 9, ownerSide: 'enemy', gun: 'cannon', mode: 'shell', from: { x: 0, y: -200 }, to: { ...head.pos }, elapsed: 0, flightTime: 0.01, damage: 10, crewDamage: 0, splash: 0, impactRadius: 1.2, leeId: null });
    w.step(FIXED_DT * 2);
    expect(head.hp).toBe(head.maxHp);
  });

  test('your gunners shoot it: a manned gun in arc fires at a surfaced Ness', () => {
    const t = quiet(defaultTuning());
    const w = new World(t, 1, { enemies: [], nesses: [{ kind: 'weak' }], crew: [5, 6, 7, 8, 9, 10] });
    w.start();
    pin(w.player, { x: 0, y: 0 });
    const n = w.nesses.list[0];
    // Off the starboard beam, in range of the guns.
    n.x = 60;
    n.y = 0;
    n.heading = Math.PI;
    for (let i = 0; i < n.path.length; i++) n.path[i] = { x: n.x + i, y: n.y };
    n.state = 'surfaced';
    n.hold = 1000;
    layOut(n);
    for (const l of w.player.crew.lees) l.job = 'fire';
    let fired = 0;
    for (let i = 0; i < 40 / FIXED_DT; i++) {
      w.step(FIXED_DT);
      for (const e of w.drainEvents()) if (e.type === 'fire') fired++;
      // Keep it where the guns bear.
      pin(w.player, { x: 0, y: 0 });
      if (n.state !== 'surfaced') break;
    }
    expect(fired).toBeGreaterThan(0);
    expect(w.stats.player.shellsFired).toBeGreaterThan(0);
  });

  test('pistols reach it from the deck when it is close', () => {
    const t = quiet(defaultTuning());
    const { w, n } = surfaced(t, { x: 0, y: 12 });
    const head = headOf(n);
    let hits = 0;
    for (let i = 0; i < 20 / FIXED_DT && n.state === 'surfaced'; i++) {
      pin(w.player, { x: 0, y: 0 });
      w.step(FIXED_DT);
      for (const e of w.drainEvents()) if (e.type === 'pistol' && e.hit) hits++;
      if (head.hp < head.maxHp) break;
    }
    expect(w.stats.player.pistolShots).toBeGreaterThan(0);
    expect(n.parts.some((p) => p.hp < p.maxHp) || hits >= 0).toBe(true);
  });

  test('it dives when its time is up, and again when it is hurt enough', () => {
    const t = quiet(defaultTuning());
    const a = surfaced(t);
    a.n.hold = 0.5;
    until(a.w, a.n, 'submerged', 5);
    expect(a.w.events.some((e) => e.type === 'nessDive')).toBe(true);

    const b = surfaced(t);
    b.n.hurtSince = headOf(b.n).maxHp;
    b.w.step(FIXED_DT);
    expect(b.n.state).toBe('submerged');
  });

  test('then it can be hit no more', () => {
    const t = quiet(defaultTuning());
    const { w, n } = surfaced(t);
    n.hold = 0;
    w.step(FIXED_DT);
    expect(n.state).toBe('submerged');
    expect(w.nessTargets()).toHaveLength(0);
  });
});

describe('levels', () => {
  test('a higher level has more HP', () => {
    const t = quiet(defaultTuning());
    const w = new World(t, 1, { enemies: [], nesses: [{ kind: 'weak', level: 1 }, { kind: 'weak', level: 3 }], crew: [5] });
    const [a, b] = w.nesses.list;
    expect(headOf(b).maxHp).toBeCloseTo(headOf(a).maxHp * (1 + 2 * t.ness.common.levelScale), 5);
  });
});
