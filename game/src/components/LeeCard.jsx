import { getTypeColor, getTypeEmoji } from '@lee/shared';

const TIER_LABEL = { 1: '', 2: '✦', 3: '✦✦' };

/** @param {{ lee: object, selected?: boolean, onClick?: () => void, disabled?: boolean }} props */
export default function LeeCard({ lee, selected, onClick, disabled }) {
  const typeColor = getTypeColor(lee.type);
  const typeEmoji = getTypeEmoji(lee.type);
  const tierLabel = TIER_LABEL[lee.tier] || '';

  const abilities = lee.abilities || [];
  const primaryAbility = abilities[0];

  return (
    <div
      onClick={disabled ? undefined : onClick}
      style={{
        width: 180,
        background: '#111',
        border: `2px solid ${selected ? '#fff' : typeColor}`,
        borderRadius: 8,
        overflow: 'hidden',
        cursor: disabled ? 'default' : (onClick ? 'pointer' : 'default'),
        opacity: disabled ? 0.5 : 1,
        boxShadow: selected ? `0 0 12px ${typeColor}` : 'none',
        transition: 'border-color 0.15s, box-shadow 0.15s',
        userSelect: 'none',
      }}
    >
      {/* Header */}
      <div style={{
        background: typeColor + '33',
        padding: '6px 8px',
        fontSize: 11,
        color: typeColor,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <span>{typeEmoji} {lee.type?.toUpperCase()} · TIER {lee.tier}{tierLabel && ` ${tierLabel}`}</span>
        {primaryAbility && (
          <span style={{ color: '#888' }}>
            ⏱ {primaryAbility.actSpeed ? (1 / primaryAbility.actSpeed).toFixed(1) : '?'}s
          </span>
        )}
      </div>

      {/* Name */}
      <div style={{ padding: '6px 8px 4px', fontWeight: 'bold', fontSize: 15, color: '#eee', display: 'flex', justifyContent: 'space-between' }}>
        <span>{lee.name}</span>
      </div>

      {/* Image area */}
      <div style={{
        height: 70,
        background: '#0a0a0a',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 40,
      }}>
        {lee.emoji || '❓'}
      </div>

      {/* Flavor text */}
      <div style={{
        padding: '6px 8px',
        fontSize: 11,
        color: '#888',
        fontStyle: 'italic',
        borderTop: '1px solid #222',
        minHeight: 44,
      }}>
        "{lee.flavor}"
      </div>

      {/* Stats row */}
      <div style={{
        padding: '4px 8px',
        fontSize: 11,
        display: 'flex',
        gap: 8,
        borderTop: '1px solid #222',
        color: '#bbb',
      }}>
        <span title="Attack">⚔ {primaryAbility?.damage ?? 0}</span>
        <span title="Defense">🛡 {lee.baseStats?.def ?? 0}</span>
        <span title="HP">❤ {lee.baseStats?.hp ?? 0}</span>
        <span title="Armor">🗡 {lee.baseStats?.armor ?? 0}</span>
      </div>

      {/* Ability chips */}
      <div style={{
        padding: '4px 8px 6px',
        display: 'flex',
        flexWrap: 'wrap',
        gap: 4,
        borderTop: '1px solid #222',
      }}>
        {abilities.map(ab => (
          <span key={ab.id} style={{
            background: '#222',
            border: '1px solid #333',
            borderRadius: 4,
            padding: '1px 5px',
            fontSize: 10,
            color: '#aaa',
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
