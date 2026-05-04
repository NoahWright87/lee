import { getTypeColor } from '@lee/shared';
import UnitToken from './UnitToken.jsx';

const TILE = 72;

/**
 * @param {{
 *   units: object[],
 *   fieldConfig: {rows:number,cols:number,deployRows:number},
 *   deployMode?: boolean,
 *   selectedUnit?: object|null,
 *   onTileClick?: (row:number, col:number) => void,
 *   onUnitClick?: (unit:object) => void,
 * }} props
 */
export default function BattleField({ units, fieldConfig, deployMode, selectedUnit, onTileClick, onUnitClick }) {
  const { rows, cols, deployRows } = fieldConfig;
  const W = cols * TILE;
  const H = rows * TILE;

  const playerZoneRows = Array.from({ length: deployRows }, (_, i) => rows - deployRows + i);
  const enemyZoneRows  = Array.from({ length: deployRows }, (_, i) => i);

  // ── Aimed-tile indicators (cast bar charging → target) ─────────────────
  const aimedTiles = new Map(); // `r,c` → typeColor of earliest aimer
  units.forEach(u => {
    if (!u.alive || !u.aims) return;
    const color = getTypeColor(u.type || 'none');
    Object.values(u.aims).forEach(({ row, col }) => {
      const key = `${row},${col}`;
      if (!aimedTiles.has(key)) aimedTiles.set(key, color);
    });
  });

  // ── In-flight attacks ───────────────────────────────────────────────────
  const inFlight = [];
  units.forEach(u => {
    (u.pendingAttacks || []).forEach(atk => {
      inFlight.push({ ...atk, attackerType: u.type || 'none' });
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
                background: isEnemyZone  ? 'rgba(255,60,60,0.06)'
                          : isPlayerZone ? 'rgba(60,120,255,0.06)'
                          : '#0e0e0e',
                border: '1px solid #1a1a1a',
                borderRadius: 3,
                cursor: isClickable ? 'pointer' : 'default',
                boxSizing: 'border-box',
              }}
            />
          );
        })
      )}

      {/* Aimed-tile dotted outlines (cast bar charging) */}
      {Array.from(aimedTiles.entries()).map(([key, color]) => {
        const [r, c] = key.split(',').map(Number);
        return (
          <div key={`aim-${key}`} style={{
            position: 'absolute',
            left: c * TILE + 3, top: r * TILE + 3,
            width: TILE - 6, height: TILE - 6,
            border: `2px dashed ${color}88`,
            borderRadius: 4,
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
          border: '2px solid rgba(255,80,80,0.7)',
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
        // Mortar: parabolic arc; missile: straight
        const arcLift = atk.abilityType === 'mortar'
          ? Math.sin(Math.PI * t) * 48
          : 0;
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
            boxShadow: `0 0 5px ${color}`,
            pointerEvents: 'none',
            zIndex: 8,
          }} />
        );
      })}

      {/* Melee impact flash — brief colored rectangle on target tile */}
      {inFlight.filter(atk => atk.isMelee).map((atk, i) => {
        const progress = 1 - atk.timeLeft / (atk.totalTime || 0.001);
        const color = getTypeColor(atk.attackerType);
        const opacity = Math.sin(Math.PI * progress) * 0.6;
        return (
          <div key={`melee-${i}`} style={{
            position: 'absolute',
            left: atk.targetCol * TILE + TILE * 0.1,
            top:  atk.targetRow * TILE + TILE * 0.1,
            width:  TILE * 0.8,
            height: TILE * 0.8,
            background: `rgba(255,140,0,${opacity})`,
            border: `2px solid ${color}`,
            borderRadius: 4,
            pointerEvents: 'none',
            zIndex: 6,
          }} />
        );
      })}

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

      <style>{`
        @keyframes reticlePulse {
          from { opacity: 0.3; }
          to   { opacity: 1.0; }
        }
      `}</style>
    </div>
  );
}
