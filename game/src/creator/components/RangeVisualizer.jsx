import { chebyshev } from '@obviouslee/shared';

const CELL = 28;
const GRID = 9; // 9×9 grid, unit in center at (4,4)
const CENTER = Math.floor(GRID / 2);

/**
 * Shows a small grid preview of which tiles an ability can reach from center.
 * Red = attack, Green = heal.
 *
 * @param {{ ability: object }} props
 */
export default function RangeVisualizer({ ability }) {
  if (!ability) return null;
  const { range = 1, aoeRadius = 0, type } = ability;
  const isHeal = type === 'heal' || type === 'buff' || type === 'shield';

  const cells = [];
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      const dist = chebyshev({ row: r, col: c }, { row: CENTER, col: CENTER });
      const inRange  = dist <= range && dist > 0;
      const isCenter = r === CENTER && c === CENTER;
      const inAoe    = aoeRadius > 0 && dist <= aoeRadius;

      let bg = '#111';
      if (isCenter)   bg = '#333';
      else if (inAoe) bg = isHeal ? 'rgba(60,200,100,0.5)' : 'rgba(255,80,80,0.5)';
      else if (inRange) bg = isHeal ? 'rgba(60,200,100,0.25)' : 'rgba(255,80,80,0.25)';

      cells.push(
        <div
          key={`${r},${c}`}
          style={{
            width: CELL, height: CELL,
            background: bg,
            border: '1px solid #1a1a1a',
            boxSizing: 'border-box',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: isCenter ? 14 : 8,
            color: '#555',
          }}
        >
          {isCenter ? '🎯' : ''}
        </div>
      );
    }
  }

  return (
    <div>
      <div style={{ fontSize: 11, color: '#666', marginBottom: 6 }}>
        Range {range}{aoeRadius > 0 ? ` (AOE ${aoeRadius})` : ''} preview
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${GRID}, ${CELL}px)`,
        gridTemplateRows:    `repeat(${GRID}, ${CELL}px)`,
        border: '1px solid #222',
        borderRadius: 4,
        overflow: 'hidden',
      }}>
        {cells}
      </div>
    </div>
  );
}
