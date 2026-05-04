import { getTypeColor, getTypeEmoji } from '@obviouslee/shared';

const TIER_LABEL = { 1: '', 2: '✦', 3: '✦✦' };

export default function LeeCard({ lee, selected, onClick, compact }) {
  const typeColor = getTypeColor(lee.type);
  const typeEmoji = getTypeEmoji(lee.type);
  const tierLabel = TIER_LABEL[lee.tier] || '';
  const abilities = lee.abilities || [];
  const primaryAbility = abilities[0];

  if (compact) {
    return (
      <div
        onClick={onClick}
        style={{
          background: '#111',
          border: `2px solid ${selected ? '#fff' : typeColor}`,
          borderRadius: 6,
          padding: '8px 10px',
          cursor: onClick ? 'pointer' : 'default',
          display: 'flex', alignItems: 'center', gap: 10,
          boxShadow: selected ? `0 0 8px ${typeColor}` : 'none',
        }}
      >
        <span style={{ fontSize: 24 }}>{lee.emoji || '❓'}</span>
        <div>
          <div style={{ fontSize: 13, color: '#eee', fontWeight: 'bold' }}>{lee.name}</div>
          <div style={{ fontSize: 10, color: '#666' }}>
            {typeEmoji} Tier {lee.tier}{tierLabel} · ❤{lee.baseStats?.hp}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={onClick}
      style={{
        width: 180,
        background: '#111',
        border: `2px solid ${selected ? '#fff' : typeColor}`,
        borderRadius: 8,
        overflow: 'hidden',
        cursor: onClick ? 'pointer' : 'default',
        boxShadow: selected ? `0 0 12px ${typeColor}` : 'none',
        transition: 'border-color 0.15s, box-shadow 0.15s',
        userSelect: 'none',
        flexShrink: 0,
      }}
    >
      <div style={{
        background: typeColor + '33',
        padding: '6px 8px',
        fontSize: 11,
        color: typeColor,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span>{typeEmoji} {(lee.type || 'none').toUpperCase()} · T{lee.tier}{tierLabel}</span>
        {primaryAbility && (
          <span style={{ color: '#666' }}>⏱ {(1 / (primaryAbility.actSpeed || 1)).toFixed(1)}s</span>
        )}
      </div>

      <div style={{ padding: '6px 8px 4px', fontWeight: 'bold', fontSize: 15, color: '#eee' }}>
        {lee.name}
      </div>

      <div style={{
        height: 70, background: '#0a0a0a',
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40,
      }}>
        {lee.emoji || '❓'}
      </div>

      <div style={{
        padding: '6px 8px', fontSize: 11, color: '#888', fontStyle: 'italic',
        borderTop: '1px solid #222', minHeight: 44,
      }}>
        "{lee.flavor || 'No flavor text.'}"
      </div>

      <div style={{
        padding: '4px 8px', fontSize: 11,
        display: 'flex', gap: 8, borderTop: '1px solid #222', color: '#bbb',
      }}>
        <span title="Damage">⚔ {primaryAbility?.damage ?? 0}</span>
        <span title="Defense">🛡 {lee.baseStats?.def ?? 0}</span>
        <span title="HP">❤ {lee.baseStats?.hp ?? 0}</span>
        <span title="Armor">🗡 {lee.baseStats?.armor ?? 0}</span>
      </div>

      <div style={{
        padding: '4px 8px 6px',
        display: 'flex', flexWrap: 'wrap', gap: 4,
        borderTop: '1px solid #222',
      }}>
        {abilities.map(ab => (
          <span key={ab.id} style={{
            background: '#222', border: '1px solid #333',
            borderRadius: 4, padding: '1px 5px', fontSize: 10, color: '#aaa',
          }}>
            {abilityIcon(ab.type)} {ab.label || ab.type}
          </span>
        ))}
      </div>
    </div>
  );
}

function abilityIcon(type) {
  const map = {
    melee: '👊', missile: '🎯', mortar: '💣', heal: '💚',
    buff: '⬆️', thorns: '🌵', taunt: '📣', shield: '🛡️',
  };
  return map[type] || '?';
}
