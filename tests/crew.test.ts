import { describe, expect, test } from 'vitest';
import { SLOOP } from '../src/config/boats';
import { BASIC_LEE, LEE_DEFS } from '../src/config/lees';
import { defaultTuning, type Tuning } from '../src/config/tuning';
import { motionParams, structureFraction, type Boat } from '../src/sim/boat';
import { createLee, leeStat, taskKey, type Lee } from '../src/sim/crew';
import { buildGrid, tileAtCell } from '../src/sim/grid';
import { pointInPolygon, toWorld, type Vec } from '../src/sim/math';
import { FIXED_DT } from '../src/sim/steering';
import { World, type CrewPlacement } from '../src/sim/world';

const grid = buildGrid(SLOOP);
const tile = (col: number, row: number) => tileAtCell(grid, col, row)!.index;
const T = {
  portCannon1: tile(1, 0),
  portCannon2: tile(3, 0),
  starCannon1: tile(1, 2),
  starCannon2: tile(3, 2),
  portOars: tile(0, 0),
  sails: tile(2, 1),
  lookout: tile(4, 1),
  midDeck: tile(1, 1),
  bowDeck: tile(4, 0),
};

function quiet(t: Tuning): Tuning {
  for (const b of [t.player, t.enemy]) {
    b.flooding.bilgeRate = 0;
    b.flooding.leakRate = 0;
  }
  t.enemy.crew.size = 0; // enemy guns silent unless a test wants them
  return t;
}

/** A world with the player frozen at the origin (bow north) and one enemy pinned at `enemyAt`. */
function setup(t: Tuning, crew: CrewPlacement, enemyAt: Vec = { x: 0, y: -400 }) {
  const w = new World(t, 1, { enemies: 1, crew });
  w.start();
  const pin = (at: Vec) => {
    enemyAt = at;
  };
  const freeze = () => {
    for (const b of w.boats) {
      b.motion.vx = 0;
      b.motion.vy = 0;
      b.motion.omega = 0;
      b.target = null;
    }
    w.player.motion.x = 0;
    w.player.motion.y = 0;
    w.player.motion.heading = -Math.PI / 2;
    w.enemies[0].motion.x = enemyAt.x;
    w.enemies[0].motion.y = enemyAt.y;
  };
  const run = (seconds: number, each?: () => void) => {
    for (let i = 0; i < seconds / FIXED_DT; i++) {
      freeze();
      each?.();
      w.step(FIXED_DT);
    }
    freeze();
  };
  return { w, run, pin };
}

const PORT: Vec = { x: -80, y: 0 }; // heading north, port is west
const STARBOARD: Vec = { x: 80, y: 0 };
const part = (b: Boat, id: string) => b.parts.find((p) => p.def.id === id)!;
const lee = (w: World, n = 1): Lee => w.player.crew.lees.find((l) => l.number === n)!;

describe('deck grid', () => {
  test('every tile sits inside the part it belongs to, and the stations are all there', () => {
    expect(grid.tiles).toHaveLength(15);
    for (const t of grid.tiles) expect(pointInPolygon(t.center, SLOOP.parts[t.part].polygon)).toBe(true);
    const count = (s: string | null) => grid.tiles.filter((t) => t.station === s).length;
    expect([count('cannon'), count('oars'), count('sails'), count('lookout'), count(null)]).toEqual([4, 2, 1, 1, 7]);
    // Default crew is short-handed: fewer Lees than stations.
    expect(defaultTuning().player.crew.size).toBeLessThan(8);
    expect(grid.tiles[T.portCannon2].label).toBe('Port cannon 2');
    expect(grid.tiles[T.midDeck].neighbors.sort()).toEqual([tile(0, 1), tile(1, 0), tile(1, 2), tile(2, 1)].sort());
  });

  test('cannons sit on cannon stations', () => {
    const w = new World(defaultTuning(), 1);
    expect(w.player.cannons.map((c) => c.station).sort()).toEqual([T.portCannon1, T.portCannon2, T.starCannon1, T.starCannon2].sort());
  });
});

describe('stations need crew', () => {
  test('an unmanned cannon never loads or fires', () => {
    const { w, run } = setup(quiet(defaultTuning()), [], PORT);
    run(15);
    expect(w.stats.player.shellsFired).toBe(0);
  });

  test('a gunner at a cannon that bears fires it', () => {
    const { w, run } = setup(quiet(defaultTuning()), [T.portCannon2], PORT);
    run(10);
    expect(w.stats.player.shellsFired).toBeGreaterThan(1);
    expect(lee(w).stats.shellsFired).toBe(w.stats.player.shellsFired);
  });

  test('speed and turning drop to the baseline with empty oars and sails, and match Phase 1 fully crewed', () => {
    const t = quiet(defaultTuning());
    const empty = new World(t, 1, { crew: [] });
    expect(empty.player.mobility).toEqual({ speed: t.crew.oarBaseline, turn: t.crew.sailBaseline });
    const full = new World(t, 1, { crew: [T.portOars, tile(0, 2), T.sails] });
    expect(full.player.mobility.speed).toBeCloseTo(1);
    expect(full.player.mobility.turn).toBeCloseTo(1);
    expect(motionParams(full.player, t).cruiseSpeed).toBeCloseTo(t.player.movement.cruiseSpeed);
    const half = new World(t, 1, { crew: [T.portOars] });
    expect(half.player.mobility.speed).toBeCloseTo(t.crew.oarBaseline + (1 - t.crew.oarBaseline) / 2);
  });

  test('a manned lookout tightens every gunner', () => {
    const t = quiet(defaultTuning());
    const w = new World(t, 1, { crew: [T.lookout] });
    expect(w.player.spotting).toBeCloseTo(1 + t.crew.lookoutBonus);
  });
});

describe('crew reallocation (§5.5)', () => {
  test('enemy on the other side: the gunner crosses the deck, then crosses back', () => {
    const { w, run, pin } = setup(quiet(defaultTuning()), [T.starCannon2], PORT);
    run(4);
    const l = lee(w);
    expect(l.task.type).toBe('station');
    expect([T.portCannon1, T.portCannon2]).toContain(l.task.target);
    expect(l.working).toBe(true);
    expect(l.reason).toMatch(/Port cannon \d: enemy in arc/);
    expect(w.stats.player.shellsFired).toBeGreaterThan(0);
    pin(STARBOARD);
    run(5);
    expect(l.task).toEqual({ type: 'station', target: T.starCannon2 }); // home again
  });

  test('cannon knocked offline with no other gun bearing: the gunner repairs it, then goes back to it', () => {
    const t = quiet(defaultTuning());
    const { w, run } = setup(t, [T.portCannon2], PORT);
    run(1);
    const guns = part(w.player, 'port');
    guns.layers[0].hp = guns.layers[0].maxHp * 0.2;
    run(0.5);
    const l = lee(w);
    expect(l.task).toEqual({ type: 'repair', target: guns.index });
    expect(l.reason).toMatch(/abandoned Port cannon 2: offline/);
    run(25);
    expect(structureFraction(guns)).toBeGreaterThan(t.player.function.cannonOfflineAt);
    expect(l.task).toEqual({ type: 'station', target: T.portCannon2 });
  });

  test('a part is hit: the nearest damage-control Lee patches it up to the ceiling, then goes home', () => {
    const t = quiet(defaultTuning());
    const { w, run } = setup(t, [T.midDeck, T.lookout]);
    const bow = part(w.player, 'bow');
    bow.layers[0].hp = bow.layers[0].maxHp * 0.3;
    run(1);
    const dc = lee(w, 1);
    expect(dc.task).toEqual({ type: 'repair', target: bow.index });
    run(40);
    expect(structureFraction(bow)).toBeCloseTo(t.crew.repairCeiling, 3);
    expect(dc.task.type).toBe('idle');
    expect(dc.tile).toBe(T.midDeck);
    expect(dc.stats.hpRepaired).toBeGreaterThan(0);
  });

  test('a wrecked part cannot be repaired mid-fight (by default)', () => {
    const { w, run } = setup(quiet(defaultTuning()), [T.midDeck]);
    const bow = part(w.player, 'bow');
    bow.layers[0].hp = 0;
    run(5);
    expect(bow.layers[0].hp).toBe(0);
    expect(lee(w).task.type).toBe('idle');
  });

  test('flooding: a Lee at a quiet post bails, then returns to it', () => {
    const t = quiet(defaultTuning());
    const { w, run } = setup(t, [T.lookout]);
    const mid = part(w.player, 'midship');
    mid.water = mid.capacity * 0.8;
    run(1);
    const l = lee(w);
    expect(l.task.type).toBe('bail');
    run(80);
    expect(l.stats.waterBailed).toBeGreaterThan(0);
    expect(l.task).toEqual({ type: 'station', target: T.lookout });
  });

  test('short-staffed: urgent jobs fill first, low-urgency stations stay empty', () => {
    const t = quiet(defaultTuning());
    // A rower and a damage-control Lee; the enemy is on the port beam.
    const { w, run } = setup(t, [T.portOars, T.midDeck], PORT);
    run(4);
    const [rower, dc] = [lee(w, 1), lee(w, 2)];
    expect(rower.task).toEqual({ type: 'station', target: T.portOars }); // keeps rowing
    expect(dc.task.type).toBe('station'); // mans a gun that bears
    expect([T.portCannon1, T.portCannon2]).toContain(dc.task.target);
    // Nobody wastes time on the lookout or the guns facing away.
    const busy = w.player.crew.lees.map((l) => taskKey(l.task));
    for (const k of [T.lookout, T.starCannon1, T.starCannon2]) expect(busy).not.toContain(`station:${k}`);
  });

  test('claims prevent pile-ons: one damaged part draws one Lee, not the whole crew', () => {
    const t = quiet(defaultTuning());
    // A gunner, a rower (standing in the engine room), a sail hand and one damage-control Lee.
    const { w, run } = setup(t, [T.portCannon2, T.portOars, T.sails, T.midDeck]);
    const engine = part(w.player, 'stern');
    engine.layers[0].hp = engine.layers[0].maxHp * 0.3;
    run(1);
    const repairing = w.player.crew.lees.filter((l) => l.task.type === 'repair');
    expect(repairing.map((l) => l.number)).toEqual([4]);
    // A real emergency (heavy flooding) does pull in a helper who has nothing better to do.
    const mid = part(w.player, 'midship');
    mid.water = mid.capacity;
    run(1);
    expect(w.player.crew.lees.filter((l) => l.task.type === 'bail').length).toBeGreaterThanOrEqual(2);
  });

  test('two Lees never claim the same station', () => {
    const t = quiet(defaultTuning());
    const { w, run } = setup(t, [T.starCannon1, T.starCannon2, T.midDeck], PORT);
    let clash = 0;
    run(10, () => {
      const stations = w.player.crew.lees.filter((l) => l.task.type === 'station').map((l) => l.task.target);
      if (new Set(stations).size !== stations.length) clash++;
    });
    expect(clash).toBe(0);
    const manned = w.player.crew.lees.filter((l) => l.task.type === 'station').map((l) => l.task.target).sort();
    expect(manned).toEqual([T.portCannon1, T.portCannon2].sort());
  });
});

describe('crew damage', () => {
  test('a shell on a Lee hurts it, splashes its neighbors, and enough hits lose it overboard', () => {
    const t = quiet(defaultTuning());
    const { w, run } = setup(t, [T.midDeck, T.sails, T.lookout]);
    const [a, b, c] = [lee(w, 1), lee(w, 2), lee(w, 3)];
    const shoot = () => {
      const p = toWorld(grid.tiles[T.midDeck].center, w.player.motion, w.player.motion.heading);
      w.shells.push({ id: 900, ownerId: w.enemies[0].id, ownerSide: 'enemy', from: p, to: p, elapsed: 0, flightTime: FIXED_DT / 2, damage: 1, impactRadius: 1, leeId: null });
      run(FIXED_DT);
    };
    shoot();
    expect(a.hp).toBeCloseTo(a.maxHp - t.crew.hitDamage);
    expect(b.hp).toBeCloseTo(b.maxHp - t.crew.hitDamage * t.crew.splashFraction); // sails is next to mid deck
    expect(c.hp).toBe(c.maxHp); // lookout is not
    let shots = 1;
    while (a.alive && shots < 20) {
      shoot();
      shots++;
    }
    expect(shots).toBe(Math.ceil(a.maxHp / t.crew.hitDamage));
    expect(a.alive).toBe(false);
    expect(w.stats.player.leesLost).toBe(1);
    expect(w.drainEvents().some((e) => e.type === 'leeLost' && e.leeId === a.id)).toBe(true);
    // The lost Lee isn't replaced, and no longer works.
    expect(w.player.crew.lees.filter((l) => l.alive)).toHaveLength(2);
  });
});

describe('one crew AI, both boats', () => {
  test('the enemy crew runs on the same rules: no gunners, no fire', () => {
    const t = quiet(defaultTuning());
    t.enemy.crew.size = 0;
    const w = new World(t, 1, { enemies: 1 });
    w.start();
    for (let i = 0; i < 30 / FIXED_DT; i++) w.step(FIXED_DT);
    expect(w.stats.enemy.shellsFired).toBe(0);
    t.enemy.crew.size = 4;
    const w2 = new World(t, 1, { enemies: 1 });
    expect(w2.enemies[0].crew.lees).toHaveLength(4);
  });

  test('no dice: crew decisions are identical across different random seeds', () => {
    const fight = (seed: number) => {
      const t = defaultTuning();
      t.player.cannons.spread = 0;
      t.enemy.cannons.spread = 0;
      t.enemyAI.rangeJitter = 0;
      const w = new World(t, seed);
      w.start();
      const log: string[] = [];
      for (let i = 0; i < 40 / FIXED_DT; i++) {
        w.player.target = { x: w.enemies[0].motion.x + 50, y: w.enemies[0].motion.y };
        w.step(FIXED_DT);
        if (i % 30 === 0) for (const l of w.allLees()) log.push(`${l.id}:${taskKey(l.task)}:${l.reason}`);
      }
      return log.join('\n');
    };
    expect(fight(1)).toBe(fight(987654));
  });

  test('crews do not thrash during a real fight', () => {
    const w = new World(defaultTuning(), 2);
    w.start();
    let side = 1;
    for (let i = 0; i < 60 / FIXED_DT && w.phase !== 'over'; i++) {
      if (Math.floor(w.time / 4) % 2 === (side > 0 ? 0 : 1)) side = -side;
      const e = w.enemies[0].motion;
      const h = Math.atan2(e.y - w.player.motion.y, e.x - w.player.motion.x) + side * 1.3;
      w.player.target = { x: w.player.motion.x + Math.cos(h) * 60, y: w.player.motion.y + Math.sin(h) * 60 };
      w.step(FIXED_DT);
    }
    const minutes = w.time / 60;
    for (const l of w.allLees()) expect(l.stats.switches / minutes).toBeLessThan(30);
  });
});

describe('Lees are data', () => {
  test('a passive neighbor ability changes a neighbor stat with no AI code', () => {
    const t = quiet(defaultTuning());
    const w = new World(t, 1, { crew: [T.midDeck, T.sails] });
    const cheer = { ...BASIC_LEE, id: 'cheer', abilities: [{ trigger: 'passive' as const, target: 'orthogonalNeighbors' as const, stat: 'repairRate' as const, multiply: 2 }] };
    LEE_DEFS.cheer = cheer;
    try {
      const [a, b] = w.player.crew.lees;
      expect(leeStat(a, 'repairRate', w.player, t)).toBe(1);
      w.player.crew.lees[1] = createLee(99, 2, cheer, 'player', w.player, b.home, t);
      expect(leeStat(a, 'repairRate', w.player, t)).toBe(2);
    } finally {
      delete LEE_DEFS.cheer;
    }
  });

  test('stats are live from tuning, per Lee type', () => {
    const t = quiet(defaultTuning());
    const w = new World(t, 1, { crew: [T.midDeck] });
    t.lees.basic.walkSpeed = 2;
    expect(leeStat(w.player.crew.lees[0], 'walkSpeed', w.player, t)).toBe(2);
    t.global.playerCrewStats = 1.5;
    expect(leeStat(w.player.crew.lees[0], 'walkSpeed', w.player, t)).toBe(3);
  });
});
