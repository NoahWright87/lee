import { useState, useEffect, useRef } from 'react';

// Inject CSS keyframe animations once
const STYLE_ID = 'victory-keyframes';
if (!document.getElementById(STYLE_ID)) {
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes levelUpPulse {
      0%   { transform: scale(1);    opacity: 1; }
      50%  { transform: scale(1.12); opacity: 0.85; }
      100% { transform: scale(1);    opacity: 1; }
    }
    @keyframes floatUp {
      0%   { opacity: 1; transform: translateY(0); }
      100% { opacity: 0; transform: translateY(-40px); }
    }
    @keyframes victoryGlow {
      0%, 100% { text-shadow: 0 0 20px #44ff8888; }
      50%       { text-shadow: 0 0 48px #44ff88ff, 0 0 80px #44ff8844; }
    }
    @keyframes barShine {
      0%   { background-position: -200% center; }
      100% { background-position:  200% center; }
    }
  `;
  document.head.appendChild(style);
}

const XP_PER_LEVEL = 100;
// Animation duration in ms for the full XP gain
const ANIM_DURATION = 2200;

/**
 * A single unit's card on the victory screen.
 * Animates the XP bar from xpAtBattleStart through level-ups to the final value.
 */
function VictoryUnitCard({ result, onDone }) {
  const {
    uid, name, emoji, level,
    xpAtBattleStart, xpAtBattleEnd, xpFinal,
    levelsGained, levelStatDeltas,
  } = result;

  // animXP tracks the continuously-incrementing XP total during animation
  // (same scale as xpAtBattleStart/xpAtBattleEnd — not wrapped mod 100)
  const [animXP, setAnimXP]               = useState(xpAtBattleStart);
  const [firedLevelUps, setFiredLevelUps] = useState(0);
  const [showLevelUp, setShowLevelUp]     = useState(false);
  const [floatingLabels, setFloatingLabels] = useState([]);
  const [complete, setComplete]           = useState(false);
  const startRef  = useRef(null);
  const doneRef   = useRef(false);

  const xpGained = xpAtBattleEnd - xpAtBattleStart;

  useEffect(() => {
    // Nothing to animate if no XP was gained
    if (xpGained <= 0) {
      setAnimXP(xpAtBattleEnd);
      setComplete(true);
      onDone();
      return;
    }

    const duration = ANIM_DURATION;
    let raf;

    function tick(now) {
      if (!startRef.current) startRef.current = now;
      const elapsed = now - startRef.current;
      const t = Math.min(1, elapsed / duration);
      // Ease-out cubic for a satisfying deceleration at the end
      const eased = 1 - Math.pow(1 - t, 3);
      const currentXP = xpAtBattleStart + xpGained * eased;

      setAnimXP(currentXP);

      if (t >= 1 && !doneRef.current) {
        doneRef.current = true;
        setComplete(true);
        onDone();
        return;
      }

      raf = requestAnimationFrame(tick);
    }

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fire level-up notifications when the animated bar crosses a 100-XP boundary
  useEffect(() => {
    const startLevel = Math.floor(xpAtBattleStart / XP_PER_LEVEL);
    const currentLevel = Math.floor(animXP / XP_PER_LEVEL);
    const newCrossings = currentLevel - startLevel;

    if (newCrossings > firedLevelUps) {
      const crossingIdx = firedLevelUps; // 0-based index of this level-up
      setFiredLevelUps(newCrossings);
      setShowLevelUp(true);

      // Show stat delta labels for this crossing
      const delta = levelStatDeltas[crossingIdx];
      if (delta) {
        const labels = [];
        if (delta.hp   > 0) labels.push(`+${delta.hp} HP`);
        if (delta.def  > 0) labels.push(`+${delta.def} DEF`);
        if (delta.dmg  > 0) labels.push(`+${delta.dmg} DMG`);
        if (delta.heal > 0) labels.push(`+${delta.heal} HEAL`);
        const id = Date.now() + crossingIdx;
        setFloatingLabels(prev => [...prev, { id, labels }]);
        setTimeout(() => {
          setFloatingLabels(prev => prev.filter(l => l.id !== id));
        }, 1400);
      }

      // Hide the level-up badge after a moment (or keep if still animating)
      setTimeout(() => setShowLevelUp(false), 900);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animXP]);

  // Bar fill: position within current 100-XP level band (0..1)
  const barFill = (animXP % XP_PER_LEVEL) / XP_PER_LEVEL;
  // Display level: starts at (level - levelsGained), advances as bar crosses thresholds
  const startLevel = Math.floor(xpAtBattleStart / XP_PER_LEVEL);
  const displayLevelOffset = Math.floor(animXP / XP_PER_LEVEL) - startLevel;
  const displayLevel = (level - levelsGained) + displayLevelOffset;

  const hasLeveledUp = levelsGained > 0;
  const borderColor  = complete && hasLeveledUp ? '#ffd700' : '#333';
  const glowStyle    = complete && hasLeveledUp
    ? { boxShadow: '0 0 18px #ffd70066, 0 0 36px #ffd70022' }
    : {};

  return (
    <div style={{
      minWidth: 200,
      maxWidth: 220,
      background: '#111',
      border: `2px solid ${borderColor}`,
      borderRadius: 10,
      padding: '14px 12px',
      position: 'relative',
      transition: 'border-color 0.4s, box-shadow 0.4s',
      flexShrink: 0,
      ...glowStyle,
    }}>
      {/* Unit header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 32 }}>{emoji}</span>
        <div>
          <div style={{ color: '#eee', fontWeight: 'bold', fontSize: 14 }}>{name}</div>
          <div style={{ color: '#888', fontSize: 11 }}>Lv {displayLevel}</div>
        </div>
      </div>

      {/* XP bar */}
      <div style={{ marginBottom: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#555', marginBottom: 3 }}>
          <span>XP</span>
          <span>{Math.floor(animXP % XP_PER_LEVEL)}/{XP_PER_LEVEL}</span>
        </div>
        <div style={{
          height: 10,
          background: '#1a1a1a',
          borderRadius: 5,
          overflow: 'hidden',
          border: '1px solid #2a2a2a',
        }}>
          <div style={{
            height: '100%',
            width: `${barFill * 100}%`,
            background: showLevelUp
              ? 'linear-gradient(90deg, #ffd700, #ffaa00, #ffd700)'
              : 'linear-gradient(90deg, #44ff88, #22cc66)',
            borderRadius: 5,
            transition: 'background 0.3s',
            backgroundSize: '200% 100%',
            animation: showLevelUp ? 'barShine 0.6s linear infinite' : 'none',
          }} />
        </div>
      </div>

      {/* XP gain summary */}
      {xpGained > 0 && (
        <div style={{ fontSize: 11, color: '#666', marginBottom: hasLeveledUp ? 6 : 0 }}>
          +{xpGained} XP this battle
        </div>
      )}

      {/* Level-up badge */}
      {hasLeveledUp && complete && (
        <div style={{
          marginTop: 6,
          padding: '4px 8px',
          background: '#1a1400',
          border: '1px solid #ffd700',
          borderRadius: 6,
          color: '#ffd700',
          fontWeight: 'bold',
          fontSize: 13,
          textAlign: 'center',
          animation: 'levelUpPulse 1s ease-in-out infinite',
        }}>
          LEVEL UP{levelsGained > 1 ? ` ×${levelsGained}` : ''}!
        </div>
      )}

      {/* Floating stat delta labels */}
      {floatingLabels.map(group => (
        <div key={group.id} style={{
          position: 'absolute',
          top: 10,
          right: 10,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          pointerEvents: 'none',
        }}>
          {group.labels.map((label, i) => (
            <span key={i} style={{
              color: '#44ff88',
              fontWeight: 'bold',
              fontSize: 13,
              textShadow: '0 1px 4px #000',
              animation: 'floatUp 1.2s ease-out forwards',
              animationDelay: `${i * 0.12}s`,
              display: 'block',
            }}>
              {label}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Victory screen shown after every player win.
 *
 * Props:
 *   levelUpResults  – array from calculateLevelUps (one entry per field unit)
 *   round           – current round number
 *   onCollect       – called when player clicks "Collect Rewards" / "Continue"
 */
export default function VictoryScreen({ levelUpResults, round, onCollect }) {
  const total = levelUpResults.length;
  const [doneCount, setDoneCount] = useState(0);
  const allDone = doneCount >= total;

  const anyLevelUps = levelUpResults.some(r => r.levelsGained > 0);

  // Count how many picks are pending (one per level gained per unit)
  const totalPerkPicks = levelUpResults.reduce((sum, r) => sum + r.levelsGained, 0);

  function handleCardDone() {
    setDoneCount(n => n + 1);
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: '#080808',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '32px 24px',
      gap: 24,
      fontFamily: 'monospace',
    }}>
      {/* Title */}
      <div style={{
        fontSize: 52,
        fontWeight: 'bold',
        letterSpacing: 10,
        color: '#44ff88',
        animation: 'victoryGlow 2s ease-in-out infinite',
      }}>
        VICTORY
      </div>
      <div style={{ color: '#555', fontSize: 13, letterSpacing: 2 }}>ROUND {round} COMPLETE</div>

      {/* Unit cards row */}
      {total > 0 ? (
        <div style={{
          display: 'flex',
          gap: 14,
          overflowX: 'auto',
          padding: '8px 4px',
          maxWidth: '100%',
          justifyContent: total <= 4 ? 'center' : 'flex-start',
        }}>
          {levelUpResults.map(result => (
            <VictoryUnitCard
              key={result.uid}
              result={result}
              onDone={handleCardDone}
            />
          ))}
        </div>
      ) : (
        <div style={{ color: '#444', fontSize: 13 }}>No surviving units to show.</div>
      )}

      {/* CTA button — only shown after all card animations finish */}
      <div style={{
        opacity: allDone ? 1 : 0,
        pointerEvents: allDone ? 'auto' : 'none',
        transition: 'opacity 0.6s',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        marginTop: 8,
      }}>
        {anyLevelUps && (
          <div style={{ color: '#ffd700', fontSize: 13, letterSpacing: 1 }}>
            {totalPerkPicks} perk {totalPerkPicks === 1 ? 'choice' : 'choices'} available!
          </div>
        )}
        <button
          onClick={onCollect}
          style={{
            background: anyLevelUps ? '#1a1400' : '#111',
            border: `2px solid ${anyLevelUps ? '#ffd700' : '#444'}`,
            borderRadius: 8,
            color: anyLevelUps ? '#ffd700' : '#aaa',
            fontSize: 16,
            fontFamily: 'monospace',
            fontWeight: 'bold',
            letterSpacing: 2,
            padding: '12px 32px',
            cursor: 'pointer',
            animation: anyLevelUps ? 'levelUpPulse 1.4s ease-in-out infinite' : 'none',
          }}
        >
          {anyLevelUps ? '★ COLLECT REWARDS ★' : 'CONTINUE →'}
        </button>
      </div>
    </div>
  );
}
