// The run model: starting from a ship's preset (Phase 5), equipment, crew,
// permadeath, XP and levels, gold and spoils (Phase 6), wounds and hull damage
// carried with a free share fixed, special picks, Auto-equip, and the save.

import { describe, expect, test } from 'vitest';
import { defaultTuning } from '../src/config/tuning';
import { createLee } from '../src/sim/crew';
import { createBoat } from '../src/sim/boat';
import { SHIPS } from '../src/config/ships';
import { LEE_DEFS } from '../src/config/lees';
import { xpToNext } from '../src/sim/levels';
import {
  addCrew,
  addItem,
  applyFight,
  pickCapture,
  autoPickAll,
  buildFor,
  canEquip,
  cargo,
  chooseBonus,
  answerSurrender,
  enemySetups,
  hullShare,
  type FightReport,
  equip,
  loadRun,
  newRun,
  specialReward,
  saveRun,
  SAVE_VERSION,
  setupFor,
  takeReward,
  unequip,
  autoEquipAll,
  whereIs,
  wearTrinket,
  type RunState,
} from '../src/sim/run';
import { World } from '../src/sim/world';

const t = defaultTuning();

function drafted(ship = 'basic', seed = 7): RunState {
  return newRun(ship, seed, t);
}

/** A fight report from fake Lees (no enemies beaten unless given). */
function report(run: RunState, won: boolean, ls: ReturnType<typeof lees>, extra: Partial<FightReport> = {}): FightReport {
  return { won, lees: ls, enemies: [], lastEnemy: null, hull: run.hull, ...extra };
}

/** Fake Lees for a fight result: one per crew member, alive unless listed. */
function lees(run: RunState, dead: number[] = [], did: (l: ReturnType<typeof createLee>) => void = () => {}) {
  const boat = createBoat(1, 'player', buildFor(run), t, { x: 0, y: 0 }, 0);
  return run.crew.map((m, i) => {
    const l = createLee(i + 1, i + 1, LEE_DEFS[m.type], 'player', boat, m.home ?? 0, t, { uid: m.uid, label: m.label, level: m.level });
    if (dead.includes(m.uid)) {
      l.alive = false;
      l.lostCause = 'melee';
    }
    did(l);
    return l;
  });
}

describe('starting a run', () => {
  test('a new run starts from the ship\'s preset (loadout, treasures, crew where they stand), ready to sail: no draft', () => {
    for (const id of Object.keys(SHIPS)) {
      const run = newRun(id, 1, t);
      const preset = SHIPS[id].preset;
      expect(run.stage).toBe('refit');
      expect(buildFor(run).loadout).toEqual(preset.loadout);
      expect(buildFor(run).treasures).toEqual(preset.treasures ?? []);
      expect(run.crew.map((m) => m.type)).toEqual(preset.crew.map((c) => c.type));
      expect(run.crew.every((m) => m.home !== null)).toBe(true);
      expect(new Set(run.crew.map((m) => m.home)).size).toBe(run.crew.length);
      // Somebody mans a gun, somebody sails.
      const w = new World(t, 1, { player: setupFor(run, t), enemies: [], assists: false });
      expect(w.player.crew.lees.some((l) => l.job === 'fire')).toBe(true);
      expect(w.player.crew.lees.some((l) => l.job === 'sail')).toBe(true);
      // Guns mostly on one side.
      const sides = w.player.guns.filter((g) => g.targets === 'hull').map((g) => Math.sign(Math.round(Math.sin(g.face))));
      const port = sides.filter((x) => x < 0).length;
      const star = sides.filter((x) => x > 0).length;
      expect(Math.max(port, star)).toBeGreaterThan(Math.min(port, star));
    }
  });

  test('Lees of the same type are numbered apart', () => {
    const run = newRun('basic', 2, t);
    run.crew = [];
    run.counters = {};
    addCrew(run, 'quick', 1, t);
    addCrew(run, 'quick', 1, t);
    addCrew(run, 'hard', 1, t);
    expect(run.crew.map((m) => m.label)).toEqual(['Quick Lee #1', 'Quick Lee #2', 'Hard Lee #1']);
  });
});

describe('equipment', () => {
  test('items equip only where they fit; swapping sends the old one to cargo; attachments leave with their gun', () => {
    const run = drafted();
    const gun = addItem(run, 'carronade');
    expect(canEquip(run, gun.uid, 'fix:2,1')).toBe(false); // interior
    expect(equip(run, gun.uid, 'fix:2,0')).toBe(true);
    expect(cargo(run).map((x) => x.item)).toContain('cannon');
    const shield = addItem(run, 'gunShield');
    expect(equip(run, shield.uid, 'att:fix:2,0')).toBe(true);
    expect(buildFor(run).loadout['att:fix:2,0']).toBe('gunShield');
    unequip(run, gun.uid);
    expect(buildFor(run).loadout['att:fix:2,0']).toBeUndefined();
    expect(cargo(run).some((x) => x.uid === shield.uid)).toBe(true);
    // Treasures sit in the ship's treasure slots.
    const cat = addItem(run, 'cat');
    expect(equip(run, cat.uid, 'treasure:0')).toBe(true);
    expect(buildFor(run).treasures).toEqual(['cat']);
  });

  test('trinkets are worn by Lees and return to cargo when a Lee dies', () => {
    const run = drafted();
    const leg = addItem(run, 'woodenLeg');
    const m = run.crew[0];
    expect(wearTrinket(run, leg.uid, m.uid, 0)).toBe(true);
    expect(setupFor(run, t).crew[0].mods?.hp).toBeCloseTo(1.25);
    applyFight(run, report(run, true, lees(run, [m.uid])), t);
    expect(run.crew.some((x) => x.uid === m.uid)).toBe(false);
    expect(cargo(run).some((x) => x.uid === leg.uid)).toBe(true);
  });
});

describe('after a fight', () => {
  test('the dead are gone for good with a memorial line; survivors earn XP and level up', () => {
    const run = drafted();
    const [dead, worker] = run.crew;
    const post = applyFight(
      run,
      report(
        run,
        true,
        lees(run, [dead.uid], (l) => {
          if (l.uid === worker.uid) l.stats.damageDealt = 400;
        }),
      ),
      t,
    );
    expect(post.lost).toHaveLength(1);
    expect(post.lost[0].line).toContain(dead.label);
    expect(post.lost[0].line).toContain(LEE_DEFS[dead.type].adverb);
    expect(run.fallen).toHaveLength(1);
    const gain = post.xp.find((x) => x.uid === worker.uid)!;
    expect(gain.gained).toBeGreaterThan(t.leveling.survivalXp);
    expect(gain.levelAfter).toBeGreaterThan(1);
    // Each level gained is a pick from the type's offers; nothing lost.
    const ups = post.levelUps.filter((u) => u.uid === worker.uid);
    expect(ups.length).toBe(gain.levelAfter - 1);
    for (const u of ups) expect(new Set(u.offers).size).toBe(t.leveling.choices);
    chooseBonus(run, worker.uid, ups[0].offers[1]);
    autoPickAll(run);
    expect(run.crew.find((m) => m.uid === worker.uid)!.bonuses).toHaveLength(gain.levelAfter - 1);
    expect(run.fight).toBe(2);
    expect(run.stage).toBe('post');
  });

  test('XP thresholds grow; the first level comes after a fight or two', () => {
    expect(xpToNext(2, t)).toBeGreaterThan(xpToNext(1, t));
    expect(xpToNext(1, t)).toBeGreaterThan(t.leveling.survivalXp);
    expect(xpToNext(1, t)).toBeLessThanOrEqual(t.leveling.survivalXp * 2);
  });

  test('a loss, or losing every Lee, ends the run', () => {
    const lost = drafted();
    applyFight(lost, report(lost, false, lees(lost)), t);
    expect(lost.stage).toBe('over');
    const wiped = drafted();
    applyFight(wiped, report(wiped, true, lees(wiped, wiped.crew.map((m) => m.uid))), t);
    expect(wiped.stage).toBe('over');
    expect(wiped.fallen).toHaveLength(SHIPS.basic.preset.crew.length);
  });

  test('a win pays gold for every ship beaten; a capture also takes a part from an intact tile; sinking takes none', () => {
    const run = drafted();
    const gold = run.gold;
    const post = applyFight(
      run,
      report(run, true, lees(run), {
        enemies: [
          { ship: 'basic', how: 'sunk', budget: 300, intact: ['cannon'] },
          { ship: 'friend', how: 'captured', budget: 500, intact: ['gatling', 'carronade', 'gatling'] },
        ],
      }),
      t,
    );
    // A capture offers its whole working parts to pick from: one pick, not a random draw.
    expect(post.captures).toEqual([{ ship: 'friend', options: ['gatling', 'carronade'], picks: 1, taken: [] }]);
    expect(post.spoils).toEqual([]);
    expect(pickCapture(run, 0, 'cannon')).toBe(false); // not on offer
    expect(pickCapture(run, 0, 'gatling')).toBe(true);
    expect(pickCapture(run, 0, 'carronade')).toBe(false); // the pick is used
    expect(post.gold).toBe(Math.round(300 * t.spoils.goldPerBudget) + Math.round(500 * t.spoils.goldPerBudget));
    expect(run.gold).toBe(gold + post.gold);
    expect(run.totals.goldEarned).toBe(post.gold);
    expect(post.spoils).toEqual(['gatling']);
    expect(cargo(run).some((x) => x.item === 'gatling')).toBe(true);
    expect(cargo(run).some((x) => x.item === 'cannon')).toBe(false);
    expect(post.outcomes.map((o) => o.how)).toEqual(['sunk', 'captured']);
    expect(post.reward).toEqual([]); // no 1-of-3 after an ordinary fight
  });

  test('the last enemy Lee may surrender; taking him into a full crew needs someone released first', () => {
    const t2 = defaultTuning();
    t2.spoils.surrender = 1;
    const run = drafted();
    while (run.crew.length < t2.ships.basic.crewMax) addCrew(run, 'basic', 1, t2);
    const post = applyFight(run, report(run, true, lees(run), { lastEnemy: { type: 'hard', level: 3 } }), t2);
    expect(post.surrender).toEqual({ type: 'hard', level: 3 });
    expect(answerSurrender(run, true, t2)).toBe(false);
    const gone = run.crew[0].uid;
    expect(answerSurrender(run, true, t2, gone)).toBe(true);
    const hard = run.crew.at(-1)!;
    expect(hard.type).toBe('hard');
    expect(hard.level).toBe(3);
    expect(hard.home).toBeNull();
    expect(run.crew.some((m) => m.uid === gone)).toBe(false);
    // Never on a zero chance.
    const t3 = defaultTuning();
    t3.spoils.surrender = 0;
    const run2 = drafted();
    expect(applyFight(run2, report(run2, true, lees(run2), { lastEnemy: { type: 'hard', level: 1 } }), t3).surrender).toBeNull();
  });

  test('damage and wounds carry; after a fight a free share of what is missing is fixed', () => {
    const run = drafted();
    const ls = lees(run);
    ls[0].hp = ls[0].maxHp * 0.4;
    applyFight(run, report(run, true, ls, { hull: run.hull.map(() => 0.5) }), t);
    const r = t.run.autoRepair;
    expect(run.hull[0]).toBeCloseTo(0.5 + 0.5 * Math.min(1, r + t.run.handyRepair * run.crew.filter((m) => m.type === 'handy' && m.home !== null).length));
    expect(hullShare(run, t)).toBeLessThan(1);
    expect(run.crew[0].hp).toBeCloseTo(0.4 + 0.6 * t.run.autoHeal);
    // The wounds go into the next fight.
    const w = new World(t, 1, { player: setupFor(run, t), enemies: [], assists: false, carry: { hp: run.hull, water: run.hull.map(() => 0) } });
    const l = w.player.crew.lees.find((x) => x.uid === run.crew[0].uid)!;
    expect(l.hp / l.maxHp).toBeCloseTo(run.crew[0].hp);
    expect(w.player.parts[0].layers.at(-1)!.hp / w.player.parts[0].layers.at(-1)!.maxHp).toBeCloseTo(run.hull[0]);
  });

  test('hard fights offer a special pick; a recruit into a full crew needs someone released first', () => {
    const run = drafted();
    const cards = specialReward(run, t);
    expect(cards).toHaveLength(t.run.rewardChoices);
    expect(cards.some((c) => c.kind === 'recruit')).toBe(true);
    while (run.crew.length < t.ships.basic.crewMax) addCrew(run, 'basic', 1, t);
    run.encounter = { stop: null, type: 'hard', budget: 400, enemies: [], gold: 1, special: true };
    const post = applyFight(run, report(run, true, lees(run)), t);
    expect(post.reward.length).toBe(t.run.rewardChoices);
    post.reward = [{ kind: 'recruit', type: 'deft', level: 2 }];
    expect(takeReward(run, 0, t)).toBe(false);
    const gone = run.crew[0].uid;
    expect(takeReward(run, 0, t, gone)).toBe(true);
    expect(run.crew.some((m) => m.uid === gone)).toBe(false);
    expect(run.crew.at(-1)!.type).toBe('deft');
    expect(run.crew.at(-1)!.home).toBeNull(); // recruits wait ashore
  });

  test('Auto-equip fills empty spots from cargo and places Lees ashore, without moving anything already placed', () => {
    const run = drafted();
    const before = { ...run.loadout };
    const homes = run.crew.map((m) => m.home);
    const gun = addItem(run, 'cannon');
    const plate = addItem(run, 'ironPlating');
    const cat = addItem(run, 'cat');
    const leg = addItem(run, 'woodenLeg');
    const recruit = addCrew(run, 'quick', 1, t);
    autoEquipAll(run, t);
    for (const [slot, uid] of Object.entries(before)) expect(run.loadout[slot]).toBe(uid);
    run.crew.slice(0, homes.length).forEach((m, i) => expect(m.home).toBe(homes[i]));
    for (const x of [gun, plate, cat, leg]) expect(whereIs(run, x.uid)).not.toBeNull();
    expect(recruit.home).not.toBeNull();
    expect(new Set(run.crew.map((m) => m.home)).size).toBe(run.crew.length);
    expect(cargo(run)).toHaveLength(0);
  });
});

describe('encounters', () => {
  test('the fight being set up is built from its enemy specs, with levels explained by auto-picked bonuses', () => {
    const run = drafted();
    run.encounter = {
      stop: null,
      type: 'fight',
      budget: 0,
      gold: 1,
      special: false,
      enemies: [
        { ship: 'basic', ai: 'standard', crew: [{ type: 'quick', level: 3 }, { type: 'basic', count: 2 }] },
        { ship: 'friend', ai: 'boarder', crew: [{ type: 'hard', count: 3 }] },
      ],
    };
    const setups = enemySetups(run, t);
    expect(setups).toHaveLength(2);
    for (const s of setups) {
      for (const c of s.crew) {
        expect(LEE_DEFS[c.type]).toBeDefined();
        if ((c.level ?? 1) > 1) expect(Object.keys(c.mods ?? {}).length).toBeGreaterThan(0);
      }
    }
    // Stable: the same specs build the same boats.
    expect(JSON.stringify(enemySetups(run, t))).toBe(JSON.stringify(setups));
    // And they fight in a real world.
    const w = new World(t, 1, { player: setupFor(run, t), enemies: setups, assists: false });
    expect(w.enemies.length).toBe(2);
  });
});

describe('save', () => {
  test('a run round-trips through its save', () => {
    const run = drafted();
    const back = loadRun(saveRun(run));
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.run).toEqual({ ...run, version: SAVE_VERSION });
  });

  test('a save from another version, or a broken one, is refused instead of loaded', () => {
    const run = drafted();
    expect(loadRun(JSON.stringify({ ...run, version: SAVE_VERSION + 1 }))).toEqual({ ok: false, reason: 'version' });
    expect(loadRun('{not json')).toEqual({ ok: false, reason: 'invalid' });
    expect(loadRun(JSON.stringify({ ...run, ship: 'nope' }))).toEqual({ ok: false, reason: 'invalid' });
    expect(loadRun(JSON.stringify({ ...run, items: [{ uid: 1, item: 'nothing' }] }))).toEqual({ ok: false, reason: 'invalid' });
    expect(loadRun(null)).toEqual({ ok: false, reason: 'none' });
  });
});
