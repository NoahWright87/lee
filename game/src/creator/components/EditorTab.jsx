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
// Shows WHERE abilities land rather than a raw range circle:
//   melee / missile / mortar — impact tile at max range (north), AOE splash lighter
//   heal / buff / shield (aura) — all tiles in range shaded green
//   thorns — the unit's own tile in amber (passive retaliation)
// ---------------------------------------------------------------------------
const CELL = 26;
const GRID = 9;
const CX   = Math.floor(GRID / 2);
const CY   = Math.floor(GRID / 2);

function getAbilityTiles(ability) {
  const { type, range = 1, aoeRadius = 0 } = ability;
  const tiles = [];

  if (type === 'thorns') {
    tiles.push({ dr: 0, dc: 0, intensity: 0.8, color: '#ffaa33' });
    return tiles;
  }

  const isSupport = type === 'heal' || type === 'buff' || type === 'shield';
  if (isSupport) {
    for (let dr = -range; dr <= range; dr++) {
      for (let dc = -range; dc <= range; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) <= range && !(dr === 0 && dc === 0)) {
          tiles.push({ dr, dc, intensity: 0.55, color: '#44cc88' });
        }
      }
    }
    return tiles;
  }

  // Damaging: impact at max range straight ahead (north = -dr)
  const impactDr = -Math.min(range, CY);
  tiles.push({ dr: impactDr, dc: 0, intensity: 1.0, color: '#ff4444' });
  if (aoeRadius > 0) {
    for (let dr = -aoeRadius; dr <= aoeRadius; dr++) {
      for (let dc = -aoeRadius; dc <= aoeRadius; dc++) {
        if (!(dr === 0 && dc === 0)) {
          tiles.push({ dr: impactDr + dr, dc, intensity: 0.3, color: '#ff4444' });
        }
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

  const tileMap = new Map();
  abilities.forEach(ab => {
    getAbilityTiles(ab).forEach(({ dr, dc, intensity, color }) => {
      const r = CY + dr;
      const c = CX + dc;
      if (r < 0 || r >= GRID || c < 0 || c >= GRID) return;
      const key = `${r},${c}`;
      const existing = tileMap.get(key);
      if (!existing || intensity > existing.intensity) tileMap.set(key, { intensity, color });
    });
  });

  const cells = [];
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      const isCenter = r === CY && c === CX;
      const tile = tileMap.get(`${r},${c}`);
      let bg = '#111';
      if (isCenter) bg = typeColor + '55';
      else if (tile) bg = hexToRgba(tile.color, tile.intensity * 0.85);

      cells.push(
        <div key={`${r},${c}`} style={{
          width: CELL, height: CELL,
          background: bg,
          border: '1px solid #1a1a1a',
          boxSizing: 'border-box',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: isCenter ? 14 : 8,
        }}>
          {isCenter ? (lee.emoji || '?') : ''}
        </div>
      );
    }
  }

  return (
    <div>
      <div style={{ fontSize: 10, color: '#444', marginBottom: 5 }}>
        <span style={{ color: '#ff5555' }}>■</span> attack &nbsp;
        <span style={{ color: '#44cc88' }}>■</span> heal/buff &nbsp;
        <span style={{ color: '#ffaa33' }}>■</span> thorns
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${GRID}, ${CELL}px)`,
        gridTemplateRows:    `repeat(${GRID}, ${CELL}px)`,
        border: '1px solid #222', borderRadius: 4, overflow: 'hidden',
      }}>
        {cells}
      </div>
      <div style={{ fontSize: 10, color: '#444', marginTop: 4 }}>
        Enemy side ↑. Impact shown at max range.
      </div>
    </div>
  );
}
