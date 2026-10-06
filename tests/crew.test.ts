import { describe, expect, test } from 'vitest';
import { SLOOP } from '../src/config/boats';
import { BASIC_LEE, LEE_DEFS } from '../src/config/lees';
import { defaultTuning, type Tuning } from '../src/config/tuning';
import { createBoat, gunSpec, motionParams, structureFraction, type Boat } from '../src/sim/boat';
import { boatCard } from '../src/sim/boatStats';
import { createLee, jobSeats, leeStat, taskKey, type Lee } from '../src/sim/crew';
import { tileAtCell } from '../src/sim/grid';
import { defaultBuild } from '../src/sim/loadout';
import { pointInPolygon, toWorld, type Vec } from '../src/sim/math';
import { FIXED_DT } from '../src/sim/steering';
import { World, type CrewPlacement, type Shell } from '../src/sim/world';

const grid = createBoat(0, 'player', defaultBuild('basic'), defaultTuning(), { x: 0, y: 0 }, 0).grid;
const tile = (col: number, row: number) => tileAtCell(grid, col, row)!.index;
const T = {
  portCannon1: tile(1, 0),
  portCannon2: tile(3, 0),
  starCannon1: tile(1, 2),
  starCannon2: tile(3, 2),
  portOars: tile(0, 0),
  sails: tile(2, 1),
  lookout: tile(3, 1),
  midDeck: tile(1, 1),
  bowDeck: tile(4, 0),
};

function quiet(t: Tuning): Tuning {
  t.boat.flooding.bilgeRate = 0;
  t.boat.flooding.leakRate = 0;
  return t;
}

/** An enemy Sloop with nobody aboard (its guns stay silent). */
const emptySloop = () => ({ build: defaultBuild('basic'), crew: [] });

/** The Sloop without its lookout (so a gunner has no other gun-crew work). */
function noLookout() {
  const b = defaultBuild('basic');
  delete b.loadout['fix:3,1'];
  return b;
}

/** A world with the player frozen at the origin (bow north) and one crewless enemy pinned at `enemyAt`. */
function setup(t: Tuning, crew: CrewPlacement, enemyAt: Vec = { x: 0, y: -400 }, build = defaultBuild('basic')) {
  const w = new World(t, 1, { enemies: [emptySloop()], player: { build, crew: crew.map((home) => ({ type: 'basic', home })) } });
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
    expect([count('gun'), count('oars'), count('sails'), count('lookout'), count(null)]).toEqual([4, 2, 1, 1, 7]);
    // The Sloop's starting crew is short-handed: fewer Lees than stations.
    expect(defaultTuning().ships.basic.crewMin).toBeLessThan(8);
    expect(grid.tiles[T.portCannon2].label).toBe('Port cannon 2');
    expect(grid.tiles[T.lookout].label).toBe('Lookout');
    expect(grid.tiles[T.midDeck].neighbors.sort()).toEqual([tile(0, 1), tile(1, 0), tile(1, 2), tile(2, 1)].sort());
  });

  test('guns sit on the tiles of the slots they are mounted in', () => {
    const w = new World(defaultTuning(), 1);
    expect(w.player.guns.map((c) => c.station).sort()).toEqual([T.portCannon1, T.portCannon2, T.starCannon1, T.starCannon2].sort());
    expect(w.player.guns.every((g) => g.item === 'cannon')).toBe(true);
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

  test('speed and turning drop to the baseline with nobody on the oars and sail; each manned station adds its boost', () => {
    const t = quiet(defaultTuning());
    const empty = new World(t, 1, { crew: [] });
    expect(empty.player.mobility).toEqual({ speed: t.crew.oarBaseline, turn: t.crew.sailBaseline });
    const full = new World(t, 1, { crew: [T.portOars, tile(0, 2), T.sails] });
    expect(full.player.mobility.speed).toBeCloseTo(1);
    expect(full.player.mobility.turn).toBeCloseTo(1);
    expect(motionParams(full.player, t).cruiseSpeed).toBeCloseTo(t.boat.movement.cruiseSpeed);
    const half = new World(t, 1, { crew: [T.portOars] });
    expect(half.player.mobility.speed).toBeCloseTo(t.crew.oarBaseline + t.items.oars.boost);
    // A third set of oars stacks.
    const three = new World(t, 1, { player: { build: { ship: 'basic', loadout: { ...defaultBuild('basic').loadout, 'fix:4,1': 'oars' } }, crew: [T.portOars, tile(0, 2), tile(4, 1)].map((home) => ({ type: 'basic', home })) } });
    expect(three.player.mobility.speed).toBeCloseTo(t.crew.oarBaseline + 3 * t.items.oars.boost);
  });

  test('a manned lookout tightens every gun\'s spread', () => {
    const t = quiet(defaultTuning());
    const none = new World(t, 1, { crew: [] });
    const w = new World(t, 1, { crew: [T.lookout] });
    expect(w.player.fx.accuracy).toBeCloseTo(1 + t.items.lookout.accuracy);
    expect(gunSpec(w.player, w.player.guns[0], t).spread).toBeCloseTo(gunSpec(none.player, none.player.guns[0], t).spread / (1 + t.items.lookout.accuracy));
  });
});

describe('boat stat card', () => {
  test('it reads the same numbers the fight uses', () => {
    const t = quiet(defaultTuning());
    for (const crew of [[], [T.portOars], [T.portOars, tile(0, 2), T.sails], [T.lookout, T.portCannon1], [T.midDeck, T.bowDeck]] as CrewPlacement[]) {
      const w = new World(t, 1, { crew });
      const c = boatCard(w.player, t);
      const mp = motionParams(w.player, t);
      expect(c.speed).toBeCloseTo(mp.cruiseSpeed);
      expect(c.gunsManned).toBe(crew.filter((x) => grid.tiles[x!].station === 'gun').length);
      expect(c.crew).toBe(crew.length);
    }
  });

  test('manning a gun raises firepower; moving a gunner to the oars trades it for speed', () => {
    const t = quiet(defaultTuning());
    const card = (crew: CrewPlacement) => boatCard(new World(t, 1, { crew }).player, t);
    const a = card([T.portCannon1]);
    const b = card([T.portCannon1, T.starCannon1]);
    const c = card([T.portOars, T.starCannon1]);
    expect(b.hullDpm).toBeCloseTo(a.hullDpm * 2);
    expect(c.hullDpm).toBeLessThan(b.hullDpm);
    expect(c.speed).toBeGreaterThan(b.speed);
    // Two 70° broadsides cover 140° of the circle; a bow gun adds its own wedge.
    expect(a.arcCoverage).toBeGreaterThanOrEqual(138);
    expect(a.arcCoverage).toBeLessThanOrEqual(144);
    const chaser = boatCard(new World(t, 1, { player: { build: { ship: 'basic', loadout: { ...defaultBuild('basic').loadout, 'fix:4,1': 'longGun' } }, crew: [] } }).player, t);
    expect(chaser.arcCoverage - a.arcCoverage).toBeGreaterThanOrEqual(34);
  });
});

describe('jobs (Phase 5 §5)', () => {
  test('a gunner follows the enemy to a gun that bears, after holding its own gun for a few seconds', () => {
    const t = quiet(defaultTuning());
    const { w, run, pin } = setup(t, [T.starCannon2], PORT);
    const l = lee(w);
    expect(l.job).toBe('fire');
    run(t.jobs.gunStick - 0.5);
    // Stickiness: turning the boat doesn't send the gun crew running across the deck at once.
    expect(l.task).toEqual({ type: 'station', target: T.starCannon2 });
    run(2.5);
    expect(l.task.type).toBe('station');
    expect([T.portCannon1, T.portCannon2]).toContain(l.task.target);
    expect(l.working).toBe(true);
    expect(l.reason).toMatch(/Port cannon \d: enemy in arc/);
    run(4);
    expect(w.stats.player.shellsFired).toBeGreaterThan(0);
    pin(STARBOARD);
    run(t.jobs.gunStick + 3);
    expect(l.task).toEqual({ type: 'station', target: T.starCannon2 });
  });

  test('a gun knocked offline: the gunner finds other gun-crew work (the lookout), a fixer patches it, the gunner goes back', () => {
    const t = quiet(defaultTuning());
    const { w, run } = setup(t, [T.portCannon2, T.midDeck], PORT);
    run(1);
    const guns = part(w.player, 'port');
    guns.layers[0].hp = guns.layers[0].maxHp * 0.2;
    run(0.5);
    const [gunner, fixer] = [lee(w, 1), lee(w, 2)];
    expect(gunner.task).toEqual({ type: 'station', target: T.lookout });
    expect(fixer.task).toEqual({ type: 'repair', target: guns.index });
    run(25);
    expect(structureFraction(guns)).toBeGreaterThan(t.boat.function.gunOfflineAt);
    expect([T.portCannon1, T.portCannon2]).toContain(gunner.task.target);
  });

  test('idle fallback: a gunner with no gun-crew work left repairs instead of standing there', () => {
    const t = quiet(defaultTuning());
    const w = new World(t, 1, { enemies: [emptySloop()], player: { build: noLookout(), crew: [{ type: 'basic', home: T.portCannon2 }] } });
    w.start();
    const guns = part(w.player, 'port');
    for (let i = 0; i < 1 / FIXED_DT; i++) w.step(FIXED_DT);
    guns.layers[0].hp = guns.layers[0].maxHp * 0.2;
    for (let i = 0; i < 1 / FIXED_DT; i++) w.step(FIXED_DT);
    const l = lee(w);
    expect(l.job).toBe('fire');
    expect(l.task).toEqual({ type: 'repair', target: guns.index });
    expect(l.reason).toMatch(/nothing to do as fire/);
  });

  test('flooding: a gunner whose gun can\'t bear bails, then stands ready at a gun again', () => {
    const t = quiet(defaultTuning());
    const { w, run } = setup(t, [T.portCannon2], undefined, noLookout());
    const mid = part(w.player, 'midship');
    mid.water = mid.capacity * 0.8;
    run(t.jobs.gunStick + 1);
    const l = lee(w);
    expect(l.task.type).toBe('bail');
    run(80);
    expect(l.stats.waterBailed).toBeGreaterThan(0);
    expect(l.task.type).toBe('station');
    expect(w.player.grid.tiles[l.task.target].station).toBe('gun');
  });

  test('each Lee works its own job: the rower keeps rowing and the fixer doesn\'t man the guns', () => {
    const t = quiet(defaultTuning());
    const { w, run } = setup(t, [T.portOars, T.midDeck], PORT);
    run(4);
    const [rower, dc] = [lee(w, 1), lee(w, 2)];
    expect(rower.task).toEqual({ type: 'station', target: T.portOars });
    expect(dc.job).toBe('fix');
    expect(dc.task.type).toBe('idle');
    expect(w.stats.player.shellsFired).toBe(0);
  });

  test('claims prevent pile-ons: one damaged part draws one fixer; a real emergency pulls in a helper', () => {
    const t = quiet(defaultTuning());
    // A gunner, a rower, a sail hand and two fixers.
    const { w, run } = setup(t, [T.portCannon2, T.portOars, T.sails, T.midDeck, T.bowDeck]);
    const engine = part(w.player, 'stern');
    engine.layers[0].hp = engine.layers[0].maxHp * 0.3;
    run(1);
    const repairing = w.player.crew.lees.filter((l) => l.task.type === 'repair');
    expect(repairing.map((l) => l.number)).toEqual([4]);
    const mid = part(w.player, 'midship');
    mid.water = mid.capacity;
    run(1);
    expect(w.player.crew.lees.filter((l) => l.task.type === 'bail').length).toBeGreaterThanOrEqual(1);
    expect(w.player.crew.lees.filter((l) => l.task.type === 'bail' || l.task.type === 'repair').every((l) => l.job === 'fix' || l.task.type === 'bail')).toBe(true);
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

  test('best fit: an order moves the Lee with the biggest gain, and a full job takes nobody', () => {
    const t = quiet(defaultTuning());
    const w = new World(t, 1, {
      enemies: [emptySloop()],
      player: {
        build: defaultBuild('basic'),
        crew: [
          { type: 'deft', home: T.portCannon1 }, // a good sailor stuck on a gun
          { type: 'quick', home: T.portOars }, // a good gunner stuck rowing
          { type: 'basic', home: T.midDeck },
        ],
      },
    });
    w.start();
    const [deft, quick] = w.player.crew.lees;
    expect(w.order('sail')?.id).toBe(deft.id);
    expect(w.order('fire')?.id).toBe(quick.id);
    // Two oars and a sail: three seats; fill them and the next order finds no seat.
    w.order('sail');
    w.order('sail');
    expect(jobSeats(w.player, 'sail', t)).toBe(3);
    expect(w.order('sail')).toBeNull();
    expect(w.drainEvents().some((e) => e.type === 'orderFull' && e.job === 'sail')).toBe(true);
    // Fix has no seat limit.
    expect(w.order('fix')).not.toBeNull();
  });
});

describe('crew damage', () => {
  test('a shell on a Lee hurts it, splashes its neighbors, and enough hits lose it overboard', () => {
    const t = quiet(defaultTuning());
    const { w, run } = setup(t, [T.midDeck, T.sails, T.lookout]);
    const [a, b, c] = [lee(w, 1), lee(w, 2), lee(w, 3)];
    const shoot = () => {
      const p = toWorld(grid.tiles[T.midDeck].center, w.player.motion, w.player.motion.heading);
      const s: Shell = { id: 900, group: 900, gun: 'cannon', mode: 'shell', ownerId: w.enemies[0].id, ownerSide: 'enemy', from: p, to: p, elapsed: 0, flightTime: FIXED_DT / 2, damage: 1, crewDamage: t.guns.crewDamage, splash: 1, impactRadius: 1, leeId: null };
      w.shells.push(s);
      run(FIXED_DT);
    };
    shoot();
    expect(a.hp).toBeCloseTo(a.maxHp - t.guns.crewDamage);
    expect(b.hp).toBeCloseTo(b.maxHp - t.guns.crewDamage * t.guns.crewSplash); // sails is next to mid deck
    expect(c.hp).toBe(c.maxHp); // lookout is not
    let shots = 1;
    while (a.alive && shots < 20) {
      shoot();
      shots++;
    }
    expect(shots).toBe(Math.ceil(a.maxHp / t.guns.crewDamage));
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
    const w = new World(t, 1, { enemies: [emptySloop()] });
    w.start();
    for (let i = 0; i < 30 / FIXED_DT; i++) w.step(FIXED_DT);
    expect(w.stats.enemy.shellsFired).toBe(0);
    const w2 = new World(t, 1, { encounter: ['standard'] });
    expect(w2.enemies[0].crew.lees).toHaveLength(4);
  });

  test('no dice: crew decisions are identical across different random seeds', () => {
    // Shots are the only randomness (aim and scatter), so hold fire and script the damage instead.
    const fight = (seed: number) => {
      const t = defaultTuning();
      t.guns.reloadTime = 1e9;
      t.enemyAI.rangeJitter = 0;
      const w = new World(t, seed);
      w.start();
      const log: string[] = [];
      for (let i = 0; i < 40 / FIXED_DT; i++) {
        w.player.target = { x: w.enemies[0].motion.x + 50, y: w.enemies[0].motion.y };
        if (i === 600) part(w.player, 'bow').layers[0].hp *= 0.3;
        if (i === 900) part(w.player, 'port').layers[0].hp *= 0.2;
        if (i === 1200) part(w.player, 'midship').water = 50;
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
    // The playerCrewStats assist applies from the next fight, and only outside a run.
    t.global.playerCrewStats = 1.5;
    expect(leeStat(new World(t, 1, { crew: [T.midDeck] }).player.crew.lees[0], 'walkSpeed', w.player, t)).toBe(3);
    expect(leeStat(new World(t, 1, { crew: [T.midDeck], assists: false }).player.crew.lees[0], 'walkSpeed', w.player, t)).toBe(2);
  });
});

describe('Lee types', () => {
  test('stats decide between otherwise-equal Lees: the Handy Lee goes to repair', () => {
    const t = quiet(defaultTuning());
    const w = new World(t, 1, {
      enemies: [emptySloop()],
      player: { build: defaultBuild('basic'), crew: [{ type: 'quick', home: tile(1, 1) }, { type: 'handy', home: tile(2, 0) }] },
    });
    w.start();
    // Both are damage control (plain deck); the Handy Lee is the better repairer.
    const [quick, handy] = w.player.crew.lees;
    const bow = part(w.player, 'bow');
    bow.layers[0].hp = bow.layers[0].maxHp * 0.3;
    for (let i = 0; i < 1 / FIXED_DT; i++) w.step(FIXED_DT);
    expect(handy.task).toEqual({ type: 'repair', target: bow.index });
    expect(quick.task.type).not.toBe('repair');
    expect(handy.reason).toMatch(/for Repair ×1\.80/);
  });

  test("Bodyguard: Lees next to a Hard Lee take less impact damage; Shouting: gunners next to a Loud Lee load faster", () => {
    const t = quiet(defaultTuning());
    const w = new World(t, 1, {
      enemies: [emptySloop()],
      player: {
        build: defaultBuild('basic'),
        crew: [
          { type: 'basic', home: T.portCannon2 },
          { type: 'hard', home: tile(2, 0) },
          { type: 'basic', home: T.starCannon2 },
          { type: 'loud', home: tile(4, 2) },
        ],
      },
    });
    const [nextToHard, , starGunner, loud] = w.player.crew.lees;
    expect(leeStat(nextToHard, 'impactTaken', w.player, t)).toBeCloseTo(t.traits.hard.bodyguard);
    expect(leeStat(nextToHard, 'pistolTaken', w.player, t)).toBeCloseTo(t.traits.hard.bodyguard);
    expect(leeStat(starGunner, 'impactTaken', w.player, t)).toBe(1);
    // The Loud Lee at (4,2) is next to the starboard gunner at (3,2).
    expect(grid.tiles[loud.home].neighbors).toContain(T.starCannon2);
    expect(leeStat(starGunner, 'loadSpeed', w.player, t)).toBeCloseTo(t.traits.loud.shouting);
  });

  test('a Lee carries its level bonuses and trinkets in its mods', () => {
    const t = quiet(defaultTuning());
    const w = new World(t, 1, { player: { build: defaultBuild('basic'), crew: [{ type: 'quick', home: T.portCannon1, level: 3, mods: { loadSpeed: 1.2, hp: 1.25 } }] } });
    const q = w.player.crew.lees[0];
    expect(q.level).toBe(3);
    expect(leeStat(q, 'loadSpeed', w.player, t)).toBeCloseTo(1.5 * 1.2);
    expect(q.maxHp).toBeCloseTo(t.crew.hp * 0.8 * 1.25);
  });
});
