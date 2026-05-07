import { useState, useEffect } from 'react';
import { ALL_LEES } from '@lee/shared/data/index.js';
import EditorTab  from './components/EditorTab.jsx';
import RosterTab  from './components/RosterTab.jsx';

const STORAGE_KEY = 'lee-creator-roster';

/** Load roster from localStorage, falling back to built-in starter Lees. */
function loadRoster() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {/* ignore */}
  return [...ALL_LEES];
}

function saveRoster(roster) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(roster));
  } catch {/* ignore */}
}

export default function App() {
  const [tab, setTab]           = useState('editor');
  const [roster, setRoster]     = useState(loadRoster);
  const [editingLee, setEditingLee] = useState(null);

  // Persist to localStorage on every change
  useEffect(() => { saveRoster(roster); }, [roster]);

  function handleSaveLee(lee) {
    setRoster(prev => {
      const existing = prev.findIndex(l => l.id === lee.id);
      if (existing >= 0) {
        const next = [...prev];
        next[existing] = lee;
        return next;
      }
      return [...prev, lee];
    });
  }

  function handleDeleteLee(id) {
    setRoster(prev => prev.filter(l => l.id !== id));
  }

  function handleEditLee(lee) {
    setEditingLee(lee);
    setTab('editor');
  }

  function handleNewLee() {
    setEditingLee(null);
  }

  /** Merge imported Lees by id — existing ids get updated, new ones are appended. */
  function handleImport(imported) {
    setRoster(prev => {
      const map = Object.fromEntries(prev.map(l => [l.id, l]));
      imported.forEach(l => { map[l.id] = l; });
      return Object.values(map);
    });
  }

  return (
    <div style={{ fontFamily: 'monospace', background: '#080808', minHeight: '100vh' }}>
      {/* Tab bar */}
      <div style={{
        height: 50, background: '#0e0e0e',
        borderBottom: '1px solid #1a1a1a',
        display: 'flex', alignItems: 'center', padding: '0 20px', gap: 0,
      }}>
        <span style={{ color: '#666', fontSize: 14, fontWeight: 'bold', marginRight: 24 }}>
          Lee Creator
        </span>
        {['editor', 'roster'].map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              background: 'none',
              border: 'none',
              borderBottom: tab === t ? '2px solid #4488ff' : '2px solid transparent',
              color: tab === t ? '#fff' : '#666',
              padding: '0 16px', height: 50,
              cursor: 'pointer', fontFamily: 'monospace', fontSize: 13,
              textTransform: 'capitalize', letterSpacing: 0.5,
            }}
          >
            {t === 'editor' ? '✎ Editor' : `📋 Roster (${roster.length})`}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'editor' && (
        <EditorTab
          roster={roster}
          editingLee={editingLee}
          onSave={handleSaveLee}
          onNew={handleNewLee}
        />
      )}
      {tab === 'roster' && (
        <RosterTab
          roster={roster}
          onEdit={handleEditLee}
          onDelete={handleDeleteLee}
          onImport={handleImport}
        />
      )}
    </div>
  );
}
