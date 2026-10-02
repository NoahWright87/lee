import { useState } from 'react';
import LeeCard from './LeeCard.jsx';

/**
 * @param {{
 *   options: object[],
 *   pickCount: number,
 *   title: string,
 *   subtitle?: string,
 *   onConfirm: (picked: object[]) => void,
 * }} props
 */
export default function DraftScreen({ options, pickCount, title, subtitle, onConfirm }) {
  const [selected, setSelected] = useState([]);

  function toggle(lee) {
    setSelected(prev => {
      const already = prev.find(l => l.id === lee.id && prev.indexOf(l) === prev.findIndex(x => x.id === lee.id));
      if (already) return prev.filter(l => l !== already);
      if (prev.length >= pickCount) return prev;
      return [...prev, lee];
    });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24, padding: 32 }}>
      <div style={{ textAlign: 'center' }}>
        <h2 style={{ fontSize: 28, color: '#eee', marginBottom: 6 }}>{title}</h2>
        {subtitle && <p style={{ color: '#888', fontSize: 13 }}>{subtitle}</p>}
        <p style={{ color: '#aaa', fontSize: 13, marginTop: 4 }}>
          Pick {pickCount} — {selected.length} / {pickCount} chosen
        </p>
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'center' }}>
        {options.map((lee, i) => {
          const isSelected = selected.some(s => s === lee);
          const isFull = selected.length >= pickCount && !isSelected;
          return (
            <LeeCard
              key={`${lee.id}-${i}`}
              lee={lee}
              selected={isSelected}
              disabled={isFull}
              onClick={() => toggle(lee)}
            />
          );
        })}
      </div>

      <button
        disabled={selected.length < pickCount}
        onClick={() => onConfirm(selected)}
        style={{
          padding: '12px 36px',
          background: selected.length >= pickCount ? '#3366ff' : '#222',
          color: selected.length >= pickCount ? '#fff' : '#555',
          border: 'none',
          borderRadius: 8,
          fontSize: 16,
          fontFamily: 'monospace',
          cursor: selected.length >= pickCount ? 'pointer' : 'not-allowed',
          transition: 'background 0.2s',
        }}
      >
        Confirm
      </button>
    </div>
  );
}
