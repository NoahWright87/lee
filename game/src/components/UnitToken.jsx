import { getTypeColor } from '@lee/shared';

const TILE = 72;

/** Renders one unit on the battle field as an absolutely-positioned token. */
export default function UnitToken({ unit, tileSize = TILE, onClick, selected }) {
  const typeColor = getTypeColor(unit.type || 'none');
  const hpPct = Math.max(0, unit.hp / (unit.maxHp || 1));
  const hpColor = hpPct > 0.5 ? '#44cc44' : hpPct > 0.25 ? '#ffcc00' : '#ff4444';
  const activeAbilities = (unit.abilities || []).filter(a => a.type !== 'thorns');

  const gap = 2;
  const size = tileSize - gap * 2;

  return (
    <div
      onClick={onClick}
      style={{
        position: 'absolute',
        left: unit.col * tileSize + gap,
        top:  unit.row * tileSize + gap,
        width: size,
        height: size,
        background: unit.alive
          ? (unit.flash > 0 ? `rgba(255,80,80,${unit.flash * 0.7})` : '#1a1a1a')
          : 'transparent',
        border: `2px solid ${selected ? '#fff' : typeColor}`,
        borderRadius: 6,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-start',
        padding: '2px 2px 2px',
        opacity: unit.alive ? 1 : 0.15,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'left 0.12s ease, top 0.12s ease, background 0.06s',
        userSelect: 'none',
        overflow: 'hidden',
        boxSizing: 'border-box',
        zIndex: unit.alive ? 2 : 1,
      }}
    >
      {/* Dead overlay */}
      {!unit.alive && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, zIndex: 3 }}>
          💀
        </div>
      )}

      {/* Level badge */}
      {unit.level > 1 && (
        <div style={{
          position: 'absolute', top: 2, right: 3,
          background: '#c8a000', color: '#000',
          fontSize: 9, fontWeight: 'bold',
          borderRadius: 3, padding: '0px 3px',
        }}>
          {unit.level}
        </div>
      )}

      {/* Emoji */}
      <div style={{ fontSize: 22, lineHeight: 1, marginTop: 1 }}>
        {unit.emoji || '🧍'}
      </div>

      {/* Name (first word only) */}
      <div style={{ fontSize: 9, color: '#ccc', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.2 }}>
        {(unit.name || '').split(' ')[0]}
      </div>

      {/* HP bar */}
      <div style={{ width: '100%', height: 4, background: '#333', borderRadius: 2, marginTop: 2 }}>
        <div style={{ width: `${hpPct * 100}%`, height: '100%', background: hpColor, borderRadius: 2, transition: 'width 0.1s' }} />
      </div>

      {/* Move bar — only when actively moving */}
      {unit.moving && (
        <div style={{ width: '100%', height: 3, background: '#333', borderRadius: 2, marginTop: 1 }}>
          <div style={{ width: `${(unit.moveBar || 0) * 100}%`, height: '100%', background: '#4488ff', borderRadius: 2 }} />
        </div>
      )}

      {/* Cast bars — one per active ability */}
      {activeAbilities.map(ab => {
        const fill = unit.castBars?.[ab.id] ?? 0;
        const barColor = fill > 0.85 ? '#ff4444' : typeColor;
        return (
          <div key={ab.id} style={{ width: '100%', height: 3, background: '#333', borderRadius: 2, marginTop: 1 }}>
            <div style={{
              width: `${fill * 100}%`,
              height: '100%',
              background: barColor,
              borderRadius: 2,
              transition: 'background 0.1s',
            }} />
          </div>
        );
      })}
    </div>
  );
}
