// Close combat (Phase 3, reworked in Phase 5): minimum range, close contact
// (boats never lock together), ramming without a bounce, firing rules, who
// boards (only ⚔️ Lees), when they come back, stranding, RETREAT, melee,
// pistols, enemy types.

import { beforeEach, describe, expect, test } from 'vitest';
import { LAYOUTS, SLOOP } from '../src/config/boats';
import { ARCHETYPES } from '../src/config/encounters';
import type { Job } from '../src/config/lees';
import { SHIPS } from '../src/config/ships';
import { defaultTuning, type Tuning } from '../src/config/tuning';
import { createBoat, gunSpec, isDerelict, type Boat } from '../src/sim/boat';
import { updateEngagement, stepMelee } from '../src/sim/combat';
import { hullGap } from '../src/sim/contact';
import { activity, taskKey, type Lee } from '../src/sim/crew';
import { buildGrid, tileAtCell } from '../src/sim/grid';
import { defaultBuild, type BoatBuild } from '../src/sim/loadout';
import { dist, pointInPolygon, Rng, type Vec } from '../src/sim/math';
import { archetypeSetup, autoArrange, type BoatSetup, type CrewSpec } from '../src/sim/setup';
import { FIXED_DT } from '../src/sim/steering';
import { World } from '../src/sim/world';

const grid = createBoat(0, 'player', defaultBuild('basic'), defaultTuning(), { x: 0, y: 0 }, 0).grid;

/** Enemy crew size override per archetype for the current test (undefined = the archetype's own crew). */
let size: Record<string, number | undefined> = {};
/** Starting job of enemy Lees for the current test (undefined = from their tiles). */
let enemyJob: Job | undefined;
beforeEach(() => {
  size = {};
  enemyJob = undefined;
});

/** Enemy boats by archetype ('standard' Sloop, 'boarder' Friend Ship, 'heavy' Hard Ship), Basic Lees if a size is set. */
function enemies(t: Tuning, types: string[], build?: (type: string) => BoatBuild): BoatSetup[] {
  return types.map((type, i) => {
    const n = size[type];
    if (n === undefined && !build) {
      const s = archetypeSetup(type, t, i + 1);
      if (enemyJob) for (const c of s.crew) c.job = enemyJob;
      return s;
    }
    const arch = ARCHETYPES[type];
    const b = build?.(type) ?? defaultBuild(arch.ship);
    const crew: CrewSpec[] = Array.from({ length: n ?? 0 }, () => ({ type: 'basic', home: null as number | null, job: enemyJob }));
    autoArrange(b, crew, t).forEach((h, k) => (crew[k].home = h));
    return { build: b, crew, ai: { ...t.ai[arch.ai] } };
  });
}
const tile = (col: number, row: number) => tileAtCell(grid, col, row)!.index;
const T = {
  portCannon2: tile(3, 0),
  starCannon2: tile(3, 2),
  portOars: tile(0, 0),
  sails: tile(2, 1),
  midDeck: tile(1, 1),
};

/** Your crew: Basic Lees on these tiles; [tile, job] pairs set a starting job. */
type Place = number | [number, Job];
const crewOf = (places: Place[]): CrewSpec[] => places.map((p) => (Array.isArray(p) ? { type: 'basic', home: p[0], job: p[1] } : { type: 'basic', home: p }));

function quiet(t: Tuning): Tuning {
  t.boat.flooding.bilgeRate = 0;
  t.boat.flooding.leakRate = 0;
  // Keep enemy boarders from re-ordering their crew mid-test unless a test wants it.
  return t;
}

/** Pin a boat at a spot, heading north, not moving. */
function pin(_w: World, b: Boat, at: Vec): void {
  Object.assign(b.motion, { x: at.x, y: at.y, heading: -Math.PI / 2, vx: 0, vy: 0, omega: 0 });
  b.target = null;
}

const run = (w: World, seconds: number, each?: () => void) => {
  for (let i = 0; i < seconds / FIXED_DT; i++) {
    each?.();
    w.step(FIXED_DT);
  }
};

/** Side by side on your port side, as the BOARD autopilot would leave you. */
const besideAt = (t: Tuning, e: Boat): Vec => ({ x: -(SLOOP.beam / 2 + e.layout.beam / 2 + t.attach.alongsideGap), y: 0 });

/** A world with the player at the origin (bow north) and enemy 0 alongside on its port side; `hold` keeps everyone pinned. */
function alongside(t: Tuning, crew: Place[], types: string[], others: Vec[] = []) {
  const w = new World(t, 5, { enemies: enemies(t, types), player: { build: defaultBuild('basic'), crew: crewOf(crew) } });
  w.start();
  const e = w.enemies[0];
  const hold = () => {
    pin(w, w.player, { x: 0, y: 0 });
    pin(w, e, besideAt(t, e));
    w.enemies.slice(1).forEach((o, i) => pin(w, o, others[i] ?? { x: 0, y: -400 }));
  };
  hold();
  return { w, e, hold };
}

const mine = (w: World, n: number): Lee => w.player.crew.lees.find((l) => l.number === n)!;

describe('minimum cannon range', () => {
  test('a gun with the target in arc fires beyond the minimum range but not inside it', () => {
    const t = quiet(defaultTuning());
    size.standard = 0;
    for (const [x, fires] of [[-80, true], [-20, false]] as const) {
      const w = new World(t, 1, { enemies: enemies(t, ['standard']), crew: [T.portCannon2] });
      w.start();
      run(w, 8, () => {
        pin(w, w.player, { x: 0, y: 0 });
        pin(w, w.enemies[0], { x, y: 0 });
      });
      expect(w.stats.player.shellsFired > 0).toBe(fires);
    }
  });

  test('minimum range comes from the gun: long guns and mortars can\'t hit close, carronades can', () => {
    const t = defaultTuning();
    const b = createBoat(1, 'enemy', { ship: 'hard', loadout: { 'fix:1,0': 'cannon', 'fix:2,0': 'carronade', 'fix:3,0': 'longGun', 'fix:1,1': 'mortar' } }, t, { x: 0, y: 0 }, 0);
    const min = (item: string) => gunSpec(b, b.guns.find((g) => g.item === item)!, t).minRange;
    expect(min('longGun')).toBeGreaterThan(min('cannon'));
    expect(min('mortar')).toBeGreaterThan(min('longGun'));
    expect(min('carronade')).toBeLessThan(min('cannon'));
  });
});

describe('close contact (boats never lock together)', () => {
  test('two opposing boats within boarding range are in close combat; it ends once they open past range + slack', () => {
    const t = quiet(defaultTuning());
    size.standard = 0;
    const w = new World(t, 1, { enemies: enemies(t, ['standard']), crew: [] });
    w.start();
    const e = w.enemies[0];
    // Two Sloops side by side: hull gap = center distance − beam.
    const at = (gap: number) =>
      run(w, 0.3, () => {
        pin(w, w.player, { x: 0, y: 0 });
        pin(w, e, { x: -(SLOOP.beam + gap), y: 0 });
      });
    at(t.boarding.range - 1);
    expect(hullGap(w.player, e).gap).toBeCloseTo(t.boarding.range - 1);
    expect(w.inContact(w.player)).toBe(true);
    expect(w.drainEvents().some((ev) => ev.type === 'contact')).toBe(true);
    at(t.boarding.range + t.boarding.rangeSlack / 2);
    expect(w.inContact(w.player)).toBe(true);
    at(t.boarding.range + t.boarding.rangeSlack + 1);
    expect(w.inContact(w.player)).toBe(false);
  });

  test('in close combat you can still sail away: nothing holds the boats together', () => {
    const t = quiet(defaultTuning());
    size.standard = 0;
    const { w, e } = alongside(t, [], ['standard']);
    run(w, 0.2);
    expect(w.inContact(w.player)).toBe(true);
    w.setHelm({ kind: 'heading', h: 0 }); // east, away from the enemy on your port (west)
    run(w, 10, () => pin(w, e, besideAt(t, e)));
    expect(w.inContact(w.player)).toBe(false);
    expect(dist(w.player.motion, e.motion)).toBeGreaterThan(40);
  });

  test('same-side boats never come into contact', () => {
    const t = quiet(defaultTuning());
    const w = new World(t, 1, { enemies: enemies(t, ['standard', 'standard']), crew: [] });
    w.start();
    run(w, 4, () => {
      pin(w, w.enemies[0], { x: 0, y: -300 });
      pin(w, w.enemies[1], { x: -12, y: -300 });
      pin(w, w.player, { x: 0, y: 200 });
    });
    expect(w.contacts.contacts).toHaveLength(0);
  });
});

describe('ramming', () => {
  /** Enemy coming at your starboard side, square on, at `speed` (until it hits). */
  function ramWorld(t: Tuning, speed: number, heading = Math.PI) {
    size.standard = 0;
    const w = new World(t, 1, { enemies: enemies(t, ['standard']), crew: [] });
    w.start();
    const e = w.enemies[0];
    Object.assign(w.player.motion, { x: 0, y: 0, heading: -Math.PI / 2, vx: 0, vy: 0, omega: 0 });
    Object.assign(e.motion, { x: 40, y: 0, heading, vx: Math.cos(heading) * speed, vy: Math.sin(heading) * speed, omega: 0 });
    const hold = () => {
      pin(w, w.player, { x: 0, y: 0 });
      if (w.stats.player.ramsTaken || w.inContact(e)) return;
      e.target = null;
      e.motion.vx = Math.cos(heading) * speed;
      e.motion.vy = Math.sin(heading) * speed;
      e.motion.heading = heading;
      e.motion.omega = 0;
    };
    return { w, e, hold };
  }

  test('a fast bow-first hit, telegraphed with a red X first, rams: both boats take damage, and no bounce', () => {
    const t = quiet(defaultTuning());
    const { w, e, hold } = ramWorld(t, 12);
    let warned = false;
    let bounced = false;
    run(w, 5, () => {
      hold();
      if (w.contacts.warnings.some((x) => x.targetId === w.player.id && !x.byPlayer)) warned = true;
      // Right after the hit: moving apart would be a bounce.
      if (w.stats.player.ramsTaken && !bounced) {
        const rel = (e.motion.vx - w.player.motion.vx) * (e.motion.x - w.player.motion.x) + (e.motion.vy - w.player.motion.vy) * (e.motion.y - w.player.motion.y);
        if (rel > 1) bounced = true;
      }
    });
    expect(warned).toBe(true);
    expect(bounced).toBe(false);
    expect(w.stats.enemy.ramsDone).toBe(1);
    expect(w.stats.player.ramsTaken).toBe(1);
    expect(w.stats.player.ramTaken).toBeGreaterThan(0);
    expect(e.parts.find((p) => p.def.role === 'bow')!.layers[0].hp).toBeLessThan(e.parts.find((p) => p.def.role === 'bow')!.layers[0].maxHp);
  });

  test('your ram holds: the autopilot keeps your nose in, so you stay in close combat until somebody sails off', () => {
    const t = quiet(defaultTuning());
    size.standard = 0;
    const w = new World(t, 1, { enemies: enemies(t, ['standard']), crew: [] });
    w.start();
    const e = w.enemies[0];
    Object.assign(w.player.motion, { x: 0, y: 60, heading: -Math.PI / 2, vx: 0, vy: -12, omega: 0 });
    pin(w, e, { x: 0, y: 0 });
    e.motion.heading = 0; // broadside on to you
    w.setHelm({ kind: 'heading', h: -Math.PI / 2 });
    run(w, 8, () => {
      Object.assign(e.motion, { x: 0, y: 0, heading: 0, vx: 0, vy: 0, omega: 0 });
      e.target = null;
    });
    expect(w.stats.player.ramsDone).toBe(1);
    expect(w.helm).toMatchObject({ kind: 'ram', hold: true, boatId: e.id });
    expect(w.inContact(w.player)).toBe(true);
    expect(w.meleeMode()).toBe('charge');
  });

  test('no ramming by surprise: without enough warning the contact is just a bump', () => {
    const t = quiet(defaultTuning());
    t.attach.ramMinWarning = 99;
    const { w, hold } = ramWorld(t, 12);
    run(w, 5, hold);
    expect(w.stats.player.ramsTaken).toBe(0);
  });

  test('slow contact is not a ram', () => {
    const t = quiet(defaultTuning());
    const { w, hold } = ramWorld(t, 2.5);
    run(w, 14, hold);
    expect(w.stats.player.ramsTaken).toBe(0);
  });

  test('a glancing side-swipe is not a ram', () => {
    const t = quiet(defaultTuning());
    size.standard = 0;
    const w = new World(t, 1, { enemies: enemies(t, ['standard']), crew: [] });
    w.start();
    const e = w.enemies[0];
    run(w, 6, () => {
      pin(w, w.player, { x: 0, y: 0 });
      if (w.time < 1e-9) Object.assign(e.motion, { x: -9, y: -60, heading: Math.PI / 2 + 0.08 });
      e.target = null;
      e.motion.vx = Math.cos(e.motion.heading) * 12;
      e.motion.vy = Math.sin(e.motion.heading) * 12;
      e.motion.omega = 0;
    });
    expect(w.stats.player.ramsTaken).toBe(0);
  });
});

describe('firing rules', () => {
  test('nobody shells a boat in close combat with their side, either way; everyone else is fair game', () => {
    const t = quiet(defaultTuning());
    size.standard = 1;
    const { w, e, hold } = alongside(t, [T.starCannon2, [T.midDeck, 'board']], ['standard', 'standard'], [{ x: 80, y: 0 }]);
    run(w, 0.1, hold);
    const other = w.enemies[1];
    expect(w.inContact(e)).toBe(true);
    expect(w.gunTargets(w.player)).not.toContain(e);
    expect(w.gunTargets(w.player)).toContain(other);
    // Neither the boat alongside you nor its friend further out shells you.
    expect(w.gunTargets(e)).not.toContain(w.player);
    expect(w.gunTargets(other)).not.toContain(w.player);
  });

  test('nobody shells a deck their own boarders are on, even after the boats drift apart', () => {
    const t = quiet(defaultTuning());
    size.standard = 1;
    const { w, e, hold } = alongside(t, [[T.midDeck, 'board']], ['standard']);
    run(w, 4, hold);
    expect(w.player.crew.lees.some((l) => l.deck === e)).toBe(true);
    pin(w, e, { x: 0, y: -200 });
    run(w, 0.1, () => pin(w, e, { x: 0, y: -200 }));
    expect(w.inContact(e)).toBe(false);
    expect(w.gunTargets(w.player)).not.toContain(e);
  });
});

describe('boarding: only ⚔️ Lees go', () => {
  test('alongside an enemy, ⚔️ Lees swing across; the gunner keeps shooting and the rower keeps rowing', () => {
    const t = quiet(defaultTuning());
    size.heavy = 0;
    const crew: Place[] = [T.starCannon2, T.portOars, [T.sails, 'board'], [T.midDeck, 'board']];
    const { w, e, hold } = alongside(t, crew, ['standard', 'heavy'], [{ x: 90, y: 0 }]);
    run(w, 4, hold);
    expect(mine(w, 1).task).toEqual({ type: 'station', target: T.starCannon2 });
    expect(mine(w, 1).deck).toBe(w.player);
    expect(mine(w, 2).task).toEqual({ type: 'station', target: T.portOars });
    for (const n of [3, 4]) {
      const l = mine(w, n);
      expect(l.deck === e || l.swing !== null || !l.alive || l.stats.boardings > 0).toBe(true);
    }
    const why = w.player.crew.lees.filter((l) => l.stats.boardings > 0).map((l) => l.whyBoarded);
    expect(why.length).toBeGreaterThan(0);
    for (const y of why) expect(y).toMatch(/Board Basic Ship #1/);
  });

  test('out of reach, the boarding party gathers on the side facing the target and waits', () => {
    const t = quiet(defaultTuning());
    size.standard = 2;
    const w = new World(t, 5, { enemies: enemies(t, ['standard']), player: { build: defaultBuild('basic'), crew: crewOf([[tile(3, 2), 'board'], [tile(4, 2), 'board']]) } });
    w.start();
    const e = w.enemies[0];
    w.boardTargetId = e.id;
    run(w, 4, () => {
      pin(w, w.player, { x: 0, y: 0 });
      pin(w, e, { x: -60, y: 0 }); // west = your port side
    });
    expect(w.stats.player.boardings).toBe(0);
    for (const l of w.player.crew.lees) {
      expect(l.task.type).toBe('stage');
      expect(w.player.grid.tiles[l.dest].edges).toContain('port');
    }
  });

  test('a fixer bailing a dangerous flood keeps bailing', () => {
    const t = quiet(defaultTuning());
    const { w, hold } = alongside(t, [T.midDeck, [T.portCannon2, 'board']], ['standard']);
    const mid = w.player.parts.find((p) => p.def.id === 'midship')!;
    run(w, 3, () => {
      hold();
      mid.water = mid.capacity * 0.8;
    });
    expect(mine(w, 1).task.type).toBe('bail');
    expect(mine(w, 1).deck).toBe(w.player);
  });

  test('boarders swing home once the enemy deck is clear', () => {
    const t = quiet(defaultTuning());
    size.standard = 1;
    const crew: Place[] = [[T.portCannon2, 'board'], [T.portOars, 'board'], [T.sails, 'board'], T.midDeck];
    const { w, e, hold } = alongside(t, crew, ['standard', 'heavy'], [{ x: 0, y: -400 }]);
    let boarded = false;
    run(w, 25, () => {
      hold();
      if (w.player.crew.lees.some((l) => l.deck === e)) boarded = true;
    });
    expect(boarded).toBe(true);
    expect(w.stats.enemy.leesLost).toBe(1);
    expect(isDerelict(e)).toBe(true);
    for (const l of w.player.crew.lees.filter((x) => x.alive)) expect(l.deck).toBe(w.player);
  });

  test('boarders leave a deck that is about to sink', () => {
    const t = quiet(defaultTuning());
    size.standard = 4;
    const { w, e, hold } = alongside(t, [[T.portCannon2, 'board'], [T.portOars, 'board'], [T.sails, 'board']], ['standard']);
    run(w, 4, hold);
    expect(w.player.crew.lees.some((l) => l.deck === e || l.swing)).toBe(true);
    const fill = (f: number) => {
      const line = t.boat.flooding.sinkThreshold;
      for (const p of e.parts) p.water = p.capacity * line * f;
    };
    w.drainEvents();
    run(w, 3, () => {
      hold();
      fill(0.95);
    });
    for (const l of w.player.crew.lees.filter((x) => x.alive)) expect(l.deck).toBe(w.player);
    expect(w.drainEvents().some((ev) => ev.type === 'swing' && ev.back)).toBe(true);
    expect(e.sinkingSince).toBeNull();
  });

  test('stranded: when the enemy sails off, your boarders keep fighting over there, and jump home when you come back', () => {
    const t = quiet(defaultTuning());
    size.standard = 3;
    const { w, e, hold } = alongside(t, [[T.portCannon2, 'board'], [T.portOars, 'board']], ['standard']);
    run(w, 3, hold);
    expect(w.player.crew.lees.some((l) => l.deck === e)).toBe(true);
    // The enemy pulls 40 m away: out of reach.
    run(w, 3, () => {
      pin(w, w.player, { x: 0, y: 0 });
      pin(w, e, { x: -60, y: 0 });
    });
    const across = w.player.crew.lees.filter((l) => l.alive && l.deck === e);
    expect(across.length).toBeGreaterThan(0);
    // Call them back: out of reach, they stay (stranded) and keep fighting.
    for (const l of across) l.job = 'fix';
    run(w, 1, () => {
      pin(w, w.player, { x: 0, y: 0 });
      pin(w, e, { x: -60, y: 0 });
    });
    for (const l of across.filter((x) => x.alive)) {
      expect(l.deck).toBe(e);
      expect(l.reason).toMatch(/stranded/);
    }
    // Back alongside: they jump home.
    run(w, 4, hold);
    for (const l of across.filter((x) => x.alive)) expect(l.deck).toBe(w.player);
  });

  test('RETREAT: your boat waits beside your boarders until they are home, then sails away; their boarders stay and fight', () => {
    const t = quiet(defaultTuning());
    size.standard = 4;
    enemyJob = 'board';
    const { w, e, hold } = alongside(t, [[T.portCannon2, 'board'], [T.portOars, 'board'], T.sails], ['standard']);
    run(w, 6, hold);
    expect(w.canRetreat()).toBe(true);
    const theirsOnUs = () => e.crew.lees.filter((l) => l.alive && (l.deck === w.player || l.swing?.to === w.player)).length;
    const theirsBefore = theirsOnUs();
    w.retreat();
    expect(w.stats.player.retreats).toBe(1);
    // Hold the enemy still; your boat steers itself.
    let leftAt = -1;
    run(w, 25, () => {
      pin(w, e, besideAt(t, e));
      if (leftAt < 0 && !w.inContact(w.player)) leftAt = w.time;
    });
    expect(leftAt).toBeGreaterThan(0);
    for (const l of w.player.crew.lees.filter((x) => x.alive)) expect(l.deck).toBe(w.player);
    if (theirsBefore > 0) expect(e.crew.lees.some((l) => l.alive && l.deck === w.player) || w.stats.enemy.leesLost > 0).toBe(true);
  });

  test('no more than tileCap Lees ever stand on one tile', () => {
    const t = quiet(defaultTuning());
    size.standard = 6;
    enemyJob = 'board';
    const crew: Place[] = [[T.portCannon2, 'board'], [T.portOars, 'board'], T.sails, T.midDeck, T.starCannon2, [tile(2, 0), 'board']];
    const { w, hold } = alongside(t, crew, ['standard']);
    let worst = 0;
    run(w, 25, () => {
      hold();
      const count = new Map<string, number>();
      for (const l of w.allLees()) {
        if (!l.alive || l.swing || l.path.length) continue;
        const k = `${l.deck.id}:${l.tile}`;
        count.set(k, (count.get(k) ?? 0) + 1);
      }
      for (const n of count.values()) worst = Math.max(worst, n);
    });
    expect(worst).toBeLessThanOrEqual(t.boarding.tileCap);
  });

  test('a wounded Lee falls back and shoots instead of sword-fighting', () => {
    const t = quiet(defaultTuning());
    size.standard = 1;
    const { w, e, hold } = alongside(t, [T.midDeck], ['standard', 'heavy'], [{ x: 0, y: -400 }]);
    const me = mine(w, 1);
    const foe = e.crew.lees[0];
    Object.assign(foe, { deck: w.player, tile: me.tile, pos: { ...me.pos }, path: [], dest: me.tile, job: 'board' });
    me.hp = me.maxHp * 0.2;
    run(w, 3, hold);
    expect(me.retreating || !me.alive).toBe(true);
    expect(me.engaged).toBe(false);
    expect(me.stats.meleeDealt).toBe(0);
    expect(me.stats.pistolShots).toBeGreaterThan(0);
  });

  test('idle Lees go after boarders by their strengths: a Hard Lee charges, a Quick Lee shoots from a tile away', () => {
    const t = quiet(defaultTuning());
    size.standard = 1;
    const w = new World(t, 5, {
      enemies: enemies(t, ['standard']),
      player: { build: defaultBuild('basic'), crew: [{ type: 'hard', home: tile(4, 2) }, { type: 'quick', home: tile(4, 0) }] },
    });
    w.start();
    const e = w.enemies[0];
    const foe = e.crew.lees[0];
    foe.job = 'fix'; // the boarder just stands there
    const at = tile(1, 1);
    Object.assign(foe, { deck: w.player, tile: at, pos: { ...w.player.grid.tiles[at].center }, path: [], dest: at });
    const [hard, quick] = w.player.crew.lees;
    run(w, 2, () => {
      pin(w, w.player, { x: 0, y: 0 });
      pin(w, e, { x: 0, y: -400 });
    });
    expect(hard.task).toEqual({ type: 'repel', target: foe.id });
    expect(hard.engaged || hard.dest === at).toBe(true);
    expect(quick.task.type).not.toBe('repel');
    expect(quick.stats.pistolShots).toBeGreaterThan(0);
  });

  test('boarders cross one at a time', () => {
    const t = quiet(defaultTuning());
    size.standard = 4;
    t.boarding.swingInterval = 1;
    const crew: Place[] = [[T.portCannon2, 'board'], [T.portOars, 'board'], [T.sails, 'board'], [T.midDeck, 'board']];
    const { w, hold } = alongside(t, crew, ['standard']);
    const starts: number[] = [];
    run(w, 8, () => {
      hold();
      for (const l of w.player.crew.lees) if (l.swing && !l.swing.back && l.swing.t === 0) starts.push(w.time);
    });
    starts.sort((a, b) => a - b);
    for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(1 - 1e-6);
  });

  test('crews do not swing across and back over and over', () => {
    const t = defaultTuning();
    const w = new World(t, 9, { encounter: ['boarder'] });
    w.start();
    run(w, 150, () => (w.player.target = { x: w.player.motion.x + 20, y: w.player.motion.y - 100 }));
    expect(w.stats.enemy.boardings + w.stats.player.boardings).toBeGreaterThan(0);
    for (const l of w.allLees()) expect(l.stats.boardings).toBeLessThanOrEqual(3);
  });
});

describe('melee and pistols', () => {
  test('swords never miss and go for the weakest opponent on the tile first (ties by id)', () => {
    const t = quiet(defaultTuning());
    size.standard = 2;
    const { w, e } = alongside(t, [T.midDeck], ['standard']);
    const me = mine(w, 1);
    const [a, b] = e.crew.lees;
    for (const x of [a, b]) {
      x.deck = w.player;
      x.tile = me.tile;
      x.pos = { ...me.pos };
    }
    b.hp = 10;
    updateEngagement(w.allLees());
    expect(me.engaged).toBe(true);
    expect(me.meleeTarget).toBe(b.id);
    b.hp = a.hp;
    updateEngagement(w.allLees());
    expect(me.meleeTarget).toBe(Math.min(a.id, b.id));
    const ctx = { tuning: t, time: 0, rng: new Rng(1), lees: w.allLees(), boats: w.boats };
    let hits = 0;
    for (let i = 0; i < 2 / FIXED_DT; i++) hits += stepMelee(ctx, FIXED_DT).filter((x) => x.type === 'melee' && x.attacker === me).length;
    expect(hits).toBe(Math.floor(2 * t.melee.rate + 0.5));
  });

  test('an engaged gunner stops loading', () => {
    const t = quiet(defaultTuning());
    size.standard = 1;
    const { w, e, hold } = alongside(t, [T.starCannon2], ['standard', 'heavy'], [{ x: 90, y: 0 }]);
    const gunner = mine(w, 1);
    run(w, 1.6, hold);
    const foe = e.crew.lees[0];
    const load0 = w.player.guns.find((c) => c.station === T.starCannon2)!.load;
    run(w, 1, () => {
      hold();
      Object.assign(foe, { deck: w.player, tile: gunner.tile, pos: { ...gunner.pos }, swing: null, path: [] });
    });
    expect(gunner.engaged).toBe(true);
    expect(activity(gunner)).toBe('melee');
    expect(w.player.guns.find((c) => c.station === T.starCannon2)!.load).toBeLessThanOrEqual(Math.max(load0, 0.0001) + 1e-9);
  });

  test('pistols only hurt opposing Lees, and only within range', () => {
    const t = quiet(defaultTuning());
    size.standard = 4;
    t.pistol.spread = 0;
    t.pistol.spreadPerMeter = 0;
    const { w, hold } = alongside(t, [T.starCannon2, T.midDeck], ['standard']);
    run(w, 3, hold);
    expect(w.stats.player.pistolShots + w.stats.enemy.pistolShots).toBeGreaterThan(0);
    expect(w.stats.player.pistolHits).toBe(w.stats.player.pistolShots); // no scatter: every shot hits
    const far = new World(t, 5, { enemies: enemies(t, ['standard']), crew: [T.midDeck] });
    far.start();
    run(far, 3, () => {
      pin(far, far.player, { x: 0, y: 0 });
      pin(far, far.enemies[0], { x: -60, y: 0 });
    });
    expect(far.stats.player.pistolShots + far.stats.enemy.pistolShots).toBe(0);
  });

  test('a boat with no living crew is out: nobody shells it, it drifts, and the fight goes on without it', () => {
    const t = quiet(defaultTuning());
    const w = new World(t, 2, { encounter: ['standard', 'standard'], crew: [T.portCannon2] });
    w.start();
    const [dead, alive] = w.enemies;
    for (const l of dead.crew.lees) {
      l.alive = false;
      l.hp = 0;
    }
    run(w, 6, () => {
      pin(w, w.player, { x: 0, y: 0 });
      pin(w, dead, { x: -80, y: 0 });
      pin(w, alive, { x: 0, y: -400 });
    });
    expect(isDerelict(dead)).toBe(true);
    expect(w.isOut(dead)).toBe(true);
    expect(dead.target).toBeNull();
    expect(dead.sinkingSince).toBeNull();
    expect(w.gunTargets(w.player)).not.toContain(dead);
    expect(w.stats.player.shellsFired).toBe(0);
    expect(w.liveEnemies()).toEqual([alive]);
    expect(w.result).toBeNull();
  });

  test('kill every enemy crew and you win; lose your whole crew and you lose', () => {
    const t = quiet(defaultTuning());
    const win = new World(t, 2, { encounter: ['standard', 'boarder'] });
    win.start();
    for (const e of win.enemies) for (const l of e.crew.lees) l.alive = false;
    run(win, 0.1);
    expect(win.result).toMatchObject({ winner: 'player', how: 'crew' });
    expect(win.enemies.every((e) => e.sinkingSince === null)).toBe(true);
    run(win, 3);
    expect(win.phase).toBe('over');

    const lose = new World(t, 2, { encounter: ['standard'] });
    lose.start();
    for (const l of lose.player.crew.lees) l.alive = false;
    run(lose, 0.1);
    expect(lose.result).toMatchObject({ winner: 'enemy', how: 'crew' });
  });

  test('the same seed gives the same boarding fight', () => {
    const fight = (seed: number) => {
      const w = new World(defaultTuning(), seed, { encounter: ['boarder'] });
      w.start();
      const log: string[] = [];
      run(w, 70, () => {
        w.player.target = { x: w.player.motion.x + 20, y: w.player.motion.y - 100 };
        if (Math.round(w.time / FIXED_DT) % 60 === 0) for (const l of w.allLees()) log.push(`${l.id}:${l.deck.id}:${l.job}:${taskKey(l.task)}:${Math.round(l.hp)}`);
      });
      return JSON.stringify([log, w.stats]);
    };
    expect(fight(21)).toBe(fight(21));
  });
});

describe('enemy ship types', () => {
  test('every layout is valid: tiles inside their parts, every slot on a tile or part of its ship', () => {
    for (const layout of LAYOUTS) {
      const g = buildGrid(layout);
      for (const t of g.tiles) expect(pointInPolygon(t.center, layout.parts[t.part].polygon)).toBe(true);
    }
    for (const ship of Object.values(SHIPS)) {
      const g = buildGrid(ship.layout);
      for (const slot of ship.slots) {
        if (slot.tile) {
          const tile = tileAtCell(g, slot.tile[0], slot.tile[1]);
          expect(tile).not.toBeNull();
          if (slot.type === 'edge' || slot.type === 'rail') expect(tile!.edges).toContain(slot.facing);
          if (slot.type === 'interior') expect(tile!.edges).toHaveLength(0);
        }
        if (slot.part) expect(ship.layout.parts.some((p) => p.id === slot.part)).toBe(true);
      }
      const fixtures = ship.slots.filter((s) => s.type === 'edge' || s.type === 'interior').map((s) => s.tile!.join(','));
      expect(new Set(fixtures).size).toBe(fixtures.length);
    }
  });

  test('each archetype sails its own ship, crew and AI, all from shared content', () => {
    const t = defaultTuning();
    const w = new World(t, 3, { encounter: ['standard', 'boarder', 'heavy'] });
    expect(w.enemies.map((e) => e.layout.id)).toEqual(['basic', 'friend', 'hard']);
    expect(w.enemies.map((e) => e.crew.lees.length)).toEqual([4, 6, 5]);
    const guns = (b: Boat) => b.guns.filter((c) => c.targets === 'hull').length;
    expect(guns(w.enemies[2])).toBeGreaterThan(guns(w.enemies[0]));
    expect(guns(w.enemies[1])).toBeLessThan(guns(w.enemies[0]));
    expect(w.enemies.map((e) => e.ai!.seekAttach)).toEqual([0, 1, 0]);
    expect(w.enemies[1].crew.lees.filter((l) => l.def.id === 'hard')).toHaveLength(2);
  });

  test('a Friend Ship closes in, moves Lees to ⚔️ with the same orders you give, and boards a boat sailing straight', () => {
    const w = new World(defaultTuning(), 4, { encounter: ['boarder'] });
    w.start();
    let contact = false;
    let ordered = 0;
    run(w, 90, () => {
      w.player.target = { x: w.player.motion.x + 20, y: w.player.motion.y - 100 };
      if (w.inContact(w.player)) contact = true;
      ordered = Math.max(ordered, w.enemies[0].crew.lees.filter((l) => l.alive && l.job === 'board').length);
    });
    expect(contact).toBe(true);
    expect(ordered).toBeGreaterThanOrEqual(3);
    expect(w.stats.enemy.boardings).toBeGreaterThan(0);
  });

  test('a Sloop or Hard Ship holds its range instead', () => {
    for (const type of ['standard', 'heavy']) {
      const w = new World(defaultTuning(), 4, { encounter: [type] });
      w.start();
      run(w, 40, () => (w.player.target = { x: w.player.motion.x + 20, y: w.player.motion.y - 100 }));
      expect(w.brains.get(w.enemies[0].id)!.mode).toBe('orbit');
    }
  });

  test('tapping an enemy targets it and the BOARD autopilot brings you alongside', () => {
    const t = defaultTuning();
    size.standard = 0;
    const w = new World(t, 4, { enemies: enemies(t, ['standard']), crew: [] });
    w.start();
    w.targetEnemy(w.enemies[0]);
    expect(['board', 'ram']).toContain(w.helm.kind);
    let contact = false;
    run(w, 90, () => {
      if (w.inContact(w.player)) contact = true;
    });
    expect(contact).toBe(true);
  });
});

describe('end of fight while boarded', () => {
  test('your boarders on the last enemy as it sinks make it home after the win', () => {
    const t = quiet(defaultTuning());
    size.standard = 4;
    const { w, e, hold } = alongside(t, [[T.portCannon2, 'board'], [T.portOars, 'board'], [T.sails, 'board']], ['standard']);
    run(w, 4, hold);
    expect(w.player.crew.lees.some((l) => l.deck === e)).toBe(true);
    for (const p of e.parts) p.water = p.capacity;
    run(w, t.global.sinkDuration + 0.5);
    expect(w.result?.winner).toBe('player');
    expect(w.stats.player.lostBy.sank).toBe(0);
    for (const l of w.player.crew.lees.filter((x) => x.alive)) expect(l.deck).toBe(w.player);
  });
});

describe('gatling guns', () => {
  test('a manned gatling shreds crew on an enemy deck in its arc but barely scratches the hull', () => {
    const t = quiet(defaultTuning());
    size.standard = 4;
    const gat = tile(1, 0);
    const w = new World(t, 3, {
      enemies: enemies(t, ['standard'], () => ({ ship: 'basic', loadout: {} })),
      player: { build: { ship: 'basic', loadout: { 'fix:1,0': 'gatling' } }, crew: [{ type: 'basic', home: gat }] },
    });
    w.start();
    const e = w.enemies[0];
    const hp0 = e.parts.reduce((a, p) => a + p.layers[0].hp, 0);
    run(w, 20, () => {
      pin(w, w.player, { x: 0, y: 0 });
      pin(w, e, { x: -40, y: 0 });
    });
    expect(mine(w, 1).task).toEqual({ type: 'station', target: gat });
    expect(w.stats.player.gatlingShots).toBeGreaterThan(20);
    expect(w.stats.player.gatlingHits).toBeGreaterThan(0);
    expect(w.stats.player.gatlingDealt).toBeGreaterThan(0);
    const lost = hp0 - e.parts.reduce((a, p) => a + p.layers[0].hp, 0);
    expect(lost).toBeLessThan(10);
  });

  test('a gatling never fires at its own deck', () => {
    const t = quiet(defaultTuning());
    size.standard = 0;
    const gat = tile(1, 0);
    const w = new World(t, 3, { enemies: enemies(t, ['standard']), player: { build: { ship: 'basic', loadout: { 'fix:1,0': 'gatling' } }, crew: [{ type: 'basic', home: gat }] } });
    w.start();
    run(w, 5, () => {
      pin(w, w.player, { x: 0, y: 0 });
      pin(w, w.enemies[0], { x: 0, y: -400 });
    });
    expect(w.stats.player.gatlingShots).toBe(0);
  });
});
