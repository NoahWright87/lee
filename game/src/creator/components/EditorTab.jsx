import { useState, useEffect, useRef } from 'react';
import LeeForm from './LeeForm.jsx';
import LeeCard from './LeeCard.jsx';
import { getTypeColor, tickField, createRuntimeUnit } from '@lee/shared';

// ── Constants ──────────────────────────────────────────────────────────────
const LIVE_FIELD = { rows: 6, cols: 4, deployRows: 2 };
const TICK_MS    = 1000 / 60;

function makeDummyDef(behavior) {
  const base = {
    name: 'Dummy', emoji: '🪵', type: 'none', tier: 1,
    acquisition: { method: 'draft', combineFrom: null },
    baseStats: { hp: 200, def: 0, armor: 0, moveSpeed: 0.7 },
    abilities: [],
  };
  if (behavior === 'chase') {
    return { ...base, id: 'dummy-chase', moveBehavior: 'nearest-enemy', moveMult: 1.0 };
  }
  if (behavior === 'attack') {
    return { ...base, id: 'dummy-attack', moveBehavior: 'nearest-enemy', moveMult: 1.0,
      abilities: [{ id: 'dummy-punch', type: 'melee', label: 'Punch', damage: 8,
        range: 1, cleave: 0, aoeRadius: 0, actSpeed: 0.5, attackDelay: 0.1, targeting: 'nearest-enemy' }],
    };
  }
  if (behavior === 'flee') {
    return { ...base, id: 'dummy-flee', moveBehavior: 'flee-enemy', moveMult: 1.0,
      baseStats: { ...base.baseStats, moveSpeed: 1.1 } };
  }
  // 'still' (default)
  return { ...base, id: 'dummy-still', moveBehavior: 'nearest-enemy', moveMult: 0,
    baseStats: { ...base.baseStats, moveSpeed: 0 } };
}

function randomFreePos(occupiedSet, minRow, maxRow, cols) {
  const candidates = [];
  for (let r = minRow; r <= maxRow; r++) {
    for (let c = 0; c < cols; c++) {
      if (!occupiedSet.has(`${r},${c}`)) candidates.push([r, c]);
    }
  }
  if (!candidates.length) return [minRow, Math.floor(cols / 2)];
  return candidates[Math.floor(Math.random() * candidates.length)];
}

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

const TILE         = 56;
const PLAYER_MIN_R = LIVE_FIELD.rows - LIVE_FIELD.deployRows;
const DUMMY_MAX_R  = LIVE_FIELD.rows - LIVE_FIELD.deployRows - 1;

function initLiveUnits(leeDef, dummyCount, dummyBehavior) {
  const occ = new Set();
  const [pr, pc] = randomFreePos(occ, PLAYER_MIN_R, LIVE_FIELD.rows - 1, LIVE_FIELD.cols);
  occ.add(`${pr},${pc}`);
  const lee = createRuntimeUnit(leeDef, 'player', pr, pc);

  const def = makeDummyDef(dummyBehavior);
  const dummies = [];
  for (let i = 0; i < dummyCount; i++) {
    const [dr, dc] = randomFreePos(occ, 0, DUMMY_MAX_R, LIVE_FIELD.cols);
    occ.add(`${dr},${dc}`);
    dummies.push(createRuntimeUnit({ ...def, id: `dummy-${i}` }, 'enemy', dr, dc));
  }
  return [lee, ...dummies];
}

function respawnDummies(units, count, behavior) {
  const players = units.filter(u => u.side === 'player');
  const occ = new Set(players.filter(u => u.alive).map(u => `${u.row},${u.col}`));
  const def = makeDummyDef(behavior);
  const newDummies = [];
  for (let i = 0; i < count; i++) {
    const [dr, dc] = randomFreePos(occ, 0, DUMMY_MAX_R, LIVE_FIELD.cols);
    occ.add(`${dr},${dc}`);
    newDummies.push(createRuntimeUnit({ ...def, id: `dummy-${i}` }, 'enemy', dr, dc));
  }
  return [...players, ...newDummies];
}

function respawnLee(units, leeDef) {
  const enemies = units.filter(u => u.side === 'enemy');
  const occ = new Set(enemies.filter(u => u.alive).map(u => `${u.row},${u.col}`));
  const [pr, pc] = randomFreePos(occ, PLAYER_MIN_R, LIVE_FIELD.rows - 1, LIVE_FIELD.cols);
  return [createRuntimeUnit(leeDef, 'player', pr, pc), ...enemies];
}

const BEHAVIORS = [
  { id: 'still',  label: 'Still'  },
  { id: 'chase',  label: 'Chase'  },
  { id: 'attack', label: 'Attack' },
  { id: 'flee',   label: 'Flee'   },
];

function LiveTestbed({ leeDef }) {
  const [dummyCount,    setDummyCount]    = useState(1);
  const [dummyBehavior, setDummyBehavior] = useState('still');
  const [units, setUnits] = useState(() => initLiveUnits(leeDef, 1, 'still'));

  const defRef      = useRef(leeDef);
  const countRef    = useRef(dummyCount);
  const behaviorRef = useRef(dummyBehavior);
  defRef.current      = leeDef;
  countRef.current    = dummyCount;
  behaviorRef.current = dummyBehavior;

  useEffect(() => {
    setUnits(initLiveUnits(defRef.current, countRef.current, behaviorRef.current));
  }, [leeDef?.id]);

  useEffect(() => {
    setUnits(initLiveUnits(defRef.current, dummyCount, dummyBehavior));
  }, [dummyCount, dummyBehavior]);

  useEffect(() => {
    const id = setInterval(() => {
      setUnits(prev => {
        const cur = defRef.current;

        // Sync Lee's abilities from current def so slider changes take effect live
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

        if (!next.some(u => u.side === 'enemy'  && u.alive))
          return respawnDummies(next, countRef.current, behaviorRef.current);

        if (!next.some(u => u.side === 'player' && u.alive))
          return respawnLee(next, cur);

        return next;
      });
    }, TICK_MS);
    return () => clearInterval(id);
  }, []); // intentionally empty — refs stay current

  const W = LIVE_FIELD.cols * TILE;
  const H = LIVE_FIELD.rows * TILE;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>

      {/* Dummy controls */}
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap', rowGap: 4 }}>
        <span style={{ fontSize: 10, color: '#555', marginRight: 2 }}>Dummies:</span>
        {[1, 2, 3, 4].map(n => (
          <button key={n} onClick={() => setDummyCount(n)} style={{
            padding: '2px 8px',
            background: dummyCount === n ? '#1e2a3a' : '#111',
            border: `1px solid ${dummyCount === n ? '#3355aa' : '#2a2a2a'}`,
            borderRadius: 4,
            color: dummyCount === n ? '#88aaee' : '#444',
            fontFamily: 'monospace', fontSize: 12, cursor: 'pointer',
            touchAction: 'manipulation',
          }}>{n}</button>
        ))}
        <span style={{ color: '#2a2a2a', margin: '0 2px' }}>|</span>
        {BEHAVIORS.map(({ id, label }) => (
          <button key={id} onClick={() => setDummyBehavior(id)} style={{
            padding: '2px 8px',
            background: dummyBehavior === id ? '#2a1a10' : '#111',
            border: `1px solid ${dummyBehavior === id ? '#774422' : '#2a2a2a'}`,
            borderRadius: 4,
            color: dummyBehavior === id ? '#ffaa77' : '#444',
            fontFamily: 'monospace', fontSize: 11, cursor: 'pointer',
            touchAction: 'manipulation',
          }}>{label}</button>
        ))}
      </div>

      {/* Field */}
      <div style={{ position: 'relative', width: W, height: H, border: '1px solid #222', borderRadius: 4, overflow: 'hidden' }}>
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

        {units.map(unit => {
          const hpPct   = Math.max(0, unit.hp / (unit.maxHp || 1));
          const hpColor = hpPct > 0.5 ? '#44cc44' : hpPct > 0.25 ? '#ffcc00' : '#ff4444';
          const tc      = getTypeColor(unit.type || 'none');
          const border  = unit.side === 'enemy' ? '#555' : tc;
          const g = 2, sz = TILE - g * 2;
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

      <div style={{ fontSize: 10, color: '#444' }}>
        Both sides respawn randomly. Adjust sliders above to see changes live.
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
