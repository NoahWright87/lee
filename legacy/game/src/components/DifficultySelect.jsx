import { useState } from 'react';
import { DIFFICULTY_CONFIG } from '@lee/shared';

const STYLE_ID = 'difficulty-keyframes';
if (!document.getElementById(STYLE_ID)) {
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
    @keyframes difficultyGlow {
      0%, 100% { opacity: 0.7; }
      50%       { opacity: 1; }
    }
  `;
  document.head.appendChild(s);
}

const DIFFICULTY_DETAILS = {
  easy: {
    bullets: [
      'Enemies start at 45% of their normal stats',
      'Enemy stat growth reaches 100% around round 32',
      'Smaller enemy squads throughout',
      'Best for learning how Lees combine and level up',
    ],
    emoji: '🌿',
  },
  normal: {
    bullets: [
      'Enemies start at 60% of their normal stats',
      'Enemy stat growth reaches 100% around round 20',
      'Standard enemy squad sizes',
      'Challenging but winnable with good decisions',
    ],
    emoji: '⚔️',
  },
  hard: {
    bullets: [
      'Enemies start at 72% of their normal stats',
      'Enemy stat growth reaches 100% around round 8',
      'Larger, more powerful enemy squads',
      'Every battle counts — mistakes are punished',
    ],
    emoji: '💀',
  },
};

export default function DifficultySelect({ onConfirm }) {
  const [hovered, setHovered] = useState(null);
  const [selected, setSelected] = useState('normal');

  const keys = ['easy', 'normal', 'hard'];

  return (
    <div style={{
      minHeight: '100vh',
      background: '#080808',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '40px 24px',
      gap: 32,
      fontFamily: 'monospace',
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ color: '#eee', fontSize: 32, fontWeight: 'bold', letterSpacing: 6 }}>
          SELECT DIFFICULTY
        </div>
        <div style={{ color: '#444', fontSize: 13, marginTop: 8 }}>
          This affects enemy strength and squad size throughout your run.
        </div>
      </div>

      <div style={{
        display: 'flex',
        gap: 20,
        flexWrap: 'wrap',
        justifyContent: 'center',
        maxWidth: 820,
      }}>
        {keys.map(key => {
          const cfg     = DIFFICULTY_CONFIG[key];
          const details = DIFFICULTY_DETAILS[key];
          const isSelected = selected === key;
          const isHovered  = hovered === key;
          const active     = isSelected || isHovered;

          return (
            <div
              key={key}
              onClick={() => setSelected(key)}
              onMouseEnter={() => setHovered(key)}
              onMouseLeave={() => setHovered(null)}
              style={{
                width: 230,
                background: isSelected ? `${cfg.color}18` : '#111',
                border: `2px solid ${active ? cfg.color : '#2a2a2a'}`,
                borderRadius: 12,
                padding: '22px 18px',
                cursor: 'pointer',
                transition: 'border-color 0.15s, background 0.15s, transform 0.12s, box-shadow 0.15s',
                transform: isSelected ? 'translateY(-3px)' : 'none',
                boxShadow: isSelected ? `0 6px 24px ${cfg.color}33` : 'none',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 28 }}>{details.emoji}</span>
                <div>
                  <div style={{
                    color: active ? cfg.color : '#ccc',
                    fontWeight: 'bold',
                    fontSize: 18,
                    letterSpacing: 1,
                    transition: 'color 0.15s',
                  }}>
                    {cfg.label.toUpperCase()}
                  </div>
                </div>
                {isSelected && (
                  <div style={{
                    marginLeft: 'auto',
                    color: cfg.color,
                    fontSize: 16,
                  }}>✓</div>
                )}
              </div>

              <div style={{ color: '#777', fontSize: 12, lineHeight: 1.5 }}>
                {cfg.description}
              </div>

              <ul style={{
                margin: 0,
                padding: '0 0 0 14px',
                listStyle: 'none',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}>
                {details.bullets.map((b, i) => (
                  <li key={i} style={{
                    fontSize: 11,
                    color: active ? '#aaa' : '#555',
                    transition: 'color 0.15s',
                    paddingLeft: 8,
                    borderLeft: `2px solid ${active ? cfg.color + '66' : '#333'}`,
                    lineHeight: 1.4,
                  }}>
                    {b}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      <button
        onClick={() => onConfirm(selected)}
        style={{
          background:   DIFFICULTY_CONFIG[selected].color + '22',
          border:       `2px solid ${DIFFICULTY_CONFIG[selected].color}`,
          borderRadius: 8,
          color:        DIFFICULTY_CONFIG[selected].color,
          fontSize:     16,
          fontFamily:   'monospace',
          fontWeight:   'bold',
          letterSpacing: 2,
          padding:      '12px 40px',
          cursor:       'pointer',
          marginTop:    8,
        }}
      >
        BEGIN →
      </button>
    </div>
  );
}
