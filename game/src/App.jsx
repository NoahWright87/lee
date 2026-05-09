import { useState, useEffect, useRef } from 'react';
import {
  tickField,
  buildCombineMap,
  findMerges,
  calculateLevelUps,
  applyPostBattleHealing,
  createRuntimeUnit,
  resetToHome,
  generateEnemies,
  getInitialDraftOptions,
  getBetweenRoundDraftOptions,
  getRandomPerks,
  applyItemToUnit,
  getShopOptions,
  goldRewardForRound,
} from '@lee/shared';
import { ALL_LEES } from '@lee/shared/data/index.js';

import BattleField      from './components/BattleField.jsx';
import DraftScreen      from './components/DraftScreen.jsx';
import DeployScreen     from './components/DeployScreen.jsx';
import MergeScreen      from './components/MergeScreen.jsx';
import GameOver         from './components/GameOver.jsx';
import VictoryScreen    from './components/VictoryScreen.jsx';
import PerkSelection    from './components/PerkSelection.jsx';
import DifficultySelect from './components/DifficultySelect.jsx';
import ShopScreen       from './components/ShopScreen.jsx';

const FIELD_CONFIG = { rows: 8, cols: 4, deployRows: 2 };
const TICK_MS      = 1000 / 60;

const CreatorLink = () => (
  <a href="/creator" style={{
    position: 'fixed', bottom: 12, right: 14,
    color: '#2a2a2a', fontSize: 11, textDecoration: 'none',
    fontFamily: 'monospace', letterSpacing: 0.5,
    transition: 'color 0.2s',
  }}
    onMouseEnter={e => e.target.style.color = '#666'}
    onMouseLeave={e => e.target.style.color = '#2a2a2a'}
  >
    designer ↗
  </a>
);

const COMBINE_MAP = buildCombineMap(ALL_LEES);

export default function App() {
  const [screen, setScreen]               = useState('difficulty');
  const [difficulty, setDifficulty]       = useState('normal');
  const [round, setRound]                 = useState(1);
  const [fieldUnits, setFieldUnits]       = useState([]);
  const [bench, setBench]                 = useState([]);
  const [draftOptions, setDraftOptions]   = useState(() => getInitialDraftOptions(ALL_LEES, 5));
  const [pendingMerges, setPendingMerges] = useState([]);
  const [paused, setPaused]               = useState(false);
  const [lastEvents, setLastEvents]       = useState([]);
  const pendingEventsRef                  = useRef([]);
  const [victor, setVictor]               = useState(null);

  // Victory / perk-selection state
  const [xpSnapshot, setXpSnapshot]         = useState({});
  const [levelUpResults, setLevelUpResults] = useState([]);
  const [perkQueue, setPerkQueue]           = useState([]);
  const [processedField, setProcessedField] = useState([]);
  const [processedBench, setProcessedBench] = useState([]);

  // Economy
  const [gold, setGold]               = useState(0);
  const [goldEarned, setGoldEarned]   = useState(0);
  const [shopItems, setShopItems]     = useState([]);

  // Refs for stale-closure safety in the battle interval
  const benchRef          = useRef(bench);
  const pausedRef         = useRef(paused);
  const roundRef          = useRef(round);
  const xpSnapshotRef     = useRef(xpSnapshot);
  const difficultyRef     = useRef(difficulty);
  benchRef.current         = bench;
  pausedRef.current        = paused;
  roundRef.current         = round;
  xpSnapshotRef.current    = xpSnapshot;
  difficultyRef.current    = difficulty;

  // -------------------------------------------------------------------
  // Battle tick loop
  // -------------------------------------------------------------------
  useEffect(() => {
    if (screen !== 'battle') return;

    const id = setInterval(() => {
      if (pausedRef.current) return;

      setFieldUnits(prev => {
        const { next, events } = tickField(prev, TICK_MS / 1000, FIELD_CONFIG);
        if (events.length) pendingEventsRef.current = events;

        const playerAlive = next.some(u => u.side === 'player' && u.alive);
        const enemyAlive  = next.some(u => u.side === 'enemy'  && u.alive);

        if (!enemyAlive || !playerAlive) {
          clearInterval(id);
          setVictor(!enemyAlive ? 'player' : 'enemy');
          setScreen('battle-end');
        }

        return next;
      });
    }, TICK_MS);

    return () => clearInterval(id);
  }, [screen]);

  useEffect(() => {
    if (pendingEventsRef.current.length) {
      setLastEvents(pendingEventsRef.current);
      pendingEventsRef.current = [];
    }
  }, [fieldUnits]);

  // -------------------------------------------------------------------
  // Post-battle transition
  // -------------------------------------------------------------------
  useEffect(() => {
    if (screen !== 'battle-end') return;

    if (victor === 'enemy') {
      setScreen('game-over');
      return;
    }

    const t = setTimeout(() => {
      setFieldUnits(prev => {
        const currentBench    = benchRef.current;
        const currentSnapshot = xpSnapshotRef.current;

        // Reset surviving player units' positions
        const survivingField = prev
          .filter(u => u.side === 'player' && u.alive)
          .map(u => ({ ...resetToHome({ ...u }) }));

        // Pass ALL player field units (including dead) so calculateLevelUps can
        // move fallen units to bench as injured
        const allPlayerField = prev
          .filter(u => u.side === 'player')
          .map(u => u.alive ? { ...resetToHome({ ...u }) } : { ...u });

        const { fieldUnits: leveled, benchUnits: leveledBench, levelUpResults: results } =
          calculateLevelUps(allPlayerField, currentBench.map(u => ({ ...u })), currentSnapshot);

        // Build perk pick queue: one entry per (unit × level gained)
        const queue = [];
        leveled.forEach(unit => {
          const result = results.find(r => r.uid === unit.uid);
          if (!result || result.levelsGained === 0) return;
          for (let i = 0; i < result.levelsGained; i++) {
            queue.push({
              uid:        unit.uid,
              name:       unit.name,
              emoji:      unit.emoji,
              level:      unit.level,
              pickIndex:  i,
              totalPicks: result.levelsGained,
              options:    getRandomPerks(unit, 3),
            });
          }
        });

        // Award gold for the victory
        const earned = goldRewardForRound(roundRef.current);
        setGold(g => g + earned);
        setGoldEarned(earned);

        setLevelUpResults(results);
        setPerkQueue(queue);
        setProcessedField(leveled);
        setProcessedBench(leveledBench);
        setBench(leveledBench);
        setScreen('victory');

        return leveled;
      });
    }, 600);

    return () => clearTimeout(t);
  }, [screen, victor]);

  // -------------------------------------------------------------------
  // Victory → perk selection → finalize
  // -------------------------------------------------------------------
  function handleCollectRewards() {
    if (perkQueue.length > 0) {
      setScreen('perk-selection');
    } else {
      finalizePostBattle(processedField, processedBench);
    }
  }

  function handlePerksDone(updatedUnitsMap) {
    const newField = processedField.map(u => updatedUnitsMap[u.uid] || u);
    const newBench = processedBench.map(u => updatedUnitsMap[u.uid] || u);
    finalizePostBattle(newField, newBench);
  }

  function finalizePostBattle(field, bench) {
    const healedField = field.map(u => ({ ...u }));
    const healedBench = bench.map(u => ({ ...u }));
    applyPostBattleHealing(healedField, healedBench);

    const merges = findMerges([...healedField, ...healedBench], COMBINE_MAP);
    setFieldUnits(healedField);
    setBench(healedBench);
    setPendingMerges(merges);

    if (merges.length > 0) {
      setScreen('merge');
    } else {
      setDraftOptions(getBetweenRoundDraftOptions(ALL_LEES, 4));
      setScreen('between-draft');
    }
  }

  // -------------------------------------------------------------------
  // Draft handlers
  // -------------------------------------------------------------------
  function handleInitialDraftConfirm(picked) {
    setBench(picked.map(lee => createRuntimeUnit(lee, 'player', -1, -1)));
    setScreen('deploy');
  }

  function handleBetweenDraftConfirm(picked) {
    setBench(prev => [...prev, createRuntimeUnit(picked[0], 'player', -1, -1)]);
    setShopItems(getShopOptions(4));
    setScreen('shop');
  }

  function handleShopBuy(unitUid, item) {
    if (gold < item.price) return;
    setGold(g => g - item.price);

    function applyToUnit(unit) {
      if (unit.uid !== unitUid) return unit;
      const copy = {
        ...unit,
        abilities: unit.abilities.map(a => ({ ...a })),
        baseStats: { ...unit.baseStats },
        perks: [...(unit.perks || [])],
      };
      applyItemToUnit(copy, item);
      return copy;
    }

    setFieldUnits(prev => prev.map(applyToUnit));
    setBench(prev => prev.map(applyToUnit));
  }

  // -------------------------------------------------------------------
  // Deploy — snapshot XP before battle starts
  // -------------------------------------------------------------------
  function handleDeployStart(deployed, remainingBench) {
    const snapshot = {};
    deployed.forEach(u => { snapshot[u.uid] = { xp: u.xp || 0, level: u.level || 1 }; });
    setXpSnapshot(snapshot);

    const enemies = generateEnemies(ALL_LEES, roundRef.current, FIELD_CONFIG, difficultyRef.current);
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
    if (!resultDef) { advanceMerge(); return; }

    const inheritLevel = Math.max(merge.a.level || 1, merge.b.level || 1);
    const resultUnit = {
      ...createRuntimeUnit(resultDef, 'player', merge.a.row, merge.a.col),
      homeRow: merge.a.homeRow,
      homeCol: merge.a.homeCol,
      level: inheritLevel,
      xp: 0,
    };

    setFieldUnits(prev =>
      prev.filter(u => u.uid !== merge.a.uid && u.uid !== merge.b.uid).concat(
        resultUnit.row >= 0 ? [resultUnit] : []
      )
    );
    setBench(prev => {
      const filtered = prev.filter(u => u.uid !== merge.a.uid && u.uid !== merge.b.uid);
      const aOnBench = prev.some(u => u.uid === merge.a.uid);
      const bOnBench = prev.some(u => u.uid === merge.b.uid);
      return (aOnBench || bOnBench)
        ? [...filtered, { ...resultUnit, row: -1, col: -1, homeRow: -1, homeCol: -1 }]
        : filtered;
    });

    advanceMerge();
  }

  function handleMergeSkip() { advanceMerge(); }

  function advanceMerge() {
    setPendingMerges(prev => {
      const rest = prev.slice(1);
      if (rest.length === 0) {
        setDraftOptions(getBetweenRoundDraftOptions(ALL_LEES, 4));
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
    setXpSnapshot({});
    setLevelUpResults([]);
    setPerkQueue([]);
    setProcessedField([]);
    setProcessedBench([]);
    setGold(0);
    setGoldEarned(0);
    setShopItems([]);
    setDraftOptions(getInitialDraftOptions(ALL_LEES, 5));
    setScreen('difficulty');
  }

  // Increment round when entering deploy after a victory
  useEffect(() => {
    if (screen === 'deploy' && victor === 'player') {
      setRound(r => r + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

  // -------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------
  if (screen === 'difficulty') {
    return (
      <div style={{ minHeight: '100vh', background: '#080808' }}>
        <CreatorLink />
        <DifficultySelect onConfirm={d => { setDifficulty(d); setScreen('initial-draft'); }} />
      </div>
    );
  }

  if (screen === 'initial-draft') {
    return (
      <div style={{ minHeight: '100vh', background: '#080808' }}>
        <CreatorLink />
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
        <CreatorLink />
        <DeployScreen
          initialDeployed={fieldUnits.filter(u => u.side === 'player')}
          bench={bench}
          fieldConfig={FIELD_CONFIG}
          round={round}
          difficulty={difficulty}
          onStart={handleDeployStart}
        />
      </div>
    );
  }

  if (screen === 'battle' || screen === 'battle-end') {
    const playerAlive = fieldUnits.filter(u => u.side === 'player' && u.alive);
    const enemyAlive  = fieldUnits.filter(u => u.side === 'enemy'  && u.alive);

    return (
      <div style={{ minHeight: '100vh', background: '#080808', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 24, gap: 16 }}>
        <CreatorLink />
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

        <BattleField units={fieldUnits} fieldConfig={FIELD_CONFIG} events={lastEvents} />

        {bench.length > 0 && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <span style={{ color: '#555', fontSize: 11 }}>BENCH:</span>
            {bench.map(u => (
              <div key={u.uid} style={{
                display: 'flex', alignItems: 'center', gap: 4,
                background: '#111',
                border: `1px solid ${u.injured ? '#663333' : '#222'}`,
                borderRadius: 4, padding: '3px 8px',
                fontSize: 11, color: u.injured ? '#885555' : '#888',
              }}>
                <span>{u.emoji}</span>
                <span>{u.name.split(' ')[0]}</span>
                {u.injured ? (
                  <span style={{ color: '#ff6644', fontSize: 10 }}>🩹</span>
                ) : (
                  <span style={{ color: '#666' }}>{u.hp}/{u.maxHp}</span>
                )}
              </div>
            ))}
          </div>
        )}

        {screen === 'battle-end' && victor === 'enemy' && (
          <div style={{
            position: 'fixed', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.6)',
            fontSize: 56, fontWeight: 'bold', color: '#ff4444',
            letterSpacing: 8, fontFamily: 'monospace',
          }}>
            DEFEAT
          </div>
        )}
      </div>
    );
  }

  if (screen === 'victory') {
    return (
      <div style={{ minHeight: '100vh', background: '#080808' }}>
        <CreatorLink />
        <VictoryScreen
          levelUpResults={levelUpResults}
          round={round}
          onCollect={handleCollectRewards}
        />
      </div>
    );
  }

  if (screen === 'perk-selection' && perkQueue.length > 0) {
    const unitsMap = {};
    [...processedField, ...processedBench].forEach(u => { unitsMap[u.uid] = u; });

    return (
      <div style={{ minHeight: '100vh', background: '#080808' }}>
        <CreatorLink />
        <PerkSelection
          queue={perkQueue}
          units={unitsMap}
          onComplete={handlePerksDone}
        />
      </div>
    );
  }

  if (screen === 'shop') {
    const allPlayerUnits = [
      ...fieldUnits.filter(u => u.side === 'player'),
      ...bench,
    ];
    return (
      <div style={{ minHeight: '100vh', background: '#080808' }}>
        <CreatorLink />
        <ShopScreen
          gold={gold}
          goldEarned={goldEarned}
          shopItems={shopItems}
          allUnits={allPlayerUnits}
          onBuy={handleShopBuy}
          onContinue={() => setScreen('deploy')}
        />
      </div>
    );
  }

  if (screen === 'merge' && pendingMerges.length > 0) {
    return (
      <div style={{ minHeight: '100vh', background: '#080808' }}>
        <CreatorLink />
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
        <CreatorLink />
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
