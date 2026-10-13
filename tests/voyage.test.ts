// Phase 6: budget-built enemies, ports (prices, shops, rerolls, repair and
// healing, the bank, the shipyard, leaving), and the sea map (generation with
// a guaranteed route, sailing, stops, intel, depth), difficulty and Custom.

import { describe, expect, test } from 'vitest';
import { chassisCost } from '../src/config/economy';
import { ITEMS } from '../src/config/items';
import { SHIPS } from '../src/config/ships';
import { defaultTuning } from '../src/config/tuning';
import { aiFor, buildShip, dangerSkulls, generateEnemies, specValue } from '../src/sim/budget';
import { Rng } from '../src/sim/math';
import {
  bankInterest,
  buy,
  buyChassis,
  buyHeal,
  buyRepair,
  buyPrice,
  enterPort,
  healPrice,
  leaveWarnings,
  makePlan,
  repairPrice,
  reroll,
  rerollPrice,
  sailBlockers,
  sell,
  sellPrice,
  type PortPlan,
} from '../src/sim/port';
import { addItem, applyFight, blankRun, cargo, cargoLimit, equip, freeFix, newRun, saveRun, loadRun, type RunState } from '../src/sim/run';
import { arrive, cantSail, connected, danger, generateMap, inReach, intel, leavePort, sailTo, type SeaMap } from '../src/sim/seaMap';
import { World } from '../src/sim/world';
import { setupFor } from '../src/sim/run';
import { buildGrid, tileAtCell } from '../src/sim/grid';
import { enemySetup } from '../src/sim/setup';

const t = defaultTuning();

const plan = (over: Partial<PortPlan> = {}): PortPlan => ({ name: 'Port Test', services: ['shop', 'specialty', 'bank', 'shipyard', 'dealer'], specialties: [{ kind: 'tag', id: 'barrage' }], styles: ['open'], ...over });

/** A run sitting in a port. */
function inPort(over: Partial<PortPlan> = {}, ship = 'basic', seed = 3): RunState {
  const run = newRun(ship, seed, t);
  enterPort(run, plan(over), t);
  run.stage = 'port';
  return run;
}

/** A run on a fresh map. */
function atSea(seed = 5, styles = ['open']): RunState {
  const run = inPort({ styles }, 'basic', seed);
  run.port!.offers = [plan({ name: 'Port Far', styles })];
  leavePort(run, 0, t);
  return run;
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

describe('budget-built enemies', () => {
  test('a ship spends most of its budget and never more', () => {
    for (const b of [230, 400, 700, 1200]) {
      for (let seed = 1; seed <= 10; seed++) {
        const s = buildShip(b, new Rng(seed), t);
        expect(specValue(s)).toBeLessThanOrEqual(b + 1e-6);
        expect(specValue(s)).toBeGreaterThan(b * 0.85);
        expect(s.crew.length).toBeGreaterThan(0);
        expect(Object.values(s.fullLoadout!).some((i) => ITEMS[i].category === 'gun')).toBe(true);
      }
    }
  });

  test('the chassis predicts the fight: its AI, its first gun, and most of its tagged parts', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const friend = buildShip(800, new Rng(seed), t, 'friend');
      expect(friend.ai).toBe('boarder');
      const ld = buildShip(800, new Rng(seed), t, 'longdistance');
      expect(ld.ai).toBe('skirmisher');
      expect(Object.values(ld.fullLoadout!)).toContain('longGun');
      expect(buildShip(800, new Rng(seed), t, 'hard').ai).toBe('heavy');
    }
    // Over many ships, a Friend Ship's tagged parts lean Board.
    let board = 0;
    let other = 0;
    for (let seed = 1; seed <= 40; seed++) {
      for (const i of Object.values(buildShip(700, new Rng(seed), t, 'friend').fullLoadout!)) {
        const tags = ITEMS[i].tags;
        if (tags.includes('board')) board++;
        else if (tags.length) other++;
      }
    }
    expect(board).toBeGreaterThan(other);
    // An untagged Basic Ship stays standard unless its parts lean hard one way.
    expect(aiFor('basic', ['cannon', 'cannon'], ['basic'])).toBe('standard');
  });

  test('bigger budgets buy more; packs appear only when a budget affords them', () => {
    const avg = (b: number) => {
      let v = 0;
      let crew = 0;
      for (let seed = 1; seed <= 20; seed++) {
        const e = generateEnemies(b, seed, t);
        v += e.reduce((a, s) => a + specValue(s), 0);
        crew += e.reduce((a, s) => a + s.crew.reduce((n, c) => n + (c.count ?? 1), 0), 0);
        expect(e.length).toBeLessThanOrEqual(t.budget.maxShips);
        if (b < t.budget.minShip * 2) expect(e).toHaveLength(1);
      }
      return { v, crew };
    };
    const small = avg(250);
    const big = avg(1200);
    expect(big.v).toBeGreaterThan(small.v * 3);
    expect(big.crew).toBeGreaterThan(small.crew);
    let packs = 0;
    for (let seed = 1; seed <= 20; seed++) if (generateEnemies(1500, seed, t).length > 1) packs++;
    expect(packs).toBeGreaterThan(0);
  });

  test('the same seed builds the same enemies; a forced chassis is used', () => {
    expect(generateEnemies(600, 9, t)).toEqual(generateEnemies(600, 9, t));
    expect(generateEnemies(600, 9, t, { chassis: 'hard' })[0].ship).toBe('hard');
  });

  test('generated enemies fight in a real world', () => {
    const run = newRun('basic', 1, t);
    const w = new World(t, 1, { player: setupFor(run, t), enemies: generateEnemies(500, 4, t).map(enemySetupOf), assists: false });
    expect(w.enemies.length).toBeGreaterThan(0);
    for (let i = 0; i < 200; i++) w.step(1 / 60);
  });

  test('danger is relative to your ship: 1 to 5 skulls', () => {
    expect(dangerSkulls(100, 1000, t)).toBe(1);
    expect(dangerSkulls(5000, 100, t)).toBe(5);
    expect(dangerSkulls(600, 400, t)).toBeGreaterThan(dangerSkulls(300, 400, t));
  });
});

function enemySetupOf(s: Parameters<typeof enemySetup>[0]) {
  return enemySetup(s, t);
}

describe('ports', () => {
  test('prices differ by port: a specialty sells its tags cheaper and buys them dearer', () => {
    const gunsmith = inPort({ specialties: [{ kind: 'tag', id: 'barrage' }] });
    const boarders = inPort({ specialties: [{ kind: 'tag', id: 'board' }] });
    // Mortar is Barrage.
    expect(buyPrice(gunsmith.port!, 'mortar', t)).toBeLessThan(buyPrice(boarders.port!, 'mortar', t));
    expect(sellPrice(gunsmith.port!, 'mortar', t)).toBeGreaterThan(sellPrice(boarders.port!, 'mortar', t));
    expect(sellPrice(boarders.port!, 'mortar', t)).toBeLessThan(buyPrice(boarders.port!, 'mortar', t));
    // Prices inflate with depth.
    const deep = inPort();
    deep.port!.journey = 5;
    expect(buyPrice(deep.port!, 'cannon', t)).toBeGreaterThan(buyPrice(gunsmith.port!, 'cannon', t));
  });

  test('buying costs gold and lands in the hold; selling pays; equipped things can’t be sold', () => {
    const run = inPort();
    run.gold = 1000;
    const stock = run.port!.stock.shop!;
    const i = stock.findIndex((e) => e.kind === 'item');
    const item = (stock[i] as { item: string }).item;
    const price = buyPrice(run.port!, item, t);
    expect(buy(run, 'shop', i, t)).toBe(true);
    expect(run.gold).toBe(1000 - price);
    expect(cargo(run).some((x) => x.item === item)).toBe(true);
    expect(buy(run, 'shop', i, t)).toBe(false); // sold out
    const inst = cargo(run).find((x) => x.item === item)!;
    expect(sell(run, inst.uid, t)).toBe(true);
    expect(run.gold).toBe(1000 - price + sellPrice(run.port!, item, t));
    const equipped = Object.values(run.loadout)[0];
    expect(sell(run, equipped, t)).toBe(false);
    run.gold = 0;
    expect(buy(run, 'shop', stock.findIndex((e, j) => j !== i && e.kind === 'item'), t)).toBe(false);
  });

  test('rerolls get dearer each time in a port; the Ledger and the Lucky Coin soften them', () => {
    const run = inPort();
    run.gold = 10_000;
    const first = rerollPrice(run, t);
    const before = JSON.stringify(run.port!.stock.shop);
    expect(reroll(run, 'shop', t)).toBe(true);
    expect(JSON.stringify(run.port!.stock.shop)).not.toBe(before);
    expect(rerollPrice(run, t)).toBe(Math.round(t.economy.rerollBase * t.economy.rerollRamp));
    expect(rerollPrice(run, t)).toBeGreaterThan(first);
    const ledger = addItem(run, 'ledger');
    equip(run, ledger.uid, 'treasure:0');
    expect(rerollPrice(run, t)).toBeLessThan(Math.round(t.economy.rerollBase * t.economy.rerollRamp));
    const coin = inPort();
    coin.port!.rerolls = 3;
    const plain = rerollPrice(coin, t);
    equip(coin, addItem(coin, 'luckyCoin').uid, 'treasure:0');
    expect(rerollPrice(coin, t)).toBeLessThan(plain);
  });

  test('repair and healing cost gold, and go as far as the gold does', () => {
    const run = inPort();
    run.hull = run.hull.map(() => 0.5);
    run.crew[0].hp = 0.2;
    const full = repairPrice(run, t);
    expect(full).toBeGreaterThan(0);
    run.gold = Math.floor(full / 2);
    buyRepair(run, t);
    expect(run.gold).toBe(0);
    expect(run.hull[0]).toBeGreaterThan(0.5);
    expect(run.hull[0]).toBeLessThan(1);
    run.gold = 1000;
    buyRepair(run, t);
    expect(run.hull.every((f) => f > 0.999)).toBe(true);
    const heal = healPrice(run, run.crew[0].uid, t);
    expect(heal).toBeGreaterThan(0);
    const before = run.gold;
    buyHeal(run, run.crew[0].uid, t);
    expect(run.crew[0].hp).toBeCloseTo(1);
    expect(run.gold).toBe(before - heal);
  });

  test('the bank pays interest on gold carried out, capped, on reaching the next port', () => {
    const run = inPort({ services: ['bank'] });
    run.gold = 100;
    expect(bankInterest(run, t)).toBe(Math.round(100 * t.economy.bankRate));
    run.gold = 100_000;
    expect(bankInterest(run, t)).toBe(Math.round(t.economy.bankCap));
    run.gold = 100;
    run.port!.offers = [plan({ name: 'Next' })];
    const owed = bankInterest(run, t);
    leavePort(run, 0, t);
    expect(run.bankOwed).toBe(owed);
    arrive(run, t);
    expect(run.gold).toBe(100 + owed);
    expect(run.port!.name).toBe('Next');
    const poor = inPort({ services: [] });
    poor.gold = 100;
    expect(bankInterest(poor, t)).toBe(0);
  });

  test('you can’t sail over the hold limit or with nobody aboard; leftovers warn instead of blocking', () => {
    const run = inPort();
    expect(sailBlockers(run, t)).toEqual([]);
    for (let i = 0; i <= cargoLimit(run, t); i++) addItem(run, 'cannon');
    expect(sailBlockers(run, t).length).toBe(1);
    const ok = inPort();
    addItem(ok, 'spikes');
    expect(sailBlockers(ok, t)).toEqual([]);
    expect(leaveWarnings(ok, t).length).toBe(1);
    ok.crew[0].home = null;
    expect(leaveWarnings(ok, t).length).toBe(2);
  });

  test('the shipyard sells a hull: everything comes off into storage, the old hull trades in', () => {
    const run = inPort({ services: ['shipyard'] });
    run.gold = 1000;
    const items = run.items.length;
    expect(buyChassis(run, 'hard', t)).toBe(true);
    expect(run.ship).toBe('hard');
    expect(run.loadout).toEqual({});
    expect(run.crew.every((m) => m.home === null)).toBe(true);
    expect(run.items.length).toBe(items);
    expect(run.gold).toBe(1000 - chassisCost('hard') + Math.round(chassisCost('basic') * t.economy.tradeIn));
    expect(run.hull).toHaveLength(SHIPS.hard.layout.parts.length);
    expect(sailBlockers(run, t).length).toBeGreaterThan(0);
  });

  test('destination ports lean toward your build’s tags', () => {
    const run = newRun('friend', 1, t);
    let board = 0;
    for (let i = 0; i < 200; i++) {
      const p = makePlan(new Rng(i), run, t, new Set());
      if (p.specialties.some((s) => s.kind === 'tag' && s.id === 'board')) board++;
    }
    // Four tags, so even odds would be ~25-30%.
    expect(board / 200).toBeGreaterThan(0.33);
  });
});

describe('the sea map', () => {
  test('there is always a way through: a route of hops within reach, toward the destination', () => {
    for (let seed = 1; seed <= 25; seed++) {
      for (const styles of [['open'], ['crowded'], ['wide'], ['foggy', 'dangerous'], ['salvage']]) {
        const run = atSea(seed, styles);
        const map = run.map!;
        expect(map.route[0]).toBe(0);
        expect(map.route.at(-1)).toBe(map.dest);
        for (let i = 1; i < map.route.length; i++) expect(dist(map.stops[map.route[i - 1]], map.stops[map.route[i]])).toBeLessThanOrEqual(map.radius + 1e-6);
        expect(connected(map)).toBe(true);
        // Every stop has something in reach.
        for (const s of map.stops) expect(map.stops.some((o) => o !== s && dist(o, s) <= map.radius + 1e-6)).toBe(true);
      }
    }
  });

  test('maps grow with depth, and are reproducible and serializable', () => {
    const a = atSea(4);
    const b = atSea(4);
    expect(a.map).toEqual(b.map);
    expect(JSON.parse(JSON.stringify(a.map))).toEqual(a.map);
    const deep = atSea(4);
    deep.journey = 6;
    const map: SeaMap = generateMap(deep, plan({ name: 'Deep' }), t);
    expect(map.stops.length).toBeGreaterThan(a.map!.stops.length);
    expect(map.height).toBeGreaterThan(a.map!.height);
    const deepBudget = Math.max(...map.stops.map((s) => s.budget));
    expect(deepBudget).toBeGreaterThan(Math.max(...a.map!.stops.map((s) => s.budget)));
  });

  test('later stops are deeper, so fights there are bigger', () => {
    const run = atSea(8);
    const map = run.map!;
    const fights = map.stops.filter((s) => s.type === 'fight');
    const near = fights.reduce((a, s) => (s.y > a.y ? s : a));
    const far = fights.reduce((a, s) => (s.y < a.y ? s : a));
    expect(far.depth).toBeGreaterThan(near.depth);
  });

  test('sail only within reach; a fight sets up; winning clears it; you can go back', () => {
    const run = atSea(2);
    const map = run.map!;
    const far = map.stops.find((s) => !inReach(map).includes(s.id) && s.id !== map.at)!;
    expect(cantSail(run, far.id, t)).not.toBeNull();
    expect(sailTo(run, far.id, t)).toBe(false);
    const fight = map.stops.find((s) => inReach(map).includes(s.id) && s.type === 'fight') ?? null;
    const target = fight ?? map.stops.find((s) => inReach(map).includes(s.id))!;
    target.type = 'fight';
    target.mods = [];
    target.enemies = generateEnemies(target.budget || 250, 1, t);
    expect(sailTo(run, target.id, t)).toBe(true);
    expect(run.stage).toBe('refit');
    expect(run.encounter?.stop).toBe(target.id);
    expect(map.hops).toBe(1);
    applyFight(run, { won: true, lees: [], enemies: [], lastEnemy: null, hull: run.hull }, t);
    expect(target.cleared).toBe(true);
    run.stage = 'map';
    // Back to the start and in again: a cleared stop does nothing.
    expect(sailTo(run, 0, t)).toBe(true);
    expect(run.stage).toBe('map');
    expect(sailTo(run, target.id, t)).toBe(true);
    expect(run.stage).toBe('map');
  });

  test('events: salvage pays, a cove heals and repairs, a wreck offers parts, a castaway offers a Lee', () => {
    const at = (type: string) => {
      const run = atSea(6);
      const map = run.map!;
      const s = map.stops.find((x) => inReach(map).includes(x.id) && x.id !== map.dest)!;
      s.type = type;
      s.mods = [];
      s.budget = 400;
      return { run, s };
    };
    const salvage = at('abandoned');
    const g = salvage.run.gold;
    sailTo(salvage.run, salvage.s.id, t);
    expect(salvage.run.stage).toBe('post');
    expect(salvage.run.gold).toBe(g + Math.round(400 * t.spoils.salvage));
    const cove = at('cove');
    cove.run.hull = cove.run.hull.map(() => 0.4);
    cove.run.crew[0].hp = 0.4;
    sailTo(cove.run, cove.s.id, t);
    expect(cove.run.hull[0]).toBeCloseTo(0.4 + 0.6 * t.run.coveHeal);
    expect(cove.run.crew[0].hp).toBeCloseTo(0.4 + 0.6 * t.run.coveHeal);
    const wreck = at('wreck');
    sailTo(wreck.run, wreck.s.id, t);
    expect(wreck.run.pending!.reward.length).toBe(t.run.rewardChoices);
    expect(wreck.run.pending!.reward.every((c) => c.kind === 'item')).toBe(true);
    const castaway = at('castaway');
    sailTo(castaway.run, castaway.s.id, t);
    expect(castaway.run.pending!.reward[0].kind).toBe('recruit');
  });

  test('reaching the destination ends the journey and opens its port', () => {
    const run = atSea(9);
    const map = run.map!;
    // Teleport next to the destination along the route.
    map.at = map.route.at(-2)!;
    expect(inReach(map)).toContain(map.dest);
    expect(sailTo(run, map.dest, t)).toBe(true);
    expect(run.stage).toBe('port');
    expect(run.journey).toBe(1);
    expect(run.map).toBeNull();
    expect(run.port!.offers.length).toBe(t.map.destinations);
    expect(run.totals.ports).toBe(2);
  });

  test('intel: the ship type always; a worn Spyglass adds crew; a manned Crow’s Nest adds parts; Fog hides', () => {
    const run = atSea(3);
    expect([...intel(run)]).toEqual(['chassis']);
    const glass = addItem(run, 'spyglassTrinket');
    run.crew[0].trinkets[0] = glass.uid;
    expect(intel(run).has('crew')).toBe(true);
    const nest = addItem(run, 'crowsNest');
    // The Basic Ship's interior tile (3,1).
    expect(equip(run, nest.uid, 'fix:3,1')).toBe(true);
    expect(intel(run).has('parts')).toBe(false); // nobody up there
    const tile = tileAtCell(buildGrid(SHIPS.basic.layout), 3, 1)!;
    run.crew[1].home = tile.index;
    expect(intel(run).has('parts')).toBe(true);
    const s = run.map!.stops.find((x) => x.type === 'fight')!;
    expect(danger(run, s, t)).toBeGreaterThanOrEqual(1);
  });

  test('the run round-trips through its save mid-journey', () => {
    const run = atSea(11);
    const back = loadRun(saveRun(run));
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.run.map).toEqual(run.map);
  });
});

describe('difficulty and Custom', () => {
  test('Hard fixes less for free and charges more than Easy', () => {
    const easy = newRun('basic', 1, t, 'easy');
    const hard = newRun('basic', 1, t, 'hard');
    expect(freeFix(easy, t).repair).toBeGreaterThan(freeFix(hard, t).repair);
    expect(easy.gold).toBeGreaterThan(hard.gold);
    for (const r of [easy, hard]) {
      enterPort(r, plan(), t);
      r.hull = r.hull.map(() => 0.5);
    }
    expect(repairPrice(hard, t)).toBeGreaterThan(repairPrice(easy, t));
  });

  test('a Custom start has no ship and can’t sail until it buys one; then it builds from nothing', () => {
    const run = blankRun('basic', 1, 'normal');
    run.noHull = true;
    run.gold = 900;
    enterPort(run, plan(), t, { full: true });
    expect(run.port!.services).toContain('shipyard');
    expect(sailBlockers(run, t).length).toBeGreaterThan(0);
    expect(buyChassis(run, 'basic', t)).toBe(true);
    expect(run.noHull).toBe(false);
    expect(run.gold).toBe(900 - chassisCost('basic'));
    const i = run.port!.stock.tavern!.findIndex((e) => e.kind === 'lee');
    expect(buy(run, 'tavern', i, t)).toBe(true);
    expect(run.crew).toHaveLength(1);
    expect(sailBlockers(run, t).length).toBeGreaterThan(0); // nobody aboard yet
    run.crew[0].home = 0;
    expect(sailBlockers(run, t)).toEqual([]);
  });
});
