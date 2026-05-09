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
  generateSpireMap,
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
import SpireMap         from './components/SpireMap.jsx';
import RestScreen       from './components/RestScreen.jsx';

const FIELD_CONFIG = { rows: 8, cols: 4, deployRows: 2 };
const TICK_MS      = 1000 / 60;
const COMBINE_MAP  = buildCombineMap(ALL_LEES);

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

export default function App() {
  // ── Core state ─────────────────────────────────────────────────────
  const [screen, setScreen]             = useState('difficulty');
  const [difficulty, setDifficulty]     = useState('normal');
  const [round, setRound]               = useState(1);
  const [fieldUnits, setFieldUnits]     = useState([]);
  const [bench, setBench]               = useState([]);
  const [draftOptions, setDraftOptions] = useState(() => getInitialDraftOptions(ALL_LEES, 5));
  const [pendingMerges, setPendingMerges] = useState([]);
  const [paused, setPaused]             = useState(false);
  const [lastEvents, setLastEvents]     = useState([]);
  const pendingEventsRef                = useRef([]);
  const [victor, setVictor]             = useState(null);

  // ── Perk / level-up state ───────────────────────────────────────────
  const [xpSnapshot, setXpSnapshot]         = useState({});
  const [levelUpResults, setLevelUpResults] = useState([]);
  const [perkQueue, setPerkQueue]           = useState([]);
  const [processedField, setProcessedField] = useState([]);
  const [processedBench, setProcessedBench] = useState([]);

  // ── Economy ─────────────────────────────────────────────────────────
  const [gold, setGold]             = useState(0);
  const [goldEarned, setGoldEarned] = useState(0);
  const [shopItems, setShopItems]   = useState([]);

  // ── Map / progression state ─────────────────────────────────────────
  const [spireMap, setSpireMap]                   = useState(null);
  const [currentNodeId, setCurrentNodeId]         = useState(null);
  const [visitedNodes, setVisitedNodes]           = useState(new Set());
  const [pendingNode, setPendingNode]             = useState(null);
  const [pendingDraftCount, setPendingDraftCount] = useState(0);

  // ── Refs for stale-closure safety ───────────────────────────────────
  const benchRef        = useRef(bench);
  const pausedRef       = useRef(paused);
  const roundRef        = useRef(round);
  const xpSnapshotRef   = useRef(xpSnapshot);
  const difficultyRef   = useRef(difficulty);
  const pendingNodeRef  = useRef(pendingNode);
  benchRef.current       = bench;
  pausedRef.current      = paused;
  roundRef.current       = round;
  xpSnapshotRef.current  = xpSnapshot;
  difficultyRef.current  = difficulty;
  pendingNodeRef.current = pendingNode;

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
    if (victor === 'enemy') { setScreen('game-over'); return; }

    const t = setTimeout(() => {
      setFieldUnits(prev => {
        const node            = pendingNodeRef.current;
        const currentBench    = benchRef.current;
        const currentSnapshot = xpSnapshotRef.current;

        const allPlayerField = prev
          .filter(u => u.side === 'player')
          .map(u => u.alive ? { ...resetToHome({ ...u }) } : { ...u });

        const { fieldUnits: leveled, benchUnits: leveledBench, levelUpResults: results } =
          calculateLevelUps(allPlayerField, currentBench.map(u => ({ ...u })), currentSnapshot);

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

        // Award gold: base round reward, doubled for elite, nothing extra for boss
        const baseGold = goldRewardForRound(roundRef.current);
        const earned   = node?.type === 'elite' ? baseGold * 2 : baseGold;
        setGold(g => g + earned);
        setGoldEarned(earned);

        // Mark node visited on the map
        if (node) {
          setVisitedNodes(vs => new Set([...vs, node.id]));
          setCurrentNodeId(node.id);
        }

        setLevelUpResults(results);
        setPerkQueue(queue);
        setProcessedField(leveled);
        setProcessedBench(leveledBench);
        setBench(leveledBench);

        // Boss victory ends the run after the victory screen
        setScreen(node?.type === 'boss' ? 'boss-victory' : 'victory');

        return leveled;
      });
    }, 600);

    return () => clearTimeout(t);
  }, [screen, victor]);

  // -------------------------------------------------------------------
  // Victory → perks → finalize → draft → map
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

  function finalizePostBattle(field, benchUnits) {
    const healedField = field.map(u => ({ ...u }));
    const healedBench = benchUnits.map(u => ({ ...u }));
    applyPostBattleHealing(healedField, healedBench);

    const node = pendingNodeRef.current;

    // Boss cleared — skip draft, go straight to the run-complete screen
    if (node?.type === 'boss') {
      setFieldUnits(healedField);
      setBench(healedBench);
      setScreen('run-complete');
      return;
    }

    const merges = findMerges([...healedField, ...healedBench], COMBINE_MAP);
    setFieldUnits(healedField);
    setBench(healedBench);
    setPendingMerges(merges);

    const draftCount = node?.type === 'elite' ? 2 : 1;
    setPendingDraftCount(draftCount);

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
    const map = generateSpireMap(ALL_LEES, 10);
    setSpireMap(map);
    setCurrentNodeId(null);
    setVisitedNodes(new Set());
    setGold(50); // starting gold
    setScreen('map');
  }

  function handleBetweenDraftConfirm(picked) {
    setBench(prev => [...prev, createRuntimeUnit(picked[0], 'player', -1, -1)]);
    const remaining = pendingDraftCount - 1;
    setPendingDraftCount(remaining);
    if (remaining > 0) {
      setDraftOptions(getBetweenRoundDraftOptions(ALL_LEES, 4));
      // key={pendingDraftCount} on DraftScreen forces remount so selection resets
    } else {
      setScreen('map');
    }
  }

  // -------------------------------------------------------------------
  // Map node selection
  // -------------------------------------------------------------------
  function handleSelectNode(nodeId) {
    const node = spireMap.nodes[nodeId];
    setPendingNode(node);

    if (node.type === 'shop') {
      setShopItems(getShopOptions(4));
      setScreen('shop-node');
    } else if (node.type === 'rest') {
      setScreen('rest');
    } else {
      setRound(node.floor + 1);
      setScreen('deploy');
    }
  }

  function completeNonBattleNode() {
    setVisitedNodes(vs => new Set([...vs, pendingNode.id]));
    setCurrentNodeId(pendingNode.id);
    setScreen('map');
  }

  // -------------------------------------------------------------------
  // Deploy — snapshot XP before battle
  // -------------------------------------------------------------------
  function handleDeployStart(deployed, remainingBench) {
    const snapshot = {};
    deployed.forEach(u => { snapshot[u.uid] = { xp: u.xp || 0, level: u.level || 1 }; });
    setXpSnapshot(snapshot);

    const node    = pendingNode;
    const enemies = generateEnemies(
      ALL_LEES,
      node.floor + 1,
      FIELD_CONFIG,
      difficultyRef.current,
      node.type,
      node.enemyRosterIds,
    );
    setFieldUnits([...deployed, ...enemies]);
    setBench(remainingBench);
    setVictor(null);
    setPaused(false);
    setScreen('battle');
  }

  // -------------------------------------------------------------------
  // Shop (item equipping — visits from shop nodes on the map)
  // -------------------------------------------------------------------
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
  // Rest (heal or train)
  // -------------------------------------------------------------------
  function handleRest() {
    const heal = u => ({ ...u, hp: Math.min(u.maxHp, u.hp + Math.round(u.maxHp * 0.25)) });
    setFieldUnits(prev => prev.map(u => u.side === 'player' ? heal(u) : u));
    setBench(prev => prev.map(heal));
  }

  function handleTrain(uid) {
    const buff = u => {
      if (u.uid !== uid) return u;
      const newMax = Math.round(u.maxHp * 1.10);
      return { ...u, maxHp: newMax, hp: Math.min(u.hp + (newMax - u.maxHp), newMax) };
    };
    setFieldUnits(prev => prev.map(buff));
    setBench(prev => prev.map(buff));
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
      homeRow: merge.a.homeRow, homeCol: merge.a.homeCol,
      level: inheritLevel, xp: 0,
    };

    setFieldUnits(prev =>
      prev.filter(u => u.uid !== merge.a.uid && u.uid !== merge.b.uid)
          .concat(resultUnit.row >= 0 ? [resultUnit] : [])
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
    setScreen('difficulty');
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
    setSpireMap(null);
    setCurrentNodeId(null);
    setVisitedNodes(new Set());
    setPendingNode(null);
    setPendingDraftCount(0);
  }

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

  if (screen === 'map' && spireMap) {
    return (
      <div style={{ minHeight: '100vh', background: '#080808' }}>
        <CreatorLink />
        <div style={{ padding: '20px 0 0', textAlign: 'center' }}>
          <h2 style={{ color: '#eee', fontSize: 20, fontFamily: 'monospace', margin: 0 }}>
            Choose Your Path
          </h2>
          <p style={{ color: '#444', fontSize: 11, fontFamily: 'monospace', margin: '4px 0 0' }}>
            Click an available node to advance.
          </p>
        </div>
        <SpireMap
          map={spireMap}
          currentNodeId={currentNodeId}
          visitedNodes={visitedNodes}
          gold={gold}
          onSelectNode={handleSelectNode}
          allLees={ALL_LEES}
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
    const nodeLabel   = pendingNode
      ? { battle: 'Battle', elite: 'Elite', boss: 'Boss' }[pendingNode.type] ?? ''
      : '';

    return (
      <div style={{
        minHeight: '100vh', background: '#080808',
        display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 24, gap: 16,
      }}>
        <CreatorLink />
        <div style={{ display: 'flex', gap: 32, color: '#888', fontSize: 13 }}>
          <span>Floor {round}{nodeLabel ? ` — ${nodeLabel}` : ''}</span>
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
                {u.injured
                  ? <span style={{ color: '#ff6644', fontSize: 10 }}>🩹</span>
                  : <span style={{ color: '#666' }}>{u.hp}/{u.maxHp}</span>
                }
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

  if (screen === 'victory' || screen === 'boss-victory') {
    return (
      <div style={{ minHeight: '100vh', background: '#080808' }}>
        <CreatorLink />
        <VictoryScreen
          levelUpResults={levelUpResults}
          round={round}
          isBossVictory={screen === 'boss-victory'}
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

  // Shop node on the map — uses the full item-equipping shop
  if (screen === 'shop-node') {
    const allPlayerUnits = [
      ...fieldUnits.filter(u => u.side === 'player'),
      ...bench,
    ];
    return (
      <div style={{ minHeight: '100vh', background: '#080808' }}>
        <CreatorLink />
        <ShopScreen
          gold={gold}
          goldEarned={0}
          shopItems={shopItems}
          allUnits={allPlayerUnits}
          onBuy={handleShopBuy}
          onContinue={completeNonBattleNode}
        />
      </div>
    );
  }

  if (screen === 'rest') {
    return (
      <div style={{ minHeight: '100vh', background: '#080808' }}>
        <CreatorLink />
        <RestScreen
          bench={bench}
          fieldUnits={fieldUnits}
          onRest={handleRest}
          onTrain={handleTrain}
          onLeave={completeNonBattleNode}
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
    const picksLeft = pendingDraftCount;
    return (
      <div style={{ minHeight: '100vh', background: '#080808' }}>
        <CreatorLink />
        <DraftScreen
          key={picksLeft}
          options={draftOptions}
          pickCount={1}
          title="Draft Pick"
          subtitle={
            picksLeft > 1
              ? `${picksLeft} picks remaining — add one Lee to your roster.`
              : 'Add one Lee to your roster.'
          }
          onConfirm={picks => handleBetweenDraftConfirm(picks)}
        />
      </div>
    );
  }

  if (screen === 'run-complete') {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', height: '100vh', gap: 24, background: '#080808',
        fontFamily: 'monospace',
      }}>
        <div style={{ fontSize: 64 }}>👑</div>
        <h1 style={{ fontSize: 42, color: '#ffdd44', letterSpacing: 4, margin: 0 }}>
          SPIRE CONQUERED
        </h1>
        <p style={{ color: '#888', fontSize: 16, margin: 0 }}>
          You cleared all {spireMap?.totalFloors ?? 10} floors!
        </p>
        <button
          onClick={handleRestart}
          style={{
            marginTop: 16, padding: '14px 40px',
            background: '#3366ff', color: '#fff', border: 'none',
            borderRadius: 8, fontSize: 16, fontFamily: 'monospace',
            cursor: 'pointer', letterSpacing: 1,
          }}
        >
          Play Again
        </button>
      </div>
    );
  }

  if (screen === 'game-over') {
    return <GameOver round={round} onRestart={handleRestart} />;
  }

  return null;
}
