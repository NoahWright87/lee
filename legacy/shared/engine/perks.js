/**
 * Perk definitions for the level-up reward system.
 *
 * Each perk has:
 *   id          – unique key stored on the unit
 *   label       – short display name
 *   description – shown on the perk card
 *   eligibility – (unit) => bool  – whether this perk can be offered to a unit
 *   apply       – (unit) => void  – mutates the unit to apply the perk (called once on pick)
 */

export const ALL_PERKS = [
  // ── Stat boosts (always eligible) ──────────────────────────────────────────
  {
    id: 'perk-hp-boost',
    label: 'Resilience',
    description: '+30% Max HP. Permanently tougher.',
    eligibility: () => true,
    apply(unit) {
      const bonus = Math.round(unit.maxHp * 0.30);
      unit.maxHp += bonus;
      unit.hp = Math.min(unit.hp + bonus, unit.maxHp);
    },
  },
  {
    id: 'perk-def-boost',
    label: 'Iron Skin',
    description: '+40% Defense. Each point of DEF reduces incoming damage.',
    eligibility: () => true,
    apply(unit) {
      unit.baseStats.def = Math.round((unit.baseStats.def || 0) * 1.40);
    },
  },
  {
    id: 'perk-armor-boost',
    label: 'Heavy Plating',
    description: '+2 Armor. Flat reduction on every hit.',
    eligibility: () => true,
    apply(unit) {
      unit.baseStats.armor = (unit.baseStats.armor || 0) + 2;
    },
  },

  // ── Damage boosts (units that deal damage) ─────────────────────────────────
  {
    id: 'perk-dmg-boost',
    label: 'Power Surge',
    description: '+25% Ability Damage on all attacks.',
    eligibility: unit => unit.abilities.some(a => a.damage > 0),
    apply(unit) {
      unit.abilities = unit.abilities.map(a => ({
        ...a,
        damage: a.damage ? Math.round(a.damage * 1.25) : 0,
      }));
    },
  },
  {
    id: 'perk-speed-boost',
    label: 'Quickened',
    description: '+30% Attack Speed. Abilities charge faster.',
    eligibility: unit => unit.abilities.some(a => a.actSpeed > 0),
    apply(unit) {
      unit.abilities = unit.abilities.map(a => ({
        ...a,
        actSpeed: a.actSpeed ? +(a.actSpeed * 1.30).toFixed(3) : a.actSpeed,
      }));
    },
  },

  // ── Critical hits ───────────────────────────────────────────────────────────
  {
    id: 'perk-crit-1',
    label: 'Critical Strike',
    description: 'Gain 20% chance to deal double damage on attacks.',
    eligibility: unit =>
      unit.abilities.some(a => a.damage > 0) && !(unit.critChance >= 0.40),
    apply(unit) {
      unit.critChance = Math.min(0.80, (unit.critChance || 0) + 0.20);
    },
  },
  {
    id: 'perk-crit-2',
    label: 'Sharpened Edge',
    description: '+15% Crit Chance (stacks with Critical Strike).',
    eligibility: unit =>
      unit.abilities.some(a => a.damage > 0) && (unit.critChance || 0) > 0,
    apply(unit) {
      unit.critChance = Math.min(0.80, (unit.critChance || 0) + 0.15);
    },
  },

  // ── Melee perks ─────────────────────────────────────────────────────────────
  {
    id: 'perk-cleave-expand',
    label: 'Whirlwind',
    description: 'Melee cleave arc widens by 90°, hitting more enemies at once.',
    eligibility: unit => unit.abilities.some(a => a.type === 'melee' && (a.cleave || 0) < 270),
    apply(unit) {
      unit.abilities = unit.abilities.map(a =>
        a.type === 'melee'
          ? { ...a, cleave: Math.min(360, (a.cleave || 0) + 90) }
          : a
      );
    },
  },
  {
    id: 'perk-melee-range',
    label: 'Long Reach',
    description: 'Melee range +1. Strike enemies one tile further away.',
    eligibility: unit => unit.abilities.some(a => a.type === 'melee' && (a.range || 1) < 3),
    apply(unit) {
      unit.abilities = unit.abilities.map(a =>
        a.type === 'melee'
          ? { ...a, range: (a.range || 1) + 1 }
          : a
      );
    },
  },
  {
    id: 'perk-thorns',
    label: 'Thorns',
    description: 'Reflect 8 damage back to any melee attacker.',
    eligibility: unit =>
      !unit.abilities.some(a => a.type === 'thorns'),
    apply(unit) {
      unit.abilities = [
        ...unit.abilities,
        { id: 'thorns-perk', type: 'thorns', label: 'Thorns', damage: 8 },
      ];
    },
  },

  // ── Ranged perks ─────────────────────────────────────────────────────────────
  {
    id: 'perk-aoe-shot',
    label: 'Explosive Rounds',
    description: 'Ranged shots gain AoE radius +1, hitting adjacent tiles.',
    eligibility: unit =>
      unit.abilities.some(a => (a.type === 'missile' || a.type === 'mortar') && (a.aoeRadius || 0) < 2),
    apply(unit) {
      unit.abilities = unit.abilities.map(a =>
        (a.type === 'missile' || a.type === 'mortar')
          ? { ...a, aoeRadius: (a.aoeRadius || 0) + 1 }
          : a
      );
    },
  },
  {
    id: 'perk-range-extend',
    label: 'Eagle Eye',
    description: 'Ranged attack range +1. Reach enemies from further away.',
    eligibility: unit =>
      unit.abilities.some(a => (a.type === 'missile' || a.type === 'mortar') && (a.range || 1) < 6),
    apply(unit) {
      unit.abilities = unit.abilities.map(a =>
        (a.type === 'missile' || a.type === 'mortar')
          ? { ...a, range: (a.range || 1) + 1 }
          : a
      );
    },
  },

  // ── Heal perks ───────────────────────────────────────────────────────────────
  {
    id: 'perk-heal-boost',
    label: 'Mending Touch',
    description: '+35% Healing power. Restore much more HP per cast.',
    eligibility: unit => unit.abilities.some(a => a.type === 'heal'),
    apply(unit) {
      unit.abilities = unit.abilities.map(a =>
        a.type === 'heal'
          ? { ...a, healAmount: Math.round((a.healAmount || 0) * 1.35) }
          : a
      );
    },
  },
  {
    id: 'perk-heal-range',
    label: 'Far Reach',
    description: 'Healing range +2. Reach allies across the battlefield.',
    eligibility: unit =>
      unit.abilities.some(a => a.type === 'heal' && (a.range || 1) < 6),
    apply(unit) {
      unit.abilities = unit.abilities.map(a =>
        a.type === 'heal'
          ? { ...a, range: (a.range || 1) + 2 }
          : a
      );
    },
  },
];

/**
 * Pick `count` random eligible perks for the given unit.
 * Avoids offering a perk the unit already holds (by id).
 *
 * @param {object} unit
 * @param {number} [count=3]
 * @returns {object[]}  subset of ALL_PERKS
 */
export function getRandomPerks(unit, count = 3) {
  const held = new Set((unit.perks || []).map(p => p.id));
  const eligible = ALL_PERKS.filter(p => !held.has(p.id) && p.eligibility(unit));
  const shuffled = [...eligible].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

/**
 * Apply a perk to a unit (mutates in place, records perk on unit.perks).
 *
 * @param {object} unit
 * @param {object} perk  One of ALL_PERKS
 */
export function applyPerk(unit, perk) {
  perk.apply(unit);
  if (!unit.perks) unit.perks = [];
  unit.perks.push({ id: perk.id, label: perk.label });
}
