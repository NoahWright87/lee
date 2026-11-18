// Enemies built from a budget. Every chassis, Lee and part has a point cost
// (src/config/economy.ts); a stop has a budget; the generator spends it.
//
//  1. Split the budget into ships (packs appear once a budget affords them).
//  2. Per ship, pick a chassis it can afford. Its tags start heavy.
//  3. Spend the rest on crew (by type and level) and parts, weighted toward
//     the ship's tags. Each pick adds weight to the tags it carries, so a ship
//     that starts leaning one way piles into that playstyle.
//  4. Pick an AI profile from the result: the chassis decides when it has a
//     style (a Friend Ship always boards), otherwise the parts do.
//
// The same costs value your own ship, so a stop's danger is relative to you.

import { CHASSIS_COST, chassisCost, itemCost, leeCost } from '../config/economy';
import type { CrewEntry, EnemySpec } from '../config/encounters';
import { ITEMS, type ItemDef } from '../config/items';
import { LEE_DEFS } from '../config/lees';
import { SHIP_ORDER, SHIPS } from '../config/ships';
import type { SlotType } from '../config/slots';
import type { Tag } from '../config/tags';
import type { Tuning } from '../config/tuning';
import { NESS_ORDER } from '../config/ness';
import { clamp, hashString, pickWeighted, Rng } from './math';
import type { NessSpec } from './ness';

/** What the generator may put on an enemy: everything a shop sells (no rare items). */
function buildable(d: ItemDef): boolean {
  return d.rewardWeight > 0 && !d.rare;
}

const tagsOf = (tags: readonly string[], w: Record<string, number>, neutral: number): number =>
  tags.length ? tags.reduce((a, t) => a + (w[t] ?? 1), 0) / tags.length : neutral;

/** Split a budget into ship budgets: one ship, plus more while the budget affords them (and luck allows). */
export function splitBudget(budget: number, rng: Rng, t: Tuning): number[] {
  const B = t.budget;
  const min = Math.max(1, B.minShip);
  let n = 1;
  while (n < Math.max(1, Math.round(B.maxShips)) && budget / (n + 1) >= min && rng.next() < B.extraShip) n++;
  const shares = Array.from({ length: n }, () => rng.range(0.85, 1.15));
  const sum = shares.reduce((a, b) => a + b, 0);
  return shares.map((s) => (budget * s) / sum);
}

/** Chassis a ship budget can afford (a cheapest one always). */
export function affordableChassis(budget: number, t: Tuning): string[] {
  const ok = SHIP_ORDER.filter((id) => chassisCost(id) <= budget * t.budget.chassisShare);
  if (ok.length) return ok;
  return [SHIP_ORDER.reduce((a, b) => (chassisCost(b) < chassisCost(a) ? b : a))];
}

/** The AI a generated ship gets: its chassis's style, else the style its parts lean to. */
export function aiFor(ship: string, items: string[], crew: string[]): string {
  const chassis = SHIPS[ship]?.tags ?? [];
  const byTag: Record<string, string> = { board: 'boarder', skirmish: 'skirmisher', barrage: 'heavy' };
  for (const tag of chassis) if (byTag[tag]) return byTag[tag];
  const count: Record<string, number> = {};
  for (const id of items) for (const tag of ITEMS[id]?.tags ?? []) count[tag] = (count[tag] ?? 0) + 1;
  for (const type of crew) for (const tag of LEE_DEFS[type]?.tags ?? []) count[tag] = (count[tag] ?? 0) + 1;
  const top = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
  if (!top || top[1] < 3) return 'standard';
  // A skirmisher needs the guns to hold its range.
  if (top[0] === 'skirmish') return items.includes('longGun') ? 'skirmisher' : 'standard';
  return byTag[top[0]] ?? 'standard';
}

/** One enemy ship built to a budget. */
export function buildShip(budget: number, rng: Rng, t: Tuning, chassis?: string): EnemySpec {
  const B = t.budget;
  const options = affordableChassis(budget, t);
  const ship = chassis && SHIPS[chassis] ? chassis : options[Math.floor(rng.next() * options.length)];
  const def = SHIPS[ship];
  let left = budget - chassisCost(ship);
  const w: Record<string, number> = { skirmish: 1, board: 1, barrage: 1, bulwark: 1 };
  for (const tag of def.tags) w[tag] += Math.max(0, B.chassisTag);
  const nudge = (tags: readonly Tag[]) => {
    for (const tag of tags) w[tag] = (w[tag] ?? 1) + Math.max(0, B.tagNudge);
  };
  const neutral = Math.max(0.01, B.neutral);
  const crew: { type: string; level: number }[] = [];
  const loadout: Record<string, string> = {};
  const treasures: string[] = [];
  const crewMax = Math.max(1, Math.round(t.ships[ship]?.crewMax ?? 8));
  const treasureMax = Math.max(0, Math.round(t.ships[ship]?.treasures ?? 0));
  const cap = Math.max(1, Math.round(t.leveling.levelCap));
  const items = Object.values(ITEMS).filter(buildable);
  // The first gun is one of the chassis's signature guns (long guns on a skirmisher...).
  const signature = new Set(def.signatureGuns.filter((id) => ITEMS[id]));
  // A chassis with a style knows its AI already: guns that can't reach its range are rarely bought.
  const profile = def.tags.length ? t.ai[aiFor(ship, [], [])] : null;
  const reaches = (id: string) => !profile || t.guns.range * (t.items[id]?.range ?? ITEMS[id].params.range ?? 1) >= profile.preferredRange * 0.9;

  type Option = { cost: number; weight: number; apply: () => void; kind: string };
  /** Options in a group share its weight, split by how well each fits the ship's tags. */
  const group = (out: Option[], need: number, list: { cost: number; fit: number; apply: () => void }[], kind: string) => {
    const live = list.filter((o) => o.cost <= left + 1e-9 && o.fit > 0);
    const total = live.reduce((a, o) => a + o.fit, 0);
    if (need <= 0 || total <= 0) return;
    for (const o of live) out.push({ cost: o.cost, weight: (need * o.fit) / total, apply: o.apply, kind });
  };
  const count = (cat: string) => Object.values(loadout).filter((i) => ITEMS[i]?.category === cat).length;
  for (let guard = 0; guard < 400; guard++) {
    const guns = count('gun');
    const posts = Object.entries(loadout).filter(([s, i]) => s.startsWith('fix:') && ITEMS[i]).length;
    const opts: Option[] = [];
    // Crew: the first Lee comes first; then about one per post plus a spare (boarders want more).
    if (crew.length < crewMax) {
      const need = (crew.length < posts + 1 ? 4 : 1.2) * (1 + 0.25 * Math.max(0, (w.board ?? 1) - 1));
      group(
        opts,
        need,
        Object.values(LEE_DEFS).map((lee) => ({
          cost: leeCost(lee.id, 1),
          fit: (lee.id === 'basic' ? 1.5 : 1) * tagsOf(lee.tags, w, neutral),
          apply: () => (crew.push({ type: lee.id, level: 1 }), nudge(lee.tags)),
        })),
        'lee',
      );
    }
    // A level for the least experienced Lee: better once every post is manned.
    const low = crew.filter((c) => c.level < cap).sort((a, b) => a.level - b.level)[0];
    if (low) {
      const cost = leeCost(low.type, low.level + 1) - leeCost(low.type, low.level);
      group(opts, crew.length >= posts ? 1.5 : 0.4, [{ cost, fit: 1, apply: () => (low.level++, nudge(LEE_DEFS[low.type]?.tags ?? [])) }], 'level');
    }
    // Parts into free slots that fit them, a group per category.
    const free = freeSlots(ship, loadout);
    const byCat: Record<string, { cost: number; fit: number; apply: () => void }[]> = {};
    const sigAffordable = [...signature].some((id) => itemCost(id) <= left);
    for (const item of items) {
      let slots: string[];
      if (item.category === 'treasure') slots = treasures.length < treasureMax && !treasures.includes(item.id) ? ['treasure'] : [];
      else slots = free.filter((s) => item.fits.includes(s.type)).map((s) => s.id);
      if (!slots.length) continue;
      if (item.category === 'gun' && guns === 0 && sigAffordable && !signature.has(item.id)) continue;
      (byCat[item.category] ??= []).push({
        cost: itemCost(item.id),
        fit: item.rewardWeight * tagsOf(item.tags, w, neutral) * (item.category === 'gun' && !reaches(item.id) ? 0.15 : 1),
        apply: () => {
          if (item.category === 'treasure') treasures.push(item.id);
          else loadout[slots[Math.floor(rng.next() * slots.length)]] = item.id;
          nudge(item.tags);
        },
      });
    }
    for (const [cat, list] of Object.entries(byCat)) {
      let need: number;
      if (cat === 'gun') need = guns === 0 ? 4 : posts < crew.length + 1 ? 3 : 0.8;
      else if (cat === 'station') need = posts < crew.length ? 1.2 : 0.5;
      else if (cat === 'trinket') need = 0;
      else need = 0.8 / (1 + (cat === 'treasure' ? treasures.length : count(cat)));
      group(opts, need, list, cat);
    }
    let affordable = opts.filter((o) => o.cost <= left + 1e-9 && o.weight > 0);
    // A gun first, then a Lee to fire it: every ship can fight.
    if (guns === 0 && affordable.some((o) => o.kind === 'gun')) affordable = affordable.filter((o) => o.kind === 'gun');
    else if (crew.length === 0 && affordable.some((o) => o.kind === 'lee')) affordable = affordable.filter((o) => o.kind === 'lee');
    if (!affordable.length) break;
    const pick = pickWeighted(rng, affordable.map((o) => [o, o.weight] as const));
    if (!pick) break;
    pick.apply();
    left -= pick.cost;
  }
  // Always at least one Lee (a budget too small for anything still sails someone).
  if (!crew.length) crew.push({ type: 'basic', level: 1 });
  const entries: CrewEntry[] = [];
  for (const c of crew) {
    const e = entries.find((x) => x.type === c.type && (x.level ?? 1) === c.level);
    if (e) e.count = (e.count ?? 1) + 1;
    else entries.push({ type: c.type, level: c.level, count: 1 });
  }
  const ai = aiFor(ship, [...Object.values(loadout), ...treasures], crew.map((c) => c.type));
  return { ship, ai, fullLoadout: loadout, treasures, crew: entries, budget: Math.round(budget - left) };
}

/** Free fixture, floor, rail and hull slots of a ship, plus attachment slots on its guns. */
function freeSlots(ship: string, loadout: Record<string, string>): { id: string; type: SlotType }[] {
  const out: { id: string; type: SlotType }[] = [];
  for (const s of SHIPS[ship].slots) if (loadout[s.id] === undefined) out.push({ id: s.id, type: s.type });
  for (const [slot, item] of Object.entries(loadout)) {
    const att = `att:${slot}`;
    if (ITEMS[item]?.category === 'gun' && loadout[att] === undefined) out.push({ id: att, type: 'attachment' });
  }
  return out;
}

/** A whole stop's enemies from its budget. Same seed → same ships. */
export function generateEnemies(budget: number, seed: number, t: Tuning, opts: { chassis?: string } = {}): EnemySpec[] {
  const rng = new Rng(seed >>> 0);
  return splitBudget(Math.max(1, budget), rng, t).map((b, i) => buildShip(b, rng, t, i === 0 ? opts.chassis : undefined));
}

/** Points one Ness costs in a stop's budget: its kind's cost, plus a share of it for each level above 1. */
export function nessCost(kind: string, level: number, t: Tuning): number {
  const k = t.ness.kinds[kind] ?? t.ness.kinds.weak;
  return k.cost * (1 + Math.max(0, t.ness.common.levelCost) * (Math.max(1, level) - 1));
}

/** Points in a Ness spec. */
export function nessValue(spec: NessSpec, t: Tuning): number {
  return nessCost(spec.kind, spec.level ?? 1, t);
}

/**
 * Sea monsters built from a budget: kinds picked by weight among those it can still afford, each at a level that fits;
 * a pack of small ones when there is room for more, a single bigger one when there isn't.
 */
export function generateNesses(budget: number, rng: Rng, t: Tuning): NessSpec[] {
  const out: NessSpec[] = [];
  let left = budget;
  const max = Math.max(1, Math.round(t.ness.common.maxPerFight));
  const cheapest = Math.min(...NESS_ORDER.map((id) => nessCost(id, 1, t)));
  while (out.length < max && left >= cheapest - 1e-9) {
    const pool = NESS_ORDER.filter((id) => nessCost(id, 1, t) <= left + 1e-9).map((id) => [id, Math.max(0, t.ness.kinds[id].weight)] as const);
    const kind = pickWeighted(rng, pool);
    if (!kind) break;
    let level = 1;
    // Room for another of this size? Then stay small. Otherwise grow it while it is affordable.
    const room = out.length + 1 < max && left - nessCost(kind, 1, t) >= cheapest * 1.5;
    if (!room) while (nessCost(kind, level + 1, t) <= left + 1e-9 && level < 8) level++;
    else if (rng.next() < 0.3 && nessCost(kind, 2, t) <= left * 0.6) level = 2;
    const cost = nessCost(kind, level, t);
    out.push({ kind, level, budget: Math.round(cost) });
    left -= cost;
  }
  if (!out.length) out.push({ kind: NESS_ORDER[0], level: 1, budget: Math.round(nessCost(NESS_ORDER[0], 1, t)) });
  return out;
}

/**
 * A whole fight from a budget: ships and Nesses. `nessShare` of the points go to Nesses (all of them in a lair; none, and the
 * same ships as ever, at 0). Too little left for a ship, or for a Ness, and the other side takes it all.
 */
export function generateEncounter(budget: number, seed: number, t: Tuning, opts: { nessShare?: number; chassis?: string } = {}): { enemies: EnemySpec[]; nesses: NessSpec[] } {
  const share = clamp(opts.nessShare ?? 0, 0, 1);
  if (share <= 0) return { enemies: generateEnemies(budget, seed, t, { chassis: opts.chassis }), nesses: [] };
  const cheapest = Math.min(...NESS_ORDER.map((id) => nessCost(id, 1, t)));
  let nessBudget = budget * share;
  if (nessBudget < cheapest) nessBudget = 0;
  let shipBudget = budget - nessBudget;
  if (shipBudget < Math.max(1, t.budget.minShip) * 0.6) {
    nessBudget = budget;
    shipBudget = 0;
  }
  if (nessBudget <= 0) return { enemies: generateEnemies(budget, seed, t, { chassis: opts.chassis }), nesses: [] };
  const rng = new Rng((seed ^ hashString('nesses')) >>> 0);
  return {
    enemies: shipBudget > 0 ? generateEnemies(shipBudget, seed, t, { chassis: opts.chassis }) : [],
    nesses: generateNesses(nessBudget, rng, t),
  };
}

/** Points in an enemy spec (what it's worth). */
export function specValue(spec: EnemySpec): number {
  let v = chassisCost(spec.ship);
  for (const c of spec.crew) v += leeCost(c.type, c.level ?? 1) * Math.max(0, c.count ?? 1);
  for (const i of Object.values(spec.fullLoadout ?? {})) v += itemCost(i);
  for (const i of spec.treasures ?? []) v += itemCost(i);
  return v;
}

/** A budget for a depth (journeys deep, fractional) and a stop multiplier, with some randomness. */
export function budgetFor(depth: number, mult: number, rng: Rng, t: Tuning, difficultyGrowth = 1): number {
  const B = t.budget;
  const growth = 1 + (Math.max(1, B.growth) - 1) * Math.max(0, difficultyGrowth);
  const r = 1 + rng.range(-1, 1) * Math.max(0, B.randomness);
  return Math.round(Math.max(1, B.base) * Math.pow(growth, Math.max(0, depth)) * Math.max(0, mult) * r);
}

/** 1–5 skulls: a stop's budget against your ship's value. */
export function dangerSkulls(budget: number, playerValue: number, t: Tuning): number {
  const ratio = budget / Math.max(1, playerValue);
  return Math.max(1, Math.min(5, Math.round(ratio / Math.max(0.01, t.budget.dangerPerSkull))));
}

export const CHASSIS_IDS = Object.keys(CHASSIS_COST);
