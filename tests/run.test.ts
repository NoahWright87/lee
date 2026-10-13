// The run model: starting from a ship's preset (Phase 5), equipment, crew,
// permadeath, XP and levels, rewards (and the forced first equip), Auto-equip,
// the temporary encounter list and its escalation, and the save.

import { describe, expect, test } from 'vitest';
import { ENCOUNTERS } from '../src/config/encounters';
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
  autoPickAll,
  buildFor,
  canEquip,
  cargo,
  chooseBonus,
  encounterFor,
  enemySetups,
  equip,
  loadRun,
  newRun,
  rewardOffer,
  saveRun,
  SAVE_VERSION,
  setupFor,
  takeReward,
  unequip,
  autoEquipAll,
  mustPlaceOpen,
  whereIs,
  wearTrinket,
  type RunState,
} from '../src/sim/run';
import { World } from '../src/sim/world';

const t = defaultTuning();

function drafted(ship = 'basic', seed = 7): RunState {
  return newRun(ship, seed, t);
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
    applyFight(run, lees(run, [m.uid]), true, t);
    expect(run.crew.some((x) => x.uid === m.uid)).toBe(false);
    expect(cargo(run).some((x) => x.uid === leg.uid)).toBe(true);
  });
});

describe('after a fight', () => {
  test('the dead are gone for good with a memorial line; survivors earn XP and level up', () => {
    const run = drafted();
    const [dead, worker] = run.crew;
    const post = applyFight(run, lees(run, [dead.uid], (l) => {
      if (l.uid === worker.uid) l.stats.damageDealt = 400;
    }), true, t);
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
    applyFight(lost, lees(lost), false, t);
    expect(lost.stage).toBe('over');
    const wiped = drafted();
    applyFight(wiped, lees(wiped, wiped.crew.map((m) => m.uid)), true, t);
    expect(wiped.stage).toBe('over');
    expect(wiped.fallen).toHaveLength(SHIPS.basic.preset.crew.length);
  });

  test('rewards: three cards, never all recruits; a recruit into a full crew needs someone released first', () => {
    const run = drafted();
    for (let f = 0; f < 12; f++) {
      run.won = f;
      run.fight = f + 2;
      const cards = rewardOffer(run, t);
      expect(cards).toHaveLength(3);
      expect(cards.some((c) => c.kind === 'item')).toBe(true);
    }
    while (run.crew.length < t.ships.basic.crewMax) addCrew(run, 'basic', 1, t);
    run.pending = { fight: 1, won: true, xp: [], lost: [], levelUps: [], reward: [{ kind: 'recruit', type: 'deft', level: 1 }], rewardTaken: false };
    expect(takeReward(run, 0, t)).toBe(false);
    const gone = run.crew[0].uid;
    expect(takeReward(run, 0, t, gone)).toBe(true);
    expect(run.crew.some((m) => m.uid === gone)).toBe(false);
    expect(run.crew.at(-1)!.type).toBe('deft');
    expect(run.crew.at(-1)!.home).toBeNull(); // recruits wait ashore
  });

  test('the first fight\'s reward goes to cargo and must be equipped before the next fight; later ones needn\'t', () => {
    const run = drafted();
    applyFight(run, lees(run), true, t);
    run.pending!.reward = [{ kind: 'item', item: 'spikes' }];
    expect(takeReward(run, 0, t)).toBe(true);
    const spikes = cargo(run).find((x) => x.item === 'spikes')!;
    expect(spikes).toBeDefined();
    expect(whereIs(run, spikes.uid)).toBeNull(); // nothing equips itself
    expect(mustPlaceOpen(run)).toBe(true);
    expect(equip(run, spikes.uid, 'rail:4,1:bow')).toBe(true);
    expect(mustPlaceOpen(run)).toBe(false);
    // The second reward is free to sit in cargo.
    applyFight(run, lees(run), true, t);
    run.pending!.reward = [{ kind: 'item', item: 'fence' }];
    takeReward(run, 0, t);
    expect(mustPlaceOpen(run)).toBe(false);
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
  test('the temporary list, then the last entry again with higher levels and eventually more crew', () => {
    const n = ENCOUNTERS.length;
    expect(encounterFor(1, t).def).toBe(ENCOUNTERS[0]);
    expect(encounterFor(n, t).repeat).toBe(0);
    const a = encounterFor(n + 1, t);
    const b = encounterFor(n + 4, t);
    expect(a.def).toBe(ENCOUNTERS[n - 1]);
    expect(b.levelBonus).toBeGreaterThan(a.levelBonus);
    expect(b.extraCrew).toBeGreaterThanOrEqual(a.extraCrew);
    const run = drafted();
    run.fight = n + 6;
    const late = enemySetups(run, t);
    run.fight = n;
    const base = enemySetups(run, t);
    expect(late[0].crew[0].level).toBeGreaterThan(base[0].crew[0].level!);
    expect(late[0].crew.length).toBeGreaterThan(base[0].crew.length);
  });

  test('enemies are built from the same content, with their levels explained by auto-picked bonuses', () => {
    const run = drafted();
    run.fight = 5;
    for (const s of enemySetups(run, t)) {
      for (const c of s.crew) {
        expect(LEE_DEFS[c.type]).toBeDefined();
        if ((c.level ?? 1) > 1) expect(Object.keys(c.mods ?? {}).length).toBeGreaterThan(0);
      }
    }
    // And they fight in a real world.
    const w = new World(t, 1, { player: setupFor(run, t), enemies: enemySetups(run, t), assists: false });
    expect(w.enemies.length).toBe(ENCOUNTERS[4].enemies.length);
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
