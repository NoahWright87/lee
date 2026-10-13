// A run: the ship you picked, everything you own (items as instances, so you
// can carry two of the same), what's equipped where, your crew (persistent
// identity, levels, bonuses, trinkets, homes, wounds), the fallen, your gold,
// the hull's damage, the fight being set up and what the last one left to
// resolve. Ports (sim/port.ts) and the sea map (sim/seaMap.ts) live in it too.
// Pure data and pure functions: serializable, versioned, and nothing here
// knows about screens. Which screen comes next lives in the Controller.

import { difficulty } from '../config/difficulty';
import type { EnemySpec } from '../config/encounters';
import { ITEMS, type ItemDef } from '../config/items';
import { LEE_DEFS, STAT_LABELS } from '../config/lees';
import { SHIPS } from '../config/ships';
import type { Facing, SlotType } from '../config/slots';
import type { Tuning } from '../config/tuning';
import type { Lee } from './crew';
import { allSlots, fits, presetBuild, slotById, trinketMods, type BoatBuild } from './loadout';
import { autoBonuses, bonusLabel, bonusMods, bonusOffers, combineMods, xpToNext, type BonusKey } from './levels';
import { drawDistinct, rngFor as seededRng, type Rng } from './math';
import { autoArrange, enemySetup, fitFor, postsFor, type BoatSetup, type CrewSpec } from './setup';
import type { PortState } from './port';
import type { SeaMap } from './seaMap';
import { buildGrid, tileAtCell } from './grid';
import type { Job } from '../config/lees';

/** Bump whenever a change makes older saves unreadable. Older saves are then offered a reset, never loaded. */
export const SAVE_VERSION = 3;

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
  /** Starting tile (null = not placed: stays ashore). Its station sets the starting job. */
  home: number | null;
  /** A starting job other than its tile's (ship presets), cleared when it's moved. */
  job?: Job | null;
  /** Fight number they joined in. */
  joined: number;
  /** Lifetime numbers (for cards and the memorial). */
  fights: number;
  kills: number;
  /** HP carried between fights, as a share of max (1 = unhurt). */
  hp: number;
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

/** How a beaten enemy ship went out, and what it was worth. */
export interface EnemyOutcome {
  ship: string;
  how: 'sunk' | 'captured';
  /** Points it was built with (what it pays). */
  budget: number;
  /** Items on tiles that weren't blown out (what a capture can take). */
  intact: string[];
}

/** What a finished fight hands the run. */
export interface FightReport {
  won: boolean;
  /** Your Lees after the fight. */
  lees: Lee[];
  /** Each enemy ship (only those that were beaten). */
  enemies: EnemyOutcome[];
  /** The last enemy Lee to fall (not by sinking): who might surrender. */
  lastEnemy: { type: string; level: number } | null;
  /** Your hull after the fight: structure share per part. */
  hull: number[];
}

/** A stop that isn't a fight, after you arrive: what happened. */
export interface StopEvent {
  type: string;
  text: string;
}

/** What a fight (or a stop) left to resolve: XP shown, level-ups to pick, spoils, a surrender, a reward to choose. */
export interface PostFight {
  /** Unique per post screen (an event and the fight after it share a fight number). */
  id: number;
  fight: number;
  won: boolean;
  xp: XpGain[];
  lost: Fallen[];
  /** One entry per level gained (a Lee can gain two in one fight), in order. */
  levelUps: { uid: number; level: number; offers: BonusKey[] }[];
  /** Gold earned. */
  gold: number;
  /** How each enemy ship went out. */
  outcomes: { ship: string; how: 'sunk' | 'captured' }[];
  /** Items taken (already in cargo). */
  spoils: string[];
  /** The last enemy Lee offers to join (null = nobody). */
  surrender: { type: string; level: number } | null;
  surrenderDone: boolean;
  /** A pick (special rewards, wrecks, castaways); empty = none. */
  reward: RewardCard[];
  rewardTaken: boolean;
  /** Free repair and healing just applied (shares of what was missing). */
  repaired: number;
  healed: number;
  /** A stop that wasn't a fight. */
  event: StopEvent | null;
}

/** The fight being set up: where, what it's worth, and who. */
export interface Encounter {
  /** Map stop it's at (null = none). */
  stop: number | null;
  /** Stop type id ('fight', 'hard'). */
  type: string;
  budget: number;
  enemies: EnemySpec[];
  /** × gold paid (map style). */
  gold: number;
  /** Offers a special reward when won. */
  special: boolean;
}

export interface RunTotals {
  goldEarned: number;
  ports: number;
  sunk: number;
  captured: number;
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
  /** Where the run is: in port, on the sea map, setting up a fight, after one, or over. */
  stage: RunStage;
  pending: PostFight | null;
  /** Difficulty id (src/config/difficulty.ts). */
  difficulty: string;
  gold: number;
  /** Hull structure share per part (1 = intact), carried between fights. */
  hull: number[];
  /** Journeys completed (depth). */
  journey: number;
  /** The fight being set up (stage 'refit'), or null. */
  encounter: Encounter | null;
  /** The port you're in (stage 'port'), or null. */
  port: PortState | null;
  /** The sea between two ports (stage 'map', and fights on it), or null. */
  map: SeaMap | null;
  /** Bank interest paid on reaching the next port. */
  bankOwed: number;
  /** Custom start: no hull bought yet. */
  noHull: boolean;
  totals: RunTotals;
}

export type RunStage = 'port' | 'map' | 'refit' | 'post' | 'over';

export const treasureSlot = (i: number) => `treasure:${i}`;
export const isTreasureSlot = (id: string) => /^treasure:\d+$/.test(id);

/** A random stream for one purpose of this run ("spoils:4", "shop:2"...). */
export function rngFor(run: RunState, what: string): Rng {
  return seededRng(run.seed, what);
}

// ------------------------------------------------------------ setup

/** An empty run (no ship fitted, no crew): the base of a preset or Custom start. */
export function blankRun(ship: string, seed: number, diff: string): RunState {
  const id = SHIPS[ship] ? ship : 'basic';
  return {
    version: SAVE_VERSION,
    seed: seed >>> 0,
    ship: id,
    items: [],
    loadout: {},
    facings: {},
    crew: [],
    fallen: [],
    fight: 1,
    won: 0,
    counters: {},
    nextUid: 1,
    stage: 'refit',
    pending: null,
    difficulty: difficulty(diff).id,
    gold: 0,
    hull: freshHull(id),
    journey: 0,
    encounter: null,
    port: null,
    map: null,
    bankOwed: 0,
    noHull: false,
    totals: { goldEarned: 0, ports: 0, sunk: 0, captured: 0 },
  };
}

/** An undamaged hull for a ship: every part at full structure. */
export function freshHull(ship: string): number[] {
  return (SHIPS[ship] ?? SHIPS.basic).layout.parts.map(() => 1);
}

/**
 * A new run: the ship's preset (loadout, treasures, crew and where they
 * stand) and a little starting gold. It's ready to sail.
 */
export function newRun(ship: string, seed: number, t: Tuning, diff = 'normal'): RunState {
  const run = blankRun(ship, seed, diff);
  run.gold = Math.round(Math.max(0, t.economy.startGold) * difficulty(diff).gold);
  const build = presetBuild(run.ship);
  for (const [slot, item] of Object.entries(build.loadout)) run.loadout[slot] = addItem(run, item).uid;
  (build.treasures ?? []).slice(0, treasureSlots(run, t)).forEach((item, i) => (run.loadout[treasureSlot(i)] = addItem(run, item).uid));
  run.facings = { ...(build.facings ?? {}) };
  const grid = buildGrid(SHIPS[run.ship].layout);
  for (const p of SHIPS[run.ship].preset.crew) {
    const m = addCrew(run, p.type, 1, t);
    m.home = tileAtCell(grid, p.tile[0], p.tile[1])?.index ?? null;
    if (p.job) m.job = p.job;
  }
  fixHomes(run);
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
    hp: 1,
  };
  // A recruit above level 1 comes with auto-picked bonuses.
  for (const b of autoBonuses(def.id, Math.max(1, level), member.uid, t)) member.bonuses.push(b);
  member.level = Math.max(1, Math.min(Math.round(t.leveling.levelCap), level));
  run.crew.push(member);
  return member;
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
  return run.crew.map((m) => ({ type: m.type, home: m.home, uid: m.uid, label: m.label, level: m.level, mods: memberMods(run, m, t), job: m.job ?? undefined, hp: m.hp ?? 1 }));
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

/** Items not equipped, worn or held: the cargo hold (Lees ashore are in it too, see ashore()). */
export function cargo(run: RunState): ItemInstance[] {
  const used = new Set<number>(Object.values(run.loadout));
  for (const u of worn(run)) used.add(u);
  return run.items.filter((x) => !used.has(x.uid));
}

/** Crew members ashore: in the cargo hold with the items. */
export function ashore(run: RunState): CrewMember[] {
  return run.crew.filter((m) => m.home === null);
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

/** Put an item in the first empty spot it fits (trinkets: the first free Lee slot). Never moves anything already placed. */
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
    if (other) {
      other.home = m.home;
      other.job = null;
    }
  }
  m.home = tile;
  m.job = null;
}

/**
 * The "I got new stuff and I'm lazy" button: every item in cargo goes into the
 * first empty spot it fits, trinkets onto Lees with a free trinket slot, and
 * Lees ashore onto free tiles (the best post for each). Nothing already placed moves.
 */
export function autoEquipAll(run: RunState, t: Tuning): void {
  for (const inst of cargo(run)) autoEquip(run, inst.uid, t);
  const ashore = run.crew.filter((m) => m.home === null);
  if (ashore.length) {
    const used = new Set(run.crew.map((m) => m.home).filter((h): h is number => h !== null));
    const posts = postsFor(buildFor(run), t).filter((p) => !used.has(p.tile));
    const specs = crewSpecs(run, t);
    const pairs: { post: number; rank: number; m: CrewMember; v: number }[] = [];
    posts.forEach((post, rank) => {
      for (const m of ashore) {
        const spec = specs.find((s) => s.uid === m.uid)!;
        pairs.push({ post: post.tile, rank, m, v: fitFor(post.station, spec, t) });
      }
    });
    pairs.sort((a, b) => b.v - a.v || a.rank - b.rank || a.m.uid - b.m.uid);
    const taken = new Set<number>();
    for (const p of pairs) {
      if (p.m.home !== null || taken.has(p.post)) continue;
      p.m.home = p.post;
      taken.add(p.post);
    }
  }
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

// ------------------------------------------------------------ cargo, hull, wounds

/** Most items the hold carries (Lees ashore don't count). */
export function cargoLimit(run: RunState, t: Tuning): number {
  return Math.max(0, Math.round(t.ships[run.ship]?.cargo ?? 6));
}

/** Items over the hold's limit (0 = fine). You can't sail with any. */
export function cargoOver(run: RunState, t: Tuning): number {
  return Math.max(0, cargo(run).length - cargoLimit(run, t));
}

/** Throw an item away for good (it must be in cargo). */
export function discard(run: RunState, uid: number): void {
  if (whereIs(run, uid)) return;
  run.items = run.items.filter((x) => x.uid !== uid);
}

/** Hull integrity: structure share weighted by each part's HP (1 = intact). */
export function hullShare(run: RunState, t: Tuning): number {
  const parts = (SHIPS[run.ship] ?? SHIPS.basic).layout.parts;
  let have = 0;
  let total = 0;
  parts.forEach((p, i) => {
    const hp = Math.max(1, t.boat.parts[p.stats]?.hp ?? 1);
    have += hp * Math.min(1, Math.max(0, run.hull[i] ?? 1));
    total += hp;
  });
  return total > 0 ? have / total : 1;
}

/** Repair a share of what's missing from every part (1 = good as new). */
export function repairHull(run: RunState, share: number): void {
  const s = Math.min(1, Math.max(0, share));
  run.hull = run.hull.map((f) => f + (1 - f) * s);
}

/** Heal every Lee a share of what it's missing. */
export function healCrew(run: RunState, share: number): void {
  const s = Math.min(1, Math.max(0, share));
  for (const m of run.crew) m.hp = (m.hp ?? 1) + (1 - (m.hp ?? 1)) * s;
}

/** Equipped treasures (item ids), for between-fight effects. */
export function treasuresOf(run: RunState): string[] {
  return buildFor(run).treasures ?? [];
}

/** The best number a treasure param gives (0 = none of that treasure equipped). */
export function treasureParam(run: RunState, item: string, param: string, t: Tuning): number {
  if (!treasuresOf(run).includes(item)) return 0;
  const v = t.items[item]?.[param];
  return typeof v === 'number' ? v : ITEMS[item]?.params[param] ?? 0;
}

/** Free repair and healing after a fight or event: tuning × difficulty, plus Handy Lees and treasures. */
export function freeFix(run: RunState, t: Tuning): { repair: number; heal: number } {
  const d = difficulty(run.difficulty);
  const handy = run.crew.filter((m) => m.type === 'handy' && m.home !== null).length;
  const repair = Math.max(0, t.run.autoRepair) * d.freeFix + handy * Math.max(0, t.run.handyRepair) + treasureParam(run, 'carpenterChest', 'repair', t);
  const heal = Math.max(0, t.run.autoHeal) * d.freeFix + treasureParam(run, 'surgeonKit', 'heal', t);
  return { repair: Math.min(1, repair), heal: Math.min(1, heal) };
}

// ------------------------------------------------------------ encounters

/** The fight being set up, as boats (built from its enemy specs, the same every time). */
export function enemySetups(run: RunState, t: Tuning): BoatSetup[] {
  const enc = run.encounter;
  if (!enc) return [];
  return enc.enemies.map((spec, i) => enemySetup(spec, t, { salt: run.seed + run.fight * 101 + i }));
}

/** "Basic Ship + Friend Ship". */
export function encounterSummary(run: RunState): string {
  const enc = run.encounter;
  if (!enc || !enc.enemies.length) return 'Nobody';
  return enc.enemies.map((s) => SHIPS[s.ship]?.name ?? s.ship).join(' + ');
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
  const work = s.time.gun + s.time.row + s.time.sail + s.time.lookout + s.time.pump + s.time.powder + s.time.repair + s.time.bail;
  return Math.round(
    L.survivalXp + s.damageDealt * L.xpPerDamage + s.hpRepaired * L.xpPerRepair + s.waterBailed * L.xpPerBail + s.leeDamage * L.xpPerLeeDamage + s.meleeKills * L.xpPerKill + work * L.xpPerWorkSecond,
  );
}

/** An empty post-fight record. */
export function emptyPost(run: RunState, won: boolean): PostFight {
  return {
    id: run.nextUid++,
    fight: run.fight,
    won,
    xp: [],
    lost: [],
    levelUps: [],
    gold: 0,
    outcomes: [],
    spoils: [],
    surrender: null,
    surrenderDone: false,
    reward: [],
    rewardTaken: false,
    repaired: 0,
    healed: 0,
    event: null,
  };
}

/** Add gold earned at sea (counts toward the run's total). */
export function earn(run: RunState, gold: number): number {
  const g = Math.max(0, Math.round(gold));
  run.gold += g;
  run.totals.goldEarned += g;
  return g;
}

/** After a fight or an event: the free share of repair and healing. */
export function applyFreeFix(run: RunState, post: PostFight, t: Tuning): void {
  const fix = freeFix(run, t);
  repairHull(run, fix.repair);
  healCrew(run, fix.heal);
  post.repaired = fix.repair;
  post.healed = fix.heal;
}

/**
 * Apply a finished fight to the run: the dead are gone for good (their
 * trinkets return to cargo), survivors earn XP and maybe levels and keep
 * their wounds, the hull keeps its damage (minus the free repair), and a win
 * pays: gold for every ship beaten, a part from each one captured, maybe a
 * surrender, and a special pick after a hard fight. A loss (sunk, or the whole
 * crew lost) ends the run.
 */
export function applyFight(run: RunState, report: FightReport, t: Tuning): PostFight {
  const won = report.won;
  const post = emptyPost(run, won);
  const byUid = new Map(report.lees.filter((l) => l.uid).map((l) => [l.uid, l]));
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
    m.hp = Math.min(1, Math.max(0.05, l.hp / Math.max(1, l.maxHp)));
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
  if (report.hull.length) run.hull = run.hull.map((f, i) => Math.min(1, Math.max(0, report.hull[i] ?? f)));
  const crewGone = !run.crew.length;
  if (!won || crewGone) {
    run.stage = 'over';
  } else {
    run.won++;
    const enc = run.encounter;
    const rng = rngFor(run, `spoils:${run.fight}`);
    const goldMul = Math.max(0, enc?.gold ?? 1);
    for (const e of report.enemies) {
      post.outcomes.push({ ship: e.ship, how: e.how });
      post.gold += earn(run, e.budget * Math.max(0, t.spoils.goldPerBudget) * goldMul);
      if (e.how === 'sunk') run.totals.sunk++;
      else {
        run.totals.captured++;
        // A capture: parts from tiles that weren't blown out.
        const pool = e.intact.map((id, i) => [i, ITEMS[id] ? 1 : 0] as [number, number]);
        for (const i of drawDistinct(rng, pool, Math.max(0, Math.round(t.spoils.captureParts)))) {
          addItem(run, e.intact[i]);
          post.spoils.push(e.intact[i]);
        }
      }
    }
    // Sometimes the last enemy Lee standing surrenders.
    const chance = Math.max(0, t.spoils.surrender) * difficulty(run.difficulty).surrender;
    if (report.lastEnemy && LEE_DEFS[report.lastEnemy.type] && rng.next() < chance) post.surrender = { ...report.lastEnemy };
    if (enc?.special) post.reward = specialReward(run, t);
    if (enc && enc.stop !== null && run.map?.stops[enc.stop]) run.map.stops[enc.stop].cleared = true;
    applyFreeFix(run, post, t);
    run.stage = 'post';
  }
  run.encounter = null;
  run.fight++;
  run.pending = post;
  return post;
}

/** Take (or refuse) the surrendering Lee. If the crew is full, `releaseFirst` must name someone to let go. */
export function answerSurrender(run: RunState, accept: boolean, t: Tuning, releaseFirst?: number): boolean {
  const post = run.pending;
  const s = post?.surrender;
  if (!post || !s || post.surrenderDone) return false;
  if (accept) {
    if (run.crew.length >= crewMax(run, t)) {
      if (releaseFirst === undefined || !run.crew.some((m) => m.uid === releaseFirst)) return false;
      release(run, releaseFirst);
    }
    // They join ashore, a bit battered.
    const m = addCrew(run, s.type, s.level, t);
    m.hp = 0.5;
  }
  post.surrenderDone = true;
  return true;
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

/** Items a ship of this run can use somewhere. */
export function usableItem(run: RunState, d: ItemDef): boolean {
  return usable(run.ship, d);
}

/**
 * A special reward (hard fights): something rarer. A rare trinket or
 * treasure, a Lee a level above your best, and parts.
 */
export function specialReward(run: RunState, t: Tuning): RewardCard[] {
  const rng = rngFor(run, `special:${run.fight}`);
  const n = Math.max(1, Math.round(t.run.rewardChoices));
  const cards: RewardCard[] = [];
  const rare = Object.values(ITEMS).filter((d) => d.rare && usable(run.ship, d));
  const trinkets = Object.values(ITEMS).filter((d) => (d.category === 'trinket' || d.category === 'treasure') && d.rewardWeight > 0);
  const pool = (rare.length ? rare : trinkets).map((d) => [d.id, d.rewardWeight || 1] as [string, number]);
  for (const id of drawDistinct(rng, pool, 1)) cards.push({ kind: 'item', item: id });
  const types = Object.values(LEE_DEFS)
    .filter((d) => d.draftWeight > 0)
    .map((d) => [d.id, d.draftWeight] as [string, number]);
  const [type] = drawDistinct(rng, types, 1);
  const best = run.crew.reduce((a, m) => Math.max(a, m.level), 1);
  if (type && n > 1) cards.push({ kind: 'recruit', type, level: Math.min(Math.round(t.leveling.levelCap), best + 1) });
  const parts = Object.values(ITEMS).filter(
    (d) => d.category !== 'trinket' && d.category !== 'treasure' && d.rewardWeight > 0 && usable(run.ship, d) && !cards.some((c) => c.kind === 'item' && c.item === d.id),
  );
  const pool2 = parts.map((d) => [d.id, d.rewardWeight * (d.category === 'gun' ? 1.5 : 1)] as [string, number]);
  for (const id of drawDistinct(rng, pool2, n - cards.length)) cards.push({ kind: 'item', item: id });
  return cards;
}

/** A pick of parts floating in a wreck (no trinkets or treasures). */
export function wreckReward(run: RunState, t: Tuning, salt: string): RewardCard[] {
  const rng = rngFor(run, `wreck:${salt}`);
  const n = Math.max(1, Math.round(t.run.rewardChoices));
  const pool = Object.values(ITEMS)
    .filter((d) => d.rewardWeight > 0 && !d.rare && d.category !== 'trinket' && d.category !== 'treasure' && usable(run.ship, d))
    .map((d) => [d.id, d.rewardWeight] as [string, number]);
  return drawDistinct(rng, pool, n).map((item) => ({ kind: 'item', item }));
}

/**
 * Take a reward card. Items go to cargo. A recruit joins at its level; if the
 * crew is full, `releaseFirst` must name a Lee to let go. Returns false if it
 * can't be taken as asked.
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
    // Recruits wait ashore (in cargo) until placed.
    addCrew(run, card.type, card.level, t);
  } else addItem(run, card.item);
  post.rewardTaken = true;
  return true;
}

/** Skip the pick. */
export function skipReward(run: RunState): void {
  if (run.pending) run.pending.rewardTaken = true;
}

/** Done with the post-fight screens: back to the sea map (or wherever the run goes next). */
export function finishPost(run: RunState): void {
  if (run.stage === 'over') return;
  run.pending = null;
  run.stage = run.map ? 'map' : run.port ? 'port' : 'refit';
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
    if (!['port', 'map', 'refit', 'post', 'over'].includes(r.stage)) return false;
    if (typeof r.gold !== 'number' || !Array.isArray(r.hull) || !r.totals) return false;
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
