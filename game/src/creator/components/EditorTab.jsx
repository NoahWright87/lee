import { useState } from 'react';
import LeeForm from './LeeForm.jsx';
import LeeCard from './LeeCard.jsx';
import MiniTestbed from './MiniTestbed.jsx';
import { getTypeColor } from '@lee/shared';

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

export default function EditorTab({ roster, editingLee, onSave, onNew }) {
  const [lee, setLee] = useState(() => editingLee || emptyLee());
  const [saved, setSaved] = useState(false);
  const [testbedOpen, setTestbedOpen] = useState(false);

  const lastEditId = editingLee?.id;
  const [trackedId, setTrackedId] = useState(lastEditId);
  if (lastEditId !== trackedId) {
    setLee(editingLee || emptyLee());
    setTrackedId(lastEditId);
    setSaved(false);
    setTestbedOpen(false);
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

      {/* Right: card + attack pattern + testbed */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* Card + Play button + Attack pattern side by side */}
        <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {/* Card preview + Play button stacked */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 12, color: '#555', textTransform: 'uppercase', letterSpacing: 1 }}>Preview</div>
            <LeeCard lee={lee} />
            <button
              onClick={() => setTestbedOpen(o => !o)}
              style={{
                padding: '10px 16px',
                background: testbedOpen ? '#1a3a1a' : '#0e1e0e',
                border: `1px solid ${testbedOpen ? '#449944' : '#224422'}`,
                borderRadius: 6,
                color: testbedOpen ? '#88ee88' : '#449944',
                fontFamily: 'monospace', fontSize: 13,
                cursor: 'pointer', width: '100%',
                transition: 'background 0.2s, color 0.2s',
              }}
            >
              {testbedOpen ? '⏹ Close Testbed' : '▶ Play — Test in Battle'}
            </button>
          </div>

          {/* Attack pattern preview */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 12, color: '#555', textTransform: 'uppercase', letterSpacing: 1 }}>Attack Pattern</div>
            <AttackPatternPreview lee={lee} typeColor={typeColor} />
          </div>
        </div>

        {/* Testbed — expands on Play click */}
        {testbedOpen && (
          <div style={{ borderTop: '1px solid #1a1a1a', paddingTop: 16 }}>
            <MiniTestbed leeDef={lee.name ? lee : null} autoPlay />
          </div>
        )}
      </div>
    </div>
  );
}

const actionBtn = {
  background: '#1a1a1a', border: '1px solid #333', borderRadius: 6,
  color: '#aaa', padding: '8px 16px', cursor: 'pointer',
  fontFamily: 'monospace', fontSize: 13,
};

// ---------------------------------------------------------------------------
// Attack Pattern Preview
// Dynamic grid: unit at second-from-bottom row, attacks shown above.
//
//   melee:         rectangle (range rows up × cleave tiles each side), incl. unit's row sides
//   missile/mortar: single impact tile at max range, lighter AoE splash ring
//   heal/buff/shield: Chebyshev radius in green (both sides of unit)
//   thorns:        unit tile amber only (passive — no outgoing hit tiles)
// ---------------------------------------------------------------------------
const CELL = 24;

function getAbilityTiles(ability) {
  const { type, range = 1, cleave = 0, aoeRadius = 0 } = ability;
  const tiles = [];

  if (type === 'thorns') return [];

  if (type === 'melee') {
    for (let dr = -range; dr <= 0; dr++) {
      for (let dc = -cleave; dc <= cleave; dc++) {
        if (dr === 0 && dc === 0) continue;
        tiles.push({ dr, dc, intensity: 1.0, color: '#ff4444' });
      }
    }
    return tiles;
  }

  if (type === 'heal' || type === 'buff' || type === 'shield') {
    for (let dr = -range; dr <= range; dr++) {
      for (let dc = -range; dc <= range; dc++) {
        if (dr === 0 && dc === 0) continue;
        if (Math.max(Math.abs(dr), Math.abs(dc)) <= range) {
          tiles.push({ dr, dc, intensity: 0.6, color: '#44cc88' });
        }
      }
    }
    return tiles;
  }

  // missile, mortar, taunt — impact straight ahead
  tiles.push({ dr: -range, dc: 0, intensity: 1.0, color: '#ff4444' });
  if (aoeRadius > 0) {
    for (let dr = -aoeRadius; dr <= aoeRadius; dr++) {
      for (let dc = -aoeRadius; dc <= aoeRadius; dc++) {
        if (dr === 0 && dc === 0) continue;
        tiles.push({ dr: -range + dr, dc, intensity: 0.35, color: '#ff7722' });
      }
    }
  }
  return tiles;
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function AttackPatternPreview({ lee, typeColor }) {
  const abilities = lee.abilities || [];
  if (!abilities.length) return null;

  const hasThorns = abilities.some(a => a.type === 'thorns');

  // Compute dynamic grid size from all abilities
  let maxRange = 0, maxCleave = 0;
  abilities.forEach(ab => {
    if (ab.type === 'thorns') return;
    maxRange = Math.max(maxRange, (ab.range || 1) + (ab.aoeRadius || 0));
    if (ab.type === 'melee') maxCleave = Math.max(maxCleave, ab.cleave || 0);
    if (ab.type === 'heal' || ab.type === 'buff' || ab.type === 'shield') {
      maxCleave = Math.max(maxCleave, ab.range || 1); // support fills both axes
    }
  });
  if (maxRange === 0 && hasThorns) maxRange = 1;

  const ROWS = Math.max(5, maxRange + 2);   // enough room above + unit row + 1 below
  const COLS = Math.max(5, maxCleave * 2 + 5);
  const UR = ROWS - 2;                       // unit row
  const UC = Math.floor(COLS / 2);           // unit column

  // Accumulate hit tiles
  const tileMap = new Map();
  abilities.forEach(ab => {
    getAbilityTiles(ab).forEach(({ dr, dc, intensity, color }) => {
      const r = UR + dr, c = UC + dc;
      if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return;
      const key = `${r},${c}`;
      const ex = tileMap.get(key);
      if (!ex || intensity > ex.intensity) tileMap.set(key, { intensity, color });
    });
  });

  const cells = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const isUnit     = r === UR && c === UC;
      const isEnemy    = r < UR;
      const tile       = tileMap.get(`${r},${c}`);

      let bg = isEnemy ? '#0d0d11' : '#0d110d';
      if (isUnit) bg = hasThorns ? '#ffaa3344' : typeColor + '55';
      else if (tile) bg = hexToRgba(tile.color, tile.intensity * 0.85);

      cells.push(
        <div key={`${r},${c}`} style={{
          width: CELL, height: CELL, background: bg,
          border: `1px solid ${isEnemy ? '#16161e' : '#161e16'}`,
          boxSizing: 'border-box',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: isUnit ? 14 : 8,
        }}>
          {isUnit ? (lee.emoji || '?') : ''}
        </div>
      );
    }
  }

  return (
    <div>
      <div style={{ fontSize: 10, color: '#444', marginBottom: 4 }}>
        <span style={{ color: '#ff5555' }}>■</span> damage &nbsp;
        <span style={{ color: '#ff8833' }}>■</span> splash &nbsp;
        <span style={{ color: '#44cc88' }}>■</span> heal/buff
        {hasThorns && <> &nbsp;<span style={{ color: '#ffaa33' }}>■</span> thorns</>}
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${COLS}, ${CELL}px)`,
        gridTemplateRows:    `repeat(${ROWS}, ${CELL}px)`,
        border: '1px solid #1e1e28', borderRadius: 4, overflow: 'hidden',
      }}>
        {cells}
      </div>
      <div style={{ fontSize: 10, color: '#333', marginTop: 3 }}>
        ↑ enemy side &nbsp;|&nbsp; darker = player side
      </div>
    </div>
  );
}
