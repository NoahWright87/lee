import { useState, useEffect, useRef } from 'react';
import { tickField, createRuntimeUnit, getTypeColor } from '@obviouslee/shared';

const TILE  = 56;
const FIELD = { rows: 4, cols: 4, deployRows: 2 };
const TICK_MS = 1000 / 60;

const DUMMY_DEF = {
  id: 'dummy', name: 'Dummy Lee', emoji: '🎯', type: 'none',
  moveBehavior: 'nearest-enemy', moveMult: 1.0,
  baseStats: { hp: 200, def: 0, armor: 0, moveSpeed: 0.5 },
  abilities: [{ id: 'dummy-punch', type: 'melee', label: 'Punch', damage: 5, healAmount: 0, range: 1, aoeRadius: 0, actSpeed: 0.3, attackDelay: 0.1, targeting: 'nearest-enemy' }],
  acquisition: { method: 'draft', combineFrom: null },
};

/**
 * Minimal battle testbed embedded in the creator.
 * @param {{ leeDef: object|null }} props
 */
export default function MiniTestbed({ leeDef }) {
  const [units, setUnits]     = useState([]);
  const [running, setRunning] = useState(false);
  const [speed, setSpeed]     = useState(1);
  const speedRef              = useRef(speed);
  speedRef.current            = speed;

  function reset() {
    setRunning(false);
    if (!leeDef) { setUnits([]); return; }

    const player = createRuntimeUnit(leeDef, 'player', FIELD.rows - 1, 0);
    const enemies = [
      createRuntimeUnit(DUMMY_DEF, 'enemy', 0, 0),
      createRuntimeUnit(DUMMY_DEF, 'enemy', 0, 1),
      createRuntimeUnit(DUMMY_DEF, 'enemy', 0, 2),
    ];
    setUnits([player, ...enemies]);
  }

  // Reset when leeDef changes
  useEffect(() => { reset(); }, [leeDef?.id]);

  useEffect(() => {
    if (!running) return;
    const interval = setInterval(() => {
      setUnits(prev => {
        const playerAlive = prev.some(u => u.side === 'player' && u.alive);
        const enemyAlive  = prev.some(u => u.side === 'enemy'  && u.alive);
        if (!playerAlive || !enemyAlive) { setRunning(false); return prev; }
        const { next } = tickField(prev, (TICK_MS / 1000) * speedRef.current, FIELD);
        return next;
      });
    }, TICK_MS);
    return () => clearInterval(interval);
  }, [running]);

  const W = FIELD.cols * TILE;
  const H = FIELD.rows * TILE;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 12, color: '#666', fontWeight: 'bold' }}>MINI TESTBED</div>

      {!leeDef && (
        <div style={{ color: '#444', fontSize: 12, fontStyle: 'italic' }}>
          Define a Lee above to test it here.
        </div>
      )}

      {leeDef && (
        <>
          {/* Controls */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button onClick={() => setRunning(r => !r)} style={btnStyle(running ? '#883333' : '#225533')}>
              {running ? '⏸ Pause' : '▶ Play'}
            </button>
            <button onClick={reset} style={btnStyle('#333')}>↺ Reset</button>
            <select
              value={speed}
              onChange={e => setSpeed(Number(e.target.value))}
              style={{ background: '#1a1a1a', color: '#aaa', border: '1px solid #333', borderRadius: 4, padding: '3px 6px', fontFamily: 'monospace', fontSize: 12 }}
            >
              <option value={0.5}>0.5×</option>
              <option value={1}>1×</option>
              <option value={2}>2×</option>
              <option value={4}>4×</option>
            </select>
          </div>

          {/* Field */}
          <div style={{ position: 'relative', width: W, height: H, border: '1px solid #222', borderRadius: 4, overflow: 'hidden' }}>
            {/* Background tiles */}
            {Array.from({ length: FIELD.rows }, (_, r) =>
              Array.from({ length: FIELD.cols }, (_, c) => (
                <div key={`${r},${c}`} style={{
                  position: 'absolute',
                  left: c * TILE, top: r * TILE,
                  width: TILE - 1, height: TILE - 1,
                  background: r < FIELD.deployRows ? 'rgba(255,60,60,0.05)' : r >= FIELD.rows - FIELD.deployRows ? 'rgba(60,120,255,0.05)' : '#0e0e0e',
                  border: '1px solid #1a1a1a',
                }} />
              ))
            )}

            {/* Units */}
            {units.map(unit => {
              const hpPct = Math.max(0, unit.hp / (unit.maxHp || 1));
              const hpColor = hpPct > 0.5 ? '#44cc44' : hpPct > 0.25 ? '#ffcc00' : '#ff4444';
              const typeColor = getTypeColor(unit.type || 'none');
              const activeAbilities = (unit.abilities || []).filter(a => a.type !== 'thorns');
              const gap = 2;
              const size = TILE - gap * 2;
              return (
                <div key={unit.uid} style={{
                  position: 'absolute',
                  left: unit.col * TILE + gap,
                  top:  unit.row * TILE + gap,
                  width: size, height: size,
                  background: unit.flash > 0 ? `rgba(255,80,80,${unit.flash * 0.7})` : '#1a1a1a',
                  border: `2px solid ${typeColor}`,
                  borderRadius: 5,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start',
                  padding: 2,
                  opacity: unit.alive ? 1 : 0.2,
                  overflow: 'hidden',
                  transition: 'left 0.1s, top 0.1s',
                  boxSizing: 'border-box',
                }}>
                  <div style={{ fontSize: 18, lineHeight: 1 }}>{unit.emoji || '?'}</div>
                  <div style={{ width: '100%', height: 3, background: '#333', borderRadius: 2, marginTop: 2 }}>
                    <div style={{ width: `${hpPct * 100}%`, height: '100%', background: hpColor, borderRadius: 2 }} />
                  </div>
                  {activeAbilities.map(ab => (
                    <div key={ab.id} style={{ width: '100%', height: 2, background: '#333', borderRadius: 2, marginTop: 1 }}>
                      <div style={{ width: `${(unit.castBars?.[ab.id] || 0) * 100}%`, height: '100%', background: typeColor, borderRadius: 2 }} />
                    </div>
                  ))}
                </div>
              );
            })}
          </div>

          {/* Status */}
          <div style={{ fontSize: 11, color: '#555' }}>
            {units.filter(u => u.side === 'player' && u.alive).length > 0
              ? `Player HP: ${units.filter(u => u.side === 'player')[0]?.hp ?? 0}`
              : 'Player defeated'}
            {' · '}
            {units.filter(u => u.side === 'enemy' && u.alive).length} enemies remaining
          </div>
        </>
      )}
    </div>
  );
}

function btnStyle(bg) {
  return {
    background: bg, color: '#ccc', border: '1px solid #444',
    borderRadius: 4, padding: '4px 10px', cursor: 'pointer',
    fontFamily: 'monospace', fontSize: 12,
  };
}
