import { useState } from 'react';

const ABILITY_TYPES  = ['melee', 'missile', 'mortar', 'heal', 'buff', 'thorns', 'taunt', 'shield'];
const ENEMY_TARGETS  = ['nearest-enemy', 'lowest-hp-enemy', 'lowest-hp-col', 'random-enemy'];
const ALLY_TARGETS   = ['nearest-ally', 'lowest-hp-ally'];
const MOVE_BEHAVIORS = ['nearest-enemy', 'weakest-enemy', 'weakest-ally'];
const TYPES          = ['none', 'rage', 'chill', 'whimsy', 'cringe', 'smug', 'unknown'];
const EMOJIS         = ['👊','🏹','🛡️','💚','🔥','❄️','✨','😬','😎','💪','🌀','⚡','🌵','🎯','💣','🧙','🧟','🧌'];

function toKebab(str) {
  return str.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

function defaultsForType(type, existing = {}) {
  const base = { ...existing, type };
  if (type === 'melee')   return { ...base, cleave: existing.cleave ?? 0, targeting: existing.targeting?.includes('ally') ? 'nearest-enemy' : (existing.targeting || 'nearest-enemy') };
  if (type === 'missile') return { ...base, aoeRadius: existing.aoeRadius ?? 0, targeting: existing.targeting?.includes('ally') ? 'nearest-enemy' : (existing.targeting || 'nearest-enemy') };
  if (type === 'mortar')  return { ...base, aoeRadius: existing.aoeRadius || 1, minRange: existing.minRange || 2, targeting: existing.targeting?.includes('ally') ? 'nearest-enemy' : (existing.targeting || 'nearest-enemy') };
  if (type === 'heal')    return { ...base, targeting: existing.targeting?.includes('ally') ? existing.targeting : 'lowest-hp-ally' };
  if (type === 'buff' || type === 'shield') return { ...base, targeting: existing.targeting?.includes('ally') ? existing.targeting : 'nearest-ally' };
  if (type === 'thorns')  return { ...base };
  if (type === 'taunt')   return { ...base, targeting: existing.targeting?.includes('ally') ? 'nearest-enemy' : (existing.targeting || 'nearest-enemy') };
  return base;
}

function newAbility(index) {
  return {
    id: `ability-${Date.now()}-${index}`,
    type: 'melee',
    label: '',
    damage: 10,
    range: 1,
    cleave: 0,
    aoeRadius: 0,
    actSpeed: 0.5,
    attackDelay: 0.1,
    targeting: 'nearest-enemy',
  };
}

export default function LeeForm({ value: lee, onChange, existingLees = [] }) {
  const [expandedAbility, setExpandedAbility] = useState(0);

  function set(field, val) {
    const updated = { ...lee, [field]: val };
    if (field === 'name' && !lee._idManuallySet) {
      updated.id = toKebab(val);
    }
    onChange(updated);
  }

  function setStats(field, val) {
    onChange({ ...lee, baseStats: { ...lee.baseStats, [field]: val } });
  }

  function setAbility(index, field, val) {
    let updated = { ...lee.abilities[index], [field]: val };
    if (field === 'type') updated = defaultsForType(val, lee.abilities[index]);
    const abilities = lee.abilities.map((a, i) => i === index ? updated : a);
    onChange({ ...lee, abilities });
  }

  function addAbility() {
    if ((lee.abilities || []).length >= 3) return;
    const abilities = [...(lee.abilities || []), newAbility(lee.abilities.length)];
    onChange({ ...lee, abilities });
    setExpandedAbility(abilities.length - 1);
  }

  function removeAbility(index) {
    const abilities = lee.abilities.filter((_, i) => i !== index);
    onChange({ ...lee, abilities });
    setExpandedAbility(Math.min(expandedAbility, abilities.length - 1));
  }

  const inputStyle = {
    background: '#1a1a1a', color: '#ddd', border: '1px solid #333',
    borderRadius: 4, padding: '5px 8px', fontFamily: 'monospace',
    fontSize: 13, width: '100%',
  };
  const labelStyle = { fontSize: 11, color: '#888', marginBottom: 3, display: 'block' };
  const rowStyle   = { display: 'flex', flexDirection: 'column', gap: 3 };
  const actionMini = { background: '#1a1a1a', border: '1px solid #333', borderRadius: 4, color: '#aaa', padding: '3px 8px', cursor: 'pointer', fontFamily: 'monospace', fontSize: 11 };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

      {/* Identity */}
      <section>
        <div style={{ fontSize: 12, color: '#555', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 1 }}>Identity</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div style={rowStyle}>
            <label style={labelStyle}>Name</label>
            <input style={inputStyle} value={lee.name || ''} onChange={e => set('name', e.target.value)} placeholder="Stupid Lee" />
          </div>
          <div style={rowStyle}>
            <label style={labelStyle}>ID (auto)</label>
            <input style={inputStyle} value={lee.id || ''} onChange={e => onChange({ ...lee, id: e.target.value, _idManuallySet: true })} placeholder="stupid-lee" />
          </div>
          <div style={rowStyle}>
            <label style={labelStyle}>Emoji</label>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {EMOJIS.map(em => (
                <button key={em} onClick={() => set('emoji', em)} style={{ background: lee.emoji === em ? '#333' : 'transparent', border: lee.emoji === em ? '1px solid #666' : '1px solid transparent', borderRadius: 4, padding: '2px 4px', cursor: 'pointer', fontSize: 16 }}>
                  {em}
                </button>
              ))}
            </div>
          </div>
          <div style={rowStyle}>
            <label style={labelStyle}>Type</label>
            <select style={inputStyle} value={lee.type || 'none'} onChange={e => set('type', e.target.value)}>
              {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div style={rowStyle}>
            <label style={labelStyle}>Tier</label>
            <select style={inputStyle} value={lee.tier || 1} onChange={e => set('tier', Number(e.target.value))}>
              <option value={1}>1 — Common</option>
              <option value={2}>2 ✦ — Uncommon</option>
              <option value={3}>3 ✦✦ — Legendary</option>
            </select>
          </div>
          <div style={rowStyle}>
            <label style={labelStyle}>Move Behavior</label>
            <select style={inputStyle} value={lee.moveBehavior || 'nearest-enemy'} onChange={e => set('moveBehavior', e.target.value)}>
              {MOVE_BEHAVIORS.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
        </div>
        <div style={{ ...rowStyle, marginTop: 10 }}>
          <label style={labelStyle}>Flavor text</label>
          <textarea style={{ ...inputStyle, height: 56, resize: 'vertical' }} value={lee.flavor || ''} onChange={e => set('flavor', e.target.value)} placeholder='"He stupidly left his keys in the car."' />
        </div>
      </section>

      {/* Base stats */}
      <section>
        <div style={{ fontSize: 12, color: '#555', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 1 }}>Base Stats</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          {[
            ['hp',        'HP',         1,   500, 1   ],
            ['def',       'DEF',        0,   30,  1   ],
            ['armor',     'Armor',      0,   20,  1   ],
            ['moveSpeed', 'Move Speed', 0.3, 3.0, 0.1 ],
          ].map(([field, label, min, max, step]) => (
            <div key={field} style={rowStyle}>
              <label style={labelStyle}>{label}</label>
              <input type="number" min={min} max={max} step={step} style={inputStyle} value={lee.baseStats?.[field] ?? 0} onChange={e => setStats(field, parseFloat(e.target.value))} />
            </div>
          ))}
          <div style={rowStyle}>
            <label style={labelStyle}>Move Mult (0–1)</label>
            <input type="range" min={0} max={1} step={0.1} style={{ width: '100%', accentColor: '#4488ff' }} value={lee.moveMult ?? 1} onChange={e => set('moveMult', parseFloat(e.target.value))} />
            <span style={{ fontSize: 11, color: '#666' }}>{(lee.moveMult ?? 1).toFixed(1)}</span>
          </div>
        </div>
      </section>

      {/* Acquisition */}
      <section>
        <div style={{ fontSize: 12, color: '#555', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 1 }}>Acquisition</div>
        <div style={{ display: 'flex', gap: 16 }}>
          {['draft', 'combine', 'both'].map(m => (
            <label key={m} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: '#aaa', fontSize: 13 }}>
              <input type="radio" name="acquisition" value={m} checked={(lee.acquisition?.method || 'draft') === m} onChange={() => onChange({ ...lee, acquisition: { ...lee.acquisition, method: m } })} />
              {m}
            </label>
          ))}
        </div>
        {(lee.acquisition?.method === 'combine' || lee.acquisition?.method === 'both') && (() => {
          const raw = lee.acquisition?.combineFrom;
          const pairs = !raw?.length ? [['', '']] : Array.isArray(raw[0]) ? raw : [raw];
          function updatePairs(newPairs) {
            onChange({ ...lee, acquisition: { ...lee.acquisition, combineFrom: newPairs } });
          }
          return (
            <div style={{ marginTop: 10 }}>
              {pairs.map((pair, pi) => (
                <div key={pi} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                  {[0, 1].map(si => (
                    <select key={si} style={{ ...inputStyle, flex: 1 }} value={pair[si] || ''}
                      onChange={e => {
                        const next = pairs.map((p, i) => i === pi ? [si === 0 ? e.target.value : p[0], si === 1 ? e.target.value : p[1]] : p);
                        updatePairs(next);
                      }}>
                      <option value="">— source {si + 1} —</option>
                      {existingLees.filter(l => l.id !== lee.id).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </select>
                  ))}
                  {pairs.length > 1 && <button onClick={() => updatePairs(pairs.filter((_, i) => i !== pi))} style={{ ...actionMini, color: '#ff6666' }}>✕</button>}
                </div>
              ))}
              <button onClick={() => updatePairs([...pairs, ['', '']])} style={actionMini}>+ route</button>
            </div>
          );
        })()}
      </section>

      {/* Abilities */}
      <section>
        <div style={{ fontSize: 12, color: '#555', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
          Abilities ({(lee.abilities || []).length}/3)
        </div>

        {(lee.abilities || []).map((ab, i) => (
          <div key={ab.id} style={{ border: '1px solid #222', borderRadius: 6, marginBottom: 8 }}>
            <div onClick={() => setExpandedAbility(expandedAbility === i ? -1 : i)} style={{ padding: '8px 10px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#141414', borderRadius: expandedAbility === i ? '6px 6px 0 0' : 6 }}>
              <span style={{ fontSize: 13, color: '#ccc' }}>
                {abilityIcon(ab.type)} {ab.label || ab.type || `Ability ${i + 1}`}
              </span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: '#555' }}>{expandedAbility === i ? '▲' : '▼'}</span>
                <button onClick={e => { e.stopPropagation(); removeAbility(i); }} style={{ background: '#2a1010', border: '1px solid #442222', borderRadius: 4, color: '#ff6666', fontSize: 11, padding: '1px 6px', cursor: 'pointer' }}>✕</button>
              </div>
            </div>

            {expandedAbility === i && (
              <div style={{ padding: 12 }}>
                <AbilityFields ab={ab} index={i} setAbility={setAbility} inputStyle={inputStyle} labelStyle={labelStyle} rowStyle={rowStyle} />
              </div>
            )}
          </div>
        ))}

        {(lee.abilities || []).length < 3 && (
          <button onClick={addAbility} style={{ background: '#1a2a1a', border: '1px dashed #336633', borderRadius: 6, color: '#669966', padding: '8px 16px', cursor: 'pointer', fontFamily: 'monospace', fontSize: 13, width: '100%' }}>
            + Add Ability
          </button>
        )}
      </section>
    </div>
  );
}

function AbilityFields({ ab, index, setAbility, inputStyle, labelStyle, rowStyle }) {
  const s = (field, val) => setAbility(index, field, val);
  const num = (field, min, max, step, label) => (
    <div style={rowStyle}>
      <label style={labelStyle}>{label}</label>
      <input type="number" min={min} max={max} step={step} style={inputStyle} value={ab[field] ?? 0} onChange={e => s(field, parseFloat(e.target.value))} />
    </div>
  );

  const typeRow = (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
      <div style={rowStyle}>
        <label style={labelStyle}>Type</label>
        <select style={inputStyle} value={ab.type} onChange={e => s('type', e.target.value)}>
          {ABILITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div style={rowStyle}>
        <label style={labelStyle}>Label</label>
        <input style={inputStyle} value={ab.label || ''} onChange={e => s('label', e.target.value)} placeholder="Attack" />
      </div>
    </div>
  );

  const speedRow = (
    <div style={rowStyle}>
      <label style={labelStyle}>Action Speed</label>
      <input type="number" min={0.05} max={5} step={0.05} style={inputStyle} value={ab.actSpeed || 0.5} onChange={e => s('actSpeed', parseFloat(e.target.value))} />
      <span style={{ fontSize: 10, color: '#555' }}>cooldown ≈ {(1 / (ab.actSpeed || 0.5)).toFixed(1)}s</span>
    </div>
  );

  const targetRow = (opts) => (
    <div style={rowStyle}>
      <label style={labelStyle}>Targeting</label>
      <select style={inputStyle} value={ab.targeting || opts[0]} onChange={e => s('targeting', e.target.value)}>
        {opts.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
    </div>
  );

  const pending = (msg) => (
    <div style={{ fontSize: 11, color: '#666', fontStyle: 'italic', marginTop: 8, padding: '6px 8px', background: '#111', borderRadius: 4, border: '1px solid #222' }}>
      {msg}
    </div>
  );

  if (ab.type === 'thorns') {
    return (
      <>
        {typeRow}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {num('damage', 0, 200, 1, 'Damage (per hit back)')}
        </div>
        {pending('Passive — triggers automatically when this unit is hit by a melee attack. No cast bar or targeting needed.')}
      </>
    );
  }

  if (ab.type === 'melee') {
    return (
      <>
        {typeRow}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {num('damage', 0, 500, 1, 'Damage')}
          {num('range', 1, 10, 1, 'Range (tiles forward)')}
          {num('cleave', 0, 6, 1, 'Cleave (tiles each side)')}
          {speedRow}
          {num('attackDelay', 0, 3, 0.05, 'Attack Delay (s)')}
          {targetRow(ENEMY_TARGETS)}
        </div>
      </>
    );
  }

  if (ab.type === 'missile') {
    return (
      <>
        {typeRow}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {num('damage', 0, 500, 1, 'Damage')}
          {num('range', 1, 10, 1, 'Range (tiles)')}
          {num('aoeRadius', 0, 5, 1, 'AOE Radius (0 = single target)')}
          {speedRow}
          {num('attackDelay', 0, 3, 0.05, 'Attack Delay (s)')}
          {targetRow(ENEMY_TARGETS)}
        </div>
      </>
    );
  }

  if (ab.type === 'mortar') {
    return (
      <>
        {typeRow}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {num('damage', 0, 500, 1, 'Damage')}
          {num('range', 2, 10, 1, 'Max Range (tiles)')}
          {num('minRange', 1, 8, 1, 'Min Range (tiles)')}
          {num('aoeRadius', 1, 5, 1, 'AOE Radius (splash)')}
          {speedRow}
          {num('attackDelay', 0, 3, 0.05, 'Attack Delay (s)')}
          {targetRow(ENEMY_TARGETS)}
        </div>
      </>
    );
  }

  if (ab.type === 'heal') {
    return (
      <>
        {typeRow}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {num('healAmount', 0, 500, 1, 'Heal Amount')}
          {num('range', 1, 10, 1, 'Range (tiles)')}
          {speedRow}
          {targetRow(ALLY_TARGETS)}
        </div>
      </>
    );
  }

  if (ab.type === 'buff') {
    return (
      <>
        {typeRow}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {num('range', 1, 10, 1, 'Range (tiles)')}
          {speedRow}
          {targetRow(ALLY_TARGETS)}
        </div>
        {pending('Buff effects are not yet implemented — see GitHub issue #3.')}
      </>
    );
  }

  if (ab.type === 'shield') {
    return (
      <>
        {typeRow}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {num('range', 1, 10, 1, 'Aura Range (tiles)')}
          {speedRow}
          {targetRow(ALLY_TARGETS)}
        </div>
        {pending('Shield/Aura is not yet implemented — see GitHub issue #4.')}
      </>
    );
  }

  if (ab.type === 'taunt') {
    return (
      <>
        {typeRow}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {num('range', 1, 10, 1, 'Range (tiles)')}
          {speedRow}
          {targetRow(ENEMY_TARGETS)}
        </div>
        {pending('Taunt is not yet implemented — see GitHub issue #5.')}
      </>
    );
  }

  // Fallback: show all fields
  return (
    <>
      {typeRow}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {num('damage', 0, 500, 1, 'Damage')}
        {num('range', 1, 10, 1, 'Range')}
        {speedRow}
        {targetRow([...ENEMY_TARGETS, ...ALLY_TARGETS])}
      </div>
    </>
  );
}

function abilityIcon(type) {
  const map = { melee: '👊', missile: '🎯', mortar: '💣', heal: '💚', buff: '⬆️', thorns: '🌵', taunt: '📣', shield: '🛡️' };
  return map[type] || '?';
}
