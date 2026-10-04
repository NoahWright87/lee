// Phase 3: minimum range, docking, ramming, firing rules while attached,
// boarding (who goes, when they come back), melee, pistols, enemy types.

import { describe, expect, test } from 'vitest';
import { LAYOUTS, SLOOP } from '../src/config/boats';
import { SHIP_TYPES } from '../src/config/ships';
import { defaultTuning, type Tuning } from '../src/config/tuning';
import { hullGap } from '../src/sim/attach';
import { isDerelict, type Boat } from '../src/sim/boat';
import { updateEngagement, stepMelee } from '../src/sim/combat';
import { activity, taskKey, type Lee } from '../src/sim/crew';
import { buildGrid, tileAtCell } from '../src/sim/grid';
import { dist, pointInPolygon, Rng, type Vec } from '../src/sim/math';
import { FIXED_DT } from '../src/sim/steering';
import { encounterFor, World, type CrewPlacement } from '../src/sim/world';

const grid = buildGrid(SLOOP);
const tile = (col: number, row: number) => tileAtCell(grid, col, row)!.index;
const T = {
  portCannon2: tile(3, 0),
  starCannon2: tile(3, 2),
  portOars: tile(0, 0),
  sails: tile(2, 1),
  midDeck: tile(1, 1),
};

function quiet(t: Tuning): Tuning {
  for (const b of [t.player, ...Object.values(t.ships)]) {
    b.flooding.bilgeRate = 0;
    b.flooding.leakRate = 0;
  }
  return t;
}

/** Pin a boat at a spot, heading north, not moving (unless it's attached to a group). */
function pin(w: World, b: Boat, at: Vec): void {
  if (w.isAttached(b)) return;
  Object.assign(b.motion, { x: at.x, y: at.y, heading: -Math.PI / 2, vx: 0, vy: 0, omega: 0 });
  b.target = null;
}

function ctxOf(w: World) {
  return { tuning: w.tuning, time: w.time, boats: w.boats, playerAlongside: null };
}

const run = (w: World, seconds: number, each?: () => void) => {
  for (let i = 0; i < seconds / FIXED_DT; i++) {
    each?.();
    w.step(FIXED_DT);
  }
};

/** A world with the player at the origin (bow north) and enemy 0 docked on its port side. */
function docked(t: Tuning, crew: CrewPlacement, types: string[], others: Vec[] = []) {
  const w = new World(t, 5, { encounter: types, crew });
  w.start();
  pin(w, w.player, { x: 0, y: 0 });
  const e = w.enemies[0];
  pin(w, e, { x: -(SLOOP.beam / 2 + e.layout.beam / 2 + t.attach.dockGap), y: 0 });
  w.links.dockNow(ctxOf(w), w.player, e);
  w.enemies.slice(1).forEach((o, i) => pin(w, o, others[i] ?? { x: 0, y: -400 }));
  const hold = () => {
    for (const b of w.boats) {
      if (w.isAttached(b)) {
        b.motion.vx = 0;
        b.motion.vy = 0;
      }
    }
    w.enemies.slice(1).forEach((o, i) => pin(w, o, others[i] ?? { x: 0, y: -400 }));
  };
  return { w, e, hold };
}

const mine = (w: World, n: number): Lee => w.player.crew.lees.find((l) => l.number === n)!;

describe('minimum cannon range', () => {
  test('a gun with the target in arc fires beyond the minimum range but not inside it', () => {
    const t = quiet(defaultTuning());
    t.ships.standard.crew.size = 0;
    for (const [x, fires] of [[-80, true], [-20, false]] as const) {
      const w = new World(t, 1, { enemies: 1, crew: [T.portCannon2] });
      w.start();
      run(w, 8, () => {
        pin(w, w.player, { x: 0, y: 0 });
        pin(w, w.enemies[0], { x, y: 0 });
      });
      expect(w.stats.player.shellsFired > 0).toBe(fires);
    }
  });

  test('the Hard Ship has the biggest minimum range', () => {
    const t = defaultTuning();
    expect(t.ships.heavy.cannons.minRange).toBeGreaterThan(t.ships.standard.cannons.minRange);
    expect(t.ships.heavy.cannons.minRange).toBeGreaterThan(t.player.cannons.minRange);
  });
});

describe('docking', () => {
  test('two opposing boats close and slow stick after the grapple time, side by side and not overlapping', () => {
    const t = quiet(defaultTuning());
    t.ships.standard.crew.size = 0;
    const w = new World(t, 1, { enemies: 1, crew: [] });
    w.start();
    const e = w.enemies[0];
    const near = { x: -(SLOOP.beam + 3), y: 0 };
    let attachedAt = -1;
    run(w, 3, () => {
      pin(w, w.player, { x: 0, y: 0 });
      pin(w, e, near);
      if (attachedAt < 0 && w.isAttached(e)) attachedAt = w.time;
    });
    expect(attachedAt).toBeGreaterThanOrEqual(t.attach.grappleTime - 0.05);
    const l = w.links.linkBetween(w.player, e)!;
    expect(l.kind).toBe('dock');
    expect(l.sideA).toBe('port');
    const gap = hullGap(w.player, e).gap;
    expect(gap).toBeGreaterThan(0);
    expect(gap).toBeLessThan(t.attach.dockDistance);
  });

  test('brushing past fast does not dock', () => {
    const t = quiet(defaultTuning());
    t.ships.standard.crew.size = 0;
    const w = new World(t, 1, { enemies: 1, crew: [] });
    w.start();
    const e = w.enemies[0];
    Object.assign(w.player.motion, { x: 0, y: 0, heading: -Math.PI / 2, vx: 0, vy: -12 });
    Object.assign(e.motion, { x: -12, y: -80, heading: Math.PI / 2, vx: 0, vy: 12 });
    run(w, 8, () => {
      w.player.target = null;
      e.target = null;
    });
    expect(w.links.links).toHaveLength(0);
  });

  test('same-side boats never attach', () => {
    const t = quiet(defaultTuning());
    const w = new World(t, 1, { enemies: 2, crew: [] });
    w.start();
    run(w, 4, () => {
      pin(w, w.enemies[0], { x: 0, y: -300 });
      pin(w, w.enemies[1], { x: -12, y: -300 });
      pin(w, w.player, { x: 0, y: 200 });
    });
    expect(w.links.links).toHaveLength(0);
  });

  test('attached boats ignore steering and drift together', () => {
    const t = quiet(defaultTuning());
    t.ships.standard.crew.size = 0;
    const { w, e } = docked(t, [], ['standard']);
    w.player.motion.vy = -10;
    const before = dist(w.player.motion, e.motion);
    run(w, 6, () => (w.player.target = { x: 500, y: 0 }));
    expect(Math.hypot(w.player.motion.vx, w.player.motion.vy)).toBeLessThanOrEqual(t.attach.driftSpeed + 0.5);
    expect(w.player.motion.heading).toBeCloseTo(-Math.PI / 2);
    expect(dist(w.player.motion, e.motion)).toBeCloseTo(before, 0);
  });
});

describe('ramming', () => {
  /** Enemy coming at your starboard side, square on, at `speed`. */
  function ramWorld(t: Tuning, speed: number, heading = Math.PI) {
    t.ships.standard.crew.size = 0;
    const w = new World(t, 1, { enemies: 1, crew: [] });
    w.start();
    const e = w.enemies[0];
    Object.assign(w.player.motion, { x: 0, y: 0, heading: -Math.PI / 2, vx: 0, vy: 0, omega: 0 });
    Object.assign(e.motion, { x: 40, y: 0, heading, vx: Math.cos(heading) * speed, vy: Math.sin(heading) * speed, omega: 0 });
    const hold = () => {
      if (w.isAttached(e)) return;
      pin(w, w.player, { x: 0, y: 0 });
      e.target = null;
      e.motion.vx = Math.cos(heading) * speed;
      e.motion.vy = Math.sin(heading) * speed;
      e.motion.heading = heading;
      e.motion.omega = 0;
    };
    return { w, e, hold };
  }

  test('a fast bow-first hit, telegraphed with a red X first, rams: both boats take damage and attach', () => {
    const t = quiet(defaultTuning());
    const { w, e, hold } = ramWorld(t, 12);
    let warned = false;
    run(w, 5, () => {
      hold();
      if (w.links.warnings.some((x) => x.kind === 'ram' && x.targetId === w.player.id && !x.byPlayer)) warned = true;
    });
    expect(warned).toBe(true);
    const l = w.links.linkBetween(w.player, e)!;
    expect(l.kind).toBe('ram');
    expect(l.a).toBe(e);
    expect(l.sideA).toBe('bow');
    expect(l.sideB).toBe('starboard');
    expect(w.stats.enemy.ramsDone).toBe(1);
    expect(w.stats.player.ramsTaken).toBe(1);
    expect(w.stats.player.ramTaken).toBeGreaterThan(0);
    expect(e.parts.find((p) => p.def.role === 'bow')!.layers[0].hp).toBeLessThan(e.parts.find((p) => p.def.role === 'bow')!.layers[0].maxHp);
  });

  test('no attachment by surprise: without enough warning the contact is just a bump', () => {
    const t = quiet(defaultTuning());
    t.attach.ramMinWarning = 99;
    const { w, hold } = ramWorld(t, 12);
    run(w, 5, hold);
    expect(w.links.links.filter((l) => l.kind === 'ram')).toHaveLength(0);
    expect(w.stats.player.ramsTaken).toBe(0);
  });

  test('slow contact is not a ram (it may dock instead)', () => {
    const t = quiet(defaultTuning());
    const { w, hold } = ramWorld(t, 2.5);
    run(w, 14, hold);
    expect(w.stats.player.ramsTaken).toBe(0);
  });

  test('a glancing side-swipe does not attach', () => {
    const t = quiet(defaultTuning());
    t.ships.standard.crew.size = 0;
    const w = new World(t, 1, { enemies: 1, crew: [] });
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
    expect(w.links.links.filter((l) => l.kind === 'ram')).toHaveLength(0);
  });
});

describe('firing rules while attached', () => {
  test('nobody shells a boat they are attached to, nor one attached to their ally; attached boats shoot outward', () => {
    const t = quiet(defaultTuning());
    // You docked to enemy 0 on your port; enemy 1 sits off your starboard beam.
    const { w, e, hold } = docked(t, [T.starCannon2, T.portCannon2], ['standard', 'standard'], [{ x: 80, y: 0 }]);
    run(w, 0.1, hold);
    const other = w.enemies[1];
    expect(w.gunTargets(w.player)).not.toContain(e);
    expect(w.gunTargets(w.player)).toContain(other);
    expect(w.gunTargets(e)).not.toContain(w.player);
    // Enemy 1 won't shell you while you're docked to its friend.
    expect(w.gunTargets(other)).not.toContain(w.player);
    run(w, 8, hold);
    expect(w.stats.player.shellsFired).toBeGreaterThan(0);
    expect(w.shells.every((s) => s.ownerSide === 'player')).toBe(true);
  });
});

describe('boarding: who goes and why', () => {
  test('docked on one side: gunners and rowers there go to fight, the gunner with a target keeps shooting', () => {
    const t = quiet(defaultTuning());
    t.ships.heavy.crew.size = 0;
    const crew = [T.starCannon2, T.portCannon2, T.portOars, T.sails];
    const { w, e, hold } = docked(t, crew, ['standard', 'heavy'], [{ x: 90, y: 0 }]);
    run(w, 4, hold);
    const star = mine(w, 1);
    expect(star.task).toEqual({ type: 'station', target: T.starCannon2 });
    const fighting = (l: Lee) => l.deck === e || l.swing !== null || ['board', 'repel'].includes(l.task.type) || l.engaged || !l.alive;
    // The port gunner leaves its useless gun: to fight, or to a starboard gun that can fire.
    const port = mine(w, 2);
    expect(port.task).not.toEqual({ type: 'station', target: T.portCannon2 });
    expect(fighting(port) || (port.task.type === 'station' && grid.tiles[port.task.target].label.startsWith('Starboard cannon'))).toBe(true);
    // Rower and sail hand have nothing to do while attached: they fight.
    for (const n of [3, 4]) expect(fighting(mine(w, n))).toBe(true);
    expect(w.stats.player.boardings).toBeGreaterThan(0);
    // "Why did that Lee swing across?" is answerable: its useless post, then the board decision.
    const why = w.player.crew.lees.filter((l) => l.stats.boardings > 0).map((l) => l.whyBoarded);
    expect(why.length).toBeGreaterThan(0);
    for (const y of why) expect(y).toMatch(/attached to Sloop #1.*→ Board Sloop #1/);
  });

  test('a Lee bailing a dangerous flood keeps bailing', () => {
    const t = quiet(defaultTuning());
    const { w, hold } = docked(t, [T.midDeck, T.portCannon2], ['standard']);
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
    t.ships.standard.crew.size = 1;
    // Their boarders all on your deck, a second (crewed, far) enemy keeps the fight going.
    const { w, e, hold } = docked(t, [T.portCannon2, T.portOars, T.sails, T.midDeck], ['standard', 'heavy'], [{ x: 0, y: -400 }]);
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
    t.ships.standard.crew.size = 4;
    const { w, e, hold } = docked(t, [T.portCannon2, T.portOars, T.sails], ['standard']);
    run(w, 4, hold);
    expect(w.player.crew.lees.some((l) => l.deck === e || l.swing)).toBe(true);
    // Flood the enemy to just past the evacuation threshold (but not the sink line).
    const fill = (f: number) => {
      const line = t.ships.standard.flooding.sinkThreshold;
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

  test('minimum home crew keeps that many aboard', () => {
    const t = quiet(defaultTuning());
    t.boarding.minHomeCrew = 2;
    t.ships.standard.crew.size = 4;
    const { w, hold } = docked(t, [T.portCannon2, T.portOars, T.sails, T.midDeck], ['standard']);
    let leastHome = 99;
    run(w, 6, () => {
      hold();
      const home = w.player.crew.lees.filter((l) => l.alive && l.deck === w.player && !l.swing && l.task.type !== 'board').length;
      leastHome = Math.min(leastHome, home);
    });
    expect(leastHome).toBeGreaterThanOrEqual(Math.min(2, w.player.crew.lees.filter((l) => l.alive).length));
  });

  test('disengage: boarders swing home in the recall window, then the link breaks and the boats push apart', () => {
    const t = quiet(defaultTuning());
    t.ships.standard.crew.size = 4;
    const { w, e, hold } = docked(t, [T.portCannon2, T.portOars, T.sails], ['standard']);
    run(w, 4, hold);
    expect(w.disengage(e)).toBe(true);
    expect(w.stats.player.disengages).toBe(1);
    run(w, t.attach.recallWindow - 0.1, hold);
    expect(w.isAttached(w.player)).toBe(true);
    run(w, 0.3);
    expect(w.isAttached(w.player)).toBe(false);
    for (const l of w.allLees().filter((x) => x.alive)) expect(l.deck).toBe(l.boat);
    // Pushed apart: moving away from each other.
    const rel = (e.motion.vx - w.player.motion.vx) * (e.motion.x - w.player.motion.x) + (e.motion.vy - w.player.motion.vy) * (e.motion.y - w.player.motion.y);
    expect(rel).toBeGreaterThan(0);
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
    t.ships.standard.crew.size = 2;
    const { w, e } = docked(t, [T.midDeck], ['standard']);
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
    t.ships.standard.crew.size = 1;
    const { w, e, hold } = docked(t, [T.starCannon2], ['standard', 'heavy'], [{ x: 90, y: 0 }]);
    const gunner = mine(w, 1);
    run(w, 1.6, hold);
    const foe = e.crew.lees[0];
    const load0 = w.player.cannons.find((c) => c.station === T.starCannon2)!.load;
    run(w, 1, () => {
      hold();
      Object.assign(foe, { deck: w.player, tile: gunner.tile, pos: { ...gunner.pos }, swing: null, path: [] });
    });
    expect(gunner.engaged).toBe(true);
    expect(activity(gunner)).toBe('melee');
    expect(w.player.cannons.find((c) => c.station === T.starCannon2)!.load).toBeLessThanOrEqual(Math.max(load0, 0.0001) + 1e-9);
  });

  test('pistols only hurt opposing Lees, and only within range', () => {
    const t = quiet(defaultTuning());
    t.ships.standard.crew.size = 4;
    t.pistol.spread = 0;
    t.pistol.spreadPerMeter = 0;
    const { w, hold } = docked(t, [T.starCannon2, T.midDeck], ['standard']);
    run(w, 3, hold);
    expect(w.stats.player.pistolShots + w.stats.enemy.pistolShots).toBeGreaterThan(0);
    expect(w.stats.player.pistolHits).toBe(w.stats.player.pistolShots); // no scatter: every shot hits
    // Out of range: nobody shoots.
    const far = new World(t, 5, { encounter: ['standard'], crew: [T.midDeck] });
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
      pin(w, dead, { x: -80, y: 0 }); // right in your port broadside
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

  test('an attached boat that loses its crew casts off', () => {
    const t = quiet(defaultTuning());
    const { w, e, hold } = docked(t, [T.portCannon2], ['standard', 'standard'], [{ x: 0, y: -400 }]);
    run(w, 0.5, hold);
    expect(w.isAttached(w.player)).toBe(true);
    for (const l of e.crew.lees) l.alive = false;
    run(w, t.attach.recallWindow + 0.3, hold);
    expect(w.isAttached(w.player)).toBe(false);
    expect(w.result).toBeNull(); // the other enemy still has its crew
  });

  test('the same seed gives the same boarding fight', () => {
    const fight = (seed: number) => {
      const w = new World(defaultTuning(), seed, { encounter: ['boarder'] });
      w.start();
      const log: string[] = [];
      run(w, 70, () => {
        w.player.target = { x: w.player.motion.x + 20, y: w.player.motion.y - 100 };
        if (Math.round(w.time / FIXED_DT) % 60 === 0) for (const l of w.allLees()) log.push(`${l.id}:${l.deck.id}:${taskKey(l.task)}:${Math.round(l.hp)}`);
      });
      return JSON.stringify([log, w.stats]);
    };
    expect(fight(21)).toBe(fight(21));
  });
});

describe('enemy ship types', () => {
  test('every layout is valid: tiles inside their parts, stations and crews in place', () => {
    for (const layout of LAYOUTS) {
      const g = buildGrid(layout);
      for (const t of g.tiles) expect(pointInPolygon(t.center, layout.parts[t.part].polygon)).toBe(true);
    }
    for (const def of Object.values(SHIP_TYPES)) {
      const g = buildGrid(def.layout);
      for (const [c, r] of def.crew.homes) expect(tileAtCell(g, c, r)).not.toBeNull();
    }
  });

  test('each type sails with its own layout, crew and tuning', () => {
    const t = defaultTuning();
    const w = new World(t, 3, { encounter: ['standard', 'boarder', 'heavy'] });
    expect(w.enemies.map((e) => e.layout.id)).toEqual(['sloop', 'friendship', 'hardship']);
    expect(w.enemies.map((e) => e.crew.lees.length)).toEqual([t.ships.standard.crew.size, t.ships.boarder.crew.size, t.ships.heavy.crew.size]);
    expect(w.enemies[2].cannons.length).toBeGreaterThan(w.enemies[0].cannons.length);
    expect(w.enemies[1].cannons.length).toBeLessThan(w.enemies[0].cannons.length);
  });

  test('intro fights bring one new type each, alone; later fights mix by weight (seeded)', () => {
    const t = defaultTuning();
    expect([1, 2, 3].map((f) => encounterFor(t, f, 7))).toEqual([['standard'], ['boarder'], ['heavy']]);
    expect(encounterFor(t, 6, 7)).toEqual(encounterFor(t, 6, 7));
    t.campaign.mix = { standard: 0, boarder: 1, heavy: 0 };
    expect(new Set(encounterFor(t, 8, 7))).toEqual(new Set(['boarder']));
    t.campaign.introFights = 0;
    expect(encounterFor(t, 1, 7)).toEqual(['boarder']);
  });

  test('a Friend Ship closes in and attaches to a boat sailing straight', () => {
    const w = new World(defaultTuning(), 4, { encounter: ['boarder'] });
    w.start();
    let attached = false;
    run(w, 90, () => {
      w.player.target = { x: w.player.motion.x + 20, y: w.player.motion.y - 100 };
      if (w.isAttached(w.player)) attached = true;
    });
    expect(attached).toBe(true);
  });

  test('a Sloop or Hard Ship holds its range instead', () => {
    for (const type of ['standard', 'heavy']) {
      const w = new World(defaultTuning(), 4, { encounter: [type] });
      w.start();
      run(w, 40, () => (w.player.target = { x: w.player.motion.x + 20, y: w.player.motion.y - 100 }));
      expect(w.brains.get(w.enemies[0].id)!.mode).toBe('orbit');
    }
  });

  test('steering alongside an enemy docks with it', () => {
    const t = defaultTuning();
    t.ships.standard.crew.size = 0;
    const w = new World(t, 4, { encounter: ['standard'], crew: [] });
    w.start();
    let attached = false;
    run(w, 90, () => {
      w.setAlongside(w.enemies[0]);
      if (w.isAttached(w.player)) attached = true;
    });
    expect(attached).toBe(true);
  });
});

describe('end of fight while boarded', () => {
  test('your boarders on the last enemy as it sinks make it home after the win', () => {
    const t = quiet(defaultTuning());
    t.ships.standard.crew.size = 4;
    const { w, e, hold } = docked(t, [T.portCannon2, T.portOars, T.sails], ['standard']);
    run(w, 4, hold);
    expect(w.player.crew.lees.some((l) => l.deck === e)).toBe(true);
    for (const p of e.parts) p.water = p.capacity;
    run(w, t.attach.recallWindow + 0.5);
    expect(w.result?.winner).toBe('player');
    expect(w.stats.player.lostBy.sank).toBe(0);
    for (const l of w.player.crew.lees.filter((x) => x.alive)) expect(l.deck).toBe(w.player);
  });
});
