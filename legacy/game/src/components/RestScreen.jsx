import { useState } from 'react';

/**
 * @param {{
 *   bench: object[],
 *   fieldUnits: object[],
 *   onRest: () => void,
 *   onTrain: (uid: string) => void,
 *   onLeave: () => void,
 * }} props
 */
export default function RestScreen({ bench, fieldUnits, onRest, onTrain, onLeave }) {
  const [mode, setMode]   = useState(null); // null | 'train'
  const [rested, setRested] = useState(false);

  const allPlayerUnits = [
    ...fieldUnits.filter(u => u.side === 'player' && u.alive),
    ...bench,
  ];

  function handleRest() {
    if (rested) return;
    onRest();
    setRested(true);
  }

  if (mode === 'train') {
    return (
      <div style={outerStyle}>
        <h2 style={titleStyle}>Train</h2>
        <p style={subtitleStyle}>Choose a Lee to permanently buff (+10% max HP).</p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center', marginTop: 16 }}>
          {allPlayerUnits.map(u => (
            <button
              key={u.uid}
              onClick={() => { onTrain(u.uid); setMode(null); }}
              style={{
                background: '#0e1a12', border: '1px solid #1e3a28', borderRadius: 8,
                padding: '12px 16px', cursor: 'pointer', fontFamily: 'monospace',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
                color: '#ccc', minWidth: 90,
                transition: 'border-color 0.15s, background 0.15s',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background    = '#122018';
                e.currentTarget.style.borderColor   = '#33bb66';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background    = '#0e1a12';
                e.currentTarget.style.borderColor   = '#1e3a28';
              }}
            >
              <span style={{ fontSize: 30 }}>{u.emoji}</span>
              <span style={{ fontSize: 11 }}>{u.name}</span>
              <span style={{ fontSize: 9, color: '#555' }}>
                {u.hp}/{u.maxHp} HP · Lv {u.level}
              </span>
              <span style={{ fontSize: 9, color: '#33bb66', marginTop: 2 }}>+10% max HP</span>
            </button>
          ))}
        </div>
        <button style={cancelBtn} onClick={() => setMode(null)}>← Back</button>
      </div>
    );
  }

  return (
    <div style={outerStyle}>
      <div style={{ fontSize: 48, marginBottom: 4 }}>🔥</div>
      <h2 style={titleStyle}>Rest Site</h2>
      <p style={subtitleStyle}>Your team takes a moment to recover.</p>

      <div style={{ display: 'flex', gap: 16, marginTop: 28, flexWrap: 'wrap', justifyContent: 'center' }}>

        {/* Rest option */}
        <div
          onClick={handleRest}
          style={{
            width: 180, background: rested ? '#0a100c' : '#0e1a12',
            border: `1px solid ${rested ? '#1a2a1e' : '#2a5a38'}`, borderRadius: 10,
            padding: 20, cursor: rested ? 'not-allowed' : 'pointer',
            fontFamily: 'monospace', display: 'flex', flexDirection: 'column',
            alignItems: 'center', gap: 8, opacity: rested ? 0.5 : 1,
            transition: 'background 0.15s',
          }}
          onMouseEnter={e => { if (!rested) e.currentTarget.style.background = '#122018'; }}
          onMouseLeave={e => { e.currentTarget.style.background = rested ? '#0a100c' : '#0e1a12'; }}
        >
          <span style={{ fontSize: 34 }}>💤</span>
          <div style={{ color: '#44cc77', fontSize: 14, fontWeight: 'bold' }}>
            {rested ? 'Rested' : 'Rest'}
          </div>
          <div style={{ color: '#446655', fontSize: 10, textAlign: 'center', lineHeight: 1.5 }}>
            {rested
              ? 'Your team has healed.'
              : 'Heal all units for 25% of their maximum HP.'}
          </div>
        </div>

        {/* Train option */}
        <div
          onClick={() => setMode('train')}
          style={{
            width: 180, background: '#0e1218',
            border: '1px solid #2a3a5a', borderRadius: 10,
            padding: 20, cursor: 'pointer',
            fontFamily: 'monospace', display: 'flex', flexDirection: 'column',
            alignItems: 'center', gap: 8,
            transition: 'background 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = '#121826'; }}
          onMouseLeave={e => { e.currentTarget.style.background = '#0e1218'; }}
        >
          <span style={{ fontSize: 34 }}>⚡</span>
          <div style={{ color: '#4488cc', fontSize: 14, fontWeight: 'bold' }}>Train</div>
          <div style={{ color: '#334466', fontSize: 10, textAlign: 'center', lineHeight: 1.5 }}>
            Permanently increase one Lee's max HP by 10%.
          </div>
        </div>
      </div>

      <button
        onClick={onLeave}
        style={{
          marginTop: 36, padding: '12px 40px',
          background: '#1a1a2e', border: '1px solid #333', borderRadius: 8,
          color: '#888', fontSize: 14, fontFamily: 'monospace',
          cursor: 'pointer', letterSpacing: 1,
          transition: 'color 0.2s, border-color 0.2s',
        }}
        onMouseEnter={e => { e.currentTarget.style.color = '#ccc'; e.currentTarget.style.borderColor = '#555'; }}
        onMouseLeave={e => { e.currentTarget.style.color = '#888'; e.currentTarget.style.borderColor = '#333'; }}
      >
        Leave →
      </button>
    </div>
  );
}

const outerStyle = {
  display: 'flex', flexDirection: 'column', alignItems: 'center',
  gap: 8, padding: 40,
};
const titleStyle = { fontSize: 28, color: '#eee', margin: 0 };
const subtitleStyle = { color: '#555', fontSize: 13, margin: 0 };
const cancelBtn = {
  marginTop: 20, padding: '10px 28px',
  background: 'transparent', border: '1px solid #333', borderRadius: 6,
  color: '#666', fontSize: 13, fontFamily: 'monospace', cursor: 'pointer',
};
