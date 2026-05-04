import UnitToken from './UnitToken.jsx';

const TILE = 72;

/**
 * The battle field grid.
 * During battle: shows units auto-fighting.
 * During deploy: `deployMode=true`, tiles in player zone are clickable.
 *
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

  // Gather in-flight reticles from pending attacks
  const reticles = [];
  units.forEach(u => {
    (u.pendingAttacks || []).forEach(atk => {
      reticles.push({ row: atk.targetRow, col: atk.targetCol, key: `${u.uid}-${atk.abilityId}` });
    });
  });

  const playerZoneRows = Array.from({ length: deployRows }, (_, i) => rows - deployRows + i);
  const enemyZoneRows  = Array.from({ length: deployRows }, (_, i) => i);

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
                background: isEnemyZone
                  ? 'rgba(255,60,60,0.06)'
                  : isPlayerZone
                    ? 'rgba(60,120,255,0.06)'
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

      {/* Reticles on in-flight attack target tiles */}
      {reticles.map(r => (
        <div
          key={r.key}
          style={{
            position: 'absolute',
            left: r.col * TILE + 2, top: r.row * TILE + 2,
            width: TILE - 4, height: TILE - 4,
            border: '2px solid rgba(255,80,80,0.7)',
            borderRadius: 4,
            animation: 'reticlePulse 0.5s ease-in-out infinite alternate',
            pointerEvents: 'none',
            zIndex: 4,
          }}
        />
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

      <style>{`
        @keyframes reticlePulse {
          from { opacity: 0.3; }
          to   { opacity: 1.0; }
        }
      `}</style>
    </div>
  );
}
