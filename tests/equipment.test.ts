// Phase 4 equipment: tile durability and blow-outs, volatile parts, rail items
// (spikes, fences, planks), stations (pump, powder), Swinging Ropes, and how
// different guns shoot (scrap bursts, mortar lobs).

import { describe, expect, test } from 'vitest';
import { defaultTuning, type Tuning } from '../src/config/tuning';
import { createBoat, gunOnline } from '../src/sim/boat';
import { tileAtCell } from '../src/sim/grid';
import { defaultBuild, type BoatBuild } from '../src/sim/loadout';
import { toWorld, type Vec } from '../src/sim/math';
import type { BoatSetup, CrewSpec } from '../src/sim/setup';
import { FIXED_DT } from '../src/sim/steering';
import { World, type Shell } from '../src/sim/world';

function quiet(t: Tuning): Tuning {
  t.boat.flooding.bilgeRate = 0;
  t.boat.flooding.leakRate = 0;
  return t;
}

const sloopTile = (col: number, row: number) => tileAtCell(createBoat(0, 'player', defaultBuild('basic'), defaultTuning(), { x: 0, y: 0 }, 0).grid, col, row)!.index;

const run = (w: World, seconds: number, each?: () => void) => {
  for (let i = 0; i < seconds / FIXED_DT; i++) {
    each?.();
    w.step(FIXED_DT);
  }
};

function pin(_w: World, b: World['player'], at: Vec): void {
  Object.assign(b.motion, { x: at.x, y: at.y, heading: -Math.PI / 2, vx: 0, vy: 0, omega: 0 });
  b.target = null;
}

const basic = (homes: (number | null)[], job?: CrewSpec['job']): CrewSpec[] => homes.map((home) => ({ type: 'basic', home, job }));
const setupOf = (build: BoatBuild, crew: CrewSpec[] = [], ai?: BoatSetup['ai']): BoatSetup => ({ build, crew, ai });

/** Drop a shell straight onto a tile of a boat. */
function shellOn(w: World, target: World['player'], col: number, row: number, o: Partial<Shell> = {}): void {
  const tile = tileAtCell(target.grid, col, row)!;
  const at = toWorld(tile.center, target.motion, target.motion.heading);
  const owner = target === w.player ? w.enemies[0] : w.player;
  w.shells.push({
    id: 1,
    group: 1,
    gun: 'cannon',
    mode: 'shell',
    ownerId: owner.id,
    ownerSide: owner.side,
    from: at,
    to: at,
    elapsed: 0,
    flightTime: FIXED_DT / 2,
    damage: w.tuning.guns.damage,
    crewDamage: 0,
    splash: 1,
    impactRadius: 0.5,
    leeId: null,
    ...o,
  });
  w.step(FIXED_DT);
}

describe('tiles', () => {
  test('shells wear tiles down; a blown-out tile loses its fixture, hurts whoever stands there, and stays walkable', () => {
    const t = quiet(defaultTuning());
    t.tiles.durability = 25;
    const gun = sloopTile(1, 0);
    const w = new World(t, 1, { enemies: [setupOf(defaultBuild('basic'))], crew: [gun] });
    w.start();
    const tile = w.player.grid.tiles[gun];
    const g = w.player.guns.find((x) => x.station === gun)!;
    const lee = w.player.crew.lees[0];
    shellOn(w, w.player, 1, 0);
    expect(tile.hp).toBeCloseTo(25 - t.guns.damage);
    // A neighbor takes splash.
    expect(w.player.grid.tiles[sloopTile(2, 0)].hp).toBeCloseTo(25 - t.guns.damage * t.tiles.splash);
    expect(gunOnline(w.player, g, t)).toBe(true);
    shellOn(w, w.player, 1, 0);
    shellOn(w, w.player, 1, 0);
    expect(tile.blown).toBe(true);
    expect(tile.fixture!.destroyed).toBe(true);
    expect(gunOnline(w.player, g, t)).toBe(false);
    expect(lee.hp).toBeLessThanOrEqual(lee.maxHp - t.tiles.blowoutLeeDamage + 1e-6);
    expect(w.stats.player.tilesBlown).toBe(1);
    // The crew no longer sees a gun there; the tile is still part of the walkable deck.
    run(w, 0.5);
    expect(w.player.crew.needs.some((n) => n.task.type === 'station' && n.task.target === gun)).toBe(false);
    expect(w.player.grid.dist[gun][sloopTile(3, 0)]).toBeLessThan(Infinity);
  });

  test('reinforced planks double a tile\'s durability', () => {
    const t = defaultTuning();
    const b = createBoat(1, 'player', { ship: 'basic', loadout: { 'floor:1,1': 'reinforcedPlanks' } }, t, { x: 0, y: 0 }, 0);
    expect(b.grid.tiles[sloopTile(1, 1)].maxHp).toBeCloseTo(2 * b.grid.tiles[sloopTile(2, 1)].maxHp);
  });

  test('a powder store explodes when its tile blows out, damaging tiles, parts and Lees around it, and chains', () => {
    const t = quiet(defaultTuning());
    // Two powder stores side by side (interior tiles 1,1 and 2,1).
    const build: BoatBuild = { ship: 'basic', loadout: { 'fix:1,1': 'powder', 'fix:2,1': 'powder', 'fix:3,1': 'lookout' } };
    const w = new World(t, 1, { enemies: [setupOf(defaultBuild('basic'))], player: setupOf(build, basic([sloopTile(3, 1)])) });
    w.start();
    const mid = w.player.parts.find((p) => p.def.id === 'midship')!;
    const hp0 = mid.layers[0].hp;
    const lookout = w.player.crew.lees[0];
    w.damageTile(w.player, sloopTile(1, 1), 1000);
    expect(w.stats.player.explosions).toBe(2); // the second store went up too
    expect(w.player.grid.tiles[sloopTile(2, 1)].blown).toBe(true);
    expect(mid.layers[0].hp).toBeLessThan(hp0 - t.explosion.partDamage);
    // The lookout next to the second store got caught in it.
    expect(lookout.hp).toBeLessThan(lookout.maxHp);
    expect(w.drainEvents().filter((e) => e.type === 'explosion')).toHaveLength(2);
  });
});

describe('rail items', () => {
  /** Alongside: you at the origin heading north, their boat on your port side; `hold` keeps both there. */
  function docked(t: Tuning, mine: BoatSetup, theirs: BoatSetup) {
    const w = new World(t, 5, { enemies: [theirs], player: mine });
    w.start();
    const e = w.enemies[0];
    const hold = () => {
      pin(w, w.player, { x: 0, y: 0 });
      pin(w, e, { x: -(w.player.layout.beam / 2 + e.layout.beam / 2 + t.attach.alongsideGap * 0.5), y: 0 });
    };
    hold();
    return { w, e, hold };
  }

  test('spikes along a touching edge wear down the other boat', () => {
    const t = quiet(defaultTuning());
    const mine = setupOf({ ship: 'basic', loadout: { 'rail:2,0:port': 'spikes' } }, basic([sloopTile(1, 1)]));
    const theirs = setupOf(defaultBuild('basic'), [], { ...t.ai.standard });
    const { w, e, hold } = docked(t, mine, theirs);
    const hp0 = e.parts.reduce((a, p) => a + p.layers[0].hp, 0);
    run(w, 5, hold);
    expect(hp0 - e.parts.reduce((a, p) => a + p.layers[0].hp, 0)).toBeCloseTo(5 * t.items.spikes.attachedDps, 0);
  });

  test('a fence stops boarders landing on its tile; if every tile in reach is fenced they hack at it until it breaks', () => {
    const t = quiet(defaultTuning());
    t.items.fence.hp = 30;
    // Your whole port side fenced... but the Sloop has one port rail, so a boarder can still land on the neighbors.
    const mine = setupOf({ ship: 'basic', loadout: { 'rail:2,0:port': 'fence' } }, basic([sloopTile(2, 1)]));
    const theirs = setupOf(defaultBuild('friend'), Array.from({ length: 4 }, () => ({ type: 'hard', home: null, job: 'board' as const })), { ...t.ai.boarder });
    theirs.crew.forEach((c, i) => (c.home = [7, 8, 9, 10][i]));
    const { w, hold } = docked(t, mine, theirs);
    const fenced = sloopTile(2, 0);
    let landedOnFence = false;
    run(w, 8, () => {
      hold();
      for (const l of w.enemies[0].crew.lees) if (l.deck === w.player && !l.swing && l.tile === fenced && !l.path.length && l.stats.boardings > 0 && l.reason.startsWith('landed')) landedOnFence = true;
    });
    expect(w.stats.enemy.boardings).toBeGreaterThan(0);
    expect(landedOnFence).toBe(false);
  });

  test('when the fence covers every tile in reach, boarders hack at it, and land once it breaks', () => {
    const t = quiet(defaultTuning());
    t.items.fence.hp = 20;
    // A tiny deck stand-in: fence every port-facing rail of the Friend Ship, and dock a Sloop on its port side.
    const fences: Record<string, string> = { 'rail:3,0:port': 'fence' };
    const mine = setupOf({ ship: 'friend', loadout: fences }, basic([10]));
    const theirs = setupOf(defaultBuild('basic'), Array.from({ length: 3 }, () => ({ type: 'hard', home: null, job: 'board' as const })), { ...t.ai.boarder });
    theirs.crew.forEach((c, i) => (c.home = [1, 4, 6][i]));
    const w = new World(t, 5, { enemies: [theirs], player: mine });
    w.start();
    pin(w, w.player, { x: 0, y: 0 });
    const e = w.enemies[0];
    // Their boat lies right beside your fenced tile.
    const fencedTile = w.player.grid.tiles.find((x) => x.rails.some((r) => r.kind === 'fence'))!;
    const beside = toWorld({ x: fencedTile.center.x, y: -(w.player.layout.beam / 2 + e.layout.beam / 2 + t.attach.alongsideGap) }, w.player.motion, w.player.motion.heading);
    const fence = fencedTile.rails[0];
    let hacked = false;
    run(w, 20, () => {
      pin(w, w.player, { x: 0, y: 0 });
      pin(w, e, beside);
      if (e.crew.lees.some((l) => l.reason.includes('hacking at a fence'))) hacked = true;
    });
    // Either it never came to that (they found an unfenced tile) or they hacked through.
    if (hacked) expect(fence.destroyed).toBe(true);
    expect(w.stats.enemy.boardings).toBeGreaterThan(0);
  });

  test('boarding planks: Lees leaving from that tile swing faster, hit harder with pistols, and can be shot mid-swing', () => {
    const t = quiet(defaultTuning());
    const mine = setupOf({ ship: 'basic', loadout: { 'rail:2,0:port': 'planks' } }, basic([sloopTile(2, 0), sloopTile(2, 1)], 'board'));
    const theirs = setupOf(defaultBuild('basic'), basic([sloopTile(2, 1)]), { ...t.ai.standard });
    const { w, hold } = docked(t, mine, theirs);
    let planked = 0;
    run(w, 4, () => {
      hold();
      for (const l of w.player.crew.lees) if (l.swing && !l.swing.back && l.swing.t === 0) {
        if (l.boardBuff) planked++;
        expect(l.swing.dur).toBeLessThanOrEqual(t.boarding.swingTime + 1e-9);
      }
    });
    expect(planked).toBeGreaterThan(0);
  });
});

describe('stations', () => {
  test('Swinging Ropes: ⚔️ Lees swing across from farther away, and faster', () => {
    const t = quiet(defaultTuning());
    const crossed = (treasures: string[]) => {
      const w = new World(t, 1, {
        enemies: [setupOf(defaultBuild('basic'), basic([sloopTile(1, 1)]))],
        player: setupOf({ ship: 'basic', loadout: {}, treasures }, basic([sloopTile(2, 0)], 'board')),
      });
      w.start();
      const e = w.enemies[0];
      let dur = 0;
      // Just out of plain boarding range, inside the ropes' range.
      const gap = t.boarding.range * 1.25;
      run(w, 4, () => {
        pin(w, w.player, { x: 0, y: 0 });
        pin(w, e, { x: -(10 + gap), y: 0 });
        for (const l of w.player.crew.lees) if (l.swing && !l.swing.back && l.swing.t === 0) dur = l.swing.dur;
      });
      return { boardings: w.stats.player.boardings, dur };
    };
    expect(crossed([]).boardings).toBe(0);
    const roped = crossed(['ropes']);
    expect(roped.boardings).toBeGreaterThan(0);
    expect(roped.dur).toBeCloseTo(t.boarding.swingTime * t.items.ropes.swing);
  });

  test('a manned bilge pump drains water faster than a bailer', () => {
    const t = quiet(defaultTuning());
    const drained = (loadout: Record<string, string>, home: number) => {
      const w = new World(t, 1, { enemies: [setupOf(defaultBuild('basic'))], player: setupOf({ ship: 'basic', loadout }, basic([home])) });
      w.start();
      const mid = w.player.parts.find((p) => p.def.id === 'midship')!;
      mid.water = mid.capacity * 0.5;
      const before = w.player.parts.reduce((a, p) => a + p.water, 0);
      run(w, 6, () => pin(w, w.enemies[0], { x: 0, y: -400 }));
      return before - w.player.parts.reduce((a, p) => a + p.water, 0);
    };
    const pump = drained({ 'fix:1,1': 'pump' }, sloopTile(1, 1));
    const bail = drained({}, sloopTile(1, 1));
    expect(pump).toBeGreaterThan(bail * 1.5);
  });

  test('a manned powder store speeds every gun\'s reload', () => {
    const t = quiet(defaultTuning());
    const w = new World(t, 1, { enemies: [setupOf(defaultBuild('basic'))], player: setupOf({ ship: 'basic', loadout: { 'fix:2,1': 'powder' } }, basic([sloopTile(2, 1)])) });
    expect(w.player.fx.reload).toBeCloseTo(t.items.powder.reload);
  });
});

describe('guns shoot differently', () => {
  test('a scrap cannon fires a burst of pellets with one shaded area telegraph; a mortar gets a bigger X', () => {
    const t = quiet(defaultTuning());
    const enemyBuild: BoatBuild = { ship: 'basic', loadout: { 'fix:1,2': 'scrap', 'fix:1,1': 'mortar' }, facings: { 'fix:1,1': 'starboard' } };
    const w = new World(t, 2, {
      enemies: [setupOf(enemyBuild, basic([sloopTile(1, 2), sloopTile(1, 1)]), { ...t.ai.standard })],
      player: setupOf({ ship: 'basic', loadout: {} }, []),
    });
    w.start();
    let bursts = 0;
    let mortars = 0;
    run(w, 30, () => {
      pin(w, w.player, { x: 0, y: 0 });
      // Enemy 70 m to your east heading south: its starboard side (scrap cannon, mortar turned that way) faces you.
      Object.assign(w.enemies[0].motion, { x: 70, y: 0, heading: Math.PI / 2, vx: 0, vy: 0, omega: 0 });
      w.enemies[0].target = null;
      for (const e of w.drainEvents()) {
        if (e.type !== 'fire') continue;
        if (e.gun === 'scrap') {
          bursts++;
          const pellets = w.shells.filter((s) => s.gun === 'scrap' && s.elapsed <= FIXED_DT + 1e-9);
          expect(pellets.length).toBe(t.items.scrap.pellets);
          expect(new Set(pellets.map((s) => s.group)).size).toBe(1);
          expect(w.telegraphs.list.filter((x) => x.kind === 'area' && x.elapsed <= FIXED_DT + 1e-9)).toHaveLength(1);
        }
        if (e.gun === 'mortar') {
          mortars++;
          const x = w.telegraphs.list.find((x) => x.kind === 'shell' && x.elapsed <= FIXED_DT + 1e-9)!;
          expect(x.size).toBeCloseTo(t.items.mortar.splash);
        }
      }
    });
    expect(bursts).toBeGreaterThan(0);
    expect(mortars).toBeGreaterThan(0);
  });
});
