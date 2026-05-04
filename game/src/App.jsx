import { useState, useEffect, useRef, useCallback } from 'react';
import {
  tickField,
  buildCombineMap,
  findMerges,
  getCombineResult,
  processPostBattle,
  createRuntimeUnit,
  resetToHome,
  generateEnemies,
  getInitialDraftOptions,
  getBetweenRoundDraftOptions,
} from '@obviouslee/shared';
import { ALL_LEES } from '@obviouslee/shared/data/index.js';

import BattleField from './components/BattleField.jsx';
import DraftScreen from './components/DraftScreen.jsx';
import DeployScreen from './components/DeployScreen.jsx';
import MergeScreen from './components/MergeScreen.jsx';
import GameOver from './components/GameOver.jsx';

const FIELD_CONFIG = { rows: 8, cols: 4, deployRows: 2 };
const TICK_MS = 1000 / 60;

const COMBINE_MAP = buildCombineMap(ALL_LEES);

export default function App() {
  const [screen, setScreen]               = useState('initial-draft');
  const [round, setRound]                 = useState(1);
  const [fieldUnits, setFieldUnits]       = useState([]);
  const [bench, setBench]                 = useState([]);
  const [draftOptions, setDraftOptions]   = useState(() => getInitialDraftOptions(ALL_LEES, 5));
  const [pendingMerges, setPendingMerges] = useState([]);
  const [paused, setPaused]               = useState(false);
  const [victor, setVictor]               = useState(null); // 'player' | 'enemy'

  // Refs to avoid stale closures in the battle interval
  const benchRef   = useRef(bench);
  const pausedRef  = useRef(paused);
  const roundRef   = useRef(round);
  benchRef.current  = bench;
  pausedRef.current = paused;
  roundRef.current  = round;

  // -------------------------------------------------------------------
  // Battle tick loop
  // -------------------------------------------------------------------
  useEffect(() => {
    if (screen !== 'battle') return;

    const id = setInterval(() => {
      if (pausedRef.current) return;

      setFieldUnits(prev => {
        const { next, events: _events } = tickField(prev, TICK_MS / 1000, FIELD_CONFIG);

        const playerAlive = next.some(u => u.side === 'player' && u.alive);
        const enemyAlive  = next.some(u => u.side === 'enemy'  && u.alive);

        if (!enemyAlive || !playerAlive) {
          clearInterval(id);
          const winner = !enemyAlive ? 'player' : 'enemy';
          setVictor(winner);
          setScreen('battle-end');
        }

        return next;
      });
    }, TICK_MS);

    return () => clearInterval(id);
  }, [screen]);

  // -------------------------------------------------------------------
  // Post-battle transition
  // -------------------------------------------------------------------
  useEffect(() => {
    if (screen !== 'battle-end') return;

    if (victor === 'enemy') {
      setScreen('game-over');
      return;
    }

    // Victory — process post-battle after a brief delay so the user sees the last frame
    const t = setTimeout(() => {
      setFieldUnits(prev => {
        const currentBench = benchRef.current;

        // Reset surviving player units to home positions
        const survivingField = prev
          .filter(u => u.side === 'player' && u.alive)
          .map(u => ({ ...resetToHome({ ...u }) }));

        const { fieldUnits: processedField, benchUnits: processedBench } =
          processPostBattle(survivingField, currentBench.map(u => ({ ...u })));

        // Check for merges across all player units (field + bench)
        const allPlayerUnits = [...processedField, ...processedBench];
        const merges = findMerges(allPlayerUnits, COMBINE_MAP);

        setBench(processedBench);
        setPendingMerges(merges);

        if (merges.length > 0) {
          setScreen('merge');
        } else {
          const opts = getBetweenRoundDraftOptions(ALL_LEES, 4);
          setDraftOptions(opts);
          setScreen('between-draft');
        }

        return processedField;
      });
    }, 800);

    return () => clearTimeout(t);
  }, [screen, victor]);

  // -------------------------------------------------------------------
  // Draft handlers
  // -------------------------------------------------------------------
  function handleInitialDraftConfirm(picked) {
    const newBench = picked.map(lee => createRuntimeUnit(lee, 'player', -1, -1));
    setBench(newBench);
    setScreen('deploy');
  }

  function handleBetweenDraftConfirm(picked) {
    const newUnit = createRuntimeUnit(picked[0], 'player', -1, -1);
    setBench(prev => [...prev, newUnit]);
    setScreen('deploy');
  }

  // -------------------------------------------------------------------
  // Deploy handler
  // -------------------------------------------------------------------
  function handleDeployStart(deployed, remainingBench) {
    const enemies = generateEnemies(ALL_LEES, roundRef.current, FIELD_CONFIG);
    setFieldUnits([...deployed, ...enemies]);
    setBench(remainingBench);
    setVictor(null);
    setPaused(false);
    setScreen('battle');
  }

  // -------------------------------------------------------------------
  // Merge handlers
  // -------------------------------------------------------------------
  function handleMerge() {
    const merge = pendingMerges[0];
    const resultDef = ALL_LEES.find(l => l.id === merge.resultId);
    if (!resultDef) {
      advanceMerge();
      return;
    }

    // Place result where the first source was, inheriting the higher level
    const inheritLevel = Math.max(merge.a.level || 1, merge.b.level || 1);
    const resultUnit = {
      ...createRuntimeUnit(resultDef, 'player', merge.a.row, merge.a.col),
      homeRow: merge.a.homeRow,
      homeCol: merge.a.homeCol,
      level: inheritLevel,
      xp: 0,
    };

    // Remove both sources from field and bench
    setFieldUnits(prev =>
      prev.filter(u => u.uid !== merge.a.uid && u.uid !== merge.b.uid).concat(
        resultUnit.row >= 0 ? [resultUnit] : []
      )
    );
    setBench(prev => {
      const filtered = prev.filter(u => u.uid !== merge.a.uid && u.uid !== merge.b.uid);
      // If both sources were on bench, place result on bench
      const aOnBench = prev.some(u => u.uid === merge.a.uid);
      const bOnBench = prev.some(u => u.uid === merge.b.uid);
      if (aOnBench || bOnBench) {
        return [...filtered, { ...resultUnit, row: -1, col: -1, homeRow: -1, homeCol: -1 }];
      }
      return filtered;
    });

    advanceMerge();
  }

  function handleMergeSkip() {
    advanceMerge();
  }

  function advanceMerge() {
    setPendingMerges(prev => {
      const rest = prev.slice(1);
      if (rest.length === 0) {
        const opts = getBetweenRoundDraftOptions(ALL_LEES, 4);
        setDraftOptions(opts);
        setScreen('between-draft');
      }
      return rest;
    });
  }

  // -------------------------------------------------------------------
  // Restart
  // -------------------------------------------------------------------
  function handleRestart() {
    setRound(1);
    setFieldUnits([]);
    setBench([]);
    setPendingMerges([]);
    setVictor(null);
    setPaused(false);
    setDraftOptions(getInitialDraftOptions(ALL_LEES, 5));
    setScreen('initial-draft');
  }

  // Advance round after deploy confirm
  function handleDeployStartWithRoundIncrement(deployed, remainingBench) {
    if (screen === 'deploy' && round > 1) {
      // round was already incremented when transitioning to deploy
    }
    handleDeployStart(deployed, remainingBench);
  }

  // Increment round when entering deploy after draft
  useEffect(() => {
    if (screen === 'deploy' && victor === 'player') {
      setRound(r => r + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

  // -------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------
  if (screen === 'initial-draft') {
    return (
      <div style={{ minHeight: '100vh', background: '#080808' }}>
        <DraftScreen
          options={draftOptions}
          pickCount={3}
          title="Choose Your Team"
          subtitle="Pick 3 Lees to start your run."
          onConfirm={handleInitialDraftConfirm}
        />
      </div>
    );
  }

  if (screen === 'deploy') {
    return (
      <div style={{ minHeight: '100vh', background: '#080808' }}>
        <DeployScreen
          initialDeployed={fieldUnits.filter(u => u.side === 'player')}
          bench={bench}
          fieldConfig={FIELD_CONFIG}
          round={round}
          onStart={handleDeployStartWithRoundIncrement}
        />
      </div>
    );
  }

  if (screen === 'battle' || screen === 'battle-end') {
    const playerAlive = fieldUnits.filter(u => u.side === 'player' && u.alive);
    const enemyAlive  = fieldUnits.filter(u => u.side === 'enemy'  && u.alive);

    return (
      <div style={{ minHeight: '100vh', background: '#080808', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 24, gap: 16 }}>
        {/* HUD */}
        <div style={{ display: 'flex', gap: 32, color: '#888', fontSize: 13 }}>
          <span>Round {round}</span>
          <span style={{ color: '#4488ff' }}>Your team: {playerAlive.length}</span>
          <span style={{ color: '#ff4444' }}>Enemies: {enemyAlive.length}</span>
          <button
            onClick={() => setPaused(p => !p)}
            style={{
              background: '#222', border: '1px solid #444', borderRadius: 4,
              color: '#ccc', fontSize: 12, fontFamily: 'monospace',
              padding: '2px 10px', cursor: 'pointer',
            }}
          >
            {paused ? '▶ Resume' : '⏸ Pause'}
          </button>
        </div>

        <BattleField units={fieldUnits} fieldConfig={FIELD_CONFIG} />

        {/* Bench display */}
        {bench.length > 0 && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <span style={{ color: '#555', fontSize: 11 }}>BENCH:</span>
            {bench.map(u => (
              <div key={u.uid} style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#111', border: '1px solid #222', borderRadius: 4, padding: '3px 8px', fontSize: 11, color: '#888' }}>
                <span>{u.emoji}</span>
                <span>{u.name.split(' ')[0]}</span>
                <span style={{ color: '#666' }}>{u.hp}/{u.maxHp}</span>
              </div>
            ))}
          </div>
        )}

        {/* Victory overlay */}
        {screen === 'battle-end' && victor === 'player' && (
          <div style={{
            position: 'fixed', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.6)',
            fontSize: 56, fontWeight: 'bold', color: '#44ff88',
            letterSpacing: 8,
          }}>
            VICTORY
          </div>
        )}
      </div>
    );
  }

  if (screen === 'merge' && pendingMerges.length > 0) {
    return (
      <div style={{ minHeight: '100vh', background: '#080808' }}>
        <MergeScreen
          merge={pendingMerges[0]}
          allLeeDefs={ALL_LEES}
          onMerge={handleMerge}
          onSkip={handleMergeSkip}
          remaining={pendingMerges.length}
        />
      </div>
    );
  }

  if (screen === 'between-draft') {
    return (
      <div style={{ minHeight: '100vh', background: '#080808' }}>
        <DraftScreen
          options={draftOptions}
          pickCount={1}
          title={`Round ${round} Draft`}
          subtitle="Add one Lee to your roster."
          onConfirm={picks => handleBetweenDraftConfirm(picks)}
        />
      </div>
    );
  }

  if (screen === 'game-over') {
    return <GameOver round={round} onRestart={handleRestart} />;
  }

  return null;
}
