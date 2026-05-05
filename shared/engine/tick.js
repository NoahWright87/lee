import { getDamageMultiplier } from './types.js';
import { chebyshev, findMovementTarget, stepToward } from './pathfinding.js';

/**
 * Advance the battle by `dt` seconds.
 * Pure function — does not mutate input.
 *
 * @param {object[]} units  Runtime unit array
 * @param {number}   dt     Delta time in seconds
 * @param {{rows:number,cols:number,deployRows:number}} fieldConfig
 * @returns {{ next: object[], events: object[] }}
 */
export function tickField(units, dt, fieldConfig) {
  // Shallow-clone each unit so we never mutate the previous state
  const next = units.map(u => ({
    ...u,
    baseStats: { ...u.baseStats },
    pendingAttacks: u.pendingAttacks ? u.pendingAttacks.map(a => ({ ...a })) : [],
    castBars: { ...u.castBars },
    flash: Math.max(0, (u.flash || 0) - dt * 6),
  }));
  const events = [];

  resolvePendingAttacks(next, events, dt);

  next.forEach(unit => {
    if (!unit.alive) return;
    updateUnit(unit, next, dt, events, fieldConfig);
  });

  return { next, events };
}

// ---------------------------------------------------------------------------
// Pending attack resolution
// ---------------------------------------------------------------------------

function resolvePendingAttacks(units, events, dt) {
  units.forEach(attacker => {
    if (!attacker.pendingAttacks?.length) return;

    const remaining = [];
    attacker.pendingAttacks.forEach(attack => {
      attack.timeLeft -= dt;
      if (attack.timeLeft > 0) {
        remaining.push(attack);
        return;
      }

      const { targetRow, targetCol, dmg, aoeRadius, isMelee, cleave, range, originRow, originCol } = attack;

      const hitTiles = isMelee
        ? getMeleeHitTiles(originRow, originCol, range || 1, cleave || 0, attacker.side)
        : getHitTiles(targetRow, targetCol, aoeRadius || 0);

      let hitAny = false;

      hitTiles.forEach(([hr, hc]) => {
        const victim = units.find(
          v => v.alive && v.row === hr && v.col === hc && v.side !== attacker.side
        );
        if (!victim) return;
        hitAny = true;

        const dmgDealt = calculateDamage(attacker, dmg, victim);
        victim.hp = Math.max(0, victim.hp - dmgDealt);
        victim.flash = 1;

        if (victim.hp === 0) {
          victim.alive = false;
          // XP accumulates during battle; level-up is processed post-battle
          attacker.xp = (attacker.xp || 0) + 30;
        }

        events.push({ type: 'hit', uid: victim.uid, dmg: dmgDealt, died: victim.hp === 0 });

        // Thorns: passive flat retaliation — only triggers on melee attacks
        if (isMelee) {
          const thorns = victim.abilities?.find(a => a.type === 'thorns');
          if (thorns?.damage > 0) {
            const thornDmg = thorns.damage;
            attacker.hp = Math.max(0, attacker.hp - thornDmg);
            attacker.flash = 1;
            if (attacker.hp === 0) attacker.alive = false;
            events.push({ type: 'hit', uid: attacker.uid, dmg: thornDmg, died: attacker.hp === 0 });
          }
        }
      });

      if (!hitAny) {
        events.push({ type: 'miss', uid: attacker.uid });
      }
    });

    attacker.pendingAttacks = remaining;
  });
}

// ---------------------------------------------------------------------------
// Per-unit update
// ---------------------------------------------------------------------------

function updateUnit(unit, allUnits, dt, events, fieldConfig) {
  const target = findMovementTarget(unit, allUnits);
  if (!target) return;

  const activeAbilities = unit.abilities.filter(a => a.type !== 'thorns');
  const maxRange = activeAbilities.reduce((m, a) => Math.max(m, a.range || 1), 0);
  const distToTarget = chebyshev(unit, target);
  const inRange = distToTarget <= maxRange;

  unit.moving = !inRange;
  const moveMult = unit.moveMult ?? 1.0;

  if (!inRange) {
    unit.moveBar = (unit.moveBar || 0) + dt * (unit.baseStats?.moveSpeed ?? 1.0);
    if (unit.moveBar >= 1) {
      unit.moveBar -= 1;
      const step = stepToward(unit, allUnits, target, fieldConfig);
      if (step) {
        unit.row = step[0];
        unit.col = step[1];
        events.push({ type: 'move', uid: unit.uid, row: unit.row, col: unit.col });
        // moveMult=0: must be stationary — reset all cast bars on every step
        if (moveMult === 0) {
          Object.keys(unit.castBars).forEach(k => { unit.castBars[k] = 0; });
        }
      }
    }
  } else {
    unit.moveBar = 0;
  }

  // Charge each ability's cast bar independently
  const chargeRate = inRange ? 1.0 : moveMult;
  unit.aims = {};
  activeAbilities.forEach(ability => {
    const key = ability.id;
    if (unit.castBars[key] === undefined) unit.castBars[key] = 0;
    unit.castBars[key] = Math.min(
      1,
      unit.castBars[key] + dt * (ability.actSpeed || 1.0) * chargeRate
    );
    if (unit.castBars[key] >= 1) {
      unit.castBars[key] = 0;
      fireAbility(unit, ability, allUnits, events);
    } else if (inRange && unit.castBars[key] > 0) {
      // Track where this ability is aimed so the field can show a targeting indicator
      const abilityTarget = findAbilityTarget(unit, ability, allUnits);
      if (abilityTarget) unit.aims[key] = { row: abilityTarget.row, col: abilityTarget.col };
    }
  });
}

// ---------------------------------------------------------------------------
// Ability firing
// ---------------------------------------------------------------------------

function fireAbility(unit, ability, allUnits, events) {
  const abilityTarget = findAbilityTarget(unit, ability, allUnits);
  if (!abilityTarget) return;

  if (ability.type === 'heal') {
    const healAmt = ability.healAmount || 0;
    const cap = abilityTarget.maxHp || abilityTarget.baseStats?.hp || 9999;
    abilityTarget.hp = Math.min(cap, abilityTarget.hp + healAmt);
    events.push({ type: 'heal', uid: abilityTarget.uid, amt: healAmt });
    events.push({ type: 'fire', uid: unit.uid, abilityId: ability.id, targetRow: abilityTarget.row, targetCol: abilityTarget.col });
    return;
  }

  if (ability.type === 'buff' || ability.type === 'taunt' || ability.type === 'shield') {
    // TODO: implement buff / taunt / shield ability types
    events.push({ type: 'ability', uid: unit.uid, abilityId: ability.id });
    return;
  }

  // melee, missile, mortar — commit a pending attack
  const isMelee = ability.type === 'melee';
  const totalTime = ability.attackDelay || 0.001;
  unit.pendingAttacks.push({
    abilityId: ability.id,
    abilityType: ability.type,
    targetRow: abilityTarget.row,
    targetCol: abilityTarget.col,
    originRow: unit.row,
    originCol: unit.col,
    timeLeft: totalTime,
    totalTime,
    dmg: ability.damage || 0,
    aoeRadius: ability.aoeRadius || 0,
    isMelee,
    cleave: isMelee ? (ability.cleave || 0) : 0,
    range: ability.range || 1,
    attackerUid: unit.uid,
  });
  events.push({
    type: 'fire',
    uid: unit.uid,
    abilityId: ability.id,
    targetRow: abilityTarget.row,
    targetCol: abilityTarget.col,
  });
}

function findAbilityTarget(unit, ability, allUnits) {
  const { targeting, range = 1, minRange = 0 } = ability;
  const isSupport = ability.type === 'heal' || ability.type === 'buff' || ability.type === 'shield';
  const targetSide = isSupport ? unit.side : (unit.side === 'player' ? 'enemy' : 'player');

  const candidates = allUnits.filter(u =>
    u.alive &&
    u.side === targetSide &&
    (!isSupport || u.uid !== unit.uid) &&
    chebyshev(unit, u) <= range &&
    chebyshev(unit, u) >= minRange
  );

  if (!candidates.length) return null;

  switch (targeting) {
    case 'lowest-hp-enemy':
    case 'lowest-hp-ally':
      return candidates.reduce((a, b) =>
        (a.hp / (a.maxHp || 1)) <= (b.hp / (b.maxHp || 1)) ? a : b
      );
    case 'nearest-ally':
      return candidates.reduce((a, b) =>
        chebyshev(unit, a) <= chebyshev(unit, b) ? a : b
      );
    case 'random-enemy':
      return candidates[Math.floor(Math.random() * candidates.length)];
    case 'lowest-hp-col':
      return (
        candidates
          .filter(u => u.col === unit.col)
          .reduce((a, b) => (!a || b.hp < a.hp) ? b : a, null) || candidates[0]
      );
    case 'nearest-enemy':
    case 'nearest':
    default:
      return candidates.reduce((a, b) =>
        chebyshev(unit, a) <= chebyshev(unit, b) ? a : b
      );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function calculateDamage(attacker, baseDmg, target) {
  const defReduction = Math.floor((target.baseStats?.def || 0) / 3);
  const base = Math.max(1, baseDmg - defReduction);
  const typeMult = getDamageMultiplier(attacker.type || 'none', target.type || 'none');
  const armor = target.baseStats?.armor || 0;
  return Math.max(1, Math.round(base * typeMult) - armor);
}

function getHitTiles(row, col, aoeRadius) {
  if (aoeRadius === 0) return [[row, col]];
  const tiles = [];
  for (let dr = -aoeRadius; dr <= aoeRadius; dr++) {
    for (let dc = -aoeRadius; dc <= aoeRadius; dc++) {
      tiles.push([row + dr, col + dc]);
    }
  }
  return tiles;
}

function getMeleeHitTiles(originRow, originCol, range, cleaveAngle, side) {
  const halfAngle = cleaveAngle / 2;
  const tiles = [];

  for (let dr = -range; dr <= range; dr++) {
    for (let dc = -range; dc <= range; dc++) {
      if (dr === 0 && dc === 0) continue;

      // Euclidean radius; +0.5 buffer on Chebyshev-1 neighbours so range=1 always
      // includes all 8 adjacent tiles (diagonal √2 ≈ 1.41 fits within 1.5)
      const dist = Math.sqrt(dr * dr + dc * dc);
      const isAdjacent = Math.max(Math.abs(dr), Math.abs(dc)) <= 1;
      if (dist > range + (isAdjacent ? 0.5 : 0)) continue;

      // Angle from the unit's forward direction (player faces up, enemy faces down)
      const fwd = side === 'player' ? -dr : dr;
      const angleDeg = Math.abs(Math.atan2(dc, fwd) * (180 / Math.PI));

      if (angleDeg <= halfAngle + 0.001) {
        tiles.push([originRow + dr, originCol + dc]);
      }
    }
  }

  return tiles;
}
