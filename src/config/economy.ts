// One point-cost table for everything: it builds enemies to a budget, prices
// shops, trade-ins and recruits, and rates how dangerous a stop is for you.
// Balance changes happen here (and in tuning.economy / tuning.budget, which
// scale these numbers live).
//
// Every chassis, every Lee by type and level, and every item has a cost. A new
// item without an entry costs its category's default.

import { ITEMS, type ItemCategory } from './items';
import { LEE_DEFS } from './lees';

/** Points per chassis: an empty hull, no crew, no parts. */
export const CHASSIS_COST: Record<string, number> = {
  basic: 150,
  longdistance: 170,
  friend: 200,
  hard: 260,
};

/** Points per level-1 Lee by type. */
export const LEE_COST: Record<string, number> = {
  basic: 20,
  quick: 30,
  deft: 30,
  handy: 30,
  loud: 30,
  hard: 35,
};

/** Each level above 1 adds this share of the type's base cost. */
export const LEE_LEVEL_COST = 0.6;

/** Default cost by item category. */
export const CATEGORY_COST: Record<ItemCategory, number> = {
  gun: 30,
  station: 20,
  rail: 20,
  hull: 30,
  attachment: 20,
  floor: 15,
  treasure: 50,
  trinket: 30,
};

/** Items that cost something other than their category's default. */
export const ITEM_COST: Record<string, number> = {
  longGun: 40,
  carronade: 35,
  swivel: 25,
  mortar: 45,
  gatling: 45,
  scrap: 40,
  lookout: 25,
  powder: 30,
  crowsNest: 35,
  ironPlating: 35,
  ropes: 25,
  hooks: 30,
  poles: 20,
  ledger: 60,
  luckyCoin: 60,
  surgeonKit: 60,
  carpenterChest: 60,
  spyglassTrinket: 35,
};

export function chassisCost(ship: string): number {
  return CHASSIS_COST[ship] ?? 150;
}

export function leeCost(type: string, level = 1): number {
  const base = LEE_COST[type] ?? LEE_COST[LEE_DEFS[type] ? type : 'basic'] ?? 20;
  return base * (1 + LEE_LEVEL_COST * Math.max(0, level - 1));
}

export function itemCost(id: string): number {
  const def = ITEMS[id];
  if (!def) return 0;
  return ITEM_COST[id] ?? CATEGORY_COST[def.category];
}
