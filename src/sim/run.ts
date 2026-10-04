// A run: the ship you picked, everything you own (items as instances, so you
// can carry two of the same), what's equipped where, your crew (persistent
// identity, levels, bonuses, trinkets, homes), the fallen, and where you are in
// the encounter list. Pure data and pure functions: serializable, versioned,
// and nothing here knows about screens.
//
// The encounter list is the very temporary stand-in for the sea map: a run's
// flow (what comes after a fight) lives in the Controller, so a sea map can
// replace it without touching any of this.

import { ENCOUNTERS, type EncounterDef } from '../config/encounters';
import { ITEMS, type ItemCategory, type ItemDef } from '../config/items';
import { LEE_DEFS, STAT_LABELS } from '../config/lees';
import { SHIPS } from '../config/ships';
import type { Facing, SlotType } from '../config/slots';
import type { Tuning } from '../config/tuning';
import type { Lee } from './crew';
import { allSlots, defaultBuild, fits, slotById, trinketMods, type BoatBuild } from './loadout';
import { autoBonuses, bonusLabel, bonusMods, bonusOffers, combineMods, xpToNext, type BonusKey } from './levels';
import { Rng } from './math';
import { autoArrange, enemySetup, type BoatSetup, type CrewSpec } from './setup';
import { buildGrid } from './grid';

/** Bump whenever a change makes older saves unreadable. Older saves are then offered a reset, never loaded. */
export const SAVE_VERSION = 1;

export interface ItemInstance {
  uid: number;
  item: string;
}

export interface CrewMember {
  uid: number;
  type: string;
  /** "Quick Lee #2": numbered per type, never reused in a run. */
  label: string;
  level: number;
  /** XP toward the next level. */
  xp: number;
  /** Chosen level-up bonuses, in order. */
  bonuses: BonusKey[];
  /** Worn trinket instance uids, one per trinket slot (null = empty). */
  trinkets: (number | null)[];
  /** Home tile (null = not placed: stays ashore). */
  home: number | null;
  /** Fight number they joined in. */
  joined: number;
  /** Lifetime numbers (for cards and the memorial). */
  fights: number;
  kills: number;
}

export interface Fallen {
  uid: number;
  type: string;
  label: string;
  level: number;
  fight: number;
  cause: string;
  line: string;
}

export type RewardCard = { kind: 'item'; item: string } | { kind: 'recruit'; type: string; level: number };

export interface XpGain {
  uid: number;
  gained: number;
  levelBefore: number;
  levelAfter: number;
}

/** What a fight left to resolve: XP shown, level-ups to pick, and a reward to choose. */
export interface PostFight {
  fight: number;
  won: boolean;
  xp: XpGain[];
  lost: Fallen[];
  /** One entry per level gained (a Lee can gain two in one fight), in order. */
  levelUps: { uid: number; level: number; offers: BonusKey[] }[];
  reward: RewardCard[];
  rewardTaken: boolean;
}

export interface RunState {
  version: number;
  seed: number;
  ship: string;
  /** Every item owned. */
  items: ItemInstance[];
  /** Slot id → item instance uid (treasure slots are "treasure:<i>"). */
  loadout: Record<string, number>;
  /** Interior guns' facings by slot id. */
  facings: Record<string, Facing>;
  crew: CrewMember[];
  fallen: Fallen[];
  /** Next fight number (1-based). */
  fight: number;
  /** Fights won. */
  won: number;
  /** Per-type counters for crew labels. */
  counters: Record<string, number>;
  nextUid: number;
  /** Draft progress (before the first fight). */
  stage: 'draft' | 'startPart' | 'refit' | 'post' | 'over';
  draftRound: number;
  startOffer: string[];
  pending: PostFight | null;
}

const treasureSlot = (i: number) => `treasure:${i}`;
const isTreasureSlot = (id: string) => /^treasure:\d+$/.test(id);

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function rngFor(run: RunState, what: string): Rng {
  return new Rng((run.seed ^ hash(what)) >>> 0);
}

/** Weighted draw of up to n distinct entries. */
function drawDistinct<T>(rng: Rng, pool: [T, number][], n: number): T[] {
  const left = pool.filter(([, w]) => w > 0);
  const out: T[] = [];
  while (out.length < n && left.length) {
    const total = left.reduce((a, [, w]) => a + w, 0);
    let r = rng.next() * total;
    let pick = left.length - 1;
    for (let i = 0; i < left.length; i++) {
      r -= left[i][1];
      if (r < 0) {
        pick = i;
        break;
      }
    }
    out.push(left[pick][0]);
    left.splice(pick, 1);
  }
  return out;
}

// ------------------------------------------------------------ setup

export function newRun(ship: string, seed: number): RunState {
  const run: RunState = {
    version: SAVE_VERSION,
    seed: seed >>> 0,
    ship: SHIPS[ship] ? ship : 'sloop',
    items: [],
    loadout: {},
    facings: {},
    crew: [],
    fallen: [],
    fight: 1,
    won: 0,
    counters: {},
    nextUid: 1,
    stage: 'draft',
    draftRound: 0,
    startOffer: [],
    pending: null,
  };
  for (const [slot, item] of Object.entries(defaultBuild(run.ship).loadout)) {
    run.loadout[slot] = addItem(run, item).uid;
  }
  return run;
}

export function addItem(run: RunState, item: string): ItemInstance {
  const inst = { uid: run.nextUid++, item };
  run.items.push(inst);
  return inst;
}

export function itemOf(run: RunState, uid: number | null | undefined): ItemDef | undefined {
  if (uid === null || uid === undefined) return undefined;
  const inst = run.items.find((x) => x.uid === uid);
  return inst ? ITEMS[inst.item] : undefined;
}

/** Make a crew member (a drafted Lee or a recruit). */
export function addCrew(run: RunState, type: string, level: number, t: Tuning): CrewMember {
  const def = LEE_DEFS[type] ?? LEE_DEFS.basic;
  run.counters[def.id] = (run.counters[def.id] ?? 0) + 1;
  const member: CrewMember = {
    uid: run.nextUid++,
    type: def.id,
    label: `${def.name} #${run.counters[def.id]}`,
    level: 1,
    xp: 0,
    bonuses: [],
    trinkets: Array(Math.max(0, Math.round(t.run.trinketSlots))).fill(null),
    home: null,
    joined: run.fight,
    fights: 0,
    kills: 0,
  };
  // A recruit above level 1 comes with auto-picked bonuses.
  for (const b of autoBonuses(def.id, Math.max(1, level), member.uid, t)) member.bonuses.push(b);
  member.level = Math.max(1, Math.min(Math.round(t.leveling.levelCap), level));
  run.crew.push(member);
  return member;
}

/** Three distinct Lee types to draft from (seeded by run and round). */
export function draftOffer(run: RunState, t: Tuning): string[] {
  const pool = Object.values(LEE_DEFS).map((d) => [d.id, d.draftWeight] as [string, number]);
  return drawDistinct(rngFor(run, `draft:${run.draftRound}`), pool, Math.max(1, Math.round(t.run.draftChoices)));
}

/** Draft one Lee; once the crew reaches the ship's minimum, move on to the starting part. */
export function draftPick(run: RunState, type: string, t: Tuning): void {
  addCrew(run, type, 1, t);
  run.draftRound++;
  if (run.crew.length >= crewMin(run, t)) {
    run.stage = 'startPart';
    run.startOffer = partOffer(run, 'start', Math.max(1, Math.round(t.run.startPartChoices)));
  }
}

export function crewMin(run: RunState, t: Tuning): number {
  return Math.max(1, Math.round(t.ships[run.ship]?.crewMin ?? 1));
}

export function crewMax(run: RunState, t: Tuning): number {
  return Math.max(1, Math.round(t.ships[run.ship]?.crewMax ?? 1));
}

export function treasureSlots(run: RunState, t: Tuning): number {
  return Math.max(0, Math.round(t.ships[run.ship]?.treasures ?? 0));
}

const PART_CATEGORIES: ItemCategory[] = ['gun', 'station', 'rail', 'hull', 'attachment', 'floor'];

/** Slot types this ship has (floors always; attachments if it can carry a gun). */
function shipSlotTypes(ship: string): Set<SlotType> {
  const def = SHIPS[ship];
  const types = new Set<SlotType>(def.slots.map((s) => s.type));
  types.add('floor');
  if (types.has('edge') || types.has('interior')) types.add('attachment');
  return types;
}

/** Items that could go somewhere on this ship. */
function usable(ship: string, def: ItemDef): boolean {
  const types = shipSlotTypes(ship);
  return def.fits.some((f) => types.has(f));
}

function partOffer(run: RunState, salt: string, n: number): string[] {
  const pool = Object.values(ITEMS)
    .filter((d) => PART_CATEGORIES.includes(d.category) && usable(run.ship, d))
    .map((d) => [d.id, d.rewardWeight] as [string, number]);
  return drawDistinct(rngFor(run, salt), pool, n);
}

/** Take the starting part: into cargo (equip it on the refit screen), then refit. */
export function takeStartPart(run: RunState, item: string, t: Tuning): void {
  if (ITEMS[item]) {
    const inst = addItem(run, item);
    autoEquip(run, inst.uid, t);
  }
  run.stage = 'refit';
  run.startOffer = [];
  autoArrangeRun(run, t);
}

// ------------------------------------------------------------ equipment

/** The boat this run sails: its ship, what's equipped, treasures. */
export function buildFor(run: RunState): BoatBuild {
  const loadout: Record<string, string> = {};
  const treasures: string[] = [];
  for (const [slot, uid] of Object.entries(run.loadout)) {
    const def = itemOf(run, uid);
    if (!def) continue;
    if (isTreasureSlot(slot)) treasures.push(def.id);
    else loadout[slot] = def.id;
  }
  return { ship: run.ship, loadout, facings: { ...run.facings }, treasures };
}

/** Stat mods a crew member carries: level bonuses × trinkets. */
export function memberMods(run: RunState, m: CrewMember, t: Tuning) {
  const trinkets = m.trinkets.map((u) => itemOf(run, u)?.id).filter((x): x is string => !!x);
  return combineMods(bonusMods(m.bonuses, t), trinketMods(trinkets, t));
}

export function crewSpecs(run: RunState, t: Tuning): CrewSpec[] {
  return run.crew.map((m) => ({ type: m.type, home: m.home, uid: m.uid, label: m.label, level: m.level, mods: memberMods(run, m, t) }));
}

export function setupFor(run: RunState, t: Tuning): BoatSetup {
  return { build: buildFor(run), crew: crewSpecs(run, t) };
}

/** Every slot of the run's ship that can take items, treasure slots included. */
export function runSlots(run: RunState, t: Tuning): { id: string; type: SlotType }[] {
  const ship = SHIPS[run.ship];
  const grid = buildGrid(ship.layout);
  const out: { id: string; type: SlotType }[] = allSlots(ship, grid, buildFor(run).loadout).map((s) => ({ id: s.id, type: s.type }));
  for (let i = 0; i < treasureSlots(run, t); i++) out.push({ id: treasureSlot(i), type: 'treasure' });
  return out;
}

export function slotType(run: RunState, slot: string): SlotType | null {
  if (isTreasureSlot(slot)) return 'treasure';
  return slotById(SHIPS[run.ship], slot)?.type ?? null;
}

/** Item uids worn as trinkets. */
function worn(run: RunState): Set<number> {
  const out = new Set<number>();
  for (const m of run.crew) for (const u of m.trinkets) if (u !== null) out.add(u);
  return out;
}

/** Items not equipped, worn or held: the cargo hold. */
export function cargo(run: RunState): ItemInstance[] {
  const used = new Set<number>(Object.values(run.loadout));
  for (const u of worn(run)) used.add(u);
  return run.items.filter((x) => !used.has(x.uid));
}

/** Where an item instance is right now. */
export function whereIs(run: RunState, uid: number): { slot: string } | { member: number; index: number } | null {
  for (const [slot, u] of Object.entries(run.loadout)) if (u === uid) return { slot };
  for (const m of run.crew) {
    const i = m.trinkets.indexOf(uid);
    if (i >= 0) return { member: m.uid, index: i };
  }
  return null;
}

function unplace(run: RunState, uid: number): void {
  const at = whereIs(run, uid);
  if (!at) return;
  if ('slot' in at) delete run.loadout[at.slot];
  else run.crew.find((m) => m.uid === at.member)!.trinkets[at.index] = null;
}

/** Remove attachments left on slots that no longer hold a gun (they return to cargo). */
function tidy(run: RunState): void {
  for (const slot of Object.keys(run.loadout)) {
    const m = /^att:(.+)$/.exec(slot);
    if (m && itemOf(run, run.loadout[m[1]])?.category !== 'gun') delete run.loadout[slot];
  }
}

/** Can this item go in this slot? */
export function canEquip(run: RunState, uid: number, slot: string): boolean {
  const def = itemOf(run, uid);
  const type = slotType(run, slot);
  if (!def || !type || !fits(def, type)) return false;
  if (type === 'attachment') {
    const gun = slot.slice(4);
    if (itemOf(run, run.loadout[gun])?.category !== 'gun') return false;
  }
  return true;
}

/**
 * Equip an item in a slot (from cargo, or moved from another slot). Whatever
 * was there goes to cargo, or swaps into the item's old slot if it fits there.
 * Returns false if it doesn't fit.
 */
export function equip(run: RunState, uid: number, slot: string): boolean {
  if (!canEquip(run, uid, slot)) return false;
  const from = whereIs(run, uid);
  const prev = run.loadout[slot];
  unplace(run, uid);
  run.loadout[slot] = uid;
  if (prev !== undefined && prev !== uid && from && 'slot' in from && canEquip(run, prev, from.slot)) run.loadout[from.slot] = prev;
  tidy(run);
  return true;
}

/** Take an item out of its slot or off its wearer: back to cargo. */
export function unequip(run: RunState, uid: number): void {
  unplace(run, uid);
  tidy(run);
}

/** Put a trinket on a Lee (swapping out whatever it wore there). */
export function wearTrinket(run: RunState, uid: number, member: number, index: number): boolean {
  const def = itemOf(run, uid);
  const m = run.crew.find((x) => x.uid === member);
  if (!def || def.category !== 'trinket' || !m || index < 0 || index >= m.trinkets.length) return false;
  unplace(run, uid);
  m.trinkets[index] = uid;
  return true;
}

/** Put an item where it fits best right away: the first empty compatible slot (trinkets: the first free Lee slot). */
export function autoEquip(run: RunState, uid: number, t: Tuning): boolean {
  const def = itemOf(run, uid);
  if (!def) return false;
  if (def.category === 'trinket') {
    for (const m of run.crew) {
      const i = m.trinkets.indexOf(null);
      if (i >= 0) return wearTrinket(run, uid, m.uid, i);
    }
    return false;
  }
  for (const s of runSlots(run, t)) {
    if (run.loadout[s.id] !== undefined || !canEquip(run, uid, s.id)) continue;
    return equip(run, uid, s.id);
  }
  return false;
}

/** Turn an interior gun to face another way. */
export function setFacing(run: RunState, slot: string, facing: Facing): void {
  run.facings[slot] = facing;
}

// ------------------------------------------------------------ crew

export function release(run: RunState, member: number): void {
  const i = run.crew.findIndex((m) => m.uid === member);
  if (i < 0) return;
  // Trinkets return to cargo (they simply stop being worn).
  run.crew.splice(i, 1);
}

export function setHome(run: RunState, member: number, tile: number | null): void {
  const m = run.crew.find((x) => x.uid === member);
  if (!m) return;
  if (tile !== null) {
    const other = run.crew.find((x) => x !== m && x.home === tile);
    if (other) other.home = m.home;
  }
  m.home = tile;
}

/** Auto-arrange the whole crew (stat-matched posts). */
export function autoArrangeRun(run: RunState, t: Tuning): void {
  const crew = crewSpecs(run, t);
  const homes = autoArrange(buildFor(run), crew, t);
  run.crew.forEach((m, i) => (m.home = homes[i]));
}

/** Homes pointing at tiles that no longer exist (ship changed) are cleared. */
export function fixHomes(run: RunState): void {
  const n = buildGrid(SHIPS[run.ship].layout).tiles.length;
  const used = new Set<number>();
  for (const m of run.crew) {
    if (m.home === null) continue;
    if (m.home < 0 || m.home >= n || used.has(m.home)) m.home = null;
    else used.add(m.home);
  }
}

// ------------------------------------------------------------ encounters

/** The encounter for a fight number: the temporary list, then the last entry repeated with escalation. */
export function encounterFor(fight: number, t: Tuning): { def: EncounterDef; repeat: number; levelBonus: number; extraCrew: number } {
  const list = ENCOUNTERS;
  const i = Math.max(0, fight - 1);
  if (i < list.length) return { def: list[i], repeat: 0, levelBonus: 0, extraCrew: 0 };
  const repeat = i - list.length + 1;
  const every = Math.round(t.escalation.extraCrewEvery);
  return {
    def: list[list.length - 1],
    repeat,
    levelBonus: Math.round(repeat * Math.max(0, t.escalation.levelsPerRepeat)),
    extraCrew: every > 0 ? Math.floor(repeat / every) : 0,
  };
}

export function enemySetups(run: RunState, t: Tuning): BoatSetup[] {
  const enc = encounterFor(run.fight, t);
  return enc.def.enemies.map((spec, i) => enemySetup(spec, t, { levelBonus: enc.levelBonus, extraCrew: enc.extraCrew, salt: run.seed + run.fight * 101 + i }));
}

/** One line about the next fight: ships, crew and levels. */
export function encounterSummary(run: RunState, t: Tuning): string {
  const enc = encounterFor(run.fight, t);
  const setups = enemySetups(run, t);
  const parts = setups.map((s) => {
    const lv = s.crew.length ? Math.round(s.crew.reduce((a, c) => a + (c.level ?? 1), 0) / s.crew.length) : 1;
    return `${SHIPS[s.build.ship]?.name ?? s.build.ship} (${s.crew.length} Lees, lv ${lv})`;
  });
  return `${enc.def.name}${enc.repeat ? ` · again ×${enc.repeat + 1}` : ''}: ${parts.join(' + ')}`;
}

// ------------------------------------------------------------ after a fight

const MEMORIAL: Record<string, string> = {
  cannon: '{name} {adverb} met his end.',
  gatling: '{name} {adverb} caught a hail of bullets.',
  melee: '{name} {adverb} lost a sword fight.',
  pistol: '{name} {adverb} took a pistol shot.',
  sank: '{name} {adverb} went down with a ship.',
  spikes: '{name} {adverb} landed on the spikes.',
  explosion: '{name} {adverb} found the powder store.',
};

export function memorialLine(label: string, type: string, cause: string): string {
  const def = LEE_DEFS[type] ?? LEE_DEFS.basic;
  const adverb = def.adverb.charAt(0).toUpperCase() + def.adverb.slice(1);
  // "Quick Lee #2 quickly met his end." reads best with the adverb mid-sentence.
  return (MEMORIAL[cause] ?? MEMORIAL.cannon).replace('{name}', label).replace('{adverb}', adverb.toLowerCase());
}

/** XP a surviving Lee earned in a fight: a flat amount for surviving plus what it did. */
export function fightXp(l: Lee, t: Tuning): number {
  const L = t.leveling;
  const s = l.stats;
  const work = s.time.gun + s.time.row + s.time.sail + s.time.lookout + s.time.pump + s.time.hooks + s.time.powder + s.time.repair + s.time.bail;
  return Math.round(
    L.survivalXp + s.damageDealt * L.xpPerDamage + s.hpRepaired * L.xpPerRepair + s.waterBailed * L.xpPerBail + s.leeDamage * L.xpPerLeeDamage + s.meleeKills * L.xpPerKill + work * L.xpPerWorkSecond,
  );
}

/**
 * Apply a finished fight to the run: the dead are gone for good (their
 * trinkets return to cargo), survivors earn XP and maybe levels, and a reward
 * is offered. A loss (sunk, or the whole crew lost) ends the run.
 */
export function applyFight(run: RunState, lees: Lee[], won: boolean, t: Tuning): PostFight {
  const post: PostFight = { fight: run.fight, won, xp: [], lost: [], levelUps: [], reward: [], rewardTaken: false };
  const byUid = new Map(lees.filter((l) => l.uid).map((l) => [l.uid, l]));
  for (const m of [...run.crew]) {
    const l = byUid.get(m.uid);
    if (!l) continue; // stayed ashore
    m.fights++;
    m.kills += l.stats.meleeKills;
    if (!l.alive) {
      const cause = l.lostCause ?? 'cannon';
      const f: Fallen = { uid: m.uid, type: m.type, label: m.label, level: m.level, fight: run.fight, cause, line: memorialLine(m.label, m.type, cause) };
      run.fallen.push(f);
      post.lost.push(f);
      release(run, m.uid);
      continue;
    }
    const gained = fightXp(l, t);
    const before = m.level;
    m.xp += gained;
    const cap = Math.max(1, Math.round(t.leveling.levelCap));
    while (m.level < cap && m.xp >= xpToNext(m.level, t)) {
      m.xp -= xpToNext(m.level, t);
      m.level++;
      post.levelUps.push({ uid: m.uid, level: m.level, offers: bonusOffers(m.type, m.level, m.uid, t) });
    }
    if (m.level >= cap) m.xp = 0;
    post.xp.push({ uid: m.uid, gained, levelBefore: before, levelAfter: m.level });
  }
  const crewGone = !run.crew.length;
  if (!won || crewGone) {
    run.stage = 'over';
  } else {
    run.won++;
    post.reward = rewardOffer(run, t);
    run.stage = 'post';
  }
  run.fight++;
  run.pending = post;
  return post;
}

/** Pick a level-up bonus for the next pending level-up of a Lee. */
export function chooseBonus(run: RunState, member: number, bonus: BonusKey): void {
  const post = run.pending;
  if (!post) return;
  const i = post.levelUps.findIndex((u) => u.uid === member);
  if (i < 0) return;
  const m = run.crew.find((x) => x.uid === member);
  if (m && post.levelUps[i].offers.includes(bonus)) m.bonuses.push(bonus);
  post.levelUps.splice(i, 1);
}

/** Auto-pick: the type-weighted default (the first offer) for every pending level-up. */
export function autoPickAll(run: RunState): void {
  while (run.pending?.levelUps.length) {
    const u = run.pending.levelUps[0];
    chooseBonus(run, u.uid, u.offers[0]);
  }
}

/** Three reward cards: parts, Treasures, Trinkets, and sometimes a recruit (never only recruits). */
export function rewardOffer(run: RunState, t: Tuning): RewardCard[] {
  const R = t.run;
  const rng = rngFor(run, `reward:${run.fight}`);
  const n = Math.max(1, Math.round(R.rewardChoices));
  const cards: RewardCard[] = [];
  const every = Math.round(R.recruitEvery);
  const recruit = n > 1 && ((every > 0 && run.won % every === 0) || rng.next() < R.recruitChance);
  if (recruit) {
    const pool = Object.values(LEE_DEFS).map((d) => [d.id, d.draftWeight] as [string, number]);
    const [type] = drawDistinct(rng, pool, 1);
    if (type) cards.push({ kind: 'recruit', type, level: Math.max(1, 1 + Math.floor(Math.max(0, R.recruitLevelPerFight) * run.won)) });
  }
  // Each kind (part, Treasure, Trinket) weighs its tuning weight in total, split between its items by their reward weights.
  const kindOf = (d: ItemDef) => (d.category === 'treasure' || d.category === 'trinket' ? d.category : 'part');
  const kindWeight = { part: R.weightPart, treasure: R.weightTreasure, trinket: R.weightTrinket };
  const offerable = Object.values(ITEMS).filter((d) => d.rewardWeight > 0 && usable(run.ship, d));
  const kindTotal: Record<string, number> = {};
  for (const d of offerable) kindTotal[kindOf(d)] = (kindTotal[kindOf(d)] ?? 0) + d.rewardWeight;
  const pool = offerable.map((d) => [d.id, (kindWeight[kindOf(d)] * d.rewardWeight) / kindTotal[kindOf(d)]] as [string, number]);
  for (const item of drawDistinct(rng, pool, n - cards.length)) cards.push({ kind: 'item', item });
  return cards;
}

/**
 * Take a reward card. Items go to cargo (and are equipped right away if a slot
 * is free). A recruit joins at its level; if the crew is full, `releaseFirst`
 * must name a Lee to let go. Returns false if it can't be taken as asked.
 */
export function takeReward(run: RunState, index: number, t: Tuning, releaseFirst?: number): boolean {
  const post = run.pending;
  const card = post?.reward[index];
  if (!post || !card || post.rewardTaken) return false;
  if (card.kind === 'recruit') {
    if (run.crew.length >= crewMax(run, t)) {
      if (releaseFirst === undefined || !run.crew.some((m) => m.uid === releaseFirst)) return false;
      release(run, releaseFirst);
    }
    const m = addCrew(run, card.type, card.level, t);
    // Placed on a free tile if there is one.
    const n = buildGrid(SHIPS[run.ship].layout).tiles.length;
    const used = new Set(run.crew.map((x) => x.home).filter((h): h is number => h !== null));
    for (let i = 0; i < n; i++) if (!used.has(i)) {
      m.home = i;
      break;
    }
  } else {
    const inst = addItem(run, card.item);
    autoEquip(run, inst.uid, t);
  }
  post.rewardTaken = true;
  return true;
}

/** Done with the post-fight screens: back to refit for the next fight. */
export function finishPost(run: RunState): void {
  if (run.stage === 'over') return;
  run.pending = null;
  run.stage = 'refit';
}

/** "+8% Load speed". */
export function bonusText(b: BonusKey, t: Tuning): string {
  return bonusLabel(b, t, STAT_LABELS);
}

// ------------------------------------------------------------ save

export type LoadResult = { ok: true; run: RunState } | { ok: false; reason: 'none' | 'version' | 'invalid' };

/** Read a saved run. Never throws; never returns half-valid data. */
export function loadRun(json: string | null): LoadResult {
  if (!json) return { ok: false, reason: 'none' };
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (!data || typeof data !== 'object') return { ok: false, reason: 'invalid' };
  const r = data as RunState;
  if (r.version !== SAVE_VERSION) return { ok: false, reason: 'version' };
  if (!validRun(r)) return { ok: false, reason: 'invalid' };
  return { ok: true, run: r };
}

function validRun(r: RunState): boolean {
  try {
    if (!SHIPS[r.ship] || !Array.isArray(r.items) || !Array.isArray(r.crew) || !Array.isArray(r.fallen)) return false;
    if (typeof r.fight !== 'number' || typeof r.seed !== 'number' || typeof r.nextUid !== 'number') return false;
    if (!['draft', 'startPart', 'refit', 'post', 'over'].includes(r.stage)) return false;
    const uids = new Set(r.items.map((i) => i.uid));
    for (const i of r.items) if (!ITEMS[i.item] || typeof i.uid !== 'number') return false;
    for (const [slot, uid] of Object.entries(r.loadout ?? {})) {
      if (!uids.has(uid)) return false;
      if (!isTreasureSlot(slot) && !slotById(SHIPS[r.ship], slot)) return false;
    }
    for (const m of r.crew) {
      if (!LEE_DEFS[m.type] || !Array.isArray(m.trinkets) || !Array.isArray(m.bonuses)) return false;
      for (const u of m.trinkets) if (u !== null && !uids.has(u)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function saveRun(run: RunState): string {
  return JSON.stringify({ ...run, version: SAVE_VERSION });
}
