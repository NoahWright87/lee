// Phase 8: the plain Ness. An oval body that moves like a boat (a little faster than yours),
// swims at a depth (a shadow, shrinking and darkening as it rises), circles, runs in and
// surfaces beside you, bites with a neck (a red rectangle and a bubble warn first; the head
// stays on your boat a moment), grabs with its hands, flees when hurt and floats when dead.
// Weapons reach it by depth: cannons up and shallow, a mortar any depth, a depth gun what is
// under the water.

import { describe, expect, test } from 'vitest';
import { defaultTuning, type Tuning } from '../src/config/tuning';
import { motionParams, type Boat } from '../src/sim/boat';
import { standingTile } from '../src/sim/crew';
import { bandOf, bodyGap, createNess, gunReaches, isHeadOpen, nessKind, ovalGap, type Ness } from '../src/sim/ness';
import { Rng, toLocal, type Vec } from '../src/sim/math';
import { FIXED_DT } from '../src/sim/steering';
import { deckTargets, pickTarget } from '../src/sim/targets';
import { zoneCenter } from '../src/sim/zones';
import { World } from '../src/sim/world';
import { tapZoneFor } from './helpers/ness';

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

const CREW = [0, 1, 2, 3, 4, 5, 6, 7];

/** A world with the player parked and a Ness. */
function setup(t: Tuning, crew: number[] = CREW): { w: World; n: Ness } {
  const w = new World(t, 1, { enemies: [], nesses: [{ kind: 'ness' }], crew });
  w.start();
  pin(w.player);
  return { w, n: w.nesses.list[0] };
}

/** The Ness beside your port rail, up, neck side toward you, first bite due now. The boat is held still. */
function alongside(t: Tuning, crew: number[] = CREW): { w: World; n: Ness; hold: () => void } {
  const { w, n } = setup(t, crew);
  const k = nessKind(t, 'ness');
  n.neck.side = 1;
  n.boatSide = -1;
  const x = -(w.player.layout.beam / 2 + n.beam / 2 + k.standoff);
  // Its nose (forward is -y here) sits `noseAhead` ahead of your middle, so the rest of it lies back along your stern.
  const y = n.length / 2 - k.noseAhead;
  Object.assign(n.motion, { x, y, heading: -Math.PI / 2, vx: 0, vy: 0, omega: 0 });
  n.mode = 'alongside';
  n.depth = 0;
  n.depthTarget = 0;
  n.neck.cool = 0;
  n.alongT = 0;
  for (const h of n.hands) h.readyAt = 1e9;
  const hold = () => pin(w.player);
  return { w, n, hold };
}

describe('the body moves like a boat', () => {
  test('it starts deep and far, circling, and is never faster than 20% over your top speed', () => {
    const t = quiet(defaultTuning());
    const { w, n } = setup(t);
    expect(n.mode).toBe('circle');
    expect(n.depth).toBeGreaterThan(0.6);
    expect(Math.hypot(n.motion.x, n.motion.y)).toBeGreaterThan(100);
    const top = motionParams(w.player, t).cruiseSpeed;
    let fastest = 0;
    let jump = 0;
    let last = { x: n.motion.x, y: n.motion.y };
    let charging = 0;
    run(w, 30, () => {
      pin(w.player);
      const v = Math.hypot(n.motion.vx, n.motion.vy);
      // Circling it is 10-20% faster than you; on its run in it is quicker still.
      if (n.mode === 'circle') fastest = Math.max(fastest, v);
      else charging = Math.max(charging, v);
      jump = Math.max(jump, Math.hypot(n.motion.x - last.x, n.motion.y - last.y));
      last = { x: n.motion.x, y: n.motion.y };
    });
    expect(fastest).toBeGreaterThan(top * 0.6);
    expect(fastest).toBeLessThanOrEqual(top * 1.2 + 0.2);
    expect(charging).toBeLessThanOrEqual(top * 1.2 * nessKind(t, 'ness').chargeMul + 0.3);
    // No teleporting: it never moves further in a step than a bit over its top speed.
    expect(jump).toBeLessThan(top * 1.7 * FIXED_DT + 0.05);
  });

  test('it circles you instead of swimming straight, keeping a loose distance', () => {
    const t = quiet(defaultTuning());
    const { w, n } = setup(t);
    n.circleFor = 1e9;
    run(w, 25, () => pin(w.player));
    const k = nessKind(t, 'ness');
    let turned = 0;
    let lastH = n.motion.heading;
    const dists: number[] = [];
    run(w, 30, () => {
      pin(w.player);
      turned += Math.abs(Math.atan2(Math.sin(n.motion.heading - lastH), Math.cos(n.motion.heading - lastH)));
      lastH = n.motion.heading;
      dists.push(Math.hypot(n.motion.x, n.motion.y));
    });
    expect(turned).toBeGreaterThan(Math.PI);
    expect(Math.min(...dists)).toBeGreaterThan(k.circleRange - k.circleWobble - 25);
    expect(Math.max(...dists)).toBeLessThan(k.circleRange + k.circleWobble + 25);
  });

  test('after circling it runs in, rises through shallow, and surfaces beside your hull without overlapping it', () => {
    const t = quiet(defaultTuning());
    const { w, n } = setup(t, []);
    const k = nessKind(t, 'ness');
    n.circleFor = 3;
    const bands = new Set<string>();
    let lastDepth = n.depth;
    let maxStep = 0;
    let neverOverlapped = true;
    run(w, 90, () => {
      pin(w.player);
      bands.add(bandOf(n, k));
      maxStep = Math.max(maxStep, Math.abs(n.depth - lastDepth));
      lastDepth = n.depth;
      if (n.depth <= k.surfacedMax && bodyGap(n, w.player).gap < -0.5) neverOverlapped = false;
      if (n.mode === 'alongside') w.step(0);
    });
    expect(['alongside', 'withdraw', 'flee', 'circle', 'gone', 'dead']).toContain(n.mode);
    expect(bands.has('deep') && bands.has('shallow') && bands.has('surface')).toBe(true);
    // Depth changes smoothly, a little at a time.
    expect(maxStep).toBeLessThan(0.02);
    expect(neverOverlapped).toBe(true);
  });

  test('it gets alongside on the side its neck faces, and holds station next to a moving boat', () => {
    const t = quiet(defaultTuning());
    const { w, n } = setup(t, []);
    n.circleFor = 2;
    let arrived = false;
    // The boat sails north on its own.
    w.setHelm({ kind: 'heading', h: -Math.PI / 2 });
    run(w, 80, () => {
      if (n.mode === 'alongside') arrived = true;
    });
    expect(arrived).toBe(true);
    // Its neck side faces your hull.
    const l = ((): number => {
      const dx = w.player.motion.x - n.motion.x;
      const dy = w.player.motion.y - n.motion.y;
      const out = { x: Math.cos(n.motion.heading + n.neck.side * (Math.PI / 2)), y: Math.sin(n.motion.heading + n.neck.side * (Math.PI / 2)) };
      return dx * out.x + dy * out.y;
    })();
    if (n.mode === 'alongside') expect(l).toBeGreaterThan(0);
  });

  test('the ⚠️ marks where it will break the surface while it rises', () => {
    const t = quiet(defaultTuning());
    const { w, n } = setup(t);
    n.circleFor = 2;
    let marked = 0;
    run(w, 60, () => {
      pin(w.player);
      if (n.emergeAt) marked++;
    });
    expect(marked).toBeGreaterThan(0);
  });
});

describe('what reaches it, by depth', () => {
  test('cannons: up and shallow; a mortar: any depth; a depth gun: under the water; a harpoon and a gatling: none', () => {
    expect(gunReaches('shell', 'surface')).toBe(true);
    expect(gunReaches('shell', 'shallow')).toBe(true);
    expect(gunReaches('shell', 'deep')).toBe(false);
    expect(gunReaches('lob', 'deep')).toBe(true);
    expect(gunReaches('lob', 'surface')).toBe(true);
    expect(gunReaches('depth', 'surface')).toBe(false);
    expect(gunReaches('depth', 'shallow')).toBe(true);
    expect(gunReaches('depth', 'deep')).toBe(true);
    expect(gunReaches('harpoon', 'surface')).toBe(false);
    expect(gunReaches('stream', 'surface')).toBe(false);
  });

  const shell = (n: Ness, mode: 'shell' | 'lob', dmg = 10) => ({ id: 900, group: 900, ownerId: 1, ownerSide: 'player' as const, gun: 'cannon', mode, from: { x: 0, y: 0 }, to: { x: n.motion.x, y: n.motion.y }, elapsed: 0, flightTime: 0.01, damage: dmg, crewDamage: 0, splash: 1, impactRadius: 1.2, leeId: null });

  test('a cannon shell hurts it on the surface and just under, and passes over it when deep', () => {
    const t = quiet(defaultTuning());
    const { w, n } = setup(t, []);
    n.circleFor = 1e9;
    for (const [depth, hurt] of [[0, true], [0.4, true], [0.9, false]] as const) {
      n.hp = n.maxHp;
      n.depth = depth;
      n.depthTarget = depth;
      w.shells.push(shell(n, 'shell'));
      w.step(FIXED_DT * 2);
      expect(n.hp < n.maxHp, `depth ${depth}`).toBe(hurt);
    }
  });

  test('a mortar shell reaches it even deep', () => {
    const t = quiet(defaultTuning());
    const { w, n } = setup(t, []);
    n.circleFor = 1e9;
    n.depth = 0.9;
    n.depthTarget = 0.9;
    w.shells.push(shell(n, 'lob'));
    w.step(FIXED_DT * 2);
    expect(n.hp).toBeLessThan(n.maxHp);
  });

  test('a shot on the head does double', () => {
    const t = quiet(defaultTuning());
    const { w, n } = alongside(t, []);
    const k = nessKind(t, 'ness');
    const before = n.hp;
    w.nesses.hurt(w, n, 10, 'head');
    expect(before - n.hp).toBeCloseTo(10 * k.headMul, 5);
    const mid = n.hp;
    w.nesses.hurt(w, n, 10, 'body');
    expect(mid - n.hp).toBeCloseTo(10, 5);
  });

  test('pistols reach it on the surface only', () => {
    const t = quiet(defaultTuning());
    const a = alongside(t);
    a.n.neck.cool = 1e9;
    a.n.mode = 'alongside';
    run(a.w, 6, a.hold);
    expect(a.w.stats.player.pistolShots).toBeGreaterThan(0);
    const b = alongside(t);
    b.n.neck.cool = 1e9;
    b.n.depth = 0.8;
    b.n.depthTarget = 0.8;
    b.n.mode = 'circle';
    b.n.circleFor = 1e9;
    Object.assign(b.n.motion, { x: -13, y: 0 });
    run(b.w, 3, () => {
      b.hold();
      Object.assign(b.n.motion, { x: -13, y: 0, vx: 0, vy: 0 });
    });
    expect(b.w.stats.player.pistolShots).toBe(0);
  });
});

describe('jammed against the hull', () => {
  test('a surfaced Ness against your boat at a bad angle (not in its slot) still attacks', () => {
    const t = quiet(defaultTuning());
    const { w, n } = setup(t, []);
    // Crosswise to your boat, nose to the rail, surfaced, still in "approach" with its slot somewhere else.
    n.neck.side = 1;
    Object.assign(n.motion, { x: -12, y: 4, heading: 0, vx: 0, vy: 0, omega: 0 });
    n.boatSide = -1;
    n.mode = 'approach';
    n.depth = 0;
    n.depthTarget = 0;
    n.neck.cool = 0;
    for (const h of n.hands) h.readyAt = 1e9;
    const states = new Set<string>();
    const modes = new Set<string>();
    run(w, 8, () => {
      pin(w.player);
      states.add(n.neck.state);
      modes.add(n.mode);
    });
    expect(modes.has('alongside')).toBe(true);
    expect(states.has('windup')).toBe(true);
  });
});

describe('cannon balls and a diving Ness', () => {
  const lob = (w: World, at: Vec, flight: number) =>
    w.shells.push({ id: 9000 + w.shells.length, group: 9000 + w.shells.length, ownerId: w.player.id, ownerSide: 'player', gun: 'cannon', mode: 'shell', from: { x: 0, y: 0 }, to: { ...at }, elapsed: 0, flightTime: flight, damage: 10, crewDamage: 0, splash: 0, impactRadius: 3, leeId: null });

  test('a ball that was in the air while it was still shallow hits it even if it has dived by the time the ball lands', () => {
    const t = quiet(defaultTuning());
    const { w, n } = setup(t, []);
    Object.assign(n.motion, { x: -40, y: 0, vx: 0, vy: 0 });
    n.mode = 'circle';
    n.circleFor = 1e9;
    n.depth = 0.3;
    n.depthTarget = 0.3;
    lob(w, { x: n.motion.x, y: n.motion.y }, 1.5);
    const hp = n.hp;
    run(w, 1.7, () => {
      pin(w.player);
      Object.assign(n.motion, { x: -40, y: 0, vx: 0, vy: 0 });
      // It dives hard after half a second.
      if (w.time > 0.5) {
        n.depth = 0.95;
        n.depthTarget = 0.95;
      } else {
        n.depth = 0.3;
        n.depthTarget = 0.3;
      }
    });
    expect(n.hp).toBeLessThan(hp);
  });

  test('but a ball fired at a Ness that has long been deep still misses', () => {
    const t = quiet(defaultTuning());
    const { w, n } = setup(t, []);
    Object.assign(n.motion, { x: -40, y: 0, vx: 0, vy: 0 });
    n.mode = 'circle';
    n.circleFor = 1e9;
    run(w, 4, () => {
      pin(w.player);
      Object.assign(n.motion, { x: -40, y: 0, vx: 0, vy: 0 });
      n.depth = 0.95;
      n.depthTarget = 0.95;
    });
    lob(w, { x: -40, y: 0 }, 1.5);
    const hp = n.hp;
    run(w, 1.7, () => {
      pin(w.player);
      Object.assign(n.motion, { x: -40, y: 0, vx: 0, vy: 0 });
      n.depth = 0.95;
      n.depthTarget = 0.95;
    });
    expect(n.hp).toBe(hp);
  });
});

describe('under and over the hull', () => {
  const under = (n: Ness, depth: number) => {
    Object.assign(n.motion, { x: 0, y: 0, heading: -Math.PI / 2, vx: 0, vy: 0, omega: 0 });
    n.mode = 'circle';
    n.circleFor = 1e9;
    n.neck.cool = 1e9;
    n.depth = depth;
    n.depthTarget = depth;
  };

  test('a Ness that is up (surfaced or shallow) is solid: it and the boat knock each other clear', () => {
    for (const depth of [0, 0.4]) {
      const t = quiet(defaultTuning());
      const { w, n } = setup(t);
      const k = nessKind(t, 'ness');
      Object.assign(n.motion, { x: -3, y: 2, heading: -Math.PI / 2, vx: 0, vy: 0, omega: 0 });
      n.mode = 'circle';
      n.circleFor = 1e9;
      n.neck.cool = 1e9;
      n.depth = depth;
      n.depthTarget = depth;
      expect(bodyGap(n, w.player).gap).toBeLessThan(0);
      run(w, 2, () => {
        n.depth = depth;
        n.depthTarget = depth;
        n.motion.vx = n.motion.vy = 0;
      });
      expect(bodyGap(n, w.player).gap).toBeGreaterThan(-0.3);
      void k;
    }
  });

  test('a deep Ness passes under the boat and is not pushed', () => {
    const t = quiet(defaultTuning());
    const { w, n } = setup(t);
    under(n, 0.9);
    run(w, 1, () => {
      pin(w.player);
      n.depth = 0.9;
      n.depthTarget = 0.9;
      Object.assign(n.motion, { x: 0, y: 0, vx: 0, vy: 0 });
    });
    expect(Math.hypot(n.motion.x, n.motion.y)).toBeLessThan(0.01);
    expect(n.depth).toBeGreaterThan(0.85);
  });

  test('it will not come up through a hull: it stays submerged until it is clear', () => {
    const t = quiet(defaultTuning());
    const { w, n } = setup(t);
    const k = nessKind(t, 'ness');
    under(n, 0.9);
    run(w, 6, () => {
      pin(w.player);
      n.depthTarget = 0;
      n.mode = 'circle';
      Object.assign(n.motion, { x: 0, y: 0, vx: 0, vy: 0 });
    });
    expect(n.depth).toBeGreaterThan(k.shallowMax);
  });
});

describe('the bite', () => {
  test('alongside, it rears back and puts up a red rectangle and a bubble before it bites, with time to react', () => {
    const t = quiet(defaultTuning());
    const { w, n, hold } = alongside(t);
    const k = nessKind(t, 'ness');
    run(w, 0.2, hold);
    expect(n.neck.state).toBe('windup');
    const z = w.zones.pending(w.player)[0];
    expect(z).toBeDefined();
    expect(z.warn).toBeGreaterThanOrEqual(1.5);
    expect(z.tiles.length).toBeGreaterThan(0);
    // Some tiles are hit in full, the rest along the neck for less.
    const weights = [...z.weights.values()];
    expect(Math.max(...weights)).toBe(1);
    // The head has pulled back from where it rests.
    const rest = Math.hypot(n.neck.head.x - n.motion.x, n.neck.head.y - n.motion.y);
    run(w, k.biteWarn * 0.8, hold);
    expect(Math.hypot(n.neck.head.x - n.motion.x, n.neck.head.y - n.motion.y)).toBeLessThan(rest + 0.5);
    // It then strikes, fast, and lands in about the time the zone said.
    run(w, 1, hold);
    expect(['strike', 'hold']).toContain(n.neck.state);
  });

  test('pull clear of the neck and it bites the water: nothing is hit', () => {
    const t = quiet(defaultTuning());
    const { w, n } = alongside(t);
    run(w, 0.3, () => pin(w.player));
    const z = w.zones.pending(w.player)[0];
    expect(z.tiles.length).toBeGreaterThan(0);
    const hp = w.player.crew.lees.map((l) => l.hp);
    const tiles = w.player.grid.tiles.map((x) => x.hp);
    // The boat slides well clear (and the Ness, not holding it, stays).
    run(w, 3, () => pin(w.player, { x: 60, y: 0 }));
    void n;
    expect(z.impacted).toBe(true);
    expect(w.player.crew.lees.map((l) => l.hp)).toEqual(hp);
    expect(w.player.grid.tiles.map((x) => x.hp)).toEqual(tiles);
  });

  test('the aim point and its bubble stay put on your deck while the boats move together', () => {
    const t = quiet(defaultTuning());
    const { w, n } = alongside(t);
    run(w, 0.3, () => pin(w.player));
    const z = w.zones.pending(w.player)[0];
    const onDeck = (p: Vec) => toLocal(p, w.player.motion, w.player.motion.heading);
    const at = onDeck(zoneCenter(z));
    // Both boats sail on (the Ness keeps station with a nudge each step): the spot on the deck is where it was.
    run(w, 0.8, () => {
      for (const m of [w.player.motion, n.motion]) {
        m.x += 0.15;
        m.y -= 0.1;
      }
    });
    expect(w.zones.pending(w.player)[0]).toBe(z);
    const now = onDeck(zoneCenter(z));
    expect(Math.abs(now.x - at.x)).toBeLessThan(0.2);
    expect(Math.abs(now.y - at.y)).toBeLessThan(0.2);
  });

  test('it hits the tip hardest, and Lees there are hurt, the neck line less', () => {
    const t = quiet(defaultTuning());
    const { w, hold } = alongside(t);
    run(w, 0.2, hold);
    const z = w.zones.pending(w.player)[0];
    const tipTiles = [...z.weights].filter(([, v]) => v >= 1).map(([i]) => i);
    expect(tipTiles.length).toBeGreaterThan(0);
    const hp = w.player.crew.lees.map((l) => l.hp);
    const tiles = w.player.grid.tiles.map((x) => x.hp);
    run(w, 3, hold);
    expect(z.impacted).toBe(true);
    // Something under the tip took the bite: a tile, or a Lee standing on it.
    expect(w.player.grid.tiles.some((x, i) => x.hp < tiles[i]) || w.player.crew.lees.some((l, i) => l.hp < hp[i])).toBe(true);
  });

  test('tapping the bubble gets the Lees out of the tip tiles before it lands', () => {
    const t = quiet(defaultTuning());
    const { w, hold } = alongside(t);
    run(w, 0.2, hold);
    const z = w.zones.pending(w.player)[0];
    const hit = pickTarget(deckTargets(w, [w.player]), zoneCenter(z), 1);
    expect(hit?.kind).toBe('zone');
    const inTip = w.player.crew.lees.filter((l) => z.weights.get(standingTile(l)) === 1);
    expect(tapZoneFor(w)).toBeNull();
    const hp = inTip.map((l) => l.hp);
    run(w, 3, hold);
    expect(inTip.map((l) => l.hp)).toEqual(hp);
  });

  test('a Lee standing in danger is flagged (the crew bar flashes)', () => {
    const t = quiet(defaultTuning());
    const { w, hold } = alongside(t);
    run(w, 0.2, hold);
    const z = w.zones.pending(w.player)[0];
    const lee = w.player.crew.lees.find((l) => (z.weights.get(standingTile(l)) ?? 0) > 0);
    if (lee) expect(w.zones.inDanger(lee)).toBe(true);
  });

  test('after the bite the head stays on your boat for a while: the window to hit it', () => {
    const t = quiet(defaultTuning());
    const { w, n, hold } = alongside(t);
    const k = nessKind(t, 'ness');
    run(w, k.biteWarn + k.biteStrike + 0.1, hold);
    expect(n.neck.state).toBe('hold');
    expect(isHeadOpen(n)).toBe(true);
    run(w, k.biteHold + 0.1, hold);
    expect(['retract', 'rest']).toContain(n.neck.state);
    expect(isHeadOpen(n)).toBe(false);
  });

  test('Lees standing by the head hit it by themselves (a head shot), and a tap on it sends more', () => {
    const t = quiet(defaultTuning());
    t.ness.kinds.ness.biteHold = 6;
    const { w, n, hold } = alongside(t);
    const k = nessKind(t, 'ness');
    run(w, k.biteWarn + k.biteStrike + 0.1, hold);
    expect(isHeadOpen(n)).toBe(true);
    const target = pickTarget(deckTargets(w, [w.player]), n.neck.head, 0);
    expect(target?.kind).toBe('head');
    expect(target?.tap()).toBeNull();
    const hp = n.hp;
    run(w, 4, hold);
    expect(n.hp).toBeLessThan(hp);
  });

  test('a tap on a head that is away again is refused', () => {
    const t = quiet(defaultTuning());
    const { w, n } = alongside(t);
    expect(w.tapHead(n)).not.toBeNull();
  });

  test('after a few bites it withdraws, dives and circles again', () => {
    const t = quiet(defaultTuning());
    t.ness.kinds.ness.bitesPerPass = 1;
    t.ness.kinds.ness.biteHold = 0.5;
    const { w, n, hold } = alongside(t, []);
    const modes = new Set<string>();
    run(w, 40, () => {
      hold();
      modes.add(n.mode);
    });
    expect(modes.has('withdraw')).toBe(true);
    expect(modes.has('circle')).toBe(true);
  });
});

describe('hands', () => {
  function withHands(t: Tuning, crew: number[] = CREW): { w: World; n: Ness; hold: () => void } {
    t.ness.kinds.ness.handFirst = 0;
    const a = alongside(t, crew);
    a.n.neck.cool = 1e9;
    for (const h of a.n.hands) h.readyAt = 0;
    return a;
  }

  test('a hand reaches for your hull (marked where it will land), grabs, and holds', () => {
    const t = quiet(defaultTuning());
    const { w, n, hold } = withHands(t);
    let thrown = false;
    let telegraphed = false;
    let held = false;
    // (The gunners cut a hand loose within a couple of seconds, so look for the grab as it happens.)
    run(w, 3, () => {
      hold();
      if (w.drainEvents().some((e) => e.type === 'handThrown')) thrown = true;
      if (w.telegraphs.list.some((x) => x.kind === 'area')) telegraphed = true;
      if (n.hands.some((h) => h.state === 'holding')) held = true;
    });
    expect(thrown).toBe(true);
    expect(telegraphed).toBe(true);
    expect(held).toBe(true);
  });

  test('a holding hand keeps the hulls together: you cannot sail away', () => {
    const t = quiet(defaultTuning());
    const { w, n } = withHands(t, []);
    run(w, 3, () => pin(w.player));
    expect(n.hands.some((h) => h.state === 'holding')).toBe(true);
    // Now the boat tries to sail off at full speed; the Ness holds still.
    const start = w.player.motion.y;
    run(w, 8, () => {
      w.player.motion.vy = -7;
      w.player.target = { x: 0, y: -500 };
      n.motion.vx = 0;
      n.motion.vy = 0;
    });
    // It got dragged (the Ness is pulled too) but the gap never opened past the line.
    const limit = Math.max(...n.hands.map((h) => h.limit));
    expect(bodyGap(n, w.player).gap).toBeLessThan(limit + 3);
    void start;
  });

  test('it cannot dive while a hand holds: the hands let go first when it flees', () => {
    const t = quiet(defaultTuning());
    const { w, n } = withHands(t, []);
    run(w, 3, () => pin(w.player));
    expect(n.hands.some((h) => h.state === 'holding')).toBe(true);
    w.nesses.hurt(w, n, n.maxHp * 0.6, 'body');
    expect(n.mode).toBe('flee');
    run(w, 0.5, () => pin(w.player));
    // Still holding for a moment: still up.
    expect(n.depth).toBeLessThan(0.05);
    run(w, 4, () => pin(w.player));
    expect(n.hands.some((h) => h.state === 'holding')).toBe(false);
    expect(n.depth).toBeGreaterThan(0.2);
  });

  test('tap the hand and a Lee hacks it free; pistols hit it too', () => {
    const t = quiet(defaultTuning());
    const { w, n } = withHands(t);
    run(w, 1.5, () => pin(w.player));
    const hand = n.hands.find((h) => h.state === 'holding')!;
    const target = pickTarget(deckTargets(w, [w.player]), hand.pos, 0);
    expect(target?.kind).toBe('hand');
    expect(target?.tap()).toBeNull();
    for (const l of w.player.crew.lees) l.job = 'board';
    run(w, 20, () => pin(w.player));
    expect(hand.state === 'holding').toBe(false);
  });
});

describe('fleeing and dying', () => {
  test('hurt to half, it breaks off: it dives and swims away, and you can still finish it', () => {
    const t = quiet(defaultTuning());
    const { w, n } = alongside(t, []);
    w.nesses.hurt(w, n, n.maxHp * 0.55, 'body');
    expect(n.mode).toBe('flee');
    run(w, 0.3, () => pin(w.player));
    // Not instant: still near the surface.
    expect(n.depth).toBeLessThan(0.5);
    expect(n.mode).toBe('flee');
    // Finish it before it is gone.
    w.nesses.hurt(w, n, n.hp + 1, 'body');
    expect(n.mode).toBe('dead');
  });

  test('it retreats briefly, then comes back (still hurt) and can be finished off', () => {
    const t = quiet(defaultTuning());
    const k = nessKind(t, 'ness');
    const { w, n } = alongside(t, []);
    w.nesses.hurt(w, n, n.maxHp * 0.55, 'body');
    const hp = n.hp;
    expect(n.mode).toBe('flee');
    let far = 0;
    run(w, k.fleeTime + 4, () => {
      pin(w.player);
      far = Math.max(far, Math.hypot(n.motion.x, n.motion.y));
    });
    expect(far).toBeGreaterThan(30);
    expect(['circle', 'approach', 'alongside']).toContain(n.mode);
    expect(n.hp).toBe(hp);
    expect(w.foesLeft()).toBe(1);
    w.nesses.hurt(w, n, n.hp + 1, 'body');
    expect(n.mode).toBe('dead');
  });

  test('it breaks off again at a quarter of its health, and after that fights on to the end', () => {
    const t = quiet(defaultTuning());
    const { w, n } = alongside(t, []);
    w.nesses.hurt(w, n, n.maxHp * 0.55, 'body');
    expect(n.retreats).toBe(1);
    n.mode = 'alongside';
    w.nesses.hurt(w, n, n.hp - n.maxHp * 0.2, 'body');
    expect(n.mode).toBe('flee');
    expect(n.retreats).toBe(2);
    n.mode = 'alongside';
    w.nesses.hurt(w, n, n.hp - 5, 'body');
    expect(n.mode).toBe('alongside');
    expect(n.retreats).toBe(2);
  });

  test('killed, it floats on the surface with its neck at rest, and counts as slain', () => {
    const t = quiet(defaultTuning());
    const { w, n } = alongside(t, []);
    w.nesses.hurt(w, n, n.maxHp + 5, 'head');
    expect(n.mode).toBe('dead');
    run(w, 5, () => pin(w.player));
    expect(n.depth).toBe(0);
    expect(n.neck.state).toBe('rest');
    expect(Math.hypot(n.motion.vx, n.motion.vy)).toBeLessThan(0.3);
    expect(w.nessOutcomes()).toHaveLength(1);
    run(w, 2, () => pin(w.player));
    expect(w.result?.winner).toBe('player');
  });

  test('dying cancels a bite that was coming', () => {
    const t = quiet(defaultTuning());
    const { w, n, hold } = alongside(t);
    run(w, 0.3, hold);
    expect(w.zones.pending(w.player).length).toBe(1);
    w.nesses.hurt(w, n, n.maxHp + 1, 'body');
    expect(w.zones.pending(w.player)).toHaveLength(0);
  });
});

describe('the depth gun and its charges', () => {
  /** A boat with its first gun swapped for a depth gun, crewed, and a deep shadow in its arc. */
  function depthGun(t: Tuning, depth = 0.8): { w: World; n: Ness; gun: Boat['guns'][number] } {
    const { w, n } = setup(t);
    n.circleFor = 1e9;
    const gun = w.player.guns.find((g) => g.face > 0)!;
    gun.item = 'depthCharge';
    gun.mode = 'depth';
    for (const l of w.player.crew.lees) l.job = 'fire';
    // Off the starboard beam, close, deep.
    Object.assign(n.motion, { x: 22, y: 0, vx: 0, vy: 0, heading: -Math.PI / 2 });
    n.depth = depth;
    n.depthTarget = depth;
    return { w, n, gun };
  }

  test('it is a crewed gun: a gunner at it fires charges at a shadow in its arc, and not at nothing', () => {
    const t = quiet(defaultTuning());
    t.ness.kinds.ness.speedMul = 0.01;
    t.ness.kinds.ness.minSpeed = 0.01;
    const { w, n } = depthGun(t);
    let fired = 0;
    run(w, 12, () => {
      pin(w.player);
      Object.assign(n.motion, { x: 22, y: 0, vx: 0, vy: 0 });
      n.depth = 0.8;
      for (const e of w.drainEvents()) if (e.type === 'fire') fired++;
    });
    expect(fired).toBeGreaterThan(0);
    expect(w.stats.player.shellsFired).toBeGreaterThan(0);
  });

  test('it does not fire at a Ness that is up, nor at a ship', () => {
    const t = quiet(defaultTuning());
    const { w, n } = depthGun(t, 0);
    let fired = 0;
    run(w, 8, () => {
      pin(w.player);
      Object.assign(n.motion, { x: 22, y: 0, vx: 0, vy: 0 });
      n.depth = 0;
      for (const e of w.drainEvents()) if (e.type === 'fire' && e.gun === 'depthCharge') fired++;
    });
    expect(fired).toBe(0);
  });

  test('a charge sinks (it has a depth like a Ness), then goes off when its time is up and hurts what is under the water in its blast', () => {
    const t = quiet(defaultTuning());
    const { w, n } = setup(t, []);
    n.circleFor = 1e9;
    Object.assign(n.motion, { x: 200, y: 200 });
    n.depth = 0.8;
    n.depthTarget = 0.8;
    const c = { id: 1, pos: { x: 200, y: 200 }, depth: 0, age: 0, sink: 3, fuse: 4, radius: 11, trigger: 0.1, damage: 30, side: 'player' as const };
    w.charges.push(c);
    run(w, 1, () => {
      Object.assign(n.motion, { x: 200, y: 200, vx: 0, vy: 0 });
    });
    expect(c.depth).toBeGreaterThan(0.2);
    expect(c.depth).toBeLessThan(1);
    run(w, 4, () => Object.assign(n.motion, { x: 200, y: 200, vx: 0, vy: 0 }));
    expect(n.hp).toBeLessThan(n.maxHp);
    expect(w.charges).toHaveLength(0);
    expect(w.events.some((e) => e.type === 'chargeBlast')).toBe(true);
  });

  test('a Ness that swims into it sets it off at once; one at the wrong depth swims over it', () => {
    const t = quiet(defaultTuning());
    const { w, n } = setup(t, []);
    n.circleFor = 1e9;
    Object.assign(n.motion, { x: 300, y: 300 });
    n.depth = 0.6;
    n.depthTarget = 0.6;
    const c = { id: 1, pos: { x: 300, y: 300 }, depth: 0.55, age: 2, sink: 3, fuse: 30, radius: 11, trigger: 3, damage: 20, side: 'player' as const };
    w.charges.push(c);
    run(w, 0.1, () => Object.assign(n.motion, { x: 300, y: 300, vx: 0, vy: 0 }));
    expect(w.charges).toHaveLength(0);
    expect(n.hp).toBeLessThan(n.maxHp);

    // Too shallow to touch a charge that has sunk deep.
    const t2 = quiet(defaultTuning());
    const b = setup(t2, []);
    b.n.circleFor = 1e9;
    Object.assign(b.n.motion, { x: 300, y: 300 });
    b.n.depth = 0.05;
    b.n.depthTarget = 0.05;
    b.w.charges.push({ id: 1, pos: { x: 300, y: 300 }, depth: 0.95, age: 3, sink: 3, fuse: 30, radius: 11, trigger: 3, damage: 20, side: 'player' });
    run(b.w, 0.2, () => Object.assign(b.n.motion, { x: 300, y: 300, vx: 0, vy: 0 }));
    expect(b.w.charges).toHaveLength(1);
  });

  test('a charge does nothing to a Ness that is up', () => {
    const t = quiet(defaultTuning());
    const { w, n } = setup(t, []);
    n.circleFor = 1e9;
    Object.assign(n.motion, { x: 300, y: 300 });
    n.depth = 0;
    n.depthTarget = 0;
    w.charges.push({ id: 1, pos: { x: 300, y: 300 }, depth: 0.3, age: 1, sink: 3, fuse: 0.05, radius: 11, trigger: 3, damage: 20, side: 'player' });
    run(w, 0.3, () => Object.assign(n.motion, { x: 300, y: 300, vx: 0, vy: 0 }));
    expect(n.hp).toBe(n.maxHp);
  });
});

describe('it is solid on the surface', () => {
  test('it cannot overlap a hull: it shoves off and the boat is shoved too', () => {
    const t = quiet(defaultTuning());
    const { w, n } = alongside(t, []);
    Object.assign(n.motion, { x: -3, y: 0 });
    run(w, 1, () => undefined);
    expect(bodyGap(n, w.player).gap).toBeGreaterThanOrEqual(-0.6);
  });

  test('its oval is where shots land', () => {
    const t = quiet(defaultTuning());
    const { n } = setup(t, []);
    expect(ovalGap(n, { x: n.motion.x, y: n.motion.y })).toBeLessThan(0);
    expect(ovalGap(n, { x: n.motion.x + 100, y: n.motion.y })).toBeGreaterThan(50);
  });
});

describe('levels', () => {
  test('a higher level has more HP', () => {
    const t = quiet(defaultTuning());
    const rng = new Rng(1);
    const a = createNess(2, { kind: 'ness', level: 1 }, t, { x: 0, y: 0 }, 0, rng);
    const b = createNess(3, { kind: 'ness', level: 3 }, t, { x: 0, y: 0 }, 0, rng);
    expect(b.maxHp).toBeCloseTo(a.maxHp * (1 + 2 * t.ness.common.levelScale), 5);
  });
});
