import { useState } from 'react';
import LeeForm from './LeeForm.jsx';
import LeeCard from './LeeCard.jsx';
import MiniTestbed from './MiniTestbed.jsx';
import { getTypeColor } from '@obviouslee/shared';

function emptyLee() {
  return {
    id: 'new-lee',
    name: '',
    flavor: '',
    emoji: '👊',
    image: 'placeholder.svg',
    tier: 1,
    type: 'none',
    moveBehavior: 'nearest-enemy',
    moveMult: 1.0,
    baseStats: { hp: 60, def: 4, armor: 0, moveSpeed: 1.0 },
    abilities: [
      {
        id: `ability-${Date.now()}`,
        type: 'melee',
        label: 'Attack',
        damage: 15,
        healAmount: 0,
        range: 1,
        aoeRadius: 0,
        actSpeed: 0.5,
        attackDelay: 0.1,
        targeting: 'nearest-enemy',
      },
    ],
    acquisition: { method: 'draft', combineFrom: null },
  };
}

/**
 * @param {{
 *   roster: object[],
 *   editingLee: object|null,
 *   onSave: (lee: object) => void,
 *   onNew: () => void,
 * }} props
 */
export default function EditorTab({ roster, editingLee, onSave, onNew }) {
  const [lee, setLee] = useState(() => editingLee || emptyLee());
  const [saved, setSaved] = useState(false);

  // Sync when parent wants us to edit a specific Lee
  const lastEditId = editingLee?.id;
  const [trackedId, setTrackedId] = useState(lastEditId);
  if (lastEditId !== trackedId) {
    setLee(editingLee || emptyLee());
    setTrackedId(lastEditId);
    setSaved(false);
  }

  function handleSave() {
    if (!lee.name) return;
    onSave({ ...lee });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function handleCopyJson() {
    navigator.clipboard.writeText(JSON.stringify(lee, null, 2));
  }

  function handleDownload() {
    const blob = new Blob([JSON.stringify(lee, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${lee.id || 'lee'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const typeColor = getTypeColor(lee.type);

  return (
    <div style={{ display: 'flex', gap: 0, height: 'calc(100vh - 50px)', overflow: 'hidden' }}>

      {/* Left: form */}
      <div style={{ width: 420, overflowY: 'auto', padding: 20, borderRight: '1px solid #1a1a1a', flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <span style={{ fontSize: 13, color: '#888', fontWeight: 'bold' }}>EDITOR</span>
          <button
            onClick={onNew}
            style={{ background: '#1a1a2a', border: '1px solid #334', borderRadius: 4, color: '#88aaff', fontSize: 12, padding: '4px 10px', cursor: 'pointer', fontFamily: 'monospace' }}
          >
            + New Lee
          </button>
        </div>

        <LeeForm value={lee} onChange={setLee} existingLees={roster} />

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, marginTop: 20, flexWrap: 'wrap' }}>
          <button
            onClick={handleSave}
            disabled={!lee.name}
            style={{
              background: saved ? '#225533' : (lee.name ? '#1a3a1a' : '#111'),
              border: `1px solid ${saved ? '#449955' : '#334433'}`,
              borderRadius: 6, color: saved ? '#88ff99' : '#66aa66',
              padding: '8px 16px', cursor: lee.name ? 'pointer' : 'not-allowed',
              fontFamily: 'monospace', fontSize: 13,
            }}
          >
            {saved ? '✓ Saved!' : '💾 Save to Roster'}
          </button>
          <button onClick={handleCopyJson} style={actionBtn}>📋 Copy JSON</button>
          <button onClick={handleDownload} style={actionBtn}>⬇ Download JSON</button>
        </div>
      </div>

      {/* Right: preview + testbed */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 24 }}>
        {/* Card preview */}
        <div>
          <div style={{ fontSize: 12, color: '#555', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 1 }}>Preview</div>
          <LeeCard lee={lee} />
        </div>

        {/* Zone preview */}
        <ZonePreview lee={lee} typeColor={typeColor} />

        {/* Mini testbed */}
        <MiniTestbed leeDef={lee.name ? lee : null} />
      </div>
    </div>
  );
}

const actionBtn = {
  background: '#1a1a1a', border: '1px solid #333', borderRadius: 6,
  color: '#aaa', padding: '8px 16px', cursor: 'pointer',
  fontFamily: 'monospace', fontSize: 13,
};

/** Small static grid showing attack/heal ranges. */
function ZonePreview({ lee, typeColor }) {
  const CELL = 24;
  const GRID = 7;
  const CENTER = Math.floor(GRID / 2);
  const abilities = (lee.abilities || []).filter(a => a.type !== 'thorns');

  const cells = [];
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      const dist = Math.max(Math.abs(r - CENTER), Math.abs(c - CENTER));
      const isCenter = r === CENTER && c === CENTER;
      let bg = '#111';
      for (const ab of abilities) {
        if (!isCenter && dist <= (ab.range || 1)) {
          const isHeal = ab.type === 'heal' || ab.type === 'buff' || ab.type === 'shield';
          bg = isHeal ? 'rgba(60,200,100,0.3)' : 'rgba(255,80,80,0.3)';
        }
      }
      cells.push(
        <div key={`${r},${c}`} style={{
          width: CELL, height: CELL,
          background: isCenter ? typeColor + '66' : bg,
          border: '1px solid #1a1a1a',
          boxSizing: 'border-box',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: isCenter ? 14 : 7,
        }}>
          {isCenter ? (lee.emoji || '?') : ''}
        </div>
      );
    }
  }

  return (
    <div>
      <div style={{ fontSize: 12, color: '#555', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>Zone Preview</div>
      <div style={{ fontSize: 10, color: '#444', marginBottom: 6 }}>
        <span style={{ color: '#ff5555' }}>■</span> attack range &nbsp;
        <span style={{ color: '#44cc66' }}>■</span> heal range
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${GRID}, ${CELL}px)`,
        gridTemplateRows:    `repeat(${GRID}, ${CELL}px)`,
        border: '1px solid #222', borderRadius: 4, overflow: 'hidden',
      }}>
        {cells}
      </div>
    </div>
  );
}
