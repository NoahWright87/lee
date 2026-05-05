import { useState, useEffect, useRef } from 'react';
import LeeForm from './LeeForm.jsx';
import LeeCard from './LeeCard.jsx';
import { getTypeColor, tickField, createRuntimeUnit } from '@lee/shared';

// ── Constants ──────────────────────────────────────────────────────────────
const LIVE_FIELD = { rows: 6, cols: 4, deployRows: 2 };
const TICK_MS    = 1000 / 60;

const DUMMY_DEF = {
  id: 'training-dummy', name: 'Dummy', emoji: '🪵', type: 'none',
  tier: 1, moveBehavior: 'nearest-enemy', moveMult: 0,
  baseStats: { hp: 200, def: 0, armor: 0, moveSpeed: 0 },
  abilities: [],
  acquisition: { method: 'draft', combineFrom: null },
};

function emptyLee() {
  return {
    id: 'new-lee', name: '', flavor: '', emoji: '👊', image: 'placeholder.svg',
    tier: 1, type: 'none', moveBehavior: 'nearest-enemy', moveMult: 1.0,
    baseStats: { hp: 60, def: 4, armor: 0, moveSpeed: 1.0 },
    abilities: [{
      id: `ability-${Date.now()}`, type: 'melee', label: 'Attack',
      damage: 15, range: 1, cleave: 0, aoeRadius: 0,
      actSpeed: 0.5, attackDelay: 0.1, targeting: 'nearest-enemy',
    }],
    acquisition: { method: 'draft', combineFrom: null },
  };
}

function useWindowWidth() {
  const [w, setW] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1200));
  useEffect(() => {
    const h = () => setW(window.innerWidth);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);
  return w;
}

// ── Editor Tab ─────────────────────────────────────────────────────────────
export default function EditorTab({ roster, editingLee, onSave, onNew }) {
  const [lee, setLee]         = useState(() => editingLee || emptyLee());
  const [saved, setSaved]     = useState(false);
  const [liveMode, setLiveMode] = useState(false);
  const windowWidth            = useWindowWidth();
  const isMobile               = windowWidth < 700;

  const lastEditId  = editingLee?.id;
  const [trackedId, setTrackedId] = useState(lastEditId);
  if (lastEditId !== trackedId) {
    setLee(editingLee || emptyLee());
    setTrackedId(lastEditId);
    setSaved(false);
    setLiveMode(false);
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
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `${lee.id || 'lee'}.json`; a.click();
    URL.revokeObjectURL(url);
  }

  const typeColor = getTypeColor(lee.type);

  return (
    <div style={{
      display: 'flex',
      flexDirection: isMobile ? 'column' : 'row',
      gap: 0,
      height: isMobile ? 'auto' : 'calc(100vh - 50px)',
      overflow: isMobile ? 'visible' : 'hidden',
    }}>

      {/* Left / top: form */}
      <div style={{
        width: isMobile ? '100%' : 420,
        overflowY: 'auto',
        padding: 20,
        borderRight: isMobile ? 'none' : '1px solid #1a1a1a',
        borderBottom: isMobile ? '1px solid #1a1a1a' : 'none',
        flexShrink: 0,
        boxSizing: 'border-box',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <span style={{ fontSize: 13, color: '#888', fontWeight: 'bold' }}>EDITOR</span>
          <button onClick={onNew} style={{ background: '#1a1a2a', border: '1px solid #334', borderRadius: 4, color: '#88aaff', fontSize: 12, padding: '4px 10px', cursor: 'pointer', fontFamily: 'monospace' }}>
            + New Lee
          </button>
        </div>

        <LeeForm value={lee} onChange={setLee} existingLees={roster} />

        <div style={{ display: 'flex', gap: 8, marginTop: 20, flexWrap: 'wrap' }}>
          <button onClick={handleSave} disabled={!lee.name} style={{
            background: saved ? '#225533' : (lee.name ? '#1a3a1a' : '#111'),
            border: `1px solid ${saved ? '#449955' : '#334433'}`,
            borderRadius: 6, color: saved ? '#88ff99' : '#66aa66',
            padding: '8px 16px', cursor: lee.name ? 'pointer' : 'not-allowed',
            fontFamily: 'monospace', fontSize: 13,
          }}>
            {saved ? '✓ Saved!' : '💾 Save to Roster'}
          </button>
          <button onClick={handleCopyJson} style={actionBtn}>📋 Copy JSON</button>
          <button onClick={handleDownload} style={actionBtn}>⬇ Download JSON</button>
        </div>
      </div>

      {/* Right / bottom: card + preview/testbed */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>

        {/* Card preview */}
        <div>
          <div style={sectionLabel}>Preview</div>
          <LeeCard lee={lee} />
        </div>

        {/* Attack Pattern / Live Testbed toggle */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={sectionLabel}>{liveMode ? 'Live Battle' : 'Attack Pattern'}</div>
            <button
              onClick={() => setLiveMode(o => !o)}
              style={{
                padding: '4px 12px',
                background: liveMode ? '#1a3a1a' : '#0e1e0e',
                border: `1px solid ${liveMode ? '#449944' : '#224422'}`,
                borderRadius: 5,
                color: liveMode ? '#88ee88' : '#449944',
                fontFamily: 'monospace', fontSize: 12,
                cursor: 'pointer',
                transition: 'background 0.15s, color 0.15s',
                touchAction: 'manipulation',
              }}
            >
              {liveMode ? '⏹ Stop' : '▶ Live'}
            </button>
          </div>

          {liveMode
            ? <LiveTestbed leeDef={lee} />
            : <AttackPatternPreview lee={lee} typeColor={typeColor} />
          }
        </div>
      </div>
    </div>
  );
}

const actionBtn  = { background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, color: '#aaa', padding: '8px 16px', cursor: 'pointer', fontFamily: 'monospace', fontSize: 13 };
const sectionLabel = { fontSize: 12, color: '#555', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 0 };

// ── Live Testbed ───────────────────────────────────────────────────────────

const TILE = 56;

function initLiveUnits(leeDef) {
  const midCol = Math.floor(LIVE_FIELD.cols / 2);
  const lee    = createRuntimeUnit(leeDef, 'player', LIVE_FIELD.rows - 1, midCol);
  const dummy  = createRuntimeUnit(DUMMY_DEF, 'enemy', 0, midCol);
  return [lee, dummy];
}

function LiveTestbed({ leeDef }) {
  const [units, setUnits] = useState(() => initLiveUnits(leeDef));
  const defRef = useRef(leeDef);
  defRef.current = leeDef;

  // Full reset when switching to a different Lee definition
  useEffect(() => {
    setUnits(initLiveUnits(defRef.current));
  }, [leeDef?.id]);

  // Tick loop — always running while mounted
  useEffect(() => {
    const id = setInterval(() => {
      setUnits(prev => {
        const cur = defRef.current;

        // Sync Lee's current abilities so slider edits take effect in real-time
        const synced = prev.map(u => {
          if (u.side !== 'player' || !u.alive) return u;
          const abilities = cur.abilities.map(a => ({ ...a }));
          const castBars  = {};
          abilities.filter(a => a.type !== 'thorns').forEach(a => {
            castBars[a.id] = u.castBars?.[a.id] ?? 0;
          });
          return { ...u, abilities, castBars };
        });

        const { next } = tickField(synced, TICK_MS / 1000, LIVE_FIELD);

        // Respawn dummy when defeated
        if (!next.some(u => u.side === 'enemy' && u.alive)) {
          const col   = Math.floor(Math.random() * LIVE_FIELD.cols);
          const dummy = createRuntimeUnit(DUMMY_DEF, 'enemy', 0, col);
          return [...next.filter(u => u.side === 'player'), dummy];
        }

        // Respawn Lee if somehow defeated (thorns edge case)
        if (!next.some(u => u.side === 'player' && u.alive)) {
          const midCol = Math.floor(LIVE_FIELD.cols / 2);
          const newLee = createRuntimeUnit(cur, 'player', LIVE_FIELD.rows - 1, midCol);
          return [newLee, ...next.filter(u => u.side === 'enemy')];
        }

        return next;
      });
    }, TICK_MS);
    return () => clearInterval(id);
  }, []);  // intentionally empty — defRef stays current

  const W = LIVE_FIELD.cols * TILE;
  const H = LIVE_FIELD.rows * TILE;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 10, color: '#444' }}>
        Dummies respawn. Adjust sliders above to see changes live.
      </div>
      <div style={{ position: 'relative', width: W, height: H, border: '1px solid #222', borderRadius: 4, overflow: 'hidden' }}>
        {/* Grid tiles */}
        {Array.from({ length: LIVE_FIELD.rows }, (_, r) =>
          Array.from({ length: LIVE_FIELD.cols }, (_, c) => {
            const isEnemy  = r < LIVE_FIELD.deployRows;
            const isPlayer = r >= LIVE_FIELD.rows - LIVE_FIELD.deployRows;
            return (
              <div key={`${r},${c}`} style={{
                position: 'absolute', left: c * TILE, top: r * TILE,
                width: TILE - 1, height: TILE - 1,
                background: isEnemy ? 'rgba(255,60,60,0.1)' : isPlayer ? 'rgba(60,120,255,0.08)' : '#0e0e0e',
                border: '1px solid #2c2c2c',
              }} />
            );
          })
        )}

        {/* Units */}
        {units.map(unit => {
          const hpPct    = Math.max(0, unit.hp / (unit.maxHp || 1));
          const hpColor  = hpPct > 0.5 ? '#44cc44' : hpPct > 0.25 ? '#ffcc00' : '#ff4444';
          const tc       = getTypeColor(unit.type || 'none');
          const isDummy  = unit.side === 'enemy';
          const border   = isDummy ? '#555' : tc;
          const g        = 2;
          const sz       = TILE - g * 2;
          const activeAb = (unit.abilities || []).filter(a => a.type !== 'thorns');
          return (
            <div key={unit.uid} style={{
              position: 'absolute',
              left: unit.col * TILE + g, top: unit.row * TILE + g,
              width: sz, height: sz,
              background: unit.flash > 0 ? `rgba(255,80,80,${unit.flash * 0.7})` : '#1a1a1a',
              border: `2px solid ${border}`,
              borderRadius: 5,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start',
              padding: 2, opacity: unit.alive ? 1 : 0.2,
              transition: 'left 0.1s, top 0.1s', boxSizing: 'border-box', overflow: 'hidden',
            }}>
              <div style={{ fontSize: 18, lineHeight: 1 }}>{unit.emoji || '?'}</div>
              <div style={{ width: '100%', height: 3, background: '#333', borderRadius: 2, marginTop: 2 }}>
                <div style={{ width: `${hpPct * 100}%`, height: '100%', background: hpColor, borderRadius: 2 }} />
              </div>
              {activeAb.map(ab => (
                <div key={ab.id} style={{ width: '100%', height: 2, background: '#333', borderRadius: 2, marginTop: 1 }}>
                  <div style={{ width: `${(unit.castBars?.[ab.id] || 0) * 100}%`, height: '100%', background: tc, borderRadius: 2 }} />
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Attack Pattern Preview ─────────────────────────────────────────────────
// Dynamic grid: unit at second-from-bottom row, hit tiles strictly above it.
// melee: rectangle (range rows × cleave width), never unit's own row
// missile/mortar: single impact + optional AoE ring
// heal: Chebyshev radius in green
// thorns: amber unit tile only
// ──────────────────────────────────────────────────────────────────────────
const CELL = 24;

function getAbilityTiles(ability) {
  const { type, range = 1, cleave = 0, aoeRadius = 0 } = ability;
  const tiles = [];

  if (type === 'thorns') return [];

  if (type === 'melee') {
    const halfAngle = cleave / 2;
    for (let dr = -range; dr <= range; dr++) {
      for (let dc = -range; dc <= range; dc++) {
        if (dr === 0 && dc === 0) continue;
        const dist = Math.sqrt(dr * dr + dc * dc);
        const isAdj = Math.max(Math.abs(dr), Math.abs(dc)) <= 1;
        if (dist > range + (isAdj ? 0.5 : 0)) continue;
        // Preview is always from player perspective (facing up, so -dr is forward)
        const angleDeg = Math.abs(Math.atan2(dc, -dr) * (180 / Math.PI));
        if (angleDeg <= halfAngle + 0.001) {
          tiles.push({ dr, dc, intensity: 1.0, color: '#ff4444' });
        }
      }
    }
    return tiles;
  }

  if (type === 'heal') {
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

  // missile, mortar — impact straight ahead
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

  let maxRange = 0;
  abilities.forEach(ab => {
    if (ab.type === 'thorns') return;
    maxRange = Math.max(maxRange, (ab.range || 1) + (ab.aoeRadius || 0));
  });
  if (maxRange === 0 && hasThorns) maxRange = 1;

  const ROWS = Math.max(5, maxRange + 2);
  const COLS = Math.max(5, maxRange * 2 + 3);
  const UR   = ROWS - 2;
  const UC   = Math.floor(COLS / 2);

  const tileMap = new Map();
  abilities.forEach(ab => {
    getAbilityTiles(ab).forEach(({ dr, dc, intensity, color }) => {
      const r = UR + dr, c = UC + dc;
      if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return;
      const key = `${r},${c}`;
      const ex  = tileMap.get(key);
      if (!ex || intensity > ex.intensity) tileMap.set(key, { intensity, color });
    });
  });

  const cells = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const isUnit  = r === UR && c === UC;
      const isEnemy = r < UR;
      const tile    = tileMap.get(`${r},${c}`);
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
        <span style={{ color: '#44cc88' }}>■</span> heal
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
