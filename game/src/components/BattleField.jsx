import { useRef } from 'react';
import { getTypeColor } from '@lee/shared';
import UnitToken from './UnitToken.jsx';

let _vfxId = 0;

/**
 * @param {{
 *   units: object[],
 *   fieldConfig: {rows:number,cols:number,deployRows:number},
 *   events?: object[],
 *   tileSize?: number,
 *   deployMode?: boolean,
 *   selectedUnit?: object|null,
 *   onTileClick?: (row:number, col:number) => void,
 *   onUnitClick?: (unit:object) => void,
 *   previewUnits?: object[],
 * }} props
 */
export default function BattleField({
  units, fieldConfig, events,
  deployMode, selectedUnit, onTileClick, onUnitClick,
  previewUnits = [], tileSize = 72,
}) {
  const TILE = tileSize;
  const { rows, cols, deployRows } = fieldConfig;
  const W = cols * TILE;
  const H = rows * TILE;

  const playerZoneRows = Array.from({ length: deployRows }, (_, i) => rows - deployRows + i);
  const enemyZoneRows  = Array.from({ length: deployRows }, (_, i) => i);

  // ── VFX accumulation (ref — mutations here don't trigger re-renders) ─────
  const vfxRef = useRef([]);
  const lastEventsRef = useRef(null);

  if (events && events !== lastEventsRef.current && events.length > 0) {
    lastEventsRef.current = events;
    const now = Date.now();
    events.forEach(ev => {
      if (ev.type === 'hit' && ev.row != null) {
        vfxRef.current.push({ id: ++_vfxId, type: 'dmg-num', value: ev.dmg, died: ev.died, row: ev.row, col: ev.col, born: now, ttl: 750 });
      }
      if (ev.type === 'heal' && ev.row != null) {
        vfxRef.current.push({ id: ++_vfxId, type: 'heal-num', value: ev.amt, row: ev.row, col: ev.col, born: now, ttl: 750 });
        vfxRef.current.push({ id: ++_vfxId, type: 'heal-pop', row: ev.row, col: ev.col, born: now, ttl: 500 });
      }
      if (ev.type === 'fire' && ev.isHeal) {
        vfxRef.current.push({ id: ++_vfxId, type: 'heal-proj', fromRow: ev.fromRow, fromCol: ev.fromCol, toRow: ev.targetRow, toCol: ev.targetCol, born: now, ttl: 300 });
      }
      if (ev.type === 'detonate') {
        vfxRef.current.push({ id: ++_vfxId, type: 'explosion', row: ev.row, col: ev.col, aoeRadius: ev.aoeRadius, born: now, ttl: 450 });
      }
    });
  }

  const now = Date.now();
  vfxRef.current = vfxRef.current.filter(e => now - e.born < e.ttl);
  const activeFx = vfxRef.current.map(e => ({ ...e, t: (now - e.born) / e.ttl }));

  // ── Aimed-tile indicators ─────────────────────────────────────────────────
  const aimedTiles = new Map();
  units.forEach(u => {
    if (!u.alive || !u.aims) return;
    Object.entries(u.aims).forEach(([abilityId, { row, col }]) => {
      const ability = u.abilities?.find(a => a.id === abilityId);
      const color = ability?.type === 'heal' ? '#44ff88' : getTypeColor(u.type || 'none');
      const key = `${row},${col}`;
      if (!aimedTiles.has(key)) aimedTiles.set(key, color);
    });
  });

  // ── In-flight attacks ─────────────────────────────────────────────────────
  const inFlight = [];
  units.forEach(u => {
    (u.pendingAttacks || []).forEach(atk => {
      inFlight.push({ ...atk, attackerType: u.type || 'none', attackerRow: u.row, attackerCol: u.col });
    });
  });

  return (
    <div style={{ position: 'relative', width: W, height: H, flexShrink: 0 }}>

      {/* Background tiles */}
      {Array.from({ length: rows }, (_, r) =>
        Array.from({ length: cols }, (_, c) => {
          const isPlayerZone = playerZoneRows.includes(r);
          const isEnemyZone  = enemyZoneRows.includes(r);
          const isClickable  = deployMode && isPlayerZone;
          return (
            <div
              key={`${r},${c}`}
              onClick={isClickable ? () => onTileClick?.(r, c) : undefined}
              style={{
                position: 'absolute',
                left: c * TILE, top: r * TILE,
                width: TILE - 1, height: TILE - 1,
                background: isEnemyZone                  ? 'rgba(255,60,60,0.1)'
                          : (isPlayerZone && deployMode) ? 'rgba(60,120,255,0.22)'
                          : isPlayerZone                 ? 'rgba(60,120,255,0.07)'
                          : '#0e0e0e',
                border: `1px solid ${isClickable ? '#2a4488' : '#2c2c2c'}`,
                borderRadius: 3,
                boxShadow: isClickable ? 'inset 0 0 10px rgba(60,120,255,0.25)' : undefined,
                cursor: isClickable ? 'pointer' : 'default',
                boxSizing: 'border-box',
              }}
            />
          );
        })
      )}

      {/* Aimed-tile indicators — bright pulsing glow */}
      {Array.from(aimedTiles.entries()).map(([key, color]) => {
        const [r, c] = key.split(',').map(Number);
        return (
          <div key={`aim-${key}`} style={{
            position: 'absolute',
            left: c * TILE + 2, top: r * TILE + 2,
            width: TILE - 4, height: TILE - 4,
            border: `2px solid ${color}dd`,
            borderRadius: 4,
            background: `${color}22`,
            boxShadow: `0 0 10px ${color}88, inset 0 0 8px ${color}22`,
            animation: 'aimPulse 0.45s ease-in-out infinite alternate',
            pointerEvents: 'none',
            zIndex: 3,
          }} />
        );
      })}

      {/* In-flight reticles on target tiles */}
      {inFlight.map((atk, i) => (
        <div key={`reticle-${i}`} style={{
          position: 'absolute',
          left: atk.targetCol * TILE + 2, top: atk.targetRow * TILE + 2,
          width: TILE - 4, height: TILE - 4,
          border: '2px solid rgba(255,80,80,0.8)',
          borderRadius: 4,
          animation: 'reticlePulse 0.5s ease-in-out infinite alternate',
          pointerEvents: 'none',
          zIndex: 4,
        }} />
      ))}

      {/* Projectile dots — missile (straight) and mortar (arc) */}
      {inFlight.filter(atk => !atk.isMelee).map((atk, i) => {
        const t = 1 - atk.timeLeft / (atk.totalTime || 0.001);
        const ox = (atk.originCol ?? atk.targetCol) * TILE + TILE / 2;
        const oy = (atk.originRow ?? atk.targetRow) * TILE + TILE / 2;
        const tx = atk.targetCol * TILE + TILE / 2;
        const ty = atk.targetRow * TILE + TILE / 2;
        const px = ox + (tx - ox) * t;
        const arcLift = atk.abilityType === 'mortar' ? Math.sin(Math.PI * t) * 48 : 0;
        const py = oy + (ty - oy) * t - arcLift;
        const color = getTypeColor(atk.attackerType);
        const size  = atk.abilityType === 'mortar' ? 10 : 7;
        return (
          <div key={`proj-${i}`} style={{
            position: 'absolute',
            left: px - size / 2, top: py - size / 2,
            width: size, height: size,
            background: color,
            borderRadius: '50%',
            boxShadow: `0 0 6px ${color}`,
            pointerEvents: 'none',
            zIndex: 8,
          }} />
        );
      })}


      {/* Ghost enemy preview (deploy screen) */}
      {previewUnits.map(unit => (
        <div key={`preview-${unit.uid}`} style={{
          position: 'absolute',
          left: unit.col * TILE + 3, top: unit.row * TILE + 3,
          width: TILE - 6, height: TILE - 6,
          background: 'rgba(80,0,0,0.35)',
          border: '1px dashed rgba(255,80,80,0.45)',
          borderRadius: 5,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          opacity: 0.55, pointerEvents: 'none', zIndex: 2, overflow: 'hidden',
        }}>
          <div style={{ fontSize: 22, lineHeight: 1 }}>{unit.emoji || '🧍'}</div>
          <div style={{ fontSize: 8, color: '#ffaaaa', marginTop: 1, textAlign: 'center' }}>
            {(unit.name || '').split(' ')[0]}
          </div>
        </div>
      ))}

      {/* Units */}
      {units.map(unit => (
        <UnitToken
          key={unit.uid}
          unit={unit}
          tileSize={TILE}
          selected={selectedUnit?.uid === unit.uid}
          onClick={onUnitClick ? () => onUnitClick(unit) : undefined}
        />
      ))}

      {/* SVG: debug targeting lines + melee swing crescents */}
      <svg style={{ position: 'absolute', left: 0, top: 0, width: W, height: H, pointerEvents: 'none', zIndex: 7, overflow: 'visible' }}>
        {/* Debug targeting lines */}
        {units.flatMap(u => {
          if (!u.alive || !u.aims) return [];
          return Object.entries(u.aims).map(([abilityId, { row, col }]) => {
            const ability = u.abilities?.find(a => a.id === abilityId);
            const color = ability?.type === 'heal' ? '#44ff88' : '#ff5555';
            return (
              <line
                key={`${u.uid}-${abilityId}`}
                x1={u.col * TILE + TILE / 2} y1={u.row * TILE + TILE / 2}
                x2={col * TILE + TILE / 2}   y2={row * TILE + TILE / 2}
                stroke={color} strokeWidth={1.5} strokeDasharray="4,3" opacity={0.5}
              />
            );
          });
        })}

        {/* Melee swing — stroke-based arc; strokeLinecap="round" tapers ends naturally */}
        {inFlight.filter(atk => atk.isMelee).map((atk, i) => {
          const progress = 1 - atk.timeLeft / (atk.totalTime || 0.001);

          const cx = atk.attackerCol * TILE + TILE / 2;
          const cy = atk.attackerRow * TILE + TILE / 2;
          const fwdAngle = Math.atan2(atk.targetRow - atk.attackerRow, atk.targetCol - atk.attackerCol);

          const range = atk.range || 1;
          const cleave = atk.cleave || 0;
          const halfRad = Math.max(cleave / 2 * Math.PI / 180, 20 * Math.PI / 180);
          const effectiveHalf = Math.min(halfRad, Math.PI - 0.01);

          // Inner radius always sits in the adjacent tile, outer extends to range edge
          const innerR = TILE * 0.7;
          const outerR = (range + 0.4) * TILE;
          const midR   = (innerR + outerR) / 2;
          const strokeW = outerR - innerR;

          // Comet-tail sweep: leading edge advances, 35% tail trails behind
          const totalArc = 2 * effectiveHalf;
          const leadAngle  = fwdAngle - effectiveHalf + totalArc * progress;
          const trailAngle = Math.max(fwdAngle - effectiveHalf, leadAngle - totalArc * 0.35);
          const sweepLen = leadAngle - trailAngle;
          if (sweepLen < 0.01) return null;

          const sweepLargeArc = sweepLen > Math.PI ? 1 : 0;
          const f = n => n.toFixed(2);
          const sx1 = cx + midR * Math.cos(trailAngle), sy1 = cy + midR * Math.sin(trailAngle);
          const sx2 = cx + midR * Math.cos(leadAngle),  sy2 = cy + midR * Math.sin(leadAngle);

          // Quick rise, hold, sharp fade at end
          const alpha = Math.min(1, progress * 5) * Math.max(0, 1 - Math.max(0, progress - 0.8) * 5) * 0.92;

          return (
            <path
              key={`swing-${i}`}
              d={`M ${f(sx1)} ${f(sy1)} A ${f(midR)} ${f(midR)} 0 ${sweepLargeArc} 1 ${f(sx2)} ${f(sy2)}`}
              fill="none"
              stroke={`rgba(255,220,60,${alpha.toFixed(3)})`}
              strokeWidth={f(strokeW)}
              strokeLinecap="round"
            />
          );
        })}
      </svg>

      {/* VFX overlay */}
      {activeFx.map(fx => {
        const alpha = 1 - fx.t;

        if (fx.type === 'dmg-num') {
          return (
            <div key={fx.id} style={{
              position: 'absolute',
              left: fx.col * TILE + TILE * 0.2,
              top:  fx.row * TILE + TILE * 0.1 - fx.t * 40,
              fontSize: 12 + Math.round((1 - fx.t) * 3),
              fontWeight: 'bold', fontFamily: 'monospace',
              color: fx.died ? '#ff5555' : '#ffd700',
              textShadow: '0 1px 4px rgba(0,0,0,0.9)',
              opacity: alpha, pointerEvents: 'none', zIndex: 14,
              whiteSpace: 'nowrap',
            }}>
              -{fx.value}
            </div>
          );
        }

        if (fx.type === 'heal-num') {
          return (
            <div key={fx.id} style={{
              position: 'absolute',
              left: fx.col * TILE + TILE * 0.2,
              top:  fx.row * TILE + TILE * 0.1 - fx.t * 40,
              fontSize: 12 + Math.round((1 - fx.t) * 3),
              fontWeight: 'bold', fontFamily: 'monospace',
              color: '#44ff88',
              textShadow: '0 1px 4px rgba(0,0,0,0.9)',
              opacity: alpha, pointerEvents: 'none', zIndex: 14,
              whiteSpace: 'nowrap',
            }}>
              +{fx.value}
            </div>
          );
        }

        if (fx.type === 'heal-pop') {
          return (
            <div key={fx.id} style={{
              position: 'absolute',
              left: fx.col * TILE, top: fx.row * TILE,
              width: TILE, height: TILE,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 16 + fx.t * 10,
              opacity: alpha, pointerEvents: 'none', zIndex: 10,
              filter: `drop-shadow(0 0 6px rgba(80,255,150,${alpha}))`,
            }}>
              ✚
            </div>
          );
        }

        if (fx.type === 'heal-proj') {
          const px = (fx.fromCol + (fx.toCol - fx.fromCol) * fx.t) * TILE + TILE / 2;
          const py = (fx.fromRow + (fx.toRow - fx.fromRow) * fx.t) * TILE + TILE / 2;
          return (
            <div key={fx.id} style={{
              position: 'absolute',
              left: px - 5, top: py - 5,
              width: 10, height: 10,
              background: '#44ff88',
              borderRadius: '50%',
              boxShadow: '0 0 8px #44ff88, 0 0 3px rgba(255,255,255,0.8)',
              opacity: 0.9, pointerEvents: 'none', zIndex: 9,
            }} />
          );
        }

        if (fx.type === 'explosion') {
          const cx = fx.col * TILE + TILE / 2;
          const cy = fx.row * TILE + TILE / 2;
          const r  = fx.t * (fx.aoeRadius + 0.5) * TILE;
          return (
            <div key={fx.id} style={{
              position: 'absolute',
              left: cx - r, top: cy - r,
              width: r * 2, height: r * 2,
              border: `3px solid rgba(255,150,30,${alpha})`,
              background: `radial-gradient(circle, rgba(255,100,0,${alpha * 0.3}) 0%, transparent 70%)`,
              borderRadius: '50%',
              pointerEvents: 'none', zIndex: 11,
            }} />
          );
        }

        return null;
      })}

      <style>{`
        @keyframes reticlePulse {
          from { opacity: 0.35; }
          to   { opacity: 1.0; }
        }
        @keyframes aimPulse {
          from { opacity: 0.4; }
          to   { opacity: 1.0; }
        }
      `}</style>
    </div>
  );
}
