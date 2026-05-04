import { useState } from 'react';
import BattleField from './BattleField.jsx';
import LeeCard from './LeeCard.jsx';

const TILE = 72;

/**
 * Deploy / rearrange screen shown before each battle.
 *
 * Player can click a bench unit to select it, then click a deploy-zone
 * tile to place it. Clicking a placed unit returns it to the bench.
 * Clicking another bench unit while one is selected swaps selection.
 *
 * @param {{
 *   initialDeployed: object[],  Units already on field with row/col set
 *   bench: object[],
 *   fieldConfig: {rows:number,cols:number,deployRows:number},
 *   round: number,
 *   onStart: (deployed: object[], bench: object[]) => void,
 * }} props
 */
export default function DeployScreen({ initialDeployed, bench: initialBench, fieldConfig, round, onStart }) {
  const { rows, cols, deployRows } = fieldConfig;
  const [deployed, setDeployed] = useState(() =>
    initialDeployed.map(u => ({ ...u }))
  );
  const [bench, setBench] = useState(() => initialBench.map(u => ({ ...u })));
  const [selected, setSelected] = useState(null); // uid of selected bench unit

  const deployZoneRows = Array.from({ length: deployRows }, (_, i) => rows - deployRows + i);
  const maxOnField = cols * deployRows;

  function selectBenchUnit(unit) {
    setSelected(prev => prev === unit.uid ? null : unit.uid);
  }

  function handleTileClick(row, col) {
    const occupied = deployed.find(u => u.row === row && u.col === col);

    if (occupied) {
      // Return occupied unit to bench
      setDeployed(prev => prev.filter(u => u.uid !== occupied.uid));
      setBench(prev => [...prev, { ...occupied, row: -1, col: -1 }]);
      setSelected(null);
      return;
    }

    if (!selected) return;

    const unit = bench.find(u => u.uid === selected);
    if (!unit) return;

    setBench(prev => prev.filter(u => u.uid !== selected));
    setDeployed(prev => [...prev, { ...unit, row, col, homeRow: row, homeCol: col }]);
    setSelected(null);
  }

  function handleDeployedClick(unit) {
    // Return deployed unit to bench
    setDeployed(prev => prev.filter(u => u.uid !== unit.uid));
    setBench(prev => [...prev, { ...unit, row: -1, col: -1 }]);
    setSelected(null);
  }

  const allUnitsForField = deployed;

  return (
    <div style={{ display: 'flex', gap: 32, padding: 24, alignItems: 'flex-start', flexWrap: 'wrap', justifyContent: 'center' }}>
      {/* Left: field */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
        <div style={{ color: '#888', fontSize: 12 }}>ROUND {round} — Place your Lees in the blue zone</div>
        <div style={{ position: 'relative' }}>
          <BattleField
            units={allUnitsForField}
            fieldConfig={fieldConfig}
            deployMode
            selectedUnit={null}
            onTileClick={handleTileClick}
            onUnitClick={handleDeployedClick}
          />
        </div>
        <div style={{ color: '#555', fontSize: 11 }}>
          {deployed.length} / {maxOnField} deployed · Click placed unit to recall · Click blue tile to deploy
        </div>
      </div>

      {/* Right: bench + controls */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 220 }}>
        <div style={{ color: '#888', fontSize: 13, fontWeight: 'bold' }}>BENCH ({bench.length})</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 500, overflowY: 'auto' }}>
          {bench.map(unit => (
            <div
              key={unit.uid}
              onClick={() => selectBenchUnit(unit)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 10px',
                background: selected === unit.uid ? '#2a3a5a' : '#141414',
                border: `1px solid ${selected === unit.uid ? '#4488ff' : '#2a2a2a'}`,
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              <span style={{ fontSize: 22 }}>{unit.emoji || '🧍'}</span>
              <div>
                <div style={{ fontSize: 13, color: '#ddd' }}>{unit.name}</div>
                <div style={{ fontSize: 10, color: '#666' }}>
                  ❤ {unit.hp}/{unit.maxHp}
                  {unit.level > 1 && <span style={{ color: '#c8a000', marginLeft: 6 }}>Lv{unit.level}</span>}
                </div>
              </div>
            </div>
          ))}
          {bench.length === 0 && (
            <div style={{ color: '#444', fontSize: 12, fontStyle: 'italic' }}>Bench is empty</div>
          )}
        </div>

        <button
          onClick={() => onStart(deployed, bench)}
          style={{
            padding: '12px 20px',
            background: '#3366ff',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            fontSize: 15,
            fontFamily: 'monospace',
            cursor: 'pointer',
            marginTop: 8,
          }}
        >
          ▶ Start Battle
        </button>
      </div>
    </div>
  );
}
