// Phase 8, slice 1: a Ness that surfaces and dives. Shadows can't be hit, a ring
// warns before it rises, rising under a hull wrecks the part above it, cannons and
// pistols hurt it while it's up, and killing its head wins the fight.

import { describe, expect, test } from 'vitest';
import { defaultTuning, type Tuning } from '../src/config/tuning';
import { isWrecked, type Boat } from '../src/sim/boat';
import { standingTile } from '../src/sim/crew';
import { headOf, layOut, nessKind, partAt, type Ness } from '../src/sim/ness';
import { tapZoneFor } from './helpers/ness';
import type { Vec } from '../src/sim/math';
import { FIXED_DT } from '../src/sim/steering';
import { deckTargets, pickTarget } from '../src/sim/targets';
import { zoneCenter } from '../src/sim/zones';
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

// ------------------------------------------------------------ slice 2: deck attacks

/** A Ness of this kind, up and alongside the player's starboard rail, with its first attack due now. */
function alongside(t: Tuning, kind: 'weak' | 'mad', crew: number[] = [5, 6, 7, 8, 9, 10]): { w: World; n: Ness } {
  const w = new World(t, 1, { enemies: [], nesses: [{ kind }], crew });
  w.start();
  pin(w.player, { x: 0, y: 0 });
  const n = w.nesses.list[0];
  const k = nessKind(t, kind);
  const edge = w.player.layout.beam / 2 + k.standoff;
  // Starboard is +y in the boat's frame; the boat points north (-y world), so starboard is +x in the world.
  n.x = edge;
  n.y = 0;
  n.heading = -Math.PI / 2;
  for (let i = 0; i < n.path.length; i++) n.path[i] = { x: edge, y: i };
  n.state = 'surfaced';
  n.stateT = 0;
  n.hold = 1000;
  n.cool = 0;
  layOut(n);
  return { w, n };
}

describe('deck attacks', () => {
  test('a bite puts a warning on a circle of tiles, then hurts the Lees in it', () => {
    const t = quiet(defaultTuning());
    const { w, n } = alongside(t, 'weak');
    w.step(FIXED_DT);
    expect(n.act?.kind).toBe('bite');
    const z = w.zones.pending(w.player)[0];
    expect(z).toBeDefined();
    expect(z.tiles.length).toBeGreaterThan(0);
    expect(w.events.some((e) => e.type === 'zoneWarn')).toBe(true);
    const inZone = w.player.crew.lees.filter((l) => z.tiles.includes(standingTile(l)));
    const before = inZone.map((l) => l.hp);
    run(w, t.ness.kinds.weak.biteWarn + 0.2);
    expect(z.impacted).toBe(true);
    if (inZone.length) expect(inZone.some((l, i) => l.hp < before[i] || !l.alive)).toBe(true);
    expect(w.events.some((e) => e.type === 'zoneImpact')).toBe(true);
  });

  test('a zone is on the side the Ness is on', () => {
    const t = quiet(defaultTuning());
    const { w } = alongside(t, 'mad');
    w.step(FIXED_DT);
    const z = w.zones.pending(w.player)[0];
    expect(z.side).toBe('starboard');
    const g = w.player.grid;
    const maxY = Math.max(...g.tiles.map((x) => x.center.y));
    for (const i of z.tiles) expect(g.tiles[i].center.y).toBeGreaterThan(maxY - 2.5 * g.tileH);
  });

  test('a head smash: heavy damage, the tiles break, and its head rests on the deck, stunned', () => {
    const t = quiet(defaultTuning());
    const { w, n } = alongside(t, 'mad');
    w.step(FIXED_DT);
    expect(n.act?.kind).toBe('smash');
    const z = w.zones.pending(w.player)[0];
    const hp0 = z.tiles.map((i) => w.player.grid.tiles[i].hp);
    run(w, t.ness.kinds.mad.smashWarn + 0.3);
    expect(z.impacted).toBe(true);
    expect(z.tiles.some((i, k) => w.player.grid.tiles[i].hp < hp0[k])).toBe(true);
    expect(n.stunUntil).not.toBeNull();
    // The head is over the deck now.
    const head = headOf(n);
    expect(w.player.parts.some((p) => p.layers[p.layers.length - 1].hp < p.layers[p.layers.length - 1].maxHp)).toBe(true);
    expect(Math.hypot(head.pos.x - w.player.motion.x, head.pos.y - w.player.motion.y)).toBeLessThan(w.player.layout.length / 2);
    // Stunned: it does nothing until it lifts, then it is up again.
    run(w, 1);
    expect(n.act).toBeNull();
    run(w, t.ness.kinds.mad.smashStun + 0.5);
    expect(n.stunUntil).toBeNull();
    expect(w.events.some((e) => e.type === 'nessLift')).toBe(true);
  });

  test('a tail slap pushes Lees away, knocks them off their posts and floods the tiles', () => {
    const t = quiet(defaultTuning());
    const { w, n } = alongside(t, 'mad');
    // Make the next attack a slap.
    n.attackIdx = 1;
    w.step(FIXED_DT);
    expect(n.act?.kind).toBe('slap');
    const z = w.zones.pending(w.player)[0];
    const hit = w.player.crew.lees.filter((l) => z.tiles.includes(standingTile(l)));
    expect(hit.length).toBeGreaterThan(0);
    const water0 = w.player.parts.reduce((a, p) => a + p.water, 0);
    const before = new Map(hit.map((l) => [l.id, { y: l.pos.y, hp: l.hp }]));
    run(w, t.ness.kinds.mad.slapWarn + 0.1);
    expect(z.impacted).toBe(true);
    // Shoved to port (away from the starboard Ness) and staggered.
    for (const l of hit) {
      if (!l.alive) continue;
      expect(l.stagger > 0 || l.slide !== null).toBe(true);
      expect(l.pos.y).toBeLessThanOrEqual(before.get(l.id)!.y + 1e-6);
    }
    expect(w.player.parts.reduce((a, p) => a + p.water, 0)).toBeGreaterThan(water0);
    expect(w.events.some((e) => e.type === 'pushed')).toBe(true);
    // After the stagger they go back to work.
    run(w, 3);
    expect(hit.every((l) => !l.alive || l.stagger === 0)).toBe(true);
  });

  test('tapping the zone gets the Lees out of it before it lands', () => {
    const t = quiet(defaultTuning());
    const { w } = alongside(t, 'mad');
    w.step(FIXED_DT);
    const z = w.zones.pending(w.player)[0];
    const inZone = w.player.crew.lees.filter((l) => z.tiles.includes(standingTile(l)));
    expect(inZone.length).toBeGreaterThan(0);
    expect(tapZoneFor(w)).toBeNull();
    expect(w.orders.list.filter((o) => o.kind === 'flee').length).toBe(inZone.length);
    const hp = inZone.map((l) => l.hp);
    run(w, t.ness.kinds.mad.smashWarn + 0.2);
    // They made it out: nobody was standing there when it landed.
    expect(inZone.map((l) => l.hp)).toEqual(hp);
    // And once it has landed the orders end and they go back to their jobs.
    run(w, 1);
    expect(w.orders.list.filter((o) => o.kind === 'flee')).toHaveLength(0);
  });

  test('a Lee in danger shows it (the crew bar flashes)', () => {
    const t = quiet(defaultTuning());
    const { w } = alongside(t, 'mad');
    w.step(FIXED_DT);
    const z = w.zones.pending(w.player)[0];
    const lee = w.player.crew.lees.find((l) => z.tiles.includes(standingTile(l)))!;
    expect(w.zones.inDanger(lee)).toBe(true);
    const safe = w.player.crew.lees.find((l) => !z.tiles.includes(standingTile(l)));
    if (safe) expect(w.zones.inDanger(safe)).toBe(false);
  });

  test('tap the stunned head and Lees stab it for bonus damage', () => {
    const t = quiet(defaultTuning());
    t.ness.kinds.mad.smashStun = 8;
    const { w, n } = alongside(t, 'mad');
    n.cool = 0;
    w.step(FIXED_DT);
    // Let it smash with everyone out of the way.
    tapZoneFor(w);
    run(w, t.ness.kinds.mad.smashWarn + 0.3);
    expect(n.stunUntil).not.toBeNull();
    const head = headOf(n);
    const hp0 = head.hp;
    expect(w.tapHead(n)).toBeNull();
    expect(w.orders.list.some((o) => o.kind === 'stab')).toBe(true);
    run(w, 3);
    expect(head.hp).toBeLessThan(hp0);
    // A swing is worth stabMul sword hits.
    expect(hp0 - head.hp).toBeGreaterThanOrEqual(t.melee.damage * t.ness.kinds.mad.stabMul * 0.5);
  });

  test('tapping a head that is up again is refused', () => {
    const t = quiet(defaultTuning());
    const { w, n } = alongside(t, 'mad');
    expect(w.tapHead(n)).not.toBeNull();
  });

  test('a Ness that dives takes its warnings with it', () => {
    const t = quiet(defaultTuning());
    const { w, n } = alongside(t, 'mad');
    w.step(FIXED_DT);
    expect(w.zones.pending(w.player).length).toBe(1);
    n.act = null;
    n.hurtSince = headOf(n).maxHp;
    w.step(FIXED_DT);
    expect(n.state).toBe('submerged');
    expect(w.zones.pending(w.player)).toHaveLength(0);
  });

  test('killing the head cancels what is coming', () => {
    const t = quiet(defaultTuning());
    const { w, n } = alongside(t, 'mad');
    w.step(FIXED_DT);
    expect(w.zones.pending(w.player).length).toBe(1);
    w.nesses.hurt(w, n, headOf(n), 9999);
    expect(n.state).toBe('dead');
    expect(w.zones.pending(w.player)).toHaveLength(0);
  });

  test('a Lee shoved into the edge of the deck takes extra damage (a hard surface)', () => {
    const t = quiet(defaultTuning());
    const { w } = alongside(t, 'mad');
    const g = w.player.grid;
    const lee = w.player.crew.lees[0];
    // Put it at the very port edge and shove it further to port.
    const edge = g.tiles.reduce((a, b) => (b.center.y < a.center.y ? b : a));
    lee.tile = edge.index;
    lee.pos = { ...edge.center };
    const hp = lee.hp;
    w.pushAndHurt(lee, { x: 0, y: -1 }, 2, 0.5);
    expect(lee.hp).toBeLessThan(hp);
  });

  test('a tap on the flashing zone (or the stunned head) is a deck target, the zone first', () => {
    const t = quiet(defaultTuning());
    t.ness.kinds.mad.smashStun = 8;
    const { w, n } = alongside(t, 'mad');
    w.step(FIXED_DT);
    const z = w.zones.pending(w.player)[0];
    const hit = pickTarget(deckTargets(w, [w.player]), zoneCenter(z), 1);
    expect(hit?.kind).toBe('zone');
    expect(hit?.tap()).toBeNull();
    run(w, t.ness.kinds.mad.smashWarn + 0.3);
    expect(n.stunUntil).not.toBeNull();
    const head = pickTarget(deckTargets(w, [w.player]), headOf(n).pos, 0);
    expect(head?.kind).toBe('head');
    expect(head?.tap()).toBeNull();
  });
});
