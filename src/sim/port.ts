// Ports: a name, 1–2 specialties, services (repair and healing always), shop
// stock, recruits, rerolls, a shipyard and a bank. Prices come from the one
// point-cost table (src/config/economy.ts) × gold rate × depth inflation × the
// port's modifier for an item's tags. Selling pays a share of the buy price,
// more where the port specializes in it.
//
// Pure data and functions on the RunState, like run.ts.

import { chassisCost, itemCost, leeCost } from '../config/economy';
import { difficulty } from '../config/difficulty';
import { ITEMS } from '../config/items';
import { LEE_DEFS } from '../config/lees';
import { PORT_NAME_FIRST, PORT_NAME_SECOND, SERVICES, specialtyPool, STOCK, type ServiceId, type Specialty } from '../config/ports';
import { MAP_STYLES } from '../config/sea';
import { SHIP_ORDER, SHIPS } from '../config/ships';
import type { Tuning } from '../config/tuning';
import { drawDistinct, pickWeighted, type Rng } from './math';
import { autoEquip as autoEquipOne, buildFor, addCrew, addItem, cargo, crewMax, fixHomes, freshHull, hullShare, itemOf, release, rngFor, treasureParam, whereIs, type RunState } from './run';

/** A port as seen from the one before: enough to choose it. */
export interface PortPlan {
  name: string;
  services: ServiceId[];
  specialties: Specialty[];
  /** The kind of sea between here and there (map style ids; they combine). */
  styles: string[];
}

export type Shop = 'shop' | 'specialty' | 'dealer';

export type StockEntry = { kind: 'item'; item: string; sold: boolean } | { kind: 'lee'; type: string; level: number; sold: boolean };

export interface PortState extends PortPlan {
  /** Which port of the run this is (0 = the first). */
  index: number;
  /** Journeys completed when you arrived (prices inflate with it). */
  journey: number;
  stock: Partial<Record<Shop | 'tavern', StockEntry[]>>;
  /** Rerolls bought in this port (each costs more). */
  rerolls: number;
  /** Where you can sail next. */
  offers: PortPlan[];
  /** Custom start: every service, a wide stock. */
  full: boolean;
}

// ------------------------------------------------------------ generation

/** Tags your ship and crew carry, counted (destinations lean toward them). */
export function buildTagCounts(run: RunState): Record<string, number> {
  const out: Record<string, number> = {};
  const add = (tags: readonly string[]) => tags.forEach((x) => (out[x] = (out[x] ?? 0) + 1));
  if (!run.noHull) add(SHIPS[run.ship]?.tags ?? []);
  for (const i of Object.values(buildFor(run).loadout)) add(ITEMS[i]?.tags ?? []);
  for (const m of run.crew) {
    add(LEE_DEFS[m.type]?.tags ?? []);
    out[`lee:${m.type}`] = (out[`lee:${m.type}`] ?? 0) + 1;
  }
  return out;
}

function portName(rng: Rng, taken: Set<string>): string {
  for (let i = 0; i < 20; i++) {
    const n = `${PORT_NAME_FIRST[Math.floor(rng.next() * PORT_NAME_FIRST.length)]} ${PORT_NAME_SECOND[Math.floor(rng.next() * PORT_NAME_SECOND.length)]}`;
    if (!taken.has(n)) return n;
  }
  return `Port ${Math.floor(rng.next() * 1000)}`;
}

/** A destination: name, specialties (leaning toward your build), services, and the sea in between. */
export function makePlan(rng: Rng, run: RunState, t: Tuning, taken: Set<string>): PortPlan {
  const tags = buildTagCounts(run);
  const pool = specialtyPool().map(([s, w]) => [s, w + (tags[s.kind === 'tag' ? s.id : `lee:${s.id}`] ?? 0) * 0.5] as [Specialty, number]);
  const specialties = drawDistinct(rng, pool, rng.next() < 0.4 ? 2 : 1);
  const services = (Object.keys(SERVICES) as ServiceId[]).filter((id) => rng.next() < SERVICES[id].chance);
  const styles: string[] = [];
  const first = pickWeighted(rng, Object.values(MAP_STYLES).map((s) => [s.id, s.chance] as [string, number]));
  if (first) styles.push(first);
  if (rng.next() < t.map.secondStyle) {
    const second = pickWeighted(
      rng,
      Object.values(MAP_STYLES)
        .filter((s) => s.id !== 'open' && !styles.includes(s.id))
        .map((s) => [s.id, s.chance] as [string, number]),
    );
    if (second && first !== 'open') styles.push(second);
    else if (second) styles[0] = second;
  }
  const name = portName(rng, taken);
  taken.add(name);
  return { name, services, specialties, styles };
}

/** The destinations offered from a port (2–3 by tuning). */
export function makeOffers(run: RunState, index: number, t: Tuning, exclude: string): PortPlan[] {
  const rng = rngFor(run, `offers:${index}`);
  const taken = new Set([exclude]);
  return Array.from({ length: Math.max(1, Math.round(t.map.destinations)) }, () => makePlan(rng, run, t, taken));
}

/** Arrive in a port: it opens with fresh stock, and offers where to go next. */
export function enterPort(run: RunState, plan: PortPlan, t: Tuning, opts: { full?: boolean } = {}): PortState {
  const index = run.totals.ports;
  const full = !!opts.full;
  const port: PortState = {
    ...plan,
    services: full ? (Object.keys(SERVICES) as ServiceId[]) : [...new Set<ServiceId>(['shipwright', 'tavern', ...plan.services])],
    index,
    journey: run.journey,
    stock: {},
    rerolls: 0,
    offers: [],
    full,
  };
  run.port = port;
  restock(run, t);
  port.offers = makeOffers(run, index, t, plan.name);
  run.totals.ports++;
  return port;
}

/** Names of a port's specialties' tags (Lee-type specialties count their Lee's tags). */
export function specialtyTags(port: PortPlan): Set<string> {
  const out = new Set<string>();
  for (const s of port.specialties) {
    if (s.kind === 'tag') out.add(s.id);
    else for (const tag of LEE_DEFS[s.id]?.tags ?? []) out.add(tag);
  }
  return out;
}

/** Does a port specialize in this item? */
export function itemMatches(port: PortPlan, item: string): boolean {
  const tags = specialtyTags(port);
  return (ITEMS[item]?.tags ?? []).some((x) => tags.has(x));
}

/** Does a port specialize in this Lee type? */
export function leeMatches(port: PortPlan, type: string): boolean {
  return port.specialties.some((s) => (s.kind === 'lee' ? s.id === type : (LEE_DEFS[type]?.tags ?? []).includes(s.id as never)));
}

/** Fill every shop and the tavern (keeps nothing). */
export function restock(run: RunState, t: Tuning): void {
  const port = run.port;
  if (!port) return;
  for (const shop of ['shop', 'specialty', 'dealer', 'tavern'] as const) stockShop(run, shop, t);
}

/** Fill one shop with new stock (its offer is drawn from the port's seed and how many rerolls happened). */
export function stockShop(run: RunState, shop: Shop | 'tavern', t: Tuning): void {
  const port = run.port;
  if (!port) return;
  const has = shop === 'tavern' ? port.services.includes('tavern') : port.services.includes(shop);
  if (!has) {
    delete port.stock[shop];
    return;
  }
  const rng = rngFor(run, `stock:${port.index}:${shop}:${port.rerolls}`);
  const wide = port.full ? 2 : 1;
  const usable = (id: string) => {
    const d = ITEMS[id];
    if (run.noHull) return 1;
    const types = new Set(SHIPS[run.ship].slots.map((s) => s.type as string));
    types.add('floor');
    types.add('treasure');
    types.add('trinket');
    if (types.has('edge') || types.has('interior')) types.add('attachment');
    return d.fits.some((f) => types.has(f)) ? 2 : 0.4;
  };
  if (shop === 'tavern') {
    const types = Object.values(LEE_DEFS)
      .filter((d) => d.draftWeight > 0 || d.id === 'basic')
      .map((d) => [d.id, (d.draftWeight || 0.6) * (leeMatches(port, d.id) ? (port.specialties.some((s) => s.kind === 'lee' && s.id === d.id) ? 6 : 2) : 1)] as [string, number]);
    const n = STOCK.tavern * wide;
    port.stock.tavern = Array.from({ length: n }, () => {
      const type = pickWeighted(rng, types) ?? 'basic';
      const level = Math.max(1, Math.min(Math.round(t.leveling.levelCap), 1 + Math.floor(port.journey * 0.7 + rng.range(-0.5, 1.2))));
      return { kind: 'lee', type, level, sold: false } as StockEntry;
    });
    return;
  }
  let pool: [string, number][];
  let n: number;
  const items = Object.values(ITEMS).filter((d) => d.rewardWeight > 0);
  if (shop === 'shop') {
    pool = items.filter((d) => !d.rare).map((d) => [d.id, d.rewardWeight * usable(d.id) * (itemMatches(port, d.id) ? 1.5 : 1)]);
    n = STOCK.shop * wide;
  } else if (shop === 'specialty') {
    pool = items.filter((d) => !d.rare).map((d) => [d.id, d.rewardWeight * usable(d.id) * (itemMatches(port, d.id) ? 6 : 0.25)]);
    n = STOCK.specialty * wide;
  } else {
    pool = items.filter((d) => d.rare || d.category === 'trinket' || d.category === 'treasure').map((d) => [d.id, d.rewardWeight * (d.rare ? 3 : 1)]);
    n = STOCK.dealer * wide;
  }
  // Repeats allowed past the pool size (a gunsmith can have two cannons).
  const out: StockEntry[] = drawDistinct(rng, pool, n).map((item) => ({ kind: 'item', item, sold: false }));
  while (out.length < n && pool.length) out.push({ kind: 'item', item: pickWeighted(rng, pool)!, sold: false });
  port.stock[shop] = out;
}

// ------------------------------------------------------------ prices

/** Prices × this at a depth. */
export function inflation(journey: number, t: Tuning): number {
  return Math.pow(1 + Math.max(0, t.economy.inflation), Math.max(0, journey));
}

/** What an item costs here. The trinket dealer charges more. */
export function buyPrice(port: PortState, item: string, t: Tuning, shop: Shop = 'shop'): number {
  const E = t.economy;
  const spec = itemMatches(port, item) ? E.specialtyBuy : 1;
  const dealer = shop === 'dealer' ? 1.6 : 1;
  return Math.max(1, Math.round(itemCost(item) * E.goldRate * inflation(port.journey, t) * spec * dealer));
}

/** What an item sells for here: a share of its price, more where the port specializes in it. */
export function sellPrice(port: PortState, item: string, t: Tuning): number {
  const E = t.economy;
  const share = itemMatches(port, item) ? E.sellShareSpecialty : E.sellShare;
  return Math.max(0, Math.round(itemCost(item) * E.goldRate * inflation(port.journey, t) * share));
}

/** What a recruit costs here. */
export function recruitPrice(port: PortState, type: string, level: number, t: Tuning): number {
  const E = t.economy;
  const spec = leeMatches(port, type) ? E.specialtyBuy : 1;
  return Math.max(1, Math.round(leeCost(type, level) * E.recruitPrice * E.goldRate * inflation(port.journey, t) * spec));
}

/** The next shop reroll here. The Haggler's Ledger makes it cheaper; the Lucky Coin makes it climb slower. */
export function rerollPrice(run: RunState, t: Tuning): number {
  const port = run.port;
  if (!port) return 0;
  const E = t.economy;
  const cheap = treasureParam(run, 'ledger', 'rerollCost', t) || 1;
  const coin = treasureParam(run, 'luckyCoin', 'rerollRamp', t);
  const ramp = coin ? Math.min(coin, E.rerollRamp) : E.rerollRamp;
  return Math.max(1, Math.round(E.rerollBase * inflation(port.journey, t) * cheap * Math.pow(Math.max(1, ramp), port.rerolls)));
}

/** Gold to fully repair the hull here (× how much is missing). */
export function repairPrice(run: RunState, t: Tuning): number {
  const missing = 1 - hullShare(run, t);
  if (missing <= 1e-6 || run.noHull) return 0;
  const E = t.economy;
  return Math.max(1, Math.round(chassisCost(run.ship) * E.repairCost * E.goldRate * inflation(run.port?.journey ?? run.journey, t) * difficulty(run.difficulty).fixPrice * missing));
}

/** Gold to fully heal one Lee here. */
export function healPrice(run: RunState, member: number, t: Tuning): number {
  const m = run.crew.find((x) => x.uid === member);
  if (!m || m.hp >= 1 - 1e-6) return 0;
  const E = t.economy;
  return Math.max(1, Math.round(leeCost(m.type, m.level) * E.healCost * E.goldRate * inflation(run.port?.journey ?? run.journey, t) * difficulty(run.difficulty).fixPrice * (1 - m.hp)));
}

export function healAllPrice(run: RunState, t: Tuning): number {
  return run.crew.reduce((a, m) => a + healPrice(run, m.uid, t), 0);
}

/** A chassis at the shipyard. */
export function chassisPrice(port: PortState, ship: string, t: Tuning): number {
  return Math.max(1, Math.round(chassisCost(ship) * t.economy.goldRate * inflation(port.journey, t)));
}

/** What your hull trades in for. */
export function tradeInValue(run: RunState, t: Tuning): number {
  if (run.noHull || !run.port) return 0;
  return Math.round(chassisPrice(run.port, run.ship, t) * Math.max(0, t.economy.tradeIn) * hullShare(run, t));
}

// ------------------------------------------------------------ services

function pay(run: RunState, gold: number): boolean {
  if (gold > run.gold) return false;
  run.gold -= gold;
  return true;
}

/** Buy an item or a recruit from a shop or the tavern. Items go to cargo (the dock), recruits ashore. */
export function buy(run: RunState, shop: Shop | 'tavern', index: number, t: Tuning): boolean {
  const port = run.port;
  const e = port?.stock[shop]?.[index];
  if (!port || !e || e.sold) return false;
  if (e.kind === 'item') {
    if (!pay(run, buyPrice(port, e.item, t, shop as Shop))) return false;
    addItem(run, e.item);
  } else {
    if (!run.noHull && run.crew.length >= crewMax(run, t)) return false;
    if (!pay(run, recruitPrice(port, e.type, e.level, t))) return false;
    addCrew(run, e.type, e.level, t);
  }
  e.sold = true;
  return true;
}

/** Sell an item from cargo (equipped items must be taken off first). */
export function sell(run: RunState, uid: number, t: Tuning): boolean {
  const port = run.port;
  const def = itemOf(run, uid);
  if (!port || !def || whereIs(run, uid)) return false;
  if (!(['shop', 'specialty', 'dealer'] as const).some((x) => port.services.includes(x))) return false;
  run.items = run.items.filter((x) => x.uid !== uid);
  run.gold += sellPrice(port, def.id, t);
  return true;
}

/** Reroll one shop's stock (or the tavern's recruits). */
export function reroll(run: RunState, shop: Shop | 'tavern', t: Tuning): boolean {
  const port = run.port;
  if (!port || !port.stock[shop]) return false;
  if (!pay(run, rerollPrice(run, t))) return false;
  port.rerolls++;
  stockShop(run, shop, t);
  return true;
}

/** The Shipwright: repair as much of the hull as you can afford. */
export function buyRepair(run: RunState, t: Tuning): boolean {
  const full = repairPrice(run, t);
  if (full <= 0 || run.gold <= 0) return false;
  const share = Math.min(1, run.gold / full);
  const before = hullShare(run, t);
  run.hull = run.hull.map((f) => f + (1 - f) * share);
  run.gold -= Math.min(run.gold, Math.round(full * share));
  return hullShare(run, t) > before;
}

/** The Tavern: heal one Lee as far as you can afford. */
export function buyHeal(run: RunState, member: number, t: Tuning): boolean {
  const m = run.crew.find((x) => x.uid === member);
  const full = healPrice(run, member, t);
  if (!m || full <= 0 || run.gold <= 0) return false;
  const share = Math.min(1, run.gold / full);
  m.hp += (1 - m.hp) * share;
  run.gold -= Math.min(run.gold, Math.round(full * share));
  return true;
}

/** Heal everyone (most hurt first) as far as the gold goes. */
export function buyHealAll(run: RunState, t: Tuning): boolean {
  let any = false;
  for (const m of [...run.crew].sort((a, b) => a.hp - b.hp)) if (buyHeal(run, m.uid, t)) any = true;
  return any;
}

/**
 * The Shipyard: buy a new hull. Your crew and gear go into storage on the
 * dock (everything off, everyone ashore) to be placed on it in refit; the old
 * hull trades in.
 */
export function buyChassis(run: RunState, ship: string, t: Tuning): boolean {
  const port = run.port;
  if (!port || !SHIPS[ship] || !port.services.includes('shipyard') || (!run.noHull && ship === run.ship)) return false;
  const price = chassisPrice(port, ship, t);
  const credit = tradeInValue(run, t);
  if (price - credit > run.gold) return false;
  run.gold -= price - credit;
  run.ship = ship;
  run.loadout = {};
  run.facings = {};
  for (const m of run.crew) {
    m.home = null;
    m.job = null;
  }
  run.hull = freshHull(ship);
  run.noHull = false;
  fixHomes(run);
  return true;
}

/** Chassis the shipyard sells (every ship but the one you have). */
export function shipyardStock(run: RunState): string[] {
  return SHIP_ORDER.filter((id) => run.noHull || id !== run.ship);
}

/**
 * The bank: leaving a port that has one, the gold you carry earns interest,
 * paid when you reach the next port (capped).
 */
export function bankInterest(run: RunState, t: Tuning): number {
  const port = run.port;
  if (!port || !port.services.includes('bank')) return 0;
  const E = t.economy;
  return Math.max(0, Math.round(Math.min(run.gold * Math.max(0, E.bankRate), Math.max(0, E.bankCap) * inflation(port.journey, t))));
}

// ------------------------------------------------------------ leaving

/** Why you can't sail right now (empty = you can). */
export function sailBlockers(run: RunState, t: Tuning): string[] {
  const out: string[] = [];
  if (run.noHull) return ['Buy a ship at the shipyard first.'];
  const over = cargo(run).length - Math.max(0, Math.round(t.ships[run.ship]?.cargo ?? 6));
  if (over > 0) out.push(`The hold is ${over} over: sell, equip or leave ${over === 1 ? 'something' : 'some things'} behind.`);
  if (run.crew.length > crewMax(run, t)) out.push(`Too many Lees for this ship: release ${run.crew.length - crewMax(run, t)}.`);
  if (!run.crew.some((m) => m.home !== null)) out.push('Nobody is aboard: place a Lee in refit.');
  return out;
}

/** Leaving with something that could be used: cargo that fits an empty slot, or a Lee ashore (the warning). */
export function leaveWarnings(run: RunState, t: Tuning): string[] {
  const out: string[] = [];
  const ashore = run.crew.filter((m) => m.home === null).length;
  if (ashore) out.push(`${ashore} ${ashore === 1 ? 'Lee is' : 'Lees are'} ashore.`);
  const copy = structuredClone(run);
  const before = cargo(copy).length;
  // Would Auto-equip place anything from cargo?
  for (const inst of cargo(copy)) autoEquipOne(copy, inst.uid, t);
  const fits = before - cargo(copy).length;
  if (fits) out.push(`${fits} ${fits === 1 ? 'thing' : 'things'} in cargo ${fits === 1 ? 'fits' : 'fit'} an empty slot.`);
  return out;
}

/** Release a Lee for good (the "too many Lees" fix in port). */
export function releaseLee(run: RunState, member: number): void {
  release(run, member);
}
