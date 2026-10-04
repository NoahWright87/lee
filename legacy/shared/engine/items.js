/**
 * Item catalogue and equip/swap logic.
 *
 * Stat bonuses are applied directly to the unit's live stats so combat
 * requires no changes. _itemDeltas records what was changed so items can
 * be swapped cleanly (old bonuses are reversed before the new ones are
 * applied).
 */

export const ALL_ITEMS = [
  // ── Budget tier (~25-40g) ─────────────────────────────────────────────────
  {
    id: 'iron-helm',
    name: 'Iron Helm',
    emoji: '⛑️',
    flavor: 'Cracked, but functional.',
    price: 30,
    description: '+20 Max HP',
    statBonuses: { maxHp: 20 },
  },
  {
    id: 'leather-vest',
    name: 'Leather Vest',
    emoji: '🦺',
    flavor: 'Soft leather, hard choices.',
    price: 35,
    description: '+3 Defense',
    statBonuses: { def: 3 },
  },
  {
    id: 'buckler',
    name: 'Buckler',
    emoji: '🛡️',
    flavor: 'Small but surprisingly solid.',
    price: 35,
    description: '+2 Armor',
    statBonuses: { armor: 2 },
  },
  {
    id: 'swift-boots',
    name: 'Swift Boots',
    emoji: '👟',
    flavor: 'One size fits most.',
    price: 30,
    description: '+0.5 Move Speed',
    statBonuses: { moveSpeed: 0.5 },
  },

  // ── Mid tier (~45-65g) ────────────────────────────────────────────────────
  {
    id: 'sharpening-stone',
    name: 'Sharpening Stone',
    emoji: '🪨',
    flavor: 'Keeps every edge keen.',
    price: 45,
    description: '+6 Damage',
    statBonuses: { damage: 6 },
  },
  {
    id: 'herb-pouch',
    name: 'Herb Pouch',
    emoji: '🌿',
    flavor: 'Smells faintly of mint.',
    price: 45,
    description: '+10 Heal Amount',
    statBonuses: { healAmount: 10 },
  },
  {
    id: 'reinforced-plate',
    name: 'Reinforced Plate',
    emoji: '🗡️',
    flavor: 'Heavy. Worth it.',
    price: 55,
    description: '+2 Defense · +1 Armor',
    statBonuses: { def: 2, armor: 1 },
  },
  {
    id: 'vitality-gem',
    name: 'Vitality Gem',
    emoji: '💎',
    flavor: 'Pulses faintly with warmth.',
    price: 65,
    description: '+45 Max HP',
    statBonuses: { maxHp: 45 },
  },

  // ── Premium tier (~70-100g) ───────────────────────────────────────────────
  {
    id: 'lucky-coin',
    name: 'Lucky Coin',
    emoji: '🪙',
    flavor: 'Heads you win.',
    price: 70,
    description: '+15% Crit Chance',
    statBonuses: { critChance: 0.15 },
  },
  {
    id: 'healers-focus',
    name: "Healer's Focus",
    emoji: '🔮',
    flavor: 'Channels restorative energy.',
    price: 80,
    description: '+20 Heal Amount',
    statBonuses: { healAmount: 20 },
  },
  {
    id: 'warriors-ring',
    name: "Warrior's Ring",
    emoji: '💍',
    flavor: 'Passed down through many battles.',
    price: 85,
    description: '+8 Damage · +15 HP',
    statBonuses: { damage: 8, maxHp: 15 },
  },
  {
    id: 'power-shard',
    name: 'Power Shard',
    emoji: '💠',
    flavor: 'Hums with raw, barely-contained energy.',
    price: 95,
    description: '+15 Damage',
    statBonuses: { damage: 15 },
  },
];

/**
 * Equip an item to a unit, reversing any previously equipped item's bonuses.
 * Mutates `unit` in place.
 *
 * @param {object} unit  Runtime unit
 * @param {object} item  One of ALL_ITEMS
 */
export function applyItemToUnit(unit, item) {
  // Reverse the old item's bonuses so swapping is clean
  if (unit.equippedItem && unit._itemDeltas) {
    const d = unit._itemDeltas;
    if (d.maxHp) {
      unit.maxHp = Math.max(1, unit.maxHp - d.maxHp);
      unit.hp    = Math.min(unit.hp, unit.maxHp);
    }
    if (d.def)       unit.baseStats.def       = Math.max(0, (unit.baseStats.def || 0) - d.def);
    if (d.armor)     unit.baseStats.armor     = Math.max(0, (unit.baseStats.armor || 0) - d.armor);
    if (d.critChance) unit.critChance         = Math.max(0, (unit.critChance || 0) - d.critChance);
    if (d.moveSpeed) unit.baseStats.moveSpeed = Math.max(0.1, (unit.baseStats.moveSpeed || 1) - d.moveSpeed);
    if (d.damage) {
      unit.abilities = unit.abilities.map(a => ({
        ...a, damage: a.damage ? Math.max(0, a.damage - d.damage) : 0,
      }));
    }
    if (d.healAmount) {
      unit.abilities = unit.abilities.map(a => ({
        ...a, healAmount: a.healAmount ? Math.max(0, a.healAmount - d.healAmount) : 0,
      }));
    }
  }

  // Apply new bonuses and record deltas for future swaps
  const b = item.statBonuses;
  const d = {};

  if (b.maxHp) {
    unit.maxHp  += b.maxHp;
    unit.hp      = Math.min(unit.hp + b.maxHp, unit.maxHp);
    d.maxHp      = b.maxHp;
  }
  if (b.def) {
    unit.baseStats.def += b.def;
    d.def = b.def;
  }
  if (b.armor) {
    unit.baseStats.armor = (unit.baseStats.armor || 0) + b.armor;
    d.armor = b.armor;
  }
  if (b.critChance) {
    unit.critChance = Math.min(0.80, (unit.critChance || 0) + b.critChance);
    d.critChance = b.critChance;
  }
  if (b.moveSpeed) {
    unit.baseStats.moveSpeed = (unit.baseStats.moveSpeed || 1) + b.moveSpeed;
    d.moveSpeed = b.moveSpeed;
  }
  if (b.damage) {
    unit.abilities = unit.abilities.map(a => ({
      ...a, damage: a.damage ? a.damage + b.damage : 0,
    }));
    d.damage = b.damage;
  }
  if (b.healAmount) {
    unit.abilities = unit.abilities.map(a => ({
      ...a, healAmount: a.healAmount ? a.healAmount + b.healAmount : 0,
    }));
    d.healAmount = b.healAmount;
  }

  unit.equippedItem = item;
  unit._itemDeltas  = d;
}

/**
 * Pick `count` random items from the catalogue for the shop.
 */
export function getShopOptions(count = 4) {
  return [...ALL_ITEMS].sort(() => Math.random() - 0.5).slice(0, count);
}

/**
 * Gold rewarded for winning a round.
 */
export function goldRewardForRound(round) {
  return 20 + (round - 1) * 5;
}
