import { useRef } from 'react';
import LeeCard from './LeeCard.jsx';

/**
 * @param {{
 *   roster: object[],
 *   onEdit: (lee: object) => void,
 *   onDelete: (id: string) => void,
 *   onImport: (lees: object[]) => void,
 * }} props
 */
export default function RosterTab({ roster, onEdit, onDelete, onImport }) {
  const fileRef = useRef(null);

  function handleExportAll() {
    const blob = new Blob([JSON.stringify(roster, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'lees.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleImportFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const parsed = JSON.parse(ev.target.result);
        const lees = Array.isArray(parsed) ? parsed : [parsed];
        onImport(lees);
      } catch {
        alert('Invalid JSON file.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16, height: 'calc(100vh - 50px)', overflow: 'hidden' }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
        <span style={{ fontSize: 13, color: '#888', fontWeight: 'bold', marginRight: 8 }}>
          ROSTER ({roster.length})
        </span>
        <button onClick={() => fileRef.current?.click()} style={toolBtn}>⬆ Import JSON</button>
        <button onClick={handleExportAll} disabled={!roster.length} style={toolBtn}>⬇ Export All</button>
        <input ref={fileRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleImportFile} />
      </div>

      {/* Cards grid */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {roster.length === 0 ? (
          <div style={{ color: '#444', fontSize: 14, fontStyle: 'italic', marginTop: 40, textAlign: 'center' }}>
            No Lees in roster yet.<br />
            <span style={{ fontSize: 12, color: '#333' }}>Create one in the Editor tab, or import a JSON file.</span>
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
            {roster.map(lee => (
              <div key={lee.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <LeeCard lee={lee} onClick={() => onEdit(lee)} />
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => onEdit(lee)} style={{ ...actionBtn, flex: 1 }}>✎ Edit</button>
                  <button
                    onClick={() => {
                      if (confirm(`Delete ${lee.name}?`)) onDelete(lee.id);
                    }}
                    style={{ ...actionBtn, color: '#ff6666', borderColor: '#442222' }}
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const toolBtn = {
  background: '#1a1a1a', border: '1px solid #333', borderRadius: 6,
  color: '#aaa', padding: '6px 12px', cursor: 'pointer',
  fontFamily: 'monospace', fontSize: 12,
};

const actionBtn = {
  background: '#141414', border: '1px solid #2a2a2a', borderRadius: 4,
  color: '#888', padding: '5px 8px', cursor: 'pointer',
  fontFamily: 'monospace', fontSize: 11,
};
