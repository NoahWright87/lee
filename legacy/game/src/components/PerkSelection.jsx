import { useState } from 'react';

const PERK_ICON = {
  'perk-hp-boost':       '❤️',
  'perk-def-boost':      '🛡️',
  'perk-armor-boost':    '🗡️',
  'perk-dmg-boost':      '⚔️',
  'perk-speed-boost':    '⚡',
  'perk-crit-1':         '🎯',
  'perk-crit-2':         '🎯',
  'perk-cleave-expand':  '🌀',
  'perk-melee-range':    '📏',
  'perk-thorns':         '🌵',
  'perk-aoe-shot':       '💥',
  'perk-range-extend':   '🏹',
  'perk-heal-boost':     '💚',
  'perk-heal-range':     '🔮',
};

function perkIcon(id) {
  return PERK_ICON[id] || '✨';
}

/**
 * Full-screen perk selection.
 *
 * Props:
 *   queue       – [{ uid, name, emoji, level, pickIndex, totalPicks, options }]
 *                 Flat list of all perk picks in order. One entry per level gained per unit.
 *   onComplete  – called with the updated units map { uid: unit } after all picks are done
 *   units       – current map { uid: unit } so perks can be previewed / applied live
 */
export default function PerkSelection({ queue, onComplete, units }) {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [hovered, setHovered] = useState(null);
  // Track locally-applied perks so subsequent picks see the updated unit state
  const [localUnits, setLocalUnits] = useState(() => ({ ...units }));

  if (currentIdx >= queue.length) return null;

  const pick = queue[currentIdx];
  const unit = localUnits[pick.uid] || units[pick.uid];
  const isLastPick = currentIdx === queue.length - 1;

  function handlePick(perk) {
    // Deep-clone the unit, apply the perk, update local units
    const updatedUnit = deepCloneUnit(localUnits[pick.uid] || units[pick.uid]);
    perk.apply(updatedUnit);
    if (!updatedUnit.perks) updatedUnit.perks = [];
    updatedUnit.perks.push({ id: perk.id, label: perk.label });

    const newLocalUnits = { ...localUnits, [pick.uid]: updatedUnit };
    setLocalUnits(newLocalUnits);

    if (isLastPick) {
      onComplete(newLocalUnits);
    } else {
      setCurrentIdx(i => i + 1);
      setHovered(null);
    }
  }

  const pickNumber  = currentIdx + 1;
  const totalPicks  = queue.length;
  const levelNumber = pick.pickIndex + 1; // 1-based level-up index for this unit

  return (
    <div style={{
      minHeight: '100vh',
      background: '#080808',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '32px 24px',
      gap: 28,
      fontFamily: 'monospace',
    }}>
      {/* Progress indicator */}
      <div style={{ color: '#555', fontSize: 12, letterSpacing: 2 }}>
        CHOICE {pickNumber} / {totalPicks}
      </div>

      {/* Unit identity */}
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 56, lineHeight: 1 }}>{unit?.emoji || pick.emoji}</div>
        <div style={{ color: '#eee', fontWeight: 'bold', fontSize: 22, marginTop: 8, letterSpacing: 1 }}>
          {unit?.name || pick.name}
        </div>
        <div style={{
          color: '#ffd700',
          fontSize: 14,
          marginTop: 4,
          fontWeight: 'bold',
          letterSpacing: 2,
        }}>
          LEVEL UP{pick.totalPicks > 1 ? ` (${levelNumber}/${pick.totalPicks})` : ''}!
        </div>
      </div>

      {/* Instruction */}
      <div style={{ color: '#777', fontSize: 13 }}>
        Choose a perk to enhance this Lee permanently.
      </div>

      {/* Perk cards */}
      <div style={{
        display: 'flex',
        gap: 18,
        flexWrap: 'wrap',
        justifyContent: 'center',
        maxWidth: 780,
      }}>
        {pick.options.map(perk => {
          const isHovered = hovered === perk.id;
          return (
            <button
              key={perk.id}
              onClick={() => handlePick(perk)}
              onMouseEnter={() => setHovered(perk.id)}
              onMouseLeave={() => setHovered(null)}
              style={{
                width: 210,
                background: isHovered ? '#1a1400' : '#111',
                border: `2px solid ${isHovered ? '#ffd700' : '#333'}`,
                borderRadius: 12,
                padding: '22px 18px',
                cursor: 'pointer',
                textAlign: 'center',
                transition: 'border-color 0.15s, background 0.15s, transform 0.12s, box-shadow 0.15s',
                transform: isHovered ? 'translateY(-4px) scale(1.02)' : 'none',
                boxShadow: isHovered ? '0 8px 28px #ffd70033' : 'none',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 10,
                fontFamily: 'monospace',
              }}
            >
              <div style={{ fontSize: 40 }}>{perkIcon(perk.id)}</div>
              <div style={{
                color: isHovered ? '#ffd700' : '#eee',
                fontWeight: 'bold',
                fontSize: 16,
                transition: 'color 0.15s',
              }}>
                {perk.label}
              </div>
              <div style={{
                color: '#888',
                fontSize: 12,
                lineHeight: 1.5,
              }}>
                {perk.description}
              </div>
            </button>
          );
        })}
      </div>

      {/* Queue preview */}
      {totalPicks > 1 && (
        <div style={{ color: '#444', fontSize: 11, marginTop: 4 }}>
          {totalPicks - pickNumber} more {totalPicks - pickNumber === 1 ? 'choice' : 'choices'} after this
        </div>
      )}
    </div>
  );
}

function deepCloneUnit(u) {
  return {
    ...u,
    abilities: (u.abilities || []).map(a => ({ ...a })),
    baseStats: { ...u.baseStats },
    perks: [...(u.perks || [])],
    pendingAttacks: [],
    castBars: { ...u.castBars },
    aims: {},
  };
}
